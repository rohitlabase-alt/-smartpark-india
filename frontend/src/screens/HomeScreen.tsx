import type { PublicParkingFacility } from "@smartpark/shared";
import { ParkingCard } from "../components/ParkingCard";
import { usePublicFacilities } from "../hooks/usePublicFacilities";
import { greetingName, initials } from "../utils/format";
import {
  IconSearch,
  IconTicket,
  IconQrCode,
  IconClock,
  IconChevronRight,
} from "../components/icons";
import type { AppTab } from "../components/BottomNavigation";
import { AppHeader, SectionHeading, ScreenError, ScreenLoader, EmptyState } from "../components/ui";

interface HomeScreenProps {
  user: { fullName?: string | null; email: string } | undefined;
  onTab: (tab: AppTab) => void;
  onOpenFacility: (facility: PublicParkingFacility) => void;
}

export function HomeScreen({ user, onTab, onOpenFacility }: HomeScreenProps) {
  const { state, facilities, error, refresh } = usePublicFacilities();
  const firstName = greetingName(user?.fullName ?? undefined);
  const liveCount = facilities.filter((f) => f.isLive).length;
  const openCount = facilities.reduce((sum, f) => sum + f.availableSlots, 0);

  return (
    <div className="sp-main">
      <AppHeader />
      <section className="hero-card" aria-label="Welcome">
        <p className="hero-greeting">
          Namaste, <em>{firstName}</em>
        </p>
        <p className="hero-sub">
          {user
            ? "Find a spot, book it, and breeze in with your digital pass."
            : "Sign in to book parking. Browse live spots below — no login needed."}
        </p>
        <button className="search-pill" type="button" onClick={() => onTab("find")}>
          <IconSearch width={20} height={20} />
          <span>Search parking near me</span>
          <IconChevronRight width={18} height={18} />
        </button>
        <div className="hero-stats">
          <div className="hero-stat">
            <strong>{liveCount}</strong>
            <span>Live facilities</span>
          </div>
          <div className="hero-stat">
            <strong>{openCount}</strong>
            <span>Open spots</span>
          </div>
        </div>
      </section>

      <div className="quick-actions">
        <button className="quick-action" type="button" onClick={() => onTab("bookings")}>
          <IconTicket />
          <span>My Bookings</span>
        </button>
        <button className="quick-action" type="button" onClick={() => onTab("pass")}>
          <IconQrCode />
          <span>Parking Pass</span>
        </button>
        <button className="quick-action" type="button" onClick={() => onTab("find")}>
          <IconSearch />
          <span>Find Parking</span>
        </button>
        <button className="quick-action" type="button" onClick={() => onTab("profile")}>
          <IconClock />
          <span>My Account</span>
        </button>
      </div>

      {!user && (
        <button className="quick-action sign-in-cta" type="button" onClick={() => onTab("profile")}>
          <span className="avatar small">{initials("Guest")}</span>
          <span>Sign in to book parking</span>
          <IconChevronRight width={18} height={18} />
        </button>
      )}

      <SectionHeading kicker="Nearby" title="Parking near you" />
      {state === "loading" && <ScreenLoader label="Finding parking facilities..." />}
      {state === "error" && (
        <>
          <ScreenError message={error} />
          <button className="secondary-button" type="button" onClick={refresh}>
            Try again
          </button>
        </>
      )}
      {state === "success" && facilities.length === 0 && (
        <EmptyState message="No verified parking facilities are live in your area yet." />
      )}
      {state === "success" && facilities.length > 0 && (
        <div className="facility-list" role="list" aria-label="Parking facilities">
          {facilities.map((facility) => (
            <ParkingCard
              key={facility.id}
              facility={facility}
              onSelect={() => onOpenFacility(facility)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
