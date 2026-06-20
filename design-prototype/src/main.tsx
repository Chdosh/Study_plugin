import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  BookOpen,
  Bold,
  Brain,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Code2,
  FileText,
  Flag,
  Folder,
  Home,
  Image,
  Italic,
  Lightbulb,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Loader2,
  Maximize2,
  Mic,
  Monitor,
  Pause,
  PencilLine,
  Play,
  Search,
  Settings,
  SendHorizontal,
  Sparkles,
  Square,
  ThumbsDown,
  ThumbsUp,
  TrendingUp,
  Underline,
  UserRound,
  X,
  XCircle
} from 'lucide-react';
import './styles.css';

type Page = 'today' | 'plan' | 'study' | 'knowledge' | 'review' | 'settings' | 'settlement';
type StatusKind = 'normal' | 'empty' | 'loading' | 'error' | 'ai-unavailable';
type ShellMode = 'app' | 'dev-states';

interface StudyBlock {
  id: string;
  time: string;
  minutes: number;
  title: string;
  objective: string;
  action: string;
  expectedOutput: string;
  successCheck: string;
  fallbackAction: string;
  material: string;
  status: 'current' | 'planned' | 'done';
}

const blocks: StudyBlock[] = [
  {
    id: 'block-1',
    time: '20:00',
    minutes: 25,
    title: 'React 状态管理复习',
    objective: '把 useState 和 useEffect 的触发规则讲清楚',
    action: '先写 5 条要点，再用一个输入框例子验证',
    expectedOutput: '一段可复述笔记和一个最小示例',
    successCheck: '能说明副作用何时执行，以及如何避免重复请求',
    fallbackAction: '只整理 useState 的数据流，并记录 useEffect 问题',
    material: '昨天的练习笔记、React 官方文档摘要',
    status: 'current'
  },
  {
    id: 'block-2',
    time: '20:30',
    minutes: 15,
    title: '组件通信自测',
    objective: '区分 props、回调和状态提升',
    action: '不看资料写出三个概念的适用场景',
    expectedOutput: '3 个对比句和 1 个例子',
    successCheck: '能判断一个表单预览功能应该把状态放在哪里',
    fallbackAction: '只写 props 与回调的区别',
    material: '任务卡片里的验收标准',
    status: 'planned'
  },
  {
    id: 'block-3',
    time: '20:50',
    minutes: 10,
    title: '今日小结',
    objective: '记录收获与疑问，生成复盘素材',
    action: '写下 2 条收获和 1 个待解决问题',
    expectedOutput: '一段今日小结和下一步问题',
    successCheck: '能明确下一次继续学习的入口',
    fallbackAction: '只记录最卡住的一个问题',
    material: '本次学习笔记',
    status: 'planned'
  }
];

const fakeReviewItems = [
  '本次学习块完成了主要笔记，但输出示例还不够稳定。',
  '实际学习时间 12 分钟，比预估多 2 分钟，说明验收标准略偏紧。',
  '下一版计划建议把 useEffect 练习拆成“概念复述”和“代码验证”两个块。'
];

function App(): JSX.Element {
  const [page, setPage] = useState<Page>('today');
  const [activeStatus, setActiveStatus] = useState<StatusKind>('normal');
  const [shellMode, setShellMode] = useState<ShellMode>(() =>
    window.location.hash === '#/dev/states' ? 'dev-states' : 'app'
  );
  const [savedNote, setSavedNote] = useState(
    `组件通信方式总结

父传子（Props）
- 单向数据流，父组件传递数据给子组件。

子传父（回调函数）
- 通过 props 传递回调，子组件调用回调函数将数据传回父组件。

兄弟通信（共享父组件 / Context）
- 通过共同父组件或 Context 实现数据共享。

触发规则要点
- useState 的 setState 会触发组件重新渲染；
- useEffect 会在依赖变化后重新执行。`
  );

  useEffect(() => {
    const syncHashMode = (): void => {
      const nextMode = window.location.hash === '#/dev/states' ? 'dev-states' : 'app';
      setShellMode(nextMode);
      if (nextMode === 'app') {
        setActiveStatus('normal');
      }
    };
    window.addEventListener('hashchange', syncHashMode);
    return () => window.removeEventListener('hashchange', syncHashMode);
  }, []);

  const title = useMemo(() => {
    if (page === 'today') return '今日';
    if (page === 'plan') return '计划';
    if (page === 'study') return '学习';
    if (page === 'knowledge') return '知识';
    if (page === 'settlement') return '学习结算';
    if (page === 'settings') return '设置';
    return '复盘';
  }, [page]);

  const subtitle = useMemo(() => {
    if (page === 'study') return '专注当下，深入理解，稳步提升';
    if (page === 'settlement') return '确认输出，沉淀进展';
    if (page === 'review') return '回看执行，调整下一步';
    return '专注当下，持续进步';
  }, [page]);

  const goToPage = (nextPage: Page): void => {
    if (window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    setShellMode('app');
    setActiveStatus('normal');
    setPage(nextPage);
  };

  const isDevRoute = shellMode === 'dev-states';

  return (
    <div className="prototype-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">学</div>
          <div>
            <strong>学习管家</strong>
            <span>AI 学习助手</span>
          </div>
        </div>
        <nav className="nav-list" aria-label="主导航">
          <NavButton active={!isDevRoute && page === 'today'} icon={<Home size={18} />} onClick={() => goToPage('today')}>
            今日
          </NavButton>
          <NavButton
            active={!isDevRoute && page === 'plan'}
            icon={<CalendarDays size={18} />}
            onClick={() => goToPage('plan')}
          >
            计划
          </NavButton>
          <NavButton active={!isDevRoute && page === 'study'} icon={<CheckCircle2 size={18} />} onClick={() => goToPage('study')}>
            学习
          </NavButton>
          <NavButton active={!isDevRoute && page === 'knowledge'} icon={<BookOpen size={18} />} onClick={() => goToPage('knowledge')}>
            知识
          </NavButton>
          <NavButton active={!isDevRoute && page === 'review'} icon={<FileText size={18} />} onClick={() => goToPage('review')}>
            复盘
          </NavButton>
          <NavButton active={!isDevRoute && page === 'settings'} icon={<Settings size={18} />} onClick={() => goToPage('settings')}>
            设置
          </NavButton>
        </nav>
        <div className="sidebar-profile">
          <div className="profile-mark">
            <UserRound size={20} />
          </div>
          <div>
            <strong>Jordan</strong>
            <span>高效学习中</span>
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>{isDevRoute ? '状态样例' : title}</h1>
            <p className="topbar-subtitle">
              {isDevRoute ? '检查正式页面不会常驻显示的状态组件' : subtitle}
              {!isDevRoute && <Sparkles size={14} />}
            </p>
          </div>
          {isDevRoute ? (
            <div className="toolbar">
              <label>
                预览状态
                <select value={activeStatus} onChange={(event) => setActiveStatus(event.target.value as StatusKind)}>
                  <option value="normal">正常</option>
                  <option value="empty">空</option>
                  <option value="loading">加载</option>
                  <option value="error">错误</option>
                  <option value="ai-unavailable">AI 不可用</option>
                </select>
              </label>
            </div>
          ) : (
            <div className="topbar-actions" aria-label="今日工具">
              <button className="icon-button" type="button" aria-label="搜索">
                <Search size={20} />
              </button>
              <button className="icon-button notification-button" type="button" aria-label="通知">
                <Bell size={20} />
                <span />
              </button>
              <div className="date-chip">
                <span>6月20日</span>
                <strong>星期六</strong>
              </div>
            </div>
          )}
        </header>

        {isDevRoute ? (
          <DevStatesPage activeStatus={activeStatus} />
        ) : (
          <>
            {page === 'today' && <TodayPage status={activeStatus} onStart={() => goToPage('study')} />}
            {page === 'plan' && <PlaceholderPage title="计划" text="计划页面不在本次视觉重构范围内。" />}
            {page === 'study' && (
              <StudyPage
                status={activeStatus}
                note={savedNote}
                onNoteChange={setSavedNote}
                onEnd={() => goToPage('settlement')}
                onBackToday={() => goToPage('today')}
              />
            )}
            {page === 'settlement' && (
              <SettlementPage
                status={activeStatus}
                note={savedNote}
                onBackStudy={() => goToPage('study')}
                onSave={() => goToPage('review')}
              />
            )}
            {page === 'knowledge' && <PlaceholderPage title="知识" text="知识页面不在本次视觉重构范围内。" />}
            {page === 'review' && (
              <ReviewPage status={activeStatus} onBackToday={() => goToPage('today')} onRestart={() => goToPage('study')} />
            )}
            {page === 'settings' && <PlaceholderPage title="设置" text="设置页面不在本次视觉重构范围内。" />}
          </>
        )}
      </main>
    </div>
  );
}

function PlaceholderPage({ title, text }: { title: string; text: string }): JSX.Element {
  return (
    <section className="surface placeholder-page">
      <h3>{title}</h3>
      <p>{text}</p>
    </section>
  );
}

const statusCopy: Record<StatusKind, { title: string; text: string }> = {
  normal: { title: '正常状态', text: '主流程可点击，页面显示真实内容。' },
  empty: { title: '空状态', text: '没有任务、计划或 session，需要引导用户创建或确认计划。' },
  loading: { title: '加载状态', text: '正在读取本地任务、计划或会话状态。' },
  error: { title: '错误状态', text: '读取或保存失败，需要提供重试或返回路径。' },
  'ai-unavailable': { title: 'AI 不可用', text: '本地流程仍可继续，AI 建议和复盘能力降级。' }
};

function DevStatesPage({ activeStatus }: { activeStatus: StatusKind }): JSX.Element {
  return (
    <section className="dev-states-page">
      <section className="surface">
        <div className="section-heading">
          <div>
            <h3>开发状态预览</h3>
            <p>此页面只用于检查空、加载、错误和 AI 不可用状态，不属于正式 Today 页面。</p>
          </div>
          <span className="badge">#/dev/states</span>
        </div>
        <StatusGallery activeStatus={activeStatus} />
      </section>

      <section className="surface subtle">
        <div className="section-heading">
          <div>
            <h3>当前选中状态</h3>
            <p>正式页面一次只应接收并渲染一个真实状态。</p>
          </div>
        </div>
        <StatePanel type={activeStatus} title={statusCopy[activeStatus].title} text={statusCopy[activeStatus].text} />
      </section>
    </section>
  );
}

function NavButton({
  active,
  icon,
  children,
  onClick
}: {
  active: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
}): JSX.Element {
  return (
    <button className={active ? 'nav-item active' : 'nav-item'} onClick={onClick}>
      {icon}
      {children}
    </button>
  );
}

function TodayPage({ status, onStart }: { status: StatusKind; onStart: () => void }): JSX.Element {
  const [aiExpanded, setAiExpanded] = useState(false);
  const isEmpty = status === 'empty';
  const isLoading = status === 'loading';
  const isError = status === 'error';
  const aiUnavailable = status === 'ai-unavailable';
  const current = blocks[0];
  const totalMinutes = blocks.reduce((total, block) => total + block.minutes, 0);

  return (
    <section className={aiExpanded ? 'today-layout ai-expanded-layout' : 'today-layout'}>
      <div className="today-main">
        <section className="today-focus-panel" aria-label="当前重点任务">
          {isLoading && <StatePanel type="loading" title="正在加载今日状态" text="正在读取本地任务、计划和学习会话。" />}
          {isError && <StatePanel type="error" title="今日状态读取失败" text="无法读取本地计划。请稍后重试或返回计划页检查。" />}

          {isEmpty && (
            <div className="today-empty-state">
              <BookOpen size={24} />
              <div>
                <h2>今天还没有确认计划</h2>
                <p>确认今日计划后，这里会显示当前最应该开始的学习块。</p>
              </div>
            </div>
          )}

          {!isLoading && !isError && !isEmpty && (
            <>
              <div className="today-focus-copy">
                <span className="focus-label">当前重点</span>
                <h2>{current.title}</h2>
                <p>{current.objective}</p>
                <div className="focus-meta">
                  <span>
                    <Clock3 size={16} />
                    预计 {current.minutes} 分钟
                  </span>
                  <span>
                    <BookOpen size={16} />
                    复习
                  </span>
                </div>
                <div className="today-actions">
                <button className="primary-action" disabled={isLoading || isError || isEmpty} onClick={onStart}>
                  <Play size={18} />
                  开始学习
                </button>
                  <button className="secondary-action quiet" type="button" onClick={() => setAiExpanded(true)}>
                    查看详情
                  </button>
                </div>
              </div>
              <div className="today-progress-ring" aria-label="今日进度 60%">
                <div className="progress-ring">
                  <div>
                    <strong>60%</strong>
                    <span>已完成</span>
                  </div>
                </div>
              </div>
            </>
          )}
        </section>

        <section className="today-plan-section" aria-label="今日计划">
          <div className="today-section-header">
            <div>
              <h3>今日计划</h3>
              <p>{isEmpty ? '暂无任务' : `${blocks.length} 项任务 · 预计 ${totalMinutes} 分钟`}</p>
            </div>
            {!isEmpty && (
              <button className="text-action" type="button">
                调整计划
              </button>
            )}
          </div>
          {isEmpty ? <EmptyPlan /> : <TodayTimeline />}
        </section>
      </div>

      <TodayAiPanel expanded={aiExpanded} unavailable={aiUnavailable} onClose={() => setAiExpanded(false)} onExpand={() => setAiExpanded(true)} />
    </section>
  );
}

function EmptyPlan(): JSX.Element {
  return (
    <div className="timeline-empty">
      <ListChecks size={18} />
      <span>确认今日计划后会显示学习顺序和预计时间。</span>
    </div>
  );
}

function TodayTimeline(): JSX.Element {
  return (
    <div className="timeline-list">
      {blocks.map((block, index) => {
        const isCurrent = block.status === 'current';
        const tags = isCurrent
          ? ['复习', '进行中']
          : block.id === 'block-2'
            ? ['练习', '待开始']
            : ['总结', '待开始'];
        return (
          <article className={isCurrent ? 'timeline-row current' : 'timeline-row'} key={block.id}>
            <div className="timeline-time">
              <strong>{block.time}</strong>
              <span>{block.minutes} 分钟</span>
            </div>
            <div className="timeline-axis" aria-hidden="true">
              <span className="timeline-dot" />
              {index < blocks.length - 1 && <span className="timeline-line" />}
            </div>
            <div className="timeline-content">
              <strong>{block.title}</strong>
              <p>{block.objective}</p>
              <div className="timeline-tags">
                {tags.map((tag) => (
                  <span className={tag === '进行中' ? 'active' : ''} key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
            </div>
            <div className={isCurrent ? 'timeline-progress active' : 'timeline-progress'}>{isCurrent ? '60%' : '0%'}</div>
            <ChevronRight size={16} className="timeline-chevron" />
          </article>
        );
      })}
      <button className="timeline-footer" type="button">
        查看完整计划（{blocks.length}）
        <ChevronRight size={14} />
      </button>
    </div>
  );
}

function TodayAiPanel({
  expanded,
  unavailable,
  onClose,
  onExpand
}: {
  expanded: boolean;
  unavailable: boolean;
  onClose: () => void;
  onExpand: () => void;
}): JSX.Element {
  if (expanded) {
    return (
      <aside className="today-ai-panel today-ai-panel-expanded" aria-label="AI 教师">
        <div className="today-ai-heading ai-teacher-heading">
          <span>
            <Sparkles size={20} />
            <h3>AI 教师</h3>
          </span>
          <button className="icon-button ai-close-button" type="button" aria-label="关闭 AI 教师" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {unavailable ? (
          <StatePanel type="ai-unavailable" title="AI 暂不可用" text="本地学习计划仍可执行；建议稍后再查看讲解和复盘。" />
        ) : (
          <>
            <div className="ai-teacher-tabs" role="tablist" aria-label="AI 教师模式">
              <button className="active" type="button">
                讲解
              </button>
              <button type="button">检查</button>
              <button type="button">规划</button>
            </div>

            <div className="ai-current-content">
              <span>当前内容</span>
              <button type="button">
                React 状态管理复习
                <ChevronRight size={14} />
              </button>
            </div>

            <div className="ai-teacher-thread">
              <span className="teacher-avatar">
                <Sparkles size={14} />
              </span>
              <div className="teacher-bubble">
                我已阅读你的学习内容，准备为你讲解 useState 与 useEffect 的触发规则。你想先从哪部分开始？
              </div>
            </div>

            <button className="lesson-card" type="button">
              <span className="lesson-play">
                <Play size={20} />
              </span>
              <span>
                <strong>重点讲解：useEffect 触发时机</strong>
                <small>依赖变化、首次渲染与清理函数</small>
                <em>
                  <Clock3 size={14} /> 约 8 分钟
                </em>
              </span>
              <ChevronRight size={18} />
            </button>

            <div className="ai-try-list">
              <h4>你也可以试试</h4>
              <button type="button">
                <BookOpen size={16} />
                对比 useState 与 useRef 的使用场景
                <ChevronRight size={16} />
              </button>
              <button type="button">
                <Clock3 size={16} />
                用一个例子说明闭包与依赖问题
                <ChevronRight size={16} />
              </button>
              <button type="button">
                <PencilLine size={16} />
                生成 5 道相关的理解题
                <ChevronRight size={16} />
              </button>
            </div>

            <div className="teacher-input">
              <span>有问题随时问我...</span>
              <div>
                <button type="button" aria-label="语音输入">
                  <Mic size={18} />
                </button>
                <button type="button" aria-label="发送问题">
                  <SendHorizontal size={18} />
                </button>
              </div>
            </div>

            <div className="ai-disclaimer">
              <span>内容由 AI 生成，仅供参考</span>
              <div>
                <ThumbsUp size={16} />
                <ThumbsDown size={16} />
              </div>
            </div>
          </>
        )}
      </aside>
    );
  }

  return (
    <aside className="today-ai-panel" aria-label="AI 教师">
      <div className="today-ai-heading">
        <Sparkles size={20} />
        <h3>AI 学习建议</h3>
      </div>
      {unavailable ? (
        <StatePanel type="ai-unavailable" title="AI 暂不可用" text="本地学习计划仍可执行；建议稍后再查看讲解和复盘。" />
      ) : (
        <>
          <div className="ai-advice-cards">
            <article className="ai-advice-card">
              <div>
                <strong>专注建议</strong>
                <p>晚上是你的高效时段，建议优先完成当前复习任务。</p>
              </div>
              <span className="advice-icon">
                <Lightbulb size={22} />
              </span>
            </article>
            <article className="ai-advice-card">
              <div>
                <strong>知识巩固</strong>
                <p>你在「React 副作用」上正确率较高，可尝试更高阶题目。</p>
              </div>
              <span className="advice-icon">
                <BookOpen size={22} />
              </span>
            </article>
            <article className="ai-advice-card">
              <div>
                <strong>学习节奏</strong>
                <p>近 3 天完成率 82%，继续保持当前节奏会更有效。</p>
              </div>
              <span className="advice-icon">
                <TrendingUp size={22} />
              </span>
            </article>
          </div>

          <div className="quick-actions">
            <h4>快捷操作</h4>
            <button type="button">
              <FileText size={16} />
              生成今日复盘卡片
              <ChevronRight size={16} />
            </button>
            <button type="button" onClick={onExpand}>
              <PencilLine size={16} />
              智能出题练习
              <ChevronRight size={16} />
            </button>
            <button type="button" onClick={onExpand}>
              <ListChecks size={16} />
              查看错题本
              <ChevronRight size={16} />
            </button>
          </div>
        </>
      )}
    </aside>
  );
}

function StudyPage({
  status,
  note,
  onNoteChange,
  onEnd,
  onBackToday
}: {
  status: StatusKind;
  note: string;
  onNoteChange: (note: string) => void;
  onEnd: () => void;
  onBackToday: () => void;
}): JSX.Element {
  const current = blocks[0];
  const isLoading = status === 'loading';
  const isError = status === 'error';
  const aiUnavailable = status === 'ai-unavailable';

  return (
    <section className="study-layout">
      <div className="study-main">
        <button className="study-back-link" type="button" onClick={onBackToday}>
          <ArrowLeft size={16} />
          返回计划
        </button>

        <section className="study-hero" aria-label="当前学习任务">
          <div className="study-task-copy">
            <span className="focus-label">当前任务</span>
            <div className="study-title-line">
              <h2>{current.title}</h2>
              <span className="badge">复习</span>
            </div>
            <p>{current.objective}</p>
            <div className="study-progress-title">
              <strong>今日进度</strong>
              <span>3 项任务</span>
            </div>
          </div>

          <div className="study-timer-area">
            <div className="study-timer-card">
              <span>
                专注中
                <i aria-hidden="true" />
              </span>
              <strong>00:18:24</strong>
            </div>
            <div className="study-mode-row" aria-label="学习模式">
              <button type="button">
                <Clock3 size={14} />
                番茄钟
              </button>
              <button type="button">
                <Monitor size={14} />
                沉浸模式
              </button>
            </div>
          </div>

          <StudyProgressSteps />
        </section>

        {isLoading && <StatePanel type="loading" title="正在恢复学习会话" text="模拟恢复 active session。" />}
        {isError && <StatePanel type="error" title="学习块状态冲突" text="模拟 block 不存在或 session 创建失败。" />}

        <section className="study-editor-panel" aria-label="学习笔记">
          <div className="editor-tabs" role="tablist" aria-label="学习内容">
            <button type="button">
              <BookOpen size={16} />
              任务说明
            </button>
            <button className="active" type="button">
              <PencilLine size={16} />
              我的笔记
            </button>
            <button type="button">
              <Folder size={16} />
              参考资料
            </button>
          </div>

          <div className="editor-toolbar" aria-label="笔记工具栏">
            <button type="button">正文</button>
            <button type="button">14</button>
            <span />
            <button type="button" aria-label="加粗">
              <Bold size={16} />
            </button>
            <button type="button" aria-label="斜体">
              <Italic size={16} />
            </button>
            <button type="button" aria-label="下划线">
              <Underline size={16} />
            </button>
            <button type="button" aria-label="无序列表">
              <List size={16} />
            </button>
            <button type="button" aria-label="有序列表">
              <ListOrdered size={16} />
            </button>
            <button type="button" aria-label="代码">
              <Code2 size={16} />
            </button>
            <button type="button" aria-label="链接">
              <Link size={16} />
            </button>
            <button type="button" aria-label="图片">
              <Image size={16} />
            </button>
            <button className="toolbar-expand" type="button" aria-label="展开编辑器">
              <Maximize2 size={16} />
            </button>
          </div>

          <textarea
            className="study-note-input"
            value={note}
            onChange={(event) => onNoteChange(event.target.value)}
            aria-label="我的学习笔记"
          />

          <div className="editor-footer">
            <span>
              <CheckCircle2 size={14} />
              已自动保存 10:32
            </span>
            <span>字数：{note.length}</span>
          </div>
        </section>

        <div className="study-footer-actions">
          <button className="secondary-action" type="button">
            <Flag size={16} />
            标记任务
          </button>
          <div>
            <button className="secondary-action study-pause-action" type="button">
              <Pause size={16} />
              暂停学习
            </button>
            <button className="primary-action" disabled={isLoading || isError} onClick={onEnd}>
              <Square size={16} />
              结束学习
            </button>
          </div>
        </div>
      </div>

      <StudyAiPanel unavailable={aiUnavailable} />
    </section>
  );
}

function StudyProgressSteps(): JSX.Element {
  return (
    <div className="study-progress-steps" aria-label="今日学习进度">
      <div className="study-step done">
        <span>
          <CheckCircle2 size={16} />
        </span>
        <strong>预习</strong>
        <small>25 分钟</small>
      </div>
      <div className="study-step active">
        <span>2</span>
        <strong>组件通信自测</strong>
        <small>进行中</small>
      </div>
      <div className="study-step">
        <span>3</span>
        <strong>今日小结</strong>
        <small>10 分钟</small>
      </div>
    </div>
  );
}

function StudyAiPanel({ unavailable }: { unavailable: boolean }): JSX.Element {
  return (
    <aside className="study-ai-panel" aria-label="AI 学习助手">
      <div className="today-ai-heading">
        <Sparkles size={20} />
        <h3>AI 学习助手</h3>
      </div>
      {unavailable ? (
        <StatePanel type="ai-unavailable" title="AI 学习助手不可用" text="仍可继续学习、记笔记和结算。" />
      ) : (
        <>
          <div className="assistant-tabs" role="tablist" aria-label="AI 助手内容">
            <button className="active" type="button">
              助手对话
            </button>
            <button type="button">知识卡片</button>
          </div>

          <div className="assistant-message assistant-message-system">
            你好！关于当前任务，有什么疑问或需要我帮你梳理的知识点吗？
          </div>
          <div className="assistant-message assistant-message-user">useEffect 的依赖项变化时会发生什么？</div>
          <div className="assistant-answer">
            <p>当依赖项变化时，React 会：</p>
            <ol>
              <li>先执行上一次 effect 的清理函数（如果有）</li>
              <li>再执行新的 effect</li>
              <li>如果组件首次渲染，则只执行 effect</li>
            </ol>
            <button type="button">
              <Code2 size={14} />
              展开示例代码
            </button>
          </div>

          <div className="assistant-suggestion-row">
            <button type="button">讲讲闭包与 useEffect</button>
            <button type="button">如何避免无限循环</button>
            <button type="button">清理函数的使用场景</button>
          </div>

          <div className="assistant-input">
            <span>输入你的问题...</span>
            <button type="button" aria-label="发送问题">
              <SendHorizontal size={20} />
            </button>
          </div>
        </>
      )}
    </aside>
  );
}

function SettlementPage({
  status,
  note,
  onBackStudy,
  onSave
}: {
  status: StatusKind;
  note: string;
  onBackStudy: () => void;
  onSave: () => void;
}): JSX.Element {
  const isLoading = status === 'loading';
  const isError = status === 'error';
  const isEmpty = status === 'empty';

  return (
    <section className="page-grid">
      <div className="main-column">
        <section className="surface">
          <div className="section-heading">
            <div>
              <h3>学习结束结算</h3>
              <p>确认完成程度后才进入复盘。这里不自动完成整个任务。</p>
            </div>
          </div>

          {isEmpty && <StatePanel type="empty" title="没有可结算的学习会话" text="模拟没有 active session 的空状态。" />}
          {isLoading && <StatePanel type="loading" title="正在保存结算" text="模拟保存 session、block 状态和备注。" />}
          {isError && <StatePanel type="error" title="结算保存失败" text="模拟保存失败；正式业务不应切到完成状态。" />}

          {!isEmpty && (
            <>
              <div className="settlement-options">
                <label className="choice active">
                  <input type="radio" name="result" defaultChecked />
                  <span>
                    <strong>完成本块</strong>
                    <small>达成本块验收标准，但不默认完成整个任务。</small>
                  </span>
                </label>
                <label className="choice">
                  <input type="radio" name="result" />
                  <span>
                    <strong>部分完成</strong>
                    <small>保留剩余动作，后续继续规划。</small>
                  </span>
                </label>
                <label className="choice">
                  <input type="radio" name="result" />
                  <span>
                    <strong>跳过</strong>
                    <small>需要记录原因，供复盘使用。</small>
                  </span>
                </label>
              </div>

              <div className="study-card">
                <Detail label="实际输出" value={note || '尚未填写输出'} />
                <Detail label="任务状态" value="仅完成学习块；任务是否完成需要单独确认。" />
                <Detail label="知识沉淀" value="可将备注保存为知识条目；本原型只展示，不写入。" />
              </div>

              <div className="session-controls">
                <button className="secondary-action" onClick={onBackStudy}>
                  返回修改
                </button>
                <button className="primary-action" disabled={isLoading || isError} onClick={onSave}>
                  保存结算并进入复盘
                  <ArrowRight size={18} />
                </button>
              </div>
            </>
          )}
        </section>
      </div>

      <aside className="context-panel">
        <h3>结算规则</h3>
        <p>学习块完成不等于任务自动完成。用户确认后，复盘页才读取这次假数据。</p>
        <div className="advice-list">
          <span>完成：更新块进度。</span>
          <span>部分完成：保留后续动作。</span>
          <span>跳过：必须记录原因。</span>
        </div>
      </aside>
    </section>
  );
}

function ReviewPage({
  status,
  onBackToday,
  onRestart
}: {
  status: StatusKind;
  onBackToday: () => void;
  onRestart: () => void;
}): JSX.Element {
  const isLoading = status === 'loading';
  const isError = status === 'error';
  const isEmpty = status === 'empty';
  const aiUnavailable = status === 'ai-unavailable';

  return (
    <section className="page-grid">
      <div className="main-column">
        <section className="surface">
          <div className="section-heading">
            <div>
              <h3>今日复盘</h3>
              <p>假数据复盘结果。没有调用 DeepSeek。</p>
            </div>
            <span className="badge success">已生成模拟结果</span>
          </div>

          {isEmpty && <StatePanel type="empty" title="没有可复盘数据" text="模拟当天没有 session 或计划。" />}
          {isLoading && <StatePanel type="loading" title="正在生成复盘" text="模拟 AI 复盘加载状态；没有真实请求。" />}
          {isError && <StatePanel type="error" title="复盘生成失败" text="模拟 AI 输出格式错误或保存失败。" />}
          {aiUnavailable && <StatePanel type="ai-unavailable" title="AI 不可用" text="仍可查看本地执行摘要。" />}

          {!isEmpty && (
            <>
              <div className="metrics">
                <Metric label="完成度" value="80" />
                <Metric label="专注度" value="72" />
                <Metric label="实际时长" value="12m" />
              </div>
              <div className="review-list">
                {fakeReviewItems.map((item) => (
                  <div className="review-item" key={item}>
                    <CheckCircle2 size={16} />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
              <section className="proposal-box">
                <h4>计划调整建议（模拟）</h4>
                <p>建议将下一块拆成两个更小的练习：概念复述 10 分钟、代码验证 10 分钟。</p>
                <p className="muted">这只是待确认建议，不会修改正式计划。</p>
              </section>
            </>
          )}

          <div className="session-controls">
            <button className="secondary-action" onClick={onRestart}>
              再学一块
            </button>
            <button className="primary-action" onClick={onBackToday}>
              回到今日
            </button>
          </div>
        </section>
      </div>

      <aside className="context-panel">
        <h3>AI 教师面板</h3>
        <p>复盘页用于解释评分和调整建议。当前为静态模拟，不应用任何建议。</p>
        <div className="advice-list">
          <span>有效：完成了核心输出。</span>
          <span>风险：实际时长超过预估。</span>
          <span>下一步：拆小任务后再确认。</span>
        </div>
      </aside>
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="detail">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatePanel({ type, title, text }: { type: StatusKind; title: string; text: string }): JSX.Element {
  const icon = {
    normal: <CheckCircle2 size={18} />,
    empty: <BookOpen size={18} />,
    loading: <Loader2 size={18} />,
    error: <XCircle size={18} />,
    'ai-unavailable': <Brain size={18} />
  }[type];
  return (
    <div className={`state-panel ${type}`}>
      {icon}
      <div>
        <strong>{title}</strong>
        <span>{text}</span>
      </div>
    </div>
  );
}

function StatusGallery({ activeStatus }: { activeStatus: StatusKind }): JSX.Element {
  const items: Array<{ type: StatusKind; title: string; text: string }> = [
    { type: 'normal', title: '正常状态', text: '主流程可点击。' },
    { type: 'empty', title: '空状态', text: '没有任务、计划或 session。' },
    { type: 'loading', title: '加载状态', text: '模拟读取或保存中。' },
    { type: 'error', title: '错误状态', text: '模拟读取或保存失败。' },
    { type: 'ai-unavailable', title: 'AI 不可用', text: '本地流程仍可继续。' }
  ];

  return (
    <section className="status-gallery" aria-label="状态样例">
      {items.map((item) => (
        <div className={item.type === activeStatus ? 'status-card active' : 'status-card'} key={item.type}>
          <StatePanel type={item.type} title={item.title} text={item.text} />
        </div>
      ))}
    </section>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
