/* Client for the FindCare Ghana public API. Types mirror
   backend/app/schemas.py. Only public endpoints are used: the app has no
   admin features. */
import Constants from 'expo-constants';

export const API_ORIGIN: string =
  process.env.EXPO_PUBLIC_API_ORIGIN ||
  (Constants.expoConfig?.extra?.apiOrigin as string | undefined) ||
  'https://findcareghana.com';

const API = `${API_ORIGIN}/api/v1`;

export type Category = 'hospital' | 'clinic' | 'laboratory' | 'pharmacy' | 'hearse' | 'caregiver';

export interface Beds {
  total_beds: number | null;
  available_beds: number | null;
  updated_at: string | null;
  is_stale: boolean;
  display: string;
}

export interface FleetStatus {
  total_units: number | null;
  units_available: number | null;
  updated_at: string | null;
  is_stale: boolean;
  display: string;
}

export interface FacilitySummary {
  id: number;
  name: string;
  type: 'government' | 'private';
  category: Category;
  classification: string;
  region: string;
  district: string;
  city: string;
  town: string;
  lat: number;
  lng: number;
  phone: string;
  is_24_hour: boolean;
  has_ambulance: boolean;
  verified: boolean;
  last_verified: string | null;
  distance_km: number | null;
  services: string[];
  beds: Beds | null;
}

export interface FacilityDetail extends FacilitySummary {
  address: string;
  hours: string;
  website: string;
  source: string;
  ambulance_phone: string;
  ambulance_provider_id: number | null;
  insurance: string[];
  last_updated: string;
}

export interface ProviderSummary {
  id: number;
  name: string;
  operator_type: 'government' | 'private' | 'facility_attached';
  service_level: 'BLS' | 'ALS';
  region: string;
  district: string;
  lat: number;
  lng: number;
  phone: string;
  alt_phone: string;
  is_24_hour: boolean;
  cost_band: string;
  verified: boolean;
  phone_verified_at: string | null;
  distance_km: number | null;
  covers_user_area: boolean | null;
  status: FleetStatus | null;
}

export interface ProviderDetail extends ProviderSummary {
  base_address: string;
  hours: string;
  coverage: { region: string; district: string }[];
  last_updated: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
  data_verified: boolean;
}

export interface Emergency {
  emergency_number: string;
  notice: string;
  data_verified: boolean;
  facilities: FacilitySummary[];
  ambulance_providers: ProviderSummary[];
  located_region: string | null;
}

export interface Classification {
  level: string;
  name: string;
  description: string;
}

export interface ContactRequest {
  facility_name: string;
  organization_type: string;
  phone: string;
  email: string;
  contact_name: string;
  message: string;
}

type Params = Record<string, string | number | boolean | string[] | null | undefined>;

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function request<T>(path: string, params: Params = {}, init: RequestInit = {}): Promise<T> {
  const query: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    for (const v of Array.isArray(value) ? value : [value]) {
      query.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  const url = `${API}${path}${query.length ? `?${query.join('&')}` : ''}`;

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    });
  } catch {
    throw new ApiError('Cannot reach FindCare. Check your internet connection and try again.', 0);
  }
  if (response.status === 429) {
    throw new ApiError('Too many requests. Wait a moment and try again.', 429);
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const detail = (body as { detail?: unknown } | null)?.detail;
    throw new ApiError(
      typeof detail === 'string' ? detail : 'Something went wrong. Please try again.',
      response.status
    );
  }
  return body as T;
}

export interface FacilityFilters {
  q?: string;
  category?: string;
  region?: string;
  district?: string;
  city?: string;
  type?: string;
  service?: string[];
  insurance?: string;
  is_24_hour?: boolean;
  has_ambulance?: boolean;
  lat?: number;
  lng?: number;
  page?: number;
  page_size?: number;
}

export const api = {
  health: () => request<{ data_verified: boolean; emergency_number: string }>('/health'),
  regions: () => request<string[]>('/regions'),
  districts: (region: string) => request<string[]>(`/regions/${encodeURIComponent(region)}/districts`),
  localities: (region: string, district?: string) =>
    request<string[]>(`/regions/${encodeURIComponent(region)}/localities`, { district }),
  services: () => request<string[]>('/services'),
  insurance: () => request<string[]>('/insurance'),

  // Sorted by distance when lat/lng are given, by name otherwise.
  searchFacilities: (filters: FacilityFilters) =>
    request<Page<FacilitySummary>>('/facilities/search', {
      ...filters,
      is_24_hour: filters.is_24_hour || undefined,
      has_ambulance: filters.has_ambulance || undefined,
    }),
  facility: (id: string | number, coords?: Coords | null) =>
    request<FacilityDetail>(`/facilities/${id}`, { lat: coords?.lat, lng: coords?.lng }),

  providers: (params: { region?: string; q?: string; lat?: number; lng?: number; page?: number }) =>
    request<Page<ProviderSummary>>('/ambulance/providers', { ...params, page_size: 20 }),
  covering: (coords: Coords) =>
    request<Page<ProviderSummary>>('/ambulance/covering', { lat: coords.lat, lng: coords.lng, limit: 20 }),
  provider: (id: string | number, coords?: Coords | null) =>
    request<ProviderDetail>(`/ambulance/providers/${id}`, { lat: coords?.lat, lng: coords?.lng }),

  emergency: (where: Coords | { region: string }) => request<Emergency>('/emergency', { ...where }),

  contact: (payload: ContactRequest) =>
    request<{ message: string }>('/contact', {}, { method: 'POST', body: JSON.stringify(payload) }),
};

export interface Coords {
  lat: number;
  lng: number;
}
