export type AchievementAttendanceRecord = {
  date: string;
  check_in: string | null;
  status: string;
};

export type EmployeeAchievement = {
  id: string;
  title: string;
  icon: string;
  description: string;
  unlocked: boolean;
  progressLabel: string;
};

const MONTHLY_ATTENDANCE_TARGET = 30;

function isValidIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function calculateEmployeeAchievements(
  records: readonly AchievementAttendanceRecord[]
): EmployeeAchievement[] {
  const attendanceDates = new Set(
    records
      .filter((record) => {
        const status = record.status.trim().toLowerCase();
        return (
          Boolean(record.check_in?.trim()) &&
          isValidIsoDate(record.date) &&
          (status === 'present' || status === 'late')
        );
      })
      .map((record) => record.date)
  );
  const attendanceDays = attendanceDates.size;
  const monthlyAttendance = new Map<string, number>();

  attendanceDates.forEach((date) => {
    const month = date.slice(0, 7);
    monthlyAttendance.set(month, (monthlyAttendance.get(month) ?? 0) + 1);
  });

  const bestMonthDays = Math.max(0, ...monthlyAttendance.values());

  return [
    {
      id: 'first-check-in',
      title: 'First Check-in',
      icon: '🌱',
      description: 'Record your first verified attendance.',
      unlocked: attendanceDays >= 1,
      progressLabel: `${Math.min(attendanceDays, 1)}/1 check-in day`,
    },
    {
      id: 'attendance-star',
      title: 'Attendance Star',
      icon: '⭐',
      description: 'Reach five verified attendance days.',
      unlocked: attendanceDays >= 5,
      progressLabel: `${Math.min(attendanceDays, 5)}/5 attendance days`,
    },
    {
      id: 'consistent-contributor',
      title: 'Consistent Contributor',
      icon: '🌷',
      description: 'Reach ten verified attendance days.',
      unlocked: attendanceDays >= 10,
      progressLabel: `${Math.min(attendanceDays, 10)}/10 attendance days`,
    },
    {
      id: 'monthly-milestone',
      title: 'Monthly Milestone',
      icon: '🎉',
      description: 'Record attendance on 30 distinct days in one calendar month.',
      unlocked: bestMonthDays >= MONTHLY_ATTENDANCE_TARGET,
      progressLabel: `${Math.min(bestMonthDays, MONTHLY_ATTENDANCE_TARGET)}/${MONTHLY_ATTENDANCE_TARGET} days in best month`,
    },
  ];
}
