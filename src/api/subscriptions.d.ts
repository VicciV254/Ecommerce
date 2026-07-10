export const subscriptionsAPI: {
  subscribe(data: { email: string }): Promise<unknown>;
  unsubscribe(data: { email: string }): Promise<unknown>;
};
