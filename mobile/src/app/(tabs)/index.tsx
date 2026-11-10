/* Find care: emergency entry point, search and filters, results. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { BusyLegend, FacilityCard } from '@/components/Cards';
import { Picker, type Option } from '@/components/Picker';
import { Button, DataBanner, Feedback, Loading, Notice, Toggle } from '@/components/ui';
import { api, type FacilityFilters, type FacilitySummary, type Page } from '@/lib/api';
import { CATEGORY_LABEL } from '@/lib/format';
import { useLocation } from '@/lib/location';
import { colors, radius, shadow } from '@/lib/theme';
import { useQuery } from '@/lib/useQuery';

const CATEGORIES: Option[] = [
  { value: '', label: 'All care' },
  { value: 'hospital', label: 'Hospitals' },
  { value: 'clinic', label: 'Clinics' },
  { value: 'laboratory', label: 'Laboratories' },
  { value: 'pharmacy', label: 'Pharmacies' },
  { value: 'imaging', label: 'Scan and X-ray' },
  { value: 'dental', label: 'Dental' },
  { value: 'eye', label: 'Eye care' },
  { value: 'maternity', label: 'Maternity' },
  { value: 'hearse', label: 'Hearse' },
  { value: 'caregiver', label: 'Caregivers' },
];
const OWNERSHIP: Option[] = [
  { value: 'government', label: 'Government' },
  { value: 'private', label: 'Private' },
];
const toOptions = (values: string[] | undefined): Option[] =>
  (values ?? []).map((v) => ({ value: v, label: v }));

/* What "Looking for" finds, in words: a laboratory search also finds
   hospitals and clinics that run one. */
const RESULT_NOUN: Record<string, [string, string]> = {
  hospital: ['hospital', 'hospitals'],
  clinic: ['clinic', 'clinics'],
  laboratory: ['place with a laboratory', 'places with a laboratory'],
  pharmacy: ['pharmacy', 'pharmacies'],
  imaging: ['place for scans and X-rays', 'places for scans and X-rays'],
  dental: ['place for dental care', 'places for dental care'],
  eye: ['place for eye care', 'places for eye care'],
  maternity: ['place for maternity care', 'places for maternity care'],
  hearse: ['hearse service', 'hearse services'],
  caregiver: ['caregiver', 'caregivers'],
};

function plural(count: number, one: string, many: string) {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

/* One sentence saying what was found, in the words the user searched with. */
function describeResults(body: Page<FacilitySummary>, filters: FacilityFilters, nearest: boolean) {
  const [one, many] = RESULT_NOUN[filters.category ?? ''] ?? ['facility', 'facilities'];
  if (body.matched_place) {
    const inPlace = body.place_total ?? body.total;
    let text = `Found ${plural(inPlace, one, many)} in ${body.matched_place}`;
    if (body.total > inPlace) text += `, and ${(body.total - inPlace).toLocaleString()} named after it elsewhere`;
    return `${text}.`;
  }
  let text = `Found ${plural(body.total, one, many)}`;
  if (filters.q) text += ` for “${filters.q}”`;
  const where = [filters.city, filters.district, filters.region].find(Boolean);
  if (where) text += ` in ${where}`;
  if (nearest) text += ', nearest first';
  return `${text}.`;
}

export default function FindCare() {
  const { coords, locating, locate, forget } = useLocation();

  const [q, setQ] = useState('');
  // Suggestions follow the typed text after a short pause.
  const [suggestText, setSuggestText] = useState('');
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [category, setCategory] = useState('');
  const [region, setRegion] = useState('');
  const [district, setDistrict] = useState('');
  const [city, setCity] = useState('');
  const [ownership, setOwnership] = useState('');
  const [service, setService] = useState('');
  const [insurance, setInsurance] = useState('');
  const [is24, setIs24] = useState(false);
  const [hasAmbulance, setHasAmbulance] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [locateMessage, setLocateMessage] = useState('');

  // The choices above are only a draft; this is the search actually shown.
  // It changes when the user presses Search, so choosing does not search.
  const [applied, setApplied] = useState<FacilityFilters>({});
  // After pressing Search the form folds away if anything is found.
  const [wantFold, setWantFold] = useState(false);
  const listRef = useRef<FlatList<FacilitySummary>>(null);
  const pendingScroll = useRef(false);

  function runSearch(text = q) {
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    const typed = text.trim();
    setQ(text);
    setSuggestText(typed);
    setApplied({
      q: typed,
      category,
      region,
      district,
      city,
      type: ownership,
      service: service ? [service] : undefined,
      insurance,
      is_24_hour: is24,
      has_ambulance: hasAmbulance,
    });
    setWantFold(true);
    pendingScroll.current = true;
  }

  function changeQ(text: string) {
    setQ(text);
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    suggestTimer.current = setTimeout(() => setSuggestText(text.trim()), 250);
  }
  function clearSearch() {
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    setQ('');
    setSuggestText('');
  }
  const submittedQ = applied.q ?? '';
  const suggestions = useQuery(suggestText.length >= 2 ? `suggest:${suggestText}` : null, () =>
    api.suggest(suggestText)
  );
  // Hidden once the text has been searched, or while it is still changing.
  const showSuggestions =
    suggestText.length >= 2 &&
    suggestText !== submittedQ &&
    q.trim() === suggestText &&
    !!suggestions.data &&
    suggestions.data.places.length + suggestions.data.facilities.length > 0;

  // Dropdown lists. Search still works if they fail to load.
  const reference = useQuery('reference', () =>
    Promise.all([api.regions(), api.services(), api.insurance()])
  );
  const [regions, services, insurers] = reference.data ?? [[], [], []];
  const districts = useQuery(region ? `districts:${region}` : null, () => api.districts(region));
  const cities = useQuery(region ? `cities:${region}:${district}` : null, () =>
    api.localities(region, district || undefined)
  );

  // Choosing a wider area clears the narrower choices inside it.
  function chooseRegion(next: string) {
    setRegion(next);
    setDistrict('');
    setCity('');
  }
  function chooseDistrict(next: string) {
    setDistrict(next);
    setCity('');
  }

  const filters: FacilityFilters = { ...applied, lat: coords?.lat, lng: coords?.lng, page_size: 20 };
  const results = useQuery(JSON.stringify(filters), () => api.searchFacilities({ ...filters, page: 1 }));

  // Later pages, appended as the list scrolls. Kept with the search they belong to.
  const [more, setMore] = useState<{ key: string | null; items: FacilitySummary[]; page: number }>({
    key: null,
    items: [],
    page: 1,
  });
  const [loadingMore, setLoadingMore] = useState(false);
  const extra = more.key === results.key ? more : { items: [], page: 1 };
  const items = results.data ? [...results.data.items, ...extra.items] : [];
  const total = results.data?.total ?? 0;
  const pages = results.data?.pages ?? 1;
  const loading = results.loading;
  const error = results.error;

  async function loadMore() {
    if (loading || loadingMore || !results.data || extra.page >= pages) return;
    const key = results.key;
    setLoadingMore(true);
    try {
      const body = await api.searchFacilities({ ...filters, page: extra.page + 1 });
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

  async function useMyLocation() {
    setLocateMessage('');
    try {
      await locate();
      setLocateMessage('Showing the nearest care first.');
      runSearch();
    } catch (err) {
      setLocateMessage((err as Error).message);
    }
  }

  const activeFilters = [ownership, service, insurance].filter(Boolean).length + (is24 ? 1 : 0) + (hasAmbulance ? 1 : 0);
  const folded = wantFold && !loading && !error && total > 0;

  // Once a Search press has an answer: results found, the folded page starts
  // with the summary, so go to the top; nothing found, the message is the
  // last thing on the page, so go to the end.
  const answered = !loading && (results.data !== undefined || error !== '');
  useEffect(() => {
    if (!answered || !pendingScroll.current) return;
    pendingScroll.current = false;
    // After the list has resized to its new content, or the scroll is lost.
    const timer = setTimeout(() => {
      if (folded) listRef.current?.scrollToOffset({ offset: 0, animated: true });
      // The list's own scrollToEnd goes by its last item, and there is none.
      else listRef.current?.getNativeScrollRef()?.scrollToEnd({ animated: true });
    }, 120);
    return () => clearTimeout(timer);
  }, [answered, folded, results.key]);

  /* The choices behind the results, in a few words. */
  function summary() {
    const parts: string[] = [];
    if (applied.q) parts.push(`“${applied.q}”`);
    const kind = CATEGORIES.find((c) => c.value && c.value === applied.category);
    if (kind) parts.push(kind.label);
    const where = [applied.city, applied.district, applied.region].filter(Boolean);
    if (where.length) parts.push(where.join(', '));
    if (coords) parts.push('near you');
    const extra = [applied.type, applied.service?.length, applied.insurance, applied.is_24_hour, applied.has_ambulance]
      .filter(Boolean).length;
    if (extra) parts.push(extra === 1 ? '1 more filter' : `${extra} more filters`);
    return parts.length ? parts.join(' · ') : 'All types of care, all of Ghana';
  }

  const header = (
    <View style={styles.headerArea}>
      {/* With results showing, only the emergency button stays above them. */}
      <View style={folded ? null : styles.hero}>
        {folded ? null : (
          <>
            <Text style={styles.eyebrow}>ALL 16 REGIONS OF GHANA</Text>
            <Text style={styles.heroTitle}>Find care near you</Text>
            <Text style={styles.heroText}>
              Hospitals, clinics, laboratories, pharmacies, ambulances, hearse services and caregivers.
            </Text>
          </>
        )}
        <Pressable
          onPress={() => router.push('/emergency')}
          accessibilityRole="button"
          accessibilityHint="Finds the nearest open facilities and ambulance providers"
          style={({ pressed }) => [styles.emergency, folded && { marginTop: 0 }, pressed && { backgroundColor: colors.redDark }]}>
          <Ionicons name="pulse" size={26} color={colors.white} />
          <Text style={styles.emergencyText}>Emergency — find help now</Text>
        </Pressable>
        {folded ? null : (
          <Text style={styles.heroNote}>Nearest open facilities and the ambulances covering your area.</Text>
        )}
      </View>

      <DataBanner />

      {folded ? (
        <View style={styles.summary}>
          <View style={styles.summaryText}>
            <Text style={styles.summaryLabel}>SHOWING RESULTS FOR</Text>
            <Text style={styles.summaryValue}>{summary()}</Text>
          </View>
          <Button label="Change search" icon="options-outline" variant="secondary" onPress={() => setWantFold(false)} />
        </View>
      ) : (
      <View style={styles.panel}>
        <Text style={styles.label}>Facility name or place</Text>
        <View style={styles.searchBar}>
          <View style={styles.searchRow}>
            <Ionicons name="search" size={20} color={colors.inkSoft} />
            <TextInput
              value={q}
              onChangeText={changeQ}
              onSubmitEditing={() => runSearch()}
              placeholder="e.g. Koforidua"
              placeholderTextColor={colors.muted}
              returnKeyType="search"
              autoCorrect={false}
              style={styles.searchInput}
              accessibilityLabel="Search by facility name or place"
            />
            {q ? (
              <Pressable onPress={clearSearch} hitSlop={10} accessibilityLabel="Clear search">
                <Ionicons name="close-circle" size={20} color={colors.muted} />
              </Pressable>
            ) : null}
          </View>
          <Button label="Search" icon="search" loading={loading} loadingLabel="Searching…" onPress={() => runSearch()} />
        </View>
        {showSuggestions && suggestions.data ? (
          <View style={styles.suggestions} accessibilityLabel="Suggestions">
            {suggestions.data.places.map((p) => (
              <Pressable
                key={`place:${p.name}:${p.region}`}
                onPress={() => runSearch(p.name)}
                style={({ pressed }) => [styles.suggestion, pressed && styles.suggestionPressed]}
                accessibilityRole="button"
                accessibilityHint="Lists every facility in this place">
                <Text style={[styles.kind, styles.kindPlace]}>PLACE</Text>
                <View style={styles.suggestionText}>
                  <Text style={styles.suggestionTitle}>{p.name}</Text>
                  <Text style={styles.suggestionDetail}>{`${p.region} · ${plural(p.count, 'listing', 'listings')}`}</Text>
                </View>
              </Pressable>
            ))}
            {suggestions.data.facilities.map((f) => (
              <Pressable
                key={`facility:${f.id}`}
                onPress={() => {
                  setSuggestText('');
                  router.push({ pathname: '/facility/[id]', params: { id: String(f.id) } });
                }}
                style={({ pressed }) => [styles.suggestion, pressed && styles.suggestionPressed]}
                accessibilityRole="link"
                accessibilityHint="Opens this facility">
                <Text style={styles.kind}>FACILITY</Text>
                <View style={styles.suggestionText}>
                  <Text style={styles.suggestionTitle}>{f.name}</Text>
                  <Text style={styles.suggestionDetail}>
                    {[CATEGORY_LABEL[f.category] ?? f.category, f.city || f.region].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        ) : null}
        <Text style={styles.hint}>
          {'Type a town or a facility name, or choose below, then press Search.'}
        </Text>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categories}>
          {CATEGORIES.map((c) => (
            <Toggle key={c.value || 'all'} label={c.label} on={category === c.value} onPress={() => setCategory(c.value)} />
          ))}
        </ScrollView>

        <View style={styles.row}>
          <Picker style={styles.half} label="Region" value={region} onChange={chooseRegion} options={toOptions(regions)} placeholder="All regions" />
          <Picker
            style={styles.half}
            label="District"
            value={district}
            onChange={chooseDistrict}
            options={toOptions(districts.data)}
            placeholder="All districts"
            disabled={!region}
          />
        </View>
        <Picker label="City or town" value={city} onChange={setCity} options={toOptions(cities.data)} disabled={!region} />

        <View style={styles.actions}>
          <Button
            label={coords ? 'Nearest first' : 'Use my location'}
            icon="locate"
            variant="secondary"
            loading={locating}
            loadingLabel="Locating…"
            onPress={useMyLocation}
            style={styles.locateButton}
          />
          <Button
            label="Search"
            icon="search"
            loading={loading}
            loadingLabel="Searching…"
            onPress={() => runSearch()}
            style={styles.findButton}
          />
        </View>
        {coords ? (
          <Text style={styles.stop} onPress={() => { forget(); setLocateMessage(''); }} accessibilityRole="button">
            Stop using my location
          </Text>
        ) : null}
        {locateMessage ? <Notice>{locateMessage}</Notice> : null}

        <Pressable
          onPress={() => setShowFilters((v) => !v)}
          style={styles.moreFilters}
          accessibilityRole="button"
          accessibilityState={{ expanded: showFilters }}>
          <Text style={styles.moreFiltersText}>
            More filters{activeFilters ? ` (${activeFilters})` : ''}
          </Text>
          <Ionicons name={showFilters ? 'chevron-up' : 'chevron-down'} size={18} color={colors.brandDark} />
        </Pressable>
        {showFilters ? (
          <View style={styles.filters}>
            <View style={styles.toggles}>
              <Toggle label="Open 24 hours" on={is24} onPress={() => setIs24((v) => !v)} />
              <Toggle label="Has an ambulance" on={hasAmbulance} onPress={() => setHasAmbulance((v) => !v)} />
            </View>
            <View style={styles.row}>
              <Picker style={styles.half} label="Ownership" value={ownership} onChange={setOwnership} options={OWNERSHIP} placeholder="Any" />
              <Picker style={styles.half} label="Insurance" value={insurance} onChange={setInsurance} options={toOptions(insurers)} placeholder="Any" />
            </View>
            <Picker label="Service needed" value={service} onChange={setService} options={toOptions(services)} placeholder="Any service" />
          </View>
        ) : null}
      </View>
      )}

      <View style={styles.resultsHead}>
        <Text style={styles.resultsTitle}>{coords ? 'Nearest to you' : 'Facilities'}</Text>
        {!loading && !error ? <Text style={styles.count}>{plural(total, 'facility', 'facilities')}</Text> : null}
      </View>
      {loading ? (
        <Feedback kind="info" message={submittedQ ? `Searching for “${submittedQ}”…` : 'Searching…'} />
      ) : error ? (
        <Feedback kind="error" message={`Search did not work: ${error}`} actionLabel="Try again" onAction={results.retry} />
      ) : results.data && total === 0 ? (
        <View>
          <Feedback
            kind="empty"
            message={`No facilities found${submittedQ ? ` for “${submittedQ}”` : ''}. Check the spelling, try a nearby town, or remove a filter.`}
          />
        </View>
      ) : results.data ? (
        <Feedback kind="ok" message={describeResults(results.data, filters, !!coords)} />
      ) : null}
      <BusyLegend />
      {loading ? <Loading message="Searching…" /> : null}
    </View>
  );

  return (
    <FlatList
      ref={listRef}
      data={loading || error ? [] : items}
      keyExtractor={(f) => String(f.id)}
      renderItem={({ item }) => <FacilityCard facility={item} />}
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
  hero: {
    backgroundColor: colors.brandDeep,
    borderRadius: 20,
    padding: 20,
    gap: 6,
    ...shadow,
  },
  eyebrow: { color: colors.accentSoft, fontSize: 12, fontWeight: '800', letterSpacing: 1.2 },
  heroTitle: { color: colors.white, fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  heroText: { color: 'rgba(255,255,255,0.88)', fontSize: 15.5, lineHeight: 22 },
  emergency: {
    marginTop: 12,
    minHeight: 56,
    borderRadius: radius.md,
    backgroundColor: colors.red,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 14,
  },
  emergencyText: { color: colors.white, fontSize: 17, fontWeight: '800' },
  heroNote: { color: 'rgba(255,255,255,0.8)', fontSize: 13, marginTop: 4 },
  panel: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    ...shadow,
  },
  label: { fontSize: 14, fontWeight: '600', color: '#1e293b', marginBottom: 6 },
  actions: { flexDirection: 'row', gap: 10 },
  locateButton: { flex: 3, paddingHorizontal: 10 },
  findButton: { flex: 2, paddingHorizontal: 10 },
  stop: { marginTop: 10, color: colors.brandDark, fontWeight: '700', textDecorationLine: 'underline' },
  summary: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brandLine,
    backgroundColor: colors.brandTint,
  },
  summaryText: { flexGrow: 1, flexBasis: 180 },
  summaryLabel: { fontSize: 11.5, fontWeight: '800', letterSpacing: 0.8, color: colors.brandDark },
  summaryValue: { fontSize: 16, fontWeight: '700', color: colors.ink, marginTop: 2 },
  searchBar: { flexDirection: 'row', gap: 8 },
  hint: { fontSize: 13, color: colors.inkSoft, marginTop: 6 },
  suggestions: {
    marginTop: 6,
    padding: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    ...shadow,
  },
  suggestion: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 8, minHeight: 48 },
  suggestionPressed: { backgroundColor: colors.brandTint },
  suggestionText: { flex: 1 },
  kind: {
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: colors.inkSoft,
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  kindPlace: { color: colors.amber, backgroundColor: colors.amberTint },
  suggestionTitle: { fontSize: 15, fontWeight: '700', color: colors.ink },
  suggestionDetail: { fontSize: 13, color: colors.inkSoft },
  searchRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 50,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: radius.sm,
    paddingHorizontal: 12,
  },
  searchInput: { flex: 1, fontSize: 16, color: colors.ink, paddingVertical: 10 },
  categories: { gap: 8, paddingVertical: 12 },
  row: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  half: { flexGrow: 1, flexBasis: 140 },
  moreFilters: {
    marginTop: 12,
    minHeight: 46,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  moreFiltersText: { fontWeight: '700', color: colors.brandDark, fontSize: 15 },
  filters: { paddingTop: 12 },
  toggles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  resultsHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  resultsTitle: { fontSize: 20, fontWeight: '800', color: colors.ink },
  count: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.brandDark,
    backgroundColor: colors.brandTint,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
});
