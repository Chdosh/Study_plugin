# 项目现状与 goal.md 构想对比分析

> 状态：ACTIVE
> 用途：将 `docs/v2/goal.md`（原始构想）与 2026-07-06 实际代码库对照，识别缺口、评估进度、给出不新增功能的逐步收敛路线。
> 边界：本文件不替代 AGENTS.md 或任何专题文档；仅回答"我们现在在哪里、距离原目标多远、下一步先做什么"。
> 方法：对照 goal.md 逐节审阅 schema、service、IPC、renderer、测试文件，以"typecheck / test / build 均通过"为 MVP 口径，以 goal.md 描述的完整闭环为目标口径。

---

## 一、总体进度评估

| 维度 | goal.md 要求度 | 当前完善度 | 说明 |
|------|:--:|:--:|------|
| 产品闭环流程 | 完整闭环 | **90%** | 主流程已跑通访谈-计划-执行-提交-评价-复盘 |
| 状态与流程 | 多层级状态机 | **85%** | 领域状态机 + runtime 指针恢复 + 中断恢复已有 |
| 上下文管理 | 多层上下文+冲突处理 | **60%** | ContextBuilder 已统一入口，缺少冲突/失效/预算机制 |
| AI 调用管理 | 统一入口 | **70%** | AiClient + Agents 统一，缺少 token 统计/版本追踪 |
| 知识库/错题本 | 独立知识沉淀 | **15%** | 仅有 evaluation.misconceptions 字段，无独立知识库 |
| 计划版本与历史 | 草稿-生效-归档 | **40%** | plan_versions 表只写不读，调整逻辑未闭环 |
| 事务与幂等 | 明确事务边界 | **35%** | 有内存 generationLock，无幂等键/事务日志 |
| 时间规则 | 自然日/学习日 | **10%** | 朴素 UTC `slice(0,10)`，无跨天逻辑 |
| 日志与可观测 | 完整调用链 | **30%** | ai_reviews 审计表已有 schema，缺 token/耗时/调用链 |
| 测试 | 四层测试体系 | **55%** | 纯逻辑 + DB 集成已有，端到端 Recovery 测试有，AI 契约测试需 opt-in |
| 数据迁移 | 显式迁移+回滚 | **50%** | 迁移文件存在，缺回滚/完整性检查 |

**综合进度：约 45-50%。** MVP 主流程已经稳定可跑，但 goal.md 中"健壮的系统级能力"缺口较大。

---

## 二、goal.md 各节现状对照

| 章节 | 完成度代号 | 当前状态 | 主要缺口 |
|------|:--:|------|------|
| 一、产品闭环 | 已实现 | 访谈-分层计划-今日主任务-执行-提问-提交-评价-复盘 已实现 | 跨天自动推进未闭合 |
| 二、访谈需求 | 已实现 | GoalIntakeAgent + goal_intakes/messages + 自动结束访谈已落地 | 偏好/资源/约束的追问深度偏浅 |
| 三、计划体系 | 已实现 | 三层结构已有：roadmap_stages / short_plan_days / daily_guide_tasks | 近期计划只有前 3 天，无更长周期自动推进 |
| 四、当天学习 | 已实现 | startSession + 完成/跳过 Action + 提问 + 提交都已实现 | — |
| 五、提交与评估 | 已实现 | local + ai 两种评价模式；状态机处理推进；不覆盖旧提交 | 多尝试历史保留未展示 UI |
| 六、知识库/错题本 | 未实现 | 仅有 evaluation.misconceptions 字段，无独立知识库表、无错题复习、无掌握度追踪 | 核心缺口 |
| 七、复盘与调整 | 半实现 | ReflectionAgent 生成复盘已落地；但无"基于复盘调整后续计划"的闭环 | 复盘未驱动 short_plan 更新 |
| 八、上下文分层 | 半实现 | ContextBuilder 统一入口；7 层信息（L0-L7）部分实现 | 无用户画像摘要、无冲突仲裁、无失效机制、无预算裁剪 |
| 九、事实/摘要分层 | 未实现 | 当前只有 raw 记录 + ai_reviews；无分层摘要、无可信度排序 | — |
| 十、冲突/失效/预算 | 未实现 | 全缺 | 关键系统级缺口 |
| 十一、AI 调用管理 | 半实现 | AiClient 统一，一次 repair；8 个 Agent 各有契约 | 无 token 统计、无版本追踪回查、无成本统计 |
| 十二、状态管理 | 已实现 | execution-state-machine 单一事实源；runtime 状态集中 | — |
| 十三、用户动作清单 | 半实现 | 已实现的动作集合见 IPC 清单（32 通道） | 无缺失/重复执行的幂等保护说明文档 |
| 十四、事务/中断恢复 | 半实现 | 提交-评估 两阶段已有；重启恢复已有 | 提交后 AI 失败时的恢复路径未显式标记（awaiting_result 状态已存在但 UI 未暴露） |
| 十五、幂等 | 未实现 | 仅内存 generationLock 防并发日生成；无持久幂等键 | — |
| 十六、计划版本 | 半实现 | plan_versions 表已写 snapshot；但无版本对比/回滚/拒绝路径 | — |
| 十七、时间规则 | 未实现 | 朴素 UTC 日期，无自然日/学习日选择，无跨天会话保留逻辑 | — |
| 十八、用户控制权 | 半实现 | 拒绝调整/确认目标/暂停目标已有 | 修改目标 / 暂停目标 / 修改每日可用时间 入口不完整 |
| 十九、UI 边界 | 已实现 | UI 不直接读写 DB，通过 IPC 调用 service | — |
| 二十、异步状态/错误 | 半实现 | 有 loading/notice 提示；有 try/catch 转用户语言 | 调用链中关闭页面 / 请求完成但页面无响应 未处理 |
| 二十一、日志/可观测 | 未实现 | ai_reviews 审计已落地；缺 token/耗时/调用链/错误分类 | — |
| 二十二、数据迁移 | 半实现 | 有 migration.ts 文件 | 缺启动完整性检查 / 迁移失败回滚 / 用户数据导出 |
| 二十三、四层测试 | 半实现 | 纯逻辑已实现、DB 集成已实现、AI 契约 opt-in 已实现 | 端到端跨天/异常流测试不足 |
| 二十四、Token/成本 | 未实现 | ai_reviews 无 token 字段；无统计入口 | — |
| 二十五、隐私 | 已实现 | contextIsolation、safeStorage、snapshot 不含 key | — |
| 二十六、当前实际 | 准确 | 文档准确描述了当时困境；已做过多轮收敛 | 旧表仍在 schema 中 |
| 二十七、原则 | 已实现 | 大部分已在 AGENTS.md / 专题文档中落地 | — |
| 二十八、希望分析 | 已完成 | 本文即回答 | — |
| 二十九、期望结果 | — | 详见下方「逐步操作」 | — |

**代号说明**：已实现 = goal 要求的核心能力已落地；半实现 = 有基础实现但距 goal 描述的完整度仍有距离；未实现 = 基本无对应实现。

---

## 三、关键差距

1. **知识库是最大缺口** -- goal 第 6/9 节强调的个人知识沉淀（错题、掌握度、可追溯证据）当前几乎为 0。只有 `evaluation.misconceptions` 字段做了临时承载，没有独立表、没有复习闭环、没有掌握度追踪。

2. **上下文治理停留在"统一入口"阶段** -- ContextBuilder 提供了统一出口，但没有冲突仲裁、失效机制、token 预算裁剪。每次调用的上下文仍会随历史增长而膨胀。

3. **计划调整是断链的** -- 复盘生成后没有真正修改 `short_plan_days` 的闭环。`plan_versions` 表只写不读，调整从未真正生效。

4. **可观测性不足** -- `ai_reviews` 审计表有 schema 但缺 token / 耗时 / 调用链 ID。AI 失败时根因仍难以快速定位。

5. **时间假设是朴素的** -- UTC 日期切片，无跨天逻辑，无"学习日"概念。这在后期跨天继续学习时会出 BUG。

6. **幂等 / 事务边界未显式** -- 双击提交、中断恢复、超时重试等场景缺少持久化保护。仅依赖内存 Map 的 generationLock 在进程重启后失效。

---

## 四、可执行程度评估

| 场景 | 当前能力 | 说明 |
|------|:--:|------|
| 新目标-访谈-计划-第一天执行-提问-提交-评价-复盘 | 可执行 | 主流程完整可用 |
| 同一天内重试失败提交 | 可执行 | evaluation 链式保存 |
| 跨天继续（第一天仅完成 1/3，第二天接着） | 部分可执行 | 能恢复当前 action，但不会自动合并未完成 short_plan |
| 真实 DeepSeek 合约测试 | opt-in | `RUN_DEEPSEEK_CONTRACT=1 npm.cmd test -- src/main/ai/deepseek-contract.test.ts` |
| 人为制造 AI schema 失败-系统降级 | 可执行 | 写入 ai_reviews.failed，UI 提示重试 |
| 完成主任务后进入下一主任务 | 可执行 | execution-state-machine 自动推进 |
| 所有任务完成后自动完成当天 | 可执行 | `completeLearningDay` |
| 展示个人错题/知识库 | 不可执行 | 无此界面和内容 |
| 复盘后自动调整明天计划 | 不可执行 | 复盘只读不改 short_plan |
| 三天未使用软件后重开 | 部分可执行 | 能恢复到当前 action，但不处理"日历跳跃" |

**MVP 下限可跑闭环**，**goal.md 构想的完整闭环还需要系统级补强**。

---

## 五、逐步操作路线

下表给出"先把现有代码做稳、再逐项补齐 goal 要求"的推荐顺序。每步以**能真实跑通端到端验收**为完成标志，不凭 typecheck 自喻完成。

### 第一阶段：日志 + 上下文可观测（让 Bug 不再"随机"）

**Step 1.1** -- ai_reviews 表增加 `inputTokens` / `outputTokens` / `latencyMs` / `errorCategory` 四个 nullable 列（迁移）。AIMetrics 由 AiClient 在每次调用结束后写入。验收：查看 ai_reviews 能看到每次调用耗时和 token。

**Step 1.2** -- ai_reviews 中增加 `traceId`（调用链 ID）。让 AppService 每个公开入口生成一个 traceId 贯穿整条调用链。验收：提交失败时能从 ai_reviews 沿 traceId 回溯整条链路。

**Step 1.3** -- 为 AppService 输出结构化错误分类（`user_input_error` / `ai_failure` / `schema_violation` / `db_error`），UI 按分类给出不同提示，不再是统一的"生成失败"。验收：关闭 API key + schema 失败 + 网络超时三种场景 UI 文案各不相同。

### 第二阶段：事务 + 幂等（让中断和重复不再危险）

**Step 2.1** 明确提交-保存提交记录-AI 评价-保存评价-激活下一步五阶段的事务边界。在 `learning_submissions` 上增加 `evaluation_status`（waiting/completed/failed）。验收：提交后 AI 超时不丢提交；重启应用能看到"等待重试的提交"入口。

**Step 2.2** 为今日计划生成增加持久幂等锁（当前 generationLock 是内存锁，进程重启失效）。在 app_settings 或新增 generation_locks 表中写入 `goalId+date+operation` 锁标记。验收：并发调用 `prepareCurrentLearningDay` 只触发一次 AI 调用。

**Step 2.3** 为 `confirmGoal` / `confirmDailyGuide` / `askQuestion` 设计幂等键逻辑，明确"用户明确重试"与"网络重试"的区别。验收：双击按钮不产生重复消息。

### 第三阶段：上下文裁剪 + 规则（让 AI 只拿该拿的）

**Step 3.1** 为 ContextBuilder 增加 operation 级别上下文预算：
- `goal_intake`：只保留最近 12 条 messages + 长期摘要（未来再加）
- `teach_step`：只保留当前 action + 最近 2 条摘要
- `answer_step_question`：current question_thread 最后 4 条 + 当前 action
- `evaluate_submission`：任务 doneWhen + 本次提交 + 上一次提交
- `generate_daily_guide`：当前 roadmap + targetDay + 前一天 evaluation 摘要
验收：prompt 拼接后 token 长度可预估，不随历史增长无限膨胀。

**Step 3.2** 在 context-builder 中实现冲突仲裁：
- 时间限制以最后一次用户明确确认为准
- 基础知识以最近 3 次评估的交集为准（暂时只保留规则接口，不调 AI）
验收：上下文冲突场景（user 先说 3 小时/天，后改 1 小时）prompt 中使用新值。

**Step 3.3** 实现上下文失效：snapshot 超过 30 天、任务已完成的事件，在上下文组装时折叠为一行摘要。验收：已完成超过 30 天的任务详情不再进入 prompt。

### 第四阶段：计划版本 + 调整闭环（让复盘真正影响明天）

**Step 4.1** 启用 `plan_versions` 只读能力：每次 `roadmap_stages + short_plan_days` 插入前，先 snapshot 当前版本。验收：能查询某个 goal 过去 3 次计划的快照。

**Step 4.2** 实现 `reviews -> adjustShortPlan` 链路：在 ReflectionAgent 输出中新增 `shortPlanAdjustments` schema；用户确认后更新 short_plan_days。验收：复盘后点击"应用建议"会修改明天及之后的 short_plan_days，不影响昨天。

**Step 4.3** 为已执行 short_plan_days 加 `locked` 标记，防止被调整覆盖。验收：已确认 daily_guide 关联的 shortPlanDay 不会被调整覆盖。

### 第五阶段：个人知识库 / 错题本

**Step 5.1** 新增 `knowledge_items` 表（id, goalId, key, summary, sourceType, sourceId, status, confidence, createdAt, updatedAt）。在 `applyEvaluationResult` 命中 `misconceptions` 时写入。验收：一次 failed 提交后生成对应 misconception 记录。

**Step 5.2** 在 `evaluate_submission` 调用前检索相关 `knowledge_items`，把用户过去同类错误塞入 prompt。验收：用户连续两次犯同一个错误时，AI 评价会提到之前遇到的类似问题。

**Step 5.3** 知识库 item 增加复习触发规则：同一 misconception 出现 >=2 次，自动加入建议复习队列。在 daily guide 生成时预留 5-10 分钟复习 slot。验收：连续错同一知识点后，下一天的 daily guide 自动增加复习任务。

### 第六阶段：时间规则 + 跨天

**Step 6.1** 将 `todayIso()` 替换为带本地时区的"学习日划分"函数：默认自然日；未来可配置学习日起止时刻（如凌晨 4 点切换）。验收：用户在凌晨 1 点学习时，不会跨到"明天"。

**Step 6.2** 为 `daily_guides` 增加 `startedAt` / `completedAt`，支持未完成顺延查询。应用启动时检测是否有 dailyGuide tasks 未 all done，提供"恢复未完成今日学习"入口。验收：第一天只完成 1/3 -> 重启应用 -> Study 页定位到上次 action。

**Step 6.3** 处理"三天未打开"场景：距离上次 `dailyGuide.completedAt` > 3 天时，today 展示"你已离开 N 天，是否重新同步计划"入口。验收：跨周恢复场景不丢数据也不静默错乱。

### 第七阶段：四层测试补齐

**Step 7.1** 完善 mock-data.ts，覆盖"长目标 / 短目标 / 失败重试 / 恢复 / 跨天"五种端到端 fixture。验收：`npm test` 包含以上五种端到端路径。

**Step 7.2** 编写 fake AI contract tests：schema 缺失字段 / 类型错 / 中文枚举错 / 自相矛盾共 11 种异常场景。验收：全部 11 种在 schema.test.ts 中通过。

**Step 7.3** 补充"应用启动时发现等待重试的提交"的恢复集成测试。验收：提交后杀死主进程 -> 重启 -> 测试自动定位到 waiting 状态。

### 第八阶段：知识库 UI + 复盘调整 UI + 文档闭环

**Step 8.1** 在 Today 或 Review 页增加"知识库/错题"入口，展示 knowledge_items。验收：能看见当前 goal 积累的错题数量与掌握度变化。

**Step 8.2** 复盘 UI 增加"应用调整建议"按钮，让用户确认后调整 short_plan。验收：调整前后对比清晰可见。

**Step 8.3** 更新 `docs/PROJECT_OVERVIEW.md` 与 `docs/PROJECT_MEMORY.md`，把完成状态、剩余缺口、下一步记录进去。验收：新对话从 overview 即能看清已完成与待做。

---

## 六、总结

| 维度 | 评估 |
|------|------|
| 主流程 | 已稳定可用 |
| 系统级健壮性 | 缺口明显（日志/事务/幂等/冲突/预算） |
| 知识沉淀 | 未开始 |
| 计划调整闭环 | 复盘只读不改明天 |
| 跨天 / 时间 | 朴素 UTC 假设 |
| 测试完整度 | 端到端和异常路径需补强 |
| 可执行性 | MVP 闭环已好于完整闭环（因 UI 状态收敛较好），但 goal.md 设想的"长期 AI 教师"仍需 Phase 1-4 系统级补强 |

**核心结论**：当前项目已脱离 goal.md 第二十六章描述的失稳状态，进入了稳定但偏窄的 MVP 阶段。到达 goal 描述的完整闭环，下一步不是加 UI 功能或新增字段，而是先把日志 / 事务 / 上下文裁剪 / 计划版本这四类系统基础设施补齐，否则继续堆功能会重新进入连锁 Bug 风险。
