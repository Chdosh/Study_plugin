# UI_SYSTEM

## 适用范围

本文定义 `design-prototype/` 的低保真 UI 设计系统，用于后续正式业务 UI 重构前的设计验证。

当前实现约束：

- 设计变量集中在 `design-prototype/src/design-tokens.css`。
- 原型页面样式通过 `design-prototype/src/styles.css` 引用变量。
- 不修改正式业务代码、不调用数据库、不调用 DeepSeek、不启动真实监控。
- 本阶段只覆盖「今日 -> 学习 -> 学习结算 -> 复盘」点击流程。

## 当前页面审查结论

当前 `design-prototype` 已满足本阶段关键 UI 约束：

- 「今日」「学习」「学习结算」「复盘」每个页面最多一个主要按钮。
- 正常、空、加载、错误、AI 不可用状态集中在开发路由 `#/dev/states` 预览。
- 页面没有使用渐变、玻璃拟态、发光效果或复杂动画。
- 颜色主要用于状态、层级和当前选中，不通过大量彩色卡片区分模块。
- 容器圆角统一使用 `--radius-md`，仅胶囊标签使用 `--radius-pill`。
- 页面未把所有内容都塞进卡片；Today 使用当前任务、时间线和低权重 AI 窄栏形成明确分组。

需要持续遵守：

- 后续新增页面仍然只能有一个主操作按钮。
- 状态色只能用于状态提示、标签、图标和边框，不用于把所有模块做成彩色卡片。
- 新组件必须先复用现有 token 和组件形态，再考虑新增。

## 设计变量来源

唯一变量入口：

`design-prototype/src/design-tokens.css`

变量分类：

- 字体：`--font-*`
- 间距：`--space-*`
- 圆角：`--radius-*`
- 背景：`--color-bg-*`
- 文本：`--color-text-*`
- 边框：`--color-border-*`
- 主色：`--color-primary-*`
- 状态色：`--color-success-*`、`--color-warning-*`、`--color-danger-*`、`--color-info-*`
- 控件尺寸：`--control-height-*`、`--button-padding-*`
- 组件尺寸：`--badge-*`、`--textarea-min-height`、`--empty-state-min-height`、`--state-panel-min-height`

## 1. 页面背景和内容背景

页面背景：

- Token：`--color-bg-page`
- 用途：应用主背景，只用于整体页面底色。
- 规则：页面背景不使用渐变、纹理、发光或图片装饰。

内容背景：

- Token：`--color-bg-surface`
- 用途：主内容面板、右侧 AI 教师面板、状态面板。
- 规则：内容背景保持安静，优先依靠间距、边框、标题层级建立结构。

弱内容背景：

- Token：`--color-bg-surface-muted`、`--color-bg-surface-subtle`
- 用途：次要按钮、行项目、详情块、建议块。
- 规则：只用于辅助分组，不把每个文本块都做成独立卡片。

侧边栏背景：

- Token：`--color-bg-surface`
- 用途：一级导航区。
- 规则：侧边栏作为稳定导航容器，不承载复杂业务内容；默认宽度控制在 200–220px。

## 2. 主色和中性色

主色：

- `--color-primary`：主操作、当前流程强调。
- `--color-primary-hover`：主按钮 hover。
- `--color-primary-active`：主按钮 active、关键图标强调。
- `--color-primary-surface`：品牌标记、轻量强调背景。
- `--color-primary-border`：当前项或成功相关轻边框。

中性色：

- `--color-text-primary`：标题、正文重点。
- `--color-text-muted`：说明文字、辅助信息。
- `--color-text-inverse`：深色侧边栏文字。
- `--color-border-default`：默认边框。
- `--color-border-strong`：输入 hover、较强分隔。
- `--color-bg-surface`：默认内容面。
- `--color-bg-surface-subtle`：行项目和轻分组。

使用规则：

- 主色只服务于当前主路径和主操作。
- 中性色负责大部分结构和信息承载。
- 不允许为每个模块分配独立高饱和颜色。

## 3. 成功、警告、错误、信息状态色

| 状态 | Token | 使用位置 | 规则 |
| --- | --- | --- | --- |
| 成功 | `--color-success` / `--color-success-border` | 完成标签、正向结果 | 优先用于边框、图标、短标签 |
| 警告 | `--color-warning` / `--color-warning-border` | AI 不可用、需要注意 | 不代表失败，只提示能力降级 |
| 错误 | `--color-danger` / `--color-danger-border` | 保存失败、读取失败 | 错误必须提供下一步动作或说明 |
| 信息 | `--color-info` / `--color-info-border` | 加载、系统说明 | 不用于主操作按钮 |

状态色不应铺满大面积背景。默认使用「图标 + 标题 + 说明 + 边框」表达状态。

## 4. 字体大小和字重层级

字体族：

- Token：`--font-family-base`
- 默认：Inter + 系统无衬线字体。

字号：

| 层级 | Token | 用途 |
| --- | --- | --- |
| 12px | `--font-size-xs` | 标签、辅助说明、状态补充 |
| 13px | `--font-size-sm` | 紧凑正文、按钮、状态标题 |
| 14px | `--font-size-md` | 默认业务正文 |
| 16px | `--font-size-lg` | 面板标题、小节标题 |
| 18px | `--font-size-xl` | 主要内容区标题 |
| 24px | `--font-size-2xl` | 指标数字 |
| 26px | `--font-size-3xl` | 页面标题、当前任务标题 |

字重：

- `--font-weight-regular`：普通正文。
- `--font-weight-medium`：次强调。
- `--font-weight-semibold`：表单标签。
- `--font-weight-bold`：按钮、徽标、强调文本。
- `--font-weight-heavy`：品牌标记。

规则：

- 不使用视口宽度动态缩放字体。
- 字间距保持默认，不使用负字间距。
- 工具面板和卡片内不使用 hero 级大标题。

## 5. 4px/8px 基础间距体系

基础 token：

- `--space-1`: 4px
- `--space-2`: 8px
- `--space-3`: 12px
- `--space-4`: 16px
- `--space-5`: 20px
- `--space-6`: 24px
- `--space-7`: 28px
- `--space-8`: 32px

规则：

- 组件内部紧凑间距优先使用 4px、8px、12px。
- 页面区块间距优先使用 16px、20px、24px。
- 不新增 5px、7px、9px、11px、14px、18px 等零散间距。
- 固定尺寸控件需要通过 token 定义，避免页面间漂移。

## 6. 按钮尺寸和按钮等级

尺寸：

- 小控件高度：`--control-height-sm`，32px。
- 默认按钮高度：`--control-height-md`，40px。
- 导航/大控件高度：`--control-height-lg`，44px。

按钮等级：

- Primary：`primary-action`，每个页面或弹窗最多一个。
- Secondary：`secondary-action`，用于返回、修改、辅助操作。
- Text：`text-action`，用于低风险跳转或轻量操作。

规则：

- 一个页面最多一个主要按钮。
- 主按钮必须对应当前页面最重要的下一步。
- 次要按钮不能使用主色填充。
- 禁用按钮必须明显降低可用性，但仍保持可读。
- 破坏性操作未来必须使用独立 danger 样式，并需要确认。

## 7. 输入框、卡片、弹窗和侧边栏规则

输入框：

- 使用 `--color-bg-surface` 背景。
- 默认边框为 `--color-border-default`。
- Hover 使用 `--color-border-strong`。
- Focus 使用 `--focus-outline` 和主色边框。
- 输入说明使用 `--color-text-muted`。

卡片和内容容器：

- 默认圆角：`--radius-md`，8px。
- 只用于主要内容组、状态组、列表项或结算选项。
- 不允许把所有文本、按钮和列表都包成卡片。
- 不允许同一页面混用多种容器圆角。

弹窗：

- 当前原型未实现弹窗。
- 后续弹窗必须只承载需要打断用户决策的内容，例如 AI 计划调整确认。
- 弹窗同样最多一个主按钮。
- 不使用复杂动画、模糊背景或玻璃拟态。

侧边栏：

- 宽度 token：`--sidebar-width`。
- 只承载一级导航、品牌和用户区域。
- 当前页面状态通过浅青绿色 active 项表达。
- 不在侧边栏塞入统计卡片或复杂表单。

右侧 AI 教师面板：

- 宽度 token：`--context-panel-width`；Today 页面使用 `--today-ai-panel-width`。
- 只提供当前页面上下文建议。
- AI 不可用时显示降级状态，不阻断本地流程。

开发状态路由：

- 正式页面不展示状态切换器和状态样例。
- 状态演示集中到 `#/dev/states`。
- 正式页面仍保留空、加载、错误和 AI 不可用渲染能力，但一次只接收一个真实状态。

## 8. 图标规范

图标来源：

- 使用现有 `lucide-react`。
- 不使用 emoji 作为 UI 图标。
- 不手写独立 SVG，除非现有图标库没有合适图标。

尺寸：

- 普通状态图标：18px。
- 列表辅助图标：16px。
- 图标按钮未来应定义固定宽高，避免 hover 时布局跳动。

规则：

- 图标必须辅助文字含义，不能替代关键文本。
- 图标颜色默认继承文本或状态色。
- 状态图标只使用成功、警告、错误、信息四类状态色。

## 9. Hover、Focus、Active、Disabled 状态

Hover：

- 主按钮使用 `--color-primary-hover`。
- 次按钮使用 `--color-neutral-control-hover`。
- 输入框增强边框到 `--color-border-strong`。

Focus：

- 所有按钮、选择器、文本输入都必须有 `--focus-outline`。
- Focus 不能只依赖颜色变化。
- Focus 轮廓不作为装饰发光效果使用。

Active：

- 主按钮使用 `--color-primary-active`。
- 次按钮使用 `--color-neutral-control-active`。

Disabled：

- 使用 `--disabled-opacity`。
- 光标使用 `not-allowed`。
- 禁用状态不响应 hover/active 强调。

## 10. 空状态、加载状态和错误状态

空状态：

- 使用 `StatePanel` 或 `empty-box`。
- 需要说明为什么为空，以及用户下一步能做什么。
- 不使用插画或装饰性大图。

加载状态：

- 使用信息色边框和 `Loader2` 图标。
- 当前原型不实现旋转动画，避免引入复杂动画。
- 文案必须说明正在模拟或等待的动作。

错误状态：

- 使用错误色边框和 `XCircle` 图标。
- 文案必须说明失败发生在哪个环节。
- 正式业务中错误状态需要提供重试、返回或查看详情入口。

AI 不可用状态：

- 使用警告色边框和 `Brain` 图标。
- 必须明确本地流程仍可继续。
- 不允许把 AI 不可用误写成数据丢失或任务失败。

## 11. 深色模式是否在当前版本实现

当前版本不实现深色模式。

原因：

- 当前阶段目标是验证信息架构、页面职责和主流程点击，不是主题系统。
- 正式业务 UI 尚未完成设计系统迁移，过早加入深色模式会扩大验证面。
- 早期原型曾有深色侧边栏，但当前版本已改为浅色导航；这仍不代表全局主题系统已经完成。

后续实现条件：

- 先稳定正式业务页面的 token 使用。
- 再为 `design-tokens.css` 增加 `[data-theme="dark"]` 或等价主题入口。
- 深色模式必须覆盖背景、文本、边框、状态色、输入和 focus 状态。

## Visual Quality Gate

A page must not be considered complete unless:

- The user can identify the primary action within 3 seconds.
- Only one dominant action is visible above the fold.
- Developer controls and state-switching tools are not visible in production pages.
- No more than three bordered containers are visible in the primary viewport unless required by the content.
- Related text should use spacing and typography before adding a card.
- Status colors are shown only when the corresponding status is active.
- The page does not use more than one brand accent color.
- Secondary information has visibly lower contrast than the current task.
- The current task, current state, and next action are immediately identifiable.
- The page is reviewed using an actual application screenshot, not only source code.
