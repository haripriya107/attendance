import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import {
  createDepartment,
  deleteDepartment,
  getDepartments,
  getEmployees,
  type AdminEmployee,
  type Department,
} from '@/admin/api';
import {
  AdminButton,
  AdminCard,
  AdminField,
  AdminHeader,
  AdminLoading,
  AdminNotice,
  AdminPage,
  adminColors,
} from '@/components/admin-ui';
import { ApiError } from '@/config/api';
import { useAuth } from '@/auth/auth-context';

type DepartmentWithCount = Department & { employeeCount: number };

export default function DepartmentsScreen() {
  const router = useRouter();
  const { setUser } = useAuth();
  const requestId = useRef(0);
  const [departments, setDepartments] = useState<DepartmentWithCount[]>([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const loadDepartments = useCallback(async (refresh = false) => {
    const request = ++requestId.current;
    setError('');
    if (refresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const [nextDepartments, employees] = await Promise.all([
        getDepartments(),
        getEmployees(),
      ]);
      if (request === requestId.current) {
        setDepartments(
          nextDepartments.map((department) => ({
            ...department,
            employeeCount: employees.filter(
              (employee: AdminEmployee) =>
                employee.role === 'employee' &&
                employee.department === department.department_name
            ).length,
          }))
        );
      }
    } catch (requestError) {
      if (request === requestId.current) {
        if (requestError instanceof ApiError && requestError.status === 401) {
          setUser(null);
          router.replace('/');
          return;
        }
        setError(
          requestError instanceof Error ? requestError.message : 'Unable to load departments.'
        );
      }
    } finally {
      if (request === requestId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [router, setUser]);

  useEffect(() => {
    void loadDepartments();
    return () => {
      requestId.current += 1;
    };
  }, [loadDepartments]);

  const addDepartment = async () => {
    const normalized = name.trim();
    if (!normalized) {
      setError('Enter a department name.');
      return;
    }
    if (normalized.length > 80) {
      setError('Department name must be at most 80 characters.');
      return;
    }
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await createDepartment(normalized);
      setName('');
      setSuccess(`${normalized} department added.`);
      await loadDepartments(true);
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 401) {
        setUser(null);
        router.replace('/');
      } else {
        setError(requestError instanceof Error ? requestError.message : 'Unable to add department.');
      }
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (department: DepartmentWithCount) => {
    if (department.employeeCount > 0) {
      return;
    }
    Alert.alert(
      'Remove department?',
      `${department.department_name} will be removed from the department list.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setSaving(true);
              setError('');
              setSuccess('');
              try {
                await deleteDepartment(department.id);
                setSuccess(`${department.department_name} was removed.`);
                await loadDepartments(true);
              } catch (requestError) {
                if (requestError instanceof ApiError && requestError.status === 401) {
                  setUser(null);
                  router.replace('/');
                } else {
                  setError(
                    requestError instanceof Error
                      ? requestError.message
                      : 'Unable to remove department.'
                  );
                }
              } finally {
                setSaving(false);
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
      onRefresh={() => void loadDepartments(true)}>
      <AdminHeader
        title="Departments"
        subtitle="Organize employee accounts into workplace teams."
        action={
          <AdminButton
            label="Back"
            variant="secondary"
            compact
            onPress={() => router.back()}
          />
        }
      />

      <AdminCard>
        <Text style={styles.sectionTitle}>Add a department</Text>
        <Text style={styles.sectionSubtitle}>
          Departments assigned to employees cannot be removed.
        </Text>
        <View style={styles.addForm}>
          <AdminField
            label="Department name"
            value={name}
            onChangeText={(value) => {
              setName(value);
              setError('');
            }}
            placeholder="e.g. Operations"
            maxLength={80}
            autoCapitalize="words"
            returnKeyType="done"
            onSubmitEditing={() => void addDepartment()}
          />
          <AdminButton
            label="Add department"
            loading={saving}
            onPress={() => void addDepartment()}
          />
        </View>
      </AdminCard>

      {error ? (
        <AdminNotice title="Department action failed" message={error} tone="error" />
      ) : null}
      {success ? <AdminNotice title="Done" message={success} tone="success" /> : null}

      <Text style={styles.listTitle}>Department list</Text>
      {loading && departments.length === 0 ? (
        <AdminLoading message="Loading departments..." />
      ) : departments.length ? (
        departments.map((department) => (
          <AdminCard key={department.id} style={styles.departmentCard}>
            <View style={styles.departmentInfo}>
              <View style={styles.departmentIcon}>
                <Text style={styles.departmentIconText}>D</Text>
              </View>
              <View style={styles.departmentCopy}>
                <Text style={styles.departmentName}>{department.department_name}</Text>
                <Text style={styles.departmentCount}>
                  {department.employeeCount} employee{department.employeeCount === 1 ? '' : 's'}
                </Text>
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: saving || department.employeeCount > 0 }}
              disabled={saving || department.employeeCount > 0}
              onPress={() => confirmDelete(department)}
              style={({ pressed }) => [
                styles.removeButton,
                (saving || department.employeeCount > 0) && styles.disabled,
                pressed && styles.pressed,
              ]}>
              <Text style={styles.removeText}>Remove</Text>
            </Pressable>
            {department.employeeCount > 0 ? (
              <Text style={styles.reassignHint}>Reassign employees before removing.</Text>
            ) : null}
          </AdminCard>
        ))
      ) : (
        <AdminNotice
          title="No departments yet"
          message="Add a department above to start organizing employees."
        />
      )}
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    color: adminColors.navy,
    fontSize: 14,
    fontWeight: '800',
  },
  sectionSubtitle: {
    color: adminColors.muted,
    fontSize: 10,
    lineHeight: 15,
    marginTop: 4,
  },
  addForm: {
    gap: 12,
    marginTop: 15,
  },
  listTitle: {
    color: adminColors.navy,
    fontSize: 14,
    fontWeight: '800',
    marginTop: 4,
  },
  departmentCard: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  departmentInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  departmentIcon: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    backgroundColor: '#EEF1FF',
  },
  departmentIconText: {
    color: adminColors.blue,
    fontSize: 12,
    fontWeight: '800',
  },
  departmentCopy: {
    flex: 1,
  },
  departmentName: {
    color: adminColors.navy,
    fontSize: 12,
    fontWeight: '800',
  },
  departmentCount: {
    color: adminColors.muted,
    fontSize: 10,
    marginTop: 4,
  },
  removeButton: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: 9,
    backgroundColor: '#FDEAEA',
  },
  removeText: {
    color: adminColors.red,
    fontSize: 10,
    fontWeight: '800',
  },
  disabled: {
    opacity: 0.45,
  },
  reassignHint: {
    width: '100%',
    color: adminColors.muted,
    fontSize: 9,
    paddingLeft: 48,
  },
  pressed: {
    opacity: 0.72,
  },
});
