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
  const [user, setUser] = useState<User | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = sessionStorage.getItem("vouch_token");
    if (!token) {
      setLoading(false);
      return;
    }

    apiFetch<MeResponse>("/api/auth/me")
      .then((data) => {
        setUser(data.user);
        setOrganization(data.organization);
      })
      .catch(() => {
        sessionStorage.removeItem("vouch_token");
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
      setUser(data.user);
      setOrganization(data.organization);
      return data.user;
    },
    [],
  );

  const logout = useCallback(() => {
    sessionStorage.removeItem("vouch_token");
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

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
