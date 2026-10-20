// Kept free of @mui so phaseScheduleConfig.ts can import it without React.

import { AgentType } from '@models/AppModels';

// The researcher's name for the agent (`title`), not the participant-facing `displayName`.
export const agentLabel = (agent: AgentType): string => (agent ? agent.title || agent.displayName || '' : '');
