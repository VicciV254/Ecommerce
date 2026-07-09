export const adminAPI: {
  login(data: { email: string; password: string }): Promise<{
    data: {
      admin: {
        id: string;
        email: string;
        username: string;
        role: string;
      };
      token: string;
      refreshToken: string;
    };
  }>;
  getMe(): Promise<unknown>;
  getActivityLogs(params?: Record<string, unknown>): Promise<unknown>;
  stock: Record<string, (...args: unknown[]) => Promise<unknown>>;
  discounts: Record<string, (...args: unknown[]) => Promise<unknown>>;
  analytics: Record<string, (...args: unknown[]) => Promise<unknown>>;
  users: {
    getAll(params?: Record<string, unknown>): Promise<{ data: { users: unknown[] } }>;
    sendVerification(id: string): Promise<{ data: { sent: boolean } }>;
    sendVerificationBulk(ids: string[]): Promise<{ data: { results: Array<{ sent: boolean }> } }>;
    setDisabled(id: string, disabled: boolean): Promise<unknown>;
    delete(id: string): Promise<unknown>;
  };
  orders: {
    getAll(params?: Record<string, unknown>): Promise<{ data: { orders: unknown[]; pagination?: unknown } }>;
    updateStatus(id: string, data: unknown): Promise<unknown>;
    importLocal(receipts: unknown[]): Promise<{ data: { results: Array<{ imported: boolean }> } }>;
  };
};
