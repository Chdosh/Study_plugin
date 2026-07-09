# 文档地图

新对话交接优先读取：

1. `AGENTS.md`
2. 与当前任务直接相关的代码和专题文档
3. 需要了解近期风险、历史决策或接续长期任务时，再读 `docs/PROJECT_MEMORY.md`

不要默认读取所有文档。旧审计、旧线框、旧 UI demo 和完整历史只在追溯时读取。

## 活跃专题文档

| 文档 | 用途 |
| --- | --- |
| `docs/PRODUCT_TRUTH.md` | 产品定位、核心概念、产品行为和功能边界的最高事实源 |
| `docs/PROJECT_MEMORY.md` | 当前交接摘要、近期决策、下一步 |
| `docs/MVP_SPEC.md` | 当前版本流程、默认策略、AI 调用、验收和 Non-Goals |
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

## 读取原则

`docs/PRODUCT_TRUTH.md` 只回答长期产品事实；`docs/MVP_SPEC.md` 只回答当前版本实现规格。不要把两份文档互相复制，也不要在本地图里重新描述完整产品流程。

新功能更新时，先按 `AGENTS.md` 的读取规则判断是否需要补充专题文档，再读相关代码。
