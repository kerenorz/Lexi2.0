import ExcelJS from 'exceljs';
import { conversationsService } from './conversations.service';
import { experimentsService } from './experiments.service';
import { usersService } from './users.service';
import { AgentsMode } from '../types';
import { lastSegmentNumber, segmentForMessage } from './segments.service';
import { resolveScene, resolveThreadControl } from './threadControl.service';
import { nameMentionTest } from '../utils/nameMention';
import { response } from 'express';

const mainSheetCol = [
    { header: 'Agents Mode', key: 'agentsMode' },
    { header: 'Total Number of Participants', key: 'totalParticipants' },
];

// A factory: phase columns are pushed per export, and a shared array would accumulate them.
const getAgentsSheetCol = () => [
    { header: 'Number of Participants', key: 'numParticipants' },
    { header: 'Condition Title', key: 'conditionTitle' },
    { header: 'Summary', key: 'summary' },
    { header: 'System Starter Prompt', key: 'systemStarterPrompt' },
    { header: 'Before User Sentence Prompt', key: 'beforeUserSentencePrompt' },
    { header: 'After User Sentence Prompt', key: 'afterUserSentencePrompt' },
    { header: 'Inverse time delay', key: 'inverseTimeDelay' },
    { header: 'First Chat Sentence', key: 'firstChatSentence' },
    { header: 'Model', key: 'model' },
    { header: 'Temperature', key: 'temperature' },
    { header: 'Max Tokens', key: 'maxTokens' },
    { header: 'Top P', key: 'topP' },
    { header: 'Frequency Penalty', key: 'frequencyPenalty' },
    { header: 'Presence Penalty', key: 'presencePenalty' },
    { header: 'Camera Capture Rate', key: 'cameraCaptureRate'},
    { header: 'Audio Input', key: 'audioInput'},
    { header: 'Valence-Arousal Integration', key: 'vaIntegration'},
    { header: 'Stop Sequences', key: 'stopSequences' },
    // Per-phase prompt columns are appended later by pushAgentPhaseColumns.
];

const getUserStaticFields = () => {
    return new Set([
        '_id',
        'timestamp',
        'username',
        'numberOfConversations',
        'age',
        'gender',
        'createdAt',
        'agent',
        'role',
        'password',
        'agent',
        'experimentId',
    ]);
};

const getConversationColFields = () => {
    return new Set([
        'agent',
        'username',
        'conversationNumber',
        'messagesNumber',
        'createdAt',
        'lastMessageDate',
        'isFinished',
        'id',
        '_id',
    ]);
};

const getUserColFields = () => {
    return new Set([
        '_id',
        'id',
        'timestamp',
        'username',
        'numberOfConversations',
        'age',
        'gender',
        'createdAt',
        'role',
        'password',
        'agent',
        'experimentId',
    ]);
};

const getUsersSheetCol = () => [
    { header: 'Agent', key: 'agent' },
    { header: 'Username', key: 'username' },
    { header: 'Number of Conversations', key: 'numberOfConversations' },
    { header: 'Age', key: 'age' },
    { header: 'Gender', key: 'gender' },
    { header: 'Created At', key: 'createdAt' },
];

const getConversationsSheetCol = () => [
    { header: 'Conversation ID', key: 'id' },
    { header: 'Agent', key: 'agent' },
    { header: 'User', key: 'username' },
    { header: 'Conversation Number', key: 'conversationNumber' },
    { header: 'Number Of Messages', key: 'messagesNumber' },
    { header: 'Created At', key: 'createdAt' },
    { header: 'Last Message Date', key: 'lastMessageDate' },
    { header: 'Finished', key: 'isFinished' },
    // Pacing and later columns are appended after the pre_/post_ survey columns.
];

const messagesSheetCol = [
    { header: 'Conversation ID', key: 'conversationId' },
    { header: 'Message ID', key: 'messageId' },
    { header: 'Agent', key: 'agent' },
    { header: 'User', key: 'username' },
    { header: 'Number of User Conversation', key: 'conversationNumber' },
    { header: 'Message Number', key: 'messageNumber' },
    { header: 'Role', key: 'role' },
    { header: 'User Annotation', key: 'userAnnotation' },
    { header: 'Content', key: 'content' },
    { header: 'Valence', key: 'valence' },
    { header: 'Arousal', key: 'arousal' },
    { header: 'Pitch', key: 'pit'},
    {header: 'Loudness', key: 'loud'},
    {header: 'SNR', key: 'snr'},
    { header: 'Created At', key: 'createdAt' },
    // Columns are only ever appended, so positional parsers don't shift.
    { header: 'Speaker', key: 'speaker' },
    { header: 'Pre-Typing Delay (ms)', key: 'preTypingDelayMs' },
    { header: 'Typing Duration (ms)', key: 'typingDurationMs' },
    { header: 'Inter-Segment Pause (ms)', key: 'interSegmentPauseMs' },
    // Stored as epoch ms; written as a Date so Excel doesn't show 1.75e12.
    { header: 'Displayed At', key: 'displayedAt', style: { numFmt: 'yyyy-mm-dd hh:mm:ss.000' } },
    { header: 'Segment Group ID', key: 'segmentGroupId' },
    { header: 'Segment Index', key: 'segmentIndex' },
    { header: 'Segment Count', key: 'segmentCount' },
    // 1-based: stored phaseIndex 0 is phase 1. Blank when the conversation has no phases.
    { header: 'Phase', key: 'phase' },
    { header: 'Phase Label', key: 'phaseLabel' },
    // Thread-control move. Blank on 'continue' turns and when the feature is off.
    { header: 'Move', key: 'move' },
];

// Single-agent rows have no speaker fields, so fall back to the agent title or the role.
export const messageSpeaker = (message: any, agentTitle: string): string =>
    message.speakerName || message.speakerId || (message.role === 'assistant' ? agentTitle : message.role);

// Group: "Group: name1, name2" from the roster, not the agents[0] placeholder.
export const conversationAgentLabel = (
    agentsMode: string,
    conditionTitle: string,
    groupRoster: any[] | undefined,
): string =>
    agentsMode === AgentsMode.GROUP && groupRoster?.length
        ? `Group: ${groupRoster.map((a) => a?.displayName || a?.title).filter(Boolean).join(', ')}`
        : conditionTitle;

// Phase indexing: stored phaseIndex 0 is phase 1 (the base prompts), and phases[0] describes
// phase 2. Every exported cell is 1-based.
const phaseNumber = (phaseIndex: number): number => phaseIndex + 1;

// "Phase 2 (Cooling)", or "Phase 2" when unlabelled.
const phaseTitle = (phaseIndex: number, label?: string | null): string => {
    const trimmed = typeof label === 'string' ? label.trim() : '';
    return `Phase ${phaseNumber(phaseIndex)}${trimmed ? ` (${trimmed})` : ''}`;
};

// A phase starts when any threshold is met, hence "or". With no trigger it can never start.
const phaseTriggerText = (phase: any): string => {
    const parts: string[] = [];
    if (typeof phase?.startAfterSeconds === 'number') parts.push(`${phase.startAfterSeconds}s elapsed`);
    // Segmented studies leave time and turns blank, so this must be listed too.
    if (typeof phase?.startAtSegment === 'number') parts.push(`chat block ${phase.startAtSegment}`);
    if (typeof phase?.startAfterUserMessages === 'number') {
        parts.push(`${phase.startAfterUserMessages} user messages`);
    }
    return parts.length ? `starts after ${parts.join(' or ')}` : 'no trigger — can never start';
};

// The agent snapshot frozen at creation: the only reliable record of what the conversation ran,
// since the live documents stay editable. getUserConversations projects the 1-1 snapshot away,
// so 1-1 conversations get a blank Phase Schedule (Phase History still covers them).
const snapshotAgents = (metadata: any): any[] => {
    const roster = Array.isArray(metadata?.agents) && metadata.agents.length ? metadata.agents : [metadata?.agent];
    return roster.filter(Boolean);
};

// Highest reachable phase index, for column discovery (metadata only). 0 = unphased.
const conversationMaxPhaseIndex = (metadata: any): number => {
    let max = 0;
    for (const agent of snapshotAgents(metadata)) {
        // N authored changes reach storage index N.
        if (Array.isArray(agent?.phases)) max = Math.max(max, agent.phases.length);
    }
    const history = Array.isArray(metadata?.phaseHistory) ? metadata.phaseHistory : [];
    for (const entry of history) {
        if (typeof entry?.phaseIndex === 'number') max = Math.max(max, entry.phaseIndex);
    }
    return max;
};

// One line per phase. A single block when all agents share the timeline, else one per agent.
export const renderPhaseSchedule = (agents: any[]): string => {
    const blocks = agents.map((agent) => ({
        name: agent?.displayName || agent?.title || '',
        text:
            Array.isArray(agent?.phases) && agent.phases.length
                ? agent.phases
                      // phases[0] is phase 2.
                      .map((phase: any, i: number) => `${phaseTitle(i + 1, phase?.label)}: ${phaseTriggerText(phase)}`)
                      .join('\n')
                : '',
    }));
    if (!blocks.some((block) => block.text)) return '';
    if (new Set(blocks.map((block) => block.text)).size === 1) return blocks[0].text;
    return blocks
        .map((block) => `${block.name}:\n${block.text || 'no phases — stays in phase 1 throughout'}`)
        .join('\n\n');
};

const elapsedMmSs = (ms: number): string => {
    const total = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

// One line per phase entered (phase 1 never appears). Elapsed counts from the first round,
// not createdAt, so time on the pre-conversation form isn't charged to phase 1.
export const renderPhaseHistory = (metadata: any): string => {
    const history = Array.isArray(metadata?.phaseHistory) ? metadata.phaseHistory : [];
    if (!history.length) return '';

    const names = new Map<string, string>();
    for (const agent of snapshotAgents(metadata)) {
        names.set(String(agent?._id), agent?.displayName || agent?.title || '');
    }
    // Name the agent only when agents' histories diverged.
    const perAgent = new Set(history.map((entry: any) => String(entry?.agentId))).size > 1;
    // Prefer chatClockFirstStartedAt: phaseClockStartedAt is re-stamped per chat block and
    // cleared after the last one, so in segmented studies it is not the origin.
    const startedAt =
        typeof metadata?.chatClockFirstStartedAt === 'number'
            ? metadata.chatClockFirstStartedAt
            : typeof metadata?.phaseClockStartedAt === 'number'
            ? metadata.phaseClockStartedAt
            : null;

    return history
        .map((entry: any) => {
            const index = typeof entry?.phaseIndex === 'number' ? entry.phaseIndex : 0;
            const who = perAgent ? `${names.get(String(entry?.agentId)) || entry?.agentId}: ` : '';
            // Label both clocks when a chat clock exists: it excludes time spent in the survey.
            const wall =
                startedAt != null && typeof entry?.at === 'number' ? elapsedMmSs(entry.at - startedAt) : null;
            const chat = typeof entry?.atChatElapsedMs === 'number' ? elapsedMmSs(entry.atChatElapsedMs) : null;
            const elapsed =
                chat != null && wall != null
                    ? `, ${chat} chat / ${wall} wall`
                    : wall != null
                    ? `, ${wall} elapsed`
                    : '';
            const block = typeof entry?.atSegment === 'number' ? `, block ${entry.atSegment}` : '';
            // Phases strictly between skippedFrom and this entry were never experienced.
            const skipped =
                typeof entry?.skippedFrom === 'number' && entry.skippedFrom + 1 <= index - 1
                    ? ` [skipped phase(s) ${phaseNumber(entry.skippedFrom + 1)}-${phaseNumber(index - 1)}]`
                    : '';
            return (
                `${who}${phaseTitle(index, entry?.phaseLabel)} at message ${entry?.atMessageNumber}` +
                `${block}${elapsed}, trigger=${entry?.trigger ?? 'unknown'}${skipped}`
            );
        })
        .join('\n');
};

// One line per chat block of a survey-embedded study, plus the time spent in the survey
// before the next block (recorded nowhere else).
export const renderSegmentHistory = (metadata: any): string => {
    const segments = Array.isArray(metadata?.segments) ? metadata.segments : [];
    if (!segments.length) return '';

    const ordered = [...segments].sort((a: any, b: any) => (a?.number ?? 0) - (b?.number ?? 0));
    return ordered
        .map((s: any, i: number) => {
            // Newer records carry transcript positions, older ones round counts. Both ends of a
            // line always use the same unit.
            const positioned = typeof s?.openedAtTranscriptPosition === 'number';
            const from = positioned ? s.openedAtTranscriptPosition : s?.openedAtMessageNumber;
            const to = positioned ? s?.closedAtTranscriptPosition : s?.closedAtMessageNumber;
            const open = `messages ${from ?? '?'}`;
            const closed = s?.closedAt != null ? `-${to ?? '?'}` : '-open';
            const duration =
                s?.closedAt != null && typeof s?.openedAt === 'number'
                    ? `, ${elapsedMmSs(s.closedAt - s.openedAt)}`
                    : '';
            const why = s?.closedBy ? `, closed by ${s.closedBy}` : '';
            const next = ordered[i + 1];
            const gap =
                s?.closedAt != null && typeof next?.openedAt === 'number'
                    ? `, then ${elapsedMmSs(next.openedAt - s.closedAt)} in the survey`
                    : '';
            const skipped = typeof s?.skippedFrom === 'number' ? ` [branched past block(s) ${s.skippedFrom + 1}-${s.number - 1}]` : '';
            return `Block ${s?.number}: ${open}${closed}${duration}${why}${gap}${skipped}`;
        })
        .join('\n');
};

// Manipulation check: the share of agent turns that name the participant. Uses the same
// name-mention rule the runtime uses to hand over the floor, so the export matches the
// transcript. Mention-only, so read it as a directedness proxy.
export const participantMentionTest = nameMentionTest;

interface AgentTurn {
    phaseIndex: number;
    phaseLabel: string;
    // The message carried a phase index (a stored 0 means a phased conversation in phase 1).
    phaseStamped: boolean;
    content: string;
    // Of the turn's first message; block boundaries only fall between turns.
    messageNumber: number;
}

// Agent messages coalesced into turns: split messages sharing a segmentGroupId count once,
// so the share doesn't move when splitting is switched on.
const agentTurns = (messages: any[]): AgentTurn[] => {
    const turns: AgentTurn[] = [];
    const byGroup = new Map<string, AgentTurn>();
    for (const message of messages || []) {
        if (message?.role !== 'assistant') continue;
        const turn: AgentTurn = {
            phaseIndex: typeof message.phaseIndex === 'number' ? message.phaseIndex : 0,
            phaseLabel: typeof message.phaseLabel === 'string' ? message.phaseLabel : '',
            phaseStamped: typeof message.phaseIndex === 'number',
            content: message.content || '',
            messageNumber: typeof message.messageNumber === 'number' ? message.messageNumber : 0,
        };
        const group = message.segmentGroupId ? String(message.segmentGroupId) : '';
        if (!group) {
            turns.push(turn);
            continue;
        }
        const started = byGroup.get(group);
        if (started) {
            started.content += ` ${turn.content}`;
            continue;
        }
        byGroup.set(group, turn);
        turns.push(turn);
    }
    return turns;
};

export interface PhaseTally {
    total: number;
    addressed: number;
    label: string;
}

export interface ManipulationCheck {
    total: number;
    addressed: number;
    byPhase: Map<number, PhaseTally>;
    // Per chat block. Not derivable from byPhase: a block can hold several phases.
    bySegment: Map<number, { total: number; addressed: number }>;
    // Some turn carried a phase stamp, so the conversation is phased even if it stayed in
    // phase 1. A conversation with no agent turns can't tell.
    phaseStamped: boolean;
}

// Per-phase and (with `segments`) per-block tallies, computed in one pass so they agree.
export const manipulationCheck = (
    messages: any[],
    addresses: (text: string) => boolean,
    segments?: any[] | null,
): ManipulationCheck => {
    const result: ManipulationCheck = {
        total: 0,
        addressed: 0,
        byPhase: new Map(),
        bySegment: new Map(),
        phaseStamped: false,
    };
    for (const turn of agentTurns(messages)) {
        const hit = addresses(turn.content);
        result.total++;
        if (hit) result.addressed++;
        if (turn.phaseStamped) result.phaseStamped = true;
        const tally = result.byPhase.get(turn.phaseIndex) ?? { total: 0, addressed: 0, label: '' };
        tally.total++;
        if (hit) tally.addressed++;
        if (!tally.label && turn.phaseLabel) tally.label = turn.phaseLabel;
        result.byPhase.set(turn.phaseIndex, tally);

        if (segments?.length) {
            const block = segmentForMessage(segments as any, turn.messageNumber);
            if (block != null) {
                const bt = result.bySegment.get(block) ?? { total: 0, addressed: 0 };
                bt.total++;
                if (hit) bt.addressed++;
                result.bySegment.set(block, bt);
            }
        }
    }
    return result;
};

// A number like 14.3 so the column can be averaged. Empty (not 0%) when there were no turns,
// since 0% would read as total exclusion.
const sharePct = (addressed: number, total: number): number | undefined =>
    total > 0 ? Math.round((addressed / total) * 1000) / 10 : undefined;

// "Phase 1 (Warm): 33.3% (5/15)" per line. Raw counts so shares can be pooled.
const renderAddressedByPhase = (byPhase: Map<number, PhaseTally>): string =>
    [...byPhase.entries()]
        .sort(([a], [b]) => a - b)
        .map(
            ([index, tally]) =>
                `${phaseTitle(index, tally.label)}: ${sharePct(tally.addressed, tally.total)}% ` +
                `(${tally.addressed}/${tally.total})`,
        )
        .join('\n');

// "on (ground .20 / shift .15 / return .05 / close .08)", or "off". Read from the snapshot.
// The chances are printed because closeChance 0 and "never closed" look alike in a transcript.
const renderThreadControl = (turnTaking: any): string => {
    const cfg = turnTaking?.threadControl;
    if (cfg?.enabled !== true) return 'off';
    const resolved = resolveThreadControl(turnTaking);
    const two = (n: number) => n.toFixed(2).replace(/^0/, '');
    return (
        `on (ground ${two(resolved.ground)} / shift ${two(resolved.shift)} / ` +
        `return ${two(resolved.return)} / close ${two(resolved.close)})`
    );
};

// Per-phase prompt columns for the Agents sheet. Phase 1 is the base prompt columns.
const pushAgentPhaseColumns = (columns: { header: string; key: string }[], authoredPhases: number): void => {
    for (let i = 0; i < authoredPhases; i++) {
        const n = phaseNumber(i + 1); // phases[0] is phase 2
        columns.push(
            { header: `Phase ${n} Label`, key: `phase${n}Label` },
            { header: `Phase ${n} System Starter Prompt`, key: `phase${n}SystemStarterPrompt` },
            { header: `Phase ${n} Before User Sentence Prompt`, key: `phase${n}BeforeUserSentencePrompt` },
            { header: `Phase ${n} After User Sentence Prompt`, key: `phase${n}AfterUserSentencePrompt` },
        );
    }
};

// Authored phase text, as written. A blank cell means "inherit the previous phase".
const agentPhaseRowFields = (condition: any): Record<string, unknown> => {
    const fields: Record<string, unknown> = {};
    const phases = Array.isArray(condition?.phases) ? condition.phases : [];
    phases.forEach((phase: any, i: number) => {
        const n = phaseNumber(i + 1); // phases[0] is phase 2
        fields[`phase${n}Label`] = phase?.label;
        fields[`phase${n}SystemStarterPrompt`] = phase?.systemStarterPrompt;
        fields[`phase${n}BeforeUserSentencePrompt`] = phase?.beforeUserSentencePrompt;
        fields[`phase${n}AfterUserSentencePrompt`] = phase?.afterUserSentencePrompt;
    });
    return fields;
};

const expAISheetCol = [
    { header: 'Conversation ID', key: 'conversationId' },
    { header: 'user_input', key: 'user_input' },
    { header: 'prompt_input', key: 'prompt_input' },
    { header: 'response', key: 'response' },
    { header: 'Message Number', key: 'messageNumber' },
    { header: 'Role', key: 'role' },
    { header: 'Valence', key: 'valence' },
    { header: 'Arousal', key: 'arousal' },
    { header: 'Created At', key: 'createdAt' },
]

class DataAggregationService {
    getExperimentData = async (experimentId: string) => {
        const [experimentUsers, experiment] = await Promise.all([
            usersService.getExperimentUsers(experimentId),
            experimentsService.getExperiment(experimentId),
        ]);

        const agents = [];
        let totalUsers = 0;
        for (const users of experimentUsers) {
            totalUsers += users.data.length;
            const data = [];
            for (const user of users.data) {
                const { agent, ...userWithoutAgent } = user;
                //console.log(agent)
                const conversations = await conversationsService.getUserConversations(user._id, agent.cameraCaptureRate, agent.vaIntegration);
                //console.log(conversations[0])
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                data.push({
                    numberOfConversations: user.numberOfConversations,
                    user: userWithoutAgent,
                    conversations,
                });
            }

            agents.push({
                numberOfParticipants: users.data.length,
                condition: users.agent,
                data,
            });
        }

        const result: any = {
            agentsMode: experiment.agentsMode,
            numberOfParticipants: totalUsers,
            agents,
            // Declared chat-block count, the denominator for dropout.
            segments: (experiment as any)?.segments,
        };

        if (experiment.agentsMode === AgentsMode.GROUP) {
            result.groupAgents = await experimentsService.getGroupAgents(experimentId);
        }

        return result;
    };

    // The caller's pilot runs, in getExperimentData's shape. Kept out of the participant export
    // so test runs never count as participants. One synthetic group holding the caller.
    getPilotData = async (experimentId: string, ownerUserId: string) => {
        const [conversations, experiment] = await Promise.all([
            conversationsService.getPilotConversations(experimentId, ownerUserId),
            experimentsService.getExperiment(experimentId),
        ]);

        const condition = (conversations[0]?.metadata?.agents?.[0] ?? conversations[0]?.metadata?.agent) || {};
        const result: any = {
            agentsMode: experiment.agentsMode,
            numberOfParticipants: 0,
            isPilotExport: true,
            segments: (experiment as any)?.segments,
            agents: conversations.length
                ? [
                      {
                          numberOfParticipants: 0,
                          condition,
                          data: [
                              {
                                  numberOfConversations: conversations.length,
                                  user: { _id: ownerUserId, username: 'PILOT (not a participant)' },
                                  conversations,
                              },
                          ],
                      },
                  ]
                : [],
        };

        if (experiment.agentsMode === AgentsMode.GROUP) {
            result.groupAgents = await experimentsService.getGroupAgents(experimentId);
        }
        return result;
    };

    createPilotDataExcel = async (experimentId: string, ownerUserId: string) =>
        this.buildExperimentWorkbook(await this.getPilotData(experimentId, ownerUserId));

    createExperimentDataExcel = async (experimentId) =>
        this.buildExperimentWorkbook(await this.getExperimentData(experimentId));

    // Shared by the participant and pilot exports so their columns can't drift.
    private buildExperimentWorkbook = async (experimentData: any) => {
        const workbook = new ExcelJS.Workbook();

        const mainSheet = workbook.addWorksheet('Main');
        const agentsSheet = workbook.addWorksheet('Agents');
        const usersSheet = workbook.addWorksheet('Users');
        const conversationsSheet = workbook.addWorksheet('Conversations');
        const messagesSheet = workbook.addWorksheet('Messages');
        const expAISheet = workbook.addWorksheet('Explainable AI');
        const conversationsSheetCol = getConversationsSheetCol();
        const agentsSheetCol = getAgentsSheetCol();
        const usersSheetCol = getUsersSheetCol();
        const conversationColFields = getConversationColFields();
        const userStaticFields = getUserStaticFields();
        const userColFields = getUserColFields();

        // Agents listed for one agent-group. Shared by column discovery and the row loop.
        const agentsSheetConditions = (agent: any): any[] =>
            experimentData.agentsMode === AgentsMode.GROUP && experimentData.groupAgents?.length
                ? experimentData.groupAgents
                : [agent.condition];

        // Storage index; 0 means no phase columns at all.
        let maxPhaseIndex = 0;
        // Separate from maxPhaseIndex: phases without triggers are dropped from the snapshot
        // but their authored text should still be shown.
        let maxAuthoredPhases = 0;
        // 0 when nothing is segmented, which keeps the segment columns off.
        let maxSegmentNumber = 0;

        experimentData.agents.forEach((agent) => {
            agentsSheetConditions(agent).forEach((condition) => {
                if (Array.isArray(condition?.phases)) {
                    maxAuthoredPhases = Math.max(maxAuthoredPhases, condition.phases.length);
                }
            });
            agent.data.forEach((user) => {
                user.conversations.forEach((conversation) => {
                    maxPhaseIndex = Math.max(maxPhaseIndex, conversationMaxPhaseIndex(conversation.metadata));
                    maxSegmentNumber = Math.max(
                        maxSegmentNumber,
                        lastSegmentNumber(conversation.metadata?.segments),
                    );
                    Object.keys(user.user).forEach((field) => {
                        if (!userColFields.has(field)) {
                            userColFields.add(field);
                            usersSheetCol.push({ header: field, key: field });
                        }
                    });
                    if (conversation.metadata.preConversation) {
                        Object.keys(conversation.metadata.preConversation).forEach((key) => {
                            if (!conversationColFields.has(`pre_${key}`)) {
                                conversationColFields.add(`pre_${key}`);
                                conversationsSheetCol.push({ header: `pre_${key}`, key: `pre_${key}` });
                            }
                        });
                    }
                    if (conversation.metadata.postConversation) {
                        Object.keys(conversation.metadata.postConversation).forEach((key) => {
                            if (!conversationColFields.has(`post_${key}`)) {
                                conversationColFields.add(`post_${key}`);
                                conversationsSheetCol.push({ header: `post_${key}`, key: `post_${key}` });
                            }
                        });
                    }
                });
            });
        });

        // Every column group below is appended after the survey columns, in order, so no
        // existing column ever moves for positional parsers.
        conversationsSheetCol.push(
            { header: 'Seed', key: 'seed' },
            { header: 'Turn-Taking Policy', key: 'turnTakingPolicy' },
            { header: 'Reproducible', key: 'reproducible' },
        );

        // Unconditional: the manipulation check is meaningful for any conversation.
        conversationsSheetCol.push(
            { header: 'Phase Schedule', key: 'phaseSchedule' },
            { header: 'Phase History', key: 'phaseHistory' },
            { header: 'Final Phase', key: 'finalPhase' },
            { header: 'Agent Turns', key: 'agentTurns' },
            { header: 'Turns Addressing Participant', key: 'turnsAddressingParticipant' },
            { header: 'Addressed Participant %', key: 'addressedParticipantPct' },
        );
        // N changes need N+1 phase columns.
        if (maxPhaseIndex > 0) {
            conversationsSheetCol.push({ header: 'Addressed Participant by Phase', key: 'addressedByPhase' });
            for (let index = 0; index <= maxPhaseIndex; index++) {
                const n = phaseNumber(index);
                // Numeric per-phase column, so it can be averaged without parsing.
                conversationsSheetCol.push({ header: `Phase ${n} Addressed %`, key: `phase${n}AddressedPct` });
            }
        }

        // Segment columns, only when the export contains a segmented conversation.
        if (maxSegmentNumber > 0) {
            conversationsSheetCol.push(
                { header: 'External Participant ID', key: 'externalPid' },
                { header: 'Chat Blocks Declared', key: 'segmentsDeclared' },
                { header: 'Chat Blocks Completed', key: 'segmentsCompleted' },
                { header: 'Last Chat Block Reached', key: 'lastSegmentReached' },
                { header: 'Abandoned', key: 'abandoned' },
                { header: 'Chat Block History', key: 'segmentHistory' },
                { header: 'Survey Answers Received', key: 'surveyAnswerGaps' },
            );
            for (let n = 1; n <= maxSegmentNumber; n++) {
                conversationsSheetCol.push(
                    { header: `Block ${n} User Messages`, key: `segment${n}UserMessages` },
                    { header: `Block ${n} Chat Minutes`, key: `segment${n}ChatMinutes` },
                    { header: `Block ${n} Addressed %`, key: `segment${n}AddressedPct` },
                );
            }
        }

        // Belongs with Seed/Policy, but appended here so nothing shifts. Blank for 1-1.
        conversationsSheetCol.push(
            { header: 'Scene', key: 'scene' },
            { header: 'Thread Control', key: 'threadControl' },
            { header: 'Thread Closes', key: 'threadCloses' },
        );

        // Participant messages left unanswered because every reply came back empty. Separates
        // that malfunction from the exclusion manipulation, which looks the same.
        conversationsSheetCol.push({ header: 'Silent Rounds', key: 'silentRounds' });

        pushAgentPhaseColumns(agentsSheetCol, maxAuthoredPhases);

        mainSheet.columns = mainSheetCol;
        agentsSheet.columns = agentsSheetCol;
        usersSheet.columns = usersSheetCol;
        conversationsSheet.columns = conversationsSheetCol;
        messagesSheet.columns = messagesSheetCol;
        expAISheet.columns = expAISheetCol;

        mainSheet.addRow({
            agentsMode: experimentData.agentsMode,
            totalParticipants: experimentData.numberOfParticipants,
        });

        let userRowIndex = 1;
        let conversationRowIndex = 1;
        let agentRowIndex = 1;

        experimentData.agents.forEach((agent) => {
            const conditions = agentsSheetConditions(agent);
            conditions.forEach((condition) => {
                agentsSheet.addRow({
                    numParticipants: agent.numberOfParticipants,
                    conditionTitle: condition.title,
                    summary: condition.summary,
                    systemStarterPrompt: condition.systemStarterPrompt,
                    beforeUserSentencePrompt: condition.beforeUserSentencePrompt,
                    afterUserSentencePrompt: condition.afterUserSentencePrompt,
                    inverseTimeDelay: condition.inverseTimeDelay,
                    firstChatSentence: condition.firstChatSentence,
                    model: condition.model,
                    temperature: condition.temperature,
                    maxTokens: condition.maxTokens,
                    topP: condition.topP,
                    frequencyPenalty: condition.frequencyPenalty,
                    presencePenalty: condition.presencePenalty,
                    cameraCaptureRate: condition.cameraCaptureRate,
                    audioInput: condition.audioInput,
                    vaIntegration: condition.vaIntegration,
                    stopSequences: condition.stopSequences,
                    ...agentPhaseRowFields(condition),
                });
            });

            agent.data.forEach((user) => {
                const userRow = {
                    agent: {
                        text: agent.condition.title,
                        hyperlink: `#\'Agents\'!A${agentRowIndex + 1}`,
                    },
                    username: user.user.username,
                    numberOfConversations: user.numberOfConversations,
                    age: user.user.age,
                    gender: user.user.gender,
                    createdAt: user.user.createdAt,
                };

                Object.entries(user.user).forEach(([key, value]) => {
                    if (!userStaticFields.has(key)) {
                        userRow[key] = value;
                    }
                });

                usersSheet.addRow(userRow);
                // The username is the name agents were given for the participant.
                const addressesParticipant = participantMentionTest(user.user.username);
                user.conversations.forEach((conversation) => {
                    const groupRoster = conversation.metadata.agents ?? experimentData.groupAgents;
                    // The conversation's own snapshotted mode; the experiment's is editable.
                    const isGroupConv = conversation.metadata.mode === AgentsMode.GROUP;

                    const scheduleText = renderPhaseSchedule(snapshotAgents(conversation.metadata));
                    const historyText = renderPhaseHistory(conversation.metadata);
                    const addressing = manipulationCheck(
                        conversation.conversation,
                        addressesParticipant,
                        conversation.metadata?.segments,
                    );
                    // From both messages and history: a phase entered on the last round may
                    // have no agent turn.
                    const reachedPhaseIndex = Math.max(
                        0,
                        ...addressing.byPhase.keys(),
                        ...(Array.isArray(conversation.metadata.phaseHistory)
                            ? conversation.metadata.phaseHistory
                            : []
                        ).map((entry: any) => (typeof entry?.phaseIndex === 'number' ? entry.phaseIndex : 0)),
                    );
                    // Phased at all, even if it ended in phase 1 (assigned but not delivered).
                    // Three signals because each misses a case; scheduleText is blank for 1-1.
                    const isPhased = reachedPhaseIndex > 0 || !!scheduleText || addressing.phaseStamped;
                    // Unreached phases stay empty rather than 0%.
                    const perPhasePct: Record<string, number | undefined> = {};
                    if (maxPhaseIndex > 0) {
                        addressing.byPhase.forEach((tally, index) => {
                            perPhasePct[`phase${phaseNumber(index)}AddressedPct`] = sharePct(
                                tally.addressed,
                                tally.total,
                            );
                        });
                    }

                    const segmentRecords: any[] = Array.isArray(conversation.metadata?.segments)
                        ? conversation.metadata.segments
                        : [];
                    const perSegment: Record<string, number | string | undefined> = {};
                    if (segmentRecords.length) {
                        const userMessagesBefore = (n: number) => {
                            const rec = segmentRecords.find((s: any) => s?.number === n);
                            return typeof rec?.openedAtUserMessages === 'number' ? rec.openedAtUserMessages : 0;
                        };
                        const totalUserMessages = conversation.conversation.filter(
                            (m: any) => m.role === 'user',
                        ).length;

                        segmentRecords.forEach((s: any) => {
                            const n = s?.number;
                            if (!n) return;
                            const next = segmentRecords.find((o: any) => o?.number === n + 1);
                            const endUserMessages = next ? userMessagesBefore(n + 1) : totalUserMessages;
                            perSegment[`segment${n}UserMessages`] = Math.max(
                                0,
                                endUserMessages - userMessagesBefore(n),
                            );
                            if (typeof s?.openedAt === 'number' && typeof s?.closedAt === 'number') {
                                perSegment[`segment${n}ChatMinutes`] =
                                    Math.round(((s.closedAt - s.openedAt) / 60000) * 100) / 100;
                            }
                            const tally = addressing.bySegment.get(n);
                            if (tally) {
                                perSegment[`segment${n}AddressedPct`] = sharePct(tally.addressed, tally.total);
                            }
                        });
                    }

                    const conversationRow = {
                        id: conversation.metadata._id,
                        // Join key back to the host survey's export.
                        externalPid: user.user.externalPid ?? undefined,
                        segmentsDeclared: segmentRecords.length
                            ? experimentData?.segments?.count ?? undefined
                            : undefined,
                        segmentsCompleted: segmentRecords.length
                            ? segmentRecords.filter((s: any) => s?.closedAt != null).length
                            : undefined,
                        lastSegmentReached: segmentRecords.length ? lastSegmentNumber(segmentRecords) : undefined,
                        // isFinished is set only when the final block closes.
                        abandoned:
                            segmentRecords.length && !conversation.metadata.isFinished
                                ? 'Yes'
                                : segmentRecords.length
                                  ? 'No'
                                  : undefined,
                        segmentHistory: renderSegmentHistory(conversation.metadata) || undefined,
                        surveyAnswerGaps: conversation.metadata?.surveyAnswers
                            ? Object.keys(conversation.metadata.surveyAnswers).sort().join(', ')
                            : undefined,
                        ...perSegment,
                        agent:
                            experimentData.agentsMode === AgentsMode.GROUP
                                ? conversationAgentLabel(
                                      experimentData.agentsMode,
                                      agent.condition.title,
                                      groupRoster,
                                  )
                                : {
                                      text: agent.condition.title,
                                      hyperlink: `#\'Agents\'!A${agentRowIndex + 1}`,
                                  },
                        username: {
                            text: user.user.username,
                            hyperlink: `#\'Users\'!A${userRowIndex + 1}`,
                        },
                        conversationNumber: conversation.metadata.conversationNumber,
                        messagesNumber: conversation.metadata.messagesNumber,
                        createdAt: conversation.metadata.createdAt,
                        lastMessageDate: conversation.metadata.lastMessageDate,
                        isFinished: conversation.metadata.isFinished,
                        // Only group and humanized 1-1 conversations have a seed.
                        seed: conversation.metadata.seed ?? '',
                        // Same 'rules' default as the runtime.
                        turnTakingPolicy: isGroupConv ? (conversation.metadata.turnTaking?.policy ?? 'rules') : '',
                        // Seed first: an unseeded run can't be replayed whatever its policy. An llm
                        // moderator's speaker choice can't be replayed either.
                        reproducible: !isGroupConv
                            ? // 1-1: reproducible when seeded (humanized).
                              conversation.metadata.seed
                                ? 'Yes'
                                : ''
                            : !conversation.metadata.seed
                              ? 'No - pre-dates seeded pacing, ran unseeded'
                              : conversation.metadata.turnTaking?.policy === 'llm'
                                ? 'No - llm moderator picks the speaker'
                                : conversation.metadata.seedBackfilledAtMessage != null
                                  ? `Partial - seeded from message ${conversation.metadata.seedBackfilledAtMessage}; earlier rounds ran unseeded`
                                  : 'Yes',
                        // undefined, not '': exceljs writes a truly empty cell, which averages cleanly.
                        phaseSchedule: scheduleText || undefined,
                        phaseHistory: historyText || undefined,
                        finalPhase: isPhased ? phaseNumber(reachedPhaseIndex) : undefined,
                        // Counted in turns, not bubbles (see agentTurns).
                        agentTurns: addressing.total,
                        turnsAddressingParticipant: addressing.addressed,
                        addressedParticipantPct: sharePct(addressing.addressed, addressing.total),
                        addressedByPhase:
                            addressing.byPhase.size > 1 ? renderAddressedByPhase(addressing.byPhase) : undefined,
                        ...perPhasePct,
                        // Blank, not 'off', for 1-1: the feature is group-only.
                        scene: isGroupConv
                            ? resolveScene(conversation.metadata.turnTaking) ?? undefined
                            : undefined,
                        threadControl: isGroupConv
                            ? renderThreadControl(conversation.metadata.turnTaking)
                            : undefined,
                        // 0 is meaningful when the feature was on.
                        threadCloses:
                            isGroupConv && conversation.metadata.turnTaking?.threadControl?.enabled === true
                                ? (conversation.metadata.threadLog?.length ?? 0)
                                : undefined,
                        // 0 is a finding for groups. Blank for 1-1, where an empty reply offers Resend.
                        silentRounds: isGroupConv ? (conversation.metadata.silentRounds?.length ?? 0) : undefined,
                    };

                    if (conversation.metadata.preConversation) {
                        Object.entries(conversation.metadata.preConversation).forEach(([key, value]) => {
                            conversationRow[`pre_${key}`] = value;
                        });
                    }

                    if (conversation.metadata.postConversation) {
                        Object.entries(conversation.metadata.postConversation).forEach(([key, value]) => {
                            conversationRow[`post_${key}`] = value;
                        });
                    }

                    conversationsSheet.addRow(conversationRow);
                    //console.log(conversation.conversation.length);
                    //console.log(conversation.expAIData.length);
                    //let count = 0;
                    conversation.conversation.forEach((message) => {
                        messagesSheet.addRow({
                            conversationId: {
                                text: conversation.metadata._id,
                                hyperlink: `#\'Conversations\'!A${conversationRowIndex + 1}`,
                            },
                            messageId: message._id,
                            agent: {
                                text: agent.condition.title,
                                hyperlink: `#\'Agents\'!A${agentRowIndex + 1}`,
                            },
                            username: {
                                text: user.user.username,
                                hyperlink: `#\'Users\'!A${userRowIndex + 1}`,
                            },
                            conversationNumber: conversation.metadata.conversationNumber,
                            content: message.content,
                            valence: message.valence,
                            arousal: message.arousal,
                            pit: message.pit,
                            loud: message.loud,
                            snr: message.snr,
                            role: message.role,
                            createdAt: message.createdAt,
                            messageNumber: message.messageNumber,
                            userAnnotation: message.userAnnotation,
                            speaker: messageSpeaker(message, agent.condition.title),
                            preTypingDelayMs: message.preTypingDelayMs,
                            typingDurationMs: message.typingDurationMs,
                            interSegmentPauseMs: message.interSegmentPauseMs,
                            // undefined, not null, so unreported rows don't print 1970.
                            displayedAt: message.displayedAt != null ? new Date(message.displayedAt) : undefined,
                            segmentGroupId: message.segmentGroupId,
                            segmentIndex: message.segmentIndex,
                            segmentCount: message.segmentCount,
                            // `!= null`, not truthiness: index 0 is phase 1.
                            phase: message.phaseIndex != null ? phaseNumber(message.phaseIndex) : undefined,
                            phaseLabel: message.phaseLabel ?? undefined,
                            move: message.move ?? undefined,
                        });
                    });
                    console.log(agent.condition.cameraCaptureRate)
                    if ( agent.condition.cameraCaptureRate != null && agent.condition.vaIntegration != null ) {
                        conversation.expAIData.forEach((message) => {
                            expAISheet.addRow({
                                conversationId: {
                                    text: conversation.metadata._id,
                                    hyperlink: `#\'Conversations\'!A${conversationRowIndex + 1}`,
                                },
                                user_input: message.user_input,
                                prompt_input: message.prompt_input,
                                response: message.response,
                                valence: message.valence,
                                arousal: message.arousal,
                                role: message.role,
                                createdAt: message.createdAt,
                                messageNumber: message.messageNumber,
                            });
                        });
                    }

                    conversationRowIndex++;
                });

                userRowIndex++;
            });
            agentRowIndex++;
        });

        return workbook;
    };
}

export const dataAggregationService = new DataAggregationService();
