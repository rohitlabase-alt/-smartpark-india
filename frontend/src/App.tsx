import {
  APP_TAGLINE,
  APP_VERSION,
  MODE_STATUS,
  MVP_STATUS,
} from "@smartpark/shared";
import PlaceholderBanner from "./components/PlaceholderBanner";

/**
 * SmartPark India — Phase 1A placeholder screen.
 * No parking functionality yet; later phases replace this with real flows.
 */
export default function App() {
  return (
    <main className="shell">
      <PlaceholderBanner />
      <p className="tagline">{APP_TAGLINE}</p>
      <p className="meta">
        {MVP_STATUS} · {MODE_STATUS} · v{APP_VERSION}
      </p>
    </main>
  );
}