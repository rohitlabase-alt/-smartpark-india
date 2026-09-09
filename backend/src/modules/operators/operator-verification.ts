/**
 * Operator verification gate (Phase 8, Part 1). Reusable server-side guard for
 * operational operator actions: an action may only proceed when the caller's
 * operator organisation is VERIFIED. PENDING / UNDER_REVIEW / REJECTED
 * operators receive a clear 403; a caller with no operator org receives 404
 * (no existence disclosure, API_SPEC §1 conventions).
 *
 * Preserves the existing ownership model: callers that already look the
 * operator up for IDOR checks use the returned row instead of re-querying.
 */
import { forbidden, notFound } from "../../http/errors.js";
import { operatorsRepository, type OperatorRow } from "./operators.repository.js";

export async function assertVerifiedOperator(userId: number): Promise<OperatorRow> {
  const operator = await operatorsRepository.findByOwnerUser(userId);
  if (!operator) {
    throw notFound("OPERATOR_NOT_FOUND", "No parking operator registered for this account");
  }
  if (operator.verificationStatus !== "VERIFIED") {
    throw forbidden(
      "OPERATOR_NOT_VERIFIED",
      `Operator is ${operator.verificationStatus}; only VERIFIED operators can perform this operation`,
    );
  }
  return operator;
}
