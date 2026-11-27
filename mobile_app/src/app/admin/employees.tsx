import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import {
  createEmployee,
  deactivateEmployee,
  getDepartments,
  getEmployee,
  getEmployees,
  resetEmployeePassword,
  updateEmployee,
  type AdminEmployee,
  type EmploymentType,
  type EmployeeInput,
} from '@/admin/api';
import {
  AdminBadge,
  AdminButton,
  AdminCard,
  AdminField,
  AdminHeader,
  AdminLoading,
  AdminNotice,
  AdminPage,
  AdminSelect,
  adminColors,
} from '@/components/admin-ui';
import { ApiError } from '@/config/api';
import { useAuth } from '@/auth/auth-context';

type ModalMode = 'create' | 'details' | 'edit' | 'reset' | null;
type EmployeeForm = {
  employee_code: string;
  name: string;
  email: string;
  phone: string;
  position: string;
  department: string;
  joining_date: string;
  employment_type: EmploymentType;
  role: 'admin' | 'employee';
  is_active: boolean;
};
type FormErrors = Partial<Record<keyof EmployeeForm | 'password' | 'confirmPassword', string>>;

const employmentTypes: EmploymentType[] = ['Full-time', 'Part-time', 'Contract', 'Intern'];

function blankForm(): EmployeeForm {
  return {
    employee_code: '',
    name: '',
    email: '',
    phone: '',
    position: '',
    department: '',
    joining_date: '',
    employment_type: 'Full-time',
    role: 'employee',
    is_active: true,
  };
}

function formFromEmployee(employee: AdminEmployee): EmployeeForm {
  return {
    employee_code: employee.employee_code ?? '',
    name: employee.name,
    email: employee.email,
    phone: employee.phone,
    position: employee.position,
    department: employee.department ?? '',
    joining_date: employee.joining_date,
    employment_type: employee.employment_type,
    role: employee.role,
    is_active: employee.is_active,
  };
}

function dateIsValid(value: string) {
  if (!value) {
    return true;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateForm(form: EmployeeForm, password: string, confirmation: string, creating: boolean) {
  const errors: FormErrors = {};
  const email = form.email.trim();
  if (!form.name.trim()) {
    errors.name = 'Full name is required.';
  }
  if (!email) {
    errors.email = 'Work email is required.';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = 'Enter a valid email address.';
  }
  if (form.phone.length > 40) {
    errors.phone = 'Phone number must be at most 40 characters.';
  }
  if (!employmentTypes.includes(form.employment_type)) {
    errors.employment_type = 'Choose a valid employment type.';
  }
  if (!dateIsValid(form.joining_date)) {
    errors.joining_date = 'Use a valid date in YYYY-MM-DD format.';
  }
  if (creating) {
    if (password.length < 8) {
      errors.password = 'Initial password must contain at least 8 characters.';
    } else if (password !== confirmation) {
      errors.confirmPassword = 'Passwords do not match.';
    }
  }
  return errors;
}

export default function EmployeesScreen() {
  const router = useRouter();
  const { setUser, user } = useAuth();
  const requestId = useRef(0);
  const [employees, setEmployees] = useState<AdminEmployee[]>([]);
  const [departments, setDepartments] = useState<{ id: number; department_name: string }[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [mode, setMode] = useState<ModalMode>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<AdminEmployee | null>(null);
  const [form, setForm] = useState<EmployeeForm>(blankForm);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState('');
  const [initialPassword, setInitialPassword] = useState('');
  const [confirmInitialPassword, setConfirmInitialPassword] = useState('');
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [confirmTemporaryPassword, setConfirmTemporaryPassword] = useState('');

  const reportFailure = useCallback((requestError: unknown) => {
    if (requestError instanceof ApiError && requestError.status === 401) {
      setUser(null);
      router.replace('/');
      return;
    }
    setError(requestError instanceof Error ? requestError.message : 'The request failed.');
  }, [router, setUser]);

  const loadDirectory = useCallback(async (query: string, refresh = false) => {
    const request = ++requestId.current;
    setError('');
    if (refresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const [nextEmployees, nextDepartments] = await Promise.all([
        getEmployees(query),
        getDepartments(),
      ]);
      if (request === requestId.current) {
        setEmployees(nextEmployees);
        setDepartments(nextDepartments);
      }
    } catch (requestError) {
      if (request === requestId.current) {
        reportFailure(requestError);
      }
    } finally {
      if (request === requestId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [reportFailure]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadDirectory(search);
    }, search ? 250 : 0);
    return () => {
      clearTimeout(timer);
      requestId.current += 1;
    };
  }, [loadDirectory, search]);

  const openDetails = async (employee: AdminEmployee) => {
    setSelectedEmployee(employee);
    setMode('details');
    setFormError('');
    try {
      setSelectedEmployee(await getEmployee(employee.id));
    } catch (requestError) {
      reportFailure(requestError);
      setMode(null);
    }
  };

  const openCreate = () => {
    setSelectedEmployee(null);
    setForm(blankForm());
    setFormErrors({});
    setFormError('');
    setInitialPassword('');
    setConfirmInitialPassword('');
    setMode('create');
  };

  const openEdit = () => {
    if (!selectedEmployee) {
      return;
    }
    setForm(formFromEmployee(selectedEmployee));
    setFormErrors({});
    setFormError('');
    setMode('edit');
  };

  const closeModal = () => {
    if (saving) {
      return;
    }
    setMode(null);
    setFormError('');
    setFormErrors({});
  };

  const updateForm = <K extends keyof EmployeeForm>(key: K, value: EmployeeForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setFormErrors((current) => ({ ...current, [key]: undefined }));
  };

  const handleSave = async () => {
    const creating = mode === 'create';
    const errors = validateForm(form, initialPassword, confirmInitialPassword, creating);
    setFormErrors(errors);
    setFormError('');
    if (Object.keys(errors).length) {
      return;
    }

    const input: EmployeeInput = {
      employee_code: form.employee_code.trim(),
      name: form.name.trim(),
      email: form.email.trim().toLowerCase(),
      phone: form.phone.trim(),
      position: form.position.trim(),
      department: form.department,
      joining_date: form.joining_date.trim(),
      employment_type: form.employment_type,
      role: form.role,
    };
    setSaving(true);
    try {
      if (creating) {
        await createEmployee({ ...input, password: initialPassword });
        setSuccess(
          form.role === 'employee'
            ? 'Employee created. The initial password must be changed at first sign-in.'
            : 'Admin account created.'
        );
      } else if (selectedEmployee) {
        await updateEmployee(selectedEmployee.id, { ...input, is_active: form.is_active });
        setSuccess('Employee information updated.');
      }
      setMode(null);
      setInitialPassword('');
      setConfirmInitialPassword('');
      await loadDirectory(search, true);
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 401) {
        reportFailure(requestError);
      } else {
        setFormError(
          requestError instanceof Error ? requestError.message : 'Unable to save this account.'
        );
      }
    } finally {
      setSaving(false);
    }
  };

  const handleResetPassword = async () => {
    if (!selectedEmployee || selectedEmployee.role !== 'employee') {
      return;
    }
    if (temporaryPassword.length < 8) {
      setFormError('Temporary password must contain at least 8 characters.');
      return;
    }
    if (temporaryPassword !== confirmTemporaryPassword) {
      setFormError('Temporary passwords do not match.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      await resetEmployeePassword(selectedEmployee.id, temporaryPassword);
      setSuccess(
        'Temporary password reset. The employee must change it at the next sign-in.'
      );
      setTemporaryPassword('');
      setConfirmTemporaryPassword('');
      setMode('details');
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 401) {
        reportFailure(requestError);
      } else {
        setFormError(
          requestError instanceof Error
            ? requestError.message
            : 'Unable to reset the employee password.'
        );
      }
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = (employee: AdminEmployee) => {
    const nextActive = !employee.is_active;
    Alert.alert(
      `${nextActive ? 'Activate' : 'Deactivate'} account?`,
      `${employee.name}'s account will be ${nextActive ? 'activated' : 'deactivated'}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: nextActive ? 'Activate' : 'Deactivate',
          style: nextActive ? 'default' : 'destructive',
          onPress: () => {
            void (async () => {
              setSaving(true);
              setError('');
              try {
                if (!nextActive && employee.role === 'employee') {
                  await deactivateEmployee(employee.id);
                } else {
                  await updateEmployee(employee.id, {
                    employee_code: employee.employee_code ?? '',
                    name: employee.name,
                    email: employee.email,
                    phone: employee.phone,
                    position: employee.position,
                    department: employee.department ?? '',
                    joining_date: employee.joining_date,
                    employment_type: employee.employment_type,
                    role: employee.role,
                    is_active: nextActive,
                  });
                }
                setSuccess(`Account ${nextActive ? 'activated' : 'deactivated'}.`);
                setMode(null);
                await loadDirectory(search, true);
              } catch (requestError) {
                reportFailure(requestError);
              } finally {
                setSaving(false);
              }
            })();
          },
        },
      ]
    );
  };

  const departmentOptions = [
    { label: 'Unassigned', value: '' },
    ...departments.map((department) => ({
      label: department.department_name,
      value: department.department_name,
    })),
  ];

  return (
    <AdminPage refreshing={refreshing} onRefresh={() => void loadDirectory(search, true)}>
      <AdminHeader
        title="Employees"
        subtitle="Create accounts, manage employee details, and control access."
        action={
          <AdminButton label="Add" onPress={openCreate} compact />
        }
      />

      <AdminField
        accessibilityLabel="Search employees"
        label="Search employees"
        value={search}
        onChangeText={(value) => {
          setSearch(value);
          setSuccess('');
        }}
        placeholder="Name, email, employee ID..."
        returnKeyType="search"
        autoCapitalize="none"
        clearButtonMode="while-editing"
      />

      {error ? (
        <AdminNotice
          title="Unable to load employee management"
          message={error}
          tone="error"
          action={
            <AdminButton
              label="Try again"
              variant="secondary"
              compact
              onPress={() => void loadDirectory(search)}
            />
          }
        />
      ) : null}
      {success ? (
        <AdminNotice title="Done" message={success} tone="success" />
      ) : null}

      <View style={styles.resultsHeader}>
        <Text style={styles.resultCount}>
          {loading && employees.length === 0 ? 'Loading employees...' : `${employees.length} results`}
        </Text>
        <Text style={styles.resultHint}>Tap a person to view full details</Text>
      </View>

      {loading && employees.length === 0 ? (
        <AdminLoading message="Loading employee records..." />
      ) : employees.length ? (
        employees.map((employee) => (
          <Pressable
            accessibilityRole="button"
            key={employee.id}
            onPress={() => void openDetails(employee)}
            style={({ pressed }) => [styles.employeeCard, pressed && styles.pressed]}>
            <View style={styles.employeeTop}>
              <View style={styles.initials}>
                <Text style={styles.initialsText}>
                  {employee.name
                    .trim()
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((part) => part[0] ?? '')
                    .join('')
                    .toUpperCase()}
                </Text>
              </View>
              <View style={styles.employeeCopy}>
                <Text style={styles.employeeName}>{employee.name}</Text>
                <Text style={styles.employeeEmail}>{employee.email}</Text>
              </View>
              <AdminBadge
                label={employee.is_active ? 'Active' : 'Inactive'}
                tone={employee.is_active ? 'green' : 'red'}
              />
            </View>
            <View style={styles.employeeFooter}>
              <Text style={styles.employeeMeta}>
                {employee.employee_code || `#${employee.id}`} · {employee.department || 'Unassigned'}
              </Text>
              <Text style={styles.employeeRole}>{employee.role}</Text>
            </View>
          </Pressable>
        ))
      ) : (
        <AdminNotice
          title={search ? 'No matching employees' : 'No employee accounts'}
          message={
            search
              ? 'Try another name, email address, or employee ID.'
              : 'Add an account to start managing your team.'
          }
        />
      )}

      {mode ? (
        <Modal
          animationType="slide"
          transparent
          visible
          onRequestClose={closeModal}>
          <KeyboardAvoidingView
            style={styles.modalRoot}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Pressable style={styles.backdrop} onPress={closeModal} />
            <View style={styles.modalSheet}>
              <View style={styles.sheetHandle} />
              <ScrollView
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.modalContent}>
                {mode === 'details' && selectedEmployee ? (
                  <>
                    <View style={styles.modalHeading}>
                      <View style={styles.modalTitleCopy}>
                        <Text style={styles.modalEyebrow}>EMPLOYEE ACCOUNT</Text>
                        <Text style={styles.modalTitle}>{selectedEmployee.name}</Text>
                        <Text style={styles.modalSubtitle}>{selectedEmployee.email}</Text>
                      </View>
                      <AdminBadge
                        label={selectedEmployee.is_active ? 'Active' : 'Inactive'}
                        tone={selectedEmployee.is_active ? 'green' : 'red'}
                      />
                    </View>
                    <AdminCard>
                      <DetailRow label="Employee ID" value={selectedEmployee.employee_code || 'Not set'} />
                      <DetailRow label="Phone" value={selectedEmployee.phone || 'Not set'} />
                      <DetailRow label="Position" value={selectedEmployee.position || 'Not set'} />
                      <DetailRow label="Department" value={selectedEmployee.department || 'Unassigned'} />
                      <DetailRow label="Joining date" value={selectedEmployee.joining_date || 'Not set'} />
                      <DetailRow label="Employment type" value={selectedEmployee.employment_type} />
                      <DetailRow label="Role" value={selectedEmployee.role} />
                      <DetailRow label="Account status" value={selectedEmployee.is_active ? 'Active' : 'Inactive'} />
                    </AdminCard>
                    {formError ? (
                      <AdminNotice title="Action failed" message={formError} tone="error" />
                    ) : null}
                    <View style={styles.actionRow}>
                      <AdminButton label="Edit details" onPress={openEdit} />
                      {selectedEmployee.role === 'employee' ? (
                        <AdminButton
                          label="Reset password"
                          variant="secondary"
                          onPress={() => {
                            setFormError('');
                            setTemporaryPassword('');
                            setConfirmTemporaryPassword('');
                            setMode('reset');
                          }}
                        />
                      ) : null}
                      {selectedEmployee.id !== user?.id || selectedEmployee.role === 'employee' ? (
                        <AdminButton
                          label={selectedEmployee.is_active ? 'Deactivate' : 'Activate'}
                          variant={selectedEmployee.is_active ? 'danger' : 'secondary'}
                          loading={saving}
                          onPress={() => toggleActive(selectedEmployee)}
                        />
                      ) : null}
                      <AdminButton label="Close" variant="secondary" onPress={closeModal} />
                    </View>
                  </>
                ) : null}

                {mode === 'create' || mode === 'edit' ? (
                  <>
                    <View style={styles.modalHeading}>
                      <View style={styles.modalTitleCopy}>
                        <Text style={styles.modalEyebrow}>
                          {mode === 'create' ? 'NEW TEAM MEMBER' : 'PROFILE'}
                        </Text>
                        <Text style={styles.modalTitle}>
                          {mode === 'create' ? 'Add employee' : 'Edit employee'}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.formGrid}>
                      <AdminField
                        label="Full name"
                        value={form.name}
                        onChangeText={(value) => updateForm('name', value)}
                        error={formErrors.name}
                        autoCapitalize="words"
                        maxLength={120}
                      />
                      <AdminField
                        label="Work email"
                        value={form.email}
                        onChangeText={(value) => updateForm('email', value)}
                        error={formErrors.email}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                      <AdminField
                        label="Employee ID"
                        value={form.employee_code}
                        onChangeText={(value) => updateForm('employee_code', value)}
                        placeholder="Auto-generated if blank"
                        autoCapitalize="characters"
                      />
                      <AdminField
                        label="Phone number"
                        value={form.phone}
                        onChangeText={(value) => updateForm('phone', value)}
                        error={formErrors.phone}
                        keyboardType="phone-pad"
                        maxLength={40}
                      />
                      <AdminField
                        label="Job position"
                        value={form.position}
                        onChangeText={(value) => updateForm('position', value)}
                        placeholder="e.g. Product designer"
                      />
                      <AdminSelect
                        label="Department"
                        value={form.department}
                        options={departmentOptions}
                        onChange={(value) => updateForm('department', value)}
                        error={formErrors.department}
                      />
                      <AdminField
                        label="Joining date"
                        value={form.joining_date}
                        onChangeText={(value) => updateForm('joining_date', value)}
                        error={formErrors.joining_date}
                        placeholder="YYYY-MM-DD"
                        autoCapitalize="none"
                      />
                      <AdminSelect
                        label="Employment type"
                        value={form.employment_type}
                        options={employmentTypes.map((value) => ({ label: value, value }))}
                        onChange={(value) => updateForm('employment_type', value)}
                        error={formErrors.employment_type}
                      />
                      <AdminSelect
                        label="Role"
                        value={form.role}
                        options={[
                          { label: 'Employee', value: 'employee' },
                          { label: 'Admin', value: 'admin' },
                        ]}
                        onChange={(value) => updateForm('role', value)}
                      />
                      {mode === 'create' ? (
                        <>
                          <AdminField
                            label="Initial password"
                            value={initialPassword}
                            onChangeText={(value) => {
                              setInitialPassword(value);
                              setFormErrors((current) => ({ ...current, password: undefined }));
                            }}
                            error={formErrors.password}
                            secureTextEntry
                            autoCapitalize="none"
                            autoComplete="new-password"
                          />
                          <AdminField
                            label="Confirm initial password"
                            value={confirmInitialPassword}
                            onChangeText={(value) => {
                              setConfirmInitialPassword(value);
                              setFormErrors((current) => ({
                                ...current,
                                confirmPassword: undefined,
                              }));
                            }}
                            error={formErrors.confirmPassword}
                            secureTextEntry
                            autoCapitalize="none"
                            autoComplete="new-password"
                          />
                        </>
                      ) : (
                        <Pressable
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: form.is_active }}
                          onPress={() => updateForm('is_active', !form.is_active)}
                          style={styles.activeToggle}>
                          <View style={[styles.checkbox, form.is_active && styles.checkboxChecked]}>
                            {form.is_active ? <Text style={styles.checkmark}>✓</Text> : null}
                          </View>
                          <Text style={styles.activeLabel}>Account active</Text>
                        </Pressable>
                      )}
                    </View>
                    {mode === 'create' && form.role === 'employee' ? (
                      <AdminNotice
                        title="Temporary password"
                        message="The employee must change this password at their first sign-in."
                      />
                    ) : null}
                    {formError ? (
                      <AdminNotice title="Could not save account" message={formError} tone="error" />
                    ) : null}
                    <View style={styles.actionRow}>
                      <AdminButton
                        label={mode === 'create' ? 'Create account' : 'Save changes'}
                        loading={saving}
                        onPress={() => void handleSave()}
                      />
                      <AdminButton label="Cancel" variant="secondary" onPress={closeModal} />
                    </View>
                  </>
                ) : null}

                {mode === 'reset' && selectedEmployee ? (
                  <>
                    <View style={styles.modalHeading}>
                      <View style={styles.modalTitleCopy}>
                        <Text style={styles.modalEyebrow}>ACCOUNT SECURITY</Text>
                        <Text style={styles.modalTitle}>Reset password</Text>
                        <Text style={styles.modalSubtitle}>
                          Set a temporary password for {selectedEmployee.name}.
                        </Text>
                      </View>
                    </View>
                    <AdminField
                      label="Temporary password"
                      value={temporaryPassword}
                      onChangeText={setTemporaryPassword}
                      secureTextEntry
                      autoCapitalize="none"
                      autoComplete="new-password"
                      error={
                        temporaryPassword.length > 0 && temporaryPassword.length < 8
                          ? 'Use at least 8 characters.'
                          : undefined
                      }
                    />
                    <AdminField
                      label="Confirm temporary password"
                      value={confirmTemporaryPassword}
                      onChangeText={setConfirmTemporaryPassword}
                      secureTextEntry
                      autoCapitalize="none"
                      autoComplete="new-password"
                      error={
                        confirmTemporaryPassword && confirmTemporaryPassword !== temporaryPassword
                          ? 'Passwords do not match.'
                          : undefined
                      }
                    />
                    <AdminNotice
                      title="Required at next sign-in"
                      message="The employee must choose a new password before using protected features. The temporary password will not be shown again."
                    />
                    {formError ? (
                      <AdminNotice title="Password reset failed" message={formError} tone="error" />
                    ) : null}
                    <View style={styles.actionRow}>
                      <AdminButton
                        label="Reset password"
                        loading={saving}
                        onPress={() => void handleResetPassword()}
                      />
                      <AdminButton label="Cancel" variant="secondary" onPress={closeModal} />
                    </View>
                  </>
                ) : null}
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      ) : null}
    </AdminPage>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  resultsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  resultCount: {
    color: adminColors.navy,
    fontSize: 13,
    fontWeight: '800',
  },
  resultHint: {
    color: adminColors.muted,
    fontSize: 10,
  },
  employeeCard: {
    padding: 14,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: adminColors.line,
    backgroundColor: adminColors.white,
  },
  employeeTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  initials: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: '#EEF1FF',
  },
  initialsText: {
    color: adminColors.navy,
    fontSize: 12,
    fontWeight: '800',
  },
  employeeCopy: {
    flex: 1,
  },
  employeeName: {
    color: adminColors.navy,
    fontSize: 13,
    fontWeight: '800',
  },
  employeeEmail: {
    color: adminColors.muted,
    fontSize: 10,
    marginTop: 3,
  },
  employeeFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F3F7',
  },
  employeeMeta: {
    color: adminColors.muted,
    fontSize: 10,
    flex: 1,
  },
  employeeRole: {
    color: adminColors.blue,
    fontSize: 9,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  pressed: {
    opacity: 0.75,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: '#00000055',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  modalSheet: {
    maxHeight: '92%',
    paddingTop: 10,
    paddingBottom: 18,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    backgroundColor: adminColors.paper,
  },
  sheetHandle: {
    width: 38,
    height: 4,
    alignSelf: 'center',
    borderRadius: 2,
    backgroundColor: '#D4D9E1',
    marginBottom: 7,
  },
  modalContent: {
    paddingHorizontal: 18,
    paddingBottom: 18,
    gap: 14,
  },
  modalHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 5,
  },
  modalTitleCopy: {
    flex: 1,
  },
  modalEyebrow: {
    color: adminColors.blue,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  modalTitle: {
    color: adminColors.navy,
    fontSize: 21,
    fontWeight: '800',
    marginTop: 4,
  },
  modalSubtitle: {
    color: adminColors.muted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F3F7',
  },
  detailLabel: {
    color: adminColors.muted,
    fontSize: 11,
  },
  detailValue: {
    flex: 1,
    color: adminColors.navy,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'right',
  },
  actionRow: {
    gap: 9,
    marginTop: 3,
  },
  formGrid: {
    gap: 13,
  },
  activeToggle: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  checkbox: {
    width: 21,
    height: 21,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#BCC4D1',
    borderRadius: 6,
  },
  checkboxChecked: {
    borderColor: adminColors.blue,
    backgroundColor: adminColors.blue,
  },
  checkmark: {
    color: adminColors.white,
    fontSize: 13,
    fontWeight: '800',
  },
  activeLabel: {
    color: adminColors.ink,
    fontSize: 12,
    fontWeight: '700',
  },
});
