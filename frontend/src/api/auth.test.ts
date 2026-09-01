import { describe, expect, it, vi } from "vitest";
import type { PublicUser } from "@smartpark/shared";
import {
  API_BASE_URL,
  AuthApiError,
  getCurrentUser,
  login,
  logout,
  refresh,
  register,
  type AuthSession,
} from "./auth";

const user: PublicUser = {
  id: 7,
  email: "driver@example.com",
  fullName: "Asha Driver",
  phone: null,
  locale: "en",
  status: "ACTIVE",
  roles: ["USER"],
  createdAt: "2026-09-01T10:00:00.000Z",
};

const session = {
  accessToken: "access-token",
  refreshToken: "refresh-token",
  expiresInSeconds: 1800,
  user,
} satisfies AuthSession;

describe("authentication API client", () => {
  it("posts login and registration using the shared API base URL", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(session), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(session), { status: 201 }));

    await expect(login({ email: user.email, password: "password123" })).resolves.toEqual(session);
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}/auth/login`, {
      method: "POST",
      body: JSON.stringify({ email: user.email, password: "password123" }),
      headers: { Accept: "application/json", "Content-Type": "application/json" },
    });

    await expect(
      register({ email: user.email, password: "password123", fullName: user.fullName! }),
    ).resolves.toEqual(session);
    expect(fetchMock).toHaveBeenLastCalledWith(`${API_BASE_URL}/auth/register`, {
      method: "POST",
      body: JSON.stringify({ email: user.email, password: "password123", fullName: user.fullName }),
      headers: { Accept: "application/json", "Content-Type": "application/json" },
    });
    fetchMock.mockRestore();
  });

  it("sends bearer access tokens for /auth/me and refresh tokens for refresh", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(user), { status: 200 }));
    await expect(getCurrentUser(session.accessToken)).resolves.toEqual(user);
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}/auth/me`, {
      headers: { Accept: "application/json", Authorization: "Bearer access-token" },
    });

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(session), { status: 200 }));
    await expect(refresh({ refreshToken: session.refreshToken })).resolves.toEqual(session);
    expect(fetchMock).toHaveBeenLastCalledWith(`${API_BASE_URL}/auth/refresh`, {
      method: "POST",
      body: JSON.stringify({ refreshToken: session.refreshToken }),
      headers: { Accept: "application/json", "Content-Type": "application/json" },
    });
    fetchMock.mockRestore();
  });

  it("posts logout with both in-memory session tokens and accepts 204", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    await expect(logout(session)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}/auth/logout`, {
      method: "POST",
      body: JSON.stringify({ refreshToken: session.refreshToken }),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: "Bearer access-token",
      },
    });
    fetchMock.mockRestore();
  });

  it("maps API errors and rejects malformed auth responses", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password" },
        }),
        { status: 401 },
      ),
    );
    await expect(login({ email: user.email, password: "wrong" })).rejects.toMatchObject({
      name: "AuthApiError",
      status: 401,
      code: "INVALID_CREDENTIALS",
      message: "Invalid email or password",
    } satisfies Partial<AuthApiError>);

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ accessToken: "only-token" }), { status: 200 }),
    );
    await expect(login({ email: user.email, password: "password123" })).rejects.toThrow(
      "incomplete or malformed",
    );
    fetchMock.mockRestore();
  });
});
