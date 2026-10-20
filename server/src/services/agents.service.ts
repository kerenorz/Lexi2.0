import { UpdateWriteOpResult } from 'mongoose';
import { IAgent, IAgentLean } from '../types';
import { AgentsModel } from '../models/AgentsModel';
import { SERVER_OWNED_FIELDS, stripServerOwned } from '../utils/serverOwnedFields';

class AgentsService {
    saveAgent = async (settings: IAgent, ownerId: string): Promise<IAgent> => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { _id, ...settingsWithNoId } = settings;
        const response = await AgentsModel.create({ ...settingsWithNoId, ownerId });
        const agent: IAgent = response.toObject();
        return agent;
    };

    getAllAgents = async (ownerId?: string): Promise<IAgent[]> => {
        const filter = ownerId ? { ownerId } : {};
        // lean() so the controller can spread and enrich the result.
        const agents = await AgentsModel.find(filter).lean<IAgent[]>();
        return agents;
    };

    // Agents still saved on a model that is no longer in the catalogue.
    getAgentsOffCatalogue = async (ownerId: string, listedModelIds: string[]): Promise<IAgent[]> => {
        return AgentsModel.find({ ownerId, model: { $nin: listedModelIds } }, { title: 1, model: 1 }).lean<IAgent[]>();
    };

    getAgent = async (agentId: string, ownerId?: string): Promise<IAgent> => {
        const filter: any = { _id: agentId };
        if (ownerId) filter.ownerId = ownerId;
        const agent: IAgent = await AgentsModel.findOne(filter);
        return agent;
    };

    getAgentLean = async (agentId: string): Promise<IAgentLean> => {
        const agent: IAgentLean = await AgentsModel.findOne({ _id: agentId }, { _id: 1, title: 1 });
        return agent;
    };

    updateAgents = async (agent: IAgent, ownerId?: string): Promise<UpdateWriteOpResult> => {
        const filter: any = { _id: agent._id };
        if (ownerId) filter.ownerId = ownerId;
        // Strip server-owned fields: a client body could otherwise set ownerId and orphan the agent.
        const update = stripServerOwned(agent, SERVER_OWNED_FIELDS.agent);
        const response: UpdateWriteOpResult = await AgentsModel.updateOne(filter, { $set: update });
        return response;
    };

    deleteAgent = async (agentId: string, ownerId?: string): Promise<void> => {
        const filter: any = { _id: agentId };
        if (ownerId) filter.ownerId = ownerId;
        await AgentsModel.deleteOne(filter);
    };
}

export const agentsService = new AgentsService();
