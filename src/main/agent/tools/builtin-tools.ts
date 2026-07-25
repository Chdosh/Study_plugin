import { z } from 'zod';
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

const conversationEvaluationArtifactSchema = z.object({
  mode: z.literal('conversation_response'),
  feedback: z.string().min(1),
  correctParts: z.array(z.string()).default([]),
  misconceptions: z.array(z.string()).default([]),
  nextPrompt: z.string().min(1),
  requiresSubmission: z.boolean()
});

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
  }) => {
    registry.register({
      name: params.name,
      description: params.description,
      contexts: params.contexts,
      inputSchema: params.schema,
      outputSchema: params.schema,
      inputDescription: params.inputDescription,
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
    inputDescription: '{"date":"日期","todayGoal":"目标","deliverables":["产出"],"boundaries":["边界"],"acceptanceCriteria":["标准"],"tomorrowActions":["后续"],"tasks":[{"title":"Task","objective":"目标","scope":"范围","estimatedMinutes":{"min":5,"target":20,"max":30},"actions":[{"title":"Action","instruction":"说明","checkpoint":"检查点"}],"deliverable":"产出","doneWhen":["标准"],"quickHint":"提示","evaluationMode":"ai","submissionPolicy":"once_after_task","carryoverAllowed":true}]}',
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
    inputSchema: z.union([teachingArtifactSchema, answerStepQuestionAgentOutputSchema]),
    inputDescription: JSON.stringify({
      teaching: {
        explanation: '结合当前 Action 和已查询知识给出的中文讲解',
        userAction: '用户接下来可执行的一步',
        requiresSubmission: '是否建议提交成果'
      },
      questionAnswer: {
        answer: '问题答案',
        relationToCurrentStep: '与当前 Action 的关系',
        example: '示例，可为空字符串',
        resolved: '是否已经解决',
        returnToStepInstruction: '返回主线的动作',
        resolutionSummary: '解决摘要，可为空字符串'
      }
    }),
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
    continuation: 'continue'
  });
  registerOutputTool({
    name: 'practice',
    description: '生成当前知识点的可执行练习。',
    contexts: ['study'],
    schema: practiceArtifactSchema,
    inputDescription: '{"explanation":"练习目的","exercise":"练习内容","successCriteria":"完成标准","userAction":"下一步","requiresSubmission":true}',
    effect: 'content'
  });

  registry.register({
    name: 'evaluate',
    description: '评价已保存成果或当前对话中的学习回答。',
    contexts: ['study', 'evaluation'],
    inputSchema: z.union([
      conversationEvaluationArtifactSchema,
      submissionEvaluationAgentOutputSchema
    ]),
    inputDescription: JSON.stringify({
      conversation: {
        mode: 'conversation_response',
        feedback: '即时反馈',
        correctParts: ['正确之处'],
        misconceptions: ['需要纠正之处'],
        nextPrompt: '返回主线的下一步',
        requiresSubmission: false
      },
      submission: {
        result: 'passed|partial|failed|unclear',
        mastery: '0 到 100',
        evidence: ['证据'],
        correctParts: ['正确之处'],
        misconceptions: ['误区'],
        missingRequirements: ['缺失项'],
        feedback: '反馈',
        recommendedAction: '建议动作',
        decision: 'advance|stay|remediate|replan'
      }
    }),
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
