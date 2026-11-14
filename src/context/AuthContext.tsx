import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, getStoredToken, setStoredToken } from '../lib/api';
import { refreshSocketAuth } from '../lib/socket';
import type { UserProfile } from '../types/parking';

interface AuthContextValue {
  user: UserProfile | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<UserProfile>;
  register: (payload: {
    name: string;
    email: string;
    password: string;
    vehicleNumber?: string;
    phone?: string;
  }) => Promise<UserProfile>;
  logout: () => void;
  refreshProfile: () => Promise<void>;
  updateProfile: (payload: { name: string; vehicleNumber: string; phone: string }) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshProfile = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }

    try {
      const { user: profile } = await api.auth.me();
      setUser(profile);
    } catch {
      setStoredToken(null);
      setUser(null);
      refreshSocketAuth(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshProfile();
  }, [refreshProfile]);

  const login = useCallback(async (email: string, password: string) => {
    const { token, user: profile } = await api.auth.login({ email, password });
    setStoredToken(token);
    setUser(profile);
    refreshSocketAuth(token);
    return profile;
  }, []);

  const register = useCallback(
    async (payload: {
      name: string;
      email: string;
      password: string;
      vehicleNumber?: string;
      phone?: string;
    }) => {
      const { token, user: profile } = await api.auth.register(payload);
      setStoredToken(token);
      setUser(profile);
      refreshSocketAuth(token);
      return profile;
    },
    []
  );

  const logout = useCallback(() => {
    setStoredToken(null);
    setUser(null);
    refreshSocketAuth(null);
  }, []);

  const updateProfile = useCallback(
    async (payload: { name: string; vehicleNumber: string; phone: string }) => {
      const { user: updated } = await api.auth.updateProfile(payload);
      setUser(updated);
    },
    []
  );

  return (
    <AuthContext.Provider
      value={{ user, loading, login, register, logout, refreshProfile, updateProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
