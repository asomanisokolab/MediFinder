/* The user's position, shared by every screen for this session, so a
   permission prompt answered on one tab serves the others. */
import * as Location from 'expo-location';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import type { Coords } from './api';

interface LocationState {
  coords: Coords | null;
  locating: boolean;
  /** Asks for permission if needed, then resolves to the position. Throws a readable message. */
  locate: () => Promise<Coords>;
  forget: () => void;
}

const LocationContext = createContext<LocationState | null>(null);

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

async function readPosition(): Promise<Coords> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Location permission denied. Choose a region instead.');
  }
  if (!(await Location.hasServicesEnabledAsync())) {
    throw new Error('Location is turned off on this phone. Turn it on, or choose a region instead.');
  }
  // A recent fix is instant; otherwise wait for a fresh one, but not forever.
  const recent = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000, requiredAccuracy: 1000 });
  const position =
    recent ??
    (await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      15000,
      'Finding your location took too long. Choose a region instead.'
    ));
  return {
    lat: Number(position.coords.latitude.toFixed(5)),
    lng: Number(position.coords.longitude.toFixed(5)),
  };
}

export function LocationProvider({ children }: { children: ReactNode }) {
  const [coords, setCoords] = useState<Coords | null>(null);
  const [locating, setLocating] = useState(false);

  const locate = useCallback(async () => {
    setLocating(true);
    try {
      const next = await readPosition();
      setCoords(next);
      return next;
    } finally {
      setLocating(false);
    }
  }, []);

  const forget = useCallback(() => setCoords(null), []);

  const value = useMemo(() => ({ coords, locating, locate, forget }), [coords, locating, locate, forget]);
  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export function useLocation(): LocationState {
  const value = useContext(LocationContext);
  if (!value) throw new Error('useLocation must be used inside LocationProvider');
  return value;
}
