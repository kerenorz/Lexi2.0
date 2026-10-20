import { Request, Response } from 'express';
import { agentsService } from '../services/agents.service';
import { experimentsService } from '../services/experiments.service';
import { usersService } from '../services/users.service';
import { requestHandler } from '../utils/requestHandler';
import {
    MODEL_CATALOGUE,
    MODEL_IDS,
    REMOVED_FALLBACK_REASON,
    REMOVED_MODELS,
    isKnownModel,
} from '../constants/modelCatalogue';
import { ignoredSettings } from '../services/llmProviders.service';
import mongoose from 'mongoose';
import path from 'path';

const getOwnerId = (req: Request): string | undefined =>
    req.user?.role === 'admin' ? undefined : req.user?._id;

// Error message if the model is outside a non-empty allowedModels, else null.
const modelRestrictionError = (allowed: string[] | undefined, model: unknown): string | null => {
    if (!Array.isArray(allowed) || allowed.length === 0) return null;
    if (typeof model === 'string' && allowed.includes(model)) return null;
    return `Model "${String(model)}" is not permitted for this account. Allowed models: ${allowed.join(', ')}.`;
};

// The allow-list is the agent owner's, never the editor's, with no admin bypass. Otherwise
// an admin could move a researcher's agent to a model the researcher then cannot edit.
const allowedModelsFor = async (req: Request, ownerId?: string): Promise<string[] | undefined> => {
    if (!ownerId || String(ownerId) === String(req.user?._id)) return req.user?.limits?.allowedModels;
    if (!mongoose.Types.ObjectId.isValid(String(ownerId))) return undefined;
    const owner = await usersService.getUserById(String(ownerId));
    return owner?.limits?.allowedModels;
};

// Error message if the model is not in the catalogue, else null. Checked after
// modelRestrictionError, whose message is more useful when both fail.
const unknownModelError = (model: unknown): string | null =>
    isKnownModel(model)
        ? null
        : `Model "${String(model)}" is not in the model catalogue. Pick one of the offered models.`;

class AgentsController {
    // Unfiltered: the client greys out disallowed models rather than hiding them.
    // `ignoredSettings` lists form settings the model cannot apply (shown as "!").
    getModelCatalogue = requestHandler(async (_req: Request, res: Response) => {
        res.status(200).send({ models: MODEL_CATALOGUE.map((m) => ({ ...m, ignoredSettings: ignoredSettings(m.id) })) });
    });

    // Login alert: the caller's own agents on a removed model that some experiment uses.
    // Owner-scoped even for admins.
    getRemovedModelAgents = requestHandler(async (req: Request, res: Response) => {
        const ownerId = String(req.user._id);
        const agents = await agentsService.getAgentsOffCatalogue(ownerId, [...MODEL_IDS]);
        const usedBy = await experimentsService.getExperimentsUsingAgents(
            ownerId,
            agents.map((agent) => String(agent._id)),
        );
        const items = agents
            .filter((agent) => usedBy.has(String(agent._id)))
            .map((agent) => ({
                agentId: String(agent._id),
                agentTitle: agent.title,
                model: agent.model,
                removedOn: REMOVED_MODELS[agent.model]?.removedOn,
                reason: REMOVED_MODELS[agent.model]?.reason ?? REMOVED_FALLBACK_REASON,
                experiments: usedBy.get(String(agent._id)),
            }));
        res.status(200).send({ items });
    });

    getAgents = requestHandler(async (req: Request, res: Response) => {
        const ownerId = getOwnerId(req);
        const isAdmin = req.user?.role === 'admin';
        // referenceCount is scoped like the list: global for admins.
        const [agents, referenceCounts] = await Promise.all([
            agentsService.getAllAgents(ownerId),
            experimentsService.getAgentReferenceCounts(ownerId),
        ]);
        // Admin only: ownerAllowedModels lets the picker follow the owner's allowance.
        const ownerIds = [...new Set(agents.map((a) => a.ownerId).filter(Boolean) as string[])];
        const [usernameMap, allowedMap] = isAdmin
            ? await Promise.all([
                  usersService.getUsernamesByIds(ownerIds),
                  usersService.getAllowedModelsByIds(ownerIds),
              ])
            : [new Map<string, string>(), new Map<string, string[]>()];
        const enriched = agents.map((agent) => ({
            ...agent,
            referenceCount: referenceCounts[String(agent._id)] ?? 0,
            ...(isAdmin
                ? {
                      creatorUsername: agent.ownerId ? usernameMap.get(String(agent.ownerId)) : undefined,
                      ownerAllowedModels: agent.ownerId ? allowedMap.get(String(agent.ownerId)) : undefined,
                  }
                : {}),
        }));
        res.status(200).send(enriched);
    });

    getAgentLean = requestHandler(async (req: Request, res: Response) => {
        const agentId = req.params.id as string;
        const agent = await agentsService.getAgentLean(agentId);
        res.status(200).send(agent);
    });

    saveAgent = requestHandler(async (req: Request, res: Response) => {
        const { agent } = req.body;
        // The creator is the owner.
        const restriction = modelRestrictionError(await allowedModelsFor(req, req.user._id), agent?.model);
        if (restriction) {
            res.status(403).send({ message: restriction, reason: 'MODEL_NOT_ALLOWED' });
            return;
        }
        // Always enforced on create: nothing new on a retired model.
        const unknownModel = unknownModelError(agent?.model);
        if (unknownModel) {
            res.status(400).send({ message: unknownModel, reason: 'UNKNOWN_MODEL' });
            return;
        }
        const savedSetting = await agentsService.saveAgent(agent, req.user._id);
        res.status(200).send(savedSetting);
    });

    updateAgent = requestHandler(async (req: Request, res: Response) => {
        const { agent } = req.body;

        // Needed to find the owner, whose allow-list applies. Owner-scoped like the update,
        // so it cannot probe other owners' agents.
        const existing = agent?._id ? await agentsService.getAgent(String(agent._id), getOwnerId(req)) : null;
        const ownerId = existing?.ownerId ? String(existing.ownerId) : req.user._id;

        const restriction = modelRestrictionError(await allowedModelsFor(req, ownerId), agent?.model);
        if (restriction) {
            res.status(403).send({ message: restriction, reason: 'MODEL_NOT_ALLOWED' });
            return;
        }
        // Check the catalogue only when the model changed, so agents on a retired model
        // can still be edited.
        if (agent?.model !== undefined && existing?.model !== agent.model) {
            const unknownModel = unknownModelError(agent.model);
            if (unknownModel) {
                res.status(400).send({ message: unknownModel, reason: 'UNKNOWN_MODEL' });
                return;
            }
        }
        const response = await agentsService.updateAgents(agent, getOwnerId(req));
        res.status(200).send(response);
    });

    downloadSample = requestHandler(async (req: Request, res: Response) => {
        const filePath = path.join(__dirname, '../../sample_rule_sheet.xlsx');
        console.log(filePath)
        res.download(filePath, 'sample_rule_sheet.xlsx', (err) => {
            if (err) {
                res.status(500).send({
                    message: 'Error downloading the file',
                    error: err,
                });
            }
        });
    });

    uploadRuleSheet = requestHandler(async (req: Request, res: Response) => {
        const { agent } = req.body;
        const response = await agentsService.updateAgents(agent, getOwnerId(req));
        res.status(200).send(response);
    });

    // An agent still used by experiments returns 409 with those experiments unless
    // `?force=true`. Broken rosters are then flagged via `configIssue`.
    deleteAgent = requestHandler(async (req: Request, res: Response) => {
        const agentId = req.params.id as string;
        const ownerId = getOwnerId(req);
        const force = String(req.query.force) === 'true';
        const experiments = await experimentsService.getAllExperimentsByAgentId(agentId, ownerId);
        if (experiments.length && !force) {
            res.status(409).send(experiments);
            return;
        }
        await agentsService.deleteAgent(agentId, ownerId);
        res.status(200).send();
    });
}

export const agentsController = new AgentsController();
