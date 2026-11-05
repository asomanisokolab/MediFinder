/* Contact us: organizations ask to be listed. Nothing here creates an
   account; a superadmin verifies the request and emails the login. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useRef, useState, type ComponentRef } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import { Picker, type Option } from '@/components/Picker';
import { Button, Card, ErrorBox, SectionTitle } from '@/components/ui';
import { api } from '@/lib/api';
import { colors, radius } from '@/lib/theme';

const TYPES: Option[] = [
  { value: 'hospital_government', label: 'Hospital (government)' },
  { value: 'hospital_private', label: 'Hospital (private)' },
  { value: 'clinic', label: 'Clinic' },
  { value: 'laboratory', label: 'Laboratory / diagnostic centre' },
  { value: 'pharmacy', label: 'Pharmacy / medical store' },
  { value: 'ambulance', label: 'Ambulance service' },
  { value: 'hearse', label: 'Hearse service' },
  { value: 'caregiver', label: 'Caregiver' },
];

const STEPS = [
  ['Send your details', 'Fill in the form with your facility name, type, phone and email.'],
  ['We verify you', 'Our team checks every request, usually with a quick phone call.'],
  ['We email your login', 'Sign in on findcareghana.com, choose your own password and keep your listing up to date.'],
];

type Field = 'name' | 'type' | 'phone' | 'email';

/* Same rules as the API (backend/app/schemas.py ContactRequestIn). */
function validate(values: { name: string; type: string; phone: string; email: string }) {
  const errors: Partial<Record<Field, string>> = {};
  if (values.name.trim().length < 2) errors.name = 'Enter the name of your facility or business.';
  if (!values.type) errors.type = 'Choose the type of care you provide.';
  if (!/^\+?[0-9 ()-]{7,40}$/.test(values.phone.trim())) {
    errors.phone = 'Enter a phone number we can call, for example +233 24 000 0000.';
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) {
    errors.email = 'Enter an email address like name@example.com.';
  }
  return errors;
}

export default function Contact() {
  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [contactName, setContactName] = useState('');
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [submitError, setSubmitError] = useState('');
  const [sending, setSending] = useState(false);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);

  const values = { name, type, phone, email };
  // After the first attempt, errors update as the user fixes each field.
  const recheck = (patch: Partial<typeof values>) => {
    if (Object.keys(errors).length) setErrors(validate({ ...values, ...patch }));
  };

  async function submit() {
    setSubmitError('');
    const found = validate(values);
    setErrors(found);
    const count = Object.keys(found).length;
    if (count) {
      setSubmitError(count === 1 ? 'Please fix the highlighted field.' : `Please fix the ${count} highlighted fields.`);
      return;
    }
    setSending(true);
    try {
      await api.contact({
        facility_name: name.trim(),
        organization_type: type,
        phone: phone.trim(),
        email: email.trim(),
        contact_name: contactName.trim(),
        message: message.trim(),
      });
      setName('');
      setType('');
      setPhone('');
      setEmail('');
      setContactName('');
      setMessage('');
      router.push('/thank-you');
    } catch (err) {
      setSubmitError((err as Error).message);
      scroll.current?.scrollToEnd({ animated: true });
    } finally {
      setSending(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scroll} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <View>
          <Text style={styles.eyebrow}>FOR CARE PROVIDERS</Text>
          <Text style={styles.title}>Contact us</Text>
          <Text style={styles.lede}>
            Run a hospital, clinic, pharmacy, ambulance, hearse or caregiving service? Send us your
            details and we will list you on FindCare Ghana.
          </Text>
        </View>

        <Card style={styles.info}>
          <SectionTitle>How listing works</SectionTitle>
          {STEPS.map(([head, body], i) => (
            <View key={head} style={styles.step}>
              <Text style={styles.stepNo}>{i + 1}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.stepHead}>{head}</Text>
                <Text style={styles.stepBody}>{body}</Text>
              </View>
            </View>
          ))}
          <View style={styles.direct}>
            <Text
              style={styles.directLink}
              onPress={() => Linking.openURL('mailto:info@findcareghana.com')}
              accessibilityRole="link">
              <Ionicons name="mail-outline" size={17} /> info@findcareghana.com
            </Text>
            <Text style={styles.directText}>
              <Ionicons name="logo-instagram" size={16} /> @findcareGh on Instagram, X and Facebook
            </Text>
          </View>
        </Card>

        <Card>
          <SectionTitle>Request a listing</SectionTitle>
          <Input
            label="Facility or business name"
            value={name}
            onChangeText={(v) => { setName(v); recheck({ name: v }); }}
            error={errors.name}
            autoComplete="organization"
            maxLength={200}
          />
          <Picker
            label="Type"
            value={type}
            onChange={(v) => { setType(v); recheck({ type: v }); }}
            options={TYPES}
            placeholder={null}
            error={errors.type}
          />
          <Input
            label="Phone number"
            value={phone}
            onChangeText={(v) => { setPhone(v); recheck({ phone: v }); }}
            error={errors.phone}
            keyboardType="phone-pad"
            autoComplete="tel"
            placeholder="+233 24 000 0000"
            maxLength={40}
          />
          <Input
            label="Email"
            value={email}
            onChangeText={(v) => { setEmail(v); recheck({ email: v }); }}
            error={errors.email}
            keyboardType="email-address"
            autoComplete="email"
            autoCapitalize="none"
            maxLength={160}
          />
          <Input label="Your name (optional)" value={contactName} onChangeText={setContactName} autoComplete="name" maxLength={120} />
          <Input
            label="Location and anything else we should know (optional)"
            value={message}
            onChangeText={setMessage}
            multiline
            numberOfLines={4}
            maxLength={1000}
            style={{ minHeight: 100, textAlignVertical: 'top' }}
          />
          {submitError ? <ErrorBox message={submitError} /> : null}
          <Button
            label={sending ? 'Sending…' : 'Send request'}
            loading={sending}
            onPress={submit}
            style={{ marginTop: 12 }}
          />
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Input({ label, error, style, ...props }: TextInputProps & { label: string; error?: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...props}
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        style={[styles.input, error ? styles.inputError : null, style]}
      />
      {error ? (
        <View style={styles.errorRow}>
          <Ionicons name="alert-circle" size={16} color={colors.red} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 40, gap: 14 },
  eyebrow: { color: colors.brand, fontSize: 12, fontWeight: '800', letterSpacing: 1.2 },
  title: { fontSize: 26, fontWeight: '800', color: colors.ink, marginTop: 2 },
  lede: { fontSize: 15, color: colors.inkSoft, lineHeight: 22, marginTop: 4 },
  info: { backgroundColor: colors.brandTint, borderColor: colors.brandLine },
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
  direct: { gap: 8, marginTop: 4 },
  directLink: { color: colors.brandDark, fontWeight: '700', fontSize: 15 },
  directText: { color: colors.inkSoft, fontSize: 14 },
  field: { marginBottom: 12 },
  label: { fontSize: 14, fontWeight: '600', color: '#1e293b', marginBottom: 5 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.white,
  },
  inputError: { borderColor: colors.red, backgroundColor: '#fffafa' },
  errorRow: { flexDirection: 'row', gap: 6, alignItems: 'flex-start', marginTop: 5 },
  errorText: { flex: 1, color: colors.redDark, fontSize: 13.5, fontWeight: '600' },
});
