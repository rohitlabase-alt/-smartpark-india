/**
 * Public parking/availability routes (docs/API_SPEC.md §2 parking, §3).
 * Mounted (router-level, so the resource segment nests cleanly):
 *   /api/v1/parking/:facilityId/availability
 */
import { Router } from "express";
import { asyncHandler } from "../../http/async-handler.js";
import { availabilityService } from "./availability.service.js";

export const parkingRouter = Router();

parkingRouter.get(
  "/:facilityId/availability",
  asyncHandler(async (req, res) => {
    res.json(await availabilityService.getFacilityAvailability(req.params.facilityId));
  }),
);
