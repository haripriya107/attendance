import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import {
  getLeaves,
  updateLeaveStatus,
  type AdminLeave,
  type LeaveStatus,
} from '@/admin/api';
import {
  AdminButton,
  AdminCard,
  AdminHeader,
  AdminLoading,
  AdminNotice,
  AdminPage,
  AdminBadge,
  adminColors,
} from '@/components/admin-ui';
import { ApiError } from '@/config/api';
import { useAuth } from '@/auth/auth-context';

type StatusFilter = 'All' | LeaveStatus;
const filters: StatusFilter[] = ['All', 'Pending', 'Approved', 'Rejected'];

function dateLabel(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusTone(status: LeaveStatus) {
  if (status === 'Approved') {
    return 'green' as const;
  }
  if (status === 'Rejected') {
    return 'red' as const;
  }
  return 'amber' as const;
}

export default function LeavesScreen() {
  const router = useRouter();
  const { setUser } = useAuth();
  const requestId = useRef(0);
  const [filter, setFilter] = useState<StatusFilter>('Pending');
  const [leaves, setLeaves] = useState<AdminLeave[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const loadRequests = useCallback(async (selected: StatusFilter, refresh = false) => {
    const request = ++requestId.current;
    setError('');
    if (refresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const nextLeaves = await getLeaves(selected === 'All' ? undefined : selected);
      if (request === requestId.current) {
        setLeaves(nextLeaves);
      }
    } catch (requestError) {
      if (request === requestId.current) {
        if (requestError instanceof ApiError && requestError.status === 401) {
          setUser(null);
          router.replace('/');
          return;
        }
        setError(requestError instanceof Error ? requestError.message : 'Unable to load leave requests.');
      }
    } finally {
      if (request === requestId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [router, setUser]);

  useEffect(() => {
    void loadRequests(filter);
    return () => {
      requestId.current += 1;
    };
  }, [filter, loadRequests]);

  const reviewRequest = (leave: AdminLeave, status: 'Approved' | 'Rejected') => {
    Alert.alert(
      `${status} leave request?`,
      `${status === 'Approved' ? 'Approve' : 'Reject'} ${leave.name}'s request from ${dateLabel(leave.from_date)} to ${dateLabel(leave.to_date)}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: status,
          style: status === 'Rejected' ? 'destructive' : 'default',
          onPress: () => {
            void (async () => {
              setSavingId(leave.id);
              setError('');
              setSuccess('');
              try {
                await updateLeaveStatus(leave.id, status);
                setSuccess(`Leave request ${status.toLowerCase()}.`);
                await loadRequests(filter, true);
              } catch (requestError) {
                if (requestError instanceof ApiError && requestError.status === 401) {
                  setUser(null);
                  router.replace('/');
                } else {
                  setError(
                    requestError instanceof Error
                      ? requestError.message
                      : 'Unable to update this leave request.'
                  );
                }
              } finally {
                setSavingId(null);
              }
            })();
          },
        },
      ]
    );
  };

  return (
    <AdminPage
      refreshing={refreshing}
      onRefresh={() => void loadRequests(filter, true)}>
      <AdminHeader
        title="Leave requests"
        subtitle="Review employee time-off requests and update their status."
      />

      <View style={styles.filterBar}>
        {filters.map((status) => {
          const selected = filter === status;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected }}
              key={status}
              onPress={() => {
                setSuccess('');
                setFilter(status);
              }}
              style={[styles.filterChip, selected && styles.filterChipSelected]}>
              <Text style={[styles.filterText, selected && styles.filterTextSelected]}>
                {status}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {error ? (
        <AdminNotice
          title="Leave requests unavailable"
          message={error}
          tone="error"
          action={
            <AdminButton
              label="Try again"
              variant="secondary"
              compact
              onPress={() => void loadRequests(filter)}
            />
          }
        />
      ) : null}
      {success ? <AdminNotice title="Updated" message={success} tone="success" /> : null}

      <View style={styles.listHeading}>
        <Text style={styles.resultCount}>
          {loading && leaves.length === 0
            ? 'Loading requests...'
            : `${leaves.length} ${filter === 'All' ? 'requests' : filter.toLowerCase()}`}
        </Text>
        <Text style={styles.refreshHint}>Pull down to refresh</Text>
      </View>

      {loading && leaves.length === 0 ? (
        <AdminLoading message="Loading leave requests..." />
      ) : leaves.length ? (
        leaves.map((leave) => (
          <AdminCard key={leave.id} style={styles.leaveCard}>
            <View style={styles.leaveTop}>
              <View style={styles.employeeAvatar}>
                <Text style={styles.avatarText}>
                  {leave.name
                    .trim()
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((part) => part[0] ?? '')
                    .join('')
                    .toUpperCase()}
                </Text>
              </View>
              <View style={styles.employeeCopy}>
                <Text style={styles.employeeName}>{leave.name}</Text>
                <Text style={styles.employeeMeta}>
                  {leave.employee_code || `#${leave.employee_id}`} · {leave.department || 'Unassigned'}
                </Text>
              </View>
              <AdminBadge label={leave.status} tone={statusTone(leave.status)} />
            </View>
            <View style={styles.datePanel}>
              <View>
                <Text style={styles.dateLabel}>START</Text>
                <Text style={styles.dateValue}>{dateLabel(leave.from_date)}</Text>
              </View>
              <Text style={styles.dateArrow}>→</Text>
              <View>
                <Text style={styles.dateLabel}>END</Text>
                <Text style={styles.dateValue}>{dateLabel(leave.to_date)}</Text>
              </View>
            </View>
            <Text style={styles.reasonLabel}>Reason</Text>
            <Text style={styles.reason}>{leave.reason}</Text>
            {leave.created_at ? (
              <Text style={styles.submitted}>
                Submitted {new Date(leave.created_at).toLocaleString()}
              </Text>
            ) : null}
            {leave.status === 'Pending' ? (
              <View style={styles.actions}>
                <AdminButton
                  label="Approve"
                  loading={savingId === leave.id}
                  disabled={savingId !== null && savingId !== leave.id}
                  onPress={() => reviewRequest(leave, 'Approved')}
                />
                <AdminButton
                  label="Reject"
                  variant="danger"
                  loading={savingId === leave.id}
                  disabled={savingId !== null && savingId !== leave.id}
                  onPress={() => reviewRequest(leave, 'Rejected')}
                />
              </View>
            ) : null}
          </AdminCard>
        ))
      ) : (
        <AdminNotice
          title={filter === 'All' ? 'No leave requests' : `No ${filter.toLowerCase()} requests`}
          message="Requests matching this filter will appear here."
        />
      )}
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  filterBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#ECEFF4',
  },
  filterChipSelected: {
    backgroundColor: adminColors.navy,
  },
  filterText: {
    color: adminColors.muted,
    fontSize: 10,
    fontWeight: '700',
  },
  filterTextSelected: {
    color: adminColors.white,
  },
  listHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 3,
  },
  resultCount: {
    color: adminColors.navy,
    fontSize: 13,
    fontWeight: '800',
  },
  refreshHint: {
    color: adminColors.muted,
    fontSize: 9,
  },
  leaveCard: {
    gap: 11,
  },
  leaveTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  employeeAvatar: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    backgroundColor: '#F3ECF5',
  },
  avatarText: {
    color: adminColors.navy,
    fontSize: 10,
    fontWeight: '800',
  },
  employeeCopy: {
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
  datePanel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
    padding: 12,
    borderRadius: 12,
    backgroundColor: adminColors.paper,
  },
  dateLabel: {
    color: adminColors.muted,
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  dateValue: {
    color: adminColors.navy,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 4,
  },
  dateArrow: {
    color: adminColors.blue,
    fontSize: 17,
    fontWeight: '700',
  },
  reasonLabel: {
    color: adminColors.muted,
    fontSize: 9,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  reason: {
    color: adminColors.ink,
    fontSize: 12,
    lineHeight: 18,
    marginTop: -7,
  },
  submitted: {
    color: adminColors.muted,
    fontSize: 9,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
});
