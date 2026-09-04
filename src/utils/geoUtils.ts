export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface HaversineResult {
  distanceMeters: number;
  origin: Coordinates;
  destination: Coordinates;
}

const EARTH_RADIUS_METERS = 6371_000;
const DEGREES_TO_RADIANS = Math.PI / 180;

function toRadians(degrees: number): number {
  return degrees * DEGREES_TO_RADIANS;
}

export function calculateHaversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const deltaPhi = toRadians(lat2 - lat1);
  const deltaLambda = toRadians(lon2 - lon1);

  const sinDeltaPhi = Math.sin(deltaPhi / 2);
  const sinDeltaLambda = Math.sin(deltaLambda / 2);

  const a =
    sinDeltaPhi * sinDeltaPhi +
    Math.cos(phi1) * Math.cos(phi2) * sinDeltaLambda * sinDeltaLambda;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_METERS * c;
}

export function calculateHaversineDistanceWithCoordinates(
  origin: Coordinates,
  destination: Coordinates,
): HaversineResult {
  const distanceMeters = calculateHaversineDistance(
    origin.latitude,
    origin.longitude,
    destination.latitude,
    destination.longitude,
  );

  return {
    distanceMeters,
    origin: { ...origin },
    destination: { ...destination },
  };
}

export function isWithinGeofence(
  userLat: number,
  userLon: number,
  zoneLat: number,
  zoneLon: number,
  maxMeters = 50,
): boolean {
  const distance = calculateHaversineDistance(userLat, userLon, zoneLat, zoneLon);
  return distance <= maxMeters;
}
