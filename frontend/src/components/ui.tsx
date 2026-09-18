import { Fragment, type ReactNode } from "react";
import { IconArrowLeft } from "./icons";

export function SectionHeading({
  kicker,
  title,
  right,
}: {
  kicker?: string;
  title: string;
  right?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        {kicker && <p className="section-kicker">{kicker}</p>}
        <h2>{title}</h2>
      </div>
      {right}
    </div>
  );
}

export function AppHeader() {
  return (
    <header className="app-header">
      <div className="brand">
        <span className="brand-mark">S</span>
        <span className="brand-name">
          Smart<span className="brand-city">Park</span>india
        </span>
      </div>
      <div className="header-meta">
        <span className="header-badge">Pune</span>
      </div>
    </header>
  );
}

export function SubPageHeader({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <>
      <button className="sp-subpage-back" type="button" onClick={onBack}>
        <IconArrowLeft width={18} height={18} />
        Back
      </button>
      <h2 className="sp-subpage-title">{title}</h2>
    </>
  );
}

export function StatusBadge({ label, tone }: { label: string; tone?: string }) {
  return <span className={`reservation-status${tone ? ` ${tone}` : ""}`}>{label}</span>;
}

export function StepProgress({ step, total }: { step: number; total: number }) {
  return (
    <div className="step-progress" role="note" aria-label={`Step ${step} of ${total}`}>
      {Array.from({ length: total }, (_, i) => i + 1).map((index) => (
        <Fragment key={index}>
          {index > 1 && (
            <span className={`step-line${index - 1 <= step ? " done" : ""}`} aria-hidden="true" />
          )}
          <span
            className={`step-dot${index === step ? " active" : index < step ? " done" : ""}`}
            aria-hidden="true"
          >
            {index < step ? "✓" : index}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

export function ScreenLoader({ label }: { label: string }) {
  return (
    <p className="notice" aria-live="polite">
      {label}
    </p>
  );
}

export function ScreenError({ message }: { message: string }) {
  return (
    <p className="notice error" role="alert">
      {message}
    </p>
  );
}

export function EmptyState({ message }: { message: string }) {
  return <p className="empty-state">{message}</p>;
}

export function RoleBadge({ label }: { label: string }) {
  return <span className="role-badge">{label}</span>;
}
