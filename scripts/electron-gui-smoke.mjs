import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import electronPath from 'electron';

function buildSmokeExpression(aiConfig) {
  const serializedSettings = JSON.stringify({
    deepseekBaseUrl: aiConfig.baseUrl,
    deepseekModel: aiConfig.model,
    deepseekApiKey: aiConfig.apiKey,
    defaultBlockMinutes: 10,
    dailyStudyWindows: [{ start: '20:00', end: '20:30' }]
  });
  return `
    (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const defaultTimeout = ${aiConfig.waitMs};
      const smokeGoalTitle = '掌握概念 A 与概念 B 的区别';
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      async function waitFor(check, label, timeout = defaultTimeout) {
        const started = Date.now();
        let lastValue;
        while (Date.now() - started < timeout) {
          lastValue = await check();
          if (lastValue) return lastValue;
          await sleep(150);
        }
        if (label === 'review view' || label.includes('submission input') || label.includes('submission evaluated')) {
          const text = (document.body.textContent || '').replace(/\\s+/g, ' ').slice(0, 800);
          const buttons = [...document.querySelectorAll('button')]
            .map((button) => (button.textContent || '').replace(/\\s+/g, ' ').trim())
            .filter(Boolean)
            .slice(0, 12);
          throw new Error('Timeout waiting for ' + label + ': ' + JSON.stringify({ text, buttons }));
        }
        throw new Error('Timeout waiting for ' + label + ': ' + JSON.stringify(lastValue));
      }
      function setValue(selector, value) {
        const element = document.querySelector(selector);
        if (!element) throw new Error('Missing element: ' + selector);
        const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
        descriptor?.set?.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
      }
      function clickText(text) {
        const candidates = [...document.querySelectorAll('button')]
          .filter((item) => (item.textContent || '').replace(/\\s+/g, '').includes(text));
        const button = candidates.find((item) => !item.disabled) ?? candidates[0];
        if (!button) throw new Error('Missing button text: ' + text);
        if (button.disabled) throw new Error('Button disabled: ' + text);
        button.click();
      }
      function hasEnabledButton(text) {
        return [...document.querySelectorAll('button')]
          .some((item) => (item.textContent || '').replace(/\\s+/g, '').includes(text) && !item.disabled);
      }
      function clickLabel(label) {
        const button = document.querySelector('button[aria-label="' + label + '"]');
        if (!button) throw new Error('Missing aria button: ' + label);
        button.click();
      }
      async function runLearningRound(params) {
        await waitFor(() => [...document.querySelectorAll('button')]
          .some((item) => (item.textContent || '').replace(/\\s+/g, '').includes('开始') && !item.disabled), params.label + ' start button');

        clickText('开始');
        await waitFor(async () => window.studyApp.sessions.getActive(), params.label + ' active session');
        await waitFor(() => [...document.querySelectorAll('button')]
          .some((item) => (item.textContent || '').replace(/\\s+/g, '').includes('展开当前步骤')), params.label + ' study controls rendered');
        clickText('展开当前步骤');
        await waitFor(async () => {
          const state = await window.studyApp.learning.getState();
          return state.step?.status === 'waiting_for_submission' ? state : null;
        }, params.label + ' step taught');

        setValue('input[aria-label="针对当前步骤提问"]', params.question);
        clickLabel('发送问题');
        await waitFor(async () => {
          const state = await window.studyApp.learning.getState();
          if (state.state.activeQuestionThreadId === null && state.step) return state;
          if (state.questionThread?.status === 'open' && document.body.textContent.includes('问题已解决，回到主线')) {
            clickText('问题已解决，回到主线');
          }
          return null;
        }, params.label + ' question resolved');

        let latestState = await window.studyApp.learning.getState();
        for (let attempt = 0; attempt < 6; attempt++) {
          if (!latestState.step) throw new Error(params.label + ' missing step before submission');
          if (latestState.step.status === 'active') {
            clickText('展开当前步骤');
            latestState = await waitFor(async () => {
              const state = await window.studyApp.learning.getState();
              return state.step?.status === 'waiting_for_submission' ? state : null;
            }, params.label + ' step taught ' + attempt);
          }

          const stepIdBeforeSubmit = latestState.step.id;
          await waitFor(() => document.querySelector('textarea[aria-label="提交学习结果"]'), params.label + ' submission input');
          setValue('textarea[aria-label="提交学习结果"]', params.submission);
          clickText('提交并评估');
          latestState = await waitFor(async () => {
            const state = await window.studyApp.learning.getState();
            if (state.state.sessionStatus === 'completed') return state;
            if (state.latestEvaluation?.stepId === stepIdBeforeSubmit) return state;
            if (state.step?.id && state.step.id !== stepIdBeforeSubmit) return state;
            return null;
          }, params.label + ' submission evaluated');

          if (latestState.state.sessionStatus === 'completed') break;
          if (latestState.step?.id === stepIdBeforeSubmit) {
            throw new Error(params.label + ' did not advance or complete after evaluation');
          }
        }

        if (latestState.state.sessionStatus !== 'completed') {
          const text = (document.body.textContent || '').replace(/\\s+/g, ' ').slice(0, 1000);
          throw new Error(params.label + ' did not complete task within step limit: ' + JSON.stringify({ text }));
        }

        clickText('结束学习');
        const completed = await waitFor(async () => {
          const state = await window.studyApp.learning.getState();
          return state.state.sessionStatus === 'completed' ? state : null;
        }, params.label + ' session completed');
        return completed;
      }
      async function generateAndConfirmPlan(label) {
        await waitFor(() => hasEnabledButton('生成今日草稿'), label + ' generate plan button');
        clickText('生成今日草稿');
        const draft = await waitFor(async () => {
          const plans = await window.studyApp.plans.list(today);
          return plans.find((plan) => plan.status === 'draft') || null;
        }, label + ' draft plan');
        await waitFor(() => hasEnabledButton('确认草稿'), label + ' confirm draft button');
        clickText('确认草稿');
        await waitFor(async () => {
          const plans = await window.studyApp.plans.list(today);
          return plans.find((plan) => plan.id === draft.id && plan.status === 'confirmed') || null;
        }, label + ' confirmed plan');
        return draft;
      }

      await waitFor(() => window.studyApp, 'preload api');
      await window.studyApp.settings.update(${serializedSettings});
      clickLabel('搜索');
      await sleep(500);

      clickText('计划');
      await waitFor(() => document.querySelector('input[aria-label="学习目标标题"]'), 'plan view');
      setValue('input[aria-label="学习目标标题"]', smokeGoalTitle);
      setValue('textarea[aria-label="学习目标描述"]', '只学习概念 A 与概念 B 的含义、区别和适用场景，用两个例子验证。不要扩展成完整课程。');
      clickText('保存目标');
      const goal = await waitFor(async () => {
        const goals = await window.studyApp.goals.list();
        return goals.find((item) => item.title === smokeGoalTitle) || null;
      }, 'goal created');
      await waitFor(() => document.body.textContent.includes(smokeGoalTitle), 'goal rendered');

      clickText('生成阶段路线');
      await waitFor(async () => {
        const stages = await window.studyApp.goals.listStages(goal.id);
        return stages.some((stage) => stage.status === 'proposed');
      }, 'stage proposed');
      await waitFor(() => hasEnabledButton('确认阶段路线'), 'confirm stage button');
      clickText('确认阶段路线');
      await waitFor(async () => {
        const stages = await window.studyApp.goals.listStages(goal.id);
        return stages.some((stage) => stage.status === 'active');
      }, 'stage confirmed');
      await waitFor(() => document.body.textContent.includes('当前阶段'), 'active stage rendered');

      await generateAndConfirmPlan('first');
      const firstCompleted = await runLearningRound({
        label: 'first',
        question: '概念 A 是完全禁止复用吗？',
        submission: '概念 A 允许在满足条件后复用；概念 B 强调长期稳定且可直接复用。'
      });

      await waitFor(() => document.body.textContent.includes('学习结束结算'), 'settlement view');
      await waitFor(() => [...document.querySelectorAll('button')]
        .some((item) => (item.textContent || '').replace(/\\s+/g, '').includes('保存结算并进入复盘') && !item.disabled), 'settlement save button');
      clickText('保存结算并进入复盘');
      await waitFor(() => document.body.textContent.includes('今日复盘'), 'review view');
      await waitFor(async () => {
        const state = await window.studyApp.learning.getState();
        return state.pendingAdjustment?.status === 'pending' ? state.pendingAdjustment : null;
      }, 'pending adjustment before decision');
      clickText('确认调整');
      const acceptedAdjustment = await waitFor(async () => {
        const tasks = await window.studyApp.tasks.list();
        return tasks.find((task) => task.title.startsWith('跟进：') && task.status === 'backlog') || null;
      }, 'follow-up task created');

      clickText('去计划页生成新草稿');
      await waitFor(() => document.querySelector('input[aria-label="学习目标标题"]'), 'plan view after review');
      const secondDraft = await generateAndConfirmPlan('second');
      const secondPlanBlocks = await window.studyApp.plans.list(today).then((plans) => {
        const plan = plans.find((item) => item.id === secondDraft.id);
        return plan?.blocks ?? [];
      });
      if (!secondPlanBlocks.some((block) => block.taskId === acceptedAdjustment.id)) {
        throw new Error('Second plan did not include accepted follow-up task.');
      }

      const secondCompleted = await runLearningRound({
        label: 'second',
        question: '第二个例子也应该使用概念 A 吗？',
        submission: '频繁变化的材料适合概念 A；稳定且有版本标识的材料适合概念 B。'
      });

      const restored = await window.studyApp.learning.getState();
      if (restored.goal?.id !== goal.id || restored.state.activeGoalId !== goal.id) {
        throw new Error('Learning state did not keep active goal after two rounds.');
      }
      if (restored.state.sessionStatus !== 'completed') {
        throw new Error('Learning state did not persist completed status after second round.');
      }

      return {
        ok: true,
        goalTitle: secondCompleted.goal?.title || firstCompleted.goal?.title,
        stepTitle: secondCompleted.step?.title || firstCompleted.step?.title,
        sessionStatus: restored.state.sessionStatus,
        rounds: 2,
        followUpTask: acceptedAdjustment.title,
        activeGoalId: restored.state.activeGoalId
      };
    })()
  `;
}

function buildActiveIntakeSmokeExpression(aiConfig) {
  const serializedSettings = JSON.stringify({
    deepseekBaseUrl: aiConfig.baseUrl,
    deepseekModel: aiConfig.model,
    deepseekApiKey: aiConfig.apiKey,
    defaultBlockMinutes: 30,
    dailyStudyWindows: [{ start: '20:00', end: '21:30' }]
  });
  return `
    (async () => {
      const defaultTimeout = ${aiConfig.waitMs};
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      async function waitFor(check, label, timeout = defaultTimeout) {
        const started = Date.now();
        let lastValue;
        while (Date.now() - started < timeout) {
          lastValue = await check();
          if (lastValue) return lastValue;
          await sleep(150);
        }
        const text = (document.body.textContent || '').replace(/\\s+/g, ' ').slice(0, 1000);
        const buttons = [...document.querySelectorAll('button')]
          .map((button) => (button.textContent || '').replace(/\\s+/g, ' ').trim())
          .filter(Boolean)
          .slice(0, 16);
        throw new Error('Timeout waiting for ' + label + ': ' + JSON.stringify({ text, buttons, lastValue }));
      }
      function setValue(selector, value) {
        const element = document.querySelector(selector);
        if (!element) throw new Error('Missing element: ' + selector);
        const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
        descriptor?.set?.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
      }
      function clickText(text) {
        const candidates = [...document.querySelectorAll('button')]
          .filter((item) => (item.textContent || '').replace(/\\s+/g, '').includes(text));
        const button = candidates.find((item) => !item.disabled) ?? candidates[0];
        if (!button) throw new Error('Missing button text: ' + text);
        if (button.disabled) throw new Error('Button disabled: ' + text);
        button.click();
      }
      async function getTodayGuide() {
        return window.studyApp.guides.listToday();
      }

      await waitFor(() => window.studyApp, 'preload api');
      await window.studyApp.settings.update(${serializedSettings});
      document.querySelector('button[aria-label="搜索"]')?.click();
      await sleep(500);
      await waitFor(() => document.querySelector('textarea[aria-label="输入学习目标"]'), 'active intake textarea');

      setValue('textarea[aria-label="输入学习目标"]', '我想三个月内达到初级前端工程师水平，每天晚上有 2 小时，优先把现有项目变成能求职展示的作品。');
      clickText('发送');
      await waitFor(async () => {
        const state = await window.studyApp.onboarding.getCurrent();
        return state.intake.status === 'ready' && state.intake.brief ? state : null;
      }, 'goal intake ready');

      clickText('确认目标并生成计划');
      const generated = await waitFor(async () => {
        const state = await getTodayGuide();
        return state.guide?.blocks?.length ? state : null;
      }, 'layered daily guide generated');

      if (!generated.guide.blocks.some((block) => block.title === '整理代码地图')) {
        throw new Error('Expected folded second guide block.');
      }

      await waitFor(() => [...document.querySelectorAll('button')]
        .some((item) => (item.textContent || '').replace(/\\s+/g, '').includes('确认并开始') && !item.disabled), 'confirm and start button rendered');
      clickText('确认并开始');
      await waitFor(async () => {
        const state = await getTodayGuide();
        return state.guide?.status === 'confirmed' ? state : null;
      }, 'daily guide confirmed');

      await waitFor(async () => window.studyApp.sessions.getActive(), 'active session started');
      await waitFor(() => document.body.textContent.includes('今日步骤进度'), 'study page after confirm and start');
      clickText('结束');
      await waitFor(() => document.body.textContent.includes('学习结束结算'), 'settlement after ending focus session');
      const ended = await waitFor(async () => {
        const state = await getTodayGuide();
        return state.guide?.blocks?.[0] ? state : null;
      }, 'current guide block preserved after focus session end');

      return {
        ok: true,
        goalTitle: ended.goal?.title,
        guideId: ended.guide?.id,
        firstBlockStatus: ended.guide?.blocks?.[0]?.status,
        taskCount: ended.guide?.tasks?.length,
        blockCount: ended.guide?.blocks?.length,
        activeGoalId: ended.goal?.id
      };
    })()
  `;
}

function buildRestoreExpression() {
  return `
    (async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      async function waitFor(check, label, timeout = 20000) {
        const started = Date.now();
        let lastValue;
        while (Date.now() - started < timeout) {
          lastValue = await check();
          if (lastValue) return lastValue;
          await sleep(150);
        }
        throw new Error('Timeout waiting for ' + label + ': ' + JSON.stringify(lastValue));
      }
      await waitFor(() => window.studyApp, 'preload api after restart');
      const state = await waitFor(async () => {
        const snapshot = await window.studyApp.guides.listToday();
        return snapshot.goal && snapshot.guide?.blocks?.[0] ? snapshot : null;
      }, 'restored daily guide');
      return {
        ok: true,
        goalTitle: state.goal.title,
        guideId: state.guide.id,
        firstBlockStatus: state.guide.blocks[0].status,
        taskCount: state.guide.tasks.length,
        activeGoalId: state.goal.id
      };
    })()
  `;
}

function startFakeAiServer() {
  const server = createServer(async (req, res) => {
    try {
      if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
        res.writeHead(404).end();
        return;
      }
      const body = JSON.parse(await readRequest(req));
      const system = body.messages?.find((message) => message.role === 'system')?.content ?? '';
      const user = body.messages?.find((message) => message.role === 'user')?.content ?? '';
      const output = fakeAiOutput(system, user);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }));
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}/v1`
      });
    });
  });
}

function fakeAiOutput(system, user) {
  if (system.includes('goal-intake-agent')) {
    return {
      status: 'ready',
      reply: '我理解你的目标是三个月内达到初级前端工程师水平，并把现有项目整理成可求职展示的作品。',
      missingInfo: [],
      shouldForceStart: false,
      brief: {
        title: '三个月达到初级前端工程师水平',
        targetOutcome: '能完成并讲清一个可展示项目，用于求职面试',
        currentLevel: '有基础开发经验，需要系统接管项目和补齐工程表达',
        availableTime: '每天晚上 2 小时',
        deadline: '三个月',
        constraints: ['不换技术栈', '优先项目演示和面试表达'],
        successCriteria: ['能讲清主流程', '有 README 初稿', '能展示稳定场景']
      }
    };
  }
  if (system.includes('generate-roadmap-agent')) {
    return {
      goalSummary: '围绕现有项目，补齐工程理解、演示稳定性和面试表达。',
      stages: [
        {
          title: '项目接管基础',
          objective: '跑通项目并理解主流程',
          direction: '先掌握现有代码结构，再做小修小补',
          successCriteria: '能用 2 分钟讲清项目'
        },
        {
          title: '演示稳定性',
          objective: '修复影响展示的问题',
          direction: '只修会影响演示可信度的 bug',
          successCriteria: '能稳定展示 3 个核心场景'
        }
      ]
    };
  }
  if (system.includes('generate-short-plan-agent')) {
    return {
      weekFocus: '把项目变成可讲、可演示的资产',
      days: [
        {
          dayIndex: 1,
          title: '跑通并梳理项目',
          focus: '建立项目所有权',
          tasks: ['跑一遍主流程', '写代码地图'],
          expectedOutput: '项目接管文档初稿',
          successCriteria: '能说清入口和主流程'
        },
        {
          dayIndex: 2,
          title: '修演示级问题',
          focus: '只修影响演示的问题',
          tasks: ['做验收清单', '修最高优先级 bug'],
          expectedOutput: 'bug 清单和修复顺序',
          successCriteria: '能稳定演示核心流程'
        },
        {
          dayIndex: 3,
          title: '准备面试表达',
          focus: '把项目讲清楚',
          tasks: ['写 README 初稿', '写面试问答'],
          expectedOutput: 'README 和问答初稿',
          successCriteria: '能口述项目价值和实现链路'
        }
      ]
    };
  }
  if (system.includes('generate-daily-guide-agent')) {
    return {
      date: new Date().toISOString().slice(0, 10),
      todayGoal: '今天把项目从“功能做过”推进到“能讲、能演示”。',
      deliverables: ['主流程说明', '代码目录地图'],
      boundaries: ['不做复杂知识图谱', '不大改 UI', '不换技术栈'],
      acceptanceCriteria: ['能用 2 分钟讲清项目', '能指出核心文件职责'],
      tomorrowActions: ['修最高优先级 bug', '录制 60 秒演示', '补 README 运行方式', '整理面试问答', '投递 10 个岗位'],
      tasks: [
        {
          title: '锁定今天边界',
          objective: '明确今天只做接管和文档',
          scope: '打开项目跑一遍主流程，只观察不改代码',
          estimatedMinutes: { min: 25, target: 35, max: 50 },
          actions: [
            { title: '启动应用', instruction: '打开主窗口并进入 Today', checkpoint: '看到主动访谈或执行稿' },
            { title: '跑主流程', instruction: '按当前引导走完整路径', checkpoint: '记录关键入口' },
            { title: '写边界', instruction: '列出今天做和不做的事', checkpoint: '边界清楚' }
          ],
          deliverable: '当前版本功能清单',
          doneWhen: ['写出已完成能力和今天不做的事'],
          quickHint: '如果跑不通，只记录阻塞点',
          evaluationMode: 'ai',
          submissionPolicy: 'once_after_task',
          carryoverAllowed: true
        },
        {
          title: '整理代码地图',
          objective: '知道核心文件分别负责什么',
          scope: '按入口、AI、数据、UI 四类梳理文件',
          estimatedMinutes: { min: 45, target: 60, max: 80 },
          actions: [
            { title: '找入口', instruction: '定位 Electron、preload、renderer 入口', checkpoint: '入口文件已记录' },
            { title: '找 AI 链路', instruction: '定位 prompt、agent、service', checkpoint: 'AI 链路已记录' },
            { title: '写地图', instruction: '整理模块职责', checkpoint: '能指出核心模块职责' }
          ],
          deliverable: '代码目录地图',
          doneWhen: ['能指出每个核心模块职责'],
          quickHint: '先只整理入口和 AI 请求链路',
          evaluationMode: 'ai',
          submissionPolicy: 'once_after_task',
          carryoverAllowed: true
        }
      ]
    };
  }
  if (system.includes('planning-service')) {
    return {
      goalSummary: '先掌握两个概念的语义，再练习场景选择。',
      stages: [
        {
          title: '概念辨析基础',
          objective: '理解概念 A 与概念 B',
          prerequisites: '具备基础阅读材料',
          successCriteria: '能解释并选择合适概念'
        }
      ]
    };
  }
  if (system.includes('planner-agent')) {
    const titles = [...user.matchAll(/"title":"([^"]+)"/g)].map((match) => match[1]);
    const taskTitle = titles.find((title) => title.startsWith('跟进：'))
      ?? titles.find((title) => title.startsWith('阶段起步：'))
      ?? titles.at(-1)
      ?? '阶段起步：概念辨析基础';
    return {
      blocks: [
        {
          taskTitle,
          startTime: '20:00',
          endTime: '20:10',
          durationMinutes: 10,
          objective: '区分概念 A 与概念 B',
          action: '写出概念 A 与概念 B 的区别',
          expectedOutput: '一段可检查的中文说明',
          difficulty: 'foundation',
          material: '本地学习笔记',
          successCheck: '能说明不同场景为什么选择不同概念',
          fallback: '先只比较两个指令'
        }
      ]
    };
  }
  if (system.includes('tutoring-service')) {
    return {
      title: '当前概念辨析步骤',
      objective: '说明当前概念的使用场景',
      instruction: '写出两个概念的含义，并说明下次遇到相似场景时如何选择。',
      explanation: '先判断材料是否经常变化，再判断是否具备稳定版本标识。',
      userAction: '用自己的话写出区别。',
      expectedOutput: '一段包含两个概念区别的说明',
      successCriteria: '能解释概念 A 不是完全禁止复用',
      requiresSubmission: true
    };
  }
  if (system.includes('question-branch')) {
    return {
      answer: '概念 A 可以在满足条件后复用，但每次使用前要重新判断当前条件。',
      relationToCurrentStep: '用于补全当前步骤的概念理解。',
      example: '频繁变化的材料适合概念 A。',
      resolved: true,
      returnToStepInstruction: '回到当前步骤，继续完成两个概念的区别说明。',
      resolutionSummary: '用户理解了概念 A。'
    };
  }
  if (system.includes('reflection-agent')) {
    return {
      completionScore: 88,
      focusScore: 82,
      summary: '今天完成了当前概念辨析步骤，并形成了下一次场景选择练习。',
      nextActions: ['用一个版本稳定的材料例子继续练习概念选择']
    };
  }
  if (system.includes('evaluation-service')) {
    return {
      result: 'passed',
      mastery: 90,
      evidence: ['完整说明两个概念'],
      correctParts: ['区分了条件判断和稳定复用'],
      misconceptions: [],
      missingRequirements: [],
      feedback: '已经达到当前任务完成标准。',
      recommendedAction: 'complete_task'
    };
  }
  if (system.includes('progression-service')) {
    return {
      decision: 'complete_task',
      reason: '当前任务完成，可以安排场景选择练习。',
      taskCompleted: true,
      nextStep: null,
      remediation: null,
      carryForward: '下一次练习为版本稳定的材料选择合适概念。'
    };
  }
  throw new Error(`Unexpected AI operation: ${system}`);
}

function readRequest(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function waitForMainTarget(port) {
  const started = Date.now();
  while (Date.now() - started < 20000) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`);
      const targets = await response.json();
      const main = targets.find((target) => target.type === 'page' && !String(target.url).includes('float-index'));
      if (main?.webSocketDebuggerUrl) return main;
    } catch {
      // Retry until Electron exposes CDP.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error('Timed out waiting for Electron CDP target.');
}

async function getFreePort() {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

class CdpClient {
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const client = new CdpClient(ws);
      ws.addEventListener('open', () => resolve(client), { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
  }

  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  close() {
    this.ws.close();
    return new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function runSmoke() {
  const cwd = resolve('.');
  const userDataDir = mkdtempSync(join(tmpdir(), 'study-supervisor-gui-smoke-'));
  const aiConfig = await createAiConfig();
  const debugPort = await getFreePort();
  const restartDebugPort = await getFreePort();
  let electronProcess;

  try {
    electronProcess = spawnElectron(cwd, userDataDir, debugPort);

    const result = await evaluateRendererSmoke(debugPort, aiConfig);

    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text ?? 'Renderer smoke expression failed.');
    }

    const value = result.result?.value;
    if (!value?.ok) {
      throw new Error(`Renderer smoke failed: ${JSON.stringify(value)}`);
    }

    killElectronProcess(electronProcess);
    electronProcess = undefined;
    electronProcess = spawnElectron(cwd, userDataDir, restartDebugPort);
    const restoreResult = await evaluateRendererExpression(restartDebugPort, buildRestoreExpression());
    if (restoreResult.exceptionDetails) {
      throw new Error(restoreResult.exceptionDetails.text ?? 'Renderer restore expression failed.');
    }
    const restored = restoreResult.result?.value;
    if (!restored?.ok || restored.activeGoalId !== value.activeGoalId) {
      throw new Error(`Restart restore failed: ${JSON.stringify(restored)}`);
    }

    console.log(
      `GUI_SMOKE_RESULT: ok mode="${aiConfig.mode}" goal="${value.goalTitle}" guide="${value.guideId}" firstBlock="${value.firstBlockStatus}" blocks="${value.blockCount}" restored="${restored.firstBlockStatus}"`
    );
  } finally {
    if (electronProcess?.pid) {
      killElectronProcess(electronProcess);
    }
    if (aiConfig.server) {
      await new Promise((resolveClose) => aiConfig.server.close(resolveClose));
    }
    await removeDirectoryWithRetry(userDataDir);
  }
}

async function createAiConfig() {
  const aiServer = await startFakeAiServer();
  return {
    mode: 'fake-ai',
    baseUrl: aiServer.baseUrl,
    model: 'fake-deepseek',
    apiKey: 'test-key',
    waitMs: 20000,
    server: aiServer.server
  };
}

function spawnElectron(cwd, userDataDir, debugPort) {
  const electronProcess = spawn(electronPath, ['.', `--remote-debugging-port=${debugPort}`], {
    cwd,
    env: {
      ...process.env,
      STUDY_SUPERVISOR_USER_DATA_DIR: userDataDir,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  electronProcess.stdout.on('data', () => {});
  electronProcess.stderr.on('data', () => {});
  return electronProcess;
}

function killElectronProcess(electronProcess) {
  if (electronProcess?.pid) {
    spawnSync('taskkill', ['/PID', String(electronProcess.pid), '/T', '/F'], { stdio: 'ignore' });
  }
}

async function removeDirectoryWithRetry(directory) {
  let lastError;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      rmSync(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError;
}

async function evaluateRendererSmoke(debugPort, aiConfig) {
  return evaluateRendererExpression(debugPort, buildActiveIntakeSmokeExpression(aiConfig));
}

async function evaluateRendererExpression(debugPort, expression) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt++) {
    const target = await waitForMainTarget(debugPort);
    const cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
    try {
      await new Promise((resolve) => setTimeout(resolve, 800));
      const result = await cdp.send('Runtime.evaluate', {
        awaitPromise: true,
        returnByValue: true,
        expression
      });
      await cdp.close();
      return result;
    } catch (error) {
      await cdp.close();
      lastError = error;
      if (!String(error).includes('Execution context was destroyed')) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError;
}

if (process.argv.includes('--real-ai')) {
  console.log('GUI_SMOKE_RESULT: skipped mode="real-ai" reason="manual-acceptance-only"');
  console.log('REAL_AI_CONTRACT: run RUN_DEEPSEEK_CONTRACT=1 npm.cmd test -- src/main/ai/deepseek-contract.test.ts');
} else {
  await runSmoke();
}
