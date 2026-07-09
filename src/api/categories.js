import apiClient from './client';

export const categoriesAPI = {
  getAll: () => apiClient.get('/categories'),
  getById: (id) => apiClient.get(`/categories/${id}`),
  
  // Admin only
  create: (data) => apiClient.post('/categories', data),
  update: (id, data) => apiClient.put(`/categories/${id}`, data),
  delete: (id) => apiClient.delete(`/categories/${id}`),
};
