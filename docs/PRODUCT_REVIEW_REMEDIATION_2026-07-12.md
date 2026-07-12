# 产品审查问题与整改计划

状态：ACTIVE  
建立日期：2026-07-12  
用途：记录 2026-07-12 全项目审查发现的问题、真实影响、验收标准和修复证据。本文件是本轮整改的执行清单，不替代 `PRODUCT_TRUTH.md`、`AI_AND_DATA_RULES.md` 或 `STEP_ROADMAP.md`。

## 1. 审查结论

`STEP_ROADMAP` 的 18/20 是状态标签计数，不代表真实高可用完成度。当前代码基础、持久化和单元测试较强，但若严格按各 Step 自己的目标验收，T1、T2、C1、C2、C3、U2、U4 和 UI 黑盒验收均不能视为完成。

整改期间遵循以下规则：

1. 一个产品行为只保留一个正式写入口，不在旧路径旁叠加第二套实现。
2. `completed` 必须同时具备成功、失败、恢复、幂等和用户可见反馈证据。
3. 单元测试数量不代替桌面黑盒、真实模型和连续使用证据。
4. AI 只能提出后果性变化；用户确认后才能改变正式计划或长期事实。
5. 不删除旧数据。兼容收敛必须通过迁移和代表性旧库验证。

## 2. 问题清单

### PR-01 路线图状态与代码事实不一致

- 优先级：P0
- 当前状态：`in_progress`
- 事实：C1 文档声明存在 4000 token 硬预算，但当前 `ContextBuilder` 没有整体预算裁剪；T1 在文档同一版本中同时被描述为 completed 和仍需收敛。
- 用户影响：项目进度被高估，后续工作会错误跳过关键可靠性任务。
- 验收：逐项回退不满足验收的 Step；每个 completed 状态链接到代码、测试或人工验收证据；文档内部无冲突。

### PR-02 LearnerFact 确认和使用边界错误

- 优先级：P0
- 当前状态：`pending`
- 事实：确认不存在的事实会创建空值；推断事实和用户确认事实均直接注入 prompt；缺少 pending/confirmed/rejected 语义。
- 用户影响：系统可能把空值或一次 AI 推断当成长期事实，悄悄改变后续教程。
- 验收：不存在的事实不可直接确认；只有用户确认事实可作为强约束，推断事实只能作为待确认建议；事实可查看、修改、拒绝和撤回；Windows/DeepSeek 等确认事实只影响相关未来操作。

### PR-03 C1 核心操作上下文规格不完整

- 优先级：P0
- 当前状态：`pending`
- 事实：当前操作类型缺少 goal intake、roadmap、short plan、daily guide、review 和 rolling plan；没有集中 token 硬预算；`extra`、冲突和事实可绕过白名单追加。
- 用户影响：prompt 大小和数据边界不可解释，长期使用后可能膨胀或错误携带无关信息。
- 验收：所有核心操作进入统一规格矩阵；定义必须、可选、禁止字段；整体预算集中配置并在所有追加字段后执行；预算测试覆盖大 facts、extra 和问题分支。

### PR-04 C2 冲突仲裁仅为特例规则

- 优先级：P0
- 当前状态：`pending`
- 事实：当前规则依赖“基础扎实”等字符串和少量启发式，没有统一处理用户确认、实际证据、连续评价、旧事实和单次 AI 推断。
- 用户影响：用户纠正环境或偏好后，系统仍可能选择旧信息或不可解释地变化。
- 验收：实现确定性优先级；无法安全仲裁时生成待确认冲突，不静默选择；覆盖全局、目标和任务临时事实；单次临时要求不污染长期事实。

### PR-05 C3 摘要失败状态没有形成闭环

- 优先级：P1
- 当前状态：`pending`
- 事实：现实现只有 stale 折叠，没有摘要任务的 pending/failed、重试和来源生命周期。
- 用户影响：摘要失败后无法解释系统用了什么信息，也无法可靠恢复。
- 验收：摘要失败保留原始记录；保存 pending/failed；重试不发送完整历史；上下文来源元数据覆盖实际使用字段。

### PR-06 T1 评价记录与运行时推进不是完整事务边界

- 优先级：P0
- 当前状态：`pending`
- 事实：Evaluation、Decision、Submission 在事务内；Action、Task、Guide、Runtime Pointer 和 Session 推进在事务外依靠重放。
- 用户影响：中断窗口内页面状态可能暂时矛盾；恢复覆盖面不足时会卡在已评价但未推进状态。
- 验收：明确采用“事务内状态机”或“持久 Saga”之一；若采用 Saga，持久保存 applied 状态并覆盖每个写入中断点；同一 Submission 只应用一次；Session/Guide/Runtime 均可恢复。

### PR-07 T2 计划变化存在两个正式写入口

- 优先级：P0
- 当前状态：`pending`
- 事实：Proposal/Confirm 已存在，但 Review 仍可通过 `applyReviewPlanAdjustments` 直接更新计划。
- 用户影响：部分计划变化缺少 before/after、来源和确认记录，用户无法理解为什么变化。
- 验收：所有 AI 计划变化统一经过一个 Planning Module Interface；拒绝不改变计划；重复确认幂等；旧直写 IPC 删除或降为内部实现；UI 展示差异和来源。

### PR-08 阶段推进把计划耗尽误当成能力达成

- 优先级：P1
- 当前状态：`pending`
- 事实：当前自动推进规则主要依据 ShortPlanDay/Guide 是否耗尽，而非阶段 success criteria 和评价证据。
- 用户影响：用户可能尚未掌握阶段目标，系统却自动进入下一阶段。
- 验收：阶段先进入待复核状态；根据成功标准、评价证据和用户确认推进；计划耗尽只触发复核或滚动计划，不直接代表阶段完成。

### PR-09 Learning Branch 用户闭环不完整

- 优先级：P1
- 当前状态：`pending`
- 事实：主进程已有 promote 确认断点，但 Drawer 没有提升任务和事实提议入口；默认分支标题/关闭摘要存在技术占位文本。
- 用户影响：额外练习和排错无法自然沉淀为正式任务或长期偏好。
- 验收：关闭分支支持仅关闭、沉淀知识、提议事实、提升任务；后两者必须显式确认；关闭后恢复原任务位置；历史显示可理解的中文标题和摘要。

### PR-10 U2 学习时间线没有覆盖真实学习事件

- 优先级：P1
- 当前状态：`pending`
- 事实：Review 只展示任务完成、累计分钟和复盘，没有展示 Session、Submission、Evaluation 和 Plan Change 的统一时间线。
- 用户影响：用户不能回答“我做了什么、何时提交、为什么计划改变”。
- 验收：History Module 返回统一事件投影；Review 按时间展示 Task、Session、Submission、Evaluation、Review、Plan Change；空状态和错误状态明确。

### PR-11 U3 知识证据和失败补录不完整

- 优先级：P1
- 当前状态：`pending`
- 事实：知识 UI 能筛选，但来源主要是技术 ID；评价后知识写入失败缺少可靠重试队列。
- 用户影响：知识结论不可验证，部分学习结果可能没有沉淀。
- 验收：来源可打开到任务、提交和评价证据；记录失败进入待处理中心；补录幂等；知识只影响未来 proposal，不直接修改完成状态。

### PR-12 U4 只有导出，没有恢复

- 优先级：P1
- 当前状态：`pending`
- 事实：设置页能下载 JSON，但没有导入、校验、版本兼容、冲突处理或恢复演练。
- 用户影响：用户以为已有备份能力，但数据损坏或换设备时不能恢复。
- 验收：导入前只读校验；显示版本和影响范围；用户确认后事务导入；冲突不覆盖现有数据；完成 clean/旧版本样本恢复测试。

### PR-13 UI 高可用验收缺少真实证据

- 优先级：P1
- 当前状态：`pending`
- 事实：CommandPolicy 和局部反馈已有代码基线，但缺少 Electron 黑盒、窄窗口、键盘焦点、对比度和陌生用户主流程验收；浏览器无 preload 时显示原始英文错误。
- 用户影响：按钮状态、错误反馈和页面职责可能仍让真实用户困惑。
- 验收：Electron 中完成目标、Today、Study、Branch、Submit、Review 全流程；不可操作控件就地禁用并说明；错误使用中文可行动信息；完成键盘和窄窗口检查。

### PR-14 Q1 Session 锚点收敛不是简单删列

- 优先级：P1
- 当前状态：`pending`
- 事实：旧 block 字段仍参与 Session、skip 和累计时长路径。
- 用户影响：直接删除列可能破坏历史 Session 或旧用户数据库。
- 验收：新 Session 只写 DailyGuideTask 锚点；旧数据只读兼容；迁移不删除用户数据；空库、典型旧库、重复启动和 foreign key 检查通过。

### PR-15 Q3 真实模型与连续使用尚未验收

- 优先级：P2（发布阻断）
- 当前状态：`pending`
- 事实：6 个 DeepSeek 合约测试跳过；没有 14 天/30 Session 连续使用数据。
- 用户影响：无法证明真实网络、真实模型和长期数据增长下仍然可靠。
- 验收：执行一次完整真实 DeepSeek 桌面链路；之后完成 14 天/30 Session 记录；数据丢失、错误推进、重复 Evaluation/Guide、手工修库均为 0。

## 3. 固定执行顺序

```text
批次 A：PR-01 → PR-02 → PR-03 → PR-04 → PR-05
批次 B：PR-06 → PR-07 → PR-08
批次 C：PR-09 → PR-10 → PR-11 → PR-12 → PR-13
批次 D：PR-14
批次 E：PR-15
```

不得在批次 A/B 未稳定前进行大规模视觉重构；不得在 PR-14 迁移验证前删除旧字段；PR-15 真实 DeepSeek 测试保持用户 opt-in。

## 4. 进度记录

| 问题 | 状态 | 验证证据 |
| --- | --- | --- |
| PR-01 | completed | `STEP_ROADMAP` 与执行计划已退回证据不足的完成状态 |
| PR-02 | completed | 空事实拒绝确认；confirmed 防覆盖；prompt 只注入 confirmed；Settings 支持查看、确认、更新和删除；全局/目标/任务作用域有真实持久语义 |
| PR-03 | completed | 核心生成/教学/评价链均接入 ContextBuilder；extra 白名单、最终 4000 token 硬预算和来源 ID 证据已测试 |
| PR-04 | completed | 用户确认 > 连续实际评价 > 旧描述 > 单次判断；同键冲突显式仲裁；task fact 绑定具体 DailyGuideTask |
| PR-05 | completed | AI Review 摘要持久化 pending/ready/failed；失败保留原始数据且只记录错误类别；重试不复用失败记录 |
| PR-06 | completed | evaluation/application 双生命周期；pending/failed 启动重放；最终评价统一推进 Task、Session、Guide、Runtime；缺失依赖显式冲突 |
| PR-07 | completed | 删除 Review 直写 IPC/preload/AppService；所有 AI 计划调整经 proposal/confirm，来源与版本记录统一 |
| PR-08 | completed | 计划耗尽只标记 ready_for_review；删除单次评价直改 Roadmap 旁路；用户在 Review 确认后事务完成阶段并激活下一阶段 |
| PR-09～PR-15 | pending | — |

批次 B 验证基线：`171 passed / 6 skipped`，typecheck 和 production build 通过；迁移 `202607120002_submission_application_lifecycle` 通过空库、旧库和重复启动验证。

批次 A 验证基线：`171 passed / 6 skipped`，typecheck 通过，production build 通过；3 类数据库迁移测试包含 `202607120001_learner_fact_task_anchor`。

## 5. 完成定义

每个问题只有同时满足以下条件才能标记 completed：

1. 产品行为符合事实源。
2. 成功、失败、恢复和幂等路径已实现。
3. 相关测试通过。
4. 涉及 UI 时完成真实 Electron 检查。
5. 本文记录验证命令或人工证据。
6. `STEP_ROADMAP.md` 与 `PROJECT_MEMORY.md` 不再宣称超出证据的完成度。
