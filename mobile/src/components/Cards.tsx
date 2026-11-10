/* Facility and ambulance-provider cards. Every list renders through these,
   so staleness and verification labels cannot drift between screens. */
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Beds, Busy, FacilitySummary, FleetStatus, ProviderSummary } from '@/lib/api';
import {
  BUSY_SOURCE,
  CARE_TYPE_LABEL,
  CATEGORY_LABEL,
  COST_LABEL,
  OPERATOR_LABEL,
  call,
  directions,
  fmtDistance,
  fmtWhen,
  isHealthFacility,
  placeLine,
} from '@/lib/format';
import { colors, radius } from '@/lib/theme';

import { Button, Card, Chip, ChipRow } from './ui';

/* Category, GHS level, other kinds of care ("+ Laboratory"), ownership. */
export function FacilityKindChips({ facility }: { facility: FacilitySummary }) {
  const extra = (facility.care_types ?? []).filter((t) => t !== facility.category);
  return (
    <>
      <Chip label={CATEGORY_LABEL[facility.category] ?? facility.category} />
      {/* Only a known category; "Private" (older data) would repeat the ownership chip. */}
      {isHealthFacility(facility) && !['Private', 'Not classified'].includes(facility.classification) ? (
        <Chip label={facility.classification} />
      ) : null}
      {extra.slice(0, 3).map((t) => (
        <Chip key={t} label={`+ ${CARE_TYPE_LABEL[t] ?? t}`} tone={t === 'laboratory' ? 'lab' : 'care'} />
      ))}
      {extra.length > 3 ? <Chip label={`+${extra.length - 3} more`} tone="care" /> : null}
      <Chip label={facility.type === 'government' ? 'Government' : 'Private'} tone="grey" />
    </>
  );
}

/* Red busy, yellow less busy, green not busy, grey outside opening hours. */
export const BUSY_COLOURS: Record<Busy['level'], { dot: string; bg: string; fg: string; border: string }> = {
  busy: { dot: '#dc2626', bg: '#fdecec', fg: '#9b1616', border: '#f5b5b5' },
  less_busy: { dot: '#eab308', bg: '#fef9c3', fg: '#713f12', border: '#f3dc6b' },
  not_busy: { dot: '#16a34a', bg: '#e6f5ee', fg: '#05683b', border: '#a9dcbf' },
  unknown: { dot: '#94a3b8', bg: '#f1f5f9', fg: colors.inkSoft, border: colors.line },
};

export function BusyBadge({ busy }: { busy: Busy | null }) {
  if (!busy) return null;
  const c = BUSY_COLOURS[busy.level];
  const when = busy.updated_at ? ` · ${fmtWhen(busy.updated_at)}` : '';
  return (
    <View
      style={[styles.busy, { backgroundColor: c.bg, borderColor: c.border }]}
      accessibilityLabel={`${busy.label}. ${busy.detail}`}>
      <View style={[styles.dot, { backgroundColor: c.dot }]} />
      <Text style={[styles.busyLabel, { color: c.fg }]}>{busy.label}</Text>
      <Text style={[styles.busySource, { color: c.fg }]}>{BUSY_SOURCE[busy.source] + when}</Text>
    </View>
  );
}

export function BusyLegend() {
  return (
    <View style={styles.legend} accessibilityLabel="Colours: red busy, yellow less busy, green not busy">
      {(['busy', 'less_busy', 'not_busy'] as const).map((level) => (
        <View key={level} style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: BUSY_COLOURS[level].dot }]} />
          <Text style={styles.legendText}>
            {level === 'busy' ? 'Busy' : level === 'less_busy' ? 'Less busy' : 'Not busy'}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function StatusLine({ status }: { status: Beds | FleetStatus | null }) {
  if (!status) return null;
  return (
    <Text style={[styles.status, status.is_stale ? styles.stale : styles.fresh]}>{status.display}</Text>
  );
}

export function FacilityCard({ facility }: { facility: FacilitySummary }) {
  const open = () => router.push({ pathname: '/facility/[id]', params: { id: String(facility.id) } });
  return (
    <Card style={styles.card}>
      <Pressable onPress={open} accessibilityRole="link" accessibilityHint="Opens the facility profile">
        <View style={styles.top}>
          <Text style={styles.name}>{facility.name}</Text>
          {facility.distance_km !== null ? (
            <Text style={styles.distance}>{fmtDistance(facility.distance_km)}</Text>
          ) : null}
        </View>
        <Text style={styles.meta}>{placeLine(facility.town, facility.city, facility.district, facility.region)}</Text>
        <BusyBadge busy={facility.busy} />
        <ChipRow>
          <FacilityKindChips facility={facility} />
          {facility.is_24_hour ? <Chip label="Open 24 hours" tone="green" /> : null}
          {facility.has_ambulance ? <Chip label="Ambulance" tone="red" /> : null}
          {facility.services.includes('Dental') ? <Chip label="Dental" tone="dental" /> : null}
          {facility.verified ? <Chip label="Verified" tone="green" /> : null}
        </ChipRow>
        {isHealthFacility(facility) ? <StatusLine status={facility.beds} /> : null}
      </Pressable>
      <View style={styles.actions}>
        {facility.phone ? (
          <Button label="Call" icon="call" onPress={() => call(facility.phone)} style={styles.action} />
        ) : null}
        <Button
          label="Directions"
          icon="navigate"
          variant="secondary"
          onPress={() => directions(facility.lat, facility.lng)}
          style={styles.action}
        />
        <Button label="Details" variant="secondary" onPress={open} style={styles.action} />
      </View>
    </Card>
  );
}

export function ProviderCard({ provider }: { provider: ProviderSummary }) {
  const open = () => router.push({ pathname: '/provider/[id]', params: { id: String(provider.id) } });
  return (
    <Card style={styles.card}>
      <Pressable onPress={open} accessibilityRole="link" accessibilityHint="Opens the provider profile">
        <View style={styles.top}>
          <Text style={styles.name}>{provider.name}</Text>
          {provider.distance_km !== null ? (
            <Text style={styles.distance}>{fmtDistance(provider.distance_km)}</Text>
          ) : null}
        </View>
        <Text style={styles.meta}>{placeLine(provider.district, provider.region)}</Text>
        <ChipRow>
          <Chip
            label={provider.service_level === 'ALS' ? 'ALS · Advanced' : 'BLS · Basic'}
            tone={provider.service_level === 'ALS' ? 'green' : 'brand'}
          />
          <Chip label={OPERATOR_LABEL[provider.operator_type]} tone="grey" />
          {provider.covers_user_area === true ? <Chip label="Covers your area" tone="green" /> : null}
          {provider.covers_user_area === false ? <Chip label="Outside your area" tone="amber" /> : null}
          {provider.cost_band ? (
            <Chip label={COST_LABEL[provider.cost_band] ?? provider.cost_band} tone="grey" />
          ) : null}
          {!provider.phone_verified_at ? <Chip label="Number not verified" tone="amber" /> : null}
        </ChipRow>
        <StatusLine status={provider.status} />
      </Pressable>
      <View style={styles.actions}>
        <Button label="Call provider" icon="call" variant="danger" onPress={() => call(provider.phone)} style={styles.action} />
        <Button label="Details" variant="secondary" onPress={open} style={styles.action} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 12 },
  top: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' },
  name: { flex: 1, fontSize: 17, fontWeight: '800', color: colors.ink },
  distance: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.brandDark,
    backgroundColor: colors.brandTint,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  meta: { fontSize: 14, color: colors.inkSoft, marginTop: 3 },
  status: {
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.sm,
    fontSize: 14,
    fontWeight: '600',
    overflow: 'hidden',
  },
  fresh: { backgroundColor: colors.greenTint, color: colors.green },
  stale: { backgroundColor: '#f1f5f9', color: colors.inkSoft, fontWeight: '500' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  busy: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 8,
    paddingLeft: 9,
    paddingRight: 11,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  dot: { width: 11, height: 11, borderRadius: 6 },
  busyLabel: { fontSize: 13.5, fontWeight: '800' },
  busySource: { fontSize: 12.5, opacity: 0.85 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendText: { fontSize: 13, color: colors.inkSoft },
  action: { flexGrow: 1, flexBasis: 96 },
});
