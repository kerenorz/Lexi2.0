import { AgentLeanType, AgentType, CatalogueModel, RemovedModelAgent } from '@models/AppModels';
import { ApiPaths } from '../constants';
import axiosInstance from './AxiosInstance';

// Server-owned model list. Returns `{ models }`, not a bare array like other /agents routes.
// Array order is render order.
export const getModelCatalogue = async (): Promise<CatalogueModel[]> => {
    const response = await axiosInstance.get(`/${ApiPaths.AGENTS_PATH}/models`);
    return response.data?.models ?? [];
};

// Caller's in-use agents on removed models, for the post-login alert.
export const getRemovedModelAgents = async (): Promise<RemovedModelAgent[]> => {
    const response = await axiosInstance.get(`/${ApiPaths.AGENTS_PATH}/removed-models`);
    return response.data?.items ?? [];
};

export const saveAgent = async (agent: AgentType, isActiveAgent = false): Promise<AgentType> => {
    try {
        const response = await axiosInstance.post(`/${ApiPaths.AGENTS_PATH}`, { agent, isActiveAgent });
        return response.data;
    } catch (error) {
        throw error;
    }
};

export const updateAgent = async (agent: AgentType): Promise<void> => {
    try {
        await axiosInstance.put(`/${ApiPaths.AGENTS_PATH}`, { agent });
        return;
    } catch (error) {
        throw error;
    }
};

export const getAgents = async (): Promise<AgentType[]> => {
    try {
        const response = await axiosInstance.get(`/${ApiPaths.AGENTS_PATH}`);
        return response.data;
    } catch (error) {
        throw error;
    }
};

export const getAgentLean = async (agentId: string): Promise<AgentLeanType> => {
    try {
        const response = await axiosInstance.get(`/${ApiPaths.AGENTS_PATH}/${agentId}`);
        return response.data;
    } catch (error) {
        throw error;
    }
};

// Without `force` the server returns 409 with the experiments that use this agent.
export const deleteAgent = async (agentId: string, force = false): Promise<void> => {
    try {
        await axiosInstance.delete(`/${ApiPaths.AGENTS_PATH}/${agentId}${force ? '?force=true' : ''}`);
        return;
    } catch (error) {
        throw error;
    }
};

export const downloadSample = async () => {
    try {
        const response = await axiosInstance.get(`/${ApiPaths.AGENTS_PATH}/download-sample`, {
            responseType: 'blob',
        });

        const url = window.URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', 'sample_rule_sheet.xlsx');
        document.body.appendChild(link);
        link.click();
        link.remove();
    } catch (error) {
        throw error;
    }
};

export const uploadRuleSheet = async (file: File) => {
    try {
        const formData = new FormData();
        formData.append('file', file);

        await axiosInstance.post(`/${ApiPaths.AGENTS_PATH}/upload-rulesheet`, formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
            },
        });
    } catch (error) {
        throw error;
    }
};
