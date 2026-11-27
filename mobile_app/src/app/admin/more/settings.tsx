import { useCallback, useEffect, useState } from 'react';
import { Text, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import MapView, { Marker, type Region } from 'react-native-maps';

import {
  getEmployee,
  getOfficeLocation,
  saveOfficeLocation,
  type AdminEmployee,
  type OfficeLocation,
} from '@/admin/api';
import {
  AdminButton,
  AdminCard,
  AdminField,
  AdminHeader,
  AdminLoading,
  AdminNotice,
  AdminPage,
  AdminBadge,
  adminColors,
} from '@/components/admin-ui';
import { ApiError } from '@/config/api';
import { useAuth } from '@/auth/auth-context';
import { getCurrentDeviceCoordinates, type Coordinates } from '@/location';

function regionFor(coordinates: Coordinates): Region {
  return {
    ...coordinates,
    latitudeDelta: 0.004,
    longitudeDelta: 0.004,
  };
}

export default function AdminSettingsScreen() {
  const router = useRouter();
  const { setUser, user } = useAuth();
  const [profile, setProfile] = useState<AdminEmployee | null>(null);
  const [officeLocation, setOfficeLocation] = useState<OfficeLocation | null>(null);
  const [draftCoordinates, setDraftCoordinates] = useState<Coordinates | null>(null);
  const [mapRegion, setMapRegion] = useState<Region | null>(null);
  const [radiusInput, setRadiusInput] = useState('200');
  const [mapVisible, setMapVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [locationError, setLocationError] = useState('');
  const [locationSuccess, setLocationSuccess] = useState('');
  const [capturingLocation, setCapturingLocation] = useState(false);
  const [savingLocation, setSavingLocation] = useState(false);

  const loadSettings = useCallback(async (refresh = false) => {
    setError('');
    setLocationError('');
    if (refresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      if (!user) {
        throw new Error('Your Admin session is not available.');
      }
      const [profileResult, officeLocationResult] = await Promise.all([
        getEmployee(user.id).then(
          (value) => ({ value }),
          (cause: unknown) => ({ cause })
        ),
        getOfficeLocation().then(
          (value) => ({ value }),
          (cause: unknown) => ({ cause })
        ),
      ]);

      const profileError = 'cause' in profileResult ? profileResult.cause : null;
      const officeLocationError =
        'cause' in officeLocationResult ? officeLocationResult.cause : null;
      if (
        (profileError instanceof ApiError && profileError.status === 401) ||
        (officeLocationError instanceof ApiError && officeLocationError.status === 401)
      ) {
        setUser(null);
        router.replace('/');
        return;
      }

      if (profileError) {
        setError(
          profileError instanceof Error
            ? profileError.message
            : 'Unable to load administrator profile.'
        );
      } else if ('value' in profileResult) {
        setProfile(profileResult.value);
      }

      if (officeLocationError) {
        setLocationError(
          officeLocationError instanceof Error
            ? officeLocationError.message
            : 'Unable to load office location settings.'
        );
      } else if ('value' in officeLocationResult) {
        const nextOfficeLocation = officeLocationResult.value;
        setOfficeLocation(nextOfficeLocation);
        setRadiusInput(String(nextOfficeLocation.radius_meters));
        if (
          nextOfficeLocation.configured &&
          nextOfficeLocation.latitude !== null &&
          nextOfficeLocation.longitude !== null
        ) {
          const coordinates = {
            latitude: nextOfficeLocation.latitude,
            longitude: nextOfficeLocation.longitude,
          };
          setDraftCoordinates(coordinates);
          setMapRegion(regionFor(coordinates));
        } else {
          setDraftCoordinates(null);
          setMapRegion(null);
        }
      }
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 401) {
        setUser(null);
        router.replace('/');
      } else {
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'Unable to load Admin settings.'
        );
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router, setUser, user]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const captureCurrentLocation = async () => {
    setLocationError('');
    setLocationSuccess('');
    setCapturingLocation(true);
    try {
      const coordinates = await getCurrentDeviceCoordinates();
      setDraftCoordinates(coordinates);
      setMapRegion(regionFor(coordinates));
      setMapVisible(false);
      setLocationSuccess(
        'Current location captured but not saved. Confirm the phone is at the office, then tap Save office location.'
      );
    } catch (captureError) {
      setLocationError(
        captureError instanceof Error ? captureError.message : 'Unable to capture device location.'
      );
    } finally {
      setCapturingLocation(false);
    }
  };

  const openMapPicker = async () => {
    setLocationError('');
    setLocationSuccess('');
    let center = draftCoordinates;
    if (
      !center &&
      officeLocation?.configured &&
      officeLocation.latitude !== null &&
      officeLocation.longitude !== null
    ) {
      center = {
        latitude: officeLocation.latitude,
        longitude: officeLocation.longitude,
      };
    }
    if (!center) {
      setCapturingLocation(true);
      try {
        center = await getCurrentDeviceCoordinates();
      } catch (captureError) {
        setLocationError(
          captureError instanceof Error ? captureError.message : 'Unable to center the map.'
        );
        setCapturingLocation(false);
        return;
      } finally {
        setCapturingLocation(false);
      }
    }
    setMapRegion(regionFor(center));
    setMapVisible(true);
  };

  const saveLocation = async () => {
    if (!draftCoordinates) {
      setLocationError('Capture the phone location or select a point on the map first.');
      return;
    }
    const radiusMeters = Number(radiusInput.trim());
    if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) {
      setLocationError('Enter a radius greater than zero metres.');
      return;
    }
    setLocationError('');
    setLocationSuccess('');
    setSavingLocation(true);
    try {
      await saveOfficeLocation(
        draftCoordinates.latitude,
        draftCoordinates.longitude,
        radiusMeters
      );
      const confirmed = await getOfficeLocation();
      if (
        !confirmed.configured ||
        confirmed.latitude === null ||
        confirmed.longitude === null
      ) {
        throw new Error('The server did not confirm that an office location was saved.');
      }
      if (
        confirmed.latitude !== draftCoordinates.latitude ||
        confirmed.longitude !== draftCoordinates.longitude ||
        confirmed.radius_meters !== radiusMeters
      ) {
        throw new Error(
          'The server returned office settings that do not match the selected location and radius. Your selection has been kept; refresh settings and try again.'
        );
      }
      setOfficeLocation(confirmed);
      setRadiusInput(String(confirmed.radius_meters));
      setDraftCoordinates({
        latitude: confirmed.latitude,
        longitude: confirmed.longitude,
      });
      setLocationSuccess(
        `Office location confirmed by the server. Employees can check in within ${confirmed.radius_meters} metres.`
      );
      setMapVisible(false);
    } catch (saveError) {
      if (saveError instanceof ApiError && saveError.status === 401) {
        setUser(null);
        router.replace('/');
      } else {
        setLocationError(
          saveError instanceof Error ? saveError.message : 'Unable to save the office location.'
        );
      }
    } finally {
      setSavingLocation(false);
    }
  };

  return (
    <AdminPage
      refreshing={refreshing}
      onRefresh={() => void loadSettings(true)}>
      <AdminHeader
        title="Profile & settings"
        subtitle="Administrator account and office location."
        action={
          <AdminButton
            label="Back"
            variant="secondary"
            compact
            onPress={() => router.back()}
          />
        }
      />

      {error ? (
        <AdminNotice
          title="Administrator profile unavailable"
          message={error}
          tone="error"
        />
      ) : null}

      {loading && !profile && !officeLocation ? (
        <AdminLoading message="Loading administrator settings..." />
      ) : null}

      {profile ? (
        <>
          <AdminCard style={styles.profileCard}>
            <View style={styles.profileTop}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {profile.name
                    .trim()
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((part) => part[0] ?? '')
                    .join('')
                    .toUpperCase()}
                </Text>
              </View>
              <View style={styles.profileName}>
                <Text style={styles.name}>{profile.name}</Text>
                <Text style={styles.email}>{profile.email}</Text>
              </View>
              <AdminBadge label="Admin" tone="green" />
            </View>
            <View style={styles.details}>
              <ProfileRow label="Account ID" value={String(profile.id)} />
              <ProfileRow label="Employee ID" value={profile.employee_code || 'Not set'} />
              <ProfileRow label="Phone" value={profile.phone || 'Not set'} />
              <ProfileRow label="Position" value={profile.position || 'Not set'} />
              <ProfileRow label="Department" value={profile.department || 'Unassigned'} />
              <ProfileRow label="Employment type" value={profile.employment_type} />
            </View>
          </AdminCard>
          <AdminNotice
            title="Account security"
            message="Employee password recovery is handled by an Admin temporary-password reset. Employees must choose a new password at their next sign-in."
          />
        </>
      ) : null}

      <AdminCard style={styles.locationCard}>
        <Text style={styles.sectionTitle}>Office location</Text>
        <Text style={styles.locationDescription}>
          Set the real office point while physically at the office. Coordinates are not prefilled.
        </Text>
        <View style={styles.locationStatus}>
          <Text style={styles.addressLabel}>Current status</Text>
          <AdminBadge
            label={
              officeLocation
                ? officeLocation.configured
                  ? 'Configured'
                  : 'Not configured'
                : loading
                  ? 'Loading'
                  : 'Unavailable'
            }
            tone={
              officeLocation?.configured
                ? 'green'
                : officeLocation
                  ? 'amber'
                  : loading
                    ? 'muted'
                    : 'red'
            }
          />
        </View>
        {locationError ? (
          <AdminNotice
            title="Office location error"
            message={locationError}
            tone="error"
          />
        ) : null}
        <Text style={styles.addressLabel}>Office address</Text>
        <Text style={styles.addressText}>
          {officeLocation?.address || 'Office address is unavailable.'}
        </Text>
        {officeLocation ? (
          officeLocation.configured &&
          officeLocation.latitude !== null &&
          officeLocation.longitude !== null ? (
            <View style={styles.details}>
              <ProfileRow
                label="Saved latitude"
                value={officeLocation.latitude.toFixed(6)}
              />
              <ProfileRow
                label="Saved longitude"
                value={officeLocation.longitude.toFixed(6)}
              />
            </View>
          ) : (
            <AdminNotice
              title="Location not configured"
              message="Employee check-in is blocked until an Admin captures and saves the office location."
              tone="error"
            />
          )
        ) : null}
        {draftCoordinates ? (
          <Text style={styles.selectedPoint}>
            Selected point: {draftCoordinates.latitude.toFixed(6)},{' '}
            {draftCoordinates.longitude.toFixed(6)}
          </Text>
        ) : null}
        <AdminField
          label="Allowed radius (metres)"
          value={radiusInput}
          onChangeText={setRadiusInput}
          keyboardType="decimal-pad"
          autoCapitalize="none"
        />
        <AdminButton
          label="Capture current location"
          variant="secondary"
          loading={capturingLocation}
          onPress={() => void captureCurrentLocation()}
        />
        <AdminButton
          label="Select point on map"
          variant="secondary"
          disabled={capturingLocation}
          onPress={() => void openMapPicker()}
        />
        {mapVisible && mapRegion ? (
          <View style={styles.mapSection}>
            <Text style={styles.mapHint}>Tap the map to place the office marker.</Text>
            <MapView
              style={styles.map}
              initialRegion={mapRegion}
              onPress={(event) => {
                const coordinate = event.nativeEvent.coordinate;
                setDraftCoordinates({
                  latitude: coordinate.latitude,
                  longitude: coordinate.longitude,
                });
                setLocationSuccess('Map point selected. Save to apply this office location.');
                setLocationError('');
              }}>
              {draftCoordinates ? (
                <Marker coordinate={draftCoordinates} title="Office location" />
              ) : null}
            </MapView>
            <AdminButton
              label="Done selecting"
              variant="secondary"
              onPress={() => setMapVisible(false)}
            />
          </View>
        ) : null}
        <AdminButton
          label="Save office location"
          loading={savingLocation}
          disabled={!draftCoordinates || capturingLocation}
          onPress={() => void saveLocation()}
        />
        <Text style={styles.mapHint}>
          Android standalone maps require a Google Maps API key; capturing the phone location does not.
        </Text>
        {locationSuccess ? (
          <AdminNotice
            title="Office location"
            message={locationSuccess}
            tone="success"
          />
        ) : null}
      </AdminCard>
    </AdminPage>
  );
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  profileCard: {
    padding: 17,
  },
  locationCard: {
    gap: 12,
  },
  locationStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: adminColors.navy,
    fontSize: 15,
    fontWeight: '800',
  },
  locationDescription: {
    color: adminColors.muted,
    fontSize: 11,
    lineHeight: 16,
  },
  addressLabel: {
    color: adminColors.muted,
    fontSize: 10,
    fontWeight: '700',
  },
  addressText: {
    color: adminColors.navy,
    fontSize: 11,
    lineHeight: 17,
  },
  selectedPoint: {
    color: adminColors.blue,
    fontSize: 10,
    fontWeight: '700',
  },
  mapSection: {
    gap: 10,
  },
  map: {
    width: '100%',
    height: 280,
    borderRadius: 14,
  },
  mapHint: {
    color: adminColors.muted,
    fontSize: 10,
    lineHeight: 15,
  },
  profileTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    backgroundColor: '#EEF1FF',
  },
  avatarText: {
    color: adminColors.navy,
    fontSize: 13,
    fontWeight: '800',
  },
  profileName: {
    flex: 1,
  },
  name: {
    color: adminColors.navy,
    fontSize: 13,
    fontWeight: '800',
  },
  email: {
    color: adminColors.muted,
    fontSize: 10,
    marginTop: 4,
  },
  details: {
    marginTop: 16,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 11,
    borderTopWidth: 1,
    borderTopColor: adminColors.line,
  },
  label: {
    color: adminColors.muted,
    fontSize: 11,
  },
  value: {
    flex: 1,
    color: adminColors.navy,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'right',
  },
});
