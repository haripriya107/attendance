import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useRouter } from 'expo-router';

import {
  AdminCard,
  AdminHeader,
  AdminNotice,
  AdminPage,
  adminColors,
} from '@/components/admin-ui';
import { ApiError, signOut } from '@/config/api';
import { useAuth } from '@/auth/auth-context';

const links = [
  {
    title: 'Departments',
    description: 'Manage teams and assigned employee counts.',
    route: '/admin/more/departments',
    symbol: { ios: 'building.2.fill', android: 'business', web: 'business' },
  },
  {
    title: 'Reports',
    description: 'Review attendance summaries and export CSV reports.',
    route: '/admin/more/reports',
    symbol: { ios: 'chart.bar.fill', android: 'bar_chart', web: 'bar_chart' },
  },
  {
    title: 'Profile & settings',
    description: 'View your account details and configure the office GPS location.',
    route: '/admin/more/settings',
    symbol: { ios: 'person.crop.circle.fill', android: 'account_circle', web: 'account_circle' },
  },
] as const;

export default function AdminMoreScreen() {
  const router = useRouter();
  const { setUser } = useAuth();
  const [error, setError] = useState('');
  const [signingOut, setSigningOut] = useState(false);

  const confirmSignOut = () => {
    Alert.alert('Sign out?', 'You will need to sign in again to access the Admin workspace.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setSigningOut(true);
            setError('');
            try {
              await signOut();
              setUser(null);
              router.replace('/');
            } catch (requestError) {
              if (requestError instanceof ApiError && requestError.status === 401) {
                setUser(null);
                router.replace('/');
              } else {
                setError(
                  requestError instanceof Error ? requestError.message : 'Unable to sign out.'
                );
              }
            } finally {
              setSigningOut(false);
            }
          })();
        },
      },
    ]);
  };

  return (
    <AdminPage>
      <AdminHeader
        title="More"
        subtitle="Additional Admin tools and account settings."
      />

      {error ? (
        <AdminNotice title="Sign out failed" message={error} tone="error" />
      ) : null}

      {links.map((link) => (
        <Pressable
          accessibilityRole="button"
          key={link.title}
          onPress={() => router.push(link.route)}
          style={({ pressed }) => [pressed && styles.pressed]}>
          <AdminCard style={styles.linkCard}>
            <View style={styles.linkIcon}>
              <SymbolView name={link.symbol} size={20} tintColor={adminColors.blue} />
            </View>
            <View style={styles.linkCopy}>
              <Text style={styles.linkTitle}>{link.title}</Text>
              <Text style={styles.linkDescription}>{link.description}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </AdminCard>
        </Pressable>
      ))}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: signingOut }}
        disabled={signingOut}
        onPress={confirmSignOut}
        style={({ pressed }) => [styles.logoutCard, pressed && styles.pressed]}>
        <View style={styles.logoutIcon}>
          <SymbolView
            name={{ ios: 'rectangle.portrait.and.arrow.right', android: 'logout', web: 'logout' }}
            size={18}
            tintColor={adminColors.red}
          />
        </View>
        <Text style={styles.logoutText}>{signingOut ? 'Signing out...' : 'Log out'}</Text>
      </Pressable>
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  linkCard: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  linkIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    backgroundColor: '#EEF1FF',
  },
  linkCopy: {
    flex: 1,
  },
  linkTitle: {
    color: adminColors.navy,
    fontSize: 13,
    fontWeight: '800',
  },
  linkDescription: {
    color: adminColors.muted,
    fontSize: 10,
    lineHeight: 15,
    marginTop: 4,
  },
  chevron: {
    color: adminColors.muted,
    fontSize: 24,
  },
  logoutCard: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 15,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#F3D9D9',
    backgroundColor: '#FFF7F7',
    marginTop: 6,
  },
  logoutIcon: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutText: {
    color: adminColors.red,
    fontSize: 12,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.75,
  },
});
