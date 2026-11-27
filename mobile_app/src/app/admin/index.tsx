import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentProps } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/auth-context';
import { getEmployees } from '@/admin/api';
import { ApiError, apiRequest, signOut } from '@/config/api';

type Period = 'week' | 'month' | 'year';
type DashboardSymbol = NonNullable<ComponentProps<typeof SymbolView>['name']>;
type RecentAttendance = {
  date: string;
  check_in: string | null;
  check_out: string | null;
  status: string;
  name: string;
  department: string | null;
};
type PendingLeave = {
  id: number;
  from_date: string;
  to_date: string;
  reason: string;
  name: string;
  department: string | null;
};
type EmployeeCounts = {
  total: number;
  active: number;
};
type DashboardOverview = {
  today: string;
  metrics: {
    employees: number;
    present: number;
    late: number;
    absent: number;
    on_leave: number;
  };
  recent_attendance: RecentAttendance[];
  pending_leaves: PendingLeave[];
};
type AttendanceSummary = {
  empty: boolean;
  start_date: string;
  end_date: string;
  timezone: string;
  series: { date: string; label: string; present: number }[];
  stats: {
    present: number;
    absent: number;
    on_leave: number;
    completed: number;
    in_progress: number;
    hours: number;
  };
};

const colors = {
  navy: '#101B33',
  blue: '#4667E8',
  green: '#2A9D77',
  amber: '#CA8B24',
  rose: '#CE6576',
  ink: '#17233C',
  muted: '#78839A',
  line: '#E9EDF3',
  paper: '#F7F8FB',
  white: '#FFFFFF',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function requiredNumber(value: unknown, field: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`The dashboard response contains an invalid ${field}.`);
  }
  return value;
}

function requiredString(value: unknown, field: string) {
  if (typeof value !== 'string') {
    throw new Error(`The dashboard response contains an invalid ${field}.`);
  }
  return value;
}

function optionalString(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function readOverview(payload: unknown): DashboardOverview {
  if (!isRecord(payload) || !isRecord(payload.metrics)) {
    throw new Error('The server returned an invalid Admin overview.');
  }
  const recent = payload.recent_attendance;
  const pending = payload.pending_leaves;
  if (!Array.isArray(recent) || !Array.isArray(pending)) {
    throw new Error('The server returned incomplete Admin overview data.');
  }

  return {
    today: requiredString(payload.today, 'date'),
    metrics: {
      employees: requiredNumber(payload.metrics.employees, 'employee count'),
      present: requiredNumber(payload.metrics.present, 'present count'),
      late: requiredNumber(payload.metrics.late, 'late count'),
      absent: requiredNumber(payload.metrics.absent, 'absent count'),
      on_leave: requiredNumber(payload.metrics.on_leave, 'leave count'),
    },
    recent_attendance: recent.map((value) => {
      if (!isRecord(value)) {
        throw new Error('The server returned an invalid attendance row.');
      }
      return {
        date: requiredString(value.date, 'attendance date'),
        check_in: optionalString(value.check_in),
        check_out: optionalString(value.check_out),
        status: requiredString(value.status, 'attendance status'),
        name: requiredString(value.name, 'employee name'),
        department: optionalString(value.department),
      };
    }),
    pending_leaves: pending.map((value) => {
      if (!isRecord(value)) {
        throw new Error('The server returned an invalid leave row.');
      }
      return {
        id: requiredNumber(value.id, 'leave ID'),
        from_date: requiredString(value.from_date, 'leave start date'),
        to_date: requiredString(value.to_date, 'leave end date'),
        reason: requiredString(value.reason, 'leave reason'),
        name: requiredString(value.name, 'employee name'),
        department: optionalString(value.department),
      };
    }),
  };
}

function readAttendanceSummary(payload: unknown): AttendanceSummary {
  if (!isRecord(payload) || !isRecord(payload.stats) || !Array.isArray(payload.series)) {
    throw new Error('The server returned an invalid attendance overview.');
  }
  const stats = payload.stats;
  return {
    empty: payload.empty === true,
    start_date: requiredString(payload.start_date, 'period start date'),
    end_date: requiredString(payload.end_date, 'period end date'),
    timezone: requiredString(payload.timezone, 'office timezone'),
    series: payload.series.map((value) => {
      if (!isRecord(value)) {
        throw new Error('The server returned an invalid chart value.');
      }
      return {
        date: requiredString(value.date, 'chart date'),
        label: requiredString(value.label, 'chart label'),
        present: requiredNumber(value.present, 'attendance value'),
      };
    }),
    stats: {
      present: requiredNumber(stats.present, 'period present count'),
      absent: requiredNumber(stats.absent, 'period absent count'),
      on_leave: requiredNumber(stats.on_leave, 'period leave count'),
      completed: requiredNumber(stats.completed, 'completed shifts'),
      in_progress: requiredNumber(stats.in_progress, 'active shifts'),
      hours: requiredNumber(stats.hours, 'hours total'),
    },
  };
}

function dateLabel(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();
}

export default function AdminDashboardScreen() {
  const { setUser, user } = useAuth();
  const router = useRouter();
  const requestId = useRef(0);
  const [period, setPeriod] = useState<Period>('week');
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [attendance, setAttendance] = useState<AttendanceSummary | null>(null);
  const [employeeCounts, setEmployeeCounts] = useState<EmployeeCounts | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [isSigningOut, setIsSigningOut] = useState(false);

  const loadDashboard = useCallback(async (selectedPeriod: Period, refresh = false) => {
    const request = ++requestId.current;
    setError('');
    if (refresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
      setAttendance(null);
    }

    try {
      const [overviewResponse, attendanceResponse, employees] = await Promise.all([
        apiRequest('/api/admin/overview'),
        apiRequest(`/api/admin/attendance/overview?period=${selectedPeriod}`),
        getEmployees(),
      ]);
      const nextOverview = readOverview(overviewResponse);
      const nextAttendance = readAttendanceSummary(attendanceResponse);
      const employeeAccounts = employees.filter((employee) => employee.role === 'employee');
      if (request === requestId.current) {
        setOverview(nextOverview);
        setAttendance(nextAttendance);
        setEmployeeCounts({
          total: employeeAccounts.length,
          active: employeeAccounts.filter((employee) => employee.is_active).length,
        });
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
            : 'Unable to load the Admin dashboard.'
        );
      }
    } finally {
      if (request === requestId.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadDashboard(period);
    return () => {
      requestId.current += 1;
    };
  }, [loadDashboard, period]);

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
      setError(
        requestError instanceof Error ? requestError.message : 'Unable to sign out.'
      );
    } finally {
      setIsSigningOut(false);
    }
  };

  const metrics = overview?.metrics;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => void loadDashboard(period, true)}
            tintColor={colors.blue}
            colors={[colors.blue]}
          />
        }>
        <View style={styles.topBar}>
          <View style={styles.brandRow}>
            <View style={styles.logoMark}>
              <Text style={styles.logoText}>OA</Text>
            </View>
            <View>
              <Text style={styles.brandName}>Office Attendance</Text>
              <Text style={styles.brandCaption}>ADMIN WORKSPACE</Text>
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
        <View style={styles.headingRow}>
          <View style={styles.headingCopy}>
            <Text style={styles.eyebrow}>WORKSPACE OVERVIEW</Text>
            <Text style={styles.title}>Good day{user?.name ? `, ${user.name.split(' ')[0]}` : ''}</Text>
            <Text style={styles.subtitle}>
              {overview ? `Today · ${dateLabel(overview.today)}` : 'Your team at a glance'}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh dashboard"
            disabled={isRefreshing || isLoading}
            onPress={() => void loadDashboard(period, true)}
            style={({ pressed }) => [styles.refreshButton, pressed && styles.pressed]}>
            <SymbolView
              name={{ ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' }}
              size={18}
              tintColor={colors.navy}
            />
          </Pressable>
        </View>

        {error ? (
          <View accessibilityLiveRegion="polite" style={styles.errorCard}>
            <Text style={styles.errorTitle}>Dashboard unavailable</Text>
            <Text style={styles.errorMessage}>{error}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void loadDashboard(period)}
              style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : null}

        {isLoading && !overview ? (
          <View style={styles.loadingCard}>
            <ActivityIndicator color={colors.blue} size="large" />
            <Text style={styles.loadingText}>Loading live attendance data...</Text>
          </View>
        ) : metrics && employeeCounts ? (
          <>
            <View style={styles.metricGrid}>
              <MetricCard
                label="Total employees"
                value={employeeCounts.total}
                note="Employee accounts"
                color={colors.blue}
                symbol={{ ios: 'person.2.fill', android: 'people', web: 'group' }}
              />
              <MetricCard
                label="Active employees"
                value={employeeCounts.active}
                note="Active team members"
                color={colors.blue}
                symbol={{ ios: 'person.2.fill', android: 'people', web: 'group' }}
              />
              <MetricCard
                label="Present today"
                value={metrics.present}
                note="On time"
                color={colors.green}
                symbol={{ ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' }}
              />
              <MetricCard
                label="Late today"
                value={metrics.late}
                note="Checked in after cutoff"
                color={colors.amber}
                symbol={{ ios: 'clock.fill', android: 'schedule', web: 'schedule' }}
              />
              <MetricCard
                label="Absent"
                value={metrics.absent}
                note="Not in or on leave"
                color={colors.rose}
                symbol={{ ios: 'person.fill.questionmark', android: 'person', web: 'person' }}
              />
              <MetricCard
                label="On leave"
                value={metrics.on_leave}
                note="Approved today"
                color={colors.amber}
                symbol={{ ios: 'sun.max.fill', android: 'event_busy', web: 'event_busy' }}
              />
            </View>

            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionHeadingCopy}>
                  <Text style={styles.sectionTitle}>Attendance overview</Text>
                  <Text style={styles.sectionSubtitle}>
                    {attendance
                      ? `${dateLabel(attendance.start_date)} - ${dateLabel(attendance.end_date)} · ${attendance.timezone}`
                      : 'Loading period summary'}
                  </Text>
                </View>
              </View>

              <View style={styles.periodSelector}>
                {([
                  ['week', 'Week'],
                  ['month', 'Month'],
                  ['year', 'Year'],
                ] as const).map(([value, label]) => {
                  const selected = period === value;
                  return (
                    <Pressable
                      key={value}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => setPeriod(value)}
                      style={[styles.periodButton, selected && styles.periodButtonSelected]}>
                      <Text style={[styles.periodText, selected && styles.periodTextSelected]}>
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {attendance?.empty ? (
                <View style={styles.chartEmpty}>
                  <Text style={styles.emptyTitle}>No attendance records</Text>
                  <Text style={styles.emptyMessage}>
                    Check-ins for this period will appear here.
                  </Text>
                </View>
              ) : attendance ? (
                <>
                  <View style={styles.chart}>
                    {attendance.series.map((item, index) => {
                      const maximum = Math.max(
                        1,
                        ...attendance.series.map((entry) => entry.present)
                      );
                      const barHeight = Math.max(0, (item.present / maximum) * 100);
                      const showLabel =
                        period !== 'month' || index % 5 === 0 || index === attendance.series.length - 1;
                      return (
                        <View key={item.date} style={styles.chartColumn}>
                          <View style={styles.chartTrack}>
                            <View
                              style={[
                                styles.chartBar,
                                { height: `${barHeight}%` },
                                item.present > 0 && styles.chartBarFilled,
                              ]}
                            />
                          </View>
                          <Text style={styles.chartLabel}>{showLabel ? item.label : ''}</Text>
                        </View>
                      );
                    })}
                  </View>
                  <View style={styles.summaryGrid}>
                    <SummaryItem label="Present" value={attendance.stats.present} />
                    <SummaryItem label="Absent" value={attendance.stats.absent} />
                    <SummaryItem label="On leave" value={attendance.stats.on_leave} />
                    <SummaryItem label="Hours logged" value={`${attendance.stats.hours.toFixed(2)} h`} />
                  </View>
                </>
              ) : isLoading ? (
                <View style={styles.chartLoading}>
                  <ActivityIndicator color={colors.blue} />
                </View>
              ) : (
                <View style={styles.chartEmpty}>
                  <Text style={styles.emptyTitle}>Attendance overview unavailable</Text>
                  <Text style={styles.emptyMessage}>
                    Refresh to try loading this period again.
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <View>
                  <Text style={styles.sectionTitle}>Recent check-ins</Text>
                  <Text style={styles.sectionSubtitle}>Latest attendance activity</Text>
                </View>
              </View>
              {overview.recent_attendance.length ? (
                overview.recent_attendance.map((row, index) => (
                  <View key={`${row.date}-${row.name}-${index}`} style={styles.listRow}>
                    <View style={[styles.avatar, index % 2 ? styles.avatarGreen : styles.avatarBlue]}>
                      <Text style={styles.avatarText}>{initials(row.name)}</Text>
                    </View>
                    <View style={styles.listCopy}>
                      <Text style={styles.listTitle}>{row.name}</Text>
                      <Text style={styles.listSubtitle}>
                        {row.department || 'Unassigned'} · {dateLabel(row.date)}
                      </Text>
                    </View>
                    <View style={styles.listMeta}>
                      <Text style={styles.listTime}>{row.check_in || '--:--'}</Text>
                      <Text
                        style={[
                          styles.attendanceStatus,
                          row.status === 'Late'
                            ? styles.lateAttendanceStatus
                            : row.status === 'Present'
                              ? styles.presentAttendanceStatus
                              : null,
                        ]}>
                        {row.status}
                      </Text>
                    </View>
                  </View>
                ))
              ) : (
                <EmptyState
                  title="No check-ins yet"
                  message="Recent employee check-ins will appear here."
                />
              )}
            </View>

            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <View>
                  <Text style={styles.sectionTitle}>Pending leave requests</Text>
                  <Text style={styles.sectionSubtitle}>Waiting for Admin review</Text>
                </View>
                <View style={styles.countBadge}>
                  <Text style={styles.countText}>
                    {overview.pending_leaves.length === 5
                      ? '5+'
                      : overview.pending_leaves.length}
                  </Text>
                </View>
              </View>
              {overview.pending_leaves.length ? (
                overview.pending_leaves.map((leave) => (
                  <View key={leave.id} style={styles.leaveRow}>
                    <View style={[styles.avatar, styles.avatarPlum]}>
                      <Text style={styles.avatarText}>{initials(leave.name)}</Text>
                    </View>
                    <View style={styles.leaveCopy}>
                      <Text style={styles.listTitle}>{leave.name}</Text>
                      <Text style={styles.listSubtitle}>
                        {dateLabel(leave.from_date)} - {dateLabel(leave.to_date)} ·{' '}
                        {leave.department || 'Unassigned'}
                      </Text>
                      <Text numberOfLines={2} style={styles.leaveReason}>
                        {leave.reason}
                      </Text>
                    </View>
                    <View style={styles.pendingPill}>
                      <Text style={styles.pendingText}>Pending</Text>
                    </View>
                  </View>
                ))
              ) : (
                <EmptyState
                  title="All caught up"
                  message="There are no pending leave requests."
                />
              )}
            </View>
          </>
        ) : null}
        <Text style={styles.footer}>Office Attendance Management System</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function MetricCard({
  label,
  value,
  note,
  color,
  symbol,
}: {
  label: string;
  value: number;
  note: string;
  color: string;
  symbol: DashboardSymbol;
}) {
  return (
    <View style={styles.metricCard}>
      <View style={styles.metricHeader}>
        <Text style={styles.metricLabel}>{label}</Text>
        <View style={[styles.metricIcon, { backgroundColor: `${color}18` }]}>
          <SymbolView name={symbol} size={17} tintColor={color} />
        </View>
      </View>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricNote}>{note}</Text>
    </View>
  );
}

function SummaryItem({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.summaryItem}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyMessage}>{message}</Text>
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
    maxWidth: 760,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 36,
    gap: 18,
  },
  topBar: {
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
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
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
    letterSpacing: -0.5,
  },
  brandCaption: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.2,
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
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  headingCopy: {
    flex: 1,
  },
  eyebrow: {
    color: colors.blue,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: 7,
  },
  title: {
    color: colors.navy,
    fontSize: 27,
    lineHeight: 34,
    fontWeight: '800',
    letterSpacing: -0.7,
  },
  subtitle: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 4,
  },
  refreshButton: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metricCard: {
    width: '48%',
    flexGrow: 1,
    minWidth: 142,
    padding: 14,
    borderRadius: 17,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    shadowColor: '#1C2A3A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.035,
    shadowRadius: 10,
    elevation: 2,
  },
  metricHeader: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 6,
  },
  metricLabel: {
    flex: 1,
    color: colors.muted,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
  },
  metricIcon: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  metricValue: {
    color: colors.navy,
    fontSize: 27,
    lineHeight: 33,
    fontWeight: '800',
    marginTop: 8,
  },
  metricNote: {
    color: colors.muted,
    fontSize: 10,
    marginTop: 3,
  },
  sectionCard: {
    padding: 16,
    borderRadius: 19,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    shadowColor: '#1C2A3A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.035,
    shadowRadius: 10,
    elevation: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  sectionHeadingCopy: {
    flex: 1,
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
  periodSelector: {
    flexDirection: 'row',
    gap: 6,
    alignSelf: 'flex-start',
    padding: 4,
    marginBottom: 16,
    borderRadius: 12,
    backgroundColor: colors.paper,
  },
  periodButton: {
    minWidth: 62,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 9,
  },
  periodButtonSelected: {
    backgroundColor: colors.navy,
  },
  periodText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
  },
  periodTextSelected: {
    color: colors.white,
  },
  chart: {
    height: 154,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 4,
    paddingTop: 8,
  },
  chartColumn: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 7,
  },
  chartTrack: {
    width: '100%',
    height: 120,
    alignItems: 'center',
    justifyContent: 'flex-end',
    borderRadius: 5,
    backgroundColor: '#F2F4F8',
    overflow: 'hidden',
  },
  chartBar: {
    width: '72%',
    minHeight: 0,
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
    backgroundColor: '#B9C4F8',
  },
  chartBarFilled: {
    backgroundColor: colors.blue,
  },
  chartLabel: {
    height: 14,
    color: colors.muted,
    fontSize: 9,
    textAlign: 'center',
  },
  chartEmpty: {
    minHeight: 132,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 13,
    backgroundColor: colors.paper,
  },
  chartLoading: {
    height: 132,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 16,
  },
  summaryItem: {
    flex: 1,
    minWidth: '40%',
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: colors.paper,
  },
  summaryLabel: {
    color: colors.muted,
    fontSize: 10,
  },
  summaryValue: {
    color: colors.navy,
    fontSize: 15,
    fontWeight: '800',
    marginTop: 5,
  },
  listRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F3F7',
  },
  avatar: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
  },
  avatarBlue: {
    backgroundColor: '#EEF1FF',
  },
  avatarGreen: {
    backgroundColor: '#E9F7F1',
  },
  avatarPlum: {
    backgroundColor: '#F5EDF5',
  },
  avatarText: {
    color: colors.navy,
    fontSize: 11,
    fontWeight: '800',
  },
  listCopy: {
    flex: 1,
  },
  listTitle: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: '700',
  },
  listSubtitle: {
    color: colors.muted,
    fontSize: 10,
    marginTop: 4,
  },
  listTime: {
    color: colors.navy,
    fontSize: 11,
    fontWeight: '700',
  },
  listMeta: {
    alignItems: 'flex-end',
    gap: 4,
  },
  attendanceStatus: {
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: '#F1F3F7',
    color: colors.muted,
    fontSize: 9,
    fontWeight: '700',
  },
  presentAttendanceStatus: {
    backgroundColor: '#E8F7F0',
    color: colors.green,
  },
  lateAttendanceStatus: {
    backgroundColor: '#FFF2DE',
    color: colors.amber,
  },
  countBadge: {
    minWidth: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 7,
    borderRadius: 13,
    backgroundColor: '#FFF2DE',
  },
  countText: {
    color: colors.amber,
    fontSize: 11,
    fontWeight: '800',
  },
  leaveRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 11,
    borderTopWidth: 1,
    borderTopColor: '#F1F3F7',
  },
  leaveCopy: {
    flex: 1,
  },
  leaveReason: {
    color: colors.ink,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 7,
  },
  pendingPill: {
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 9,
    backgroundColor: '#FFF2DE',
  },
  pendingText: {
    color: colors.amber,
    fontSize: 9,
    fontWeight: '700',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 12,
  },
  emptyTitle: {
    color: colors.navy,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptyMessage: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    marginTop: 5,
  },
  loadingCard: {
    minHeight: 230,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 13,
    borderRadius: 18,
    backgroundColor: colors.white,
  },
  loadingText: {
    color: colors.muted,
    fontSize: 12,
  },
  errorCard: {
    padding: 15,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#F2D1D1',
    backgroundColor: '#FFF7F7',
  },
  errorTitle: {
    color: '#A63737',
    fontSize: 13,
    fontWeight: '700',
  },
  errorMessage: {
    color: '#8E4B4B',
    fontSize: 11,
    lineHeight: 17,
    marginTop: 5,
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
    paddingTop: 4,
  },
  pressed: {
    opacity: 0.72,
  },
});
