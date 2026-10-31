import axios, { CanceledError, type InternalAxiosRequestConfig } from "axios";
import { CUSTOMER_SESSION_KEYS, STORAGE_KEYS, removeStoredKeys } from "../utils/storage";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";
type CustomerSession = { token: string; refreshToken: string | null };
type SessionRequest = InternalAxiosRequestConfig & {
  _retry?: boolean;
  _customerToken?: string;
};
type RefreshAttempt = {
  from: CustomerSession;
  to?: CustomerSession;
  promise: Promise<string>;
};

const api = axios.create({
  baseURL: API_URL,
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  timeout: 30_000,
  withCredentials: true,
});

let refreshAttempt: RefreshAttempt | undefined;

function readSession(): CustomerSession | null {
  const token = localStorage.getItem(STORAGE_KEYS.customerToken);
  return token ? { token, refreshToken: localStorage.getItem(STORAGE_KEYS.customerRefreshToken) } : null;
}

function sameSession(a: CustomerSession | null | undefined, b: CustomerSession | null | undefined) {
  return Boolean(a && b && a.token === b.token && a.refreshToken === b.refreshToken);
}

function belongsToCurrentSession(session: CustomerSession) {
  const current = readSession();
  return sameSession(session, current) ||
    (sameSession(session, refreshAttempt?.from) && sameSession(current, refreshAttempt?.to));
}

function sessionForRequest(token: string): CustomerSession | null {
  const current = readSession();
  if (current?.token === token) return current;
  if (refreshAttempt?.from.token === token && sameSession(current, refreshAttempt.to)) return refreshAttempt.from;
  return null;
}

function usesSeparateAuthentication(url = "") {
  const path = url.split(/[?#]/)[0];
  // Staff and settings calls carry their own credentials; the public catalog snapshot needs none.
  return /(^|\/)(admin|settings|catalog)(\/|$)/.test(path) ||
    /(^|\/)auth\/(login|register|refresh|logout|verify-email|verify-otp|resend-verification|forgot-password|reset-password)\/?$/.test(path);
}

function refreshSession(session: CustomerSession): Promise<string> {
  if (
    refreshAttempt && sameSession(session, refreshAttempt.from) &&
    (refreshAttempt.to ? sameSession(readSession(), refreshAttempt.to) : sameSession(readSession(), session))
  ) {
    return refreshAttempt.promise;
  }
  if (!sameSession(session, readSession())) {
    return Promise.reject(new CanceledError("Customer session changed"));
  }
  if (!session.refreshToken) return Promise.reject(new Error("No refresh token available"));
  const attempt: RefreshAttempt = {
    from: session,
    promise: axios.post<unknown>(
      `${API_URL}/auth/refresh`,
      { refreshToken: session.refreshToken },
      { withCredentials: true, timeout: 30_000 },
    ).then(({ data }) => {
      if (!sameSession(session, readSession())) throw new CanceledError("Customer session changed");
      if (
        !data || typeof data !== "object" ||
        !("token" in data) || typeof data.token !== "string" || !data.token ||
        !("refreshToken" in data) || typeof data.refreshToken !== "string" || !data.refreshToken
      ) throw new Error("Invalid token refresh response");

      attempt.to = { token: data.token, refreshToken: data.refreshToken };
      localStorage.setItem(STORAGE_KEYS.customerToken, data.token);
      localStorage.setItem(STORAGE_KEYS.customerRefreshToken, data.refreshToken);
      return data.token;
    }),
  };
  // Retain the last successful transition so a late 401 can reuse it.
  refreshAttempt = attempt;
  return attempt.promise;
}

api.interceptors.request.use((config: SessionRequest) => {
  const session = readSession();
  if (config._customerToken) {
    if (!sessionForRequest(config._customerToken) || !session) {
      throw new CanceledError("Customer session changed");
    }
    config.headers.set("Authorization", `Bearer ${session.token}`);
    config._customerToken = session.token;
  } else if (session && !config.headers.has("Authorization") && !config.auth && !usesSeparateAuthentication(config.url)) {
    config.headers.set("Authorization", `Bearer ${session.token}`);
    config._customerToken = session.token;
  }
  return config;
});

api.interceptors.response.use(
  (response) => {
    const request: SessionRequest = response.config;
    if (request._customerToken && !sessionForRequest(request._customerToken)) {
      throw new CanceledError("Customer session changed");
    }
    return response;
  },
  async (error: unknown) => {
    if (!axios.isAxiosError(error)) return Promise.reject(error);
    const request: SessionRequest | undefined = error.config;
    const session = request?._customerToken ? sessionForRequest(request._customerToken) : null;
    if (request?._customerToken && !session) {
      return Promise.reject(new CanceledError("Customer session changed"));
    }
    if (!request || !session || error.response?.status !== 401 || request._retry || usesSeparateAuthentication(request.url)) {
      return Promise.reject(error);
    }

    request._retry = true;
    try {
      const token = await refreshSession(session);
      if (readSession()?.token !== token) throw new CanceledError("Customer session changed");
      request.headers.set("Authorization", `Bearer ${token}`);
      return api(request);
    } catch (refreshError) {
      const stillCurrent = belongsToCurrentSession(session);
      if (sameSession(refreshAttempt?.from, session)) refreshAttempt = undefined;
      if (!stillCurrent) return Promise.reject(new CanceledError("Customer session changed"));
      const status = axios.isAxiosError(refreshError) ? refreshError.response?.status : undefined;
      if (
        sameSession(session, readSession()) &&
        (!session.refreshToken || status === 400 || status === 401 || status === 403)
      ) {
        removeStoredKeys(CUSTOMER_SESSION_KEYS);
        window.location.href = "/#/login";
      }
      return Promise.reject(refreshError);
    }
  },
);

export default api;
export { API_URL };
