import { AgentType, NewUserInfoType, UserResourcesType, UserType } from '@models/AppModels';
import { ApiPaths } from '../constants';
import axiosInstance from './AxiosInstance';

export const getActiveUser = async (): Promise<UserType> => {
    try {
        const response = await axiosInstance.get(`/${ApiPaths.USERS_PATH}/user`);
        return response.data;
    } catch (error) {
        throw error;
    }
};

export const registerUser = async (userInfo: NewUserInfoType, experimentId: string): Promise<UserType> => {
    try {
        const response = await axiosInstance.post(`/${ApiPaths.USERS_PATH}/create`, { userInfo, experimentId });
        return response.data;
    } catch (error) {
        throw error;
    }
};

export const login = async (
    username: string,
    userPassword: string,
    experimentId: string,
): Promise<{ token: string; user: UserType }> => {
    try {
        const response = await axiosInstance.post(`/${ApiPaths.USERS_PATH}/login`, {
            username,
            userPassword,
            experimentId,
        });
        return response.data;
    } catch (error) {
        throw error;
    }
};

export const logout = async (): Promise<void> => {
    try {
        await axiosInstance.post(`/${ApiPaths.USERS_PATH}/logout`);
        return;
    } catch (error) {
        throw error;
    }
};

export const validateUserName = async (username: string, experimentId: string): Promise<boolean> => {
    try {
        const response = await axiosInstance.get(
            `/${ApiPaths.USERS_PATH}/validate?username=${username}&experimentId=${experimentId}`,
        );
        return response.data;
    } catch (error) {
        throw error;
    }
};

export const updateUsersAgent = async (agent: AgentType): Promise<void> => {
    try {
        const response = await axiosInstance.put(`/${ApiPaths.USERS_PATH}/agent`, { agent });
        return response.data;
    } catch (error) {
        throw error;
    }
};

export const createResearcherUser = async (username: string, password: string): Promise<UserType> => {
    try {
        const response = await axiosInstance.post(`/${ApiPaths.USERS_PATH}/create-researcher`, {
            username,
            password,
        });
        return response.data;
    } catch (error) {
        throw error;
    }
};

export const getResearcherUsers = async (): Promise<UserType[]> => {
    try {
        const response = await axiosInstance.get(`/${ApiPaths.USERS_PATH}/researchers`);
        return response.data;
    } catch (error) {
        throw error;
    }
};

export const deleteResearcherUser = async (userId: string): Promise<void> => {
    try {
        await axiosInstance.delete(`/${ApiPaths.USERS_PATH}/researcher/${userId}`);
    } catch (error) {
        throw error;
    }
};

// Empty = unrestricted. Also applies when an admin edits this account's agents.
export const updateResearcherLimits = async (userId: string, allowedModels: string[]): Promise<UserType> => {
    const response = await axiosInstance.patch(
        `/${ApiPaths.USERS_PATH}/researcher/${userId}/limits`,
        { allowedModels },
    );
    return response.data;
};

// Errors are 403 (PASSWORD_LOCKED, WRONG_CURRENT_PASSWORD), not 401, so the interceptor doesn't log out.
export const changeOwnPassword = async (currentPassword: string, newPassword: string): Promise<void> => {
    await axiosInstance.patch(`/${ApiPaths.USERS_PATH}/me/password`, { currentPassword, newPassword });
};

// Admin only. Either field may be omitted.
export const setResearcherPassword = async (
    userId: string,
    changes: { newPassword?: string; passwordLocked?: boolean },
): Promise<UserType> => {
    const response = await axiosInstance.patch(`/${ApiPaths.USERS_PATH}/researcher/${userId}/password`, changes);
    return response.data;
};

export const getResearcherResources = async (userId: string): Promise<UserResourcesType> => {
    try {
        const response = await axiosInstance.get(`/${ApiPaths.USERS_PATH}/researcher/${userId}/resources`);
        return response.data;
    } catch (error) {
        throw error;
    }
};
