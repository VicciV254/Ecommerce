import apiClient from './client';

export const productsAPI = {
  getAll: (params) => apiClient.get('/products', { params }),
  getById: (id) => apiClient.get(`/products/${id}`),
  search: (query) => apiClient.get('/products/search', { params: { q: query } }),
  getFeatured: () => apiClient.get('/products/featured'),
  getRecent: () => apiClient.get('/products/recent'),
  getTags: () => apiClient.get('/products/tags'),
  
  // Admin only
  create: (data) => apiClient.post('/products', data, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
  update: (id, data) => apiClient.put(`/products/${id}`, data, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
  delete: (id) => apiClient.delete(`/products/${id}`),
};
