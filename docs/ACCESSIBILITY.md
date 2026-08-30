# SmartPark India — Accessibility

Status: DRAFT v0.1 (Phase 0A)
Last updated: 2026-08-30

Development target, not a certification claim. We aim for WCAG 2.2 AA principles in the frontend; formal auditing/certification is a separate, later activity (Level 2/3) by qualified evaluators.

Scope note: "Accessibility" also includes UI/UX degradations in degraded modes (offline gate, slow network); accessible design should treat those as first-class states.

---

## 1. Requirement

- PRD §15 — Non-Functional Requirements — lists **Accessibility: WCAG 2.2 AA principles**.
- Frontend must treat accessibility as a feature-by-feature requirement, reviewed alongside functionality (see `ARCHITECTURE.md` §16 review checklist).

## 2. Practical Checklist (per screen/flow)

### Keyboard accessibility
- Every function reachable and operable with the keyboard (Tab order matches visual order).
- No keyboard traps; visible logical focus order through forms, maps, modals, and QR flows.
- Esc closes modals/dialogs and returns focus (WCAG 2.1.2, 2.4.3).

### Focus visibility
- Visible focus indicator (not removed by default outline) on all interactive elements (WCAG 2.4.7, 2.4.13 target size for focus).
- `:focus-visible` styling distinct from hover.

### Semantic HTML
- Correct landmarks: header, nav, main, footer; one `h1` per page; heading hierarchy preserved.
- Native elements (`button`, `a`, `input`, `select`) rather than clickable `div`s; `role` only when native is impossible.
- Dialog/modal uses proper dialog semantics + focus management.

### Labels for form controls
- Every input has an associated `<label>` (explicit `for`/`id`).
- Placeholder is never the only label.
- Grouped inputs (radio/checkbox) use `fieldset`/`legend`.
- Error states are tied to the control (`aria-describedby`), not just an icon or color.

### Screen-reader compatibility
- Meaningful `aria-label` where text is not visible (icon-only buttons, QR scan triggers).
- Dynamic updates (availability badges, reservation status, WS events) announced via `aria-live` regions (polite/assertive as appropriate).
- QR/token codes readable/speakable — provide an accessible text representation (the alphanumeric token code), not only the image.

### Color contrast
- Text contrast ≥ 4.5:1 (≥ 3:1 for large text) per WCAG 1.4.3/1.4.11 for UI components and graphical objects.
- Contrast checked in themes incl. status badges (AVAILABLE/RESERVED/UNKNOWN) and confidence labels.

### Non-color-only status indicators
- Availability/confidence/status distinctions include an icon, text, or pattern — never color alone (WCAG 1.4.1).
- Live vs stale must be expressed in words ("Live", "Last updated 3 hrs ago", "Unknown" — already required by `PRD.md` §8).

### Accessible error messages
- Inline, near the field, and programmatically associated with the control.
- Error text is human-readable and actionable, with suggestions.
- Form-level errors announced to screen readers; focus moved to first error on submit.

### Responsive/mobile usability
- WCAG reflow: content usable at 320 px width without horizontal scroll; no loss of function when zoomed to 200% (WCAG 1.4.10 Reflow, 1.4.4 Resize text).
- Landscape + portrait for gate workflows; touch-first layout targets for gate staff.

### Touch target size
- Interactive targets ≥ 44 × 44 px (WCAG 2.5.8 Target Size Minimum guidance; align with AA target-minimum toward production).
- Adequate spacing between adjacent targets; no accidental taps near destructive actions.

### Accessible QR/token workflows
- Gate scan result announced via both text and sound/visual cue (color + text) — never sound/color alone.
- Provide alternate manual code entry for scan failures (already in `PRD.md` §6.3).
- Result screens confirm ENTRY/EXIT with text, not only a checkmark or color.

### Reduced motion
- Honor `prefers-reduced-motion` (WCAG 2.3.3): disable/lower non-essential animations, carousels, live badge pulses.
- No auto-playing motion without a pause/stop control.

---

## 3. Process

- Add these checks to the per-feature review checklist (`ARCHITECTURE.md` §16).
- Include automated checks where practical (axe-core / jest-axe in CI for critical flows) — marked as a Phase 3/4 implementation task, not yet present.
- Manual keyboard + screen-reader pass required before a feature is marked done.
- Multi-language note: labels/aria must be set from i18n strings (never hard-coded English in ARIA attributes) — see `PRD.md` §13 localization.

## 4. Non-claims

- This document does **not** assert WCAG certification, conformance testing results, or legal accessibility compliance. Those are evaluation/legal matters for later phases.