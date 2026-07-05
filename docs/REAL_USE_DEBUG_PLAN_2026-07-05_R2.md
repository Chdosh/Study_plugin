# 真实使用测试与 Debug Plan 第二轮（2026-07-05）

## 背景

本轮测试基于用户刚完成的一波 bug 修复后的当前工作树。测试目标不是代码审查，而是以真实学习者视角走一轮主流程，重点验证：

1. 主流程是否能在任务完成后自然结束。
2. Study 是否还会跳回已完成任务。
3. Today 是否展示完整计划。
4. 两个任务完成后是否能开启下一天任务。
5. 页面之间是否还存在状态不同步。

本轮只新增本报告文件，未修改业务代码。

## 测试环境

启动命令：

```bash
npm run dev
```

测试窗口：

```text
学习管家
```

当前启动后的测试数据已经处于 Today `2/2` 任务完成、学习时长 `25 分钟` 的状态，因此本轮主要验证“已完成学习日”的收束和后续入口。

## 测试过程

### 1. 启动后查看 Today

观察到：

* Today 显示目标：`三天学会Loop Engineering并完成求职网页应用`。
* Today 显示 `今日进度 100%`、`2/2 任务完成`、`25 分钟 学习时长`。
* 主内容区展示的是“学习路径”：基础学习与项目规划、核心功能开发、完善测试与部署。
* 页面没有展示今日两个具体任务的完整列表，只在右侧“最近学习”里看到一条“完成步骤”。
* 页面提示：“今日执行稿已确认。开始、暂停、提交都在‘学习’页完成。”
* 页面仍有“重新开始新计划”按钮，但没有“结束今天”“生成下一天任务”“进入明天计划”等入口。

不合理点：

* 对于已经 `2/2` 完成的一天，Today 仍像一个进行中的今日页，而不是完成态。
* “主页面不显示所有计划”的问题仍存在：Today 主区域展示 roadmap 阶段，不展示今日具体任务列表。用户无法在主页面看到当天两个任务分别是什么、状态是什么、下一天计划在哪里。
* 完成后只有“重新开始新计划”，这像是放弃当前计划，不是进入下一天。

疑似问题：

* Today 的信息架构把 roadmap 当成主内容，而 Daily Guide tasks 被弱化或隐藏。
* 缺少 Day Completion / Next Day 的产品状态和入口。

疑似代码位置：

* `src/renderer/src/pages/TodayPage.tsx`
  * 当前主区域渲染 `todayGuide.roadmap.map(...)`。
  * `guide.tasks` 只用于计算完成数和时间，没有作为主计划列表展示。
* `src/main/services/app-service.ts`
  * 暂时只看到 `archiveTodayAndRestart()`，没有面向“完成今天并生成下一天”的服务入口。

### 2. 在 `2/2` 完成状态下进入 Study

操作：

* 点击左侧“学习”。

观察到：

* Study 页面仍显示第一个任务：`环境搭建与项目初始化`。
* 当前步骤显示：`主任务已完成`。
* 操作说明显示：`当前主任务已经通过评价。若还有下一个主任务，可以从今日页继续下一项。`
* 顶部 session bar 仍显示计时 `00:21` 和按钮 `继续`。
* 右侧记录显示 `恢复学习 11:08`，以及多个“完成步骤”。

不合理点：

* Today 已经是 `2/2` 完成，Study 不应该再进入某个已完成任务。
* 文案说“若还有下一个主任务，可以从今日页继续下一项”，但 Today 已经没有下一项，也没有下一天入口。
* 已完成任务上出现“继续”，会让用户以为任务还没结束。

疑似 bug：

* `getCurrentGuideTaskSelection()` 在没有 active/planned task 时 fallback 到 `done` task，导致全完成后仍选中一个已完成任务。
* activeSession / block 状态可能没有被完整清理，导致已完成任务仍有可恢复 session。

疑似代码位置：

* `src/renderer/src/domain/guide-selection.ts`

```ts
task = tasks.find((item) => item.status === 'active')
  ?? tasks.find((item) => item.status === 'planned' || item.status === 'deferred')
  ?? tasks.find((item) => item.status === 'done')
  ?? null;
```

这段 `?? tasks.find(done)` 是完成日仍回到任务的直接嫌疑点。

* `src/renderer/src/pages/StudyPage.tsx`
  * `isNotStarted`、`isActive`、`isPaused` 只看 `activeSessionBelongsToCurrent` 和 session status，没有全日完成态。
* `src/main/services/app-service.ts`
  * `getActiveSession()` 虽然会过滤 `block.status === 'done'`，但实际 UI 仍拿到了可继续状态，说明 `dailyPlanBlocks.status`、`dailyGuideTasks.status`、`studySessions.status` 中至少有一个没有同步为完成。

### 3. 点击已完成任务上的“继续”

操作：

* 在 Study 的已完成任务上点击 `继续`。

观察到：

* 按钮变成 `暂停`。
* 旧任务 `环境搭建与项目初始化` 被重新进入 active session。
* 当前步骤仍显示 `主任务已完成`。
* 计时继续显示 `00:21`。

严重问题：

* 已完成任务可以被重新恢复为进行中。
* 这会制造“Today 是 2/2 完成，但 Study 又在进行旧任务”的双重事实源。
* 用户体验上就是“两个任务完成以后又跳回到任务中去了，也无法结束”。

疑似 bug：

* `sessions.start(blockId)` 对已完成 block/task 没有后端保护。
* `StudyPage` 没有在 `taskDone` 或 `all tasks done` 时禁用 pause/resume/start。
* 恢复 session 时可能重用 paused session，即便对应 task 已经 done。

疑似代码位置：

* `src/main/services/store.ts`
  * `startSession(blockId)` 查找 paused session 后直接恢复，没有看到基于 block/task done 的拒绝逻辑。
* `src/main/services/app-service.ts`
  * `startSession(blockId)` 没有校验 block/task 是否已完成。
* `src/renderer/src/pages/StudyPage.tsx`
  * 已完成任务仍渲染 session bar 的继续/暂停操作。

### 4. 回到 Today 检查状态

操作：

* 点击 Today。

观察到：

* Today 仍显示 `2/2`、`100%`、`25 分钟`。
* 看不出后台刚刚把旧任务重新激活。

问题：

* Today 和 Study 同时成立两个互相矛盾的状态：
  * Today：学习日已完成。
  * Study：旧任务正在进行，可暂停。
* 这说明 Today 只看 `dailyGuideTasks.status`，Study 还受 `activeSession` / `dailyPlanBlocks` / runtime 指针影响。

### 5. 进入 Review 检查结束和下一天入口

操作：

* 点击 Review。
* 向下滚动查看完整页面。

观察到：

* Review 显示 `今日完成 2/2 任务`、`学习时长 25 分钟`、`完成率 100%`。
* “本次学习总结”显示两个已完成任务标签：
  * `已完成：环境搭建与项目初始化`
  * `已完成：创建PersonalInfo组件并渲染`
* 有 `生成 AI 复盘` 按钮。
* “下一步建议”仍显示：`保持当前节奏，继续完成剩余任务`。
* 页面没有 `结束今天`、`开启下一天`、`生成明天任务`、`归档今日并进入下一天` 等入口。

未执行操作：

* 没有点击 `生成 AI 复盘`。当前应用配置了真实 DeepSeek，点击会把学习上下文发送到外部模型；本轮未获得明确外部传输确认，所以只验证本地 UI 和状态。

不合理点：

* 100% 完成时仍提示“继续完成剩余任务”，文案与事实冲突。
* Review 像是只做回顾，没有承担“完成学习日 -> 下一天”的流程出口。
* 如果产品期望生成 AI 复盘后才出现下一天入口，这个约束没有在 UI 上表达。

疑似代码位置：

* `src/renderer/src/pages/ReviewPage.tsx`
  * `suggestionItems` fallback 仍可能是“保持当前节奏，继续完成剩余任务”。
  * 页面只提供 `onGenerate`，没有 `onFinishDay` / `onGenerateNextDay`。
* `src/main/services/app-service.ts`
  * 缺少显式 `completeTodayAndGenerateNextGuide` 或类似服务。
* `src/main/services/store.ts`
  * 已有 `archiveTodayGuides(date)`，但这是“归档并重新开始目标访谈”，不是“进入下一天任务”。

## 复现到的核心问题

### P0：完成日仍可回到已完成任务并继续计时

复现步骤：

1. 启动时 Today 显示 `2/2`。
2. 点击 Study。
3. 页面显示第一个已完成任务 `环境搭建与项目初始化`。
4. 点击 `继续`。
5. 旧任务变成可暂停的 active session。

影响：

* 主流程无法收束。
* 用户会认为任务完成无效。
* 可能导致重复计时、重复 session、重复提交，进一步污染统计。

优先修复方向：

* 完成任务不允许 `startSession(blockId)`。
* 全部任务 done 时，`getCurrentGuideTaskSelection()` 不应 fallback 到 done task，而应返回 `null` 或 `dayCompleted` 状态。
* Study 页需要全日完成态，不渲染任务 session 控制。

### P0：没有开启下一天的可见主流程

复现步骤：

1. Today 显示 `2/2` 完成。
2. Review 显示 `2/2`、`100%`。
3. 页面没有任何“下一天/明天任务/结束今天”的入口。

影响：

* 学习闭环停在当天。
* 用户只能“重新开始新计划”，这会误伤当前长期目标。

优先修复方向：

* 明确产品动作：`结束今天并生成下一天执行稿`。
* Review 或 Today 完成态提供主按钮。
* 后端提供明确服务，而不是复用“archive today and restart”。

### P1：Today 不显示今日完整任务计划

观察：

* Today 主区域显示 roadmap 阶段。
* `guide.tasks` 没有作为“今日任务列表”完整展示。

影响：

* 用户无法从主页面确认今天有哪些任务、哪些完成、哪些剩余。
* 完成后也无法看到任务级闭环，只看到 roadmap。

修复方向：

* Today 主页面显示今日任务列表：
  * title
  * status
  * estimatedMinutes
  * progressPercent
  * currentAction / completedActions
* roadmap 可以降级为侧栏/折叠摘要。

### P1：Review 完成态文案仍像未完成

观察：

* `2/2`、`100%` 时仍显示“保持当前节奏，继续完成剩余任务”。

影响：

* 用户不知道接下来应该结束、复盘还是继续学习。

修复方向：

* 当 `tasksDone === tasksTotal` 时 fallback 建议应为：
  * “今天任务已完成，可以生成复盘并开启下一天。”
* 如果未完成才显示“继续完成剩余任务”。

### P1：状态源可能仍分裂

观察：

* Today 和 Review 看 `dailyGuideTasks` 是完成。
* Study 仍能通过 `activeSession` / `runtime` / `dailyPlanBlocks` 回到旧任务。

疑似涉及表/状态：

* `daily_guide_tasks.status`
* `daily_plan_blocks.status`
* `study_sessions.status`
* `learning_runtime_state.activeDailyTaskId`
* `learning_runtime_state.sessionStatus`

修复方向：

* 定义唯一主事实：
  * 今日任务完成状态以 `daily_guide_tasks.status` 为准。
  * session 只能是当前未完成 task 的附属状态。
* 当 task done：
  * 对应 `daily_plan_blocks.status = done`
  * 对应 active/paused session 必须 complete
  * runtime 不得指向该 task 作为可恢复任务

## Debug Plan

### 第一阶段：加状态守卫，阻止已完成任务复活

1. 后端守卫：
   * 在 `AppService.startSession(blockId)` 或 `StudyStore.startSession(blockId)` 中读取 block 和 guide task。
   * 如果 block/task 已 done/skipped/deferred，直接抛出用户可理解错误。

2. 前端守卫：
   * `StudyPage` 中如果 `currentTask.status === 'done'`，不渲染“开始/继续/暂停/提交”。
   * 如果 `guide.tasks.every(task => task.status === 'done')`，渲染“今日任务已全部完成”的完成态。

3. 选择器修复：
   * 修改 `getCurrentGuideTaskSelection()`：
     * 优先 activeSession，但如果任务 done，忽略。
     * 优先 runtime，但如果任务 done，忽略。
     * 找 active/planned/deferred。
     * 不再 fallback 到 done task。
     * 若全 done，返回 `{ task: null, planBlockId: null }` 或新增 `dayCompleted`。

4. 回归测试：
   * 构造两个 done tasks，断言 selection 为 null/dayCompleted。
   * 对 done block 调用 `startSession`，断言拒绝。

### 第二阶段：统一完成时的状态写入

1. 在任务评价通过后的同一个事务/流程中同步：
   * `daily_guide_tasks.status = done`
   * `daily_plan_blocks.status = done`
   * active/paused `study_sessions.status = completed`
   * `learning_runtime_state.sessionStatus = completed`
   * 如果还有下一个 task，runtime 指向下一个 planned task，但不创建 active session。
   * 如果没有下一个 task，runtime 进入 `day_completed` 或等价 idle/completed 态。

2. 检查 `store.persistExecutionState()`。
   * 当前看到 task done 时会更新 block done，但仍需要验证最后一个任务 done 后 runtime 是否残留旧 block。

3. 增加端到端服务测试：
   * 完成第 1 个任务 -> activeSession null，runtime 指向第 2 个任务未开始。
   * 完成第 2 个任务 -> activeSession null，runtime 不指向任何可继续旧任务，Today 2/2，Study 完成态。

### 第三阶段：补“结束今天 / 下一天”主流程

1. 产品动作定义：
   * `finishTodayAndPrepareNextDay`
   * 输入：当前 goalId / guideId。
   * 行为：
     * 确认今日所有任务 done，或允许用户确认未完成任务 carryover。
     * 生成下一天 Daily Guide。
     * 当前 guide archived/completed。
     * 新 guide draft/confirmed 进入 Today。

2. UI 入口：
   * Today `2/2` 完成态显示主按钮：`开启下一天任务`。
   * Review `2/2` 完成态显示主按钮：`完成复盘并生成下一天`。
   * 如果必须先生成 AI 复盘，按钮文案应表达：`先生成复盘，再开启下一天`。

3. 后端 API：
   * 不复用 `archiveTodayAndRestart()`，因为那是重开目标访谈。
   * 新增独立 IPC/preload 方法，语义必须是“沿当前目标继续下一天”。

4. 测试：
   * 完成当天全部任务后调用 next-day 服务。
   * 断言新 guide.date 为下一天，旧 guide 不再作为 today active guide。

### 第四阶段：Today 显示完整今日计划

1. Today 主区域改为任务列表优先：
   * 今日任务 1：状态、进度、预计时间、当前动作。
   * 今日任务 2：状态、进度、预计时间、当前动作。
   * 全部完成时显示完成态和下一天 CTA。

2. Roadmap 只作为上下文：
   * 可以折叠或放右侧，不替代今日计划。

3. 回归：
   * 有 2 个 guide.tasks 时，Today 必须渲染 2 个任务标题。

### 第五阶段：文案与状态收束

1. Study 完成态文案：
   * 如果当前 task done 但还有下一 task：显示“当前任务已完成，请开始下一任务”，并给出下一任务标题，但不要允许继续旧任务。
   * 如果全部 done：显示“今日任务已全部完成”，只引导去 Review/下一天。

2. Review fallback 文案：
   * `tasksDone === tasksTotal`：不要说“继续完成剩余任务”。
   * 改为“今日任务已完成，可以生成复盘并开启下一天。”

3. Today 完成态文案：
   * 替换“开始、暂停、提交都在学习页完成”为“今日任务已完成，可以复盘或开启下一天。”

## 建议验证清单

修复后用同一条真实路径验证：

1. Today 显示两个今日任务，不只显示 roadmap。
2. 完成第一个任务后：
   * Today `1/2`。
   * Study 指向第二个任务未开始。
   * 第一个任务没有继续按钮。
3. 完成第二个任务后：
   * Today `2/2`。
   * Study 显示今日完成态。
   * 没有“开始/继续/暂停/提交”旧任务按钮。
4. Review 显示 `2/2`、`100%`，并提供下一天入口。
5. 点击下一天入口后：
   * 生成或显示下一天 Daily Guide。
   * 旧任务不会再作为可恢复 session 出现。
6. 重启应用后：
   * 不恢复已完成任务 session。
   * Today/Study/Review 对完成状态一致。
