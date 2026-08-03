# 业务语义完整定义

状态：CURRENT
生效日期：2026-08-03
适用范围：涉及目标、计划、学习单元、任务、行动、会话、评价、复盘与知识沉淀语义的任务。
失效条件：业务模型经用户确认发生变化，且本文件被同步更新。

## 1. 业务闭环与界面必须整体理解

以下内容不能按页面拆开理解，因为它们共同描述同一条学习闭环。

### 1.1 核心语义

* 学习目标连接长期结果和全部历史。
* Roadmap Stage 表示阶段方向；Near-term Plan 表示近期粗粒度安排；Learning Guide 表示当前可调整的学习单元执行稿。
* Goal 截止日期和 Roadmap Stage 检查点只用于只读进度参照。Near-term Plan、Learning Guide、Task 和 Action 按学习顺序推进，不绑定自然日；用户数日未打开应用时，不自动跳过、重排、失效或补建学习内容，也不统计“漏学天数”。
* Task 是可跨对话和 Session 推进的学习单元。临时 Task 可以不关联 Goal；后续关联 Goal 时只新增引用，不自动创建无意义 Goal，也不回写历史 Message、Submission 或 Session。
* Task 状态为 `planned/active/deferred/closed`；关闭时记录 `completed/partial/abandoned/replaced`。
* Action 是 Task 内的 `required/optional` 执行步骤。必要性影响提示和推荐，但不得成为继续学习、提交、评价或关闭 Task 的统一硬门槛。
* difficulty 只表示 `foundation/standard/advanced`；考核使用独立 `taskMode=exam`。
* Focus Session 是一次实际执行记录，可以暂停和恢复，不拥有 Task 状态。全库最多一个 `active` 或 `paused` 的未结束 Session。
* Evaluation 保存判断、`direction`、Self-Note 和 Recommendation，不直接修改 Task、Action、Session、Guide 或计划。
* Recommendation 的用户决定与实际应用分离；`accepted` 不等于 `applied`。只有 CommandGateway 可以把已接受建议转成业务命令。
* 正式周期复盘使用 `learning_evaluations.kind=goal_review`；独立 Proposal 不作为新的长期事实源。

### 1.2 收缩原则

V2 是对现有业务的收缩整理，不是重新建设通用学习平台。没有当前真实 reader、writer 或用户恢复需要的字段不得进入 Schema；迁移过程状态、V1 映射和失败报告不得进入正常 Runtime 数据模型。

## 2. 信息架构职责

* 概览回答“我朝什么目标前进，下一步关注什么”，只展示目标、阶段、学习路径、当前重点摘要和待处理事项，不复制执行详情、实时计时和事件记录。
* 学习回答“我现在具体做什么”，承载当前 Task、Action、Session、提问、提交和评价恢复。
* 记录回答“过去发生了什么，结果如何，后来怎样调整”，统一收纳 Session、Action、提交、评价、问题、知识、复盘和计划版本，不提供学习控制。
* 设置只负责模型、偏好、隐私、本地数据和诊断配置。
* 永久壳层只保留必要导航和全局状态；AI 导师只在学习上下文中出现。

改变信息架构时必须整体审查页面职责和状态流，不能只改导航文字或单个页面。

## 3. UI 必须服从业务状态

* 每个页面状态只有一个视觉主操作，且对应用户此刻最重要的下一步。
* 计划、执行和历史必须分层，同一完整内容不得跨页面重复。
* 全部 Action 终态后立即显示提交状态，不得继续出现越界步骤序号或完成/跳过操作。
* 不显示数据库 ID、内部字段、英文诊断、伪计时、伪百分比、空统计或开发占位。
* 错误必须说明数据是否保留和用户下一步，并提供真实可执行的恢复入口。
* 导航、按钮、标签和抽屉支持键盘；不能只依赖颜色表达状态。
* 操作栏不能覆盖正文，响应式变化不能重置输入、Session 或当前位置。
* 视觉重构不能删除真实业务能力，也不能新增只为截图存在的功能。

涉及业务状态的 UI 修改，先列出：

```text
状态 | 页面摘要 | 主操作 | 次级操作 | 禁止操作 | 错误恢复
```

Renderer 必须消费共享业务状态或派生状态，不得用页面局部条件重新组合第二套状态机。
