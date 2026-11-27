import { apiRequest } from '@/config/api';

export type EmployeeProfile = {
  id: number;
  employee_code: string;
  name: string;
  email: string;
  phone: string;
  position: string;
  department: string;
  joining_date: string;
  employment_type: string;
  must_change_password: boolean;
};

export type TodayAttendance = {
  date: string;
  record: {
    check_in: string | null;
    check_out: string | null;
    status: string;
  } | null;
  on_leave: boolean;
  hours: number | null;
  elapsed_seconds: number | null;
};

export type AttendanceHistoryItem = {
  date: string;
  check_in: string | null;
  check_out: string | null;
  hours: number | null;
  status: string;
};

export type EmployeeLeaveStatus = 'Pending' | 'Approved' | 'Rejected';

export type EmployeeLeave = {
  id: number;
  from_date: string;
  to_date: string;
  reason: string;
  status: EmployeeLeaveStatus;
  created_at: string;
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

function readString(value: unknown, field: string) {
  if (typeof value !== 'string') {
    throw new Error(`The server returned an invalid ${field}.`);
  }
  return value;
}

function readNullableString(value: unknown, field: string) {
  if (value === null || value === undefined) {
    return null;
  }
  return readString(value, field);
}

function readNullableNumber(value: unknown, field: string) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`The server returned an invalid ${field}.`);
  }
  return value;
}

function readNumber(value: unknown, field: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`The server returned an invalid ${field}.`);
  }
  return value;
}

export async function getEmployeeProfile(): Promise<EmployeeProfile> {
  const payload = readRecord(
    await apiRequest('/api/employee/profile'),
    'The server returned an invalid employee profile.'
  );
  const employee = readRecord(payload.employee, 'The server returned an invalid employee profile.');
  if (typeof employee.id !== 'number' || typeof employee.must_change_password !== 'boolean') {
    throw new Error('The server returned an incomplete employee profile.');
  }
  return {
    id: employee.id,
    employee_code: typeof employee.employee_code === 'string' ? employee.employee_code : '',
    name: readString(employee.name, 'employee name'),
    email: readString(employee.email, 'employee email'),
    phone: typeof employee.phone === 'string' ? employee.phone : '',
    position: typeof employee.position === 'string' ? employee.position : '',
    department: typeof employee.department === 'string' ? employee.department : '',
    joining_date: typeof employee.joining_date === 'string' ? employee.joining_date : '',
    employment_type: typeof employee.employment_type === 'string' ? employee.employment_type : '',
    must_change_password: employee.must_change_password,
  };
}

export async function updateEmployeeProfile(name: string, phone: string): Promise<EmployeeProfile> {
  const payload = readRecord(
    await apiRequest('/api/employee/profile', {
      method: 'PUT',
      body: JSON.stringify({ name, phone }),
    }),
    'The server returned an invalid updated profile.'
  );
  const employee = readRecord(payload.employee, 'The server returned an invalid updated profile.');
  if (typeof employee.id !== 'number' || typeof employee.must_change_password !== 'boolean') {
    throw new Error('The server returned an incomplete updated profile.');
  }
  return {
    id: employee.id,
    employee_code: typeof employee.employee_code === 'string' ? employee.employee_code : '',
    name: readString(employee.name, 'employee name'),
    email: readString(employee.email, 'employee email'),
    phone: typeof employee.phone === 'string' ? employee.phone : '',
    position: typeof employee.position === 'string' ? employee.position : '',
    department: typeof employee.department === 'string' ? employee.department : '',
    joining_date: typeof employee.joining_date === 'string' ? employee.joining_date : '',
    employment_type: typeof employee.employment_type === 'string' ? employee.employment_type : '',
    must_change_password: employee.must_change_password,
  };
}

export async function getTodayAttendance(): Promise<TodayAttendance> {
  const payload = readRecord(
    await apiRequest('/api/attendance/today'),
    'The server returned an invalid attendance response.'
  );
  let record: TodayAttendance['record'] = null;
  if (payload.record !== null && payload.record !== undefined) {
    const row = readRecord(payload.record, 'The server returned an invalid attendance record.');
    record = {
      check_in: readNullableString(row.check_in, 'check-in time'),
      check_out: readNullableString(row.check_out, 'check-out time'),
      status: readString(row.status, 'attendance status'),
    };
  }
  if (typeof payload.on_leave !== 'boolean') {
    throw new Error('The server returned an invalid leave status.');
  }
  return {
    date: readString(payload.date, 'attendance date'),
    record,
    on_leave: payload.on_leave,
    hours: readNullableNumber(payload.hours, 'working hours'),
    elapsed_seconds: readNullableNumber(payload.elapsed_seconds, 'elapsed time'),
  };
}

export async function checkIn(
  latitude: number,
  longitude: number
): Promise<{
  date: string;
  check_in: string;
  status: string;
  distance_meters: number;
  radius_meters: number;
}> {
  const payload = readRecord(
    await apiRequest('/api/attendance/check-in', {
      method: 'POST',
      body: JSON.stringify({ latitude, longitude }),
    }),
    'The server returned an invalid check-in response.'
  );
  return {
    date: readString(payload.date, 'attendance date'),
    check_in: readString(payload.check_in, 'check-in time'),
    status: readString(payload.status, 'attendance status'),
    distance_meters: readNumber(payload.distance_meters, 'verified distance'),
    radius_meters: readNumber(payload.radius_meters, 'allowed office radius'),
  };
}

export async function checkOut(): Promise<{ check_out: string }> {
  const payload = readRecord(
    await apiRequest('/api/attendance/check-out', { method: 'POST' }),
    'The server returned an invalid check-out response.'
  );
  return {
    check_out: readString(payload.check_out, 'check-out time'),
  };
}

export async function getAttendanceHistory(): Promise<AttendanceHistoryItem[]> {
  const payload = readRecord(
    await apiRequest('/api/attendance/history'),
    'The server returned an invalid attendance history.'
  );
  if (!Array.isArray(payload.attendance)) {
    throw new Error('The server returned an invalid attendance history.');
  }
  return payload.attendance.map((value) => {
    const row = readRecord(value, 'The server returned an invalid attendance record.');
    return {
      date: readString(row.date, 'attendance date'),
      check_in: readNullableString(row.check_in, 'check-in time'),
      check_out: readNullableString(row.check_out, 'check-out time'),
      hours: readNullableNumber(row.hours, 'working hours'),
      status: readString(row.status, 'attendance status'),
    };
  });
}

export async function getEmployeeLeaves(): Promise<EmployeeLeave[]> {
  const payload = readRecord(
    await apiRequest('/api/employee/leaves'),
    'The server returned an invalid leave request list.'
  );
  if (!Array.isArray(payload.leaves)) {
    throw new Error('The server returned an invalid leave request list.');
  }
  return payload.leaves.map((value) => {
    const row = readRecord(value, 'The server returned an invalid leave request.');
    if (row.status !== 'Pending' && row.status !== 'Approved' && row.status !== 'Rejected') {
      throw new Error('The server returned an invalid leave status.');
    }
    if (typeof row.id !== 'number' || !Number.isFinite(row.id)) {
      throw new Error('The server returned an invalid leave request ID.');
    }
    return {
      id: row.id,
      from_date: readString(row.from_date, 'leave start date'),
      to_date: readString(row.to_date, 'leave end date'),
      reason: readString(row.reason, 'leave reason'),
      status: row.status,
      created_at: typeof row.created_at === 'string' ? row.created_at : '',
    };
  });
}

export async function submitEmployeeLeave(
  fromDate: string,
  toDate: string,
  reason: string
): Promise<void> {
  await apiRequest('/api/employee/leaves', {
    method: 'POST',
    body: JSON.stringify({ from_date: fromDate, to_date: toDate, reason }),
  });
}

