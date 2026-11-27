export type UserRole = 'admin' | 'employee';

export type AuthenticatedUser = {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  must_change_password: boolean;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type ApiRetryOptions = {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
};

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/+$/, '');
const DEFAULT_REQUEST_TIMEOUT_MS = 10000;
const DEFAULT_GET_RETRIES = 1;
const MAX_REQUEST_RETRIES = 2;
const RETRYABLE_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

function getApiUrl(path: string) {
  if (!API_BASE_URL) {
    throw new ApiError(
      'Backend URL is not configured. Set EXPO_PUBLIC_API_URL for this app environment.'
    );
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(API_BASE_URL);
  } catch {
    throw new ApiError('EXPO_PUBLIC_API_URL must be a valid http:// or https:// URL.');
  }
  const host = baseUrl.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const octets = host.split('.').map(Number);
  const isPrivateIpv4 =
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host) &&
    octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255) &&
    (octets[0] === 10 ||
      octets[0] === 127 ||
      octets[0] === 0 ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168));
  const isPrivateIpv6 =
    host === '::1' ||
    host.startsWith('fc') ||
    host.startsWith('fd') ||
    host.startsWith('fe80:');
  const isLocalHost =
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    isPrivateIpv4 ||
    isPrivateIpv6;
  const isLoopback =
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.startsWith('127.') ||
    host === '::1';

  if (
    !host ||
    !['http:', 'https:'].includes(baseUrl.protocol) ||
    baseUrl.username ||
    baseUrl.password
  ) {
    throw new ApiError('EXPO_PUBLIC_API_URL must be a valid http:// or https:// URL.');
  }
  if (
    !__DEV__ &&
    (baseUrl.protocol !== 'https:' || isLocalHost)
  ) {
    throw new ApiError(
      'Production builds require a public HTTPS backend URL. Set EXPO_PUBLIC_API_URL to the deployed service URL.'
    );
  }
  if (__DEV__ && isLoopback) {
    throw new ApiError(
      'Use a development server address reachable from the device. Production builds require a public HTTPS backend URL.'
    );
  }

  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

type JsonRequestOptions = Pick<RequestInit, 'method' | 'body'> & ApiRetryOptions & {
  headers?: Record<string, string>;
};

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchWithRetry(
  url: string,
  request: RequestInit,
  options: ApiRetryOptions = {}
): Promise<{ response: Response; body: string }> {
  const method = (request.method ?? 'GET').toUpperCase();
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const retries = options.retries ?? (method === 'GET' ? DEFAULT_GET_RETRIES : 0);
  const retryDelayMs = options.retryDelayMs ?? 250;

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new ApiError('API request timeout must be a positive number of milliseconds.');
  }
  if (
    !Number.isInteger(retries) ||
    retries < 0 ||
    retries > MAX_REQUEST_RETRIES
  ) {
    throw new ApiError(`API request retries must be between 0 and ${MAX_REQUEST_RETRIES}.`);
  }
  if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0) {
    throw new ApiError('API retry delay must be a non-negative number of milliseconds.');
  }

  for (let attempt = 0; ; attempt += 1) {
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    let response: Response;
    let body: string;
    try {
      response = await fetch(url, { ...request, signal: controller.signal });
      body = await response.text();
    } catch (error) {
      clearTimeout(timeoutId);
      if (attempt < retries) {
        await wait(Math.min(2000, retryDelayMs * 2 ** attempt));
        continue;
      }
      if (timedOut) {
        throw new ApiError(
          `The API at ${API_BASE_URL} did not respond within ${Math.ceil(timeoutMs / 1000)} seconds. Check the network connection and service status.`
        );
      }
      const detail = error instanceof Error && error.message ? ` ${error.message}` : '';
      throw new ApiError(
        `Could not connect to the API at ${API_BASE_URL}. Check the internet connection and that the backend service is available.${detail}`
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (attempt < retries && RETRYABLE_HTTP_STATUSES.has(response.status)) {
      await wait(Math.min(2000, retryDelayMs * 2 ** attempt));
      continue;
    }
    return { response, body };
  }
}

export async function apiRequest(
  path: string,
  options: JsonRequestOptions = {}
): Promise<unknown> {
  const url = getApiUrl(path);
  const { timeoutMs, retries, retryDelayMs, ...requestOptions } = options;
  const { response, body } = await fetchWithRetry(
    url,
    {
      ...requestOptions,
      method: options.method ?? 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    },
    { timeoutMs, retries, retryDelayMs }
  );

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new ApiError(
      `The Flask server returned a non-JSON response (HTTP ${response.status}).`,
      response.status
    );
  }

  if (!response.ok) {
    const message =
      isRecord(payload) && typeof payload.message === 'string'
        ? payload.message
        : `Request failed with HTTP ${response.status}.`;
    throw new ApiError(message, response.status);
  }

  return payload;
}

export async function apiRequestCsv(
  path: string,
  options: ApiRetryOptions = {}
): Promise<{ filename: string; text: string }> {
  const url = getApiUrl(path);
  const { response, body } = await fetchWithRetry(
    url,
    {
      credentials: 'include',
      headers: {
        Accept: 'text/csv',
      },
    },
    options
  );

  if (!response.ok) {
    let message = `Request failed with HTTP ${response.status}.`;
    try {
      const payload: unknown = JSON.parse(body);
      if (isRecord(payload) && typeof payload.message === 'string') {
        message = payload.message;
      }
    } catch {
      message = `The Flask server returned HTTP ${response.status} while exporting the report.`;
    }
    throw new ApiError(message, response.status);
  }

  const contentType = response.headers.get('Content-Type')?.toLowerCase() ?? '';
  if (!contentType.includes('text/csv')) {
    throw new ApiError('The Flask server did not return a CSV report.');
  }

  const disposition = response.headers.get('Content-Disposition') ?? '';
  const candidate = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  const filename =
    candidate && /^[A-Za-z0-9._-]+$/.test(candidate)
      ? candidate
      : 'attendance-report.csv';
  return { filename, text: body };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readUser(payload: unknown): AuthenticatedUser {
  const user = isRecord(payload) ? payload.user : undefined;
  if (
    !isRecord(user) ||
    typeof user.id !== 'number' ||
    typeof user.name !== 'string' ||
    typeof user.email !== 'string' ||
    (user.role !== 'admin' && user.role !== 'employee') ||
    typeof user.must_change_password !== 'boolean'
  ) {
    throw new ApiError('The Flask server returned an invalid user response.');
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    must_change_password: user.must_change_password,
  };
}

export async function signIn(email: string, password: string): Promise<AuthenticatedUser> {
  const loginPayload = await apiRequest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: email.trim(), password }),
  });
  const loginUser = readUser(loginPayload);

  let sessionUser: AuthenticatedUser;
  try {
    sessionUser = await getCurrentUser();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      throw new ApiError(
        'The login was accepted, but the Flask session cookie was not retained. Check the app’s network access and try again.'
      );
    }
    throw error;
  }

  if (sessionUser.id !== loginUser.id || sessionUser.role !== loginUser.role) {
    throw new ApiError('The authenticated session does not match the login response.');
  }

  return sessionUser;
}

export async function getCurrentUser(
  options: ApiRetryOptions = {}
): Promise<AuthenticatedUser> {
  return readUser(await apiRequest('/api/auth/me', options));
}

export async function changeEmployeePassword(
  currentPassword: string,
  newPassword: string
): Promise<AuthenticatedUser> {
  await apiRequest('/api/employee/password', {
    method: 'POST',
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
      confirm_password: newPassword,
    }),
  });

  const user = await getCurrentUser();
  if (user.must_change_password) {
    throw new ApiError('The password was updated, but the account still requires a password change.');
  }
  return user;
}

export async function signOut(): Promise<void> {
  await apiRequest('/api/auth/logout', { method: 'POST' });
}
