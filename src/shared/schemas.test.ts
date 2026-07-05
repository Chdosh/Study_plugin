import { describe, expect, it } from 'vitest';
import {
  dailyGuideAgentOutputSchema,
  goalIntakeAgentOutputSchema,
  nextStepDecisionAgentOutputSchema,
  roadmapAgentOutputSchema,
  shortPlanAgentOutputSchema,
  submissionEvaluationAgentOutputSchema
} from './schemas';

describe('AI output schemas', () => {
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

  it('accepts a daily guide with minimal actions and up to four tasks', () => {
    const guide = dailyGuideAgentOutputSchema.parse({
      date: '2026-07-04',
      todayGoal: '完成最小可运行产出',
      deliverables: ['产物'],
      boundaries: [],
      acceptanceCriteria: ['有可见产出'],
      tomorrowActions: ['继续下一步'],
      tasks: [
        {
          title: '任务一',
          objective: '验证最小 action 数量',
          scope: '只跑最小路径',
          estimatedMinutes: { min: 10, target: 15, max: 20 },
          actions: [
            { title: '唯一 action', instruction: '执行并记录', checkpoint: '有记录' }
          ],
          deliverable: '记录',
          doneWhen: ['完成记录'],
          quickHint: '先做再说',
          evaluationMode: 'local',
          submissionPolicy: 'once_after_task',
          carryoverAllowed: true
        },
        {
          title: '任务二',
          objective: '占位',
          scope: '占位',
          estimatedMinutes: { min: 10, target: 15, max: 20 },
          actions: [
            { title: 'a', instruction: 'b', checkpoint: 'c' }
          ],
          deliverable: '占位',
          doneWhen: ['占位'],
          quickHint: '占位',
          evaluationMode: 'ai',
          submissionPolicy: 'once_after_task',
          carryoverAllowed: true
        },
        {
          title: '任务三',
          objective: '占位',
          scope: '占位',
          estimatedMinutes: { min: 10, target: 15, max: 20 },
          actions: [
            { title: 'a', instruction: 'b', checkpoint: 'c' }
          ],
          deliverable: '占位',
          doneWhen: ['占位'],
          quickHint: '占位',
          evaluationMode: 'ai',
          submissionPolicy: 'once_after_task',
          carryoverAllowed: true
        },
        {
          title: '任务四',
          objective: '占位',
          scope: '占位',
          estimatedMinutes: { min: 10, target: 15, max: 20 },
          actions: [
            { title: 'a', instruction: 'b', checkpoint: 'c' }
          ],
          deliverable: '占位',
          doneWhen: ['占位'],
          quickHint: '占位',
          evaluationMode: 'ai',
          submissionPolicy: 'once_after_task',
          carryoverAllowed: true
        }
      ]
    });

    expect(guide.tasks).toHaveLength(4);
    expect(guide.tasks[0].actions).toHaveLength(1);
  });

  it('fills missing instruction and checkpoint from action title', () => {
    const guide = dailyGuideAgentOutputSchema.parse({
      date: '2026-07-05',
      todayGoal: '测试默认补齐',
      deliverables: ['产物'],
      boundaries: [],
      acceptanceCriteria: ['有产出'],
      tomorrowActions: [],
      tasks: [
        {
          title: '仅标题的任务',
          objective: '测试 action 只提供 title',
          scope: '最小范围',
          estimatedMinutes: { min: 10, target: 15, max: 20 },
          actions: [
            { title: '唯一动作' }
          ],
          deliverable: '产物',
          doneWhen: ['完成'],
          quickHint: '提示',
          evaluationMode: 'local',
          submissionPolicy: 'once_after_task',
          carryoverAllowed: true
        }
      ]
    });

    const action = guide.tasks[0].actions[0];
    expect(action.title).toBe('唯一动作');
    expect(action.instruction).toBe('执行「唯一动作」');
    expect(action.checkpoint).toBe('完成「唯一动作」');
  });

  it('converts string array actions to full action objects', () => {
    const guide = dailyGuideAgentOutputSchema.parse({
      date: '2026-07-05',
      todayGoal: '测试字符串数组转换',
      deliverables: ['产物'],
      boundaries: [],
      acceptanceCriteria: ['有产出'],
      tomorrowActions: [],
      tasks: [
        {
          title: '字符串 actions 任务',
          objective: '测试 actions 为字符串数组时的转换',
          scope: '最小范围',
          estimatedMinutes: { min: 10, target: 15, max: 20 },
          actions: ['准备环境', '执行主路径', '写初稿'],
          deliverable: '产物',
          doneWhen: ['完成'],
          quickHint: '提示',
          evaluationMode: 'local',
          submissionPolicy: 'once_after_task',
          carryoverAllowed: true
        }
      ]
    });

    expect(guide.tasks[0].actions).toHaveLength(3);
    expect(guide.tasks[0].actions[0].title).toBe('准备环境');
    expect(guide.tasks[0].actions[0].instruction).toBe('执行「准备环境」');
    expect(guide.tasks[0].actions[0].checkpoint).toBe('完成「准备环境」');
    expect(guide.tasks[0].actions[1].title).toBe('执行主路径');
    expect(guide.tasks[0].actions[2].title).toBe('写初稿');
  });

  it('rounds and clamps float mastery in submission evaluation', () => {
    // 85.5 → round to 86
    const r1 = submissionEvaluationAgentOutputSchema.parse({
      result: 'passed',
      mastery: 85.5,
      evidence: [],
      correctParts: [],
      misconceptions: [],
      missingRequirements: [],
      feedback: 'ok',
      recommendedAction: 'advance'
    });
    expect(r1.mastery).toBe(86);

    // 100.8 → round to 101 → clamp to 100
    const r2 = submissionEvaluationAgentOutputSchema.parse({
      result: 'passed',
      mastery: 100.8,
      evidence: [],
      correctParts: [],
      misconceptions: [],
      missingRequirements: [],
      feedback: 'ok',
      recommendedAction: 'advance'
    });
    expect(r2.mastery).toBe(100);

    // -2 → round to -2 → clamp to 0
    const r3 = submissionEvaluationAgentOutputSchema.parse({
      result: 'passed',
      mastery: -2,
      evidence: [],
      correctParts: [],
      misconceptions: [],
      missingRequirements: [],
      feedback: 'ok',
      recommendedAction: 'advance'
    });
    expect(r3.mastery).toBe(0);

    // 85 stays 85
    const r4 = submissionEvaluationAgentOutputSchema.parse({
      result: 'passed',
      mastery: 85,
      evidence: [],
      correctParts: [],
      misconceptions: [],
      missingRequirements: [],
      feedback: 'ok',
      recommendedAction: 'advance'
    });
    expect(r4.mastery).toBe(85);
  });

  it('rejects NaN mastery as invalid', () => {
    expect(() =>
      submissionEvaluationAgentOutputSchema.parse({
        result: 'passed',
        mastery: NaN,
        evidence: [],
        correctParts: [],
        misconceptions: [],
        missingRequirements: [],
        feedback: 'ok',
        recommendedAction: 'advance'
      })
    ).toThrow();
  });

  it('rejects non-numeric string mastery as invalid', () => {
    expect(() =>
      submissionEvaluationAgentOutputSchema.parse({
        result: 'passed',
        mastery: 'abc',
        evidence: [],
        correctParts: [],
        misconceptions: [],
        missingRequirements: [],
        feedback: 'ok',
        recommendedAction: 'advance'
      })
    ).toThrow();
  });

  it('rounds float estimatedMinutes in daily guide', () => {
    const guide = dailyGuideAgentOutputSchema.parse({
      date: '2026-07-05',
      todayGoal: '测试浮点数分钟',
      deliverables: ['产物'],
      boundaries: [],
      acceptanceCriteria: ['有产出'],
      tomorrowActions: [],
      tasks: [
        {
          title: '任务',
          objective: '测试浮点 estimatedMinutes',
          scope: '最小范围',
          estimatedMinutes: { min: 10.3, target: 15.7, max: 20.2 },
          actions: [{ title: 'a', instruction: 'b', checkpoint: 'c' }],
          deliverable: '产物',
          doneWhen: ['完成'],
          quickHint: '提示',
          evaluationMode: 'ai',
          submissionPolicy: 'once_after_task',
          carryoverAllowed: true
        }
      ]
    });
    expect(guide.tasks[0].estimatedMinutes.min).toBe(10);
    expect(guide.tasks[0].estimatedMinutes.target).toBe(16);
    expect(guide.tasks[0].estimatedMinutes.max).toBe(20);
  });

  it('rounds float dayIndex in short plan', () => {
    const plan = shortPlanAgentOutputSchema.parse({
      weekFocus: '测试',
      days: [
        {
          dayIndex: 1.2,
          title: '第一天',
          focus: '测试',
          tasks: ['任务'],
          expectedOutput: '产出',
          successCriteria: '标准'
        }
      ]
    });
    expect(plan.days[0].dayIndex).toBe(1);
  });

  it('rejects estimatedMinutes that violate min <= target <= max', () => {
    expect(() =>
      dailyGuideAgentOutputSchema.parse({
        date: '2026-07-04',
        todayGoal: '测试',
        deliverables: ['产物'],
        boundaries: [],
        acceptanceCriteria: ['有产出'],
        tomorrowActions: [],
        tasks: [
          {
            title: '任务',
            objective: '测试时间顺序',
            scope: '测试',
            estimatedMinutes: { min: 30, target: 20, max: 40 },
            actions: [{ title: 'a', instruction: 'b', checkpoint: 'c' }],
            deliverable: '产物',
            doneWhen: ['完成'],
            quickHint: '提示',
            evaluationMode: 'ai',
            submissionPolicy: 'once_after_task',
            carryoverAllowed: true
          }
        ]
      })
    ).toThrow();
  });
});
