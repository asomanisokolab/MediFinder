/* A select field: tapping opens a sheet listing the options, with a search
   box when the list is long (districts, cities). React Native has no
   built-in dropdown that behaves the same on every phone. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius } from '@/lib/theme';

export interface Option {
  value: string;
  label: string;
}

export function Picker({
  label,
  value,
  options,
  onChange,
  placeholder = 'All',
  disabled,
  error,
  style,
}: {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  /** Shown for the empty value; also the first row of the sheet. Pass null to require a choice. */
  placeholder?: string | null;
  disabled?: boolean;
  error?: string;
  /** Pass styles.half (or similar) when the picker shares a row. */
  style?: StyleProp<ViewStyle>;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const insets = useSafeAreaInsets();

  const rows = useMemo(() => {
    const all = placeholder === null ? options : [{ value: '', label: placeholder }, ...options];
    const f = filter.trim().toLowerCase();
    return f ? all.filter((o) => o.label.toLowerCase().includes(f)) : all;
  }, [options, placeholder, filter]);

  const current = options.find((o) => o.value === value)?.label ?? placeholder ?? 'Choose…';

  function choose(next: string) {
    onChange(next);
    setOpen(false);
    setFilter('');
  }

  return (
    <View style={[styles.field, style]}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current}`}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={[styles.input, disabled && { opacity: 0.5 }, error ? styles.inputError : null]}>
        <Text style={[styles.value, !value && { color: colors.inkSoft }]} numberOfLines={1}>
          {current}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.inkSoft} />
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>{label}</Text>
            <Pressable onPress={() => setOpen(false)} hitSlop={12} accessibilityLabel="Close">
              <Ionicons name="close" size={24} color={colors.ink} />
            </Pressable>
          </View>
          {options.length > 12 ? (
            <TextInput
              value={filter}
              onChangeText={setFilter}
              placeholder="Type to filter"
              placeholderTextColor={colors.muted}
              style={styles.filter}
              autoCorrect={false}
            />
          ) : null}
          <FlatList
            data={rows}
            keyExtractor={(o) => o.value || '__all'}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                onPress={() => choose(item.value)}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.brandTint }]}
                accessibilityRole="button"
                accessibilityState={{ selected: item.value === value }}>
                <Text style={[styles.rowText, item.value === value && styles.rowSelected]}>{item.label}</Text>
                {item.value === value ? <Ionicons name="checkmark" size={20} color={colors.brand} /> : null}
              </Pressable>
            )}
            ListEmptyComponent={<Text style={styles.none}>No matches</Text>}
          />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: 12 },
  label: { fontSize: 14, fontWeight: '600', color: '#1e293b', marginBottom: 5 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    backgroundColor: colors.white,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inputError: { borderColor: colors.red, backgroundColor: '#fffafa' },
  value: { flex: 1, fontSize: 16, color: colors.ink },
  error: { color: colors.redDark, fontSize: 13.5, fontWeight: '600', marginTop: 5 },
  backdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.4)' },
  sheet: {
    maxHeight: '75%',
    backgroundColor: colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: colors.ink },
  filter: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    fontSize: 16,
    marginBottom: 6,
    color: colors.ink,
  },
  row: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  rowText: { fontSize: 16, color: colors.ink, flex: 1 },
  rowSelected: { fontWeight: '700', color: colors.brandDark },
  none: { padding: 20, textAlign: 'center', color: colors.inkSoft },
});
