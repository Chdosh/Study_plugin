# 项目文档

本目录只保留与当前实现一致、仍在维护的项目文档。

| 文档 | 内容 |
| --- | --- |
| [`../AGENTS.md`](../AGENTS.md) | 项目定位、产品闭环、信息架构和基本工作流程（唯一常驻规则） |
| [`DECISIONS.md`](DECISIONS.md) | 用户已确认的产品与架构决策、稳定编号和当前实现冲突 |
| [`rules/ARCHITECTURE_DATA_COMPATIBILITY.md`](rules/ARCHITECTURE_DATA_COMPATIBILITY.md) | 架构边界、数据模型、兼容策略和安全约束 |
| [`rules/ENGINEERING_CONSTRAINTS.md`](rules/ENGINEERING_CONSTRAINTS.md) | 状态所有权、AI 边界、迁移、安全与验证要求 |
| [`rules/PRODUCT_SEMANTICS.md`](rules/PRODUCT_SEMANTICS.md) | 业务语义完整定义和 UI 约束 |

AI 教学效果评测（真实模型跑分、场景检查、judge 评审、报告留档）位于 `src/main/ai/eval/`，报告输出到 `docs/eval/reports/`，命令见根目录 [`README.md`](../README.md) 的 `eval:ai` / `eval:smoke`。

应用能力、运行方式和项目结构请参阅根目录 [`README.md`](../README.md)。实现细节以当前代码、schema、迁移、配置和测试为准。
