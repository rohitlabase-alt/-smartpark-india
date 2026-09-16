/**
 * Platform dashboard routes (Phase 8, Part 4; admin-only). Mounted under
 * /api/v1/admin after requireAuth + requireRole("ADMIN").
 */
import { Router } from "express";
import { asyncHandler } from "../../http/async-handler.js";
import { platformService } from "./platform.service.js";

export const platformRouter = Router();

platformRouter.get(
  "/platform-summary",
  asyncHandler(async (_req, res) => {
    res.json(await platformService.summary());
  }),
);
