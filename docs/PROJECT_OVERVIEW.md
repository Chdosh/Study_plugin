# 项目架构与主流程

> 状态：ACTIVE
> 用途：全局鸟瞰视图。它从 `docs/ARCHITECTURE.md`、`docs/PRODUCT_TRUTH.md`、`docs/MVP_SPEC.md`、`docs/AI_AND_DATA_RULES.md`、`docs/SECURITY_AND_PRIVACY.md`、`docs/UI_GUIDELINES.md` 和当前代码提取关键事实，以单一入口呈现"系统由哪些层组成"以及"一次学习闭环如何跨层流动"。
> 边界：本文件不是专题规范的替代品。当需要原始约束、完整字段清单、状态机规则或 UI 细节时，仍以对应专题文档为准。

## 1. 架构分层

```text
┌─────────────────────────────────────────────────────┐
│                   Renderer (React)                   │
│  TodayPage · StudyPage · ReviewPage · SettingsPage   │
│  components/layout · components/ai · components/*     │
└──────────────────────────┬──────────────────────────┘
                           │ typed, narrow IPC (32 channels)
┌──────────────────────────▼──────────────────────────┐
│               Preload (contextBridge)                │
│              window.studyApp: StudyAppApi            │
└──────────────────────────┬──────────────────────────┘
                           │ ipcMain.handle / invoke
┌──────────────────────────▼──────────────────────────┐
│              Main (Electron + services)              │
│  AppService                                          │
│    ├── ai/*        (Agents + AiClient + prompts)    │
│    ├── services/*  (Store, ContextBuilder, Focus…)  │
│    └── domain/*    (execution-state-machine)         │
└──────────────────────────┬──────────────────────────┘
                           │ Drizzle ORM
┌──────────────────────────▼──────────────────────────┐
│                SQLite (local file)                   │
│  184 列 / 28 张表 · durable source of truth          │
└─────────────────────────────────────────────────────┘
```

### 1.1 技术栈（以 package.json 为准）

| 层       | 技术                                             |
| -------- | ------------------------------------------------ |
| Desktop  | Electron 33 + electron-vite                      |
| Build    | Vite 5 (renderer) · electron-vite (main/preload) |
| Language | TypeScript 5.8 (strict)                          |
| UI       | React 18 + lucide-react 图标                     |
| Styling  | 手拆 CSS 模块（tokens/base/components/layout/…） |
| DB       | SQLite via libsql/client + Drizzle ORM 0.45      |
| AI       | OpenAI-compatible client → DeepSeek              |
| Validate | Zod 3.x runtime schema                           |
| Test     | Vitest 3.x（fake AI）                            |

### 1.2 模块目录与职责

| 路径                       | 职责                                                             |
| -------------------------- | ---------------------------------------------------------------- |
| `src/main/index.ts`        | Electron 入口：创建窗口、托盘、启动 DB/AppService/IPC           |
| `src/main/ipc.ts`          | 32 个 IPC channel 的单文件注册表                                 |
| `src/main/services/store.ts` | 应用层持久化：事务、游标恢复、计划版本、block↔task 映射     |
| `src/main/services/app-service.ts` | 业务编排：访谈→计划→提问→提交→评价→复盘            |
| `src/main/services/context-builder.ts` | 按操作组装 AI 上下文快照，不直接调用模型      |
| `src/main/domain/execution-state-machine.ts` | 纯函数状态机：completeAction / skipAction / applyEvaluationResult / recover |
| `src/main/ai/agents.ts`    | 8 个单职责 Agent 包装器（GoalIntake、Roadmap、ShortPlan、DailyGuide、Teach、Question、Evaluation、Reflection） |
| `src/main/ai/ai-client.ts` | OpenAI-compatible 调用 + 一次 JSON repair                      |
| `src/main/ai/agent-prompts.ts` | 每个 Agent 的 system + user prompt 工厂                    |
| `src/main/db/schema.ts`    | 28 张 Drizzle 表                                                 |
| `src/main/db/migrations.ts` | 已落地迁移历史                                                 |
| `src/main/db/default-prompts.ts` | 启动时种子化的 5 档 prompt（foundation/standard/advanced/exam/recovery） |
| `src/preload/index.ts`     | 暴露 `window.studyApp: StudyAppApi`，类型来自 shared            |
| `src/shared/types.ts`      | 所有领域类型 + `StudyAppApi` 接口类型                           |
| `src/shared/schemas.ts`    | Zod schemas + 中文别名宽容解析                                   |
| `src/shared/ipc.ts`        | IPC channel 名字符串集中定义                                     |
| `src/renderer/src/App.tsx` | 顶层路由：Today/Study/Review/Settings + AiDrawer 宿主            |
| `src/renderer/src/pages/` | 四个页面组件                                                    |
| `src/renderer/src/components/` | layout/ai/shared/today/study 子组件                          |

---

## 2. 数据模型（行为视角）

当前学习闭环真正"驱动 UI 的最小持久化路径"由以下 12 张核心表组成：

```text
goals
 └─ goal_intakes → goal_intake_messages
 └─ roadmap_stages
 └─ short_plan_days
 └─ daily_guides (date, todayGoal, boundaries, acceptanceCriteria)
      └─ daily_guide_tasks (title, objective, estimated*, deliverable, doneWhen, evaluationMode,status, position)
           └─ daily_guide_actions (title, instruction, checkpoint, status, position)
                └─ study_sessions (startedAt/endedAt/status, 锚定到 task.id)
                └─ learning_submissions
                     └─ learning_evaluations
                     └─ question_threads → question_messages
learning_runtime_states (activeGoalId / activeDailyTaskId / activeStepId / activeQuestionThreadId / sessionStatus)
ai_reviews (每次 AI 调用的 input/output/status 审计)
prompt_profiles → prompt_versions (可编辑、可版本化的 5 档 profile)
```

以下旧表**仍存在于 schema 中**，但只承担 session 锚点、历史兼容或尚未迁移的记录角色。新主流程的读写应该以上面 12 张表为准：

| 旧表                | 现状                                                         |
| ------------------- | ------------------------------------------------------------ |
| `daily_plans`       | 保留为 session 锚点容器；UI 不再使用固定 10 分钟 block 展示 |
| `daily_plan_blocks` | 通过 `daily_guide_tasks.legacy_plan_blockId` 兼容映射        |
| `daily_guide_blocks`| session 锚点历史结构；UI 已不直接依赖                        |
| `task_items`        | 兼容旧 import 路径                                           |
| `plan_stages`       | 兼容旧 import 路径；当前主流程用 `roadmap_stages` 代替      |
| `learning_steps`    | 兼容旧 block 流程；当前执行位置由 `daily_guide_actions` 承载 |
| `raw_imports`       | 兼容历史会话导入                                             |
| `focus_events`      | 窗口焦点采集记录（可选监控回路）                             |
| `skip_logs`         | 跳过 block/task 的历史原因记录                               |
| `learning_summaries`| 各类摘要的持久化容器（当前主要由 ai_reviews 承担审计）       |
| `plan_adjustment_proposals` | 状态机输出后的调整 proposal 容器                      |
| `next_step_decisions` | 本地状态机输出或兼容 decide_next_step 输出                |

> 任何"以 block/step 为中心"的新实现都应退回到 `daily_guide_tasks` / `daily_guide_actions` 入口。

---

## 3. 端到端学习闭环

```text
            ┌─────────────────────────────────────────────┐
            │                   Today                       │
            │  ① 访谈目标 (onboarding)                     │
            │  ② 确认目标 → 生成分层计划                    │
            │  ③ 查看今日主任务、进度、知识库               │
            │  ④ 归档当前计划并重新开始                     │
            └────────────────────┬────────────────────────┘
                                 │ 用户主动进入 Study
                                 ▼
            ┌─────────────────────────────────────────────┐
            │                   Study                       │
            │  ⑤ 开始当前主任务 (启动 Focus Session)       │
            │  ⑥ 完成 / 跳过 Action 步骤                    │
            │  ⑦ 提问 (问题分支，不改变主任务)             │
            │  ⑧ 提交最终结果 → 评价 → 状态机推进          │
            │  ⑨ 主任务通过 → 同步结束 Focus Session        │
            └────────────────────┬────────────────────────┘
                                 │ 用户主动进入 Review
                                 ▼
            ┌─────────────────────────────────────────────┐
            │                   Review                      │
            │  ⑩ 生成复盘建议（按日汇总）                   │
            │  ⑪ 确认 / 拒绝调整 proposal                   │
            └─────────────────────────────────────────────┘
```

### 3.① 访谈与目标澄清

- 入口：`TodayPage` 顶部"访谈工作区"，调用 `onboarding.sendMessage` / `confirmGoal`。
- AI：`GoalIntakeAgent`，输入当前 intake 最近消息 + 用户输入，输出 `{ status, reply, brief, missingInfo }`。
- 状态机：`goal_intakes.status` 在 `collecting → ready → confirmed` 迁移。
- 产出：写入 `goal_intake_messages`、`goal_intakes.brief_json`。

### 3.② 分层计划

- 触发：`onboarding.confirmGoal` 完成后 Today 调用 `guides.generateLayeredPlan`，或用户主动"生成分层计划"。
- 顺序：`RoadmapAgent → ShortPlanAgent → DailyGuideAgent`。
- 事务：`store.saveLayeredPlan` 一次写入 `roadmap_stages` + `short_plan_days` + `daily_guides` + `daily_guide_tasks` + `daily_guide_actions`。
- 失败：DailyGuide 失败写入 `ai_reviews.status = 'failed'`，保留 `short_plan_days.date`，返回 `generation_failed` 允许重试。

### 3.③ 今日执行

- 入口：`TodayPage` 展示今日主任务列表 + 进度 + 计划管理。
- 启动学习：`StudyPage.onStartSession(taskId)` → `sessions.start(taskId)`。
- Focus Session：`FocusMonitor` 启动，主任务结束同步 `completeSession`。

### 3.④ 主任务执行

- 当前任务 & 当前步骤从 `learning_runtime_states` 的 `activeDailyTaskId` / `activeStepId` 读取。
- 完成步骤：`learning.completeCurrentAction()` → `execution-state-machine.completeAction()` → 更新 `daily_guide_actions.status`、指针、`progressPercent`。
- 跳过步骤：`learning.skipCurrentAction()` → `execution-state-machine.skipAction()`。
- 教学展开：`learning.teachCurrentStep()` → `TeachStepAgent`（可选补充内容，不影响状态机）。

### 3.⑤ 提问

- `learning.askStepQuestion` → 写入 `question_threads` / `question_messages` → 调用 `StepQuestionAgent`。
- 打开问题只改 `activeQuestionThreadId`，不改变主任务或当前 action。
- 解决后：`learning.resolveQuestion(threadId, summary)` 清除 `activeQuestionThreadId`，回到原主任务。

### 3.⑥ 提交评价

- `learning.submitLearningResult(content)` → 写入 `learning_submissions`。
- 评价模式：
  - `evaluationMode = 'local'`：不调用模型，`buildLocalSubmissionEvaluation`（长度 ≥ 10 即 passed）。
  - `evaluationMode = 'ai'`：调用 `SubmissionEvaluationAgent`（最多一次），写入 `learning_evaluations` + `ai_reviews`。
- 状态机推进：
  - 通过：`applyEvaluationResult` → 主任务状态 `done` → 自动开始下一任务或标记 `guide_completed`。
  - 未通过：状态变为 `needs_revision`，等待用户再次提交或编辑。
- Focus Session 同步：主任务完成 + 所有任务都通过 → `completeSession` + `completeLearningDay`。

### 3.⑦ 复盘

- 入口：`ReviewPage.onGenerate(date)` → `reviews.generate(date)` → `ReflectionAgent`（输入当日 snapshot）。
- 产出：`ReviewResult` + `ai_reviews` 一条 reflection 记录。
- 后续调整：可选 `learning.decideAdjustment(proposalId, status)` 写入 `plan_adjustment_proposals`。

---

## 4. AI 调用边界

| 节点                    | 调用方                  | Agent                 | 关键输入                                | 关键输出                                |
| ----------------------- | ----------------------- | --------------------- | --------------------------------------- | --------------------------------------- |
| 访谈目标                | `sendOnboardingMessage` | GoalIntake            | 最近 intake 消息                        | `status / reply / brief`                |
| 长期大纲 / 短期计划     | `generateLayeredPlan`   | Roadmap + ShortPlan   | 目标 + brief + 时间窗                   | 阶段 + 前 3 天 dayIndex                 |
| 今日执行稿              | `prepareCurrentLearningDay` / `generateLayeredPlan` | DailyGuide | roadmap + targetDay + 前一天结果   | 1–4 主任务 + 1–6 步骤                   |
| 展开当前步骤            | `teachCurrentStep`      | TeachStep             | 当前 guideTask/guideAction              | `explanation / userAction`              |
| 回答问题                | `askStepQuestion`       | StepQuestion          | 当前动作 + 问题 + 最近 4 条历史        | `answer / resolved / returnToStep`      |
| 评价主任务提交          | `submitLearningResult`  | SubmissionEvaluation  | 提交内容 + 完成标准 + 任务上下文        | `result / mastery / feedback / recommendedAction` |
| 复盘                    | `reviews.generate`      | Reflection            | 当日 snapshot                           | `summary / completionScore / nextActions` |

- AI Focus Session 开始 / 暂停 / 恢复 / 超时 **不触发模型**。
- Action 完成 / Checkpoint 记录 / 时间流逝 **不触发模型**。
- 当前不固定调用 `decide_next_step`（NextStepDecisionAgent 仅作为兼容/按需能力保留）。

---

## 5. 上下文组合规则

`ContextBuilder.build(operation)` 为每个 AI 操作组装固定字段集：

- **始终携带**：goal（精简）、guide（精简）、guideTask、guideAction、roadmapStage、currentQuestionThread（含最后 4 条 messages）、latestSubmission、latestEvaluation、latestDecision、pendingAdjustment。
- **不携带**：完整聊天历史、完整学习历史、原始窗口标题、API key、其他任务的细节。
- 每次调用记录 `contextSourceIds`（从当前 snapshot 派生），落库 `ai_reviews.input_snapshot`，不记录 secret。
- `LearningRuntimeSnapshot` 是 store 层提供的**当前位置单一快照**，UI 和 AI 都从它读取，不从聊天时间推测。

---

## 6. 状态机

`src/main/domain/execution-state-machine.ts` 是纯函数，输入 `{tasks, activeDailyTaskId, activeStepId}`，输出 `ExecutionState` 或冲突。

| 函数                     | 效果                                                           |
| ------------------------ | -------------------------------------------------------------- |
| `recoverExecutionState`  | 重启恢复：校验指针 → 冲突回退到首个未完成任务                  |
| `completeAction`         | 标记 action done → 推进 currentAction / completedActions / progressPercent；全完成则进入下一任务 |
| `skipAction`             | 跳过当前 action → 逻辑类似 complete，不更新 evaluation         |
| `applyEvaluationResult`  | 通过 → 任务 done；未通过 → 任务 active + `needs_revision`       |
| `isPassingEvaluation`    | `result === 'passed'` 或 `recommendedAction` 为 `complete_task` / `advance` |

状态：`active` / `awaiting_result` / `needs_revision` / `done` / `guide_completed`。

---

## 7. 安全边界

- `contextIsolation: true`、`nodeIntegration: false`、preload 只暴露 `StudyAppApi`。
- Renderer 不直读 SQLite、文件系统、`safeStorage`、操作系统监控 API、API key。
- API key 由 `SettingsService` 使用 `safeStorage` 加密落库；只在 main 进程内存中以明文作调用参数。
- AI 输入 snapshot 只含 `id`、`title`、`status`、时间戳、步骤标题等上下文字段，**不**含 API key、认证 token、原始窗口标题。
- 不得自动执行 AI 生成的代码或 shell 命令。

---

## 8. 测试与验证

| 命令                                              | 作用                                  |
| ------------------------------------------------- | ------------------------------------- |
| `npm run typecheck`                               | main + web 双 tsconfig                |
| `npm test`                                        | vitest run (fake AI，62 passed)       |
| `RUN_DEEPSEEK_CONTRACT=1 npm.cmd test -- src/main/ai/deepseek-contract.test.ts` | 真实合约测试（opt-in）               |
| `npm run build`                                   | typecheck + electron-vite 全构建     |
| `npm run dev`                                     | 本地开发                             |
| `npm run dev:browser`                             | 浏览器预览（跳过 Electron shell）    |

契约测试默认跳过（6 skipped），只在用户明确要求时 opt-in。

---

## 9. 待收敛项（来自 PROJECT_MEMORY）

1. `daily_plan_blocks` / `daily_guide_blocks` / `plan_stages` / `task_items` / `learning_steps` 等旧表仍是 session 锚点和历史兼容的组成部分，**先有迁移方案再清理**。
2. 真实 DeepSeek 完整主流程仍需人工验收一次，确认当前 daily guide prompt 在真实模型下稳定。
3. 提问、主任务最终提交、复盘调整等入口已接到 `daily_guide_tasks` 主流程，但需持续检查是否还有旧 block/step 语义遗留。
4. 启动/暂停/恢复/超时不触发 AI，Action 完成不触发 AI 评价——这是硬约束，重构时不得放松。

---

## 10. 文档地图

| 需要了解…                     | 读取                                  |
| ----------------------------- | ------------------------------------- |
| 产品定位、核心概念、长期原则  | `docs/PRODUCT_TRUTH.md`               |
| MVP 流程、默认交互、验收      | `docs/MVP_SPEC.md`                    |
| 分层、IPC、依赖方向           | `docs/ARCHITECTURE.md`                |
| AI schema、prompt、上下文、校验 | `docs/AI_AND_DATA_RULES.md`         |
| Electron 权限、隐私、敏感数据 | `docs/SECURITY_AND_PRIVACY.md`        |
| 页面信息架构、交互与视觉规则  | `docs/UI_GUIDELINES.md`               |
| 测试、迁移、schema 变更规范   | `docs/TESTING_AND_MIGRATIONS.md`      |
| 新对话短交接                  | `docs/PROJECT_MEMORY.md`（按需）       |
