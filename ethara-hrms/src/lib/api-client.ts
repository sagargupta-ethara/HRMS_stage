import axios, { type AxiosRequestConfig } from "axios";

const BASE_URL = (process.env.NEXT_PUBLIC_API_URL || "/api/v1").trim();

let _accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  _accessToken = token;
  if (typeof window !== "undefined") {
    if (token) {
      sessionStorage.setItem("ethara_access_token", token);
    } else {
      sessionStorage.removeItem("ethara_access_token");
    }
  }
}

export function getAccessToken(): string | null {
  if (_accessToken) return _accessToken;
  if (typeof window !== "undefined") {
    const stored = sessionStorage.getItem("ethara_access_token");
    if (stored) {
      _accessToken = stored;
      return stored;
    }
  }
  return null;
}

export function clearAccessToken(): void {
  _accessToken = null;
  if (typeof window !== "undefined") {
    sessionStorage.removeItem("ethara_access_token");
  }
}

interface EtharaRequestConfig extends AxiosRequestConfig {
  _skipRetry?: boolean;
  _retry?: boolean;
}

export const apiClient = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
  timeout: 12_000,
  headers: { "Content-Type": "application/json" },
});

apiClient.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

apiClient.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config as EtharaRequestConfig;

    if (original._skipRetry) {
      return Promise.reject(error);
    }

    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      try {
        const { data } = await axios.post(
          `${BASE_URL}/auth/refresh`,
          {},
          { withCredentials: true }
        );
        setAccessToken(data.accessToken);
        original.headers = original.headers ?? {};
        original.headers.Authorization = `Bearer ${data.accessToken}`;
        return apiClient(original);
      } catch {
        clearAccessToken();
        if (typeof window !== "undefined") {
          sessionStorage.removeItem("ethara_user");
          sessionStorage.removeItem("ethara_profile");
        }
      }
    }

    return Promise.reject(error);
  }
);

export default apiClient;
