import axios, { type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type RetryConfig = InternalAxiosRequestConfig & {
  _skipRetry?: boolean;
  _retry?: boolean;
};

function responseFor<T>(config: InternalAxiosRequestConfig, data: T): AxiosResponse<T> {
  return {
    data,
    status: 200,
    statusText: "OK",
    headers: {},
    config,
  };
}

function authError(config: InternalAxiosRequestConfig, status = 401) {
  return {
    config,
    response: { status },
  };
}

describe("api-client token helpers", () => {
  beforeEach(() => {
    vi.resetModules();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("persists, returns, and clears the access token", async () => {
    const { setAccessToken, getAccessToken, clearAccessToken } = await import("./api-client");

    setAccessToken("token-123");
    expect(getAccessToken()).toBe("token-123");
    expect(sessionStorage.getItem("ethara_access_token")).toBe("token-123");

    clearAccessToken();
    expect(getAccessToken()).toBeNull();
    expect(sessionStorage.getItem("ethara_access_token")).toBeNull();
  });

  it("hydrates the in-memory token from session storage", async () => {
    sessionStorage.setItem("ethara_access_token", "stored-token");
    const { getAccessToken } = await import("./api-client");

    expect(getAccessToken()).toBe("stored-token");
  });

  it("removes stored tokens when set to null", async () => {
    const { setAccessToken, getAccessToken } = await import("./api-client");

    setAccessToken("temporary-token");
    setAccessToken(null);

    expect(getAccessToken()).toBeNull();
    expect(sessionStorage.getItem("ethara_access_token")).toBeNull();
  });

  it("keeps token helpers safe when browser storage is unavailable", async () => {
    vi.stubGlobal("window", undefined);
    const { setAccessToken, getAccessToken, clearAccessToken } = await import("./api-client");

    setAccessToken("server-token");
    expect(getAccessToken()).toBe("server-token");

    clearAccessToken();
    expect(getAccessToken()).toBeNull();
  });

  it("attaches the bearer token to outgoing requests", async () => {
    const { apiClient, setAccessToken } = await import("./api-client");
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => responseFor(config, { ok: true }));
    apiClient.defaults.adapter = adapter;

    setAccessToken("token-123");

    await apiClient.get("/health");

    expect(adapter).toHaveBeenCalledOnce();
    expect(adapter.mock.calls[0][0].headers.Authorization).toBe("Bearer token-123");
  });

  it("sends requests without Authorization when no token exists", async () => {
    const { apiClient } = await import("./api-client");
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => responseFor(config, { ok: true }));
    apiClient.defaults.adapter = adapter;

    await apiClient.get("/health");

    expect(adapter).toHaveBeenCalledOnce();
    expect(adapter.mock.calls[0][0].headers.Authorization).toBeUndefined();
  });

  it("retries a 401 once after refresh and stores the fresh token", async () => {
    const { apiClient } = await import("./api-client");
    const refresh = vi.spyOn(axios, "post").mockResolvedValue({ data: { accessToken: "fresh-token" } });
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      if (adapter.mock.calls.length === 1) {
        const retryConfig: Partial<RetryConfig> = { ...config };
        delete retryConfig.headers;
        throw authError(retryConfig as InternalAxiosRequestConfig);
      }
      return responseFor(config, { ok: true });
    });
    apiClient.defaults.adapter = adapter;

    const result = await apiClient.get("/private");

    expect(result.data).toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledWith("/api/v1/auth/refresh", {}, { withCredentials: true });
    expect(sessionStorage.getItem("ethara_access_token")).toBe("fresh-token");
    expect((adapter.mock.calls[1][0] as RetryConfig)._retry).toBe(true);
    expect(adapter.mock.calls[1][0].headers.Authorization).toBe("Bearer fresh-token");
  });

  it("does not retry when the request opts out", async () => {
    const { apiClient } = await import("./api-client");
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      throw authError(config);
    });
    apiClient.defaults.adapter = adapter;

    await expect(
      apiClient.request({
        url: "/private",
        method: "GET",
        _skipRetry: true,
      } as RetryConfig),
    ).rejects.toMatchObject({ response: { status: 401 } });

    expect(adapter).toHaveBeenCalledOnce();
  });

  it("clears auth state when refresh fails", async () => {
    const { apiClient, setAccessToken, getAccessToken } = await import("./api-client");
    vi.spyOn(axios, "post").mockRejectedValue(new Error("refresh failed"));
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      throw authError(config);
    });
    apiClient.defaults.adapter = adapter;
    setAccessToken("expired-token");
    sessionStorage.setItem("ethara_user", "{}");
    sessionStorage.setItem("ethara_profile", "{}");

    await expect(apiClient.get("/private")).rejects.toMatchObject({ response: { status: 401 } });

    expect(getAccessToken()).toBeNull();
    expect(sessionStorage.getItem("ethara_access_token")).toBeNull();
    expect(sessionStorage.getItem("ethara_user")).toBeNull();
    expect(sessionStorage.getItem("ethara_profile")).toBeNull();
  });

  it("handles refresh failure without browser storage", async () => {
    vi.stubGlobal("window", undefined);
    const { apiClient, setAccessToken, getAccessToken } = await import("./api-client");
    vi.spyOn(axios, "post").mockRejectedValue(new Error("refresh failed"));
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      throw authError(config);
    });
    apiClient.defaults.adapter = adapter;
    setAccessToken("expired-token");

    await expect(apiClient.get("/private")).rejects.toMatchObject({ response: { status: 401 } });

    expect(getAccessToken()).toBeNull();
  });

  it("passes non-auth failures through without refreshing", async () => {
    const { apiClient } = await import("./api-client");
    const refresh = vi.spyOn(axios, "post");
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      throw authError(config, 500);
    });
    apiClient.defaults.adapter = adapter;

    await expect(apiClient.get("/broken")).rejects.toMatchObject({ response: { status: 500 } });

    expect(refresh).not.toHaveBeenCalled();
  });
});
