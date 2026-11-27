import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthLoadingScreen, useAuth } from '@/auth/auth-context';
import {
  checkIn,
  checkOut,
  getAttendanceHistory,
  getEmployeeProfile,
  getTodayAttendance,
  type AttendanceHistoryItem,
  type EmployeeProfile,
  type TodayAttendance,
} from '@/employee/api';
import { ApiError, signOut } from '@/config/api';
import {
  EmployeeBadge,
  EmployeeButton,
  EmployeeCard,
  EmployeeNotice,
} from '@/components/employee-ui';
import { getCurrentDeviceCoordinates } from '@/location';
import {
  calculateEmployeeAchievements,
  type EmployeeAchievement,
} from '@/employee/achievements';

const colors = {
  navy: '#101B33',
  blue: '#4667E8',
  green: '#2A9D77',
  amber: '#CA8B24',
  muted: '#78839A',
  line: '#E9EDF3',
  paper: '#F7F8FB',
  white: '#FFFFFF',
  pink: '#FFF0F5',
  pinkBorder: '#F4DCE6',
  lavender: '#F3EEFF',
  lavenderBorder: '#E5DCF8',
  sky: '#EDF7FF',
  skyBorder: '#DCECF8',
  cream: '#FFF9E9',
  creamBorder: '#F3E9C9',
  purple: '#7563A8',
  red: '#B54747',
};

const dailyQuotes = [
  'Small steps every day lead to big achievements!',
  'Your steady effort is making a lovely difference.',
  'A little progress today is still progress worth celebrating.',
  'Show up, do your best, and let the good work add up.',
  'You bring something valuable to every day.',
  'Keep growing at your own pace. You are doing great.',
  'Kindness, care, and consistency make a wonderful team.',
];

const checkInNicknames = [
  {
    name: 'Minnal Murali ⚡',
    message: 'MINNAL MURALI HAS ENTERED! ⚡',
  },
  {
    name: 'Pushpa 🔥',
    message: 'PUSHPA HAS ENTERED! 🔥',
  },
  {
    name: 'Leo 🩸',
    message: 'LEO IS HERE! 🩸',
  },
  {
    name: 'Vikram 🦅',
    message: 'VIKRAM IS ON THE MOVE! 🦅',
  },
  {
    name: 'Jailer 👑',
    message: 'JAILER HAS ARRIVED! 👑',
  },
  {
    name: 'Baahubali ⚔️',
    message: 'BAAHUBALI IS HERE! ⚔️',
  },
  {
    name: 'Rocky Bhai 🔥',
    message: 'ROCKY BHAI TAKES CHARGE! 🔥',
  },
  {
    name: 'Master 😎',
    message: 'MASTER IS IN THE HOUSE! 😎',
  },
  {
    name: 'Beast 🐯',
    message: 'BEAST MODE: ON! 🐯',
  },
  {
    name: 'Don 👔',
    message: 'DON HAS ENTERED THE OFFICE! 👔',
  },
  {
    name: 'Mankatha 🎲',
    message: 'MANKATHA GAME ON! 🎲',
  },
] as const;

type CheckInNickname = (typeof checkInNicknames)[number];

type AttendanceCelebrationEvent = {
  id: number;
  kind: 'check-out';
  time: string;
};

function chooseCheckInNickname(previousName: CheckInNickname['name'] | null) {
  const options = previousName
    ? checkInNicknames.filter((nickname) => nickname.name !== previousName)
    : checkInNicknames;
  return options[Math.floor(Math.random() * options.length)] ?? checkInNicknames[0];
}

type CheckInNicknameRecord = {
  employeeId: number;
  date: string;
  nickname: CheckInNickname;
};

function getDailyNicknameKey(employeeId: number, date: string) {
  return `@office-attendance/check-in-nickname/${employeeId}/${date}`;
}

function getLatestNicknameKey(employeeId: number) {
  return `@office-attendance/check-in-nickname/${employeeId}/latest`;
}

function readNickname(value: string | null) {
  return checkInNicknames.find((nickname) => nickname.name === value) ?? null;
}

async function readLatestNickname(employeeId: number) {
  try {
    return {
      nickname: readNickname(await AsyncStorage.getItem(getLatestNicknameKey(employeeId))),
      error: '',
    };
  } catch {
    return {
      nickname: null,
      error: 'Could not read saved nickname history from this device.',
    };
  }
}

async function restoreOrCreateDailyNickname(
  employeeId: number,
  date: string,
  previousName: CheckInNickname['name'] | null
): Promise<{ record: CheckInNicknameRecord; error: string }> {
  let savedName: string | null = null;
  try {
    savedName = await AsyncStorage.getItem(getDailyNicknameKey(employeeId, date));
  } catch {
    // Continue with an in-memory nickname if local storage cannot be read.
  }

  const savedNickname = readNickname(savedName);
  if (savedNickname) {
    try {
      await AsyncStorage.setItem(getLatestNicknameKey(employeeId), savedNickname.name);
      return {
        record: { employeeId, date, nickname: savedNickname },
        error: '',
      };
    } catch {
      return {
        record: { employeeId, date, nickname: savedNickname },
        error: 'The saved nickname is shown, but nickname history could not be updated.',
      };
    }
  }

  const nickname = chooseCheckInNickname(previousName);
  const record = { employeeId, date, nickname };
  try {
    await AsyncStorage.multiSet([
      [getDailyNicknameKey(employeeId, date), nickname.name],
      [getLatestNicknameKey(employeeId), nickname.name],
    ]);
    return { record, error: '' };
  } catch {
    return {
      record,
      error: 'The nickname is shown, but could not be saved on this device.',
    };
  }
}

function greetingForHour(hour: number) {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function quoteForDate(date: Date) {
  const dayNumber = Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000
  );
  return dailyQuotes[dayNumber % dailyQuotes.length];
}

function displayDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
}

export default function EmployeeHomeScreen() {
  const { setUser, user } = useAuth();
  const router = useRouter();
  const requestId = useRef(0);
  const celebrationId = useRef(0);
  const lastCheckInNickname = useRef<{
    employeeId: number;
    name: CheckInNickname['name'];
  } | null>(null);
  const checkInNicknameRef = useRef<CheckInNicknameRecord | null>(null);
  const [profile, setProfile] = useState<EmployeeProfile | null>(null);
  const [today, setToday] = useState<TodayAttendance | null>(null);
  const [checkInNickname, setCheckInNickname] = useState<CheckInNicknameRecord | null>(null);
  const [nicknameStorageError, setNicknameStorageError] = useState('');
  const [attendanceHistory, setAttendanceHistory] = useState<AttendanceHistoryItem[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [achievementError, setAchievementError] = useState('');
  const [celebration, setCelebration] = useState<AttendanceCelebrationEvent | null>(null);
  const [locationState, setLocationState] = useState<
    'idle' | 'checking' | 'verified' | 'outside' | 'error'
  >('idle');
  const [locationMessage, setLocationMessage] = useState(
    'GPS location is verified by the server before check-in.'
  );
  const [attendanceAction, setAttendanceAction] = useState<'check-in' | 'check-out' | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const loadData = useCallback(async (refresh = false) => {
    const request = ++requestId.current;
    setError('');
    setAchievementError('');
    if (refresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    try {
      const [nextProfile, nextToday, historyResult] = await Promise.all([
        getEmployeeProfile(),
        getTodayAttendance(),
        getAttendanceHistory().then(
          (value) => ({ value }),
          (cause: unknown) => ({ cause })
        ),
      ]);
      const previousNicknameResult = await readLatestNickname(nextProfile.id);
      const previousNickname =
        previousNicknameResult.nickname?.name ??
        (lastCheckInNickname.current?.employeeId === nextProfile.id
          ? lastCheckInNickname.current.name
          : null);
      let nextCheckInNickname: CheckInNicknameRecord | null = null;
      let nextNicknameStorageError = previousNicknameResult.error;
      let shouldUpdateNicknameStorageError = true;
      if (nextToday.record?.check_in) {
        const cachedNickname = checkInNicknameRef.current;
        if (
          cachedNickname?.employeeId === nextProfile.id &&
          cachedNickname.date === nextToday.date
        ) {
          nextCheckInNickname = cachedNickname;
          shouldUpdateNicknameStorageError = false;
        } else {
          const resolved = await restoreOrCreateDailyNickname(
            nextProfile.id,
            nextToday.date,
            previousNickname
          );
          nextCheckInNickname = resolved.record;
          nextNicknameStorageError = resolved.error;
          checkInNicknameRef.current = resolved.record;
          lastCheckInNickname.current = {
            employeeId: nextProfile.id,
            name: resolved.record.nickname.name,
          };
        }
      }
      if (request === requestId.current) {
        if ('cause' in historyResult &&
          historyResult.cause instanceof ApiError &&
          historyResult.cause.status === 401
        ) {
          setUser(null);
          router.replace('/');
          return;
        }
        setProfile(nextProfile);
        setToday(nextToday);
        setCheckInNickname(nextCheckInNickname);
        if (nextCheckInNickname) {
          lastCheckInNickname.current = {
            employeeId: nextProfile.id,
            name: nextCheckInNickname.nickname.name,
          };
        } else if (previousNickname) {
          lastCheckInNickname.current = {
            employeeId: nextProfile.id,
            name: previousNickname,
          };
        }
        if (!nextToday.record?.check_in) {
          checkInNicknameRef.current = null;
        }
        if (shouldUpdateNicknameStorageError) {
          setNicknameStorageError(nextNicknameStorageError);
        }
        if ('cause' in historyResult) {
          setAchievementError(
            historyResult.cause instanceof Error
              ? historyResult.cause.message
              : 'Unable to load attendance achievements.'
          );
        } else {
          setAttendanceHistory(historyResult.value);
        }
      }
    } catch (requestError) {
      if (request === requestId.current) {
        if (requestError instanceof ApiError && requestError.status === 401) {
          setUser(null);
          router.replace('/');
          return;
        }
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'Unable to load your employee information.'
        );
      }
    } finally {
      if (request === requestId.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [router, setUser]);

  const submitAttendanceAction = async (action: 'check-in' | 'check-out') => {
    if (attendanceAction) {
      return;
    }
    setAttendanceAction(action);
    setError('');
    setCelebration(null);
    try {
      if (action === 'check-in') {
        setLocationState('checking');
        setLocationMessage('Requesting your current GPS location...');
        const coordinates = await getCurrentDeviceCoordinates();
        setLocationMessage('Verifying your location with the office server...');
        const verification = await checkIn(coordinates.latitude, coordinates.longitude);
        setLocationState('verified');
        setLocationMessage(
          `Verified inside the permitted area: ${verification.distance_meters.toFixed(1)} m from the office (limit ${verification.radius_meters} m).`
        );
        const employeeId = profile?.id ?? user?.id;
        if (employeeId !== undefined) {
          const previousName =
            lastCheckInNickname.current?.employeeId === employeeId
              ? lastCheckInNickname.current.name
              : null;
          const nickname = chooseCheckInNickname(previousName);
          const record = {
            employeeId,
            date: verification.date,
            nickname,
          };
          checkInNicknameRef.current = record;
          lastCheckInNickname.current = { employeeId, name: nickname.name };
          setCheckInNickname(record);
          try {
            await AsyncStorage.multiSet([
              [getDailyNicknameKey(employeeId, verification.date), nickname.name],
              [getLatestNicknameKey(employeeId), nickname.name],
            ]);
            setNicknameStorageError('');
          } catch {
            setNicknameStorageError(
              'The nickname is shown, but could not be saved on this device.'
            );
          }
        } else {
          setNicknameStorageError(
            'Check-in succeeded, but the nickname could not be linked to this employee.'
          );
        }
      } else {
        const result = await checkOut();
        setCelebration({
          id: ++celebrationId.current,
          kind: 'check-out',
          time: result.check_out,
        });
      }
      await loadData(true);
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 401) {
        setUser(null);
        router.replace('/');
      } else {
        if (action === 'check-in') {
          const message = requestError instanceof Error
            ? requestError.message
            : 'Unable to verify your location.';
          const outside = message.toLowerCase().includes('outside the allowed office radius');
          setLocationState(outside ? 'outside' : 'error');
          setLocationMessage(message);
        }
        setError(
          requestError instanceof Error
            ? requestError.message
            : `Unable to record ${action}.`
        );
      }
    } finally {
      setAttendanceAction(null);
    }
  };

  useFocusEffect(
    useCallback(() => {
      void loadData();
      return () => {
        requestId.current += 1;
      };
    }, [loadData])
  );

  const handleSignOut = async () => {
    setIsSigningOut(true);
    setError('');
    try {
      await signOut();
      setUser(null);
      router.replace('/');
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 401) {
        setUser(null);
        router.replace('/');
        return;
      }
      setError(requestError instanceof Error ? requestError.message : 'Unable to sign out.');
    } finally {
      setIsSigningOut(false);
    }
  };

  const attendanceStatus = today?.on_leave
    ? 'On approved leave'
    : today?.record?.check_in
      ? today.record.check_out
        ? `${today.record.status} · Shift complete`
        : today.record.status
      : 'Not checked in';
  const canCheckIn = Boolean(today && !today.record && !today.on_leave);
  const canCheckOut = Boolean(today?.record?.check_in && !today.record.check_out);
  const workingHours =
    today?.hours ??
    (today?.elapsed_seconds === null || today?.elapsed_seconds === undefined
      ? null
      : today.elapsed_seconds / 3600);
  const greeting = greetingForHour(new Date().getHours());
  const employeeName = profile?.name || user?.name || 'there';
  const dailyQuote = quoteForDate(new Date());
  const visibleCheckInNickname =
    checkInNickname !== null &&
    checkInNickname.employeeId === profile?.id &&
    checkInNickname.date === today?.date
      ? checkInNickname
      : null;

  if (isLoading && !profile) {
    return <AuthLoadingScreen message="Loading your employee workspace..." />;
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => void loadData(true)}
            tintColor={colors.blue}
            colors={[colors.blue]}
          />
        }>
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <View style={styles.logoMark}>
              <Text style={styles.logoText}>OA</Text>
            </View>
            <View>
              <Text style={styles.brandName}>Office Attendance</Text>
              <Text style={styles.brandCaption}>EMPLOYEE WORKSPACE</Text>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            disabled={isSigningOut}
            onPress={() => void handleSignOut()}
            style={({ pressed }) => [styles.signOutButton, pressed && styles.pressed]}>
            <Text style={styles.signOutText}>{isSigningOut ? 'Signing out...' : 'Sign out'}</Text>
          </Pressable>
        </View>

        <View
          accessible
          accessibilityLabel={`${greeting}, ${employeeName}. Ready for a wonderful day?`}
          style={styles.welcomeCard}>
          <View style={styles.welcomeCopy}>
            <Text style={styles.welcomeEyebrow}>A FRESH START</Text>
            <Text style={styles.welcomeTitle}>
              {greeting}, {employeeName}!
            </Text>
            <Text style={styles.welcomeMessage}>Ready for a wonderful day?</Text>
            <Text style={styles.welcomeSubmessage}>We are happy you are here.</Text>
          </View>
          <View
            accessible
            accessibilityLabel="Friendly bear mascot"
            style={styles.mascot}>
            <Text style={styles.mascotEmoji}>🐻</Text>
            <Text style={styles.mascotSparkle}>✦</Text>
          </View>
        </View>

        <View style={styles.motivationCard}>
          <View style={styles.motivationCopy}>
            <Text style={styles.motivationEyebrow}>A LITTLE DAILY BOOST</Text>
            <Text style={styles.motivationQuote}>{dailyQuote}</Text>
          </View>
          <Text accessible={false} style={styles.motivationDecoration}>🌷</Text>
        </View>

        {error ? (
          <View accessibilityLiveRegion="polite" style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void loadData()}
              style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : null}
        {today ? (
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeading}>
              <View>
                <Text style={styles.sectionTitle}>Today's attendance</Text>
                <Text style={styles.sectionSubtitle}>{displayDate(today.date)}</Text>
              </View>
              <View
                style={[
                  styles.statusPill,
                  today.record?.check_in
                    ? today.record.status === 'Late'
                      ? styles.statusLate
                      : styles.statusActive
                    : null,
                ]}>
                <Text
                  style={[
                    styles.statusText,
                    today.record?.check_in
                      ? today.record.status === 'Late'
                        ? styles.statusLateText
                        : styles.statusActiveText
                      : null,
                  ]}>
                  {attendanceStatus}
                </Text>
              </View>
            </View>
            <View style={styles.attendanceRow}>
              <View style={styles.timeColumn}>
                <Text style={styles.timeLabel}>CHECK-IN</Text>
                <Text style={styles.timeValue}>{today.record?.check_in || '--:--'}</Text>
              </View>
              <View style={styles.timeDivider} />
              <View style={styles.timeColumn}>
                <Text style={styles.timeLabel}>CHECK-OUT</Text>
                <Text style={styles.timeValue}>{today.record?.check_out || '--:--'}</Text>
              </View>
              <View style={styles.timeDivider} />
              <View style={styles.timeColumn}>
                <Text style={styles.timeLabel}>HOURS</Text>
                <Text style={styles.timeValue}>
                  {workingHours === null ? '--' : `${workingHours.toFixed(2)}h`}
                </Text>
              </View>
            </View>
            <View
              accessibilityLiveRegion="polite"
              style={[
                styles.locationIndicator,
                locationState === 'checking'
                  ? styles.locationChecking
                  : locationState === 'verified'
                    ? styles.locationVerified
                    : locationState === 'outside' || locationState === 'error'
                      ? styles.locationFailed
                      : styles.locationIdle,
              ]}>
              <Text style={styles.locationTitle}>Office location verification</Text>
              <Text style={styles.locationText}>{locationMessage}</Text>
            </View>
            <CheckInNicknameCard
              record={visibleCheckInNickname}
              storageError={nicknameStorageError}
            />
            <AttendanceCelebration celebration={celebration} />
            <View style={styles.attendanceActions}>
              <EmployeeButton
                label="Check in"
                loading={attendanceAction === 'check-in'}
                disabled={!canCheckIn || attendanceAction !== null}
                onPress={() => void submitAttendanceAction('check-in')}
              />
              <EmployeeButton
                label="Check out"
                variant="secondary"
                loading={attendanceAction === 'check-out'}
                disabled={!canCheckOut || attendanceAction !== null}
                onPress={() => void submitAttendanceAction('check-out')}
              />
            </View>
            {today.on_leave ? (
              <Text style={styles.notice}>Check-in is unavailable while you are on approved leave.</Text>
            ) : null}
            {!today.record && !today.on_leave ? (
              <Text style={styles.notice}>
                No attendance record has been created for today.
              </Text>
            ) : null}
          </View>
        ) : isLoading ? (
          <View style={styles.loadingCard}>
            <ActivityIndicator color={colors.blue} />
            <Text style={styles.loadingText}>Loading today's attendance...</Text>
          </View>
        ) : null}

        {achievementError ? (
          <EmployeeNotice
            title="Achievements unavailable"
            message={achievementError}
            tone="error"
            action={
              <EmployeeButton
                label="Try again"
                variant="secondary"
                onPress={() => void loadData(true)}
              />
            }
          />
        ) : attendanceHistory ? (
          <AchievementSection achievements={calculateEmployeeAchievements(attendanceHistory)} />
        ) : isLoading ? (
          <View style={styles.achievementLoading}>
            <ActivityIndicator color={colors.blue} />
            <Text style={styles.achievementLoadingText}>Loading your achievements...</Text>
          </View>
        ) : null}

        {profile ? (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Employee profile</Text>
            <Text style={styles.sectionSubtitle}>Details from your shared workplace account</Text>
            <View style={styles.profileRows}>
              <ProfileRow label="Employee ID" value={profile.employee_code || 'Not set'} />
              <ProfileRow label="Email" value={profile.email} />
              <ProfileRow label="Position" value={profile.position || 'Not set'} />
              <ProfileRow label="Department" value={profile.department || 'Not set'} />
              <ProfileRow label="Phone" value={profile.phone || 'Not set'} />
              <ProfileRow label="Joining date" value={profile.joining_date || 'Not set'} />
              <ProfileRow label="Employment type" value={profile.employment_type || 'Not set'} />
            </View>
          </View>
        ) : null}
        <Text style={styles.footer}>Office Attendance Management System</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function AchievementSection({ achievements }: { achievements: EmployeeAchievement[] }) {
  return (
    <EmployeeCard style={styles.achievementCard}>
      <View>
        <Text style={styles.sectionTitle}>Your little wins</Text>
        <Text style={styles.sectionSubtitle}>
          Earned from your verified attendance history.
        </Text>
      </View>
      <View style={styles.achievementGrid}>
        {achievements.map((achievement) => (
          <View
            key={achievement.id}
            accessible
            accessibilityLabel={`${achievement.title}, ${achievement.unlocked ? 'unlocked' : 'locked'}. ${achievement.progressLabel}`}
            style={[
              styles.achievementTile,
              achievement.unlocked
                ? styles.achievementTileUnlocked
                : styles.achievementTileLocked,
            ]}>
            <View style={styles.achievementTileHeading}>
              <Text accessible={false} style={styles.achievementIcon}>
                {achievement.icon}
              </Text>
              <EmployeeBadge
                label={achievement.unlocked ? 'Unlocked' : 'Locked'}
                tone={achievement.unlocked ? 'green' : 'muted'}
              />
            </View>
            <Text style={styles.achievementTitle}>{achievement.title}</Text>
            <Text style={styles.achievementDescription}>{achievement.description}</Text>
            <Text style={styles.achievementProgress}>{achievement.progressLabel}</Text>
          </View>
        ))}
      </View>
    </EmployeeCard>
  );
}

function AttendanceCelebration({
  celebration,
}: {
  celebration: AttendanceCelebrationEvent | null;
}) {
  const animation = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!celebration) {
      return;
    }
    animation.setValue(0);
    const sequence = Animated.sequence([
      Animated.spring(animation, {
        toValue: 1,
        friction: 7,
        tension: 90,
        useNativeDriver: true,
      }),
      Animated.delay(1800),
      Animated.timing(animation, {
        toValue: 0,
        duration: 260,
        useNativeDriver: true,
      }),
    ]);
    sequence.start();
    return () => sequence.stop();
  }, [animation, celebration]);

  if (!celebration) {
    return null;
  }

  const translateY = animation.interpolate({
    inputRange: [0, 1],
    outputRange: [8, 0],
  });
  const scale = animation.interpolate({
    inputRange: [0, 1],
    outputRange: [0.97, 1],
  });
  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      accessibilityLabel={`Great work! Check-out complete at ${celebration.time}.`}
      style={[
        styles.celebrationCard,
        { opacity: animation, transform: [{ translateY }, { scale }] },
      ]}>
      <Text accessible={false} style={styles.celebrationDecoration}>
        ✨　✦　🎉　✦　✨
      </Text>
      <Text style={styles.celebrationTitle}>Great work! Check-out complete!</Text>
      <Text style={styles.celebrationTime}>
        Checked out at {celebration.time}
      </Text>
    </Animated.View>
  );
}

function CheckInNicknameCard({
  record,
  storageError,
}: {
  record: CheckInNicknameRecord | null;
  storageError: string;
}) {
  if (!record) {
    return storageError ? (
      <Text accessibilityLiveRegion="polite" style={styles.nicknameStorageError}>
        {storageError}
      </Text>
    ) : null;
  }

  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${record.nickname.message} ${record.nickname.name}`}
      style={styles.celebrationCard}>
      <Text accessible={false} style={styles.celebrationDecoration}>
        ✨　✦　🎉　✦　✨
      </Text>
      <Text style={styles.celebrationTitle}>{record.nickname.message}</Text>
      <Text style={styles.celebrationNickname}>{record.nickname.name}</Text>
      {storageError ? (
        <Text style={styles.nicknameStorageError}>{storageError}</Text>
      ) : null}
    </View>
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
  safeArea: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  content: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 36,
    gap: 18,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoMark: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    backgroundColor: colors.navy,
  },
  logoText: {
    color: colors.white,
    fontSize: 17,
    fontWeight: '800',
  },
  brandName: {
    color: colors.navy,
    fontSize: 16,
    fontWeight: '800',
  },
  brandCaption: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: 2,
  },
  signOutButton: {
    paddingVertical: 9,
    paddingHorizontal: 13,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
  },
  signOutText: {
    color: colors.navy,
    fontSize: 12,
    fontWeight: '700',
  },
  welcomeCard: {
    minHeight: 128,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.lavenderBorder,
    backgroundColor: colors.lavender,
    shadowColor: colors.purple,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 2,
  },
  welcomeCopy: {
    flex: 1,
    gap: 4,
  },
  welcomeEyebrow: {
    color: colors.purple,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  welcomeTitle: {
    color: colors.navy,
    fontSize: 19,
    fontWeight: '800',
    lineHeight: 25,
  },
  welcomeMessage: {
    color: colors.navy,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 16,
  },
  welcomeSubmessage: {
    color: colors.muted,
    fontSize: 10,
    lineHeight: 15,
  },
  mascot: {
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 25,
    borderWidth: 1,
    borderColor: colors.skyBorder,
    backgroundColor: colors.sky,
  },
  mascotEmoji: {
    fontSize: 39,
  },
  mascotSparkle: {
    position: 'absolute',
    top: 4,
    right: 7,
    color: colors.purple,
    fontSize: 15,
    fontWeight: '800',
  },
  motivationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.creamBorder,
    backgroundColor: colors.cream,
  },
  motivationCopy: {
    flex: 1,
    gap: 5,
  },
  motivationEyebrow: {
    color: colors.amber,
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 1,
  },
  motivationQuote: {
    color: colors.navy,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
  },
  motivationDecoration: {
    fontSize: 29,
  },
  celebrationCard: {
    alignItems: 'center',
    gap: 4,
    padding: 14,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.pinkBorder,
    backgroundColor: colors.pink,
  },
  celebrationDecoration: {
    color: colors.purple,
    fontSize: 15,
    marginBottom: 2,
  },
  celebrationTitle: {
    color: colors.navy,
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 20,
  },
  celebrationNickname: {
    color: '#B54469',
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'center',
  },
  celebrationTime: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '600',
  },
  nicknameStorageError: {
    color: colors.red,
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
  },
  achievementCard: {
    gap: 12,
    borderColor: colors.lavenderBorder,
    backgroundColor: '#FFFEFF',
  },
  achievementGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  achievementTile: {
    flexGrow: 1,
    flexBasis: '47%',
    minWidth: '46%',
    minHeight: 140,
    gap: 7,
    padding: 11,
    borderWidth: 1,
    borderRadius: 14,
  },
  achievementTileUnlocked: {
    borderColor: colors.lavenderBorder,
    backgroundColor: colors.lavender,
  },
  achievementTileLocked: {
    borderColor: colors.line,
    backgroundColor: '#F7F8FA',
  },
  achievementTileHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
  },
  achievementIcon: {
    fontSize: 19,
  },
  achievementTitle: {
    color: colors.navy,
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 15,
  },
  achievementDescription: {
    flex: 1,
    color: colors.muted,
    fontSize: 9,
    lineHeight: 13,
  },
  achievementProgress: {
    color: colors.purple,
    fontSize: 9,
    fontWeight: '700',
    lineHeight: 13,
  },
  achievementLoading: {
    minHeight: 90,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.lavenderBorder,
    backgroundColor: colors.lavender,
  },
  achievementLoadingText: {
    color: colors.muted,
    fontSize: 11,
  },
  sectionCard: {
    padding: 17,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    shadowColor: '#1C2A3A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.035,
    shadowRadius: 10,
    elevation: 2,
  },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  sectionTitle: {
    color: colors.navy,
    fontSize: 15,
    fontWeight: '700',
  },
  sectionSubtitle: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
  statusPill: {
    paddingVertical: 6,
    paddingHorizontal: 9,
    borderRadius: 10,
    backgroundColor: '#F1F3F7',
  },
  statusActive: {
    backgroundColor: '#E8F7F0',
  },
  statusText: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '700',
  },
  statusActiveText: {
    color: colors.green,
  },
  statusLate: {
    backgroundColor: '#FFF2DE',
  },
  statusLateText: {
    color: '#CA8B24',
  },
  attendanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 19,
    marginTop: 15,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  attendanceActions: {
    gap: 9,
    marginTop: 16,
  },
  locationIndicator: {
    gap: 4,
    padding: 11,
    marginTop: 14,
    borderRadius: 12,
  },
  locationIdle: {
    backgroundColor: '#EEF1FF',
  },
  locationChecking: {
    backgroundColor: '#FFF5E7',
  },
  locationVerified: {
    backgroundColor: '#E8F7F0',
  },
  locationFailed: {
    backgroundColor: '#FFF0F0',
  },
  locationTitle: {
    color: colors.navy,
    fontSize: 10,
    fontWeight: '800',
  },
  locationText: {
    color: colors.muted,
    fontSize: 10,
    lineHeight: 15,
  },
  timeColumn: {
    flex: 1,
    alignItems: 'center',
  },
  timeLabel: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.7,
  },
  timeValue: {
    color: colors.navy,
    fontSize: 15,
    fontWeight: '800',
    marginTop: 7,
  },
  timeDivider: {
    width: 1,
    height: 34,
    backgroundColor: colors.line,
  },
  notice: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 17,
    padding: 11,
    marginTop: 16,
    borderRadius: 11,
    backgroundColor: colors.paper,
  },
  profileRows: {
    marginTop: 13,
  },
  profileRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 11,
    borderTopWidth: 1,
    borderTopColor: '#F1F3F7',
  },
  profileLabel: {
    color: colors.muted,
    fontSize: 11,
  },
  profileValue: {
    flex: 1,
    color: colors.navy,
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'right',
  },
  loadingCard: {
    minHeight: 130,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    borderRadius: 16,
    backgroundColor: colors.white,
  },
  loadingText: {
    color: colors.muted,
    fontSize: 12,
  },
  errorCard: {
    padding: 14,
    borderRadius: 13,
    borderColor: '#F2D1D1',
    borderWidth: 1,
    backgroundColor: '#FFF7F7',
  },
  errorText: {
    color: '#A63737',
    fontSize: 12,
    lineHeight: 17,
  },
  retryButton: {
    alignSelf: 'flex-start',
    paddingVertical: 7,
    paddingHorizontal: 10,
    marginTop: 8,
    borderRadius: 8,
    backgroundColor: colors.white,
  },
  retryText: {
    color: colors.navy,
    fontSize: 11,
    fontWeight: '700',
  },
  footer: {
    color: colors.muted,
    fontSize: 10,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.72,
  },
});
