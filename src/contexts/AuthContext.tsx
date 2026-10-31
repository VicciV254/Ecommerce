import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { isAxiosError, isCancel } from 'axios';
import {
  authAPI,
  isUser,
  type Address,
  type LoginErrorBody,
  type RegisterData,
  type User,
} from '../api/auth';
import {
  CUSTOMER_SESSION_KEYS,
  STORAGE_KEYS,
  readStoredJson,
  removeStoredKeys,
  writeStoredJson,
} from '../utils/storage';

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
  writeStoredJson(STORAGE_KEYS.customerUser, user);
  localStorage.setItem(STORAGE_KEYS.customerToken, token);
  localStorage.setItem(STORAGE_KEYS.customerRefreshToken, refreshToken);
}

function persistUser(user: User) {
  writeStoredJson(STORAGE_KEYS.customerUser, user);
}

function clearSession() {
  removeStoredKeys(CUSTOMER_SESSION_KEYS);
}

function readStoredUser(): User | null {
  if (!localStorage.getItem(STORAGE_KEYS.customerToken)) return null;
  const stored = readStoredJson(STORAGE_KEYS.customerUser);
  return isUser(stored) ? stored : null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(readStoredUser);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    if (!localStorage.getItem(STORAGE_KEYS.customerToken)) {
      setUser(null);
      return;
    }

    try {
      const { data } = await authAPI.getMe();
      setUser(data);
      persistUser(data);
    } catch (error) {
      if (isCancel(error)) return;
      if (isAxiosError(error) && [401, 403].includes(error.response?.status ?? 0)) {
        clearSession();
        setUser(null);
      } else {
        console.error('Could not refresh account', {
          status: isAxiosError(error) ? error.response?.status : undefined,
          code: isAxiosError(error) ? error.code : undefined,
        });
      }
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
    } catch (error) {
      const body: LoginErrorBody | undefined = isAxiosError<LoginErrorBody>(error) ? error.response?.data : undefined;
      return {
        ok: false,
        error: body?.error || 'Could not sign in. Please check your details.',
        requiresOtp: Boolean(body?.requiresOtp),
        email: body?.email,
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
      persistUser(next);
      return next;
    });
  }, []);

  const addAddress = useCallback(async (address: Omit<Address, 'id'>) => {
    const { data } = await authAPI.addAddress(address);
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, addresses: [...(prev.addresses ?? []), data] };
      persistUser(next);
      return next;
    });
  }, []);

  const updateAddress = useCallback(async (id: string, address: Partial<Address>) => {
    const { data } = await authAPI.updateAddress(id, address);
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, addresses: (prev.addresses ?? []).map((item) => (item.id === id ? data : item)) };
      persistUser(next);
      return next;
    });
  }, []);

  const deleteAddress = useCallback(async (id: string) => {
    await authAPI.deleteAddress(id);
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, addresses: (prev.addresses ?? []).filter((item) => item.id !== id) };
      persistUser(next);
      return next;
    });
  }, []);

  const updatePromotionalEmails = useCallback(async (enabled: boolean) => {
    const { data: updated } = await authAPI.updateProfile({ promotionalEmails: enabled });
    setUser((prev) => {
      const next = prev ? { ...prev, ...updated } : updated;
      persistUser(next);
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
