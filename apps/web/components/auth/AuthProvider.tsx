"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type FC,
  type ReactNode,
} from "react";

export interface AuthUser {
  id: string;
  email: string;
  role: "user" | "admin";
}

export interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * Resolves the signed-in user from the httpOnly `sabbi_access` cookie via
 * `GET /api/auth/me` on mount — the cookie is opaque to JS, so this is the
 * only way the client learns who is logged in (`design.md` — "Frontend user
 * identity"). Mounted at the root layout so `user`/`isAuthenticated` are
 * available everywhere without prop drilling.
 */
export const AuthProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchMe = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me");
      if (!res.ok) {
        setUser(null);
        return;
      }
      const data: AuthUser = await res.json();
      setUser(data);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await fetchMe();
      setIsLoading(false);
    })();
  }, [fetchMe]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        throw new Error(
          res.status === 401
            ? "Email o contraseña incorrectos"
            : `No se pudo iniciar sesión (status ${res.status})`,
        );
      }
      await fetchMe();
    },
    [fetchMe],
  );

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, isLoading, isAuthenticated: user != null, login, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
