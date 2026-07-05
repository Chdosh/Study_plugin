import type { GoalBrief, GoalIntakeMessage, PromptProfile, RoadmapStage, ShortPlanDay, StudyWindow } from '../../shared/types';

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
  targetDay: ShortPlanDay;
  previousDayResult?: {
    completedTasks: string[];
    evaluationSummary: string;
    reviewSummary?: string;
  };
  profile: PromptProfile;
}): string {
  const totalMinutes = params.windows.reduce((sum, window) => sum + clockWindowMinutes(window), 0);
  const relevantStages = params.roadmap.slice(0, 2);
  const briefSummary = params.brief
    ? {
        title: params.brief.title,
        targetOutcome: params.brief.targetOutcome,
        currentLevel: params.brief.currentLevel,
        availableTime: params.brief.availableTime,
        deadline: params.brief.deadline,
        constraints: params.brief.constraints,
        successCriteria: params.brief.successCriteria
      }
    : null;

  const previousContext = params.previousDayResult ? [
    '',
    `前一天完成情况：`,
    `已完成任务：${params.previousDayResult.completedTasks.join('；')}`,
    `评价摘要：${params.previousDayResult.evaluationSummary}`,
    params.previousDayResult.reviewSummary ? `复盘摘要：${params.previousDayResult.reviewSummary}` : ''
  ].filter(Boolean).join('\n') : '';

  return [
    params.profile.content,
    '',
    `为 ${params.date} 生成目标学习日执行稿（第 ${params.targetDay.dayIndex} 天：${params.targetDay.title}）。核心原则：任务决定时长，不要先生成固定 ${params.blockMinutes} 分钟时间块。`,
    `今日可用学习时间约 ${totalMinutes} 分钟。`,
    `本日重点：${params.targetDay.focus}`,
    `预期产出：${params.targetDay.expectedOutput}`,
    `成功标准：${params.targetDay.successCriteria}`,
    `主题任务：${params.targetDay.tasks.join('；')}`,
    '输出 JSON 字段：date、todayGoal、deliverables、boundaries、acceptanceCriteria、tomorrowActions、tasks。',
    'tasks 是今日主任务，不是时间块。根据可用时间动态决定数量：30-60 分钟 1-2 个；60-120 分钟 2-3 个；120-180 分钟 2-4 个；180 分钟以上通常不超过 4 个。',
    '每日计划必须预留约 10%-15% 缓冲时间。如果时间不足，减少任务数量或缩小任务范围，不要压缩合理执行时间来塞入更多任务。',
    '每个 task 必须包含 title、objective、scope、estimatedMinutes、actions、deliverable、doneWhen、quickHint、evaluationMode、submissionPolicy、carryoverAllowed。',
    'estimatedMinutes 必须包含 min、target、max，且满足 min <= target <= max。target 是合理完成时间，不是固定倒计时。',
    '每个 task 内部 actions 建议 3 到 6 个，最少 1 个；每个 action 必须包含 title、instruction、checkpoint 三个字段。Action 只作为执行引导和本地检查点，不作为独立提交或 AI 评估单位。',
    'submissionPolicy 默认且只能是 once_after_task。主任务最终提交一次；evaluationMode 可为 local 或 ai。',
    '主任务必须覆盖完整且有意义的学习或产出结果，不能写"学习某知识""完善项目"这种模糊任务。',
    '不要生成复杂知识图谱、账号系统、云同步等偏离目标的内容。',
    '所有自然语言内容使用中文。',
    '',
    '输出示例：',
    '{"date":"2026-07-04","todayGoal":"拿到今日核心产物","deliverables":["产物1"],"boundaries":["不做XXX"],"acceptanceCriteria":["能说明XXX"],"tomorrowActions":["明天先做YYY"],"tasks":[{"title":"完成核心任务","objective":"明确今天产出","scope":"只覆盖必要范围","estimatedMinutes":{"min":25,"target":35,"max":50},"actions":[{"title":"准备环境","instruction":"打开项目并确认可运行","checkpoint":"项目能启动"},{"title":"执行主路径","instruction":"按目标完成核心动作","checkpoint":"有可见产出"}],"deliverable":"可验收的产出","doneWhen":["产物可展示"],"quickHint":"卡住时先记录问题","evaluationMode":"ai","submissionPolicy":"once_after_task","carryoverAllowed":true}]}',
    previousContext,
    `可用学习时间段：${JSON.stringify(params.windows)}`,
    `目标：${JSON.stringify(params.goal)}`,
    `目标理解：${JSON.stringify(briefSummary)}`,
    `相关长期大纲（当前及下一阶段）：${JSON.stringify(relevantStages)}`
  ].filter((line) => line !== '').join('\n');
}

function clockWindowMinutes(window: StudyWindow): number {
  const [startHour, startMinute] = window.start.split(':').map(Number);
  const [endHour, endMinute] = window.end.split(':').map(Number);
  if (Number.isNaN(startHour) || Number.isNaN(startMinute) || Number.isNaN(endHour) || Number.isNaN(endMinute)) {
    return 0;
  }
  return (endHour * 60 + endMinute) - (startHour * 60 + startMinute);
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
