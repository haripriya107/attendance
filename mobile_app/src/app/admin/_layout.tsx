import { SymbolView } from 'expo-symbols';
import { Tabs, useRouter } from 'expo-router';
import { useEffect } from 'react';

import { AuthLoadingScreen, useAuth } from '@/auth/auth-context';

export default function AdminLayout() {
  const { status, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'anonymous' || status === 'error') {
      router.replace('/');
    } else if (status === 'authenticated' && user?.role !== 'admin') {
      router.replace('/employee');
    }
  }, [router, status, user]);

  if (status !== 'authenticated' || user?.role !== 'admin') {
    return <AuthLoadingScreen />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#4667E8',
        tabBarInactiveTintColor: '#78839A',
        tabBarStyle: {
          height: 62,
          paddingTop: 5,
          paddingBottom: 5,
          backgroundColor: '#FFFFFF',
          borderTopColor: '#E9EDF3',
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
        },
        tabBarHideOnKeyboard: true,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color }) => (
            <SymbolView name={{ ios: 'square.grid.2x2.fill', android: 'dashboard', web: 'dashboard' }} tintColor={color} size={19} />
          ),
        }}
      />
      <Tabs.Screen
        name="employees"
        options={{
          title: 'Employees',
          tabBarIcon: ({ color }) => (
            <SymbolView name={{ ios: 'person.2.fill', android: 'people', web: 'group' }} tintColor={color} size={19} />
          ),
        }}
      />
      <Tabs.Screen
        name="attendance"
        options={{
          title: 'Attendance',
          tabBarIcon: ({ color }) => (
            <SymbolView name={{ ios: 'clock.fill', android: 'schedule', web: 'schedule' }} tintColor={color} size={19} />
          ),
        }}
      />
      <Tabs.Screen
        name="leaves"
        options={{
          title: 'Leaves',
          tabBarIcon: ({ color }) => (
            <SymbolView name={{ ios: 'calendar', android: 'event_note', web: 'event_note' }} tintColor={color} size={19} />
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: 'More',
          tabBarIcon: ({ color }) => (
            <SymbolView name={{ ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz' }} tintColor={color} size={19} />
          ),
        }}
      />
    </Tabs>
  );
}
