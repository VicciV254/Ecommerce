import apiClient from './client';

export const wishlistAPI = {
  get: () => apiClient.get('/wishlist'),
  addItem: (data) => apiClient.post('/wishlist', data),
  removeItem: (id) => apiClient.delete(`/wishlist/${id}`),
};
