import { apiRequest } from '@/config/api';
import type { UserRole } from '@/config/api';

export type EmploymentType = 'Full-time' | 'Part-time' | 'Contract' | 'Intern';

export type AdminEmployee = {
  id: number;
  employee_code: string | null;
  name: string;
  email: string;
  phone: string;
  position: string;
  department: string | null;
  joining_date: string;
  employment_type: EmploymentType;
  role: UserRole;
  is_active: boolean;
};

export type EmployeeInput = Omit<
  AdminEmployee,
  'id' | 'is_active' | 'employee_code' | 'department'
> & {
  employee_code: string;
  department: string;
};

export type Department = {
  id: number;
  department_name: string;
};

export type AttendanceRecord = {
  id: number;
  date: string;
  employee_id: number;
  employee_code: string | null;
  name: string;
  department: string | null;
  check_in: string | null;
  check_out: string | null;
  hours: number | null;
  status: string;
};

export type LeaveStatus = 'Pending' | 'Approved' | 'Rejected';

export type AdminLeave = {
  id: number;
  from_date: string;
  to_date: string;
  reason: string;
  status: LeaveStatus;
  created_at: string;
  employee_id: number;
  employee_code: string | null;
  name: string;
  department: string | null;
};

export type AttendancePeriod = 'week' | 'month' | 'year';

export type AttendanceSummary = {
  period: AttendancePeriod;
  timezone: string;
  start_date: string;
  end_date: string;
  empty: boolean;
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

export type AttendanceFilter = {
  from?: string;
  to?: string;
  employee_id?: number | string;
};

export type OfficeLocation = {
  configured: boolean;
  latitude: number | null;
  longitude: number | null;
  radius_meters: number;
  address: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readRecord(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(message);
  }
  return value;
}

function readNumber(value: unknown, field: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`The server returned an invalid ${field}.`);
  }
  return value;
}

function readString(value: unknown, field: string) {
  if (typeof value !== 'string') {
    throw new Error(`The server returned an invalid ${field}.`);
  }
  return value;
}

function readOptionalString(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function readOfficeLocation(value: unknown): OfficeLocation {
  const row = readRecord(value, 'The server returned an invalid office location.');
  const latitude = row.latitude === null ? null : readNumber(row.latitude, 'office latitude');
  const longitude = row.longitude === null ? null : readNumber(row.longitude, 'office longitude');
  const configured = typeof row.configured === 'boolean' ? row.configured : null;
  const coordinatesAreValid =
    latitude !== null &&
    longitude !== null &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180;
  if (
    configured === null ||
    (latitude === null) !== (longitude === null) ||
    configured !== coordinatesAreValid
  ) {
    throw new Error('The server returned invalid or incomplete office coordinates.');
  }
  const radiusMeters = readNumber(row.radius_meters, 'office radius');
  if (radiusMeters <= 0) {
    throw new Error('The server returned an invalid office radius.');
  }
  return {
    configured,
    latitude,
    longitude,
    radius_meters: radiusMeters,
    address: readString(row.address, 'office address'),
  };
}

export async function getOfficeLocation(): Promise<OfficeLocation> {
  const payload = readRecord(
    await apiRequest('/api/admin/office-location'),
    'The server returned an invalid office location.'
  );
  return readOfficeLocation(payload.office_location);
}

export async function saveOfficeLocation(
  latitude: number,
  longitude: number,
  radiusMeters: number
): Promise<OfficeLocation> {
  const payload = readRecord(
    await apiRequest('/api/admin/office-location', {
      method: 'PUT',
      body: JSON.stringify({
        latitude,
        longitude,
        radius_meters: radiusMeters,
      }),
    }),
    'The server returned an invalid saved office location.'
  );
  return readOfficeLocation(payload.office_location);
}

function readActive(value: unknown) {
  if (value === true || value === 1) {
    return true;
  }
  if (value === false || value === 0) {
    return false;
  }
  throw new Error('The server returned an invalid account status.');
}

function readEmployee(value: unknown): AdminEmployee {
  const employee = readRecord(value, 'The server returned an invalid employee record.');
  const role = employee.role;
  const employmentType = employee.employment_type;
  if (role !== 'admin' && role !== 'employee') {
    throw new Error('The server returned an invalid employee role.');
  }
  if (
    employmentType !== 'Full-time' &&
    employmentType !== 'Part-time' &&
    employmentType !== 'Contract' &&
    employmentType !== 'Intern'
  ) {
    throw new Error('The server returned an invalid employment type.');
  }
  return {
    id: readNumber(employee.id, 'employee ID'),
    employee_code: readOptionalString(employee.employee_code),
    name: readString(employee.name, 'employee name'),
    email: readString(employee.email, 'employee email'),
    phone: typeof employee.phone === 'string' ? employee.phone : '',
    position: typeof employee.position === 'string' ? employee.position : '',
    department: readOptionalString(employee.department),
    joining_date: typeof employee.joining_date === 'string' ? employee.joining_date : '',
    employment_type: employmentType,
    role,
    is_active: readActive(employee.is_active),
  };
}

export async function getEmployees(search = ''): Promise<AdminEmployee[]> {
  const query = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
  const payload = readRecord(
    await apiRequest(`/api/admin/employees${query}`),
    'The server returned an invalid employee list.'
  );
  if (!Array.isArray(payload.employees)) {
    throw new Error('The server returned an invalid employee list.');
  }
  return payload.employees.map(readEmployee);
}

export async function getEmployee(employeeId: number): Promise<AdminEmployee> {
  const payload = readRecord(
    await apiRequest(`/api/admin/employees/${employeeId}`),
    'The server returned an invalid employee detail.'
  );
  return readEmployee(payload.employee);
}

export async function createEmployee(
  input: EmployeeInput & { password: string }
): Promise<void> {
  await apiRequest('/api/admin/employees', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateEmployee(
  employeeId: number,
  input: EmployeeInput & { is_active: boolean }
): Promise<void> {
  await apiRequest(`/api/admin/employees/${employeeId}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export async function deactivateEmployee(employeeId: number): Promise<void> {
  await apiRequest(`/api/admin/employees/${employeeId}`, { method: 'DELETE' });
}

export async function resetEmployeePassword(
  employeeId: number,
  temporaryPassword: string
): Promise<void> {
  await apiRequest(`/api/admin/employees/${employeeId}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({
      temporary_password: temporaryPassword,
      confirm_password: temporaryPassword,
    }),
  });
}

function readDepartment(value: unknown): Department {
  const department = readRecord(value, 'The server returned an invalid department.');
  return {
    id: readNumber(department.id, 'department ID'),
    department_name: readString(department.department_name, 'department name'),
  };
}

export async function getDepartments(): Promise<Department[]> {
  const payload = readRecord(
    await apiRequest('/api/admin/departments'),
    'The server returned an invalid department list.'
  );
  if (!Array.isArray(payload.departments)) {
    throw new Error('The server returned an invalid department list.');
  }
  return payload.departments.map(readDepartment);
}

export async function createDepartment(name: string): Promise<void> {
  await apiRequest('/api/admin/departments', {
    method: 'POST',
    body: JSON.stringify({ department_name: name }),
  });
}

export async function deleteDepartment(departmentId: number): Promise<void> {
  await apiRequest(`/api/admin/departments/${departmentId}`, { method: 'DELETE' });
}

function queryString(filter: AttendanceFilter) {
  const entries = Object.entries(filter).filter(([, value]) => value !== undefined && value !== '');
  return entries.length
    ? `?${entries.map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`).join('&')}`
    : '';
}

function readAttendance(value: unknown): AttendanceRecord {
  const row = readRecord(value, 'The server returned an invalid attendance record.');
  const hours = row.hours;
  if (hours !== null && (typeof hours !== 'number' || !Number.isFinite(hours))) {
    throw new Error('The server returned invalid working hours.');
  }
  return {
    id: readNumber(row.id, 'attendance ID'),
    date: readString(row.date, 'attendance date'),
    employee_id: readNumber(row.employee_id, 'employee ID'),
    employee_code: readOptionalString(row.employee_code),
    name: readString(row.name, 'employee name'),
    department: readOptionalString(row.department),
    check_in: readOptionalString(row.check_in),
    check_out: readOptionalString(row.check_out),
    hours,
    status: readString(row.status, 'attendance status'),
  };
}

export async function getAttendance(
  filter: AttendanceFilter = {}
): Promise<AttendanceRecord[]> {
  const payload = readRecord(
    await apiRequest(`/api/admin/attendance${queryString(filter)}`),
    'The server returned an invalid attendance report.'
  );
  if (!Array.isArray(payload.attendance)) {
    throw new Error('The server returned an invalid attendance report.');
  }
  return payload.attendance.map(readAttendance);
}

function readLeave(value: unknown): AdminLeave {
  const row = readRecord(value, 'The server returned an invalid leave request.');
  const status = row.status;
  if (status !== 'Pending' && status !== 'Approved' && status !== 'Rejected') {
    throw new Error('The server returned an invalid leave status.');
  }
  return {
    id: readNumber(row.id, 'leave request ID'),
    from_date: readString(row.from_date, 'leave start date'),
    to_date: readString(row.to_date, 'leave end date'),
    reason: readString(row.reason, 'leave reason'),
    status,
    created_at: typeof row.created_at === 'string' ? row.created_at : '',
    employee_id: readNumber(row.employee_id, 'employee ID'),
    employee_code: readOptionalString(row.employee_code),
    name: readString(row.name, 'employee name'),
    department: readOptionalString(row.department),
  };
}

export async function getLeaves(status?: LeaveStatus): Promise<AdminLeave[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  const payload = readRecord(
    await apiRequest(`/api/admin/leaves${query}`),
    'The server returned an invalid leave request list.'
  );
  if (!Array.isArray(payload.leaves)) {
    throw new Error('The server returned an invalid leave request list.');
  }
  return payload.leaves.map(readLeave);
}

export async function updateLeaveStatus(
  leaveId: number,
  status: Exclude<LeaveStatus, 'Pending'>
): Promise<void> {
  await apiRequest(`/api/admin/leaves/${leaveId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

function readAttendanceSummary(payloadValue: unknown): AttendanceSummary {
  const payload = readRecord(payloadValue, 'The server returned an invalid attendance summary.');
  const stats = readRecord(payload.stats, 'The server returned invalid attendance totals.');
  if (!Array.isArray(payload.series)) {
    throw new Error('The server returned an invalid attendance chart.');
  }
  const period = payload.period;
  if (period !== 'week' && period !== 'month' && period !== 'year') {
    throw new Error('The server returned an invalid attendance period.');
  }
  return {
    period,
    timezone: readString(payload.timezone, 'office timezone'),
    start_date: readString(payload.start_date, 'period start date'),
    end_date: readString(payload.end_date, 'period end date'),
    empty: payload.empty === true,
    series: payload.series.map((value) => {
      const row = readRecord(value, 'The server returned an invalid chart value.');
      return {
        date: readString(row.date, 'chart date'),
        label: readString(row.label, 'chart label'),
        present: readNumber(row.present, 'chart attendance count'),
      };
    }),
    stats: {
      present: readNumber(stats.present, 'present count'),
      absent: readNumber(stats.absent, 'absent count'),
      on_leave: readNumber(stats.on_leave, 'leave count'),
      completed: readNumber(stats.completed, 'completed shifts'),
      in_progress: readNumber(stats.in_progress, 'active shifts'),
      hours: readNumber(stats.hours, 'working hours'),
    },
  };
}

export async function getAttendanceSummary(
  period: AttendancePeriod
): Promise<AttendanceSummary> {
  return readAttendanceSummary(
    await apiRequest(`/api/admin/attendance/overview?period=${period}`)
  );
}

