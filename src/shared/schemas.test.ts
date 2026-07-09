import { describe, expect, it } from 'vitest';
import {
  dailyPlanAgentOutputSchema,
  dailyGuideAgentOutputSchema,
  goalIntakeAgentOutputSchema,
  importAgentOutputSchema,
  nextStepDecisionAgentOutputSchema,
  roadmapAgentOutputSchema,
  shortPlanAgentOutputSchema,
  submissionEvaluationAgentOutputSchema
} from './schemas';

describe('AI output schemas', () => {
  it('accepts a valid import-agent output', () => {
    const result = importAgentOutputSchema.parse({
      goals: [
        {
          title: 'Learn TypeScript',
          description: 'Build foundations',
          priority: 3,
          dueDate: null
        }
      ],
      tasks: [
        {
          title: 'Read generics guide',
          description: 'Focus on constraints',
          goalTitle: 'Learn TypeScript',
          priority: 2,
          difficulty: 'foundation',
          estimateMinutes: 30,
          acceptanceCriteria: 'Explain generic constraints',
          dependsOnTitles: []
        }
      ]
    });

    expect(result.tasks[0].estimateMinutes).toBe(30);
  });

  it('rejects an invalid daily plan block duration', () => {
    expect(() =>
      dailyPlanAgentOutputSchema.parse({
        blocks: [
          {
            taskTitle: 'Read generics guide',
            startTime: '20:00',
            endTime: '20:02',
            durationMinutes: 2,
            objective: 'Learn generics',
            action: 'Read and summarize',
            expectedOutput: 'Short note',
            difficulty: 'foundation',
            material: 'Docs',
            successCheck: 'Can explain it',
            fallback: 'Read simpler intro'
          }
        ]
      })
    ).toThrow();
  });

  it('normalizes string fields in submission evaluation output from AI', () => {
    const result = submissionEvaluationAgentOutputSchema.parse({
      result: '通过',
      mastery: '90%',
      evidence: { point: '解释了缓存作用' },
      correctParts: '提到了浏览器缓存和共享缓存',
      misconceptions: '',
      missingRequirements: null,
      feedback: '达到完成标准',
      recommendedAction: '完成任务'
    });

    expect(result.mastery).toBe(90);
    expect(result.result).toBe('passed');
    expect(result.evidence).toEqual(['{"point":"解释了缓存作用"}']);
    expect(result.correctParts).toEqual(['提到了浏览器缓存和共享缓存']);
    expect(result.misconceptions).toEqual([]);
    expect(result.missingRequirements).toEqual([]);
    expect(result.recommendedAction).toBe('complete_task');
  });

  it('normalizes localized next-step decision output from AI', () => {
    const result = nextStepDecisionAgentOutputSchema.parse({
      decision: '完成任务',
      reason: '已达到当前标准',
      taskCompleted: '是',
      nextStep: null,
      remediation: null,
      carryForward: '进入后续练习'
    });

    expect(result.decision).toBe('complete_task');
    expect(result.taskCompleted).toBe(true);
  });

  it('accepts a goal intake result that asks one more focused question', () => {
    const result = goalIntakeAgentOutputSchema.parse({
      status: 'need_more_info',
      reply: '你每天大概能投入多少时间？',
      missingInfo: '可用时间',
      brief: null
    });

    expect(result.missingInfo).toEqual(['可用时间']);
    expect(result.shouldForceStart).toBe(false);
  });

  it('accepts a force-start goal intake result with a brief', () => {
    const result = goalIntakeAgentOutputSchema.parse({
      status: 'ready',
      reply: '我先按当前信息生成一个可执行目标。',
      shouldForceStart: '是',
      missingInfo: [],
      brief: {
        title: '三个月达到初级前端工程师水平',
        targetOutcome: '能完成一个可展示的前端项目并准备求职',
        currentLevel: '会基础 HTML/CSS/JS',
        availableTime: '每天 2 小时',
        deadline: '三个月',
        constraints: '晚上学习，不能大改技术栈',
        successCriteria: ['完成项目', '能讲清主流程']
      }
    });

    expect(result.shouldForceStart).toBe(true);
    expect(result.brief?.constraints).toEqual(['晚上学习，不能大改技术栈']);
  });

  it('accepts layered plan outputs for roadmap, short plan, and daily guide', () => {
    const roadmap = roadmapAgentOutputSchema.parse({
      goalSummary: '先补基础，再做项目。',
      stages: [
        {
          title: '基础补齐',
          objective: '掌握前端基础',
          direction: '用项目倒推基础学习',
          successCriteria: '能独立完成页面'
        }
      ]
    });
    const shortPlan = shortPlanAgentOutputSchema.parse({
      weekFocus: '建立项目主流程理解',
      days: [
        {
          dayIndex: 1,
          title: '梳理项目',
          focus: '理解目录和主流程',
          tasks: ['跑通项目', '写代码地图'],
          expectedOutput: '项目接管文档',
          successCriteria: '能讲清入口和主流程'
        }
      ]
    });
    const guide = dailyGuideAgentOutputSchema.parse({
      date: '2026-07-03',
      todayGoal: '拿到项目接管文档初稿',
      deliverables: ['主流程说明', '代码目录地图'],
      boundaries: ['不做复杂知识图谱'],
      acceptanceCriteria: ['能用 2 分钟讲清项目'],
      tomorrowActions: ['修复最高优先级 bug'],
      tasks: [
        {
          title: '完成项目主流程接管',
          objective: '明确今天产出',
          scope: '只跑通主流程并写出接管文档初稿',
          estimatedMinutes: { min: 35, target: 50, max: 70 },
          actions: [
            { title: '跑通主流程', instruction: '打开应用并按主要路径操作一次', checkpoint: '记录每一步入口' },
            { title: '整理目录', instruction: '查看入口文件和核心服务', checkpoint: '列出关键文件' },
            { title: '写初稿', instruction: '把流程和文件关系写成短文档', checkpoint: '文档可复述主流程' }
          ],
          deliverable: '功能清单',
          doneWhen: ['写出当前已完成能力'],
          quickHint: '只记录主流程截图',
          evaluationMode: 'ai',
          submissionPolicy: 'once_after_task',
          carryoverAllowed: true
        }
      ]
    });

    expect(roadmap.stages).toHaveLength(1);
    expect(shortPlan.days[0].dayIndex).toBe(1);
    expect(guide.tasks[0].title).toBe('完成项目主流程接管');
  });
});
