import { Linking } from 'react-native';

import type { Category, FacilitySummary, ProviderSummary } from './api';

export const CATEGORY_LABEL: Record<Category, string> = {
  hospital: 'Hospital',
  clinic: 'Clinic',
  pharmacy: 'Pharmacy / medical store',
  hearse: 'Hearse service',
  caregiver: 'Caregiver',
};

export const COST_LABEL: Record<string, string> = {
  free: 'No charge',
  low: 'Low cost',
  moderate: 'Moderate cost',
  premium: 'Premium cost',
};

export const OPERATOR_LABEL: Record<ProviderSummary['operator_type'], string> = {
  government: 'Government',
  private: 'Private',
  facility_attached: 'Hospital unit',
};

/* Beds and GHS levels only mean something for hospitals and clinics. */
export function isHealthFacility(facility: Pick<FacilitySummary, 'category'>): boolean {
  return facility.category === 'hospital' || facility.category === 'clinic';
}

export function fmtDistance(km: number | null | undefined): string {
  if (km === null || km === undefined) return '';
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

export function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const then = new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
  const mins = Math.floor((Date.now() - then.getTime()) / 60000);
  if (Number.isNaN(mins)) return 'unknown';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/* "Kwadaso North, Kumasi, Kwadaso Municipal" without repeats or blanks. */
export function placeLine(...parts: (string | null | undefined)[]): string {
  return [...new Set(parts.filter((p): p is string => Boolean(p && p.trim())))].join(', ');
}

export function call(phone: string) {
  const digits = phone.replace(/[^\d+]/g, '');
  if (digits) Linking.openURL(`tel:${digits}`);
}

export function directions(lat: number, lng: number) {
  Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`);
}

export function call112() {
  Linking.openURL('tel:112');
}
