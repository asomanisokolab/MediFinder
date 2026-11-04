/* Emergency mode (PRD 5.1.4): nearest open facilities and the ambulance
   providers covering the user, with 112 always first. Falls back to a
   region choice when location is unavailable. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FacilityCard, ProviderCard } from '@/components/Cards';
import { Picker } from '@/components/Picker';
import { Button, Empty, ErrorBox, Loading, Notice } from '@/components/ui';
import { api, type Coords } from '@/lib/api';
import { call112 } from '@/lib/format';
import { useLocation } from '@/lib/location';
import { colors, radius } from '@/lib/theme';
import { useQuery } from '@/lib/useQuery';

type Where = Coords | { region: string };

export default function EmergencyScreen() {
  const { locate } = useLocation();
  // Where to search: GPS first; a region if location is unavailable.
  const [where, setWhere] = useState<Where | null>(null);
  const [locationProblem, setLocationProblem] = useState('');
  const [region, setRegion] = useState('');

  useEffect(() => {
    let live = true;
    locate().then(
      (coords) => {
        if (live) setWhere(coords);
      },
      (err: Error) => {
        if (live) setLocationProblem(err.message);
      }
    );
    return () => {
      live = false;
    };
  }, [locate]);

  function retryLocation() {
    setLocationProblem('');
    setWhere(null);
    locate().then(setWhere, (err: Error) => setLocationProblem(err.message));
  }

  const regions = useQuery(locationProblem ? 'regions' : null, api.regions).data ?? [];
  const result = useQuery(where ? JSON.stringify(where) : null, () => api.emergency(where as Where));
  const status = !where && !locationProblem ? 'Finding your location…' : result.loading ? 'Finding the nearest help…' : '';

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Pressable
        onPress={call112}
        accessibilityRole="button"
        accessibilityLabel="Call 112 now"
        style={({ pressed }) => [styles.call112, pressed && { backgroundColor: colors.redDark }]}>
        <Ionicons name="call" size={28} color={colors.white} />
        <View>
          <Text style={styles.call112Title}>Call 112 now</Text>
          <Text style={styles.call112Sub}>{"Ghana's national emergency number"}</Text>
        </View>
      </Pressable>

      {locationProblem ? (
        <View style={styles.box}>
          <ErrorBox message={locationProblem} />
          <Picker
            label="Your region"
            value={region}
            onChange={(r) => {
              setRegion(r);
              if (r) setWhere({ region: r });
            }}
            options={regions.map((r) => ({ value: r, label: r }))}
            placeholder={null}
          />
          <Button label="Try my location again" icon="locate" variant="secondary" onPress={retryLocation} />
        </View>
      ) : null}

      {status ? <Loading message={status} /> : null}
      {result.error ? <ErrorBox message={result.error} onRetry={result.retry} /> : null}

      {result.data ? (
        <>
          <Text style={styles.notice}>{result.data.notice}</Text>
          {result.data.located_region ? <Notice>Your region: {result.data.located_region}</Notice> : null}

          <Text style={styles.heading}>Nearest facilities</Text>
          {result.data.facilities.length ? (
            result.data.facilities.map((f) => <FacilityCard key={f.id} facility={f} />)
          ) : (
            <Empty message="No facilities found nearby. Call 112." />
          )}

          <Text style={styles.heading}>Ambulance providers</Text>
          {result.data.ambulance_providers.length ? (
            result.data.ambulance_providers.map((p) => <ProviderCard key={p.id} provider={p} />)
          ) : (
            <Empty message="No ambulance provider found for your area. Call 112." />
          )}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 40, gap: 14 },
  call112: {
    backgroundColor: colors.red,
    borderRadius: radius.md,
    minHeight: 76,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  call112Title: { color: colors.white, fontSize: 22, fontWeight: '800' },
  call112Sub: { color: 'rgba(255,255,255,0.9)', fontSize: 14 },
  box: { gap: 12 },
  notice: {
    backgroundColor: colors.redTint,
    borderLeftWidth: 4,
    borderLeftColor: colors.red,
    padding: 12,
    borderRadius: 6,
    color: colors.ink,
    fontSize: 14,
    lineHeight: 20,
  },
  heading: { fontSize: 19, fontWeight: '800', color: colors.red, marginTop: 6 },
});
