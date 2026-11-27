import * as Location from 'expo-location';

export type Coordinates = {
  latitude: number;
  longitude: number;
};

export async function getCurrentDeviceCoordinates(): Promise<Coordinates> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== 'granted') {
    throw new Error(
      permission.canAskAgain
        ? 'Location permission is required. Allow location access and try again.'
        : 'Location access is disabled for this app. Enable it in device settings and try again.'
    );
  }
  if (!(await Location.hasServicesEnabledAsync())) {
    throw new Error('Device location services are off. Turn on GPS and try again.');
  }
  try {
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    };
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : '';
    throw new Error(`Could not get a GPS fix.${detail}`);
  }
}
