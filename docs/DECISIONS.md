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
- D045: Phase 2 的目标是整合现有业务、删除重复事实源和隐式状态、最大限度降低长期复杂度，同时保持现有核心功能不退化；V2 是 V1 的收缩整理，不是重新建设更完整的平台。
- D046: V1→V2 使用完整 V1 归档和干净 V2 数据库一次性切换。取消同库扩展、双写、双读、长期兼容适配和逐步删表方案；D046 替代 D005、D036、D037、D038 中关于同库合并和兼容期的执行方式。
- D047: V1 数据库永久只读归档。只迁移仍有产品价值且可唯一映射的数据；无法唯一映射的数据保留在归档和外部迁移报告中，不为它们增加 Runtime 兼容字段。
- D048: V1→V2 迁移器是独立一次性升级模块，不进入 Store、Runtime、正常查询、日常启动流程或主运行 bundle；源码、测试、版本识别和手动恢复能力长期保留。
- D049: Phase 2 正常 Runtime 使用 23 个现有能力对应的最小业务表；删除 `raw_imports/task_items/plan_stages/task_dependencies/daily_plans/daily_plan_blocks/daily_guide_blocks/learning_steps/next_step_decisions/plan_adjustment_proposals/learning_summaries/focus_events/skip_logs/generation_locks`。
- D050: `learning_tasks.goal_id` 可以为 NULL。临时 Task 后续关联 Goal 时只通过用户显式操作新增引用，不自动创建 Goal，不回写历史 Message、Submission 或 Session。
- D051: Action 保存 `requirement=required/optional`；V1 无法唯一判断的 Action 迁为 optional。required 不得成为提交、评价或关闭 Task 的统一硬门槛。
- D052: difficulty 只允许 `foundation/standard/advanced/NULL`；旧 `exam` 迁为 `task_mode=exam`，其 difficulty 置 NULL。
- D053: 全库最多一个 `active` 或 `paused` 的未结束 Focus Session。`duration_seconds` 只有 Runtime 可以写入，Task 不再缓存累计时长。
- D054: `current_learning_context` 只保留 Goal/Guide/Task/Action 导航指针和版本，不保存 Session、对话、评价、恢复分支或其他业务状态副本；它由一个 persistence owner 写入。
- D055: Submission 直接关联 Task，Goal 可空；它只保存原始提交事实，不保存评价和应用状态副本。评价运行状态从 `ai_reviews` 推导，评价结果从 `learning_evaluations` 查询。
- D056: `learning_evaluations` 只支持当前真实流程 `submission/goal_review`，不建设通用 subject 平台。正式周期复盘的计划建议保存在 goal_review Recommendation 中；独立 Proposal 留在 V1。
- D057: Evaluation 不直接推进 Task、Action、Session、Guide 或计划。Recommendation 使用 `recommendation + decision + applicationStatus` 的最小存储，accepted 与 applied 分离；多条或冲突 Decision 不选择第一条。
- D058: 对话表只整理现有 Question Thread 能力。Goal、Task、Action 使用消息级锚点；Thread 不成为 Goal 所有权事实源。部分消息可迁移，但不得猜测缺失锚点。
- D059: 迁移过程状态、V1 ID 映射、行级失败原因和核对报告全部放在 V2 外部；正常 V2 Schema 不保存迁移状态机或永久兼容元数据。
- D060: V1→V2 回退方式是重新启用已校验的 V1 归档，不要求反向 SQL。D041 继续适用于 V2 正式运行后的常规 V2→V2 Schema 迁移。

## 2026-07-24 Learning Turn 深化确认

- D061: 主线内 AI 教师采用受控自主 Learning Turn。App 只提供意图和可信上下文；Loop 可以自主串联当前上下文已挂载的非破坏性教学工具，单轮最多 6 次、顺序执行。Task/Session/计划等正式状态仍只能由程序命令推进。
- D062: AI 可以自动把解释、示例、微练习或复习作为 optional Action 插入当前 Guide 的当前 Task，但不得创建正式 Task。该 Action 标记 `origin=agent_supplement`，以产生它的 tool review 作为幂等来源；完成或跳过后返回原 Action。
- D063: `ask_user` 保存问题并暂停同一个 Learning Turn；回答、跳过或取消都处理原 Run，应用重启后从 `ai_reviews` 的结构化工具结果恢复。不得持久化隐藏推理、API Key 或完整模型运行配置。
- D064: 主线主动教学中的理解检查使用同一个 Learning Turn 完成 `quiz → ask_user → 用户回答 → evaluate`。回答先保存为过程事实，评价中的正确点和误区幂等沉淀到现有知识证据，不创建 Submission、不推进 Task/Action/Session；用户可将派生知识判断标记为已掌握、排除或恢复关注。

## 2026-07-24 计划与日期分离确认

- D065: 日期只作为 Goal 截止日期和 Roadmap Stage 检查点的进度参照，不成为 Near-term Plan、Learning Guide、Task 或 Action 的业务身份与推进条件。用户数日未学习时保留当前学习位置，不按天补建、跳过或重排内容，不统计漏学天数；日期变化只产生只读的正常、阶段检查点已过或目标到期提示，计划调整仍由用户确认。

## 2026-07-24 Phase 2 收口确认

- D066: Learning Guide 的收口条件是其 Task 全部进入正式终态；`completed/partial/abandoned/replaced` 都是合法关闭结果。最后一个 Task 被放弃时仍可收口 Guide，Session 保持独立，不被隐式结束。
- D067: 用户确认最后一个 `ready_for_review` Roadmap Stage 达成时，同时把 Goal 标记为完成；非最后阶段只推进到下一阶段，AI 评价仍不得自动完成 Stage 或 Goal。
- D068: 用户纠正 Evaluation 时追加 `source=user_correction` 的新 Evaluation，并记录被纠正评价、原因和知识证据；原评价不覆盖。Recommendation 决定可以保存用户原因，`accepted` 与 `applied` 仍保持分离。
- D069: 独立临时学习使用统一 Learning Turn 和 Conversation 持久化，不创建 Goal、Guide 或 Task。后续关联 Goal 时新增带 Goal 引用的消息，不改写已有消息。
- D070: 复盘以单个 Learning Guide 下已保存的 Task、Action、Session、Submission、Evaluation 和问题记录为证据；不得按日历连续性、漏学天数或前台窗口推断投入与专注。
- D071: 当前版本移除自动前台窗口监测及其空写入接口。未来若恢复专注辅助，必须作为用户明确开启的独立切片，并满足 D044，不得混入核心状态推进。
- D072: preload、IPC、AppService、共享公开 API 及 Overview 页面/样式入口统一使用 `Learning Overview / Learning Unit / Learning Guide` 命名；旧 `Today/Daily/Day` 名称不得继续出现在新增公开接口。底层持久化类型、V1 升级器和数据库兼容列按调用链分批替换，不在本轮做危险的大爆炸改名。

## 当前实施状态

- Phase 1 已深化为统一 Learning Turn：目标、规划、Guide、教学、提问、评价和复盘全部进入同一 Agent Loop；工具只负责 schema、权限和业务执行，不再在工具内部二次调用模型；旧单工具执行通道、独立 prompt builder 和 TTL 结果缓存已删除。
- 主线教学已支持 `search_kb → explain` 自主串联、`quiz/practice/evaluate/ask_user` 动态挂载，以及当前 Guide 临时补充 Action。
- 主线小测已支持在同一 Run 内等待回答、重启恢复、即时评价和过程证据沉淀；后续 `search_kb` 只消费仍为 active 的知识判断。
- Phase 2 已建立干净 V2 Schema、V2 Runtime persistence 和隔离的一次性 V1→V2 升级器；正常 Runtime 不再读取 V1 表。
- V1 永久归档、白名单迁移、外部迁移报告和手动恢复入口已经保留；正式 V2 存在时重复升级不会覆盖。
- Goal 截止日期和 Roadmap Stage 检查点已成为真实持久化事实；近期计划与 Learning Guide 不写建议日期，进度提示不推进学习状态。
- Guide、最终 Stage/Goal、评价纠正、Recommendation 原因、独立临时学习和证据复盘的收口链路已经实现。
- 提问、提交评价和复盘编排已从 AppService 下沉到 Conversation、Evaluation 和 Review 模块，仍复用唯一 Agent Loop。
- 自动前台窗口监测已移除；Overview 页面入口及 preload/IPC/AppService 的 Today/Daily 公开接口已改为 Learning 语义。
- `docs/rules/ARCHITECTURE_DATA_COMPATIBILITY.md` 已同步为当前 V2 所有权和切库规则。
- Phase 2 仍以测试、构建和主 bundle 隔离核对的最终结果为完成门槛；检查失败时不得把本节视为已验收。
