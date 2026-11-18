import api from "./client";

export const subscriptionsAPI = {
  subscribe: (data: { email: string }) => api.post<{ message?: string }>("/subscriptions/subscribe", data),
  /** Unsubscribes the address an emailed link was made for: its token is the only proof, so it is never shown or logged. */
  unsubscribe: (data: { token: string }) => api.post<{ message?: string }>("/subscriptions/unsubscribe", data),
};
