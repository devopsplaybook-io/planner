import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api",
  headers: {
    "Content-Type": "application/json",
  },
});

// Request interceptor to add auth token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/**
 * Response error handling. Only 401 ends the session; 403 is an ordinary
 * permission error that individual call sites handle (e.g. hiding an
 * admin-only view).
 */
export function handleResponseError(error: unknown): Promise<never> {
  const status = (error as { response?: { status?: number } })?.response
    ?.status;
  if (status === 401) {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    if (window.location.pathname !== "/login") {
      window.location.href = "/login";
    }
  }
  return Promise.reject(error);
}

api.interceptors.response.use((response) => response, handleResponseError);

export default api;
