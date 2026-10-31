import { isAxiosError, isCancel } from "axios";
import { StaffSessionRequiredError } from "./staffSession";

type ErrorBody = { error?: unknown; details?: unknown };
const MAX_DETAILS = 3;

export function apiStatus(error: unknown): number | undefined {
  return isAxiosError(error) ? error.response?.status : undefined;
}

function validationDetails(details: unknown): string[] {
  if (!Array.isArray(details)) return [];
  return details.flatMap((detail: unknown) => {
    if (typeof detail !== "object" || detail === null || !("message" in detail) || typeof detail.message !== "string") return [];
    const field = "path" in detail && typeof detail.path === "string" && detail.path ? `${detail.path}: ` : "";
    return [`${field}${detail.message}`];
  }).slice(0, MAX_DETAILS);
}

function serverMessage(error: unknown): string | null {
  if (!isAxiosError<ErrorBody>(error)) return null;
  const body = error.response?.data;
  const message = typeof body?.error === "string" && body.error.trim() ? body.error.trim() : null;
  const details = validationDetails(body?.details);
  if (!message) return details.length ? details.join("; ") : null;
  return details.length ? `${message}: ${details.join("; ")}` : message;
}

const SERVICE_UNAVAILABLE = 503;

/**
 * Actionable, user-facing text for a failed request. Server messages are shown for client
 * errors and deliberate 503 "unavailable" responses; other 5xx details stay in server logs.
 */
export function describeApiError(error: unknown, fallback: string): string {
  if (error instanceof StaffSessionRequiredError) return "Your staff session has ended. Sign out, then sign in again.";
  if (isCancel(error)) return "Your session changed while this was loading. Try again.";
  if (!isAxiosError(error)) return fallback;
  const status = error.response?.status;
  if (status === undefined) return "Could not reach the server. Check your connection and try again.";
  const message = serverMessage(error);
  if (status === SERVICE_UNAVAILABLE && message) return message;
  if (status >= 500) return `${fallback} The server could not complete the request; try again shortly.`;
  switch (status) {
    case 401:
      return "Your session is no longer valid. Sign in again.";
    case 403:
      return message ?? "You do not have permission to do this.";
    case 409:
      return message ?? "This was changed by someone else. Reload and try again.";
    case 410:
      return message ?? "This feature has been retired.";
    default:
      return message ?? fallback;
  }
}
