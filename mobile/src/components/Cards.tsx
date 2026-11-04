/* Facility and ambulance-provider cards. Every list renders through these,
   so staleness and verification labels cannot drift between screens. */
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Beds, FacilitySummary, FleetStatus, ProviderSummary } from '@/lib/api';
import {
  CATEGORY_LABEL,
  COST_LABEL,
  OPERATOR_LABEL,
  call,
  directions,
  fmtDistance,
  isHealthFacility,
  placeLine,
} from '@/lib/format';
import { colors, radius } from '@/lib/theme';

import { Button, Card, Chip, ChipRow } from './ui';

export function FacilityKindChips({ facility }: { facility: FacilitySummary }) {
  return (
    <>
      <Chip label={CATEGORY_LABEL[facility.category] ?? facility.category} />
      {isHealthFacility(facility) ? <Chip label={facility.classification} /> : null}
      <Chip label={facility.type === 'government' ? 'Government' : 'Private'} tone="grey" />
    </>
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
  action: { flexGrow: 1, flexBasis: 96 },
});
