import type { SVGProps } from "react";

/**
 * Original inline icon set for SmartPark India. All glyphs are hand-drawn
 * 24x24 strokes (stroke-width 1.8, round caps) — no copied brand marks.
 */

type IconProps = SVGProps<SVGSVGElement>;

function base(props: IconProps, children: React.ReactNode): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function IconHome(props: IconProps) {
  return base(
    props,
    <>
      <path d="M3.5 10.5 12 3.8l8.5 6.7" />
      <path d="M5.5 9.2V20h13V9.2" />
      <path d="M9.5 20v-6h5v6" />
    </>,
  );
}

export function IconSearch(props: IconProps) {
  return base(
    props,
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15.2 15.2 5 5" />
    </>,
  );
}

export function IconTicket(props: IconProps) {
  return base(
    props,
    <>
      <path d="M3.5 7.5h17v4a2.2 2.2 0 0 0 0 4v4H3.5v-4a2.2 2.2 0 0 0 0-4z" />
      <path d="M9.5 9v6" strokeDasharray="1.6 2" />
    </>,
  );
}

export function IconUser(props: IconProps) {
  return base(
    props,
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </>,
  );
}

export function IconMapPin(props: IconProps) {
  return base(
    props,
    <>
      <path d="M12 21.5s6.5-6 6.5-11a6.5 6.5 0 1 0-13 0c0 5 6.5 11 6.5 11Z" />
      <circle cx="12" cy="10.3" r="2.3" />
    </>,
  );
}

export function IconCar(props: IconProps) {
  return base(
    props,
    <>
      <path d="M4.5 16 5.8 10h12.4l1.3 6" />
      <path d="M3.5 16h17v3h-2.2M3.5 16v2.6h2.7" />
      <circle cx="7.4" cy="16.4" r="0.6" fill="currentColor" />
      <circle cx="16.6" cy="16.4" r="0.6" fill="currentColor" />
      <path d="M8 11.8h2.6M13.4 11.8H16" />
    </>,
  );
}

export function IconBike(props: IconProps) {
  return base(
    props,
    <>
      <circle cx="6" cy="16.5" r="2.6" />
      <circle cx="18" cy="16.5" r="2.6" />
      <path d="M8.4 16.5h9.2l-2.6-6H11L8.8 8H6" />
      <path d="m11 10.5 1.8 3" />
    </>,
  );
}

export function IconBolt(props: IconProps) {
  return base(
    props,
    <>
      <path d="M13.5 3 6 13.5h4.5l-1.5 7.5L16 10.5h-4.5z" />
    </>,
  );
}

export function IconChevronRight(props: IconProps) {
  return base(
    props,
    <>
      <path d="m9.5 5 7 7-7 7" />
    </>,
  );
}

export function IconArrowLeft(props: IconProps) {
  return base(
    props,
    <>
      <path d="M19 12H5" />
      <path d="m11 6-6 6 6 6" />
    </>,
  );
}

export function IconQrCode(props: IconProps) {
  return base(
    props,
    <>
      <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1" />
      <rect x="14" y="3.5" width="6.5" height="6.5" rx="1" />
      <rect x="3.5" y="14" width="6.5" height="6.5" rx="1" />
      <path d="M14 14h3v3h-3zM20 14v.5M14 20h.5" />
    </>,
  );
}

export function IconShield(props: IconProps) {
  return base(
    props,
    <>
      <path d="M12 3 5 5.6v5.1c0 4.6 3 8.2 7 9.8 4-1.6 7-5.2 7-9.8V5.6z" />
      <path d="m9 11.8 2.1 2.1 4-4.2" />
    </>,
  );
}

export function IconWallet(props: IconProps) {
  return base(
    props,
    <>
      <rect x="3.5" y="6" width="17" height="13" rx="2.2" />
      <path d="M15 12.2h4" />
      <path d="M3.5 9.5h17" />
    </>,
  );
}

export function IconClock(props: IconProps) {
  return base(
    props,
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 7.5V12l3 2" />
    </>,
  );
}

export function IconLogOut(props: IconProps) {
  return base(
    props,
    <>
      <path d="M9 4.5H5.5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1H9" />
      <path d="M15 8l4 4-4 4" />
      <path d="M10 12h9" />
    </>,
  );
}

export function IconHeadset(props: IconProps) {
  return base(
    props,
    <>
      <path d="M4.5 15.5v-3a7.5 7.5 0 0 1 15 0v3" />
      <rect x="3" y="14.5" width="3.6" height="5" rx="1.6" />
      <rect x="17.4" y="14.5" width="3.6" height="5" rx="1.6" />
    </>,
  );
}

export function IconInfo(props: IconProps) {
  return base(
    props,
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 11v5" />
      <path d="M12 7.8h.01" />
    </>,
  );
}

export function IconCrown(props: IconProps) {
  return base(
    props,
    <>
      <path d="M4 17V6.5l4 3.5 4-7 4 7 4-3.5V17" />
      <path d="M4.5 20h15" />
    </>,
  );
}

export function IconBuilding(props: IconProps) {
  return base(
    props,
    <>
      <path d="M4 20V5.5a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 16 5.5V20" />
      <path d="M16 9h3.5A1.5 1.5 0 0 1 21 10.5V20" />
      <path d="M2.5 20h19" />
      <path d="M7 8h2.5M11.5 8H14M7 11.5h2.5M11.5 11.5H14M7 15h2.5M11.5 15H14" />
    </>,
  );
}

export function IconChart(props: IconProps) {
  return base(
    props,
    <>
      <path d="M4 20V6" />
      <path d="M4 20h16" />
      <path d="M8 20v-7h3.5v7M13 20V4h3.5v16" />
    </>,
  );
}

export function IconPlus(props: IconProps) {
  return base(
    props,
    <>
      <path d="M12 5v14M5 12h14" />
    </>,
  );
}

export function IconRefresh(props: IconProps) {
  return base(
    props,
    <>
      <path d="M20 6v5h-5" />
      <path d="M4 18v-5h5" />
      <path d="M18.3 10A7 7 0 0 0 6.7 7.3L4 11M5.7 14a7 7 0 0 0 11.6 2.7L20 13" />
    </>,
  );
}

export function IconCheck(props: IconProps) {
  return base(
    props,
    <>
      <path d="m5 12.5 4.2 4L19 7.5" />
    </>,
  );
}

export function IconBell(props: IconProps) {
  return base(
    props,
    <>
      <path d="M6 10a6 6 0 0 1 12 0c0 4.5 1.5 6 2 6.5H4c.5-.5 2-2 2-6.5Z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </>,
  );
}
