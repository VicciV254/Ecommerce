import api from "./client";

export const subscriptionsAPI = {
  subscribe: (data: { email: string }) => api.post<{ message?: string }>("/subscriptions/subscribe", data),
};
