import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { call112 } from '@/lib/format';
import { colors } from '@/lib/theme';

/* The wordmark, as on the website: white "FindCare", amber "Ghana". */
export function BrandTitle() {
  return (
    <View style={styles.brand} accessibilityRole="header" accessibilityLabel="FindCare Ghana">
      <View style={styles.mark}>
        <Ionicons name="add" size={22} color={colors.brand} />
      </View>
      <Text style={styles.find}>FindCare</Text>
      <Text style={styles.ghana}>Ghana</Text>
    </View>
  );
}

/* 112 is one tap away on every screen (PRD 5.1.6). */
export function Call112Button() {
  return (
    <Pressable
      onPress={call112}
      accessibilityRole="button"
      accessibilityLabel="Call 112, the national emergency number"
      hitSlop={8}
      style={({ pressed }) => [styles.call, pressed && { backgroundColor: colors.redDark }]}>
      <Ionicons name="call" size={15} color={colors.white} />
      <Text style={styles.callText}>112</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  brand: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  mark: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  find: { color: colors.white, fontSize: 19, fontWeight: '800', letterSpacing: -0.4 },
  ghana: { color: colors.accentSoft, fontSize: 15, fontWeight: '800', marginTop: 3 },
  call: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.red,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    marginRight: 4,
  },
  callText: { color: colors.white, fontWeight: '800', fontSize: 15 },
});
