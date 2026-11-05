/* Small building blocks shared by every screen. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { api } from '@/lib/api';
import { colors, radius, shadow } from '@/lib/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];
type Variant = 'primary' | 'secondary' | 'danger' | 'dark';

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled,
  loading,
  loadingLabel,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  icon?: IconName;
  disabled?: boolean;
  /** Grey with a spinner while a request runs, and not pressable. */
  loading?: boolean;
  loadingLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const palette = loading ? LOADING : BUTTON[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: palette.bg, borderColor: palette.border },
        pressed && { opacity: 0.85 },
        disabled && !loading && { opacity: 0.55 },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={palette.fg} size="small" />
      ) : icon ? (
        <Ionicons name={icon} size={19} color={palette.fg} />
      ) : null}
      <Text style={[styles.buttonText, { color: palette.fg }]}>{loading && loadingLabel ? loadingLabel : label}</Text>
    </Pressable>
  );
}

const BUTTON: Record<Variant, { bg: string; fg: string; border: string }> = {
  primary: { bg: colors.brand, fg: colors.white, border: colors.brand },
  secondary: { bg: colors.white, fg: colors.brandDark, border: '#cbd5e1' },
  danger: { bg: colors.red, fg: colors.white, border: colors.red },
  dark: { bg: colors.brandDeep, fg: colors.white, border: colors.brandDeep },
};

const LOADING = { bg: '#e2e8f0', fg: '#475569', border: '#cbd5e1' };

type ChipTone = 'brand' | 'grey' | 'green' | 'amber' | 'red' | 'dental' | 'care' | 'lab';

const CHIP: Record<ChipTone, { bg: string; fg: string; border: string }> = {
  brand: { bg: colors.brandTint, fg: colors.brandDark, border: colors.brandLine },
  grey: { bg: '#f1f5f9', fg: colors.inkSoft, border: colors.line },
  green: { bg: colors.greenTint, fg: colors.green, border: '#b6ddca' },
  amber: { bg: colors.amberTint, fg: colors.amber, border: '#f0d49a' },
  red: { bg: colors.redTint, fg: colors.redDark, border: '#f0bcbc' },
  dental: { bg: '#f0e9fb', fg: '#5b2ca8', border: '#d7c6f2' },
  care: { bg: '#eef2ff', fg: '#3730a3', border: '#c7d2fe' },
  lab: { bg: '#ecfeff', fg: '#155e75', border: '#a5f3fc' },
};

export function Chip({ label, tone = 'brand' }: { label: string; tone?: ChipTone }) {
  const c = CHIP[tone];
  return (
    <View style={[styles.chip, { backgroundColor: c.bg, borderColor: c.border }]}>
      <Text style={[styles.chipText, { color: c.fg }]}>{label}</Text>
    </View>
  );
}

export function ChipRow({ children }: { children: ReactNode }) {
  return <View style={styles.chipRow}>{children}</View>;
}

/* A chip the user can switch on and off, for filters. */
export function Toggle({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      onPress={onPress}
      style={[styles.toggle, on && styles.toggleOn]}>
      {on ? <Ionicons name="checkmark" size={16} color={colors.brandDeep} /> : null}
      <Text style={[styles.toggleText, on && { color: colors.brandDeep }]}>{label}</Text>
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function Notice({ children }: { children: ReactNode }) {
  return <Text style={styles.notice}>{children}</Text>;
}

export function Loading({ message = 'Loading…' }: { message?: string }) {
  return (
    <View style={styles.state} accessibilityLiveRegion="polite">
      <ActivityIndicator color={colors.brand} />
      <Text style={styles.stateText}>{message}</Text>
    </View>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.error} accessibilityRole="alert">
      <Ionicons name="alert-circle" size={20} color={colors.redDark} />
      <View style={{ flex: 1, gap: 8 }}>
        <Text style={styles.errorText}>{message}</Text>
        {onRetry ? (
          <Text style={styles.retry} onPress={onRetry} accessibilityRole="button">
            Try again
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export function Empty({ message }: { message: string }) {
  return (
    <View style={styles.state}>
      <Ionicons name="search-outline" size={22} color={colors.muted} />
      <Text style={styles.stateText}>{message}</Text>
    </View>
  );
}

/* What just happened: results found, nothing found, sent, failed. */
type FeedbackKind = 'ok' | 'info' | 'empty' | 'error';
const FEEDBACK: Record<FeedbackKind, { bg: string; fg: string; border: string; icon: IconName }> = {
  ok: { bg: colors.greenTint, fg: colors.green, border: '#b6ddca', icon: 'checkmark-circle' },
  info: { bg: colors.brandTint, fg: colors.brandDeep, border: colors.brandLine, icon: 'information-circle' },
  empty: { bg: colors.amberTint, fg: colors.amber, border: '#f0d49a', icon: 'help-circle' },
  error: { bg: colors.redTint, fg: colors.redDark, border: '#f0bcbc', icon: 'alert-circle' },
};

export function Feedback({
  kind,
  message,
  actionLabel,
  onAction,
}: {
  kind: FeedbackKind;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const f = FEEDBACK[kind];
  return (
    <View
      style={[styles.feedback, { backgroundColor: f.bg, borderColor: f.border }]}
      accessibilityLiveRegion="polite"
      accessibilityRole={kind === 'error' ? 'alert' : undefined}>
      <Ionicons name={f.icon} size={20} color={f.fg} />
      <Text style={[styles.feedbackText, { color: f.fg }]}>{message}</Text>
      {actionLabel && onAction ? (
        <Text style={[styles.retry, { color: f.fg }]} onPress={onAction} accessibilityRole="button">
          {actionLabel}
        </Text>
      ) : null}
    </View>
  );
}

/* While the directory is unverified, every list says so (PRD 7.1). */
export function DataBanner() {
  const [unverified, setUnverified] = useState(false);
  useEffect(() => {
    api
      .health()
      .then((h) => setUnverified(!h.data_verified))
      .catch(() => undefined);
  }, []);
  if (!unverified) return null;
  return (
    <View style={styles.banner} accessibilityRole="summary">
      <Ionicons name="warning" size={20} color={colors.accent} />
      <View style={{ flex: 1 }}>
        <Text style={styles.bannerTitle}>Unverified directory data</Text>
        <Text style={styles.bannerText}>
          Listings come from public sources and have not been confirmed by the facilities. Some
          phone numbers are placeholders, and others may be out of date. In a real emergency call 112.
        </Text>
      </View>
    </View>
  );
}

export const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  buttonText: { fontSize: 15, fontWeight: '700' },
  chip: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  chipText: { fontSize: 12.5, fontWeight: '600' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
  },
  toggleOn: { backgroundColor: colors.brandTint, borderColor: colors.brand },
  toggleText: { fontSize: 14, fontWeight: '600', color: colors.inkSoft },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    ...shadow,
  },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: colors.ink, marginBottom: 8 },
  notice: { fontSize: 13.5, color: colors.inkSoft, lineHeight: 19, marginTop: 6 },
  state: {
    alignItems: 'center',
    gap: 8,
    padding: 28,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#cbd5e1',
    backgroundColor: colors.card,
  },
  stateText: { color: colors.inkSoft, fontSize: 14.5, textAlign: 'center' },
  error: {
    flexDirection: 'row',
    gap: 10,
    padding: 14,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: '#f0bcbc',
    backgroundColor: colors.redTint,
  },
  errorText: { color: colors.redDark, fontSize: 14, lineHeight: 20 },
  retry: { color: colors.redDark, fontWeight: '800', textDecorationLine: 'underline' },
  banner: {
    flexDirection: 'row',
    gap: 10,
    padding: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#f0d49a',
    backgroundColor: colors.amberTint,
  },
  bannerTitle: { color: colors.amber, fontWeight: '800', marginBottom: 2 },
  bannerText: { color: colors.amber, fontSize: 13, lineHeight: 18 },
  feedback: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  feedbackText: { flex: 1, minWidth: 180, fontSize: 14.5, fontWeight: '600', lineHeight: 20 },
});
