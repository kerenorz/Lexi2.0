import { FieldError, FieldErrorsImpl } from 'react-hook-form';

export const formatDate = (date: Date): string => {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');

    return `${day}/${month}/${year} ${hour}:${minute}`;
};

export const getFormErrorMessage = (error: FieldError | FieldErrorsImpl<any> | undefined) =>
    error && typeof error.message === 'string' ? error.message : '';

export const isCamelCase = (str) => {
    const regex = /^[a-z][a-zA-Z0-9]*$/;
    return regex.test(str);
};

/**
 * Gets the full experiment URL using the current domain origin.
 * Works in both development (http://localhost:3000) and production (https://bgulexi.com).
 * @param experimentId - The experiment ID
 * @returns Full experiment URL (e.g., "https://bgulexi.com/e/123abc")
 */
export const getExperimentUrl = (experimentId: string): string => {
    return `${window.location.origin}/e/${experimentId}`;
};
