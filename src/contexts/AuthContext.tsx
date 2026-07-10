import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import api from '../api/client';
import {
  type Address,
  type RegisterData,
  type User,
} from '../api/auth';

// Recreate authAPI locally to ensure all functions are available
const authAPI = {
  login: (data: any) => api.post('/auth/login', data),
  register: (data: any) => api.post('/auth/register', data),
  logout: () => api.post('/auth/logout'),
  getMe: () => api.get<User>('/auth/me'),
  refreshToken: (refreshToken: string) =>
    api.post('/auth/refresh', { refreshToken }),
  updateProfile: (data: Partial<User>) => api.put<User>('/auth/profile', data),
  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    api.put('/auth/password', data),
  verifyEmail: (token: string) => api.post('/auth/verify-email', { token }),
  verifyOtp: (email: string, code: string) =>
    api.post('/auth/verify-otp', { email, code }),
  resendVerification: (email: string) =>
    api.post('/auth/resend-verification', { email }),
  addAddress: (address: Omit<Address, 'id'>) =>
    api.post<Address>('/auth/addresses', address),
  updateAddress: (id: string, address: Partial<Address>) =>
    api.put<Address>(`/auth/addresses/${id}`, address),
  deleteAddress: (id: string) => api.delete(`/auth/addresses/${id}`),
  setDefaultAddress: (id: string) =>
    api.put(`/auth/addresses/${id}/default`),
};

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string; requiresOtp?: boolean; email?: string }>;
  register: (data: RegisterData) => Promise<boolean>;
  logout: () => void;
  updateProfile: (data: Partial<User>) => Promise<void>;
  addAddress: (address: Omit<Address, 'id'>) => Promise<void>;
  updateAddress: (id: string, address: Partial<Address>) => Promise<void>;
  deleteAddress: (id: string) => Promise<void>;
  updatePromotionalEmails: (enabled: boolean) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function persistSession(user: User, token: string, refreshToken: string) {
  localStorage.setItem('user', JSON.stringify(user));
  localStorage.setItem('token', token);
  localStorage.setItem('refreshToken', refreshToken);
}

function clearSession() {
  localStorage.removeItem('user');
  localStorage.removeItem('token');
  localStorage.removeItem('refreshToken');
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const stored = localStorage.getItem('user');
    return stored ? (JSON.parse(stored) as User) : null;
  });
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      setUser(null);
      return;
    }

    try {
      const { data } = await authAPI.getMe();
      setUser(data);
      localStorage.setItem('user', JSON.stringify(data));
    } catch {
      clearSession();
      setUser(null);
    }
  }, []);

  useEffect(() => {
    refreshUser().finally(() => setLoading(false));
  }, [refreshUser]);

  const login = useCallback(async (email: string, password: string) => {
    try {
      const { data } = await authAPI.login({ email, password });
      persistSession(data.user, data.token, data.refreshToken);
      setUser(data.user);
      return { ok: true };
    } catch (error: any) {
      return {
        ok: false,
        error: error?.response?.data?.error || 'Could not sign in. Please check your details.',
        requiresOtp: Boolean(error?.response?.data?.requiresOtp),
        email: error?.response?.data?.email,
      };
    }
  }, []);

  const register = useCallback(async (formData: RegisterData) => {
    try {
      const { data } = await authAPI.register(formData);
      if (data.user.emailVerified) {
        persistSession(data.user, data.token, data.refreshToken);
        setUser(data.user);
      }
      return true;
    } catch {
      return false;
    }
  }, []);

  const logout = useCallback(() => {
    authAPI.logout().catch(() => undefined);
    clearSession();
    setUser(null);
  }, []);

  const updateProfile = useCallback(async (data: Partial<User>) => {
    const { data: updated } = await authAPI.updateProfile(data);
    setUser((prev) => {
      const next = prev ? { ...prev, ...updated } : updated;
      localStorage.setItem('user', JSON.stringify(next));
      return next;
    });
  }, []);

  const addAddress = useCallback(async (address: Omit<Address, 'id'>) => {
    const { data } = await authAPI.addAddress(address);
    setUser((prev) => {
      if (!prev) return prev;
      const addresses = [...(prev.addresses ?? []), data];
      const next = { ...prev, addresses };
      localStorage.setItem('user', JSON.stringify(next));
      return next;
    });
  }, []);

  const updateAddress = useCallback(async (id: string, address: Partial<Address>) => {
    const { data } = await authAPI.updateAddress(id, address);
    setUser((prev) => {
      if (!prev) return prev;
      const addresses = (prev.addresses ?? []).map((item) =>
        item.id === id ? data : item
      );
      const next = { ...prev, addresses };
      localStorage.setItem('user', JSON.stringify(next));
      return next;
    });
  }, []);

  const deleteAddress = useCallback(async (id: string) => {
    await authAPI.deleteAddress(id);
    setUser((prev) => {
      if (!prev) return prev;
      const addresses = (prev.addresses ?? []).filter((item) => item.id !== id);
      const next = { ...prev, addresses };
      localStorage.setItem('user', JSON.stringify(next));
      return next;
    });
  }, []);

  const updatePromotionalEmails = useCallback(async (enabled: boolean) => {
    const { data: updated } = await authAPI.updateProfile({ promotionalEmails: enabled });
    setUser((prev) => {
      const next = prev ? { ...prev, ...updated } : updated;
      localStorage.setItem('user', JSON.stringify(next));
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      login,
      register,
      logout,
      updateProfile,
      addAddress,
      updateAddress,
      deleteAddress,
      updatePromotionalEmails,
    }),
    [
      user,
      loading,
      login,
      register,
      logout,
      updateProfile,
      addAddress,
      updateAddress,
      deleteAddress,
      updatePromotionalEmails,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

export type { Address, User };
