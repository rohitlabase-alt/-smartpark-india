/**
 * Auth API routes (docs/API_SPEC.md §2 auth). Password-reset endpoints are
 * deliberately deferred to the notification/email phase; session foundation
 * (register / login / refresh / logout / me) lands here.
 */
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../http/async-handler.js";
import type { AuthenticatedRequest } from "../../http/context.js";
import { requireAuth } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { authService } from "./auth.service.js";

const INDIA_PHONE = /^(\+91[\s-]?)?[6-9]\d{9}$/;

const registerSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
  fullName: z.string().trim().min(1).max(120).optional(),
  phone: z.string().regex(INDIA_PHONE).optional(),
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(128),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const logoutSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});

export const authRouter = Router();

authRouter.post(
  "/register",
  validateBody(registerSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await authService.register(req.body));
  }),
);

authRouter.post(
  "/login",
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    res.json(await authService.login(req.body.email, req.body.password));
  }),
);

authRouter.post(
  "/refresh",
  validateBody(refreshSchema),
  asyncHandler(async (req, res) => {
    res.json(await authService.refresh(req.body.refreshToken));
  }),
);

authRouter.post(
  "/logout",
  requireAuth(),
  validateBody(logoutSchema),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    await authService.logout(req.auth.userId, req.body.refreshToken);
    res.status(204).end();
  }),
);

authRouter.get(
  "/me",
  requireAuth(),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    res.json(await authService.me(req.auth.userId));
  }),
);
