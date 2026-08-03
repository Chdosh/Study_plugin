import { z } from 'zod';
import { describeZodSchema } from '../schema-description';
import {
  answerStepQuestionAgentOutputSchema,
  dailyGuideAgentOutputSchema,
  goalIntakeAgentOutputSchema,
  roadmapAgentOutputSchema,
  reviewAgentOutputSchema,
  shortPlanAgentOutputSchema,
  submissionEvaluationAgentOutputSchema
} from '../../../shared/schemas';
import type { DailyGuideAction, KnowledgeItem } from '../../../shared/types';
import type {
  AgentContextKind,
  AgentToolEffect,
  AgentToolName,
  AskUserRequest
} from '../agent-types';
import { ToolRegistry } from '../tool-registry';

const teachingArtifactSchema = z.object({
  explanation: z.string().min(1),
  keyPoints: z.array(z.string().min(1)).default([]),
  example: z.string().default(''),
  commonMistake: z.string().default(''),
  checkQuestion: z.string().default(''),
  userAction: z.string().min(1),
  requiresSubmission: z.boolean()
});

const quizArtifactSchema = z.object({
  explanation: z.string().min(1),
  questions: z.array(z.object({
    prompt: z.string().min(1),
    answerFormat: z.string().min(1),
    hint: z.string().optional()
  })).min(1).max(5),
  userAction: z.string().min(1),
  requiresSubmission: z.boolean()
});

const practiceArtifactSchema = z.object({
  explanation: z.string().min(1),
  exercise: z.string().min(1),
  successCriteria: z.string().min(1),
  userAction: z.string().min(1),
  requiresSubmission: z.boolean()
});

const teachingFallbackSchema = z.object({
  explanation: z.string().default('本次讲解未能生成完整内容，请先阅读当前步骤的说明。'),
  keyPoints: z.array(z.string()).default([]),
  example: z.string().default(''),
  commonMistake: z.string().default(''),
  checkQuestion: z.string().default(''),
  userAction: z.string().default('继续当前学习步骤。'),
  requiresSubmission: z.boolean().default(false)
});

const quizFallbackSchema = z.object({
  explanation: z.string().default('检查你对当前内容的理解。'),
  questions: z.array(z.object({
    prompt: z.string().default('请用自己的话复述刚才讲解的核心概念。'),
    answerFormat: z.string().default('自由作答')
  })).default([{
    prompt: '请用自己的话复述刚才讲解的核心概念。',
    answerFormat: '自由作答'
  }]),
  userAction: z.string().default('请回答上面的问题，然后继续本轮学习。'),
  requiresSubmission: z.boolean().default(false)
});

const practiceFallbackSchema = z.object({
  explanation: z.string().default('练习当前内容。'),
  exercise: z.string().default('根据当前步骤的说明完成一个最小可验证的练习。'),
  successCriteria: z.string().default('练习结果可被检查或记录。'),
  userAction: z.string().default('完成练习后提交结果。'),
  requiresSubmission: z.boolean().default(true)
});

const conversationEvaluationArtifactSchema = z.object({
  mode: z.literal('conversation_response'),
  feedback: z.string().min(1),
  correctParts: z.array(z.string()).default([]),
  misconceptions: z.array(z.string()).default([]),
  nextPrompt: z.string().min(1),
  requiresSubmission: z.boolean()
});

type ExplainToolInput =
  | z.infer<typeof teachingArtifactSchema>
  | z.infer<typeof answerStepQuestionAgentOutputSchema>;
type EvaluationToolInput =
  | z.infer<typeof conversationEvaluationArtifactSchema>
  | z.infer<typeof submissionEvaluationAgentOutputSchema>;

const explainToolInputSchema = z.preprocess(
  (value) => unwrapTaggedVariant(value, ['teaching', 'questionAnswer']),
  z.union([teachingArtifactSchema, answerStepQuestionAgentOutputSchema])
) as z.ZodType<ExplainToolInput>;

const evaluationToolInputSchema = z.preprocess(
  (value) => unwrapTaggedVariant(value, ['conversation', 'submission']),
  z.union([
    conversationEvaluationArtifactSchema,
    submissionEvaluationAgentOutputSchema
  ])
) as z.ZodType<EvaluationToolInput>;

const askUserRequestSchema = z.object({
  question: z.string().min(1),
  reason: z.string().min(1),
  answerMode: z.enum(['free_text', 'single_choice']),
  options: z.array(z.string().min(1)).optional(),
  canSkip: z.boolean(),
  intent: z.string().min(1)
});

export function createBuiltinToolRegistry(
  searchKnowledge: (params: {
    goalId: string;
    query?: string;
    limit?: number;
  }) => Promise<KnowledgeItem[]>,
  insertGuideSupplement: (params: {
    title: string;
    instruction: string;
    checkpoint: string;
    sourceAiReviewId: string;
    expectedContextVersion: number;
  }) => Promise<DailyGuideAction>
): ToolRegistry {
  const registry = new ToolRegistry();

  const registerOutputTool = (params: {
    name: AgentToolName;
    description: string;
    contexts: AgentContextKind[];
    schema: z.ZodTypeAny;
    inputDescription: string;
    effect: AgentToolEffect;
    continuation?: 'continue' | 'complete' | 'pause';
    requestUser?: (output: any) => AskUserRequest | undefined;
    fallback?: z.ZodTypeAny;
  }) => {
    registry.register({
      name: params.name,
      description: params.description,
      contexts: params.contexts,
      inputSchema: params.schema,
      outputSchema: params.schema,
      fallbackSchema: params.fallback,
      inputDescription: withSchemaContract(params.inputDescription, params.schema),
      effect: params.effect,
      continuation: params.continuation ?? 'complete',
      execute: async (input) => ({
        output: input,
        requestUser: params.requestUser?.(input)
      })
    });
  };

  registerOutputTool({
    name: 'propose_goal',
    description: '澄清并形成用户学习目标。',
    contexts: ['goal_intake'],
    schema: goalIntakeAgentOutputSchema,
    inputDescription: '{"status":"need_more_info|ready","reply":"中文回复","brief":null 或目标简报对象}',
    effect: 'proposal',
    requestUser: (output) => output.status === 'need_more_info'
      ? {
          question: output.reply,
          reason: '继续目标澄清需要用户补充关键信息。',
          answerMode: 'free_text',
          canSkip: true,
          intent: 'continue_goal_intake'
        }
      : undefined
  });
  registerOutputTool({
    name: 'propose_roadmap',
    description: '根据已确认目标提出阶段学习路径；有截止日期时只为阶段设置少量检查点日期。',
    contexts: ['planning'],
    schema: roadmapAgentOutputSchema,
    inputDescription: '{"goalSummary":"目标摘要","stages":[{"title":"阶段","objective":"目标","direction":"方向","successCriteria":"标准","targetDate":"YYYY-MM-DD 或 null"}]}',
    effect: 'proposal'
  });
  registerOutputTool({
    name: 'propose_short_plan',
    description: '生成初始或滚动的近期学习安排。',
    contexts: ['planning'],
    schema: shortPlanAgentOutputSchema,
    inputDescription: '{"weekFocus":"近期重点","items":[{"itemIndex":1,"roadmapStagePosition":1,"title":"单元","focus":"重点","tasks":["任务"],"expectedOutput":"产出","successCriteria":"标准"}]}',
    effect: 'proposal'
  });
  registerOutputTool({
    name: 'prepare_learning_guide',
    description: '把近期学习单元展开为当前可执行内容。',
    contexts: ['planning', 'study'],
    schema: dailyGuideAgentOutputSchema,
    inputDescription: '{"date":"日期","todayGoal":"目标","deliverables":["产出"],"boundaries":["边界"],"acceptanceCriteria":["标准"],"tomorrowActions":["后续"],"tasks":[{"title":"Task","objective":"目标","scope":"范围","estimatedMinutes":{"min":5,"target":20,"max":30},"actions":[{"title":"Action","instruction":"说明","checkpoint":"检查点"}],"deliverable":"产出","doneWhen":["标准"],"quickHint":"提示","evaluationMode":"ai"}]}',
    effect: 'proposal'
  });
  registerOutputTool({
    name: 'reflect',
    description: '根据已保存学习事实生成阶段复盘。',
    contexts: ['review'],
    schema: reviewAgentOutputSchema,
    inputDescription: '{"completionScore":0到100,"focusScore":0到100,"summary":"复盘","nextActions":["下一步"],"planAdjustments":[]}',
    effect: 'content'
  });

  registry.register({
    name: 'explain',
    description: '讲解当前内容或回答当前学习问题。',
    contexts: ['study'],
    inputSchema: explainToolInputSchema,
    fallbackSchema: teachingFallbackSchema,
    inputDescription: withSchemaContract(
      [
        '只直接返回下面两种业务对象之一，不要添加 teaching、questionAnswer 或其他包装层：',
        '回答用户问题时返回 {"answer":"问题答案，讲解要具体并配例子","relationToCurrentStep":"与当前 Action 的关系","example":"可选示例","resolved":true,"returnToStepInstruction":"返回主线的动作","resolutionSummary":"可选摘要"}；',
        '主动讲解时返回 {"explanation":"结合当前 Action 的中文讲解，先讲核心概念，再给具体例子","keyPoints":["2-4 个要点"],"example":"一个具体例子，必须有","commonMistake":"常见误区，可选","checkQuestion":"一个小问题让用户自测理解，可选","userAction":"用户接下来可执行的一步","requiresSubmission":false}。',
        '讲解要像真人导师：用大白话、例子先行、一次只讲一个核心概念，不要输出模板化套话。'
      ].join(''),
      explainToolInputSchema
    ),
    effect: 'content',
    continuation: 'complete',
    execute: async (input) => ({
      output: 'answer' in input
        ? answerStepQuestionAgentOutputSchema.parse(input)
        : teachingArtifactSchema.parse(input)
    })
  });

  registerOutputTool({
    name: 'quiz',
    description: '生成用于检查理解的小测。',
    contexts: ['study'],
    schema: quizArtifactSchema,
    inputDescription: '{"explanation":"检查目的","questions":[{"prompt":"题目","answerFormat":"作答格式","hint":"可选提示"}],"userAction":"如何作答","requiresSubmission":false}',
    effect: 'content',
    continuation: 'continue',
    fallback: quizFallbackSchema
  });
  registerOutputTool({
    name: 'practice',
    description: '生成当前知识点的可执行练习。',
    contexts: ['study'],
    schema: practiceArtifactSchema,
    inputDescription: '{"explanation":"练习目的","exercise":"练习内容","successCriteria":"完成标准","userAction":"下一步","requiresSubmission":true}',
    effect: 'content',
    fallback: practiceFallbackSchema
  });

  registry.register({
    name: 'evaluate',
    description: '评价已保存成果或当前对话中的学习回答。',
    contexts: ['study', 'evaluation'],
    inputSchema: evaluationToolInputSchema,
    inputDescription: [
      '只直接返回下面两种业务对象之一，不要添加 conversation、submission 或其他包装层：',
      '评价对话回答时返回 {"mode":"conversation_response","feedback":"即时反馈","correctParts":[],"misconceptions":[],"nextPrompt":"返回主线的下一步","requiresSubmission":false}；',
      '评价正式提交时返回 {"result":"passed|partial|failed|unclear","evidence":[],"correctParts":[],"misconceptions":[],"missingRequirements":[],"feedback":"反馈","recommendedAction":"passed 时只能为 advance 或 complete_task；其他结果不能推荐完成"}。'
    ].join(''),
    effect: 'content',
    continuation: 'complete',
    execute: async (input) => ({
      output: 'mode' in input && input.mode === 'conversation_response'
        ? conversationEvaluationArtifactSchema.parse(input)
        : submissionEvaluationAgentOutputSchema.parse(input)
    })
  });

  registry.register({
    name: 'search_kb',
    description: '查询与当前目标相关的个人知识记录。',
    contexts: ['goal_intake', 'planning', 'study', 'evaluation', 'review', 'knowledge'],
    inputSchema: z.object({
      query: z.string().min(1).optional(),
      limit: z.number().int().min(1).max(20).optional()
    }),
    inputDescription: '{"query":"可选关键词","limit":"可选，1 到 20"}；不要提供 Goal ID。',
    effect: 'read',
    continuation: 'continue',
    execute: async (input, context) => ({
      output: context.goalId
        ? await searchKnowledge({
            goalId: context.goalId,
            query: input.query,
            limit: input.limit
          })
        : []
    })
  });

  registry.register({
    name: 'ask_user',
    description: '暂停当前 Run，向用户询问继续所必需的信息。',
    contexts: ['goal_intake', 'planning', 'study', 'evaluation', 'review', 'knowledge'],
    inputSchema: askUserRequestSchema,
    outputSchema: askUserRequestSchema,
    inputDescription: '{"question":"一个必要问题","reason":"询问原因","answerMode":"free_text|single_choice","options":["单选项"],"canSkip":true,"intent":"恢复意图"}',
    effect: 'pause',
    continuation: 'pause',
    execute: async (input) => ({ output: input })
  });

  registry.register({
    name: 'insert_guide_supplement',
    description: '把临时解释、示例、微练习或复习插入当前 Guide；不创建正式 Task。',
    contexts: ['study'],
    inputSchema: z.object({
      kind: z.enum(['explanation', 'example', 'micro_practice', 'review']),
      title: z.string().min(1).max(80),
      instruction: z.string().min(1),
      checkpoint: z.string().min(1),
      reason: z.string().min(1)
    }),
    inputDescription: '{"kind":"explanation|example|micro_practice|review","title":"标题","instruction":"补充内容","checkpoint":"检查点","reason":"插入原因"}；不要提供任何数据库 ID。',
    effect: 'authorized_write',
    continuation: 'complete',
    execute: async (input, context) => {
      if (!context.toolReviewId) {
        throw new Error('临时补充工具缺少可信的 toolReviewId。');
      }
      const action = await insertGuideSupplement({
        title: input.title,
        instruction: input.instruction,
        checkpoint: input.checkpoint,
        sourceAiReviewId: context.toolReviewId,
        expectedContextVersion: context.contextVersion
      });
      return {
        output: {
          action,
          explanation: input.reason,
          userAction: input.instruction,
          requiresSubmission: false
        }
      };
    }
  });

  return registry;
}

function unwrapTaggedVariant(value: unknown, keys: string[]): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const nested = record[key];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) return nested;
  }
  return value;
}

function withSchemaContract(inputDescription: string, schema: z.ZodTypeAny): string {
  const contract = describeZodSchema(schema);
  if (!contract) return inputDescription;
  return `${inputDescription}\n业务对象结构（字段名必须精确匹配，类型与必填以此为准）：\n${contract}`;
}
