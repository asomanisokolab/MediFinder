import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { Call112Button } from '@/components/Header';
import { LocationProvider } from '@/lib/location';
import { colors } from '@/lib/theme';

export default function RootLayout() {
  return (
    <LocationProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.brandDeep },
          headerTintColor: colors.white,
          headerTitleStyle: { fontWeight: '800' },
          headerRight: () => <Call112Button />,
          contentStyle: { backgroundColor: colors.bg },
        }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="facility/[id]" options={{ title: 'Facility' }} />
        <Stack.Screen name="provider/[id]" options={{ title: 'Ambulance provider' }} />
        <Stack.Screen
          name="emergency"
          options={{ title: 'Emergency', headerStyle: { backgroundColor: colors.red } }}
        />
        <Stack.Screen name="thank-you" options={{ title: 'Request sent', headerBackVisible: false }} />
      </Stack>
    </LocationProvider>
  );
}
