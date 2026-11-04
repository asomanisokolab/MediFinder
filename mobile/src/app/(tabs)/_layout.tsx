import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Tabs } from 'expo-router';

import { BrandTitle, Call112Button } from '@/components/Header';
import { colors } from '@/lib/theme';

/* The three public sections. There is deliberately no sign-in tab:
   organizations manage their listing on the website. */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.brandDeep },
        headerTintColor: colors.white,
        headerTitle: () => <BrandTitle />,
        headerRight: () => <Call112Button />,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.inkSoft,
        tabBarLabelStyle: { fontSize: 12.5, fontWeight: '700' },
        sceneStyle: { backgroundColor: colors.bg },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Find care',
          tabBarIcon: ({ color, size }) => <Ionicons name="search" size={size} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="ambulance"
        options={{
          title: 'Ambulance',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="ambulance" size={size + 2} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="contact"
        options={{
          title: 'Contact us',
          tabBarIcon: ({ color, size }) => <Ionicons name="mail" size={size} color={color as string} />,
        }}
      />
    </Tabs>
  );
}
