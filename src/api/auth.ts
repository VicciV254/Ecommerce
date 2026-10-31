import api from './client';

export interface Address {
  id: string;
  street: string;
  city: string;
  county: string;
  postalCode?: string;
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
  verificationEmailSent?: boolean;
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
