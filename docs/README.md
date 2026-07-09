# 文档地图

新对话交接优先读取：

1. `AGENTS.md`
2. `docs/PROJECT_MEMORY.md`
3. 与任务直接相关的专题文档

不要默认读取所有文档。旧审计、旧线框和完整历史只在追溯时读取。

## 活跃专题文档

| 文档 | 用途 |
| --- | --- |
| `docs/PROJECT_MEMORY.md` | 当前交接摘要、近期决策、下一步 |
| `docs/PRODUCT_SPEC.md` | 产品愿景、MVP 范围、核心闭环、Non-Goals |
| `docs/ARCHITECTURE.md` | 技术事实源、依赖方向、服务职责、IPC/架构边界 |
| `docs/AI_AND_DATA_RULES.md` | 数据模型、AI 上下文、结构化输出、RAG、Prompt Profiles |
| `docs/SECURITY_AND_PRIVACY.md` | Electron 安全、监控边界、密钥和敏感数据 |
| `docs/UI_GUIDELINES.md` | UI 和交互规则、页面状态、UI-only 边界 |
| `docs/TESTING_AND_MIGRATIONS.md` | 测试、验证、schema 和迁移要求 |
| `docs/REFERENCES.md` | 参考项目 |
| `.agent/WORKFLOW.md` | 正式 Task-ID 任务的证据协议 |

## 轻量索引

| 文档 | 状态 |
| --- | --- |
| `docs/CONTEXT_AND_MEMORY.md` | 已压缩为索引；详细规则以 `docs/AI_AND_DATA_RULES.md` 为准 |

## 历史参考文档

以下文档可能包含旧页面、旧范围或旧审计结论。它们可用于追溯设计意图，但不能覆盖当前代码、`PROJECT_MEMORY.md` 或活跃专题文档。

| 文档 | 备注 |
| --- | --- |
| `docs/PRODUCT_SCOPE_V1.md` | V1 范围历史稿 |
| `docs/INFORMATION_ARCHITECTURE.md` | 信息架构历史稿，当前摘要见 `PRODUCT_SPEC.md` |
| `docs/USER_FLOWS.md` | 用户流程历史稿 |
| `docs/WIREFRAMES.md` | 低保真线框历史稿 |
| `docs/UI_SYSTEM.md` | 设计系统细则，UI 重构时可参考 |
| `docs/UI_DASHBOARD_V1.md` | 旧 UI 设计稿 |
| `docs/CURRENT_PRODUCT_AUDIT.md` | 旧产品审计 |
| `docs/DEVELOPMENT_BASELINE.md` | 旧开发基线，部分内容已过时 |
| `docs/test-report-v1/SMOKE_TEST_REPORT.md` | 历史冒烟测试报告 |
| `docs/archive/PROJECT_MEMORY_FULL_2026-07-03.md` | 完整项目记忆归档 |

## 交接判断

当前文档已经具备新对话交接能力：

* `AGENTS.md` 能独立说明基本工作纪律。
* `PROJECT_MEMORY.md` 已压缩为当前状态入口。
* 专题规则按任务类型发现，不要求每次读取所有专题文档。
* 长历史和旧设计稿已降级为追溯资料。

新功能更新时，先按 `AGENTS.md` 的任务类型映射读取对应专题文档，再读相关代码。
