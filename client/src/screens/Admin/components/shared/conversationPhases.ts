// Whether the "Conversation phases" checkbox opens ticked. Derived from content, not stored.
// Hidden means off: anything that still changes a study must tick the box so it stays visible.
import { AgentType, PhaseScheduleConfig, TurnTakingConfig } from '@models/AppModels';

// Counts only with at least one boundary. No roster: this runs before the roster loads, and
// lists for agents not in it are still authored content.
export const hasPhaseScheduleContent = (schedule?: PhaseScheduleConfig | null): boolean => {
    if (!schedule) return false;
    if (schedule.mode === 'perAgent') {
        const perAgent = schedule.perAgent || {};
        return Object.keys(perAgent).some((agentId) => (perAgent[agentId] || []).length > 0);
    }
    return (schedule.boundaries || []).length > 0;
};

// Group-drift settings share the experiment's checkbox. An absent switch is off; a
// whitespace-only Scene is blank to the server too.
export const hasGroupDriftContent = (turnTaking?: Partial<TurnTakingConfig> | null): boolean => {
    if (!turnTaking) return false;
    if ((turnTaking.scene || '').trim() !== '') return true;
    if (turnTaking.threadControl?.enabled === true) return true;
    return turnTaking.memoryWindow === true;
};

// Not qualified by agents mode: a study switched away from group still carries its turnTaking.
export const experimentUsesConversationPhases = (values?: {
    phaseSchedule?: PhaseScheduleConfig | null;
    turnTaking?: Partial<TurnTakingConfig> | null;
}): boolean =>
    hasPhaseScheduleContent(values?.phaseSchedule) || hasGroupDriftContent(values?.turnTaking);

// Phase prompts plus knowledge templates. Blank templates don't count: they are dropped on save.
export const agentUsesConversationPhases = (agent?: Partial<AgentType> | null): boolean => {
    if (!agent) return false;
    if ((agent.phases || []).length > 0) return true;
    return (agent.knowledgeTemplates || []).some((template) => (template || '').trim() !== '');
};
