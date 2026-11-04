/* Ambulance providers. With the user's location, providers whose coverage
   includes it come first (PRD 5.1.6); otherwise browse by region. */
import { useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';

import { ProviderCard } from '@/components/Cards';
import { Picker } from '@/components/Picker';
import { Button, Card, DataBanner, Empty, ErrorBox, Loading, Notice } from '@/components/ui';
import { api, type ProviderSummary } from '@/lib/api';
import { call112 } from '@/lib/format';
import { useLocation } from '@/lib/location';
import { colors, radius } from '@/lib/theme';
import { useQuery } from '@/lib/useQuery';

export default function Ambulance() {
  const { coords, locating, locate, forget } = useLocation();
  const [region, setRegion] = useState('');
  const [q, setQ] = useState('');
  const [submittedQ, setSubmittedQ] = useState('');
  const [locateMessage, setLocateMessage] = useState('');

  const regions = useQuery('regions', api.regions).data ?? [];

  // Coverage search when located and not narrowing by region or name.
  const covering = Boolean(coords && !region && !submittedQ);
  const listParams = { region, q: submittedQ, lat: coords?.lat, lng: coords?.lng };
  const results = useQuery(
    covering ? `covering:${coords?.lat},${coords?.lng}` : `providers:${JSON.stringify(listParams)}`,
    () => (covering && coords ? api.covering(coords) : api.providers({ ...listParams, page: 1 }))
  );

  // Later pages of the region list, appended as the list scrolls.
  const [more, setMore] = useState<{ key: string | null; items: ProviderSummary[]; page: number }>({
    key: null,
    items: [],
    page: 1,
  });
  const [loadingMore, setLoadingMore] = useState(false);
  const extra = more.key === results.key ? more : { items: [], page: 1 };
  const items = results.data ? [...results.data.items, ...extra.items] : [];
  const pages = covering ? 1 : (results.data?.pages ?? 1);
  const loading = results.loading;
  const error = results.error;

  async function loadMore() {
    if (loading || loadingMore || !results.data || extra.page >= pages) return;
    const key = results.key;
    setLoadingMore(true);
    try {
      const body = await api.providers({ ...listParams, page: extra.page + 1 });
      setMore((prev) => ({
        key,
        items: [...(prev.key === key ? prev.items : []), ...body.items],
        page: body.page,
      }));
    } catch {
      // Leave the list as it is; scrolling again retries.
    } finally {
      setLoadingMore(false);
    }
  }

  async function findCovering() {
    setLocateMessage('');
    try {
      await locate();
      setRegion('');
      setSubmittedQ('');
      setQ('');
    } catch (err) {
      setLocateMessage((err as Error).message);
    }
  }

  const header = (
    <View style={styles.headerArea}>
      <View>
        <Text style={styles.eyebrow}>AMBULANCE SERVICES</Text>
        <Text style={styles.title}>Ambulance providers</Text>
        <Text style={styles.lede}>
          National Ambulance Service stations, private operators and hospital units that cover your area.
        </Text>
      </View>

      <Card style={styles.notDispatch}>
        <Text style={styles.notDispatchText}>
          FindCare does not dispatch ambulances. Call the provider directly, or call 112.
        </Text>
        <Button label="Call 112" icon="call" variant="danger" onPress={call112} />
      </Card>

      <DataBanner />

      <Card>
        <Button
          label={covering ? 'Showing providers covering you' : 'Find providers covering me'}
          icon="locate"
          variant={covering ? 'primary' : 'secondary'}
          loading={locating}
          onPress={findCovering}
        />
        {locateMessage ? <Notice>{locateMessage}</Notice> : null}
        {coords ? (
          <Text style={styles.link} onPress={() => { forget(); setLocateMessage(''); }} accessibilityRole="button">
            Stop using my location
          </Text>
        ) : null}
        <View style={{ height: 12 }} />
        <Picker label="Or choose a region" value={region} onChange={setRegion} options={regions.map((r) => ({ value: r, label: r }))} placeholder="All regions" />
        <TextInput
          value={q}
          onChangeText={setQ}
          onSubmitEditing={() => setSubmittedQ(q.trim())}
          placeholder="Provider name"
          placeholderTextColor={colors.muted}
          returnKeyType="search"
          style={styles.input}
          accessibilityLabel="Search by provider name"
        />
      </Card>

      <Text style={styles.resultsTitle}>{covering ? 'Covering your location' : 'Providers'}</Text>
      {loading ? <Loading message="Finding providers…" /> : null}
      {error ? <ErrorBox message={error} onRetry={results.retry} /> : null}
      {!loading && !error && items.length === 0 ? (
        <Empty message="No ambulance providers found. Try another region, or call 112." />
      ) : null}
    </View>
  );

  return (
    <FlatList
      data={loading || error ? [] : items}
      keyExtractor={(p) => String(p.id)}
      renderItem={({ item }) => <ProviderCard provider={item} />}
      ListHeaderComponent={header}
      ListFooterComponent={loadingMore ? <Loading message="Loading more…" /> : undefined}
      onEndReached={loadMore}
      onEndReachedThreshold={0.5}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.list}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, paddingBottom: 32 },
  headerArea: { gap: 14, marginBottom: 12 },
  eyebrow: { color: colors.brand, fontSize: 12, fontWeight: '800', letterSpacing: 1.2 },
  title: { fontSize: 26, fontWeight: '800', color: colors.ink, marginTop: 2 },
  lede: { fontSize: 15, color: colors.inkSoft, lineHeight: 22, marginTop: 4 },
  notDispatch: { gap: 10, borderColor: '#f0bcbc', backgroundColor: colors.redTint },
  notDispatchText: { color: colors.redDark, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  link: { color: colors.brandDark, fontWeight: '700', marginTop: 10, textDecorationLine: 'underline' },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.white,
  },
  resultsTitle: { fontSize: 20, fontWeight: '800', color: colors.ink },
});
