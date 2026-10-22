import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { apiFetch } from "../lib/api.js";

export type Role = "brand_manager" | "creator" | "reviewer";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface Organization {
  id: string;
  name: string;
}

interface AuthResponse {
  token: string;
  user: User;
  organization: Organization;
}

interface MeResponse {
  user: User;
  organization: Organization;
}

export interface AuthContextType {
  user: User | null;
  organization: Organization | null;
  loading: boolean;
  loginDemo: (role: Role) => Promise<User>;
  login: (email: string, password: string) => Promise<User>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    try {
      const cached = sessionStorage.getItem("vouch_user");
      return cached ? (JSON.parse(cached) as User) : null;
    } catch {
      return null;
    }
  });

  const [organization, setOrganization] = useState<Organization | null>(() => {
    try {
      const cached = sessionStorage.getItem("vouch_org");
      return cached ? (JSON.parse(cached) as Organization) : null;
    } catch {
      return null;
    }
  });

  // If token is present and user is cached, render immediately without full-page blocking
  const [loading, setLoading] = useState<boolean>(() => {
    const token = typeof window !== "undefined" ? sessionStorage.getItem("vouch_token") : null;
    const cachedUser = typeof window !== "undefined" ? sessionStorage.getItem("vouch_user") : null;
    return Boolean(token && !cachedUser);
  });

  useEffect(() => {
    const token = sessionStorage.getItem("vouch_token");
    if (!token) {
      setLoading(false);
      return;
    }

    // Revalidate session in background (or foreground if uncached)
    apiFetch<MeResponse>("/api/auth/me")
      .then((data) => {
        setUser(data.user);
        setOrganization(data.organization);
        sessionStorage.setItem("vouch_user", JSON.stringify(data.user));
        sessionStorage.setItem("vouch_org", JSON.stringify(data.organization));
      })
      .catch(() => {
        sessionStorage.removeItem("vouch_token");
        sessionStorage.removeItem("vouch_user");
        sessionStorage.removeItem("vouch_org");
        setUser(null);
        setOrganization(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const loginDemo = useCallback(async (role: Role): Promise<User> => {
    const data = await apiFetch<AuthResponse>("/api/auth/demo", {
      method: "POST",
      body: JSON.stringify({ role }),
    });
    sessionStorage.setItem("vouch_token", data.token);
    sessionStorage.setItem("vouch_user", JSON.stringify(data.user));
    sessionStorage.setItem("vouch_org", JSON.stringify(data.organization));
    setUser(data.user);
    setOrganization(data.organization);
    return data.user;
  }, []);

  const login = useCallback(
    async (email: string, password: string): Promise<User> => {
      const data = await apiFetch<AuthResponse>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      sessionStorage.setItem("vouch_token", data.token);
      sessionStorage.setItem("vouch_user", JSON.stringify(data.user));
      sessionStorage.setItem("vouch_org", JSON.stringify(data.organization));
      setUser(data.user);
      setOrganization(data.organization);
      return data.user;
    },
    [],
  );

  const logout = useCallback(() => {
    sessionStorage.removeItem("vouch_token");
    sessionStorage.removeItem("vouch_user");
    sessionStorage.removeItem("vouch_org");
    setUser(null);
    setOrganization(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        organization,
        loading,
        loginDemo,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
