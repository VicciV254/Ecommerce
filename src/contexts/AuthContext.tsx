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
  isAddress,
  isUser,
  type Address,
  type AuthSession,
  type LoginErrorBody,
  type RegisterData,
  type User,
} from '../api/auth';
import { clearAddressDraft } from '../store/addressModel';
import { markGuestMerge } from '../store/guestMerge';
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
  register: (data: RegisterData) => Promise<RegisterOutcome>;
  logout: () => void;
  updateProfile: (data: Partial<User>) => Promise<void>;
  /** Saves a new address and resolves to the server's record of it. */
  addAddress: (address: Omit<Address, 'id'>) => Promise<Address>;
  updateAddress: (id: string, address: Partial<Address>) => Promise<void>;
  deleteAddress: (id: string) => Promise<void>;
  updatePromotionalEmails: (enabled: boolean) => Promise<void>;
}

/** A new account is either signed in at once (already verified) or waits for its email to be verified. */
export type RegisterOutcome = 'signed-in' | 'verify' | 'failed';

const AuthContext = createContext<AuthContextValue | null>(null);

function persistSession(user: User, token: string, refreshToken: string) {
  writeStoredJson(STORAGE_KEYS.customerUser, user);
  localStorage.setItem(STORAGE_KEYS.customerToken, token);
  localStorage.setItem(STORAGE_KEYS.customerRefreshToken, refreshToken);
}

/**
 * Stores a session this tab has just established. A sign-in from a guest session also marks this tab's guest cart to
 * join the account; switching from one account to another never does.
 */
function establishSession({ user, token, refreshToken }: AuthSession) {
  const fromGuest = readStoredUser() === null;
  persistSession(user, token, refreshToken);
  if (fromGuest) markGuestMerge(user.id);
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

const SESSION_KEYS: readonly string[] = CUSTOMER_SESSION_KEYS;

const sameUser = (a: User | null, b: User | null) => a === b || (a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b));

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

  useEffect(() => {
    // Another tab signed in, out, or as someone else: follow it, so this tab never acts for a session that has ended.
    const follow = (event: StorageEvent) => {
      if (event.storageArea !== localStorage || (event.key !== null && !SESSION_KEYS.includes(event.key))) return;
      const stored = readStoredUser();
      setUser((current) => (sameUser(current, stored) ? current : stored));
    };
    window.addEventListener('storage', follow);
    return () => window.removeEventListener('storage', follow);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    try {
      const { data } = await authAPI.login({ email, password });
      establishSession(data);
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

  const register = useCallback(async (formData: RegisterData): Promise<RegisterOutcome> => {
    try {
      const { data } = await authAPI.register(formData);
      if (!data.user.emailVerified) return 'verify';
      establishSession(data);
      setUser(data.user);
      return 'signed-in';
    } catch {
      return 'failed';
    }
  }, []);

  const logout = useCallback(() => {
    authAPI.logout().catch(() => undefined);
    // Typed but unsaved checkout details belong to this account only.
    clearAddressDraft();
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
    if (!isAddress(data)) throw new Error('The saved address was not in the expected format.');
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, addresses: [...(prev.addresses ?? []), data] };
      persistUser(next);
      return next;
    });
    return data;
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
