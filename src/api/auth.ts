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
}

export interface RegisterData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
}

export interface LoginData {
  email: string;
  password: string;
}

export const authAPI = {
  login: (data: LoginData) => api.post('/auth/login', data),
  register: (data: RegisterData) => api.post('/auth/register', data),
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
