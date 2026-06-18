import type { PromptProfile, StudyWindow, TaskItem } from '../../shared/types';

export function buildImportPrompt(rawText: string, profile: PromptProfile): string {
  return [
    profile.content,
    '',
    '把下面粘贴的学习计划解析成可以长期保存的本地结构化数据。',
    '规则：',
    '- 保留学习者的真实意图。',
    '- 把过大的事项拆成具体任务。',
    '- 用分钟估算耗时。',
    '- difficulty 只能使用 foundation、standard、advanced、exam。',
    '- 如果一个任务明显依赖另一个任务，用标题记录依赖关系。',
    '- 除枚举值和 JSON 字段名外，所有自然语言内容使用中文。',
    '',
    '输出 JSON 形状：',
    '{ "goals": [...], "tasks": [...] }',
    '',
    '粘贴的计划：',
    rawText
  ].join('\n');
}

export function buildPlanPrompt(params: {
  date: string;
  windows: StudyWindow[];
  tasks: TaskItem[];
  profile: PromptProfile;
  blockMinutes: number;
}): string {
  return [
    params.profile.content,
    '',
    `为 ${params.date} 生成每块 ${params.blockMinutes} 分钟的学习计划。`,
    '规则：',
    '- 只使用未完成任务。',
    '- 顶层 JSON 必须是 { "blocks": [...] }。',
    '- 每个 blocks 元素必须使用这些英文 key：taskTitle、startTime、endTime、durationMinutes、objective、action、expectedOutput、difficulty、material、successCheck、fallback。',
    '- startTime 和 endTime 必须是 HH:mm 字符串，例如 "20:00"。',
    '- durationMinutes 必须是数字。',
    '- difficulty 必须是字符串，可使用 foundation、standard、advanced、exam 或中文说明。',
    '- 优先安排主动输出，减少被动阅读。',
    '- 如果任务太大，只规划下一个有用切片。',
    '- AI 输出只是草稿，必须由用户确认后才成为正式计划。',
    '- 除枚举值和 JSON 字段名外，所有自然语言内容使用中文。',
    '',
    '示例：',
    '{"blocks":[{"taskTitle":"任务标题","startTime":"20:00","endTime":"20:20","durationMinutes":20,"objective":"本块目标","action":"具体学习动作","expectedOutput":"本块产出","difficulty":"foundation","material":"使用材料","successCheck":"验收标准","fallback":"太难时的降级动作"}]}',
    '',
    `可用学习时间段：${JSON.stringify(params.windows)}`,
    `任务：${JSON.stringify(params.tasks)}`
  ].join('\n');
}

export function buildReviewPrompt(params: {
  date: string;
  snapshot: unknown;
  profile: PromptProfile;
}): string {
  return [
    params.profile.content,
    '',
    `复盘 ${params.date} 的学习执行情况。`,
    '完成度和专注度都按 0 到 100 打分。',
    '用务实的语言解释今天的问题，并给出简洁的下一步动作。',
    '不要羞辱学习者，重点放在纠偏和重建计划。',
    '所有自然语言内容使用中文。',
    '',
    `Snapshot: ${JSON.stringify(params.snapshot)}`
  ].join('\n');
}
