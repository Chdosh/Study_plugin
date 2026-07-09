import type { GoalBrief, GoalIntakeMessage, PromptProfile, RoadmapStage, ShortPlanDay, StudyWindow, TaskItem } from '../../shared/types';

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
  goal?: unknown;
  stage?: unknown;
  context?: unknown;
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
    `当前目标：${JSON.stringify(params.goal ?? null)}`,
    `当前阶段：${JSON.stringify(params.stage ?? null)}`,
    `工作上下文：${JSON.stringify(params.context ?? null)}`,
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

export function buildGoalIntakePrompt(params: {
  messages: GoalIntakeMessage[];
  profile: PromptProfile;
}): string {
  return [
    params.profile.content,
    '',
    '你正在为一个本地优先 AI 学习系统进行首次主动访谈。目标不是让用户填表，而是用自然对话把目标问清楚。',
    '你需要了解：用户想学什么、最终想达到什么结果、当前基础、每天/每周可用时间、截止时间、现实限制、什么算成功。',
    '如果信息不足，只问 1 到 3 个最关键的问题。不要一次抛出长问卷。',
    '如果用户表达“直接开始”“先生成计划”“别问了”等意思，使用已有信息生成 best-effort 目标理解。',
    '当信息基本足够时，输出简短“目标理解”，让用户确认或直接修改。',
    '输出 JSON 字段：status、reply、brief、missingInfo、shouldForceStart。',
    'status 只能是 need_more_info 或 ready。',
    'brief 在 ready 时必须包含 title、targetOutcome、currentLevel、availableTime、deadline、constraints、successCriteria。',
    '所有自然语言内容使用中文。',
    '',
    `历史访谈：${JSON.stringify(params.messages)}`
  ].join('\n');
}

export function buildRoadmapPrompt(params: {
  goal: unknown;
  brief: GoalBrief | null;
  profile: PromptProfile;
}): string {
  return [
    params.profile.content,
    '',
    '根据已确认目标生成长期大纲。只展示阶段和方向，不要展开很多天的细节。',
    '输出 JSON 字段：goalSummary、stages。',
    '每个 stage 包含 title、objective、direction、successCriteria。',
    '阶段数量保持克制，优先 3 到 5 个阶段。',
    '所有自然语言内容使用中文。',
    '',
    `目标：${JSON.stringify(params.goal)}`,
    `目标理解：${JSON.stringify(params.brief)}`
  ].join('\n');
}

export function buildShortPlanPrompt(params: {
  goal: unknown;
  brief: GoalBrief | null;
  roadmap: RoadmapStage[];
  profile: PromptProfile;
}): string {
  return [
    params.profile.content,
    '',
    '根据目标和长期大纲生成短期计划。只生成第一周重点和前三天安排，不要提前详细生成后续很多天。',
    '输出 JSON 字段：weekFocus、days。',
    'days 只包含 dayIndex 1 到 3，每天包含 title、focus、tasks、expectedOutput、successCriteria。',
    '任务要具体到打开电脑就能做，但第 2、3 天不要展开到分钟。',
    '所有自然语言内容使用中文。',
    '',
    `目标：${JSON.stringify(params.goal)}`,
    `目标理解：${JSON.stringify(params.brief)}`,
    `长期大纲：${JSON.stringify(params.roadmap)}`
  ].join('\n');
}

export function buildDailyGuidePrompt(params: {
  date: string;
  windows: StudyWindow[];
  blockMinutes: number;
  goal: unknown;
  brief: GoalBrief | null;
  roadmap: RoadmapStage[];
  shortPlan: ShortPlanDay[];
  profile: PromptProfile;
}): string {
  return [
    params.profile.content,
    '',
    `为 ${params.date} 生成第一天执行稿。核心原则：任务决定时长，不要先生成固定 ${params.blockMinutes} 分钟时间块。`,
    '风格参考 docs/Example.md：强引导、明确产物、明确不要做什么、避免用户跑偏。',
    '输出 JSON 字段：date、todayGoal、deliverables、boundaries、acceptanceCriteria、tomorrowActions、tasks。',
    'tasks 是今日主任务，不是时间块。通常生成 2 到 4 个，默认优先 3 个；任务复杂或时间少时可以只有 1 个。',
    '根据可用时间动态决定任务数量：30-60 分钟 1-2 个；60-120 分钟 2-3 个；120-180 分钟 2-4 个；180 分钟以上通常不超过 4-5 个。',
    '每日计划必须预留约 10%-15% 缓冲时间。如果时间不足，减少任务数量或缩小任务范围，不要压缩合理执行时间来塞入更多任务。',
    '每个 task 必须包含 title、objective、scope、estimatedMinutes、actions、deliverable、doneWhen、quickHint、evaluationMode、submissionPolicy、carryoverAllowed。',
    'estimatedMinutes 必须包含 min、target、max，且 min <= target <= max。target 是合理完成时间，不是固定倒计时。',
    '每个 task 内部 actions 生成 3 到 6 个，Action 只作为执行引导和本地检查点，不作为独立提交或 AI 评估单位。',
    'submissionPolicy 默认且只能是 once_after_task。主任务最终提交一次；evaluationMode 可为 local 或 ai。',
    '主任务必须覆盖完整且有意义的学习或产出结果，不能写“学习某知识”“完善项目”这种模糊任务。',
    '不要生成复杂知识图谱、账号系统、云同步等偏离目标的内容。',
    '所有自然语言内容使用中文。',
    '',
    `可用学习时间段：${JSON.stringify(params.windows)}`,
    `目标：${JSON.stringify(params.goal)}`,
    `目标理解：${JSON.stringify(params.brief)}`,
    `长期大纲：${JSON.stringify(params.roadmap)}`,
    `前三天计划：${JSON.stringify(params.shortPlan)}`
  ].join('\n');
}

export function buildStageOutlinePrompt(params: {
  goal: unknown;
  tasks: unknown[];
  profile: PromptProfile;
}): string {
  return [
    params.profile.content,
    '',
    '为学习目标生成阶段性总体路线。只生成阶段大纲，不要展开所有具体学习步骤。',
    '输出 JSON 形状：{ "goalSummary": "...", "stages": [...] }。',
    '每个 stage 必须包含 title、objective、prerequisites、successCriteria。',
    '阶段数量保持克制，优先 3 到 5 个阶段。',
    '除 JSON 字段名外，所有自然语言内容使用中文。',
    '',
    `目标：${JSON.stringify(params.goal)}`,
    `已有任务：${JSON.stringify(params.tasks)}`
  ].join('\n');
}

export function buildTeachStepPrompt(params: { context: unknown; profile: PromptProfile }): string {
  return [
    params.profile.content,
    '',
    '展开当前学习步骤。一次只处理当前步骤，不要提前生成后续步骤。',
    '输出 JSON 字段：title、objective、instruction、explanation、userAction、expectedOutput、successCriteria、requiresSubmission。',
    '必须让用户知道现在该做什么，以及什么算完成。',
    '不得宣布步骤已经完成。',
    '除 JSON 字段名和枚举值外，所有自然语言内容使用中文。',
    '',
    `工作上下文：${JSON.stringify(params.context)}`
  ].join('\n');
}

export function buildAnswerStepQuestionPrompt(params: {
  question: string;
  context: unknown;
  profile: PromptProfile;
}): string {
  return [
    params.profile.content,
    '',
    '回答当前学习步骤中的问题分支。问题分支不能替代主线步骤，也不能改变 activeStepId。',
    '输出 JSON 字段：answer、relationToCurrentStep、example、resolved、returnToStepInstruction、resolutionSummary。',
    '如果问题已解决，returnToStepInstruction 要明确提醒用户回到当前步骤。',
    '除 JSON 字段名外，所有自然语言内容使用中文。',
    '',
    `用户问题：${params.question}`,
    `工作上下文：${JSON.stringify(params.context)}`
  ].join('\n');
}

export function buildEvaluateSubmissionPrompt(params: {
  submission: string;
  context: unknown;
  profile: PromptProfile;
}): string {
  return [
    params.profile.content,
    '',
    '评估用户对当前步骤的提交。必须先根据完成标准评估，再建议下一步动作。',
    '输出 JSON 字段：result、mastery、evidence、correctParts、misconceptions、missingRequirements、feedback、recommendedAction。',
    'result 只能是 passed、partial、failed、unclear。',
    'recommendedAction 只能是 advance、explain_again、remediate、practice、simplify、complete_task、request_user_decision。',
    '不得直接标记任务完成，只返回结构化评估。',
    '除 JSON 字段名和枚举值外，所有自然语言内容使用中文。',
    '',
    `用户提交：${params.submission}`,
    `工作上下文：${JSON.stringify(params.context)}`
  ].join('\n');
}

export function buildDecideNextStepPrompt(params: {
  evaluation: unknown;
  context: unknown;
  profile: PromptProfile;
}): string {
  return [
    params.profile.content,
    '',
    '根据评估结果决定下一步。只能生成当前需要的下一步，不要展开完整路线。',
    '输出 JSON 字段：decision、reason、taskCompleted、nextStep、remediation、carryForward。',
    'decision 只能是 advance、explain_again、remediate、practice、simplify、complete_task、request_user_decision。',
    'advance 时提供 nextStep；remediate/practice/simplify/explain_again 时优先提供 remediation；complete_task 时 nextStep 可以为 null。',
    '除 JSON 字段名和枚举值外，所有自然语言内容使用中文。',
    '',
    `评估结果：${JSON.stringify(params.evaluation)}`,
    `工作上下文：${JSON.stringify(params.context)}`
  ].join('\n');
}
