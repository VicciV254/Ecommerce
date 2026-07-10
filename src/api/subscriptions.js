import apiClient from './client';

export const subscriptionsAPI = {
  subscribe: (data) => apiClient.post('/subscriptions/subscribe', data),
  unsubscribe: (data) => apiClient.post('/subscriptions/unsubscribe', data),
};
