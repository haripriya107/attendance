import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { useAuth } from '@/auth/auth-context';
import {
  getEmployeeProfile,
  updateEmployeeProfile,
  type EmployeeProfile,
} from '@/employee/api';
import {
  changeEmployeePassword,
  ApiError,
  signOut,
} from '@/config/api';
import {
  EmployeeButton,
  EmployeeCard,
  EmployeeField,
  EmployeeHeader,
  EmployeeLoading,
  EmployeeNotice,
  EmployeePage,
  employeeColors,
} from '@/components/employee-ui';

export default function EmployeeProfileScreen() {
  const router = useRouter();
  const { setUser, user } = useAuth();
  const requestId = useRef(0);
  const [profile, setProfile] = useState<EmployeeProfile | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState('');
  const [profileError, setProfileError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [success, setSuccess] = useState('');

  const handleFailure = useCallback((requestError: unknown) => {
    if (requestError instanceof ApiError && requestError.status === 401) {
      setUser(null);
      router.replace('/');
      return true;
    }
    return false;
  }, [router, setUser]);

  const loadProfile = useCallback(async (refresh = false) => {
    const request = ++requestId.current;
    setError('');
    if (refresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const nextProfile = await getEmployeeProfile();
      if (request === requestId.current) {
        setProfile(nextProfile);
        setName(nextProfile.name);
        setPhone(nextProfile.phone);
      }
    } catch (requestError) {
      if (request === requestId.current) {
        if (!handleFailure(requestError)) {
          setError(
            requestError instanceof Error ? requestError.message : 'Unable to load your profile.'
          );
        }
      }
    } finally {
      if (request === requestId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [handleFailure]);

  useEffect(() => {
    void loadProfile();
    return () => {
      requestId.current += 1;
    };
  }, [loadProfile]);

  const saveProfile = async () => {
    const normalizedName = name.trim();
    const normalizedPhone = phone.trim();
    if (!normalizedName || normalizedName.length > 120) {
      setProfileError('Enter a name of at most 120 characters.');
      return;
    }
    if (normalizedPhone.length > 40) {
      setProfileError('Phone number must be at most 40 characters.');
      return;
    }
    setSavingProfile(true);
    setProfileError('');
    setError('');
    setSuccess('');
    try {
      await updateEmployeeProfile(normalizedName, normalizedPhone);
      if (user) {
        setUser({ ...user, name: normalizedName });
      }
      setSuccess('Your profile was updated.');
      await loadProfile();
    } catch (requestError) {
      if (!handleFailure(requestError)) {
        setProfileError(
          requestError instanceof Error ? requestError.message : 'Unable to update your profile.'
        );
      }
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async () => {
    if (!currentPassword) {
      setPasswordError('Enter your current password.');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('Your new password must contain at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('The new passwords do not match.');
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordError('Choose a password different from your current password.');
      return;
    }
    setChangingPassword(true);
    setPasswordError('');
    setError('');
    setSuccess('');
    try {
      const updatedUser = await changeEmployeePassword(currentPassword, newPassword);
      setUser(updatedUser);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSuccess('Your password was changed.');
    } catch (requestError) {
      if (!handleFailure(requestError)) {
        setPasswordError(
          requestError instanceof Error ? requestError.message : 'Unable to change your password.'
        );
      }
    } finally {
      setChangingPassword(false);
    }
  };

  const confirmSignOut = () => {
    Alert.alert('Sign out?', 'You will need to sign in again to access your account.', [
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
              if (!handleFailure(requestError)) {
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
    <EmployeePage refreshing={refreshing} onRefresh={() => void loadProfile(true)}>
      <EmployeeHeader
        title="My profile"
        subtitle="Review your employee information and account security."
      />

      {error ? (
        <EmployeeNotice title="Profile action failed" message={error} tone="error" />
      ) : null}
      {success ? (
        <EmployeeNotice title="Done" message={success} tone="success" />
      ) : null}

      {loading && !profile ? (
        <EmployeeLoading message="Loading your employee profile..." />
      ) : profile ? (
        <>
          <EmployeeCard style={styles.profileCard}>
            <Text style={styles.sectionTitle}>Employment details</Text>
            <ProfileRow label="Employee ID" value={profile.employee_code || 'Not set'} />
            <ProfileRow label="Name" value={profile.name} />
            <ProfileRow label="Email" value={profile.email} />
            <ProfileRow label="Phone" value={profile.phone || 'Not set'} />
            <ProfileRow label="Position" value={profile.position || 'Not set'} />
            <ProfileRow label="Department" value={profile.department || 'Not set'} />
            <ProfileRow label="Joining date" value={profile.joining_date || 'Not set'} />
            <ProfileRow label="Employment type" value={profile.employment_type || 'Not set'} />
          </EmployeeCard>

          <EmployeeCard style={styles.formCard}>
            <Text style={styles.sectionTitle}>Edit personal details</Text>
            <Text style={styles.sectionSubtitle}>
              You can update your name and phone number. Official employment details are managed by your Administrator.
            </Text>
            <EmployeeField
              label="Name"
              value={name}
              onChangeText={(value) => {
                setName(value);
                setProfileError('');
              }}
              maxLength={120}
              autoCapitalize="words"
              autoCorrect={false}
            />
            <EmployeeField
              label="Phone number"
              value={phone}
              onChangeText={(value) => {
                setPhone(value);
                setProfileError('');
              }}
              maxLength={40}
              keyboardType="phone-pad"
            />
            {profileError ? (
              <EmployeeNotice title="Profile not saved" message={profileError} tone="error" />
            ) : null}
            <EmployeeButton
              label="Save profile"
              loading={savingProfile}
              onPress={() => void saveProfile()}
            />
          </EmployeeCard>

          <EmployeeCard style={styles.formCard}>
            <Text style={styles.sectionTitle}>Change password</Text>
            <Text style={styles.sectionSubtitle}>
              Use at least 8 characters and choose a password different from your current one.
            </Text>
            <EmployeeField
              label="Current password"
              value={currentPassword}
              onChangeText={setCurrentPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="current-password"
            />
            <EmployeeField
              label="New password"
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
            />
            <EmployeeField
              label="Confirm new password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
            />
            {passwordError ? (
              <EmployeeNotice title="Password not changed" message={passwordError} tone="error" />
            ) : null}
            <EmployeeButton
              label="Change password"
              loading={changingPassword}
              onPress={() => void savePassword()}
            />
          </EmployeeCard>
        </>
      ) : null}

      <EmployeeButton
        label={signingOut ? 'Signing out...' : 'Sign out'}
        variant="danger"
        loading={signingOut}
        onPress={confirmSignOut}
      />
    </EmployeePage>
  );
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.profileRow}>
      <Text style={styles.profileLabel}>{label}</Text>
      <Text style={styles.profileValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  profileCard: {
    gap: 0,
  },
  sectionTitle: {
    color: employeeColors.navy,
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 8,
  },
  sectionSubtitle: {
    color: employeeColors.muted,
    fontSize: 10,
    lineHeight: 15,
    marginBottom: 4,
  },
  profileRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: employeeColors.line,
  },
  profileLabel: {
    color: employeeColors.muted,
    fontSize: 10,
  },
  profileValue: {
    flex: 1,
    color: employeeColors.navy,
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'right',
  },
  formCard: {
    gap: 12,
  },
});
