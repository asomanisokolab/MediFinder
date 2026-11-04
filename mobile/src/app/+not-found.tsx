import { router, Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui';
import { colors } from '@/lib/theme';

export default function NotFound() {
  return (
    <View style={styles.page}>
      <Stack.Screen options={{ title: 'Not found' }} />
      <Text style={styles.title}>{"We can't find that screen"}</Text>
      <Text style={styles.lede}>You can still find care from here.</Text>
      <Button label="Search for care" onPress={() => router.replace('/')} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 24, justifyContent: 'center', gap: 12 },
  title: { fontSize: 22, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  lede: { fontSize: 15, color: colors.inkSoft, textAlign: 'center', marginBottom: 8 },
});
