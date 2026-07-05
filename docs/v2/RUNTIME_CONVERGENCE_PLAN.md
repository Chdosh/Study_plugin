# V2 Runtime Convergence Plan

> 精确引用审计，冻结于 2026-07-05。仅分析当前运行时引用链的断裂点与修复方向。
> 限制 200 行。

## 1. learning_runtime_states 每个字段的精确事实

| 字段 | 列类型 | 外键目标 | 写入方法 | 读取方法 |
|------|--------|----------|----------|----------|
| `activeGoalId` | text | `goals.id` [schema.ts:279](src/main/db/schema.ts:279) | `confirmGoalIntake` [store.ts:203](src/main/services/store.ts:203), `initializeLearningForBlock` [store.ts:1058](src/main/services/store.ts:1058), `upsertRuntimeState` [store.ts:1806](src/main/services/store.ts:1806) | `getLearningRuntimeSnapshot` → `getGoal(state.activeGoalId)` [store.ts:1112](src/main/services/store.ts:1112) |
| `activeStageId` | text | `plan_stages.id` [schema.ts:280](src/main/db/schema.ts:280) | `initializeLearningForBlock` [store.ts:1060](src/main/services/store.ts:1060) | `getStage(state.activeStageId)` → `planStages` 表 [store.ts:1113](src/main/services/store.ts:1113) |
| `activeDailyTaskId` | text | `daily_plan_blocks.id` [schema.ts:281](src/main/db/schema.ts:281) | `initializeLearningForBlock` [store.ts:1061](src/main/services/store.ts:1061), `completeCurrentAction` [store.ts:1228](src/main/services/store.ts:1228), `createStepForActiveExecutionTask` [store.ts:1760](src/main/services/store.ts:1760) | `getBlock(state.activeDailyTaskId)` → `dailyPlanBlocks` 表 [store.ts:1114](src/main/services/store.ts:1114) |
| `activeStepId` | text | `learning_steps.id` [schema.ts:282](src/main/db/schema.ts:282) | `initializeLearningForBlock` [store.ts:1062](src/main/services/store.ts:1062), `completeCurrentAction` [store.ts:1229](src/main/services/store.ts:1229), `createStepForActiveExecutionTask` [store.ts:1761](src/main/services/store.ts:1761) | `getLearningStep(state.activeStepId)` → `learningSteps` 表 [store.ts:1115](src/main/services/store.ts:1115) |
| `activeQuestionThreadId` | text | **无 FK** [schema.ts:283](src/main/db/schema.ts:283) | `openQuestion` [store.ts:1260](src/main/services/store.ts:1260), `resolveQuestion` [store.ts:1321](src/main/services/store.ts:1321) | `getQuestionThread(state.activeQuestionThreadId)` [store.ts:1116](src/main/services/store.ts:1116) |
| `sessionStatus` | text enum | 无 | `upsertRuntimeState` 各处 | 同上 |

## 2. activeDailyTaskId 是否指向 daily_plan_blocks

**是。** Drizzle schema 第 281 行明确声明：

```ts
activeDailyTaskId: text('active_daily_task_id').references(() => dailyPlanBlocks.id)
```

[src/main/db/schema.ts:281](src/main/db/schema.ts:281)

且 `getLearningRuntimeSnapshot()` 读取时调用 `this.getBlock(state.activeDailyTaskId)` [store.ts:1114](src/main/services/store.ts:1114)，返回 `DailyPlanBlock` 类型。字段名语义暗示"当前激活的 task"，但外键约束和运行时类型均绑定 `daily_plan_blocks`。

**间接联通路径**：`daily_guide_tasks.legacyPlanBlockId` 是 `dailyPlanBlocks.id` 的外键 [schema.ts:201](src/main/db/schema.ts:201)。`findTask()` [execution-state-machine.ts:238](src/main/domain/execution-state-machine.ts:238) 允许按 `task.id` 或 `task.legacyPlanBlockId` 匹配。因此 `activeDailyTaskId` 存储的是一个 blockId，通过 `getDailyGuideTasksByBlockId(blockId)` [store.ts:1658](src/main/services/store.ts:1658) 反向查到对应的 `DailyGuideTask`。

## 3. daily_guide_task 和 daily_guide_action 的 ID 保存与恢复

**保存**（两条路径）：

- `saveLayeredPlan()` [store.ts:498-501](src/main/services/store.ts:496)：为每个 AI 生成的 task 创建 `daily_guide_tasks` 行 + 配套 `daily_plan_blocks` 行（`legacyPlanBlockId` 指向该 block）+ `daily_guide_actions` 行
- `saveDailyGuideWithTransaction()` [store.ts:779-781](src/main/services/store.ts:776)：同上，在事务内执行

**恢复**：

- `getDailyGuideTasksByBlockId(blockId)` [store.ts:1658-1683](src/main/services/store.ts:1658)：通过 `legacyPlanBlockId` 反查 task → 通过 task 的 `guideId` 查出同 guide 的所有 tasks → 为每个 task 查出其 actions
- `mapDailyGuideTask()` [store.ts:2363-2397](src/main/services/store.ts:2363)：将 DB 行组装为 `DailyGuideTask` 类型，actions 通过 `mapDailyGuideAction()` 转换
- `execution-state-machine` 的 `findTask()` 接受 task.id 或 legacyPlanBlockId [execution-state-machine.ts:238](src/main/domain/execution-state-machine.ts:238)

## 4. study_sessions 的锚点

`studySessions.blockId` 的外键目标是 `dailyPlanBlocks.id` [schema.ts:215](src/main/db/schema.ts:215)。

依赖此锚点的方法：

| 方法 | 引用方式 |
|------|----------|
| `startSession(blockId)` | blockId 验存在 `dailyPlanBlocks` [store.ts:887](src/main/services/store.ts:887) |
| `pauseSession(sessionId)` | 通过 session.blockId 更新 elapsed [store.ts:949](src/main/services/store.ts:949) |
| `updateDailyGuideTaskElapsed(blockId)` | 通过 blockId 查 `dailyGuideTasks.legacyPlanBlockId` [store.ts:1639-1643](src/main/services/store.ts:1639) |
| `getAccumulatedSeconds(blockId)` | 通过 blockId 查 sessions [store.ts:1023](src/main/services/store.ts:1023) |
| `getDaySnapshot(date)` | 通过 `guideTask.legacyPlanBlockId` 匹配 session.blockId [store.ts:2196](src/main/services/store.ts:2196) |
| Renderer `getCurrentGuideTaskSelection()` | 通过 `activeSession.blockId` 匹配 task.legacyPlanBlockId [guide-selection.ts:17](src/renderer/src/domain/guide-selection.ts:17) |

## 5. context-builder 中的旧模型路径

ContextBuilder 构建的 `context` 对象包含以下旧模型字段（均来自 `LearningRuntimeSnapshot`）：

| 路径 | 来源表 | 代码 |
|------|--------|------|
| `context.task` | `task_items` | [context-builder.ts:51-58](src/main/services/context-builder.ts:51) — 通过 `block.taskId` 查 `taskItems` [store.ts:1118](src/main/services/store.ts:1118) |
| `context.block` | `daily_plan_blocks` | [context-builder.ts:60-68](src/main/services/context-builder.ts:60) — 通过 `state.activeDailyTaskId` 查 `dailyPlanBlocks` [store.ts:1114](src/main/services/store.ts:1114) |
| `context.step` | `learning_steps` | [context-builder.ts:70-79](src/main/services/context-builder.ts:70) — 通过 `state.activeStepId` 查 `learningSteps` [store.ts:1115](src/main/services/store.ts:1115) |
| `context.stage` | `plan_stages` | [context-builder.ts:43-49](src/main/services/context-builder.ts:43) — 通过 `state.activeStageId` 查 `planStages` [store.ts:1113](src/main/services/store.ts:1113) |

四个旧模型全部进入 AI 上下文。`daily_guide_tasks` / `daily_guide_actions`（当前正式执行模型）反而**未直接进入 context-builder 输出**——它们仅间接出现在 `execution-state-machine` 操作后的 snapshot 中。

## 6. execution-state-machine 的输入来源

状态机核心接口使用 `ExecutionState` [execution-state-machine.ts:23-28](src/main/domain/execution-state-machine.ts:23)：

```ts
interface ExecutionState {
  tasks: DailyGuideTask[];      // ← 新模型
  activeDailyTaskId: Id | null;  // ← 可以是 task.id 或 legacyPlanBlockId
  activeStepId: Id | null;       // ← 指向 DailyGuideAction.id
}
```

输入来自 `DailyGuideTask[]`（新模型），经由 `recoverExecutionState(guide.tasks, runtime)` 初始化 [execution-state-machine.ts:48](src/main/domain/execution-state-machine.ts:48)，其中 `runtime` 来自 `LearningRuntimeState`。`findTask()` 双键查找 [execution-state-machine.ts:238](src/main/domain/execution-state-machine.ts:238) 是旧 blockId 能工作的唯一原因。

**结论**：状态机操作的是新模型 `DailyGuideTask`，但定位逻辑仍依赖 `legacyPlanBlockId` 桥接。

## 7. Renderer 对数据库运行时状态的覆盖/绕过

`getCurrentGuideTaskSelection()` [guide-selection.ts:8-37](src/renderer/src/domain/guide-selection.ts:8) 是 renderer 唯一的状态推导点：

- 优先级 1：`activeSession.blockId` → 匹配 `task.legacyPlanBlockId` [guide-selection.ts:22](src/renderer/src/domain/guide-selection.ts:22)
- 优先级 2：`learningState.step.blockId` 或 `learningState.state.activeDailyTaskId` [guide-selection.ts:13](src/renderer/src/domain/guide-selection.ts:13)
- 优先级 3：`task.status === 'active'` 或第一个 `planned/deferred` [guide-selection.ts:29-31](src/renderer/src/domain/guide-selection.ts:29)
- 返回的 `planBlockId` 是 `task.legacyPlanBlockId` [guide-selection.ts:34](src/renderer/src/domain/guide-selection.ts:34)

StudyPage 使用此 `planBlockId` 调用 `onStartSession(currentPlanBlockId)` [StudyPage.tsx:324-325](src/renderer/src/pages/StudyPage.tsx:324)，即将 blockId 传回 `startSession`。

**覆盖风险**：优先级 2 和 3 可能选出与主进程状态机不一致的任务。例如：状态机已推进到 task-2，但 Runtime 仍指向旧 blockId，renderer 会跟随数据库（正确），或退化为按 status 查找（可能与状态机不一致）。

## 8. 不新增表的修正方案

如果**不新增 `learning_runtime_v2` 表**，修正现有 runtime 的最小变更：

| 变更 | 位置 | 说明 |
|------|------|------|
| `activeDailyTaskId` 改为存 `daily_guide_tasks.id` | schema FK 目标从 `dailyPlanBlocks` 改为 `dailyGuideTasks` | 需迁移：更新现有行的值（通过 `legacyPlanBlockId` 反查 taskId） |
| `activeStepId` 改为存 `daily_guide_actions.id` | schema FK 目标从 `learningSteps` 改为 `dailyGuideActions` | 需迁移 |
| `activeStageId` 改为存 `roadmap_stages.id` | schema FK 目标从 `planStages` 改为 `roadmapStages` | 或直接废弃字段（当前仅 `initializeLearningForBlock` 写入孤表数据） |
| `getLearningRuntimeSnapshot()` 读取路径 | 替换 `getBlock()` → `getDailyGuideTaskByBlockId()` / `getDailyGuideAction()` | [store.ts:1114-1115](src/main/services/store.ts:1114) |
| `context-builder` 上下文字段 | 用 `DailyGuideTask` + `DailyGuideAction` 替换 `DailyPlanBlock` + `LearningStep` | [context-builder.ts:51-79](src/main/services/context-builder.ts:51) |
| `studySessions.blockId` 改为 `studySessions.taskId` | FK 从 `dailyPlanBlocks` 改为 `dailyGuideTasks` | 需迁移 session 历史数据 |
| 所有 `getDailyGuideTasksByBlockId` 改为 `getDailyGuideTasksByTaskId` | 直接按 taskId 查 | [store.ts:1658](src/main/services/store.ts:1658) |
| renderer `guide-selection.ts` | 按 `task.id` 匹配而非 `legacyPlanBlockId` | [guide-selection.ts:17](src/renderer/src/domain/guide-selection.ts:17) |

需修改的测试：`app-service.test.ts`（多处断言 `activeDailyTaskId === blockId`）、`store.test.ts`、`execution-state-machine.test.ts`。

## 9. 是否必须增加新字段

**不必新增字段。** 现有 `learning_runtime_states` 的单例结构可以承载修复后的指针。理由：

- 现有 6 个字段的语义映射只需改 FK 目标，不改变字段数量或含义
- `activeDailyTaskId` 字段名称已经暗示"当前 task ID"——只需让值真正指向 `daily_guide_tasks.id`
- `activeStepId` 同理，改指向 `daily_guide_actions.id`
- `sessionStatus` 字段含义不变
- 迁移可通过临时查询 `legacyPlanBlockId` 反向映射完成，不丢数据

**唯一风险**：`studySessions` 表的 `blockId` 列改为 `taskId` 后，需重新计算历史 session 的 `taskId` 值。若 `daily_plan_blocks` 行在迁移前已被删除，对应历史 session 将丢失锚点。缓解措施：迁移脚本使用 `LEFT JOIN` 处理缺失行，保留 `blockId` 为 NULL 而非阻断迁移。

## 10. 三阶段修改分解

### 任务 A：数据库与 Store

**目标**：schema FK 重定向 + Store 读写路径切换。

**允许修改的文件**：
- `src/main/db/schema.ts` — 3 处 FK 目标修改（`activeDailyTaskId` → `dailyGuideTasks`，`activeStepId` → `dailyGuideActions`，`activeStageId` → `roadmapStages`）
- Drizzle 迁移文件（新增 `0006`）
- `src/main/services/store.ts` — 修改 `getLearningRuntimeSnapshot()`（3 处读取路径）、`getOrCreateRuntimeState()`、`upsertRuntimeState()`、`completeCurrentAction()`（移除 `createLearningStep` 调用）、`saveEvaluationAndDecision()`（移除 `createLearningStep` 调用）、`initializeLearningForBlock()`（重构或废弃）、`createStepForActiveExecutionTask()`（重构）、`updateDailyGuideTaskElapsed()`（按 taskId 查）、`getDailyGuideTasksByBlockId()`（改为按 taskId 查）
- `src/shared/types.ts` — 更新 `LearningRuntimeState` 类型的注释（不改字段名）

**不修改**：`daily_plan_blocks` 表（保留为兼容数据，不删除）、`learning_steps` 表（保留，不再写入新行）、`dailyGuideTasks.legacyPlanBlockId`（保留为兼容引用，不再作为主路径）

### 任务 B：Session 与 Context

**目标**：session 锚点从 blockId 切换到 taskId + context-builder 切换上下文来源。

**允许修改的文件**：
- `src/main/db/schema.ts` — `studySessions.blockId` FK 目标改为 `dailyGuideTasks.id`（列重命名为 `taskId`）
- Drizzle 迁移文件（新增 `0007`）
- `src/main/services/store.ts` — 修改 `startSession()`、`pauseSession()`、`completeSession()`、`getAccumulatedSeconds()`、`getDaySnapshot()` 中的 blockId 引用
- `src/main/services/context-builder.ts` — 将 `context.task`/`context.block`/`context.step`/`context.stage` 替换为基于 `DailyGuideTask`/`DailyGuideAction`/`RoadmapStage` 的字段
- `src/main/services/app-service.ts` — 修改 `getActiveSession()` 中 `block.status` 检查
- `src/main/domain/execution-state-machine.ts` — 移除 `findTask()` 中的 `legacyPlanBlockId` 回退匹配 [execution-state-machine.ts:238](src/main/domain/execution-state-machine.ts:238)

**不修改**：AI agent prompt 文本、AI output schemas、`FocusMonitor`

### 任务 C：Application 与 Renderer

**目标**：移除 renderer 对 blockId 的依赖 + app-service 流程收束。

**允许修改的文件**：
- `src/renderer/src/domain/guide-selection.ts` — 按 `task.id` 匹配替代 `legacyPlanBlockId` [guide-selection.ts:17](src/renderer/src/domain/guide-selection.ts:17)，返回 `taskId` 替代 `planBlockId`
- `src/renderer/src/pages/StudyPage.tsx` — 将所有 `currentPlanBlockId` 替换为 `currentTaskId`，`activeSessionBelongsToCurrent` 按 `taskId` 判断 [StudyPage.tsx:77,89](src/renderer/src/pages/StudyPage.tsx:77)
- `src/renderer/src/App.tsx` — `onStartSession(taskId)` 替代 `blockId`，`onResumeSession` 同理
- `src/preload/index.ts` — `StudyAppApi.sessions` 接口签名将 `blockId` 改为 `taskId`（IPC 通道名不变）
- `src/shared/types.ts` — `StudySession` 类型中 `blockId` 改为 `taskId`
- `src/shared/ipc.ts` — 无变化（通道名不变）
- `src/main/services/app-service.ts` — 无结构性变化（store 层已收敛）
- 测试文件 — `app-service.test.ts`、`store.test.ts`、`execution-state-machine.test.ts` — 将所有 blockId 断言替换为 taskId

**不修改**：页面布局、CSS、AI 调用逻辑、settings、review 页、mock-api.ts（浏览器预览模式，可后续独立更新）
