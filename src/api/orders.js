import apiClient from './client';

export const ordersAPI = {
  create: (data) => apiClient.post('/orders', data),
  createCheckout: (data) => apiClient.post('/orders/checkout', data),
  getMyOrders: (params) => apiClient.get('/orders', { params }),
  getById: (id) => apiClient.get(`/orders/${id}`),
  cancel: (id, data) => apiClient.post(`/orders/${id}/cancel`, data),
  pickup: (id) => apiClient.post(`/orders/${id}/pickup`),
  returnOrder: (id, data) => apiClient.post(`/orders/${id}/return`, data),
  track: (number) => apiClient.get(`/orders/track/${number}`),

  // Admin only
  getAll: (params) => apiClient.get('/orders/admin/all', { params }),
  updateStatus: (id, data) => apiClient.put(`/orders/admin/${id}/status`, data),
};

export async function getUserOrders() {
  const { data } = await ordersAPI.getMyOrders();
  return data;
}

export async function getOrder(id) {
  const { data } = await ordersAPI.getById(id);
  return data;
}

export async function cancelOrder(orderId) {
  await ordersAPI.cancel(orderId);
}

export async function trackOrder(trackingNumber) {
  const { data } = await ordersAPI.track(trackingNumber);
  return data;
}
