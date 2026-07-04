# 文档地图

新对话交接优先读取：

1. `AGENTS.md`
2. `docs/PROJECT_MEMORY.md`
3. 与任务直接相关的专题文档

不要默认读取所有文档。旧审计、旧线框、旧 UI demo 和完整历史只在追溯时读取。

## 活跃专题文档

| 文档 | 用途 |
| --- | --- |
| `docs/recovery/PRODUCT_TRUTH.md` | 产品定位、核心概念、产品行为和功能边界的最高事实源 |
| `docs/PROJECT_MEMORY.md` | 当前交接摘要、近期决策、下一步 |
| `docs/PRODUCT_SPEC.md` | 产品愿景、MVP 范围、主任务制学习闭环、Non-Goals |
| `docs/ARCHITECTURE.md` | 技术事实源、依赖方向、服务职责、IPC/架构边界 |
| `docs/AI_AND_DATA_RULES.md` | AI 上下文、结构化输出、主任务数据规则、RAG、Prompt Profiles |
| `docs/SECURITY_AND_PRIVACY.md` | Electron 安全、监控边界、密钥和敏感数据 |
| `docs/UI_GUIDELINES.md` | UI 和交互规则、页面状态、UI-only 边界 |
| `docs/TESTING_AND_MIGRATIONS.md` | 测试、验证、schema 和迁移要求 |
| `docs/REFERENCES.md` | 参考项目 |
| `.agent/WORKFLOW.md` | 正式 Task-ID 任务的证据协议 |

## 辅助材料

| 文档 | 状态 |
| --- | --- |
| `docs/Example.md` | 规划输出参考样例；不得作为模型不可见的硬依赖 |
| `docs/test-report-v1/SMOKE_TEST_REPORT.md` | 历史冒烟测试报告 |
| `docs/archive/PROJECT_MEMORY_FULL_2026-07-03.md` | 完整项目记忆归档 |

## 当前流程口径

当前规范以“任务决定时长”为核心：

* `daily_guide` 生成少量主任务，不生成固定 10 分钟 Time Block。
* Action / Checkpoint 只做本地执行引导和进度记录。
* 计时器绑定主任务，一个主任务可以形成多个 Focus Session。
* 主任务是唯一最终提交和评估单位。
* `evaluationMode=local` 走本地验证器，`evaluationMode=ai` 最多调用一次 `evaluate_submission`。
* 时间流逝、暂停、恢复、超时和内部 Action 完成不触发 AI。
* 复盘按主任务汇总，在主任务、阶段或用户主动结束学习时触发；同一天综合复盘最多一次。

新功能更新时，先按 `AGENTS.md` 的任务类型映射读取对应专题文档，再读相关代码。
