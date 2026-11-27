module.exports = ({ config }) => {
  const isEasBuild = Boolean(process.env.EAS_BUILD_PROFILE);
  const apiUrl = process.env.EXPO_PUBLIC_API_URL?.trim();
  const androidPackageId =
    process.env.ANDROID_PACKAGE_ID?.trim() || 'com.haripriya01.attendance';

  if (isEasBuild) {
    if (!apiUrl) {
      throw new Error(
        'EAS builds require EXPO_PUBLIC_API_URL in the selected EAS environment.'
      );
    }

    let parsedApiUrl;
    try {
      parsedApiUrl = new URL(apiUrl);
    } catch {
      throw new Error(
        'EXPO_PUBLIC_API_URL must be a valid public HTTPS URL for EAS builds.'
      );
    }

    const hostname = parsedApiUrl.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const octets = hostname.split('.').map(Number);
    const isPrivateIpv4 =
      octets.length === 4 &&
      octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255) &&
      (octets[0] === 10 ||
        octets[0] === 127 ||
        octets[0] === 0 ||
        (octets[0] === 169 && octets[1] === 254) ||
        (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
        (octets[0] === 192 && octets[1] === 168));
    const isPrivateIpv6 =
      hostname === '::1' ||
      hostname.startsWith('fc') ||
      hostname.startsWith('fd') ||
      hostname.startsWith('fe80:');

    if (
      parsedApiUrl.protocol !== 'https:' ||
      parsedApiUrl.username ||
      parsedApiUrl.password ||
      !hostname ||
      hostname === 'localhost' ||
      hostname.endsWith('.local') ||
      isPrivateIpv4 ||
      isPrivateIpv6
    ) {
      throw new Error(
        'EAS EXPO_PUBLIC_API_URL must use HTTPS and a public host, not localhost or a private/LAN address.'
      );
    }

    if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(androidPackageId)) {
      throw new Error(
        'Android package ID must be in reverse-domain format, such as com.example.attendance.'
      );
    }
  }

  return {
    ...config,
    name: 'Daymark Office Attendance',
    android: {
      ...config.android,
      package: androidPackageId,
    },
    plugins: [
      ...(config.plugins ?? []),
      [
        'expo-location',
        {
          locationWhenInUsePermission:
            'Allow Office Attendance to verify check-ins at the registered office.',
        },
      ],
      [
        'react-native-maps',
        {
          androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
        },
      ],
    ],
  };
};
