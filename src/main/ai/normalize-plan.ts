import {
  dailyPlanAgentOutputSchema,
  type DailyPlanAgentOutput,
  type LooseDailyPlanAgentOutput
} from '../../shared/schemas';
import type { StudyWindow, TaskItem } from '../../shared/types';

interface NormalizePlanParams {
  raw: LooseDailyPlanAgentOutput;
  windows: StudyWindow[];
  tasks: TaskItem[];
  blockMinutes: number;
}

export function normalizeDailyPlanOutput(params: NormalizePlanParams): DailyPlanAgentOutput {
  const taskByTitle = new Map(params.tasks.map((task) => [task.title, task]));
  const windows = params.windows.length > 0 ? params.windows : [{ start: '20:00', end: '22:00' }];
  let windowIndex = 0;
  let cursor = parseTime(windows[0].start) ?? 20 * 60;

  const sourceBlocks =
    params.raw.blocks.length > 0
      ? params.raw.blocks
      : params.tasks.map((task) => ({
          taskTitle: task.title,
          objective: task.title,
          action: task.description ?? task.acceptanceCriteria ?? task.title
        }));

  const blocks = sourceBlocks.map((rawBlock) => {
    const taskTitle = pickString(rawBlock, [
      'taskTitle',
      'task_title',
      'task',
      'taskName',
      'task_name',
      'title',
      '任务',
      '任务标题'
    ]);
    const matchedTask = taskTitle ? taskByTitle.get(taskTitle) : undefined;
    const durationMinutes =
      pickNumber(rawBlock, ['durationMinutes', 'duration_minutes', 'duration', 'minutes', '时长', '分钟']) ??
      params.blockMinutes;

    while (windowIndex < windows.length) {
      const currentWindowEnd = parseTime(windows[windowIndex].end);
      const nextWindow = windows[windowIndex + 1];
      if (currentWindowEnd === null || cursor + durationMinutes <= currentWindowEnd || !nextWindow) break;
      windowIndex += 1;
      cursor = parseTime(nextWindow.start) ?? cursor;
    }

    const explicitStart = pickString(rawBlock, ['startTime', 'start_time', 'start', 'begin', '开始时间']);
    const explicitEnd = pickString(rawBlock, ['endTime', 'end_time', 'end', 'finish', '结束时间']);
    const startMinutes = parseTime(explicitStart) ?? cursor;
    const endMinutes = parseTime(explicitEnd) ?? startMinutes + durationMinutes;
    cursor = endMinutes;

    const objective =
      pickString(rawBlock, ['objective', 'goal', '目的', '目标']) ??
      taskTitle ??
      matchedTask?.title ??
      '完成一个可检查的学习切片';
    const action =
      pickString(rawBlock, ['action', 'activity', 'content', 'description', 'plan', '学习动作', '动作', '内容']) ??
      matchedTask?.description ??
      objective;

    return {
      taskTitle: matchedTask?.title ?? taskTitle ?? null,
      startTime: formatTime(startMinutes),
      endTime: formatTime(endMinutes),
      durationMinutes: Math.max(5, Math.min(120, durationMinutes)),
      objective,
      action,
      expectedOutput:
        pickString(rawBlock, ['expectedOutput', 'expected_output', 'output', 'deliverable', 'result', '产出', '输出']) ??
        matchedTask?.acceptanceCriteria ??
        '写下一段可检查的学习输出',
      difficulty:
        pickString(rawBlock, ['difficulty', 'level', '难度']) ??
        matchedTask?.difficulty ??
        'standard',
      material:
        pickString(rawBlock, ['material', 'materials', 'resource', 'resources', '材料', '资料']) ??
        '当前任务相关材料',
      successCheck:
        pickString(rawBlock, ['successCheck', 'success_check', 'check', 'validation', '验收', '检查']) ??
        matchedTask?.acceptanceCriteria ??
        '能复述重点，或产出笔记/代码/答案',
      fallback:
        pickString(rawBlock, ['fallback', 'backup', 'ifHard', '降级', '替代方案']) ??
        '如果太难，把本块缩小为阅读一个小节并写 3 条要点'
    };
  });

  return dailyPlanAgentOutputSchema.parse({ blocks });
}

function pickString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function pickNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
    if (typeof value === 'string') {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.match(/(\d{1,2})[:：](\d{2})/);
  if (!match) return null;
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function formatTime(totalMinutes: number): string {
  const normalized = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}
