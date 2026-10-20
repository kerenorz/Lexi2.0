import mongoose, { UpdateWriteOpResult } from 'mongoose';
import { ExperimentsModel } from '../models/ExperimentsModel';
import { UsersModel } from '../models/UsersModel';
import {
    AgentsMode,
    DisplaySettings,
    ExperimentConfigIssue,
    ExperimentFeatures,
    IAgent,
    IExperiment,
    IExperimentLean,
    LLMProvider,
} from '../types';
import { AgentsModel } from '../models/AgentsModel';
import { agentsService } from './agents.service';
import { apiKeysService } from './apiKeys.service';
import { AppError } from '../utils/errors';
import { SERVER_OWNED_FIELDS, stripServerOwned } from '../utils/serverOwnedFields';

// Enumerated because Mongo can't query "any sub-key equals X"; unknown providers are dropped.
const OVERRIDABLE_PROVIDERS: LLMProvider[] = ['openai', 'anthropic', 'google', 'xai', 'openrouter'];

type BulkWriteResult = ReturnType<typeof ExperimentsModel.bulkWrite>;

class ExperimentsService {
    // Server-side copy of the form's segment checks, since quotas are enforced from these
    // numbers. Only rejects values that would break a study.
    private validateSegmentsConfig(experiment: any): void {
        const segments = experiment?.segments;
        if (!segments?.enabled) return;

        // One block is a valid design (pre-survey, one chat, post-survey).
        // Wording matches validateSegments in segmentsConfig.ts.
        const count = Number(segments.count);
        if (!Number.isFinite(count) || count < 1) {
            throw new AppError(
                'A survey-embedded study needs at least one chat block.',
                400,
                'EXPERIMENT_MISCONFIGURED',
            );
        }

        let widestCeiling = 0;
        for (const [i, quota] of (segments.quotas ?? []).entries()) {
            const maxMsgs = quota?.maxUserMessages;
            const maxSecs = quota?.maxSeconds;
            if (typeof maxMsgs === 'number' && maxMsgs < 1) {
                throw new AppError(
                    `Chat block ${i + 1}: a maximum of 0 messages is not a limit — use 1 or more.`,
                    400,
                    'EXPERIMENT_MISCONFIGURED',
                );
            }
            if (typeof maxSecs === 'number' && maxSecs < 30) {
                throw new AppError(
                    `Chat block ${i + 1}: a time limit under 30 seconds can close the block mid-reply.`,
                    400,
                    'EXPERIMENT_MISCONFIGURED',
                );
            }
            // Rows past `count` are unreachable, so they don't count toward the cap check.
            if (typeof maxMsgs === 'number' && i < count) widestCeiling = Math.max(widestCeiling, maxMsgs);
        }

        const cap = Number(experiment?.maxMessages);
        if (Number.isFinite(cap) && cap > 0 && widestCeiling > 0 && cap < count * widestCeiling) {
            throw new AppError(
                `This study allows ${cap} messages per conversation, but ${count} blocks of up to ` +
                    `${widestCeiling} need ${count * widestCeiling}. A participant would hit the cap mid-study.`,
                400,
                'EXPERIMENT_MISCONFIGURED',
            );
        }
    }

    // Agent ids the current mode actually reads; stale fields from another mode are ignored.
    private referencedAgentIds(experiment: any): string[] {
        const raw =
            experiment?.agentsMode === AgentsMode.GROUP
                ? experiment?.groupAgents ?? []
                : experiment?.agentsMode === AgentsMode.AB
                  ? [experiment?.abAgents?.agentA, experiment?.abAgents?.agentB]
                  : [experiment?.activeAgent];
        return [...new Set((raw as unknown[]).filter(Boolean).map(String))];
    }

    // Invalid ObjectIds are left out (reported missing): one would make `$in` throw a CastError.
    private async existingAgentIds(ids: string[]): Promise<Set<string>> {
        const queryable = ids.filter((id) => mongoose.Types.ObjectId.isValid(id));
        if (!queryable.length) return new Set();
        const found = await AgentsModel.find({ _id: { $in: queryable } }, { _id: 1 }).lean();
        return new Set(found.map((a) => String(a._id)));
    }

    // Single source for the badge and the registration error text.
    private describeRosterIssue(experiment: any, existing: Set<string>): ExperimentConfigIssue | null {
        const referenced = this.referencedAgentIds(experiment);
        const missing = referenced.filter((id) => !existing.has(id));
        if (!missing.length) return null;

        const configuredCount = referenced.length;
        const availableCount = configuredCount - missing.length;
        const mode = `${experiment?.agentsMode} mode`;
        const agents = (n: number) => `${n} agent${n === 1 ? '' : 's'}`;
        const message =
            availableCount === 0
                ? `Experiment configuration error: ${mode} is set up with ${agents(configuredCount)}, but ` +
                  `${configuredCount === 1 ? 'it has' : 'all of them have'} been deleted. Assign an agent to ` +
                  'this experiment before anyone can join.'
                : `Experiment configuration error: ${mode} is set up with ${agents(configuredCount)}, but only ` +
                  `${agents(availableCount)} ${availableCount === 1 ? 'is' : 'are'} still available. The other ` +
                  `${agents(missing.length)} ${missing.length === 1 ? 'has' : 'have'} been deleted.`;

        return { reason: 'MISSING_AGENTS', message, missingAgentIds: missing, configuredCount, availableCount };
    }

    // Null when the roster is fine.
    async getRosterIssue(experiment: IExperiment | null): Promise<ExperimentConfigIssue | null> {
        if (!experiment) return null;
        const existing = await this.existingAgentIds(this.referencedAgentIds(experiment));
        return this.describeRosterIssue(experiment, existing);
    }

    /**
     * An override must name a key the study owner holds for that same provider.
     * Blank and unknown-provider entries are dropped, so `{ openai: '' }` clears it.
     */
    private async validateApiKeyOverrides(experiment: any, ownerId?: string): Promise<void> {
        const overrides = experiment?.apiKeyOverrides;
        if (!overrides || typeof overrides !== 'object') return;

        // Caller's id first: the body's ownerId is client-chosen. Undefined only for an admin.
        const owner = ownerId ?? (experiment?.ownerId ? String(experiment.ownerId) : undefined);
        const cleaned: Record<string, string> = {};

        for (const provider of OVERRIDABLE_PROVIDERS) {
            const keyId = overrides[provider];
            if (!keyId) continue;
            if (!owner || !(await apiKeysService.mayUseKeyForProvider(String(keyId), owner, provider))) {
                throw new AppError(
                    `The selected ${provider} API key is not available on this account.`,
                    400,
                    'API_KEY_NOT_FOUND',
                );
            }
            cleaned[provider] = String(keyId);
        }

        // Empty map is stored as null, same as never having one.
        experiment.apiKeyOverrides = Object.keys(cleaned).length ? cleaned : null;
    }

    /** Studies that bill to this key; used by the key delete guard. */
    experimentsUsingApiKey = async (keyId: string, ownerId?: string): Promise<IExperimentLean[]> => {
        const filter: any = {
            $or: OVERRIDABLE_PROVIDERS.map((provider) => ({ [`apiKeyOverrides.${provider}`]: keyId })),
        };
        if (ownerId) filter.ownerId = ownerId;
        return ExperimentsModel.find(filter, { title: 1 }).lean() as unknown as IExperimentLean[];
    };

    /** keyId -> titles of this owner's studies that bill to it. */
    apiKeyUsage = async (ownerId: string): Promise<Record<string, string[]>> => {
        const docs = await ExperimentsModel.find(
            { ownerId, apiKeyOverrides: { $nin: [null, undefined] } },
            { apiKeyOverrides: 1, title: 1 },
        ).lean();

        const usage: Record<string, string[]> = {};
        docs.forEach((doc: any) => {
            OVERRIDABLE_PROVIDERS.forEach((provider) => {
                const keyId = doc.apiKeyOverrides?.[provider];
                if (!keyId) return;
                (usage[String(keyId)] = usage[String(keyId)] || []).push(doc.title || 'Untitled study');
            });
        });
        return usage;
    };

    /** Removes this key from override maps, per provider so other providers' overrides survive. */
    clearApiKeyOverride = async (keyId: string): Promise<void> => {
        for (const provider of OVERRIDABLE_PROVIDERS) {
            await ExperimentsModel.updateMany(
                { [`apiKeyOverrides.${provider}`]: keyId },
                { $unset: { [`apiKeyOverrides.${provider}`]: '' } },
            );
        }
    };

    async createExperiment(experiment: IExperiment, ownerId: string): Promise<IExperiment> {
        this.validateSegmentsConfig(experiment);
        await this.validateApiKeyOverrides(experiment, ownerId);
        const response = await ExperimentsModel.create({ ...experiment, ownerId });
        return response;
    }

    async getExperiment(experimentId: string): Promise<IExperiment | null> {
        if (!mongoose.Types.ObjectId.isValid(experimentId)) {
            return null;
        }
        const experiment = await ExperimentsModel.findById(experimentId).lean();
        return experiment;
    }

    async getExperiments(ownerId?: string): Promise<IExperiment[]> {
        const filter = ownerId ? { ownerId } : {};
        const experiments = await ExperimentsModel.find(filter).lean();

        const ownerIds = [...new Set(experiments.map((e) => e.ownerId).filter(Boolean))];
        const owners = await UsersModel.find({ _id: { $in: ownerIds } }, { username: 1 }).lean();
        const ownerMap = new Map(owners.map((o) => [o._id.toString(), o.username]));

        // One agents query for the whole page.
        const existing = await this.existingAgentIds([
            ...new Set(experiments.flatMap((e) => this.referencedAgentIds(e))),
        ]);

        return experiments.map((e) => {
            const configIssue = this.describeRosterIssue(e, existing);
            return {
                ...e,
                ownerUsername: e.ownerId ? ownerMap.get(e.ownerId.toString()) : undefined,
                ...(configIssue ? { configIssue } : {}),
            };
        });
    }

    updateExperiment = async (experiment: IExperiment, ownerId?: string): Promise<UpdateWriteOpResult> => {
        this.validateSegmentsConfig(experiment);
        await this.validateApiKeyOverrides(experiment, ownerId);
        const filter: any = { _id: experiment._id };
        if (ownerId) filter.ownerId = ownerId;
        // Strip server-owned fields (ownerId, counters) from the client body. Stripped, not
        // rejected, because the form sends the whole loaded document back.
        const update = stripServerOwned(experiment, SERVER_OWNED_FIELDS.experiment);
        const response = await ExperimentsModel.updateOne(filter, { $set: update });
        return response;
    };

    addParticipant = async (experimentId: string): Promise<IExperiment> => {
        const updatedExperiment = await ExperimentsModel.findOneAndUpdate(
            { _id: experimentId },
            { $inc: { numberOfParticipants: 1 } },
            { new: true },
        );

        return updatedExperiment;
    };

    addSession = async (experimentId: string): Promise<IExperiment> => {
        const updatedExperiment = await ExperimentsModel.findOneAndUpdate(
            { _id: experimentId },
            { $inc: { totalSessions: 1, openSessions: 1 } },
            { new: true },
        );

        return updatedExperiment;
    };

    closeSession = async (experimentId: string): Promise<IExperiment> => {
        const updatedExperiment = await ExperimentsModel.findOneAndUpdate(
            { _id: experimentId },
            { $inc: { openSessions: -1 } },
            { new: true },
        );

        return updatedExperiment;
    };

    updateExperimentDisplaySettings = async (
        experimentId: string,
        displaySettings: DisplaySettings,
        ownerId?: string,
    ): Promise<UpdateWriteOpResult> => {
        if (!mongoose.Types.ObjectId.isValid(experimentId)) {
            throw new AppError('Invalid experiment ID', 400, 'INVALID_EXPERIMENT_ID');
        }
        const filter: any = { _id: experimentId };
        if (ownerId) filter.ownerId = ownerId;
        const response = await ExperimentsModel.updateOne(
            filter,
            { $set: { displaySettings } },
        );

        return response;
    };

    // Shape-checked so malformed bodies get a 400 instead of a 500 (bulkWrite rejects empty batches).
    updateExperimentsStatus = async (experimentsUpdates: any[], ownerId?: string): Promise<BulkWriteResult> => {
        if (!Array.isArray(experimentsUpdates) || experimentsUpdates.length === 0) {
            throw new AppError('modifiedExperiments must be a non-empty array.', 400, 'INVALID_EXPERIMENT_ID');
        }
        const bulkOperations = experimentsUpdates.map((update) => {
            if (!update || typeof update !== 'object' || !mongoose.Types.ObjectId.isValid(update.id)) {
                throw new AppError(`Invalid experiment ID: ${update?.id}`, 400, 'INVALID_EXPERIMENT_ID');
            }
            // Strictly boolean: the string "false" must not read as active.
            if (typeof update.isActive !== 'boolean') {
                throw new AppError(
                    `isActive must be a boolean for experiment ${update.id}.`,
                    400,
                    'INVALID_EXPERIMENT_ID',
                );
            }
            const filter: any = { _id: update.id };
            if (ownerId) filter.ownerId = ownerId;
            return {
                updateOne: {
                    filter,
                    update: { $set: { isActive: update.isActive } },
                },
            };
        });
        const response = await ExperimentsModel.bulkWrite(bulkOperations);

        return response;
    };

    async getActiveAgent(experimentId: string): Promise<IAgent | null> {
        const experiment = await this.getExperiment(experimentId);

        if (!experiment) {
            return null;
        }

        // Group mode has no single agent (see getGroupAgents), and abAgents is undefined there.
        if (experiment.agentsMode === AgentsMode.GROUP) {
            return null;
        }

        let agentId;
        if (experiment.agentsMode === AgentsMode.SINGLE) {
            agentId = experiment.activeAgent;
        } else {
            const rand = Math.random() * 100;
            if (experiment.abAgents.distA >= rand) {
                agentId = experiment.abAgents.agentA;
            } else {
                agentId = experiment.abAgents.agentB;
            }
        }

        const agent = await agentsService.getAgent(agentId);
        return agent;
    }

    // groupAgents ids to agent docs, in order.
    async getGroupAgents(experimentId: string): Promise<IAgent[]> {
        const experiment = await this.getExperiment(experimentId);

        if (!experiment?.groupAgents?.length) {
            return [];
        }

        const agents = await Promise.all(experiment.groupAgents.map((agentId) => agentsService.getAgent(agentId)));
        return agents.filter(Boolean);
    }

    async getExperimentBoundries(
        experimentId: string,
    ): Promise<{ maxMessages: number; maxConversations: number; maxParticipants: number } | null> {
        if (!mongoose.Types.ObjectId.isValid(experimentId)) {
            return null;
        }
        const result = await ExperimentsModel.findById(
            experimentId,
            { maxMessages: 1, maxConversations: 1, maxParticipants: 1 },
        ).lean();
        return result;
    }

    async getExperimentFeatures(experimentId: string): Promise<ExperimentFeatures | null> {
        if (!mongoose.Types.ObjectId.isValid(experimentId)) {
            return null;
        }
        const result: { experimentFeatures: ExperimentFeatures } | null = await ExperimentsModel.findById(
            experimentId,
            { experimentFeatures: 1 },
        ).lean();
        return result?.experimentFeatures ?? null;
    }

    async getAllExperimentsByAgentId(agentId: string, ownerId?: string): Promise<IExperimentLean[]> {
        const filter: any = {
            $or: [
                { activeAgent: agentId },
                { 'abAgents.agentA': agentId },
                { 'abAgents.agentB': agentId },
                { groupAgents: agentId },
            ],
        };
        if (ownerId) filter.ownerId = ownerId;
        const result = await ExperimentsModel.find(filter, { _id: 1, title: 1 });
        return result;
    }

    // Experiment count per agent id across single, A/B and group fields; an agent used twice
    // in one experiment counts once. No ownerId = global.
    async getAgentReferenceCounts(ownerId?: string): Promise<Record<string, number>> {
        const match: any = {};
        if (ownerId) match.ownerId = ownerId;
        const rows = await ExperimentsModel.aggregate([
            { $match: match },
            {
                $project: {
                    agentIds: {
                        $filter: {
                            input: {
                                $setUnion: [
                                    { $cond: [{ $ifNull: ['$activeAgent', false] }, ['$activeAgent'], []] },
                                    { $cond: [{ $ifNull: ['$abAgents.agentA', false] }, ['$abAgents.agentA'], []] },
                                    { $cond: [{ $ifNull: ['$abAgents.agentB', false] }, ['$abAgents.agentB'], []] },
                                    { $ifNull: ['$groupAgents', []] },
                                ],
                            },
                            as: 'id',
                            cond: { $and: [{ $ne: ['$$id', null] }, { $ne: ['$$id', ''] }] },
                        },
                    },
                },
            },
            { $unwind: '$agentIds' },
            { $group: { _id: '$agentIds', count: { $sum: 1 } } },
        ]);
        return Object.fromEntries(rows.map((r) => [String(r._id), r.count as number]));
    }

    // Owner's experiments using each agent, counting only fields the current mode reads.
    async getExperimentsUsingAgents(
        ownerId: string,
        agentIds: string[],
    ): Promise<Map<string, { _id: string; title: string; isActive: boolean }[]>> {
        const wanted = new Set(agentIds.map(String));
        const byAgent = new Map<string, { _id: string; title: string; isActive: boolean }[]>();
        if (!wanted.size) return byAgent;
        const experiments = await ExperimentsModel.find(
            { ownerId },
            { title: 1, isActive: 1, agentsMode: 1, activeAgent: 1, abAgents: 1, groupAgents: 1 },
        ).lean();
        for (const experiment of experiments) {
            for (const agentId of this.referencedAgentIds(experiment)) {
                if (!wanted.has(agentId)) continue;
                const list = byAgent.get(agentId) ?? [];
                list.push({ _id: String(experiment._id), title: experiment.title, isActive: Boolean(experiment.isActive) });
                byAgent.set(agentId, list);
            }
        }
        return byAgent;
    }

    async deleteExperiment(experimentId: string, ownerId?: string): Promise<void> {
        const filter: any = { _id: experimentId };
        if (ownerId) filter.ownerId = ownerId;
        await ExperimentsModel.deleteOne(filter);
    }
}

export const experimentsService = new ExperimentsService();
