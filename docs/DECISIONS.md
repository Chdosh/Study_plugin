# 产品与架构决策账本

状态：CURRENT  
生效日期：2026-07-23  
适用范围：产品语义、AI 教师、学习闭环、状态所有权、数据模型、迁移和分阶段实施。  
失效条件：对应决策被用户以新的决策编号明确替代。

本文件只记录已经由用户确认的决定，不记录临时推理、候选方案或尚待确认的实现细节。

维护规则：

1. 决策编号永久稳定，不重排、不复用。
2. 新确认的决定追加到对应日期下，不静默改写旧决定。
3. 决策发生变化时，追加新的决策并明确写出 `替代 Dxxx`。
4. 代码、旧测试或旧文档与本文件冲突时，它们只表示当前实现，不得反向覆盖已确认的产品决定。
5. 每个实施 Phase 开始前，把该 Phase 涉及的决策同步进 `AGENTS.md` 实际 diff，并列出将删除的旧复杂度。

## 2026-07-23 产品宪法确认

- D001: Task 状态 = `planned/active/deferred/closed`，`closureKind = completed/partial/abandoned/replaced`。
- D002: 评价不推进 Task，只保存 `direction + recommendation`；评价是后续教学的依据，不是关闭 Task 的通过门槛。
- D003: 统一 Agent Loop，现有 8 个独立 Agent 改为由同一 Loop 调用的工具；新增能力通过新增工具实现，不新增 Agent。
- D004: `ask_user` 可以在对话流中暂停当前 Agent Run，用户回答后恢复同一个逻辑 Run，不拆成两个互不相关的 AI 调用。
- D005: 删除 `task_items`、`next_step_decisions`、`plan_adjustment_proposals`；历史数据分别合并到 `daily_guide_tasks` 和 `learning_evaluations`，并通过迁移及回滚脚本处理。
- D006: 事件总线使用内存 `EventBus`，不增加 `outbox_events` 或 `event_deliveries`，不实现可靠投递机制。
- D007: AI 教师与结构化学习系统相辅相成、地位对等；任何一方都不是唯一主角。结构负责可恢复事实和操作，教师负责理解、教学、追问、评价与调整。
- D008: 产品帮助用户把模糊、长期、容易中断的学习目标转化为可持续执行、可恢复、可评价、可动态调整的学习过程，最终形成可应用能力或现实成果。
- D009: Task、Action 和 Focus Session 是组织与记录工具，不是所有学习行为的硬前置条件；自由提问、临时解释和探索性学习可以先发生，再按需要结构化。
- D010: Task 是可跨多次对话和 Session 推进的学习单元，不是固定时长、固定内容类型或单次提交容器。
- D011: Action 是 Task 内的建议性或必要性执行步骤，可以推荐顺序，但不得以“必须逐项勾完”作为继续学习、提交、评价或关闭 Task 的统一硬门槛。
- D012: Focus Session 只记录一次实际专注过程，可暂停、恢复和结束；它不拥有 Task 状态，不是对话、提交、评价或学习记录的前置条件。
- D013: Session 与 Task 生命周期保持对称独立：结束 Session 不隐式改变 Task，关闭 Task 也不隐式结束 Session。若用户在存在活动 Session 时同时结束 Session 并关闭 Task，必须作为一次用户显式复合操作在同一事务中执行，并分别产生两个领域事实。
- D014: 涉及用户授权的产品文案和规则统一使用“用户显式操作”，不再混用“用户手写”“用户主动写”等表述。
- D015: `recommend_task_closure` 只产生关闭建议。用户同意后，由 `CommandGateway` 调用 `ExecutionRuntime`；`ExecutionRuntime` 是 Task 状态变更的唯一 owner。
- D016: `recommend_task_closure` 在 UI 中表现为非阻塞建议卡。主操作是关闭 Task，次级操作是继续或暂缓；存在未结束 Action 或活动 Session 时必须明确提示处理方式，并记录 `accepted/declined/deferred`，不能替用户静默关闭。
- D017: 对话的长期作用域统一绑定 Goal；Task 和 Action 只作为消息级锚点。使用消息字段 `linked_goal_id`，不创建 `conversation_goal_references`。
- D018: 临时学习可以先独立存在；后来关联 Goal 时只新增引用，不改变原记录归属，不迁移或改写原始历史。
- D019: 旧 `in_progress` 状态统一迁移为 `active`。
- D020: 日期不是 Learning Guide 的业务身份，只是生成时间、建议日期或历史索引。`Daily Guide` 不再作为长期产品语义或新增代码命名；统一使用 `Learning Guide`，旧 `daily_*` 名称只可作为迁移期兼容实现，不能继续扩散。
- D021: Goal 和 Roadmap 相对稳定，近期计划滚动调整，具体讲解、练习和 Action 顺序可以动态变化；默认渐进披露当前重点与近期方向，不把完整数据库层级直接展示给用户。
- D022: 计划依赖关系可以提供建议和风险提示，但不锁死学习顺序。临时插入、跳转、延后和回退必须保留原学习位置，并能解释变化原因。
- D023: 正式成果与过程证据必须区分。一个 Task 支持多份成果、多种类型和多次尝试；原始提交、过程证据和历次评价均保留，不能只保留最后版本。
- D024: 用户可以质疑、纠正或拒绝评价。修正以新版本追加，保留原评价、修正原因、证据和来源，不直接覆盖历史。
- D025: 评价结果中的 `advance/stay/remediate`（或最终确认的等价枚举）属于 `direction`，不是 Task 正式状态；它与推荐内容一起存入 `learning_evaluations`。
- D026: 每次有价值的评价生成一句上下文化 Self-Note，例如“用户对闭包捕获变量仍不稳定”。后续教学默认引用 Self-Note 和相关知识结论，而不是反复注入完整原始 Submission。
- D027: 个人知识状态由多次 Self-Note、练习、成果、间隔回忆和用户纠正共同推导；一次表现不能直接固化为长期掌握结论，派生知识不能覆盖原始事实。
- D028: 模型失败不能阻塞学习。用户输入和成果必须先持久化；AI 失败后仍可继续学习、切换 Task，并能重试评价或生成。
- D029: 对话入口和按钮入口必须产生相同领域结果，最终调用同一业务命令、校验、事务和状态 owner，不能分别维护两套状态推进逻辑。
- D030: 重大计划调整、Goal 变更、删除数据和不可逆操作必须由用户确认；更换讲解方式、增加示例、调整练习难度和插入短补充内容可以在既定边界内自动进行。
- D031: 统一 Agent Loop 的基础工具至少包括 `explain`、`quiz`、`practice`、`evaluate`、`search_kb`、`ask_user`；规划、复盘等现有 AI 能力也通过 Tool Registry 动态挂载。
- D032: 不新建 `agent_runs` 和 `agent_tool_invocations`；扩展 `ai_reviews` 统一记录 Agent Run、工具调用、状态、关联关系和可恢复信息。
- D033: AI 或业务输出通过内存 EventBus 分发给 UI 更新、审计日志和知识状态消费者；三者解耦。AppService 中现有串行“审计 + 知识更新”编排必须在对应 Phase 删除。
- D034: 每增加一个新设计，必须明确消灭哪些旧复杂度；每份切片方案都必须有“删除什么”，没有删除计划不批准实施，迁移期不得留下无期限双写。
- D035: Agent Loop 实施时，删除现有 8 个独立 Agent 类及其独立 prompt 文件，并删除 AppService 中与它们对应的分散编排。
- D036: Task 新语义实施时，将 `task_items` 数据合并进 `daily_guide_tasks`，停止旧表读写后再废弃旧表。
- D037: 新评价存储实施时，将 `next_step_decisions` 和 `plan_adjustment_proposals` 数据合并进 `learning_evaluations`，停止旧表读写后再废弃旧表。
- D038: `daily_plans`、`daily_plan_blocks`、`learning_steps` 只有在确认无真实读写后才能标记 deprecated 并在适配层隔离。当前只读审计发现它们仍有可达读写，因此不把直接废弃列入已批准修改。
- D039: 改造分三个 Phase 提交。Phase 1 只实施 Agent Loop、`ask_user` 和 Tool Registry；Task/Session 状态语义、数据归并、Self-Notes、EventBus 和界面收口进入后续 Phase。
- D040: 每个 Phase 开始编码前必须提交对应的 `AGENTS.md` 实际 diff，不接受只有文字描述的规则变更。
- D041: 每个数据库迁移脚本必须同时提供可执行的回滚 SQL，并验证旧库前向迁移、回滚和再次迁移。
- D042: 个人知识库积累是主学习闭环的一部分，不是附属统计。原始证据负责可追溯，Self-Notes 负责压缩，知识状态负责跨多次证据聚合，三者不得混成一份可互相覆盖的数据。
- D043: 用户侧不使用看似精确的掌握度百分比作为硬门槛；系统可以表达“需要巩固、初步理解、能够应用、长期稳定”等有证据支持的判断，并允许用户查看和纠正。
- D044: 专注监测是可选辅助能力，默认最小化采集并允许关闭；不得记录具体输入内容，也不得让监测结果直接推进核心学习状态。

## 当前已知冲突（尚未实施）

以下内容用于防止把“已确认目标”误认为“当前代码已经完成”：

- `AGENTS.md` 仍写着“全部 Action 终态后等待提交、评价通过后 Task 才完成”，与 D001、D002、D011 冲突；应在对应 Phase 的实际 diff 中删除。
- `AGENTS.md` 当前把 `Daily Guide` 当作正式产品语义，与 D020 冲突；应在 Phase 2 统一。
- `docs/rules/ARCHITECTURE_DATA_COMPATIBILITY.md` 仍把 `plan_adjustment_proposals` 列为主流程数据，并保留“评价成功后应用业务状态”的旧规则，与 D002、D005、D025、D037 冲突。
- Phase 1 分支已删除 8 个独立 Agent、独立 prompt 和对应的分散 AppService 编排；旧表读写仍属于后续 Phase，不能在 Phase 1 提前改动。

在对应 Phase 完成前，不得用临时双写、别名包装或页面局部状态假装冲突已经消失。
