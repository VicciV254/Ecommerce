import apiClient from './client';

export const authAPI = {
  register: (data) => apiClient.post('/auth/register', data),
  login: (data) => apiClient.post('/auth/login', data),
  logout: () => apiClient.post('/auth/logout'),
  getMe: () => apiClient.get('/auth/me'),
  updateProfile: (data) => apiClient.put('/auth/profile', data),
  changePassword: (data) => apiClient.put('/auth/password', data),
  verifyOtp: (email, code) => apiClient.post('/auth/verify-otp', { email, code }),
  resendVerification: (email) => apiClient.post('/auth/resend-verification', { email }),
  forgotPassword: (data) => apiClient.post('/auth/forgot-password', data),
  resetPassword: (data) => apiClient.post('/auth/reset-password', data),
};
