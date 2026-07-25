const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CHINESE_DATE = /^(\d{4})年(\d{1,2})月(\d{1,2})日?$/;
const RELATIVE_DURATION = /(十|[一二两三四五六七八九]|\d+)\s*个?\s*(天|周|月)/;

export function resolveGoalDueDate(deadline: string, confirmedDate: string): string | null {
  const value = deadline.trim();
  if (!value || ['未明确', '无', '不限', '暂无'].includes(value)) return null;
  if (!ISO_DATE.test(confirmedDate)) {
    throw new Error('目标确认日期无效，无法计算截止日期。');
  }
  if (ISO_DATE.test(value)) {
    assertRealDate(value);
    return value;
  }
  const chineseDate = CHINESE_DATE.exec(value);
  if (chineseDate) {
    const parsed = formatDate(
      Number(chineseDate[1]),
      Number(chineseDate[2]),
      Number(chineseDate[3])
    );
    assertRealDate(parsed);
    return parsed;
  }
  const duration = RELATIVE_DURATION.exec(value);
  if (!duration) {
    throw new Error('截止时间无法转换为明确日期，请使用“一个月”或“YYYY-MM-DD”。');
  }
  const amount = parseDurationAmount(duration[1]);
  const base = parseDate(confirmedDate);
  if (duration[2] === '天') {
    base.setUTCDate(base.getUTCDate() + amount);
  } else if (duration[2] === '周') {
    base.setUTCDate(base.getUTCDate() + amount * 7);
  } else {
    addCalendarMonths(base, amount);
  }
  return formatDate(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate());
}

function parseDurationAmount(raw: string): number {
  if (/^\d+$/.test(raw)) return Number(raw);
  const values: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10
  };
  return values[raw] ?? 0;
}

function addCalendarMonths(date: Date, months: number): void {
  const originalDay = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    0
  )).getUTCDate();
  date.setUTCDate(Math.min(originalDay, lastDay));
}

function parseDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function assertRealDate(value: string): void {
  const parsed = parseDate(value);
  const normalized = formatDate(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth() + 1,
    parsed.getUTCDate()
  );
  if (normalized !== value) {
    throw new Error('截止日期无效，请检查年月日。');
  }
}

function formatDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
