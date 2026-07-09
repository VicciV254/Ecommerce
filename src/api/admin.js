import apiClient from './client';

const adminAuth = () => {
  const token = localStorage.getItem('adminToken');
  return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
};

export const adminAPI = {
  login: (data) => apiClient.post('/admin/login', data),
  getMe: () => apiClient.get('/admin/me', adminAuth()),
  getActivityLogs: (params) => apiClient.get('/admin/activity', { params, ...adminAuth() }),
  
  stock: {
    getAll: () => apiClient.get('/admin/stock', adminAuth()),
    getLowStock: () => apiClient.get('/admin/stock/low', adminAuth()),
    getProductStock: (productId) => apiClient.get(`/admin/stock/${productId}`, adminAuth()),
    getHistory: (productId) => apiClient.get(`/admin/stock/${productId}/history`, adminAuth()),
    update: (productId, data) => apiClient.put(`/admin/stock/${productId}`, data, adminAuth()),
    bulkUpdate: (data) => apiClient.post('/admin/stock/bulk', data, adminAuth()),
    restock: (productId, data) => apiClient.post(`/admin/stock/${productId}/restock`, data, adminAuth()),
  },
  
  discounts: {
    getAll: () => apiClient.get('/admin/discounts', adminAuth()),
    getActive: () => apiClient.get('/admin/discounts/active', adminAuth()),
    create: (data) => apiClient.post('/admin/discounts', data, adminAuth()),
    update: (id, data) => apiClient.put(`/admin/discounts/${id}`, data, adminAuth()),
    delete: (id) => apiClient.delete(`/admin/discounts/${id}`, adminAuth()),
  },
  
  analytics: {
    getDashboard: () => apiClient.get('/admin/analytics/dashboard', adminAuth()),
    getInventory: () => apiClient.get('/admin/analytics/inventory', adminAuth()),
    getSales: (params) => apiClient.get('/admin/analytics/sales', { params, ...adminAuth() }),
    getCategories: () => apiClient.get('/admin/analytics/categories', adminAuth()),
    getCustomers: () => apiClient.get('/admin/analytics/customers', adminAuth()),
  },

  users: {
    getAll: (params) => apiClient.get('/admin/users', { params, ...adminAuth() }),
    sendVerification: (id) => apiClient.post(`/admin/users/${id}/verify`, {}, adminAuth()),
    sendVerificationBulk: (ids) => apiClient.post('/admin/users/verify', { ids }, adminAuth()),
    setDisabled: (id, disabled) => apiClient.put(`/admin/users/${id}/disabled`, { disabled }, adminAuth()),
    delete: (id) => apiClient.delete(`/admin/users/${id}`, adminAuth()),
  },

  orders: {
    getAll: (params) => apiClient.get('/orders/admin/all', { params, ...adminAuth() }),
    updateStatus: (id, data) => apiClient.put(`/orders/admin/${id}/status`, data, adminAuth()),
    importLocal: (receipts) => apiClient.post('/admin/orders/import-local', { receipts }, adminAuth()),
  },
};
