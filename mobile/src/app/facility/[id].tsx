/* Facility profile (PRD 5.1.3). */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FacilityKindChips, StatusLine } from '@/components/Cards';
import { Button, Card, Chip, ChipRow, DataBanner, ErrorBox, Loading, Notice, SectionTitle } from '@/components/ui';
import { api } from '@/lib/api';
import { call, directions, fmtDistance, fmtWhen, isHealthFacility, placeLine } from '@/lib/format';
import { useLocation } from '@/lib/location';
import { colors } from '@/lib/theme';
import { useQuery } from '@/lib/useQuery';

/* Credit required by the open-data licences of imported records. */
const SOURCE_CREDIT: Record<string, string> = {
  osm: 'Listing data from OpenStreetMap contributors (ODbL). Not yet confirmed by the facility.',
  'who-ssa': 'Listing data from the WHO list of public health facilities in sub-Saharan Africa (CC BY 4.0). Not yet confirmed by the facility.',
};

export default function FacilityProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { coords } = useLocation();
  const query = useQuery(`facility:${id}:${coords?.lat},${coords?.lng}`, () => api.facility(id, coords));
  const facility = query.data;

  if (query.error) {
    return <View style={styles.page}><ErrorBox message={query.error} onRetry={query.retry} /></View>;
  }
  if (!facility) return <View style={styles.page}><Loading message="Loading facility…" /></View>;

  const health = isHealthFacility(facility);
  const credit = SOURCE_CREDIT[facility.source.replace('+seed', '')];
  const details: [string, string][] = [
    ['Opening hours', facility.hours || 'Not recorded'],
    ['Phone', facility.phone || 'Not recorded'],
    ['Region', facility.region],
    ['District / municipal', facility.district],
    ['City or town', facility.city || 'Not recorded'],
    ['Community', facility.town !== facility.city ? facility.town : ''],
    ['Address', facility.address],
    ['GPS coordinates', `${facility.lat.toFixed(5)}, ${facility.lng.toFixed(5)}`],
    ['Last verified', facility.last_verified ? fmtWhen(facility.last_verified) : 'Never verified by this facility'],
    ['Record last updated', fmtWhen(facility.last_updated)],
  ];

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Stack.Screen options={{ title: facility.name }} />
      <DataBanner />

      <View>
        <Text style={styles.name}>{facility.name}</Text>
        <Text style={styles.place}>{placeLine(facility.town, facility.city, facility.district, facility.region)}</Text>
        {facility.distance_km !== null ? (
          <Text style={styles.distance}>{fmtDistance(facility.distance_km)} from you</Text>
        ) : null}
        <ChipRow>
          <FacilityKindChips facility={facility} />
          {facility.is_24_hour ? <Chip label="Open 24 hours" tone="green" /> : null}
          <Chip label={facility.verified ? 'Verified' : 'Unverified'} tone={facility.verified ? 'green' : 'grey'} />
        </ChipRow>
      </View>

      <View style={styles.actions}>
        {facility.phone ? (
          <Button label="Call facility" icon="call" onPress={() => call(facility.phone)} style={styles.action} />
        ) : null}
        <Button
          label="Directions"
          icon="navigate"
          variant="secondary"
          onPress={() => directions(facility.lat, facility.lng)}
          style={styles.action}
        />
      </View>

      {health ? (
        <Card>
          <SectionTitle>Bed availability</SectionTitle>
          <StatusLine status={facility.beds} />
          {facility.beds?.is_stale !== false ? (
            <Notice>This facility has not updated its bed count in the last 24 hours. Call before travelling.</Notice>
          ) : null}
        </Card>
      ) : null}

      {health ? (
        <Card>
          <SectionTitle>Ambulance</SectionTitle>
          {facility.has_ambulance ? (
            <>
              <Text style={styles.body}>This facility operates its own ambulance.</Text>
              {facility.ambulance_phone ? (
                <Button
                  label="Call ambulance"
                  icon="call"
                  variant="danger"
                  onPress={() => call(facility.ambulance_phone)}
                  style={{ marginTop: 10 }}
                />
              ) : null}
            </>
          ) : (
            <Text style={styles.body}>This facility does not operate its own ambulance.</Text>
          )}
          <Button
            label="Find ambulance providers"
            variant="secondary"
            onPress={() => router.push('/ambulance')}
            style={{ marginTop: 10 }}
          />
        </Card>
      ) : null}

      <Card>
        <SectionTitle>Services</SectionTitle>
        {facility.services.length ? (
          <ChipRow>
            {facility.services.map((s) => (
              <Chip key={s} label={s} tone={s === 'Dental' ? 'dental' : 'brand'} />
            ))}
          </ChipRow>
        ) : (
          <Notice>No services recorded.</Notice>
        )}
      </Card>

      {health ? (
        <Card>
          <SectionTitle>Insurance accepted</SectionTitle>
          {facility.insurance.length ? (
            <ChipRow>
              {facility.insurance.map((i) => <Chip key={i} label={i} tone="green" />)}
            </ChipRow>
          ) : (
            <Notice>No insurance information recorded.</Notice>
          )}
        </Card>
      ) : null}

      <Card>
        <SectionTitle>Details</SectionTitle>
        {details
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <View key={label} style={styles.kv}>
              <Text style={styles.k}>{label.toUpperCase()}</Text>
              <Text style={styles.v} selectable>{value}</Text>
            </View>
          ))}
        {/^https?:\/\//.test(facility.website) ? (
          <View style={styles.kv}>
            <Text style={styles.k}>WEBSITE</Text>
            <Text style={[styles.v, styles.link]} onPress={() => Linking.openURL(facility.website)} accessibilityRole="link">
              {facility.website.replace(/^https?:\/\//, '')}
            </Text>
          </View>
        ) : null}
        {credit ? <Notice>{credit}</Notice> : null}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 40, gap: 14 },
  name: { fontSize: 24, fontWeight: '800', color: colors.ink, letterSpacing: -0.3 },
  place: { fontSize: 15, color: colors.inkSoft, marginTop: 4, lineHeight: 21 },
  distance: { fontSize: 14, fontWeight: '700', color: colors.brandDark, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  action: { flexGrow: 1, flexBasis: 140 },
  body: { fontSize: 15, color: colors.ink, lineHeight: 21 },
  kv: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  k: { fontSize: 12, fontWeight: '700', color: colors.inkSoft, letterSpacing: 0.5 },
  v: { fontSize: 15.5, color: colors.ink, marginTop: 2 },
  link: { color: colors.brandDark, textDecorationLine: 'underline' },
});
