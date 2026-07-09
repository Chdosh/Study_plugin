# 上下文与记忆

本文件已压缩为索引，避免与 `docs/AI_AND_DATA_RULES.md` 重复维护两套上下文规则。

## 当前规范位置

上下文组装、记忆分层、当前学习位置、问题分支、失败行为和隐私边界，以 `docs/AI_AND_DATA_RULES.md` 为准。

需要实现或修改以下内容时，读取 `docs/AI_AND_DATA_RULES.md`：

* AI prompt 或结构化输出
* `ContextBuilder`
* 学习运行态
* 用户问题分支
* 提交评估和下一步决策
* 摘要、RAG、知识库或 Prompt Profiles
* AI 调用记录和上下文脱敏

## 当前实现摘要

`src/main/services/context-builder.ts` 按操作类型动态组装上下文，不发送完整历史。当前上下文通常包含：

* 当前 goal、stage、task、daily block 和 step
* 最近最多 3 条 step summary
* 当前 question thread 和最近消息
* 最新 submission、evaluation、decision
* pending plan adjustment
* 本次操作额外输入

完整历史保存在 SQLite 中。模型只接收当前操作需要的工作上下文。
