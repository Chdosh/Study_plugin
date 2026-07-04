import { z } from 'zod';

const stringArrayFromAiSchema = z.preprocess((value) => {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === 'string') return item;
      if (item == null) return '';
      if (typeof item === 'number' || typeof item === 'boolean') return String(item);
      return JSON.stringify(item);
    }).filter(Boolean);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  if (typeof value === 'object') return [JSON.stringify(value)];
  return value;
}, z.array(z.string()).default([]));

const percentNumberFromAiSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    const match = value.match(/-?\d+(\.\d+)?/);
    return match ? Number(match[0]) : value;
  }
  return value;
}, z.number().int().min(0).max(100));

const evaluationResultFromAiSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (['passed', 'pass', 'success', 'successful', '通过', '合格', '完成'].includes(normalized)) return 'passed';
  if (['partial', 'partially_passed', 'partially passed', '部分', '部分完成', '基本通过'].includes(normalized)) return 'partial';
  if (['failed', 'fail', 'failure', '未通过', '失败', '不合格'].includes(normalized)) return 'failed';
  if (['unclear', 'unknown', '不确定', '无法判断', '需澄清'].includes(normalized)) return 'unclear';
  return value;
}, z.enum(['passed', 'partial', 'failed', 'unclear']));

const recommendedActionFromAiSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const aliases: Record<string, string> = {
    continue: 'advance',
    next: 'advance',
    next_step: 'advance',
    proceed: 'advance',
    继续: 'advance',
    下一步: 'advance',
    explain: 'explain_again',
    retry_explanation: 'explain_again',
    重新解释: 'explain_again',
    补充讲解: 'explain_again',
    remediation: 'remediate',
    fix: 'remediate',
    补救: 'remediate',
    纠偏: 'remediate',
    exercise: 'practice',
    drill: 'practice',
    练习: 'practice',
    增加练习: 'practice',
    easier: 'simplify',
    simplify_step: 'simplify',
    降低难度: 'simplify',
    简化: 'simplify',
    complete: 'complete_task',
    completed: 'complete_task',
    finish: 'complete_task',
    finish_task: 'complete_task',
    task_complete: 'complete_task',
    完成任务: 'complete_task',
    已完成: 'complete_task',
    ask_user: 'request_user_decision',
    user_decision: 'request_user_decision',
    请求用户决定: 'request_user_decision',
    需要用户决定: 'request_user_decision'
  };
  return aliases[normalized] ?? value;
}, z.enum([
  'advance',
  'explain_again',
  'remediate',
  'practice',
  'simplify',
  'complete_task',
  'request_user_decision'
]));

const booleanFromAiSchema = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'yes', 'y', '1', '是', '已完成', '完成'].includes(normalized)) return true;
    if (['false', 'no', 'n', '0', '否', '未完成', '没有'].includes(normalized)) return false;
  }
  if (typeof value === 'number') return value !== 0;
  return value;
}, z.boolean());

export const studyWindowSchema = z.object({
  start: z.string().min(1),
  end: z.string().min(1)
});

export const importAgentOutputSchema = z.object({
  goals: z.array(
    z.object({
      title: z.string().min(1),
      description: z.string().default(''),
      priority: z.number().int().min(1).max(5).default(3),
      dueDate: z.string().nullable().default(null)
    })
  ),
  tasks: z.array(
    z.object({
      title: z.string().min(1),
      description: z.string().default(''),
      goalTitle: z.string().nullable().default(null),
      priority: z.number().int().min(1).max(5).default(3),
      difficulty: z.enum(['foundation', 'standard', 'advanced', 'exam']).default('foundation'),
      estimateMinutes: z.number().int().min(10).max(480).default(30),
      acceptanceCriteria: z.string().default(''),
      dependsOnTitles: z.array(z.string()).default([])
    })
  )
});

export const dailyPlanAgentOutputSchema = z.object({
  blocks: z.array(
    z.object({
      taskTitle: z.string().nullable().default(null),
      startTime: z.string().min(1),
      endTime: z.string().min(1),
      durationMinutes: z.number().int().min(5).max(120),
      objective: z.string().min(1),
      action: z.string().min(1),
      expectedOutput: z.string().min(1),
      difficulty: z.string().min(1),
      material: z.string().min(1),
      successCheck: z.string().min(1),
      fallback: z.string().min(1)
    })
  )
});

export const looseDailyPlanAgentOutputSchema = z.object({
  blocks: z.array(z.record(z.unknown())).default([])
});

export const evaluationAgentOutputSchema = z.object({
  completionScore: z.number().min(0).max(100),
  focusScore: z.number().min(0).max(100),
  difficultyFit: z.string().min(1),
  delayReason: z.string().default(''),
  nextAction: z.string().min(1)
});

export const reviewAgentOutputSchema = z.object({
  completionScore: z.coerce.number().min(0).max(100),
  focusScore: z.coerce.number().min(0).max(100),
  summary: z.string().min(1),
  nextActions: stringArrayFromAiSchema
});

export const goalBriefSchema = z.object({
  title: z.string().min(1),
  targetOutcome: z.string().min(1),
  currentLevel: z.string().min(1),
  availableTime: z.string().min(1),
  deadline: z.string().default('未明确'),
  constraints: stringArrayFromAiSchema,
  successCriteria: stringArrayFromAiSchema
});

export const goalIntakeAgentOutputSchema = z.object({
  status: z.enum(['need_more_info', 'ready']),
  reply: z.string().min(1),
  brief: goalBriefSchema.nullable().default(null),
  missingInfo: stringArrayFromAiSchema,
  shouldForceStart: booleanFromAiSchema.default(false)
});

export const roadmapAgentOutputSchema = z.object({
  goalSummary: z.string().min(1),
  stages: z.array(
    z.object({
      title: z.string().min(1),
      objective: z.string().min(1),
      direction: z.string().min(1),
      successCriteria: z.string().min(1)
    })
  ).min(1)
});

export const shortPlanAgentOutputSchema = z.object({
  weekFocus: z.string().min(1),
  days: z.array(
    z.object({
      dayIndex: z.number().int().min(1).max(3),
      title: z.string().min(1),
      focus: z.string().min(1),
      tasks: stringArrayFromAiSchema,
      expectedOutput: z.string().min(1),
      successCriteria: z.string().min(1)
    })
  ).min(1).max(3)
});

export const dailyGuideAgentOutputSchema = z.object({
  date: z.string().min(1),
  todayGoal: z.string().min(1),
  deliverables: stringArrayFromAiSchema,
  boundaries: stringArrayFromAiSchema,
  acceptanceCriteria: stringArrayFromAiSchema,
  tomorrowActions: stringArrayFromAiSchema,
  tasks: z.array(
    z.object({
      title: z.string().min(1),
      objective: z.string().min(1),
      scope: z.string().min(1),
      estimatedMinutes: z.object({
        min: z.number().int().min(5).max(360),
        target: z.number().int().min(5).max(480),
        max: z.number().int().min(5).max(600)
      }).refine((value) => value.min <= value.target && value.target <= value.max, {
        message: 'estimatedMinutes 必须满足 min <= target <= max'
      }),
      actions: z.array(
        z.object({
          title: z.string().min(1),
          instruction: z.string().min(1),
          checkpoint: z.string().min(1)
        })
      ).min(1).max(6),
      deliverable: z.string().min(1),
      doneWhen: stringArrayFromAiSchema,
      quickHint: z.string().min(1),
      evaluationMode: z.enum(['local', 'ai']).default('ai'),
      submissionPolicy: z.enum(['once_after_task']).default('once_after_task'),
      carryoverAllowed: booleanFromAiSchema.default(true)
    })
  ).min(1).max(4)
});

export const stageOutlineAgentOutputSchema = z.object({
  goalSummary: z.string().min(1),
  stages: z
    .array(
      z.object({
        title: z.string().min(1),
        objective: z.string().min(1),
        prerequisites: z.string().default(''),
        successCriteria: z.string().min(1)
      })
    )
    .min(1)
});

export const teachStepAgentOutputSchema = z.object({
  title: z.string().min(1),
  objective: z.string().min(1),
  instruction: z.string().min(1),
  explanation: z.string().min(1),
  userAction: z.string().min(1),
  expectedOutput: z.string().min(1),
  successCriteria: z.string().min(1),
  requiresSubmission: z.boolean().default(true)
});

export const answerStepQuestionAgentOutputSchema = z.object({
  answer: z.string().min(1),
  relationToCurrentStep: z.string().min(1),
  example: z.string().default(''),
  resolved: z.boolean().default(false),
  returnToStepInstruction: z.string().min(1),
  resolutionSummary: z.string().default('')
});

export const submissionEvaluationAgentOutputSchema = z.object({
  result: evaluationResultFromAiSchema,
  mastery: percentNumberFromAiSchema,
  evidence: stringArrayFromAiSchema,
  correctParts: stringArrayFromAiSchema,
  misconceptions: stringArrayFromAiSchema,
  missingRequirements: stringArrayFromAiSchema,
  feedback: z.string().min(1),
  recommendedAction: recommendedActionFromAiSchema
});

export const nextStepDecisionAgentOutputSchema = z.object({
  decision: recommendedActionFromAiSchema,
  reason: z.string().min(1),
  taskCompleted: booleanFromAiSchema.default(false),
  nextStep: z
    .object({
      title: z.string().min(1),
      objective: z.string().min(1),
      instruction: z.string().min(1),
      expectedOutput: z.string().min(1),
      successCriteria: z.string().min(1)
    })
    .nullable()
    .default(null),
  remediation: z
    .object({
      title: z.string().min(1),
      instruction: z.string().min(1),
      expectedOutput: z.string().min(1),
      successCriteria: z.string().min(1)
    })
    .nullable()
    .default(null),
  carryForward: z.string().default('')
});

export const stepSummaryAgentOutputSchema = z.object({
  result: z.string().min(1),
  userWork: z.string().min(1),
  mastered: z.array(z.string()).default([]),
  misconceptions: z.array(z.string()).default([]),
  resolvedQuestions: z.array(z.string()).default([]),
  unresolvedQuestions: z.array(z.string()).default([]),
  carryForward: z.string().default('')
});

export type ImportAgentOutput = z.infer<typeof importAgentOutputSchema>;
export type DailyPlanAgentOutput = z.infer<typeof dailyPlanAgentOutputSchema>;
export type LooseDailyPlanAgentOutput = z.infer<typeof looseDailyPlanAgentOutputSchema>;
export type ReviewAgentOutput = z.infer<typeof reviewAgentOutputSchema>;
export type GoalBrief = z.infer<typeof goalBriefSchema>;
export type GoalIntakeAgentOutput = z.infer<typeof goalIntakeAgentOutputSchema>;
export type RoadmapAgentOutput = z.infer<typeof roadmapAgentOutputSchema>;
export type ShortPlanAgentOutput = z.infer<typeof shortPlanAgentOutputSchema>;
export type DailyGuideAgentOutput = z.infer<typeof dailyGuideAgentOutputSchema>;
export type StageOutlineAgentOutput = z.infer<typeof stageOutlineAgentOutputSchema>;
export type TeachStepAgentOutput = z.infer<typeof teachStepAgentOutputSchema>;
export type AnswerStepQuestionAgentOutput = z.infer<typeof answerStepQuestionAgentOutputSchema>;
export type SubmissionEvaluationAgentOutput = z.infer<typeof submissionEvaluationAgentOutputSchema>;
export type NextStepDecisionAgentOutput = z.infer<typeof nextStepDecisionAgentOutputSchema>;
export type StepSummaryAgentOutput = z.infer<typeof stepSummaryAgentOutputSchema>;
