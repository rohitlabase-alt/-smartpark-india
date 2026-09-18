/** Formatting helpers shared across screens. */

export function formatINR(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
}

export function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-IN", {
        weekday: "short",
        day: "numeric",
        month: "short",
      }).format(date);
}

export function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

const HOUR_MS = 3_600_000;

/** Whole hours between two timestamps (min 1), matching the server formula. */
export function bookedHours(startsAt: string, endsAt: string): number {
  const diff = new Date(endsAt).getTime() - new Date(startsAt).getTime();
  if (!Number.isFinite(diff) || diff <= 0) return 1;
  return Math.max(1, Math.ceil(diff / HOUR_MS));
}

/** "on 3 Jan, 6:00 AM – 8:00 AM · 2 hrs" style label. */
export function slotWindowLabel(startsAt: string, endsAt: string): string {
  return `${formatDate(startsAt)} · ${formatTime(startsAt)} – ${formatTime(endsAt)}`;
}

/** Distance descriptor used by cards — derived from real data only. */
export function relativeLastUpdated(value: string): string {
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return "just now";
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

export function greetingName(name: string | undefined): string {
  if (!name) return "Guest";
  return name.trim().split(/\s+/)[0] || "Guest";
}
