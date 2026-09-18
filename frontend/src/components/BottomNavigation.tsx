import { IconHome, IconQrCode, IconSearch, IconTicket, IconUser } from "./icons";

export type AppTab = "home" | "find" | "bookings" | "pass" | "profile";

const TABS: { key: AppTab; label: string; Icon: typeof IconHome }[] = [
  { key: "home", label: "Home", Icon: IconHome },
  { key: "find", label: "Find Parking", Icon: IconSearch },
  { key: "bookings", label: "Bookings", Icon: IconTicket },
  { key: "pass", label: "Pass", Icon: IconQrCode },
  { key: "profile", label: "Profile", Icon: IconUser },
];

export function BottomNavigation({
  active,
  onSelect,
}: {
  active: AppTab;
  onSelect: (tab: AppTab) => void;
}) {
  return (
    <nav className="bottom-nav" aria-label="Primary">
      <div className="bottom-nav-inner">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            className={`nav-item${active === key ? " selected" : ""}`}
            aria-current={active === key ? "page" : undefined}
            onClick={() => onSelect(key)}
          >
            <Icon />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
