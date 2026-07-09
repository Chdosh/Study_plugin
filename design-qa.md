# Design QA - 2026-07-04 参考图 UI 复刻

## Source Of Truth

用户提供的 5 张参考图作为本轮视觉依据：

* `C:\Users\cc\AppData\Local\Temp\codex-clipboard-b4f96f22-6561-4cc5-8c64-158b9cd1e116.png` - Today
* `C:\Users\cc\AppData\Local\Temp\codex-clipboard-e0d96d97-6e48-4822-a5f7-999ee08843c5.png` - 主动访谈
* `C:\Users\cc\AppData\Local\Temp\codex-clipboard-d43d6949-93dc-4137-a15c-0fb8c74a7175.png` - 复盘
* `C:\Users\cc\AppData\Local\Temp\codex-clipboard-e8ce0ea2-2050-47cf-87d2-2314ca559422.png` - 学习
* `C:\Users\cc\AppData\Local\Temp\codex-clipboard-91ce5fb9-1ab4-4f4f-a219-1e23ef256bc5.png` - 悬浮窗

## Implementation Evidence

本轮对比过的实现截图：

* `C:\Users\cc\AppData\Local\Temp\study-intake-after-polish.png`
* `C:\Users\cc\AppData\Local\Temp\study-ui-reference-captures\02-today.png`
* `C:\Users\cc\AppData\Local\Temp\study-ui-reference-captures\03-study.png`
* `C:\Users\cc\AppData\Local\Temp\study-ui-reference-captures\04-review.png`
* `C:\Users\cc\AppData\Local\Temp\study-ui-reference-captures-current\float-current-collapsed.png`
* `C:\Users\cc\AppData\Local\Temp\study-ui-reference-captures-current\float-current-expanded.png`
* `C:\Users\cc\AppData\Local\Temp\study-layout-fix-captures\intake-1418x1083.png`

## QA Findings

* Today：已按参考图强化当前任务主视觉中心，右侧只保留进度、验收、边界三类辅助信息；其他任务默认压缩，避免和主任务抢焦点。
* 主动访谈：已复刻左侧自然对话区、底部固定输入区、右侧目标理解摘要和生成路径提示；生产 UI 未复制参考图里的设计标注 callout。
* 学习页：已复刻顶部 session bar、当前步骤主面板、步骤进度列表、右侧 AI 提问/提交区和底部悬浮窗提示。
* 复盘页：已复刻顶部复盘摘要、结果概览、AI 评估反馈、调整 proposal、明日启动预告和右侧笔记/归因/阶段路径。
* 悬浮窗：已复刻约 `420x56` 收起态和约 `420x300` 展开态；修复展开态底部按钮裁切和“去提问”按钮文字竖排问题。
* 响应式：中窄窗口下侧栏自动收窄为图标栏，主内容和辅助栏改为单列，降低固定字号和固定列宽造成的挤压。
* 窗口化补丁：1418px 宽度下侧栏为 82px 图标栏，品牌文字隐藏，导航文字 `font-size: 0px`，主动访谈保持主区 + 摘要双列；1180px 和 900px 下主动访谈自动单列且无横向滚动。

## Intentional Differences

* 参考图中的箭头、虚线和文字标注是设计说明，不进入生产 UI。
* 示例占位文本已替换为当前业务的真实数据流字段；按钮仍调用现有 onboarding、guides、sessions、learning API。
* 本轮没有改 SQLite schema、AI schema、IPC 通道或底层学习流程。

## Verification

* `npm.cmd run typecheck` - passed
* `npm.cmd test` - passed, `29 passed`, `1 skipped`
* `npm.cmd run build` - passed
* `node scripts\electron-gui-smoke.mjs` - passed, fake AI 主闭环完成主动访谈、生成执行稿、确认并开始、进入学习、结束当前块和重启恢复
* Electron/CDP windowed breakpoint check - passed at `1418x1083`, `1180x900`, and `900x900`

Final result: passed
