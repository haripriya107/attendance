import { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/auth/auth-context';
import { getAttendanceHistory, type AttendanceHistoryItem } from '@/employee/api';
import {
  EmployeeBadge,
  EmployeeButton,
  EmployeeCard,
  EmployeeHeader,
  EmployeeLoading,
  EmployeeNotice,
  EmployeePage,
  employeeColors,
} from '@/components/employee-ui';
import { ApiError } from '@/config/api';

function displayDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
}

function statusTone(status: string) {
  if (status.toLowerCase() === 'present') return 'green' as const;
  if (status.toLowerCase() === 'late') return 'amber' as const;
  return 'muted' as const;
}

export default function EmployeeAttendanceScreen() {
  const router = useRouter();
  const { setUser } = useAuth();
  const requestId = useRef(0);
  const [records, setRecords] = useState<AttendanceHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadHistory = useCallback(async (refresh = false) => {
    const request = ++requestId.current;
    setError('');
    if (refresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const nextRecords = await getAttendanceHistory();
      if (request === requestId.current) {
        setRecords(nextRecords);
      }
    } catch (requestError) {
      if (request === requestId.current) {
        if (requestError instanceof ApiError && requestError.status === 401) {
          setUser(null);
          router.replace('/');
        } else {
          setError(
            requestError instanceof Error
              ? requestError.message
              : 'Unable to load attendance history.'
          );
        }
      }
    } finally {
      if (request === requestId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [router, setUser]);

  useFocusEffect(
    useCallback(() => {
      void loadHistory();
      return () => {
        requestId.current += 1;
      };
    }, [loadHistory])
  );

  const totalHours = records.reduce((sum, record) => sum + (record.hours ?? 0), 0);

  return (
    <EmployeePage refreshing={refreshing} onRefresh={() => void loadHistory(true)}>
      <EmployeeHeader
        title="Attendance history"
        subtitle="Your latest check-ins, check-outs, and recorded hours."
      />

      <EmployeeCard style={styles.summaryCard}>
        <SummaryValue label="Records shown" value={records.length} />
        <SummaryValue label="Hours logged" value={`${totalHours.toFixed(2)} h`} />
      </EmployeeCard>

      {error ? (
        <EmployeeNotice
          title="Attendance history unavailable"
          message={error}
          tone="error"
          action={
            <EmployeeButton
              label="Try again"
              variant="secondary"
              onPress={() => void loadHistory()}
            />
          }
        />
      ) : null}

      {loading && records.length === 0 ? (
        <EmployeeLoading message="Loading attendance history..." />
      ) : records.length ? (
        records.map((record) => (
          <EmployeeCard key={`${record.date}-${record.check_in ?? 'none'}`} style={styles.recordCard}>
            <View style={styles.recordHeader}>
              <Text style={styles.date}>{displayDate(record.date)}</Text>
              <EmployeeBadge label={record.status} tone={statusTone(record.status)} />
            </View>
            <View style={styles.recordDetails}>
              <RecordValue label="Check-in" value={record.check_in || '—'} />
              <RecordValue label="Check-out" value={record.check_out || '—'} />
              <RecordValue
                label="Working hours"
                value={
                  record.hours === null
                    ? record.check_in
                      ? 'In progress'
                      : '—'
                    : `${record.hours.toFixed(2)} h`
                }
              />
            </View>
          </EmployeeCard>
        ))
      ) : error ? null : (
        <EmployeeNotice
          title="No attendance records yet"
          message="Your recorded attendance will appear here. Pull down to refresh."
        />
      )}
    </EmployeePage>
  );
}

function SummaryValue({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.summaryValue}>
      <Text style={styles.summaryNumber}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
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
  summaryCard: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 18,
  },
  summaryValue: {
    minWidth: '40%',
  },
  summaryNumber: {
    color: employeeColors.navy,
    fontSize: 17,
    fontWeight: '800',
  },
  summaryLabel: {
    color: employeeColors.muted,
    fontSize: 10,
    marginTop: 3,
  },
  recordCard: {
    gap: 12,
  },
  recordHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  date: {
    color: employeeColors.navy,
    fontSize: 12,
    fontWeight: '800',
  },
  recordDetails: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingTop: 11,
    borderTopWidth: 1,
    borderTopColor: employeeColors.line,
  },
  recordValue: {
    flex: 1,
    minWidth: '28%',
    gap: 4,
  },
  recordLabel: {
    color: employeeColors.muted,
    fontSize: 9,
    fontWeight: '700',
  },
  recordText: {
    color: employeeColors.ink,
    fontSize: 11,
    fontWeight: '700',
  },
});
