# 产品与工程收敛审计（2026-07-11）

状态：审计快照，不是当前产品事实源，也不直接驱动代码修改。  
用途：暂存 2026-07-11 对产品定位、当前实现、UI、路线进度和真实可用性标准的综合判断。  
事实源仍以 `PRODUCT_TRUTH.md`、`MVP_SPEC.md`、当前代码、迁移和测试为准。

## 1. 总结论

产品最终定位应保持为：一个本地优先、能把模糊学习目标转化为可执行主任务，陪用户完成真实成果，在中断、提问和犯错后恢复，并基于证据调整后续路径的长期 AI 学习教师。

当前已经形成较完整的功能骨架，但不能把“功能骨架完成七成”理解为“真实用户可用度达到七成”。审计估计：

| 维度 | 当前成熟度 |
| --- | --- |
| 产品定位与概念设计 | 80%～85% |
| 数据结构、AI 合约和 IPC 基础 | 70%～80% |
| 理想路径功能骨架 | 65%～70% |
| 失败恢复与状态可靠性 | 45%～55% |
| UI 与真实操作可用性 | 35%～45% |
| 长期用户适应能力 | 25%～35% |
| 综合产品成熟度 | 约 50%～60% |

按 `STEP_ROADMAP.md` 严格完成协议，审计时可认定完成的是 R1、R3、K1、K2、K3；多数其他 Step 只有部分实现。

## 2. 已形成的基础

- 目标访谈、GoalBrief、Roadmap、ShortPlanDay 和 Daily Guide 的分层计划结构。
- DailyGuideTask、Action、Focus Session、Submission、Evaluation 的持久化结构。
- SQLite durable source of truth、typed preload API 和窄 IPC。
- AI 输出运行时校验、有限修复、错误分类、trace 和延迟记录。
- Submission 先保存、评价失败后复用原记录重试。
- 问题线程、知识项、证据、重复误区和复习候选。
- 计划调整只应用到未来未锁定学习单元的部分基础。
- Today、Study、Review、Settings 和 AI 抽屉的页面骨架。

## 3. 最高风险断点

1. 最后一个 Action 完成后可能直接把主任务标记为 done，绕过最终 Submission/Evaluation。
2. skip task 可能按正常完成处理，并因状态机只看到当前单个 Task 而关闭整个 Guide。
3. terminate learning 主要修改 runtime 指针，可能没有同步结束持久化 StudySession。
4. `startNextSession` 与 `generateRollingPlan` 语义和 UI 入口混用。
5. Review、前一日上下文和部分历史仍读取旧 block/step 链路，可能看不到新 Action 主链上的提交和评价。
6. 数据库存储、状态机和 Study UI 存在多套进度算法。
7. Today 待评价中心已有 UI，但审计时 `pendingEvaluations` 仍为静态空数组。
8. runtime audit 已有 Store/IPC 基础，但未形成启动调用和冲突恢复 UI。
9. Review 可能跨日期或目标读取 stale review，实际运行出现过“0/0 任务、10% 完成率、三个任务总结”同时展示。
10. migration 初始化持续出现 duplicate-column 跳过噪声。

## 4. 需求归并

零散需求应归并为四个长期能力：

### Learner Context

保存经过确认的稳定环境事实、基础和偏好。稳定事实影响后续相关 AI 调用，但不自动重写历史计划；当前任务是否修正由用户选择，未来未执行任务通过 proposal 局部调整。

### Learning Branch

统一承载提问、排错、额外练习、概念探索和临时资料。分支必须绑定 goal/task/action，结束时可以仅关闭、沉淀知识、提议学习者事实、提议计划调整或提升为正式任务。

### Learning History

提供计划内任务时间线，记录 Task、Action、Session、Question、Submission、Evaluation、Knowledge Evidence 和 Plan Adjustment，而不是展示全部聊天。

### Adaptation

学习行为先形成 Submission/Evaluation 和知识证据，再生成计划调整 Proposal；用户确认后才修改未来未锁定内容。

## 5. UI 审计结论

- Today：学习路径可辨识，但进度、时长、待处理和全局通知仍不可靠。
- Study：当前任务可辨识，但步骤进度算法、重复“遇到问题”、跳过/终止和提交状态存在冲突。
- AI Drawer：提问/提交是可复用基础，但还不是完整 Learning Branch。
- Review：展示较丰富，但数据事实不可靠，是当前最损害用户信任的页面。
- Settings：DeepSeek 配置已存在，但学习偏好、Prompt Profile 和长期环境事实没有形成可用界面。

UI 不应立即全面换皮。应先修复运行时语义，再进入独立的 P0.5 信息架构和交互基线收敛。

## 6. 推荐深模块

- `LearningRuntime Module`：通过小 Interface 提供 snapshot 和 command dispatch，隐藏 Action、Task、Session、Submission、Evaluation 的事务和状态转换。
- `Planning Module`：统一下一学习单元、滚动续生、调整 proposal 和确认应用。
- `LearnerContext Module`：负责操作级上下文、事实 proposal/confirm、冲突和预算。
- `LearningBranch Module`：负责分支 open/append/resolve/promote。
- `LearningHistory Module`：从正式主链生成任务和目标时间线只读投影。

拆分目标不是把大文件机械切小，而是在稳定 seam 后形成小 Interface、深 Implementation，并让调用者和测试都只跨同一 Interface。

## 7. 推荐迭代顺序

1. M0：冻结新增功能，同步路线状态和事实源。
2. M1：收敛 Action/Task/Submission/Evaluation、skip/defer/abandon、Session、下一学习单元、Review 新主链和 progress。
3. M2：完成 P0.5 UI 信息架构、CommandPolicy、局部反馈和页面职责收敛。
4. M3：实现 LearnerFact 与统一 LearningBranch。
5. M4：任务历史、知识证据详情、PlanVersion 和数据导出恢复。
6. M5：旧库迁移、完整 E2E、真实 DeepSeek、Token 成本和可访问性验收。

## 8. 高度可用标准

- 用户按自然顺序操作不会绕过评价或错误推进。
- 暂停、关闭、重启、跨日后能恢复到同一目标、任务和 Action。
- 跳过、暂缓和放弃不计为掌握，不意外关闭学习日。
- Today、Study、Review 对同一状态给出一致结论。
- 每个完成任务都有可追溯的成果和评价。
- 临时问题不污染长期画像；稳定事实可确认、修改和撤销。
- AI 超时、schema 错误、断网和重复点击不会丢数据或重复写入。
- 连续真实使用 14 天、30 次以上 Session，无数据丢失、错误自动推进或手工修库。

## 9. 审计证据边界

- 审计基于 2026-07-11 的脏工作树，期间存在并发修改，不代表稳定 commit。
- 当时验证：`npm test` 101 passed、6 skipped；typecheck 和 production build 通过。
- 未运行真实 DeepSeek 合约测试。
- 本文是问题与方向快照，不应替代后续按稳定代码快照执行的逐项审查。
