import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/auth/auth-context';
import {
  getEmployeeLeaves,
  submitEmployeeLeave,
  type EmployeeLeave,
  type EmployeeLeaveStatus,
} from '@/employee/api';
import {
  EmployeeBadge,
  EmployeeButton,
  EmployeeCard,
  EmployeeField,
  EmployeeHeader,
  EmployeeLoading,
  EmployeeNotice,
  EmployeePage,
  employeeColors,
} from '@/components/employee-ui';
import { ApiError } from '@/config/api';

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function displayDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusTone(status: EmployeeLeaveStatus) {
  if (status === 'Approved') {
    return 'green' as const;
  }
  if (status === 'Rejected') {
    return 'red' as const;
  }
  return 'amber' as const;
}

export default function EmployeeLeavesScreen() {
  const router = useRouter();
  const { setUser } = useAuth();
  const requestId = useRef(0);
  const [leaves, setLeaves] = useState<EmployeeLeave[]>([]);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState('');

  const handleFailure = useCallback((requestError: unknown) => {
    if (requestError instanceof ApiError && requestError.status === 401) {
      setUser(null);
      router.replace('/');
      return;
    }
    setError(
      requestError instanceof Error ? requestError.message : 'Unable to load leave requests.'
    );
  }, [router, setUser]);

  const loadLeaves = useCallback(async (refresh = false) => {
    const request = ++requestId.current;
    setError('');
    if (refresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const nextLeaves = await getEmployeeLeaves();
      if (request === requestId.current) {
        setLeaves(nextLeaves);
      }
    } catch (requestError) {
      if (request === requestId.current) {
        handleFailure(requestError);
      }
    } finally {
      if (request === requestId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [handleFailure]);

  useEffect(() => {
    void loadLeaves();
    return () => {
      requestId.current += 1;
    };
  }, [loadLeaves]);

  const applyForLeave = async () => {
    const start = fromDate.trim();
    const end = toDate.trim();
    const leaveReason = reason.trim();
    if (!isValidDate(start)) {
      setFormError('Enter a valid start date in YYYY-MM-DD format.');
      return;
    }
    if (!isValidDate(end)) {
      setFormError('Enter a valid end date in YYYY-MM-DD format.');
      return;
    }
    if (end < start) {
      setFormError('End date cannot be before start date.');
      return;
    }
    if (!leaveReason) {
      setFormError('Enter a reason for your leave request.');
      return;
    }

    setSubmitting(true);
    setFormError('');
    setError('');
    setSuccess('');
    try {
      await submitEmployeeLeave(start, end, leaveReason);
      setFromDate('');
      setToDate('');
      setReason('');
      setSuccess('Your leave request was submitted for review.');
      await loadLeaves(true);
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 401) {
        setUser(null);
        router.replace('/');
      } else {
        setFormError(
          requestError instanceof Error ? requestError.message : 'Unable to submit your leave request.'
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <EmployeePage refreshing={refreshing} onRefresh={() => void loadLeaves(true)}>
      <EmployeeHeader
        title="Leave management"
        subtitle="Submit a request and track its review status."
      />

      <EmployeeCard style={styles.formCard}>
        <Text style={styles.sectionTitle}>Apply for leave</Text>
        <Text style={styles.sectionSubtitle}>
          Your request will be sent to an Administrator for review.
        </Text>
        <EmployeeField
          label="Start date"
          value={fromDate}
          onChangeText={setFromDate}
          placeholder="YYYY-MM-DD"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="numbers-and-punctuation"
          accessibilityLabel="Leave start date"
        />
        <EmployeeField
          label="End date"
          value={toDate}
          onChangeText={setToDate}
          placeholder="YYYY-MM-DD"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="numbers-and-punctuation"
          accessibilityLabel="Leave end date"
        />
        <EmployeeField
          label="Reason"
          value={reason}
          onChangeText={setReason}
          placeholder="Tell us why you are requesting leave"
          multiline
          maxLength={1000}
          accessibilityLabel="Leave reason"
        />
        {formError ? (
          <EmployeeNotice title="Request not submitted" message={formError} tone="error" />
        ) : null}
        <EmployeeButton
          label="Submit request"
          loading={submitting}
          onPress={() => void applyForLeave()}
        />
      </EmployeeCard>

      {success ? (
        <EmployeeNotice title="Request submitted" message={success} tone="success" />
      ) : null}
      {error ? (
        <EmployeeNotice
          title="Leave requests unavailable"
          message={error}
          tone="error"
          action={
            <EmployeeButton
              label="Try again"
              variant="secondary"
              onPress={() => void loadLeaves()}
            />
          }
        />
      ) : null}

      <View style={styles.listHeading}>
        <Text style={styles.sectionTitle}>My requests</Text>
        <Text style={styles.count}>{leaves.length}</Text>
      </View>
      {loading && leaves.length === 0 ? (
        <EmployeeLoading message="Loading your leave requests..." />
      ) : leaves.length ? (
        leaves.map((leave) => (
          <EmployeeCard key={leave.id} style={styles.leaveCard}>
            <View style={styles.leaveHeading}>
              <View style={styles.leaveDates}>
                <Text style={styles.dateLabel}>DATES</Text>
                <Text style={styles.dateRange}>
                  {displayDate(leave.from_date)} – {displayDate(leave.to_date)}
                </Text>
              </View>
              <EmployeeBadge label={leave.status} tone={statusTone(leave.status)} />
            </View>
            <Text style={styles.reasonLabel}>Reason</Text>
            <Text style={styles.reason}>{leave.reason}</Text>
            {leave.created_at ? (
              <Text style={styles.createdAt}>
                Submitted {new Date(leave.created_at).toLocaleString()}
              </Text>
            ) : null}
          </EmployeeCard>
        ))
      ) : error ? null : (
        <EmployeeNotice
          title="No leave requests"
          message="Requests you submit will appear here with their current status."
        />
      )}
    </EmployeePage>
  );
}

const styles = StyleSheet.create({
  formCard: {
    gap: 12,
  },
  sectionTitle: {
    color: employeeColors.navy,
    fontSize: 14,
    fontWeight: '800',
  },
  sectionSubtitle: {
    color: employeeColors.muted,
    fontSize: 10,
    lineHeight: 15,
    marginTop: -7,
  },
  listHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  count: {
    color: employeeColors.muted,
    fontSize: 10,
    fontWeight: '700',
  },
  leaveCard: {
    gap: 10,
  },
  leaveHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  leaveDates: {
    flex: 1,
  },
  dateLabel: {
    color: employeeColors.muted,
    fontSize: 9,
    fontWeight: '800',
  },
  dateRange: {
    color: employeeColors.navy,
    fontSize: 12,
    fontWeight: '800',
    marginTop: 4,
  },
  reasonLabel: {
    color: employeeColors.muted,
    fontSize: 9,
    fontWeight: '800',
  },
  reason: {
    color: employeeColors.ink,
    fontSize: 11,
    lineHeight: 17,
  },
  createdAt: {
    color: employeeColors.muted,
    fontSize: 9,
  },
});
