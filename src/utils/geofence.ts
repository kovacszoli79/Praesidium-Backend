// Haversine formula to calculate distance between two points on Earth
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in meters
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

// Check if a point is inside a circular geofence
export function isInsideGeofence(
  pointLat: number,
  pointLon: number,
  geofenceLat: number,
  geofenceLon: number,
  radiusMeters: number
): boolean {
  const distance = calculateDistance(pointLat, pointLon, geofenceLat, geofenceLon);
  return distance <= radiusMeters;
}

// Check if geofence is active based on schedule
export function isGeofenceActiveNow(
  schedule: { days: number[]; startTime: string; endTime: string } | null
): boolean {
  if (!schedule) return true;

  const now = new Date();
  const currentDay = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  // Check if current day is in schedule
  if (!schedule.days.includes(currentDay)) {
    return false;
  }

  // Check if current time is within schedule
  return currentTime >= schedule.startTime && currentTime <= schedule.endTime;
}

// Get all geofences that contain a point
export function getContainingGeofences<T extends { latitude: number; longitude: number; radius: number }>(
  pointLat: number,
  pointLon: number,
  geofences: T[]
): T[] {
  return geofences.filter((geofence) =>
    isInsideGeofence(pointLat, pointLon, geofence.latitude, geofence.longitude, geofence.radius)
  );
}
