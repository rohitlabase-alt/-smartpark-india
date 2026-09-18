import type { PublicUser } from "@smartpark/shared";
import { AppHeader, SectionHeading, RoleBadge } from "../components/ui";
import { initials } from "../utils/format";
import {
  IconTicket,
  IconQrCode,
  IconHeadset,
  IconInfo,
  IconShield,
  IconBuilding,
  IconCrown,
  IconLogOut,
  IconChevronRight,
} from "../components/icons";
import type { AppTab } from "../components/BottomNavigation";

interface ProfileScreenProps {
  user: PublicUser | undefined;
  onTab: (tab: AppTab) => void;
  onSignIn: () => void;
  onRegister: () => void;
  onSignOut: () => void;
  onOpenOperator: () => void;
  onOpenOperatorRegistration: () => void;
  onOpenAdmin: () => void;
  onOpenInfo: (title: string, body: string) => void;
}

const ROLE_LABELS: Record<string, string> = {
  USER: "Customer",
  PARKING_OPERATOR: "Operator",
  ADMIN: "Admin",
};

export function ProfileScreen({
  user,
  onTab,
  onSignIn,
  onRegister,
  onSignOut,
  onOpenOperator,
  onOpenOperatorRegistration,
  onOpenAdmin,
  onOpenInfo,
}: ProfileScreenProps) {
  const isOperator = user?.roles.includes("PARKING_OPERATOR") ?? false;
  const isAdmin = user?.roles.includes("ADMIN") ?? false;

  function settingsList() {
    const items: React.ReactNode[] = [];
    items.push(
      <SettingsItem
        key="bookings"
        icon={<IconTicket />}
        label="My Bookings"
        onClick={() => onTab("bookings")}
      />,
      <SettingsItem
        key="pass"
        icon={<IconQrCode />}
        label="Parking Pass"
        onClick={() => onTab("pass")}
      />,
      <SettingsItem
        key="help"
        icon={<IconHeadset />}
        label="Help & Support"
        onClick={() => onOpenInfo("Help & Support", helpBody)}
      />,
      <SettingsItem
        key="about"
        icon={<IconInfo />}
        label="About SmartPark"
        onClick={() => onOpenInfo("About SmartPark", aboutBody)}
      />,
      <SettingsItem
        key="privacy"
        icon={<IconShield />}
        label="Privacy & security"
        onClick={() => onOpenInfo("Privacy & security", privacyBody)}
      />,
    );
    return items;
  }

  const roleEntries: React.ReactNode[] = [];
  if (isOperator) {
    roleEntries.push(
      <SettingsItem
        key="operator"
        icon={<IconBuilding />}
        label="Parking Operations"
        onClick={onOpenOperator}
      />,
    );
  } else {
    roleEntries.push(
      <SettingsItem
        key="operator-join"
        icon={<IconBuilding />}
        label="Register as a parking operator"
        onClick={onOpenOperatorRegistration}
      />,
    );
  }
  if (isAdmin) {
    roleEntries.push(
      <SettingsItem key="admin" icon={<IconCrown />} label="Admin Console" onClick={onOpenAdmin} />,
    );
  }

  return (
    <div className="sp-main">
      <AppHeader />
      <SectionHeading kicker="Account" title="Your profile" />

      {!user ? (
        <>
          <div className="profile-card">
            <span className="avatar">{initials("Guest")}</span>
            <div>
              <p className="profile-name">Guest</p>
              <p className="profile-email">Sign in to book parking</p>
            </div>
          </div>
          <div
            className="profile-card"
            style={{ marginTop: 14, flexDirection: "column", alignItems: "stretch" }}
          >
            <p className="muted">
              Create an account to reserve parking, pay digitally and carry your pass on your phone.
            </p>
            <button className="btn" style={{ width: "100%" }} type="button" onClick={onSignIn}>
              Sign in
            </button>
            <button className="secondary-button" type="button" onClick={onRegister}>
              Create account
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="profile-card">
            <span className="avatar">{initials(user.fullName ?? user.email)}</span>
            <div>
              <p className="profile-name">{user.fullName || user.email}</p>
              <p className="profile-email">{user.email}</p>
              <div className="roles-badge-row" style={{ marginTop: 6 }}>
                {user.roles.map((role) => (
                  <RoleBadge key={role} label={ROLE_LABELS[role] ?? role} />
                ))}
              </div>
            </div>
          </div>

          <SectionHeading kicker="Quick links" title="Your travels" />
          <div className="settings-list">{settingsList()}</div>

          {roleEntries.length > 0 && (
            <>
              <SectionHeading kicker="Access" title="Workspace" />
              <div className="settings-list">{roleEntries}</div>
            </>
          )}

          <SectionHeading kicker="Security" title="Trust" />
          <div className="summary-card">
            <div className="summary-row">
              <dt>Digital pass</dt>
              <dd>Tokenized, verified bookings</dd>
            </div>
            <div className="summary-row">
              <dt>Payments</dt>
              <dd>SmartPay mock gateway</dd>
            </div>
          </div>

          <button className="settings-item danger" type="button" onClick={onSignOut}>
            <IconLogOut />
            Sign out
            <span className="spacer" />
          </button>
        </>
      )}

      <p className="disclaimer" style={{ marginTop: 18 }}>
        SmartPark India · Pune MVP. Availability is operator-reported and not guaranteed.
      </p>
    </div>
  );
}

function SettingsItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className="settings-item" type="button" onClick={onClick}>
      {icon}
      <span>{label}</span>
      <span className="spacer" />
      <IconChevronRight className="chev" width={18} height={18} />
    </button>
  );
}

const helpBody =
  "SmartPark customer support is available for Pune facilities during operating hours.\n\n" +
  "For booking or pass issues, cancel and rebook from the Bookings tab, or contact the facility operator on site and show your booking code.\n\n" +
  "Payment disputes for the Pune MVP mock gateway should be raised via the contact details in the About section.";

const aboutBody =
  "SmartPark India is a Pune MVP for finding, booking and verifying on-street and off-street parking.\n\n" +
  "Availability is operator-reported and not guaranteed. Bookings are confirmed only after payment verification; parking passes are digital QR tokens presented at the facility gate.\n\n" +
  "SmartPark is a workspace of SmartPark India.";

const privacyBody =
  "Your account information is used to operate your bookings, payments and parking passes.\n\n" +
  "Parking pass tokens are random per booking, never stored in the application, and only their secure digests are retained. We do not collect your vehicle registration in the MVP.";
