import api from './client';

export interface Address {
  id: string;
  street: string;
  city: string;
  county: string;
  /** The server stores a missing postal code as `null`. */
  postalCode?: string | null;
  isDefault: boolean;
}

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  profileImage?: string;
  emailVerified?: boolean;
  addresses?: Address[];
  promotionalEmails?: boolean;
}

/** The API's limits on names and phone (backend/src/utils/validators.js); sign-up also needs two letters per name. */
export const PERSON_LIMITS = { nameMin: 2, nameMax: 100, phoneMax: 20 } as const;

export interface RegisterData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  promotionalEmails?: boolean;
}

export interface LoginData {
  email: string;
  password: string;
}

export interface AuthSession {
  user: User;
  token: string;
  refreshToken: string;
}

/** Login rejection body; `requiresOtp` routes the customer to verification. */
export interface LoginErrorBody {
  error?: string;
  requiresOtp?: boolean;
  email?: string;
}

export interface VerificationResult {
  message: string;
}

export const authAPI = {
  login: (data: LoginData) => api.post<AuthSession>('/auth/login', data),
  register: (data: RegisterData) =>
    api.post<AuthSession & { verificationEmailSent?: boolean }>('/auth/register', data),
  logout: () => api.post<{ message: string }>('/auth/logout'),
  getMe: () => api.get<User>('/auth/me'),
  updateProfile: (data: Partial<User>) => api.put<User>('/auth/profile', data),
  verifyOtp: (email: string, code: string) =>
    api.post<{ message: string }>('/auth/verify-otp', { email, code }),
  resendVerification: (email: string) =>
    api.post<VerificationResult>('/auth/resend-verification', { email }),
  addAddress: (address: Omit<Address, 'id'>) =>
    api.post<Address>('/auth/addresses', address),
  updateAddress: (id: string, address: Partial<Address>) =>
    api.put<Address>(`/auth/addresses/${encodeURIComponent(id)}`, address),
  deleteAddress: (id: string) => api.delete<{ message: string }>(`/auth/addresses/${encodeURIComponent(id)}`),
};

/** Accepts a stored customer profile only when its identity fields are intact. */
export function isUser(value: unknown): value is User {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return ['id', 'email', 'firstName', 'lastName'].every((key) => typeof candidate[key] === 'string') &&
    (candidate.addresses === undefined || Array.isArray(candidate.addresses));
}

/** Accepts the server's record of a saved address only with its identity and text fields intact. */
export function isAddress(value: unknown): value is Address {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === 'string' && candidate.id !== '' &&
    ['street', 'city', 'county'].every((key) => typeof candidate[key] === 'string') &&
    (candidate.postalCode === undefined || candidate.postalCode === null || typeof candidate.postalCode === 'string') &&
    typeof candidate.isDefault === 'boolean';
}
