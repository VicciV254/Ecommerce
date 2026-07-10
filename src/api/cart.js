import apiClient from './client';

export const cartAPI = {
  get: () => apiClient.get('/cart'),
  addItem: (data) => apiClient.post('/cart/items', data),
  updateItem: (id, data) => apiClient.put(`/cart/items/${id}`, data),
  removeItem: (id) => apiClient.delete(`/cart/items/${id}`),
  clear: () => apiClient.delete('/cart'),
  applyCoupon: (data) => apiClient.post('/cart/coupon', data),
  removeCoupon: () => apiClient.delete('/cart/coupon'),
};
