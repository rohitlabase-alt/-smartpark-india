import {
  USER_ROLES,
  USER_STATUSES,
  type AuthResponse,
  type LoginRequest,
  type PublicUser,
  type RefreshRequest,
  type RegisterRequest,
} from "@smartpark/shared";

export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || "http://localhost:4000/api/v1"
).replace(/\/+$/, "");

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  user: PublicUser;
}

export class AuthApiError extends Error {
  readonly status: number | undefined;
  readonly code: string | undefined;

  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = "AuthApiError";
    this.status = status;
    this.code = code;
  }
}

let memorySession: AuthSession | undefined;

function isPublicUser(value: unknown): value is PublicUser {
  if (!value || typeof value !== "object") return false;
  const user = value as Partial<PublicUser>;
  return (
    typeof user.id === "number" &&
    typeof user.email === "string" &&
    (user.fullName === null || typeof user.fullName === "string") &&
    (user.phone === null || typeof user.phone === "string") &&
    typeof user.locale === "string" &&
    !!user.status &&
    USER_STATUSES.includes(user.status) &&
    Array.isArray(user.roles) &&
    user.roles.every((role) => USER_ROLES.includes(role)) &&
    typeof user.createdAt === "string"
  );
}

function isAuthResponse(value: unknown): value is AuthResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Partial<AuthResponse>;
  return (
    typeof response.accessToken === "string" &&
    response.accessToken.length > 0 &&
    typeof response.refreshToken === "string" &&
    response.refreshToken.length > 0 &&
    typeof response.expiresInSeconds === "number" &&
    response.expiresInSeconds > 0 &&
    isPublicUser(response.user)
  );
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  allowEmpty = false,
): Promise<T | undefined> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new AuthApiError("Unable to reach the authentication service.");
  }

  if (allowEmpty && response.status === 204) return undefined;

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AuthApiError("The authentication response was not valid JSON.", response.status);
  }

  if (!response.ok) {
    const error = body && typeof body === "object" && "error" in body ? body.error : undefined;
    const message =
      error && typeof error === "object" && "message" in error && typeof error.message === "string"
        ? error.message
        : "Authentication request failed.";
    const code =
      error && typeof error === "object" && "code" in error && typeof error.code === "string"
        ? error.code
        : undefined;
    throw new AuthApiError(message, response.status, code);
  }

  return body as T;
}

async function sessionRequest(path: string, body: RegisterRequest | LoginRequest | RefreshRequest) {
  const response = await request<unknown>(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!isAuthResponse(response)) {
    throw new AuthApiError("The authentication response was incomplete or malformed.");
  }
  return response;
}

export function register(input: RegisterRequest): Promise<AuthResponse> {
  return sessionRequest("/auth/register", input);
}

export function login(input: LoginRequest): Promise<AuthResponse> {
  return sessionRequest("/auth/login", input);
}

export function refresh(input: RefreshRequest): Promise<AuthResponse> {
  return sessionRequest("/auth/refresh", input);
}

export async function getCurrentUser(accessToken: string): Promise<PublicUser> {
  const response = await request<unknown>("/auth/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!isPublicUser(response)) {
    throw new AuthApiError("The current-user response was incomplete or malformed.");
  }
  return response;
}

export async function logout(
  session: Pick<AuthSession, "accessToken" | "refreshToken">,
): Promise<void> {
  await request<void>(
    "/auth/logout",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${session.accessToken}` },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    },
    true,
  );
}

export function getMemorySession(): AuthSession | undefined {
  return memorySession;
}

export function setMemorySession(session: AuthSession): void {
  memorySession = session;
}

export function clearMemorySession(): void {
  memorySession = undefined;
}
