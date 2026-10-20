import axios from 'axios';
import { getEmbeddedToken } from './embeddedSession';

// The only read of REACT_APP_API_URL; axios and the raw-fetch transports both use it.
// Defaults to '' (same-origin) when the build had no .env.production.
export const API_BASE_URL = (process.env.REACT_APP_API_URL || '').trim();

const axiosInstance = axios.create({
    baseURL: API_BASE_URL.length ? API_BASE_URL : '',
    withCredentials: true,
});

// Adds the embedded session token inside a survey iframe; a no-op elsewhere.
axiosInstance.interceptors.request.use((config) => {
    const token = getEmbeddedToken();
    // Assign onto the AxiosHeaders instance; replacing it would drop Content-Type.
    if (token && config.headers) {
        (config.headers as any).Authorization = `Bearer ${token}`;
    }
    return config;
});

axiosInstance.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401 && !window.location.pathname.includes('/login')) {
            // Experiment routes have their own guard (ProtectedExperimentRoute) —
            // don't hard-redirect; let React Router handle it.
            if (!window.location.pathname.startsWith('/e/')) {
                window.location.href = '/admin/login';
            }
        }
        return Promise.reject(error);
    },
);

export default axiosInstance;
