import { useEffect, useMemo, useState } from "react";
import type { PublicParkingFacility } from "@smartpark/shared";
import { ParkingCard } from "../components/ParkingCard";
import { usePublicFacilities } from "../hooks/usePublicFacilities";
import { VEHICLE_FILTER_OPTIONS, facilityMatchesVehicle, type VehicleKey } from "../utils/vehicle";
import { IconCar, IconBike, IconBolt, IconSearch, IconMapPin } from "../components/icons";
import { AppHeader, SectionHeading, ScreenError, ScreenLoader, EmptyState } from "../components/ui";

interface FindParkingScreenProps {
  onOpenFacility: (facility: PublicParkingFacility) => void;
}

export function FindParkingScreen({ onOpenFacility }: FindParkingScreenProps) {
  const { state, facilities, error, refresh } = usePublicFacilities();
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("All");
  const [vehicle, setVehicle] = useState<VehicleKey | "all">("all");

  const cities = useMemo(
    () => Array.from(new Set(facilities.map((f) => f.city.trim()).filter(Boolean))).sort(),
    [facilities],
  );

  useEffect(() => {
    if (city !== "All" && !cities.includes(city)) setCity("All");
  }, [cities, city]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return facilities.filter((facility) => {
      if (city !== "All" && facility.city !== city) return false;
      if (vehicle !== "all" && !facilityMatchesVehicle(facility.availableVehicleTypes, vehicle)) {
        return false;
      }
      if (q) {
        const haystack = [facility.name, facility.area, facility.address, facility.parkingId]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [facilities, query, city, vehicle]);

  return (
    <div className="sp-main">
      <AppHeader />
      <SectionHeading kicker="Market" title="Find Parking" />
      <div className="search-card">
        <label htmlFor="facility-search" className="visually-hidden">
          Search facilities
        </label>
        <div className="inline-form-row">
          <IconSearch width={18} height={18} />
          <input
            id="facility-search"
            type="search"
            placeholder="Search by name, area or code"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      <div className="chip-row" role="group" aria-label="City filter">
        <button
          type="button"
          className={`chip${city === "All" ? " selected" : ""}`}
          onClick={() => setCity("All")}
        >
          All cities
        </button>
        {cities.map((c) => (
          <button
            key={c}
            type="button"
            className={`chip${city === c ? " selected" : ""}`}
            onClick={() => setCity(c)}
          >
            <IconMapPin width={15} height={15} />
            {c}
          </button>
        ))}
      </div>

      <div className="chip-row" role="group" aria-label="Vehicle filter">
        <button
          type="button"
          className={`chip${vehicle === "all" ? " selected" : ""}`}
          onClick={() => setVehicle("all")}
        >
          All vehicles
        </button>
        {VEHICLE_FILTER_OPTIONS.map((option) => {
          const Icon = option.key === "car" ? IconCar : option.key === "bike" ? IconBike : IconBolt;
          return (
            <button
              key={option.key}
              type="button"
              className={`chip${vehicle === option.key ? " selected" : ""}`}
              onClick={() => setVehicle(vehicle === option.key ? "all" : option.key)}
            >
              <Icon />
              {option.label}
            </button>
          );
        })}
      </div>

      <SectionHeading
        kicker="Real-time"
        title={`${filtered.length} facility${filtered.length === 1 ? "" : "ies"}`}
        right={
          state === "success" && (
            <button className="secondary-button small-button" type="button" onClick={refresh}>
              Refresh
            </button>
          )
        }
      />

      {state === "loading" && <ScreenLoader label="Loading parking facilities..." />}
      {state === "error" && (
        <>
          <ScreenError message={error} />
          <button className="secondary-button" type="button" onClick={refresh}>
            Try again
          </button>
        </>
      )}
      {state === "success" && facilities.length === 0 && (
        <EmptyState message="No verified parking facilities are live yet." />
      )}
      {state === "success" && facilities.length > 0 && filtered.length === 0 && (
        <EmptyState message="No facilities match your filters. Try another city or vehicle." />
      )}
      {state === "success" && filtered.length > 0 && (
        <div className="facility-list" role="list" aria-label="Parking facilities">
          {filtered.map((facility) => (
            <ParkingCard
              key={facility.id}
              facility={facility}
              onSelect={() => onOpenFacility(facility)}
            />
          ))}
        </div>
      )}
      {state === "success" && (
        <p className="disclaimer">
          Availability is operator-reported and can change. Your reservation is only confirmed after
          payment.
        </p>
      )}
    </div>
  );
}
