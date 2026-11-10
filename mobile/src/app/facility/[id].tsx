/* Facility profile (PRD 5.1.3). */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BUSY_COLOURS, BusyLegend, FacilityKindChips, StatusLine } from '@/components/Cards';
import {
  Button,
  Card,
  Chip,
  ChipRow,
  DataBanner,
  ErrorBox,
  Feedback,
  Loading,
  Notice,
  SectionTitle,
} from '@/components/ui';
import { api, type Busy, type BusyLevel, type FacilityDetail } from '@/lib/api';
import { CARE_TYPE_LABEL, WARD_LABEL, call, directions, fmtDistance, fmtWhen, isHealthFacility, placeLine } from '@/lib/format';
import { useLocation } from '@/lib/location';
import { colors, radius } from '@/lib/theme';
import { useQuery } from '@/lib/useQuery';

/* Credit required by the open-data licences of imported records. */
const SOURCE_CREDIT: Record<string, string> = {
  osm: 'Listing data from OpenStreetMap contributors (ODbL). Not yet confirmed by the facility.',
  'who-ssa': 'Listing data from the WHO list of public health facilities in sub-Saharan Africa (CC BY 4.0). Not yet confirmed by the facility.',
};

const BUSY_CHOICES: { level: BusyLevel; label: string; hint: string }[] = [
  { level: 'busy', label: 'Busy', hint: 'Long queue' },
  { level: 'less_busy', label: 'Less busy', hint: 'Some wait' },
  { level: 'not_busy', label: 'Not busy', hint: 'Little or no wait' },
];

/* The current status, and three buttons for someone there to say how busy
   it is. Visitor reports last 90 minutes and are averaged. */
function BusyCard({ facility }: { facility: FacilityDetail }) {
  const [busy, setBusy] = useState<Busy>(facility.busy as Busy);
  const [sending, setSending] = useState<BusyLevel | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const c = BUSY_COLOURS[busy.level];

  async function report(choice: (typeof BUSY_CHOICES)[number]) {
    setSending(choice.level);
    setResult(null);
    try {
      setBusy(await api.reportBusy(facility.id, choice.level));
      setResult({ ok: true, message: `Thank you. You reported "${choice.label}". It helps the next person decide where to go.` });
    } catch (err) {
      setResult({ ok: false, message: (err as Error).message });
    } finally {
      setSending(null);
    }
  }

  return (
    <Card>
      <SectionTitle>How busy is it now?</SectionTitle>
      <View style={[styles.busyNow, { backgroundColor: c.bg, borderColor: c.border }]} accessibilityLiveRegion="polite">
        <View style={[styles.busyDot, { backgroundColor: c.dot }]} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.busyLabel, { color: c.fg }]}>{busy.label}</Text>
          <Text style={styles.busyDetail}>
            {busy.detail + (busy.updated_at ? ` · ${fmtWhen(busy.updated_at)}` : '') + '.'}
          </Text>
        </View>
      </View>
      <BusyLegend />
      <Notice>
        Predictions come from the usual pattern for this kind of place and past reports. Call before travelling if it
        matters.
      </Notice>
      <Text style={styles.ask}>Are you there now? Tell others how busy it is</Text>
      <View style={styles.choices}>
        {BUSY_CHOICES.map((choice) => (
          <Pressable
            key={choice.level}
            onPress={() => report(choice)}
            disabled={sending !== null}
            accessibilityRole="button"
            accessibilityState={{ disabled: sending !== null, busy: sending === choice.level }}
            style={({ pressed }) => [
              styles.choice,
              pressed && { borderColor: BUSY_COLOURS[choice.level].dot },
              sending === choice.level && styles.choiceSending,
            ]}>
            <View style={[styles.choiceDot, { backgroundColor: BUSY_COLOURS[choice.level].dot }]} />
            <Text style={styles.choiceLabel}>{sending === choice.level ? 'Sending…' : choice.label}</Text>
            <Text style={styles.choiceHint}>{choice.hint}</Text>
          </Pressable>
        ))}
      </View>
      {result ? <Feedback kind={result.ok ? 'ok' : 'error'} message={result.message} /> : null}
    </Card>
  );
}

/* Services grouped by the part of the facility that offers them; a single
   group needs no heading. */
function ServicesCard({ facility }: { facility: FacilityDetail }) {
  const groups = new Map<string, string[]>(facility.care_types.map((t) => [t, []]));
  for (const s of facility.service_detail) {
    if (!s.is_active) continue;
    const type = s.care_type || facility.category;
    groups.set(type, [...(groups.get(type) ?? []), s.service_name]);
  }
  const filled = [...groups].filter(([, names]) => names.length);
  const paused = facility.service_detail.filter((s) => !s.is_active).map((s) => s.service_name);
  return (
    <Card>
      <SectionTitle>Services</SectionTitle>
      {!filled.length ? <Notice>No services recorded.</Notice> : null}
      {filled.map(([type, names]) => (
        <View key={type}>
          {filled.length > 1 ? (
            <Text style={styles.group}>{(CARE_TYPE_LABEL[type as keyof typeof CARE_TYPE_LABEL] ?? type).toUpperCase()}</Text>
          ) : null}
          <ChipRow>
            {names.map((s) => <Chip key={s} label={s} tone={s === 'Dental' ? 'dental' : 'brand'} />)}
          </ChipRow>
        </View>
      ))}
      {paused.length ? (
        <>
          <Notice>Temporarily unavailable:</Notice>
          <ChipRow>{paused.map((s) => <Chip key={s} label={s} tone="amber" />)}</ChipRow>
        </>
      ) : null}
    </Card>
  );
}

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
    ['Medical facility category', health ? facility.classification : ''],
    ['Wards', health ? facility.wards.map((w) => WARD_LABEL[w]).join(', ') || 'Not recorded' : ''],
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

      {facility.busy ? <BusyCard key={facility.id} facility={facility} /> : null}

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

      <ServicesCard facility={facility} />

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
  busyNow: {
    flexDirection: 'row',
    gap: 14,
    alignItems: 'flex-start',
    padding: 14,
    borderRadius: radius.sm,
    borderWidth: 1,
    marginBottom: 12,
  },
  busyDot: { width: 22, height: 22, borderRadius: 11, marginTop: 3 },
  busyLabel: { fontSize: 20, fontWeight: '800' },
  busyDetail: { fontSize: 14, color: colors.inkSoft, marginTop: 2, lineHeight: 20 },
  ask: { fontSize: 15.5, fontWeight: '800', color: colors.ink, marginTop: 16, marginBottom: 10 },
  choices: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  choice: {
    flex: 1,
    alignItems: 'center',
    gap: 5,
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.white,
  },
  choiceSending: { backgroundColor: '#e2e8f0', borderColor: '#cbd5e1' },
  choiceDot: { width: 16, height: 16, borderRadius: 8 },
  choiceLabel: { fontSize: 14.5, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  choiceHint: { fontSize: 12, color: colors.inkSoft, textAlign: 'center' },
  group: { fontSize: 12, fontWeight: '700', color: colors.inkSoft, letterSpacing: 0.6, marginTop: 12 },
});
