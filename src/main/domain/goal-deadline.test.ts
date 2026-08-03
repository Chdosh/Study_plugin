import { describe, expect, it } from 'vitest';
import { resolveGoalDueDate } from './goal-deadline';

describe('resolveGoalDueDate', () => {
  it('解析明确日期与中文时长', () => {
    expect(resolveGoalDueDate('一个月', '2026-07-24')).toBe('2026-08-24');
    expect(resolveGoalDueDate('2026-08-24', '2026-07-24')).toBe('2026-08-24');
    expect(resolveGoalDueDate('2026年8月24日', '2026-07-24')).toBe('2026-08-24');
    expect(resolveGoalDueDate('两周', '2026-07-24')).toBe('2026-08-07');
  });

  it('未明确/无/不限/暂无视为无截止日期', () => {
    expect(resolveGoalDueDate('未明确', '2026-07-24')).toBeNull();
    expect(resolveGoalDueDate('不限', '2026-07-24')).toBeNull();
    expect(resolveGoalDueDate('', '2026-07-24')).toBeNull();
  });

  it('无法解析的文本直接抛错，保证业务校验不静默', () => {
    expect(() => resolveGoalDueDate('尽快', '2026-07-24')).toThrow();
  });
});
