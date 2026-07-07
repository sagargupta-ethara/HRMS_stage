import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider, useAuth } from "./auth-context";
import { authApi } from "./api";
import { apiClient, clearAccessToken, getAccessToken, setAccessToken } from "./api-client";

vi.mock("./api", () => ({
  authApi: {
    login: vi.fn(),
    logout: vi.fn(),
    switchRole: vi.fn(),
  },
}));

vi.mock("./api-client", () => ({
  apiClient: {
    get: vi.fn(),
  },
  setAccessToken: vi.fn(),
  getAccessToken: vi.fn(),
  clearAccessToken: vi.fn(),
}));

const mockAuthApi = vi.mocked(authApi);
const mockApiClient = vi.mocked(apiClient);

const apiUser = {
  id: "usr-1",
  email: "employee@example.com",
  name: "Employee User",
  role: "employee" as const,
  roles: ["employee" as const, "manager" as const],
  profile_photo_endpoint: "/api/avatar",
  must_change_password: true,
  email_verified: true,
  is_active: true,
  created_at: "2026-06-07T00:00:00.000Z",
};

const employeeProfile = {
  type: "employee" as const,
  id: "emp-1",
  fullName: "Employee User",
  name: "Employee User",
  etharaEmail: "employee@example.com",
  employeeCode: "GRP1001",
};

function Probe() {
  const auth = useAuth();
  return (
    <div>
      <p data-testid="loading">{String(auth.isLoading)}</p>
      <p data-testid="auth">{String(auth.isAuthenticated)}</p>
      <p data-testid="name">{auth.user?.name ?? "none"}</p>
      <p data-testid="role">{auth.user?.role ?? "none"}</p>
      <p data-testid="profile-code">
        {auth.profile?.type === "employee" ? auth.profile.employeeCode : "none"}
      </p>
      <button onClick={() => void auth.login(" HR@ETHARA.AI ", "secret")}>login</button>
      <button onClick={() => void auth.switchRole("manager")}>switch</button>
      <button
        onClick={() =>
          auth.syncAuthSession({
            user: {
              ...apiUser,
              id: "usr-sync",
              name: "Synced User",
              role: "candidate",
              roles: ["candidate"],
            },
            profile: {
              type: "candidate",
              id: "cand-1",
              candidateCode: "ETH-1",
              fullName: "Synced Candidate",
              personalEmail: "candidate@example.com",
              currentStage: "new_application",
              currentStatus: "New Application",
            },
            accessToken: "sync-token",
          })
        }
      >
        sync
      </button>
      <button onClick={() => void auth.refreshUser()}>refresh</button>
      <button onClick={() => void auth.logout()}>logout</button>
    </div>
  );
}

describe("AuthProvider", () => {
  beforeEach(() => {
    sessionStorage.clear();
    mockApiClient.get.mockReset();
    mockAuthApi.login.mockReset();
    mockAuthApi.logout.mockReset();
    mockAuthApi.switchRole.mockReset();
    vi.mocked(setAccessToken).mockClear();
    vi.mocked(getAccessToken).mockReturnValue(null);
    vi.mocked(clearAccessToken).mockClear();
  });

  it("throws when useAuth is rendered outside the provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    function BrokenConsumer() {
      useAuth();
      return null;
    }

    expect(() => render(<BrokenConsumer />)).toThrow("useAuth must be used within AuthProvider");
    spy.mockRestore();
  });

  it("hydrates the session from /auth/me and persists normalized data", async () => {
    mockApiClient.get.mockResolvedValue({
      data: { user: apiUser, profile: employeeProfile, accessToken: "server-token" },
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

    expect(screen.getByTestId("auth")).toHaveTextContent("true");
    expect(screen.getByTestId("name")).toHaveTextContent("Employee User");
    expect(screen.getByTestId("profile-code")).toHaveTextContent("GRP1001");
    expect(JSON.parse(sessionStorage.getItem("ethara_user") ?? "{}")).toMatchObject({
      id: "usr-1",
      profilePhotoEndpoint: "/api/avatar",
      mustChangePassword: true,
      emailVerified: true,
    });
  });

  it("login, switch role, sync session, refresh, and logout update state and storage", async () => {
    const user = userEvent.setup();
    mockApiClient.get.mockRejectedValueOnce(new Error("not logged in"));
    mockAuthApi.login.mockResolvedValue({
      user: apiUser,
      profile: employeeProfile,
      accessToken: "login-token",
    });
    mockAuthApi.switchRole.mockResolvedValue({
      user: { ...apiUser, role: "manager", roles: ["employee", "manager"] },
      profile: employeeProfile,
    });
    mockApiClient.get.mockResolvedValueOnce({
      data: {
        user: { ...apiUser, id: "usr-refresh", name: "Refreshed User" },
        profile: employeeProfile,
      },
    });
    mockAuthApi.logout.mockResolvedValue({
      data: {},
      status: 200,
      statusText: "OK",
      headers: {},
      config: {},
    } as unknown as Awaited<ReturnType<typeof authApi.logout>>);

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

    await user.click(screen.getByRole("button", { name: "login" }));
    await waitFor(() => expect(screen.getByTestId("name")).toHaveTextContent("Employee User"));
    expect(setAccessToken).toHaveBeenCalledWith("login-token");

    await user.click(screen.getByRole("button", { name: "switch" }));
    await waitFor(() => expect(screen.getByTestId("role")).toHaveTextContent("manager"));

    await user.click(screen.getByRole("button", { name: "sync" }));
    await waitFor(() => expect(screen.getByTestId("name")).toHaveTextContent("Synced User"));
    expect(setAccessToken).toHaveBeenCalledWith("sync-token");

    await user.click(screen.getByRole("button", { name: "refresh" }));
    await waitFor(() => expect(screen.getByTestId("name")).toHaveTextContent("Refreshed User"));

    await user.click(screen.getByRole("button", { name: "logout" }));
    await waitFor(() => expect(screen.getByTestId("auth")).toHaveTextContent("false"));
    expect(clearAccessToken).toHaveBeenCalled();
    expect(sessionStorage.getItem("ethara_user")).toBeNull();
    expect(sessionStorage.getItem("ethara_profile")).toBeNull();
  });

  it("clears local session when refreshUser fails", async () => {
    const user = userEvent.setup();
    mockApiClient.get
      .mockResolvedValueOnce({ data: { user: apiUser, profile: employeeProfile } })
      .mockRejectedValueOnce(new Error("expired"));

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("auth")).toHaveTextContent("true"));
    await user.click(screen.getByRole("button", { name: "refresh" }));
    await waitFor(() => expect(screen.getByTestId("auth")).toHaveTextContent("false"));
    expect(clearAccessToken).toHaveBeenCalled();
  });
});
