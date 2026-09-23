/**
 * API client and session handling.
 */

const TOKEN_KEY = "r76.token";
const USER_KEY = "r76.user";

export interface SessionUser {
  name?: string;
  email: string;
  role?: string;
}

export const session = {
  get token(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  },
  get user(): SessionUser | null {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) ?? "null");
    } catch {
      return null;
    }
  },
  save(token: string, user: SessionUser) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

const unauthorizedHandlers = new Set<() => void>();
export function onUnauthorized(handler: () => void) {
  unauthorizedHandlers.add(handler);
  return () => {
    unauthorizedHandlers.delete(handler);
  };
}

interface RequestOptions {
  body?: unknown;
  form?: FormData;
  signal?: AbortSignal;
}

/**
 * Backend origin. Empty when UI and API share an origin (the normal case:
 * `npm start` serves both, as does the Railway deployment); set VITE_API_BASE
 * to the API URL only when the UI is hosted separately from it.
 */
export const apiBase =
  (import.meta as any).env?.VITE_API_BASE?.replace(/\/$/, "") ?? "";

/** Resolve a backend file path (/reports/…, /uploads/…) against the API origin. */
export function fileUrl(path: string | null | undefined): string {
  if (!path) return "";
  if (/^https?:\/\//.test(path)) return path;
  return `${apiBase}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Give up on an unreachable API instead of spinning forever. */
const REQUEST_TIMEOUT_MS = 15000;

function unreachable(): ApiError {
  const where = apiBase || "the same origin as this page";
  return new ApiError(
    0,
    `Cannot reach the API at ${where}. Check that VITE_API_BASE points at a running server and the server allows this origin (CLIENT_ORIGIN).`,
    null,
  );
}

async function request(method: string, path: string, { body, form, signal }: RequestOptions = {}) {
  const headers: Record<string, string> = {};
  const token = session.token;
  if (token) headers.Authorization = `Bearer ${token}`;

  let payload: BodyInit | undefined;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  let response: Response;
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);
  const forwardAbort = () => timeout.abort();
  signal?.addEventListener("abort", forwardAbort);
  try {
    response = await fetch(`${apiBase}/api${path}`, { method, headers, body: payload, signal: timeout.signal });
  } catch (error) {
    // Caller-cancelled stays an AbortError; anything else (refused, DNS,
    // timeout) names the API origin so a misconfigured deploy is obvious.
    if (signal?.aborted) throw error;
    throw unreachable();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forwardAbort);
  }

  if (response.status === 204) return null;

  const raw = await response.text();
  let data: unknown = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = { error: raw.slice(0, 400) };
    }
  }

  if (!response.ok) {
    if (response.status === 401) {
      session.clear();
      for (const handler of unauthorizedHandlers) handler();
    }
    const message =
      (data as { error?: string } | null)?.error ??
      `Request failed (${response.status} ${response.statusText})`;
    throw new ApiError(response.status, message, data);
  }

  return data;
}

export const api = {
  get: <T = unknown>(path: string, options?: RequestOptions) =>
    request("GET", path, options) as Promise<T>,
  post: <T = unknown>(path: string, body?: unknown, options?: RequestOptions) =>
    request("POST", path, { ...options, body }) as Promise<T>,
  put: <T = unknown>(path: string, body?: unknown, options?: RequestOptions) =>
    request("PUT", path, { ...options, body }) as Promise<T>,
  patch: <T = unknown>(path: string, body?: unknown, options?: RequestOptions) =>
    request("PATCH", path, { ...options, body }) as Promise<T>,
  delete: <T = unknown>(path: string, options?: RequestOptions) =>
    request("DELETE", path, options) as Promise<T>,
  upload: <T = unknown>(path: string, form: FormData, options?: RequestOptions) =>
    request("POST", path, { ...options, form }) as Promise<T>,
};
