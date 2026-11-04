import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Card } from '@/components/ui';
import { colors } from '@/lib/theme';

const NEXT = [
  ['We verify you', 'Look out for a call on the number you gave us.'],
  ['We email your login', 'It comes from info@findcareghana.com with a default password.'],
  ['You take over', 'Sign in on findcareghana.com, choose your own password and set your location.'],
];

export default function ThankYou() {
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.tick}>
        <Ionicons name="checkmark" size={40} color={colors.green} />
      </View>
      <Text style={styles.title}>Thank you, we have your request</Text>
      <Text style={styles.lede}>
        Our team will check your details, usually with a quick phone call. Once you are approved we
        will email your sign-in details.
      </Text>
      <Card>
        {NEXT.map(([head, body], i) => (
          <View key={head} style={styles.step}>
            <Text style={styles.stepNo}>{i + 1}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.stepHead}>{head}</Text>
              <Text style={styles.stepBody}>{body}</Text>
            </View>
          </View>
        ))}
      </Card>
      <Button label="Back to FindCare" onPress={() => router.replace('/')} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, paddingBottom: 40, gap: 16 },
  tick: {
    alignSelf: 'center',
    width: 76,
    height: 76,
    borderRadius: 38,
    marginTop: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.greenTint,
    borderWidth: 2,
    borderColor: '#b6ddca',
  },
  title: { fontSize: 24, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  lede: { fontSize: 15.5, color: colors.inkSoft, textAlign: 'center', lineHeight: 22 },
  step: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  stepNo: {
    width: 28,
    height: 28,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: colors.brand,
    color: colors.white,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 28,
  },
  stepHead: { fontWeight: '800', color: colors.ink, fontSize: 15 },
  stepBody: { color: colors.inkSoft, fontSize: 14, lineHeight: 20 },
});
