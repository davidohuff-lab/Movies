import { Venue } from "@/lib/domain";
import { clamp } from "@/lib/utils";

export const DEFAULT_ORIGIN = {
  label: "330 W 17th St, New York, NY",
  lat: 40.7428,
  lng: -74.0034,
  borough: "Manhattan",
  nearestSubwayStops: ["14 St", "23 St"]
};

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadius = 3958.8;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return earthRadius * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export function estimateTravelMinutes(venue: Venue, startAt?: Date): number {
  const miles = haversineMiles(DEFAULT_ORIGIN.lat, DEFAULT_ORIGIN.lng, venue.lat, venue.lng);
  const walkBuffer = 8;
  const boroughPenalty = venue.borough === "Manhattan" ? 0 : venue.borough === "Brooklyn" ? 9 : 12;
  const crosstownPenalty =
    venue.borough === "Manhattan" && Math.abs(DEFAULT_ORIGIN.lng - venue.lng) > 0.02 ? 5 : 0;
  const transferPenalty = venue.nearestSubwayStops.length > 1 ? 4 : 2;
  const railTime = miles * 8.5;
  const lateNightPenalty =
    startAt && (startAt.getHours() >= 22 || startAt.getHours() < 6) ? 6 : 0;
  return clamp(Math.round(walkBuffer + railTime + boroughPenalty + crosstownPenalty + transferPenalty + lateNightPenalty), 8, 75);
}
