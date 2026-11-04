/* Ambulance provider profile (PRD 5.1.6). */
import { Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { StatusLine } from '@/components/Cards';
import { Button, Card, Chip, ChipRow, DataBanner, ErrorBox, Loading, Notice, SectionTitle } from '@/components/ui';
import { api } from '@/lib/api';
import { COST_LABEL, OPERATOR_LABEL, call, call112, directions, fmtDistance, fmtWhen, placeLine } from '@/lib/format';
import { useLocation } from '@/lib/location';
import { colors } from '@/lib/theme';
import { useQuery } from '@/lib/useQuery';

export default function ProviderProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { coords } = useLocation();
  const query = useQuery(`provider:${id}:${coords?.lat},${coords?.lng}`, () => api.provider(id, coords));
  const provider = query.data;

  if (query.error) {
    return <View style={styles.page}><ErrorBox message={query.error} onRetry={query.retry} /></View>;
  }
  if (!provider) return <View style={styles.page}><Loading message="Loading provider…" /></View>;

  const details: [string, string][] = [
    ['Base', placeLine(provider.base_address, provider.district, provider.region)],
    ['Hours', provider.hours || 'Not recorded'],
    ['Cost', COST_LABEL[provider.cost_band] ?? provider.cost_band],
    ['Dispatch number', provider.phone],
    ['Second number', provider.alt_phone],
    ['Number verified', provider.phone_verified_at ? fmtWhen(provider.phone_verified_at) : 'Not yet verified'],
    ['Record last updated', fmtWhen(provider.last_updated)],
  ];

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Stack.Screen options={{ title: provider.name }} />
      <DataBanner />

      <View>
        <Text style={styles.name}>{provider.name}</Text>
        <Text style={styles.place}>{placeLine(provider.district, provider.region)}</Text>
        {provider.distance_km !== null ? (
          <Text style={styles.distance}>{fmtDistance(provider.distance_km)} from you</Text>
        ) : null}
        <ChipRow>
          <Chip
            label={provider.service_level === 'ALS' ? 'ALS · Advanced life support' : 'BLS · Basic life support'}
            tone={provider.service_level === 'ALS' ? 'green' : 'brand'}
          />
          <Chip label={OPERATOR_LABEL[provider.operator_type]} tone="grey" />
          {!provider.phone_verified_at ? <Chip label="Number not verified" tone="amber" /> : null}
        </ChipRow>
      </View>

      <Card style={styles.warn}>
        <Text style={styles.warnText}>
          FindCare does not dispatch ambulances. Call the provider yourself. If they do not answer, call 112.
        </Text>
      </Card>

      <View style={styles.actions}>
        <Button label="Call provider" icon="call" variant="danger" onPress={() => call(provider.phone)} style={styles.action} />
        {provider.alt_phone ? (
          <Button label="Second number" icon="call" variant="secondary" onPress={() => call(provider.alt_phone)} style={styles.action} />
        ) : null}
        <Button label="Call 112" icon="call" variant="dark" onPress={call112} style={styles.action} />
      </View>

      <Card>
        <SectionTitle>Fleet status</SectionTitle>
        <StatusLine status={provider.status} />
        {provider.status?.is_stale !== false ? (
          <Notice>The provider has not updated its fleet in the last 24 hours. Call to check availability.</Notice>
        ) : null}
      </Card>

      <Card>
        <SectionTitle>Areas covered</SectionTitle>
        {provider.coverage.length ? (
          <ChipRow>
            {provider.coverage.map((c) => (
              <Chip key={`${c.region}/${c.district}`} label={c.district ? `${c.district}, ${c.region}` : `All of ${c.region}`} />
            ))}
          </ChipRow>
        ) : (
          <Notice>No coverage areas recorded.</Notice>
        )}
      </Card>

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
        <Button
          label="Directions to base"
          icon="navigate"
          variant="secondary"
          onPress={() => directions(provider.lat, provider.lng)}
          style={{ marginTop: 12 }}
        />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 40, gap: 14 },
  name: { fontSize: 24, fontWeight: '800', color: colors.ink, letterSpacing: -0.3 },
  place: { fontSize: 15, color: colors.inkSoft, marginTop: 4 },
  distance: { fontSize: 14, fontWeight: '700', color: colors.brandDark, marginTop: 4 },
  warn: { borderColor: '#f0bcbc', backgroundColor: colors.redTint },
  warnText: { color: colors.redDark, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  action: { flexGrow: 1, flexBasis: 140 },
  kv: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  k: { fontSize: 12, fontWeight: '700', color: colors.inkSoft, letterSpacing: 0.5 },
  v: { fontSize: 15.5, color: colors.ink, marginTop: 2 },
});
