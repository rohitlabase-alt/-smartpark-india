import { useCallback, useEffect, useState } from "react";
import type { PublicParkingFacility } from "@smartpark/shared";
import { FacilitiesApiError, fetchPublicFacilities } from "../api/facilities";

type LoadState = "loading" | "success" | "error";

interface FacilityListing {
  state: LoadState;
  facilities: PublicParkingFacility[];
  error: string;
}

let cache: FacilityListing | undefined;

async function load(): Promise<FacilityListing> {
  if (cache && cache.state === "success") return cache;
  if (cache && cache.state === "loading") return cache;
  const listing: FacilityListing = { state: "loading", facilities: [], error: "" };
  cache = listing;
  try {
    const { facilities } = await fetchPublicFacilities();
    listing.state = "success";
    listing.facilities = facilities;
  } catch (cause) {
    listing.state = "error";
    listing.error =
      cause instanceof FacilitiesApiError
        ? cause.message
        : cause instanceof Error
          ? cause.message
          : "Unable to load parking facilities.";
  }
  return listing;
}

/** Shared client-side cache so Home + Find Parking reuse one real fetch. */
export function usePublicFacilities(refresh = false): FacilityListing & { refresh: () => void } {
  const [listing, setListing] = useState<FacilityListing>(() =>
    refresh ? { state: "loading", facilities: [], error: "" } : (cache ?? loadingListing()),
  );

  const run = useCallback(async (force: boolean) => {
    if (force) cache = undefined;
    const next = await load();
    setListing(next);
  }, []);

  useEffect(() => {
    void run(false);
  }, [run]);

  return { ...listing, refresh: () => void run(true) };
}

function loadingListing(): FacilityListing {
  if (cache) return cache;
  return { state: "loading", facilities: [], error: "" };
}
