import { useCallback, useEffect, useRef, useState } from 'react';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useRouter } from 'expo-router';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  getAttendance,
  getAttendanceSummary,
  getEmployees,
  type AdminEmployee,
  type AttendanceFilter,
  type AttendancePeriod,
  type AttendanceRecord,
  type AttendanceSummary,
} from '@/admin/api';
import {
  AdminButton,
  AdminCard,
  AdminField,
  AdminHeader,
  AdminLoading,
  AdminNotice,
  AdminPage,
  AdminSelect,
  AdminBadge,
  adminColors,
} from '@/components/admin-ui';
import { ApiError, apiRequestCsv } from '@/config/api';
import { useAuth } from '@/auth/auth-context';

const periods: { value: AttendancePeriod; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];

function isValidDate(value: string) {
  if (!value) {
    return true;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function dateLabel(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function SummaryTile({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.summaryTile}>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

export default function ReportsScreen() {
  const router = useRouter();
  const { setUser } = useAuth();
  const requestId = useRef(0);
  const employeeIdRef = useRef('');
  const [period, setPeriod] = useState<AttendancePeriod>('week');
  const [summary, setSummary] = useState<AttendanceSummary | null>(null);
  const [employees, setEmployees] = useState<AdminEmployee[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [appliedFilter, setAppliedFilter] = useState<AttendanceFilter>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [filterError, setFilterError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    employeeIdRef.current = employeeId;
  }, [employeeId]);

  const reportFailure = useCallback((requestError: unknown) => {
    if (requestError instanceof ApiError && requestError.status === 401) {
      setUser(null);
      router.replace('/');
      return;
    }
    setError(requestError instanceof Error ? requestError.message : 'The report request failed.');
  }, [router, setUser]);

  const loadPeriod = useCallback(async (selectedPeriod: AttendancePeriod) => {
    const request = ++requestId.current;
    setError('');
    setFilterError('');
    setLoading(true);
    try {
      const nextSummary = await getAttendanceSummary(selectedPeriod);
      const nextFilter: AttendanceFilter = {
        from: nextSummary.start_date,
        to: nextSummary.end_date,
        ...(employeeIdRef.current ? { employee_id: employeeIdRef.current } : {}),
      };
      const nextRecords = await getAttendance(nextFilter);
      if (request === requestId.current) {
        setSummary(nextSummary);
        setRecords(nextRecords);
        setFromDate(nextSummary.start_date);
        setToDate(nextSummary.end_date);
        setAppliedFilter(nextFilter);
      }
    } catch (requestError) {
      if (request === requestId.current) {
        reportFailure(requestError);
      }
    } finally {
      if (request === requestId.current) {
        setLoading(false);
      }
    }
  }, [reportFailure]);

  useEffect(() => {
    let active = true;
    void getEmployees()
      .then((employeesResponse) => {
        if (active) {
          setEmployees(
            employeesResponse.filter((employee) => employee.role === 'employee')
          );
        }
      })
      .catch(reportFailure);
    return () => {
      active = false;
    };
  }, [reportFailure]);

  useEffect(() => {
    void loadPeriod(period);
    return () => {
      requestId.current += 1;
    };
  }, [loadPeriod, period]);

  const refreshReport = async () => {
    const request = ++requestId.current;
    setRefreshing(true);
    setError('');
    try {
      const [nextSummary, nextRecords] = await Promise.all([
        getAttendanceSummary(period),
        getAttendance(appliedFilter),
      ]);
      if (request === requestId.current) {
        setSummary(nextSummary);
        setRecords(nextRecords);
      }
    } catch (requestError) {
      if (request === requestId.current) {
        reportFailure(requestError);
      }
    } finally {
      if (request === requestId.current) {
        setRefreshing(false);
      }
    }
  };

  const buildFilter = (): AttendanceFilter | null => {
    const from = fromDate.trim();
    const to = toDate.trim();
    if (!isValidDate(from)) {
      setFilterError('From date must use YYYY-MM-DD.');
      return null;
    }
    if (!isValidDate(to)) {
      setFilterError('To date must use YYYY-MM-DD.');
      return null;
    }
    if (from && to && from > to) {
      setFilterError('From date cannot be after To date.');
      return null;
    }
    setFilterError('');
    return {
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(employeeId ? { employee_id: employeeId } : {}),
    };
  };

  const applyFilters = async () => {
    const filter = buildFilter();
    if (!filter) {
      return;
    }
    const request = ++requestId.current;
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const nextRecords = await getAttendance(filter);
      if (request === requestId.current) {
        setRecords(nextRecords);
        setAppliedFilter(filter);
      }
    } catch (requestError) {
      if (request === requestId.current) {
        reportFailure(requestError);
      }
    } finally {
      if (request === requestId.current) {
        setLoading(false);
      }
    }
  };

  const exportCsv = async () => {
    const filter = buildFilter();
    if (!filter) {
      return;
    }
    setExporting(true);
    setError('');
    setSuccess('');
    try {
      if (Platform.OS === 'web') {
        throw new Error('CSV file sharing is available in the Android and iOS apps.');
      }
      if (!(await Sharing.isAvailableAsync())) {
        throw new Error('The system share sheet is not available on this device.');
      }
      const query = Object.entries(filter)
        .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
        .join('&');
      const { filename, text } = await apiRequestCsv(
        `/api/admin/attendance/export${query ? `?${query}` : ''}`
      );
      const file = new File(Paths.cache, filename);
      file.create({ overwrite: true });
      await file.write(text);
      await Sharing.shareAsync(file.uri, {
        mimeType: 'text/csv',
        dialogTitle: 'Share attendance report',
      });
      setAppliedFilter(filter);
      setSuccess('CSV report is ready to share or save.');
    } catch (requestError) {
      reportFailure(requestError);
    } finally {
      setExporting(false);
    }
  };

  const employeeOptions = [
    { label: 'All employees', value: '' },
    ...employees.map((employee) => ({
      label: `${employee.name} · ${employee.employee_code || `#${employee.id}`}`,
      value: String(employee.id),
    })),
  ];

  return (
    <AdminPage
      refreshing={refreshing}
      onRefresh={() => void refreshReport()}>
      <AdminHeader
        title="Attendance reports"
        subtitle="Compare period summaries and create employee-specific reports."
        action={
          <AdminButton
            label="Back"
            variant="secondary"
            compact
            onPress={() => router.back()}
          />
        }
      />

      <View style={styles.periodPicker}>
        {periods.map((option) => {
          const selected = period === option.value;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected }}
              key={option.value}
              onPress={() => setPeriod(option.value)}
              style={[styles.periodButton, selected && styles.periodButtonSelected]}>
              <Text style={[styles.periodText, selected && styles.periodTextSelected]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {summary ? (
        <AdminCard>
          <View style={styles.summaryHeader}>
            <View>
              <Text style={styles.cardTitle}>
                {period[0].toUpperCase() + period.slice(1)} summary
              </Text>
              <Text style={styles.summaryRange}>
                {dateLabel(summary.start_date)} - {dateLabel(summary.end_date)} · {summary.timezone}
              </Text>
            </View>
            {summary.empty ? <AdminBadge label="No records" /> : null}
          </View>
          <View style={styles.chart}>
            {summary.series.map((point, index) => {
              const max = Math.max(1, ...summary.series.map((item) => item.present));
              const height = (point.present / max) * 100;
              const showLabel =
                period !== 'month' ||
                index % 5 === 0 ||
                index === summary.series.length - 1;
              return (
                <View key={point.date} style={styles.chartColumn}>
                  <View style={styles.chartTrack}>
                    <View
                      style={[
                        styles.chartBar,
                        { height: `${height}%` },
                        point.present > 0 && styles.chartBarFilled,
                      ]}
                    />
                  </View>
                  <Text style={styles.chartLabel}>{showLabel ? point.label : ''}</Text>
                </View>
              );
            })}
          </View>
          <View style={styles.summaryGrid}>
            <SummaryTile label="Present days" value={summary.stats.present} />
            <SummaryTile label="Absent days" value={summary.stats.absent} />
            <SummaryTile label="On leave" value={summary.stats.on_leave} />
            <SummaryTile label="Hours logged" value={`${summary.stats.hours.toFixed(2)} h`} />
          </View>
        </AdminCard>
      ) : loading ? (
        <AdminLoading message="Loading attendance summary..." />
      ) : null}

      <AdminCard>
        <Text style={styles.cardTitle}>Employee report filters</Text>
        <Text style={styles.cardSubtitle}>
          Select a date range and optional employee to view detailed attendance.
        </Text>
        <View style={styles.filterFields}>
          <AdminField
            label="From date"
            value={fromDate}
            onChangeText={setFromDate}
            placeholder="YYYY-MM-DD"
            keyboardType="numbers-and-punctuation"
            autoCapitalize="none"
          />
          <AdminField
            label="To date"
            value={toDate}
            onChangeText={setToDate}
            placeholder="YYYY-MM-DD"
            keyboardType="numbers-and-punctuation"
            autoCapitalize="none"
          />
          <AdminSelect
            label="Employee"
            value={employeeId}
            options={employeeOptions}
            onChange={setEmployeeId}
          />
          {filterError ? (
            <AdminNotice title="Check report filters" message={filterError} tone="error" />
          ) : null}
          <View style={styles.actionButtons}>
            <AdminButton
              label="Apply filters"
              loading={loading}
              onPress={() => void applyFilters()}
            />
            <AdminButton
              label={exporting ? 'Preparing CSV...' : 'Export CSV'}
              variant="secondary"
              loading={exporting}
              onPress={() => void exportCsv()}
            />
          </View>
        </View>
      </AdminCard>

      {error ? (
        <AdminNotice title="Report action failed" message={error} tone="error" />
      ) : null}
      {success ? <AdminNotice title="Ready" message={success} tone="success" /> : null}

      <View style={styles.listHeading}>
        <Text style={styles.cardTitle}>Employee attendance</Text>
        {records.length === 500 ? (
          <Text style={styles.limitText}>First 500 rows; CSV includes all matches</Text>
        ) : null}
      </View>

      {loading && records.length === 0 ? (
        <AdminLoading message="Loading employee report..." />
      ) : records.length ? (
        records.map((record) => (
          <AdminCard key={record.id} style={styles.recordCard}>
            <View style={styles.recordHeader}>
              <View style={styles.recordCopy}>
                <Text style={styles.employeeName}>{record.name}</Text>
                <Text style={styles.employeeMeta}>
                  {record.employee_code || `#${record.employee_id}`} · {record.department || 'Unassigned'}
                </Text>
              </View>
              <AdminBadge
                label={record.status}
                tone={
                  record.status.toLowerCase() === 'present'
                    ? 'green'
                    : record.status.toLowerCase() === 'late'
                      ? 'amber'
                      : 'muted'
                }
              />
            </View>
            <View style={styles.recordFooter}>
              <Text style={styles.recordText}>{record.date}</Text>
              <Text style={styles.recordText}>
                {record.check_in || '—'} - {record.check_out || '—'}
              </Text>
              <Text style={styles.recordText}>
                {record.hours === null ? 'In progress' : `${record.hours.toFixed(2)} h`}
              </Text>
            </View>
          </AdminCard>
        ))
      ) : (
        <AdminNotice
          title="No attendance records"
          message="No employee records match these dates and filters."
        />
      )}
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  periodPicker: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    gap: 5,
    padding: 4,
    borderRadius: 12,
    backgroundColor: '#ECEFF4',
  },
  periodButton: {
    minWidth: 62,
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 9,
  },
  periodButtonSelected: {
    backgroundColor: adminColors.navy,
  },
  periodText: {
    color: adminColors.muted,
    fontSize: 10,
    fontWeight: '700',
  },
  periodTextSelected: {
    color: adminColors.white,
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  cardTitle: {
    color: adminColors.navy,
    fontSize: 14,
    fontWeight: '800',
  },
  summaryRange: {
    color: adminColors.muted,
    fontSize: 10,
    marginTop: 4,
  },
  chart: {
    height: 130,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 4,
    marginTop: 15,
  },
  chartColumn: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  chartTrack: {
    width: '100%',
    height: 102,
    alignItems: 'center',
    justifyContent: 'flex-end',
    borderRadius: 5,
    backgroundColor: '#F1F3F8',
    overflow: 'hidden',
  },
  chartBar: {
    width: '70%',
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
    backgroundColor: '#B9C4F8',
  },
  chartBarFilled: {
    backgroundColor: adminColors.blue,
  },
  chartLabel: {
    height: 13,
    color: adminColors.muted,
    fontSize: 8,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 13,
  },
  summaryTile: {
    flex: 1,
    minWidth: '40%',
    padding: 10,
    borderRadius: 10,
    backgroundColor: adminColors.paper,
  },
  summaryValue: {
    color: adminColors.navy,
    fontSize: 13,
    fontWeight: '800',
  },
  summaryLabel: {
    color: adminColors.muted,
    fontSize: 9,
    marginTop: 3,
  },
  cardSubtitle: {
    color: adminColors.muted,
    fontSize: 10,
    lineHeight: 15,
    marginTop: 4,
  },
  filterFields: {
    gap: 11,
    marginTop: 13,
  },
  actionButtons: {
    gap: 8,
  },
  listHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 4,
  },
  limitText: {
    color: adminColors.amber,
    fontSize: 9,
    textAlign: 'right',
  },
  recordCard: {
    gap: 10,
  },
  recordHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  recordCopy: {
    flex: 1,
  },
  employeeName: {
    color: adminColors.navy,
    fontSize: 12,
    fontWeight: '800',
  },
  employeeMeta: {
    color: adminColors.muted,
    fontSize: 9,
    marginTop: 4,
  },
  recordFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 6,
    paddingTop: 9,
    borderTopWidth: 1,
    borderTopColor: adminColors.line,
  },
  recordText: {
    color: adminColors.ink,
    fontSize: 9,
    fontWeight: '600',
  },
});
