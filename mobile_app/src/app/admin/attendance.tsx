import { useCallback, useRef, useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import {
  getAttendance,
  getEmployees,
  type AdminEmployee,
  type AttendanceFilter,
  type AttendanceRecord,
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
import { ApiError } from '@/config/api';
import { useAuth } from '@/auth/auth-context';

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

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.statTile}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function AttendanceScreen() {
  const router = useRouter();
  const { setUser } = useAuth();
  const requestId = useRef(0);
  const [employees, setEmployees] = useState<AdminEmployee[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [appliedFilter, setAppliedFilter] = useState<AttendanceFilter>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [filterError, setFilterError] = useState('');

  const loadRecords = useCallback(async (filter: AttendanceFilter, refresh = false) => {
    const request = ++requestId.current;
    setError('');
    if (refresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const nextRecords = await getAttendance(filter);
      if (request === requestId.current) {
        setRecords(nextRecords);
      }
    } catch (requestError) {
      if (request === requestId.current) {
        if (requestError instanceof ApiError && requestError.status === 401) {
          setUser(null);
          router.replace('/');
          return;
        }
        setError(requestError instanceof Error ? requestError.message : 'Unable to load attendance.');
      }
    } finally {
      if (request === requestId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [router, setUser]);

  useFocusEffect(useCallback(() => {
    let active = true;
    const request = ++requestId.current;
    setError('');
    void Promise.all([getEmployees(), getAttendance(appliedFilter)])
      .then(([nextEmployees, nextRecords]) => {
        if (active && request === requestId.current) {
          setEmployees(nextEmployees.filter((employee) => employee.role === 'employee'));
          setRecords(nextRecords);
        }
      })
      .catch((requestError: unknown) => {
        if (active && request === requestId.current) {
          if (requestError instanceof ApiError && requestError.status === 401) {
            setUser(null);
            router.replace('/');
          } else {
            setError(
              requestError instanceof Error ? requestError.message : 'Unable to load attendance.'
            );
          }
        }
      })
      .finally(() => {
        if (active && request === requestId.current) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
      requestId.current += 1;
    };
  }, [appliedFilter, router, setUser]));

  const applyFilters = () => {
    const from = fromDate.trim();
    const to = toDate.trim();
    if (!isValidDate(from)) {
      setFilterError('From date must use the YYYY-MM-DD format.');
      return;
    }
    if (!isValidDate(to)) {
      setFilterError('To date must use the YYYY-MM-DD format.');
      return;
    }
    if (from && to && from > to) {
      setFilterError('From date cannot be after To date.');
      return;
    }
    const nextFilter: AttendanceFilter = {
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(employeeId ? { employee_id: employeeId } : {}),
    };
    setFilterError('');
    setAppliedFilter(nextFilter);
  };

  const completed = records.filter((record) => record.check_out !== null).length;
  const inProgress = records.filter((record) => record.check_in && !record.check_out).length;
  const hoursTotal = records.reduce((sum, record) => sum + (record.hours ?? 0), 0);
  const hoursCount = records.filter((record) => record.hours !== null).length;
  const averageHours = hoursCount ? (hoursTotal / hoursCount).toFixed(2) : '—';
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
      onRefresh={() => void loadRecords(appliedFilter, true)}>
      <AdminHeader
        title="Attendance"
        subtitle="Review check-ins, check-outs, working hours, and status."
      />

      <View style={styles.statGrid}>
        <StatTile label="Records" value={records.length} />
        <StatTile label="Completed shifts" value={completed} />
        <StatTile label="In progress" value={inProgress} />
        <StatTile label="Average hours" value={averageHours} />
      </View>

      <AdminCard>
        <Text style={styles.cardTitle}>Filter attendance</Text>
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
            <AdminNotice title="Check the date filters" message={filterError} tone="error" />
          ) : null}
          <AdminButton label="Apply filters" onPress={applyFilters} />
        </View>
      </AdminCard>

      {error ? (
        <AdminNotice
          title="Attendance unavailable"
          message={error}
          tone="error"
          action={
            <AdminButton
              label="Try again"
              variant="secondary"
              compact
              onPress={() => void loadRecords(appliedFilter)}
            />
          }
        />
      ) : null}

      <View style={styles.listHeading}>
        <Text style={styles.cardTitle}>Attendance records</Text>
      </View>

      {loading && records.length === 0 ? (
        <AdminLoading message="Loading attendance records..." />
      ) : records.length ? (
        records.map((record) => (
          <AdminCard key={record.id} style={styles.recordCard}>
            <View style={styles.recordHeader}>
              <View style={styles.recordCopy}>
                <Text style={styles.employeeName}>{record.name}</Text>
                <Text style={styles.employeeId}>
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
            <View style={styles.recordDivider} />
            <View style={styles.recordDetails}>
              <RecordValue label="Date" value={record.date} />
              <RecordValue label="Check-in" value={record.check_in || '—'} />
              <RecordValue label="Check-out" value={record.check_out || '—'} />
              <RecordValue
                label="Hours"
                value={record.hours === null ? 'In progress' : `${record.hours.toFixed(2)} h`}
              />
            </View>
          </AdminCard>
        ))
      ) : (
        <AdminNotice
          title="No attendance records"
          message="No records match the selected date and employee filters."
        />
      )}
    </AdminPage>
  );
}

function RecordValue({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.recordValue}>
      <Text style={styles.recordLabel}>{label}</Text>
      <Text style={styles.recordText}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
  },
  statTile: {
    flexGrow: 1,
    minWidth: '46%',
    padding: 13,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: adminColors.line,
    backgroundColor: adminColors.white,
  },
  statValue: {
    color: adminColors.navy,
    fontSize: 20,
    fontWeight: '800',
  },
  statLabel: {
    color: adminColors.muted,
    fontSize: 10,
    marginTop: 4,
  },
  cardTitle: {
    color: adminColors.navy,
    fontSize: 14,
    fontWeight: '800',
  },
  filterFields: {
    gap: 12,
    marginTop: 12,
  },
  listHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    marginTop: 5,
  },
  recordCard: {
    gap: 12,
  },
  recordHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  recordCopy: {
    flex: 1,
  },
  employeeName: {
    color: adminColors.navy,
    fontSize: 13,
    fontWeight: '800',
  },
  employeeId: {
    color: adminColors.muted,
    fontSize: 10,
    marginTop: 4,
  },
  recordDivider: {
    height: 1,
    backgroundColor: adminColors.line,
  },
  recordDetails: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  recordValue: {
    flex: 1,
    minWidth: '40%',
  },
  recordLabel: {
    color: adminColors.muted,
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  recordText: {
    color: adminColors.ink,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 4,
  },
});
