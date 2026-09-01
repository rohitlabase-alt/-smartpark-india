import { useState, type FormEvent } from "react";
import type { Operator, OperatorRegisterRequest } from "@smartpark/shared";
import { AuthApiError } from "./api/auth";
import { registerOperator } from "./api/operators";

function registrationError(cause: unknown): string {
  if (cause instanceof AuthApiError) {
    if (cause.status === 401) return "Your session is no longer authorized. Please sign in again.";
    if (cause.status === 403) return "Your account is not authorized to register as an operator.";
    return cause.message;
  }
  return cause instanceof Error ? cause.message : "Unable to register as an operator.";
}

export default function OperatorRegistration({
  accessToken,
  onOpenDashboard,
  onRegistered,
}: {
  accessToken: string;
  onOpenDashboard: () => void;
  onRegistered: (operator: Operator) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [registeredOperator, setRegisteredOperator] = useState<Operator>();

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    const input: OperatorRegisterRequest = {
      name: name.trim(),
      ...(businessType.trim() ? { businessType: businessType.trim() } : {}),
      ...(registrationNumber.trim() ? { registrationNumber: registrationNumber.trim() } : {}),
    };
    if (!input.name) {
      setError("Enter an operator organization name.");
      return;
    }
    if (input.name.length > 160) {
      setError("Organization name must be 160 characters or fewer.");
      return;
    }
    if (input.businessType && input.businessType.length > 64) {
      setError("Business type must be 64 characters or fewer.");
      return;
    }
    if (input.registrationNumber && input.registrationNumber.length > 64) {
      setError("Registration number must be 64 characters or fewer.");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const operator = await registerOperator(accessToken, input);
      await onRegistered(operator);
      setRegisteredOperator(operator);
    } catch (cause) {
      setError(registrationError(cause));
    } finally {
      setSubmitting(false);
    }
  }

  if (registeredOperator) {
    return (
      <section className="operator-registration" aria-labelledby="operator-registration-title">
        <p className="section-kicker">Operator access</p>
        <h2 id="operator-registration-title">Operator organization created</h2>
        <p className="notice success" role="status" aria-live="polite">
          {registeredOperator.name} is now registered with status{" "}
          {registeredOperator.verificationStatus.toLowerCase()}.
        </p>
        <button onClick={onOpenDashboard} type="button">
          Open Operator Dashboard
        </button>
      </section>
    );
  }

  return (
    <section className="operator-registration" aria-labelledby="operator-registration-title">
      <p className="section-kicker">Operator access</p>
      <h2 id="operator-registration-title">Register as a parking operator</h2>
      <p className="muted">
        Create an operator organization to manage your parking facilities later.
      </p>
      <form className="operator-registration-form" onSubmit={(event) => void handleSubmit(event)}>
        <label htmlFor="operator-name">Organization name</label>
        <input
          id="operator-name"
          maxLength={160}
          onChange={(event) => setName(event.target.value)}
          required
          value={name}
        />
        <label htmlFor="operator-business-type">
          Business type <span className="optional">(optional)</span>
        </label>
        <input
          id="operator-business-type"
          maxLength={64}
          onChange={(event) => setBusinessType(event.target.value)}
          value={businessType}
        />
        <label htmlFor="operator-registration-number">
          Registration number <span className="optional">(optional)</span>
        </label>
        <input
          id="operator-registration-number"
          maxLength={64}
          onChange={(event) => setRegistrationNumber(event.target.value)}
          value={registrationNumber}
        />
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <button disabled={submitting} type="submit">
          {submitting ? "Registering..." : "Register operator"}
        </button>
      </form>
    </section>
  );
}
