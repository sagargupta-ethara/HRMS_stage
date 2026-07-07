"use client";

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import type { AuthProfile, User } from "@/types";
import { authApi } from "@/lib/api";
import { apiClient, setAccessToken, getAccessToken, clearAccessToken } from "@/lib/api-client";

interface AuthContextType {
  user: User | null;
  profile: AuthProfile | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<User | null>;
  syncAuthSession: (response: ApiAuthResponse) => User;
  switchRole: (role: User["role"]) => Promise<User>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

type ApiUser = {
  id: string;
  email: string;
  name: string;
  role: User["role"];
  roles?: User["role"][];
  phone?: string;
  profile_photo_endpoint?: string | null;
  profilePhotoEndpoint?: string | null;
  must_change_password?: boolean;
  mustChangePassword?: boolean;
  email_verified?: boolean;
  emailVerified?: boolean;
  email_verified_at?: string;
  emailVerifiedAt?: string;
  is_active?: boolean;
  isActive?: boolean;
  last_login_at?: string;
  lastLoginAt?: string;
  created_at?: string;
  createdAt?: string;
  permissions?: string[];
};

type ApiAuthResponse = {
  user?: ApiUser;
  profile?: AuthProfile | null;
  accessToken?: string;
};

function normalizeUser(raw: ApiUser): User {
  return {
    id: raw.id,
    email: raw.email,
    name: raw.name,
    role: raw.role,
    roles: raw.roles && raw.roles.length ? raw.roles : [raw.role],
    phone: raw.phone,
    profilePhotoEndpoint: raw.profilePhotoEndpoint ?? raw.profile_photo_endpoint ?? null,
    mustChangePassword: raw.mustChangePassword ?? raw.must_change_password ?? false,
    emailVerified: raw.emailVerified ?? raw.email_verified ?? false,
    emailVerifiedAt: raw.emailVerifiedAt ?? raw.email_verified_at,
    isActive: raw.isActive ?? raw.is_active ?? true,
    lastLoginAt: raw.lastLoginAt ?? raw.last_login_at,
    createdAt: raw.createdAt ?? raw.created_at ?? new Date().toISOString(),
    permissions: raw.permissions ?? [],
  };
}

function normalizeAuthResponse(raw: ApiAuthResponse | ApiUser): {
  user: User;
  profile: AuthProfile | null;
  accessToken?: string;
} {
  const payload: ApiAuthResponse = "user" in raw
    ? raw
    : { user: raw as ApiUser, profile: null };
  return {
    user: normalizeUser(payload.user as ApiUser),
    profile: payload.profile ?? null,
    accessToken: payload.accessToken,
  };
}

function persistSession(user: User, profile: AuthProfile | null): void {
  try {
    sessionStorage.setItem("ethara_user", JSON.stringify(user));
    if (profile) sessionStorage.setItem("ethara_profile", JSON.stringify(profile));
    else sessionStorage.removeItem("ethara_profile");
  } catch {
    // sessionStorage may be unavailable in some environments
  }
}

function getPersistedUser(): User | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = sessionStorage.getItem("ethara_user");
    if (!stored) return null;
    return normalizeUser(JSON.parse(stored));
  } catch {
    return null;
  }
}

function getPersistedProfile(): AuthProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = sessionStorage.getItem("ethara_profile");
    if (!stored) return null;
    return JSON.parse(stored) as AuthProfile;
  } catch {
    return null;
  }
}

function clearPersistedSession(): void {
  try {
    sessionStorage.removeItem("ethara_user");
    sessionStorage.removeItem("ethara_profile");
    // Drop any candidate selection-form drafts (these can hold personal data) so
    // they never outlive the session that created them — e.g. on a shared device.
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith("candidate-selection-form:")) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // storage may be unavailable
  }
}

const QUIET_PUBLIC_AUTH_ROUTES = [
  "/careers",
  "/login",
  "/forgot-password",
  "/register",
  "/privacy-policy",
  "/terms-of-service",
  "/cookies-policy",
  "/contact",
  "/candidate",
  "/employee/register",
  "/employee/verify-email",
];

function isQuietPublicAuthRoute(pathname: string): boolean {
  return QUIET_PUBLIC_AUTH_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AuthProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const authRevisionRef = useRef(0);

  const refreshUser = useCallback(async (): Promise<User | null> => {
    const authRevision = authRevisionRef.current;
    try {
      const res = await apiClient.get<ApiAuthResponse | ApiUser>("/auth/me");
      if (authRevisionRef.current !== authRevision) return user;
      const normalized = normalizeAuthResponse(res.data);
      setUser(normalized.user);
      setProfile(normalized.profile);
      persistSession(normalized.user, normalized.profile);
      return normalized.user;
    } catch {
      if (authRevisionRef.current !== authRevision) return user;
      clearPersistedSession();
      clearAccessToken();
      setUser(null);
      setProfile(null);
      return null;
    }
  }, [user]);

  useEffect(() => {
    let cancelled = false;

    const hydrateUser = async () => {
      const authRevision = authRevisionRef.current;
      const persisted = getPersistedUser();
      const hasAccessToken = Boolean(getAccessToken());
      if (persisted && !cancelled) {
        setUser(persisted);
        setProfile(getPersistedProfile());
      }

      const pathname = typeof window !== "undefined" ? window.location.pathname : "";
      if (!persisted && !hasAccessToken && isQuietPublicAuthRoute(pathname)) {
        setIsLoading(false);
        return;
      }

      try {
        const res = await apiClient.get<ApiAuthResponse | ApiUser>("/auth/me");
        if (cancelled || authRevisionRef.current !== authRevision) return;
        const normalized = normalizeAuthResponse(res.data);
        setUser(normalized.user);
        setProfile(normalized.profile);
        persistSession(normalized.user, normalized.profile);
      } catch {
        if (cancelled || authRevisionRef.current !== authRevision) return;
        clearPersistedSession();
        clearAccessToken();
        setUser(null);
        setProfile(null);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void hydrateUser();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<User> => {
    authRevisionRef.current += 1;
    const response = await authApi.login(email, password);
    const normalized = normalizeAuthResponse(response as ApiAuthResponse);
    authRevisionRef.current += 1;
    setAccessToken(normalized.accessToken ?? null);
    setUser(normalized.user);
    setProfile(normalized.profile);
    persistSession(normalized.user, normalized.profile);
    return normalized.user;
  }, []);

  const switchRole = useCallback(async (role: User["role"]): Promise<User> => {
    authRevisionRef.current += 1;
    const response = await authApi.switchRole(role);
    const normalized = normalizeAuthResponse(response as ApiAuthResponse);
    setUser(normalized.user);
    setProfile(normalized.profile);
    persistSession(normalized.user, normalized.profile);
    return normalized.user;
  }, []);

  const syncAuthSession = useCallback((response: ApiAuthResponse): User => {
    authRevisionRef.current += 1;
    const normalized = normalizeAuthResponse(response);
    if (normalized.accessToken !== undefined) {
      setAccessToken(normalized.accessToken ?? null);
    }
    setUser(normalized.user);
    setProfile(normalized.profile);
    persistSession(normalized.user, normalized.profile);
    return normalized.user;
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    authRevisionRef.current += 1;
    try {
      await authApi.logout();
    } catch {
      // logout failure is non-fatal; clear local state regardless
    }
    setUser(null);
    setProfile(null);
    clearAccessToken();
    clearPersistedSession();
  }, []);

  return (
    <AuthContext.Provider value={{ user, profile, isAuthenticated: !!user, isLoading, login, logout, refreshUser, syncAuthSession, switchRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
