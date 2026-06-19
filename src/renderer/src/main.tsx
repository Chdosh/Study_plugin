import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BookOpen,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  History,
  KeyRound,
  Play,
  RotateCcw,
  Settings,
  Timer,
  Wand2
} from 'lucide-react';
import type {
  AppSettings,
  DailyPlan,
  DailyPlanBlock,
  PromptProfile,
  RawImport,
  ReviewResult,
  StudySession,
  StudyWindow,
  TaskItem
} from '../../shared/types';
import './styles.css';

type ViewKey = 'workbench' | 'tasks' | 'review' | 'settings';

const todayIso = new Date().toISOString().slice(0, 10);

const taskStatusLabels: Record<TaskItem['status'], string> = {
  backlog: '待安排',
  planned: '已计划',
  in_progress: '进行中',
  done: '已完成',
  skipped: '已跳过'
};

const planStatusLabels: Record<DailyPlanBlock['status'], string> = {
  planned: '已计划',
  active: '进行中',
  done: '已完成',
  skipped: '已跳过',
  deferred: '已推迟'
};

const dailyPlanStatusLabels: Record<DailyPlan['status'], string> = {
  draft: '草稿',
  confirmed: '已确认',
  archived: '历史'
};

const difficultyLabels: Record<TaskItem['difficulty'], string> = {
  foundation: '基础',
  standard: '标准',
  advanced: '进阶',
  exam: '考核'
};

function planStatusLabel(status: DailyPlanBlock['status']): string {
  return planStatusLabels[status] ?? status;
}

function difficultyLabel(difficulty: TaskItem['difficulty']): string {
  return difficultyLabels[difficulty] ?? difficulty;
}

function dailyPlanStatusLabel(status: DailyPlan['status']): string {
  return dailyPlanStatusLabels[status] ?? status;
}

function App(): JSX.Element {
  const [view, setView] = useState<ViewKey>('workbench');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [plans, setPlans] = useState<DailyPlan[]>([]);
  const [prompts, setPrompts] = useState<PromptProfile[]>([]);
  const [activeSession, setActiveSession] = useState<StudySession | null>(null);
  const [review, setReview] = useState<ReviewResult | null>(null);
  const [notice, setNotice] = useState<string>('就绪');
  const [bootError, setBootError] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

  const activePlan = useMemo(
    () => plans.find((plan) => plan.id === selectedPlanId) ?? plans[0] ?? null,
    [plans, selectedPlanId]
  );

  const currentViewTitle = {
    workbench: ['学习工作台', '导入、生成、确认和执行都在这里完成。'],
    tasks: ['任务清单', '查看和调整本地任务状态。'],
    review: ['复盘', '根据本地执行记录生成评分和下一步动作。'],
    settings: ['设置', '配置模型、学习节奏和提示词档位。']
  }[view];

  async function refresh(preferredPlanId?: string): Promise<void> {
    if (!window.studyApp) {
      throw new Error('Electron preload API 不可用，请检查主进程里的 preload 路径。');
    }
    const [nextSettings, nextTasks, nextPlans, nextPrompts] = await Promise.all([
      window.studyApp.settings.get(),
      window.studyApp.tasks.list(),
      window.studyApp.plans.list(todayIso),
      window.studyApp.prompts.list()
    ]);
    setSettings(nextSettings);
    setTasks(nextTasks);
    setPlans(nextPlans);
    setPrompts(nextPrompts);
    setSelectedPlanId((current) => {
      if (preferredPlanId && nextPlans.some((plan) => plan.id === preferredPlanId)) return preferredPlanId;
      if (current && nextPlans.some((plan) => plan.id === current)) return current;
      return nextPlans[0]?.id ?? null;
    });
  }

  async function runAction(label: string, action: () => Promise<void>): Promise<void> {
    setNotice(`${label}...`);
    try {
      await action();
      setBootError(null);
      setNotice(`${label}完成`);
    } catch (error) {
      const message = toUserErrorMessage(error);
      setBootError(message);
      setNotice(message);
    }
  }

  useEffect(() => {
    void runAction('加载工作区', refresh);
  }, []);

  if (!settings) {
    return (
      <div className="boot">
        <Timer size={24} />
        <span>正在加载学习管家</span>
        {bootError && (
          <div className="boot-error">
            <strong>启动失败</strong>
            <p>{bootError}</p>
            <button className="secondary-button" onClick={() => void runAction('重试启动', refresh)}>
              重试
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Sidebar current={view} onSelect={setView} />
      <main className="workspace">
        <TopBar
          title={currentViewTitle[0]}
          subtitle={currentViewTitle[1]}
          settings={settings}
          notice={notice}
          onRefresh={() => void runAction('刷新', refresh)}
        />
        {view === 'workbench' && (
          <WorkbenchView
            settings={settings}
            tasks={tasks}
            plans={plans}
            activePlan={activePlan}
            selectedPlanId={selectedPlanId}
            prompts={prompts}
            runAction={runAction}
            onSelectPlan={setSelectedPlanId}
            onDataChanged={refresh}
            onGeneratePlan={(date, windows, promptProfileId) =>
              runAction('生成计划', async () => {
                const plan = await window.studyApp.plans.generate(date, windows, promptProfileId);
                await refresh(plan.id);
              })
            }
            onConfirmPlan={(planId) =>
              runAction('确认计划', async () => {
                await window.studyApp.plans.confirm(planId);
                await refresh(planId);
              })
            }
            onStart={(blockId) =>
              runAction('开始学习', async () => {
                const session = await window.studyApp.sessions.start(blockId);
                setActiveSession(session);
                await refresh();
              })
            }
            onSkip={(blockId, reason) =>
              runAction('跳过学习块', async () => {
                await window.studyApp.sessions.skip(blockId, reason);
                await refresh();
              })
            }
            activeSession={activeSession}
            onCompleteSession={(notes) =>
              activeSession
                ? runAction('完成学习', async () => {
                    const session = await window.studyApp.sessions.complete(activeSession.id, notes);
                    setActiveSession(session);
                    await refresh();
                  })
                : Promise.resolve()
            }
          />
        )}
        {view === 'tasks' && <TasksView tasks={tasks} runAction={runAction} onChanged={refresh} />}
        {view === 'review' && (
          <ReviewView
            review={review}
            onGenerate={() =>
              runAction('生成复盘', async () => {
                setReview(await window.studyApp.reviews.generate(todayIso));
              })
            }
          />
        )}
        {view === 'settings' && (
          <SettingsView
            settings={settings}
            prompts={prompts}
            runAction={runAction}
            onSaved={refresh}
          />
        )}
      </main>
    </div>
  );
}

function Sidebar({ current, onSelect }: { current: ViewKey; onSelect: (view: ViewKey) => void }): JSX.Element {
  const items: Array<{ key: ViewKey; label: string; icon: JSX.Element }> = [
    { key: 'workbench', label: '学习工作台', icon: <CalendarClock size={18} /> },
    { key: 'tasks', label: '任务清单', icon: <BookOpen size={18} /> },
    { key: 'review', label: '复盘', icon: <RotateCcw size={18} /> },
    { key: 'settings', label: '设置', icon: <Settings size={18} /> }
  ];
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">SS</div>
        <div>
          <strong>学习管家</strong>
          <span>本地 AI 学习监督</span>
        </div>
      </div>
      <nav className="nav-list">
        {items.map((item) => (
          <button
            className={item.key === current ? 'nav-item active' : 'nav-item'}
            key={item.key}
            onClick={() => onSelect(item.key)}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </nav>
    </aside>
  );
}

function TopBar({
  title,
  subtitle,
  settings,
  notice,
  onRefresh
}: {
  title: string;
  subtitle: string;
  settings: AppSettings;
  notice: string;
  onRefresh: () => void;
}): JSX.Element {
  return (
    <header className="topbar">
      <div>
        <h1>{title}</h1>
        <p>{subtitle} 当前状态：{notice}</p>
      </div>
      <div className="top-actions">
        <span className={settings.hasDeepseekApiKey ? 'status ok' : 'status warn'}>
          <KeyRound size={14} />
          {settings.hasDeepseekApiKey ? 'DeepSeek 已配置' : '需要 API Key'}
        </span>
        <button className="icon-button" onClick={onRefresh} title="刷新">
          <RotateCcw size={17} />
        </button>
      </div>
    </header>
  );
}

function WorkbenchView({
  settings,
  tasks,
  plans,
  activePlan,
  selectedPlanId,
  prompts,
  runAction,
  onSelectPlan,
  onDataChanged,
  activeSession,
  onGeneratePlan,
  onConfirmPlan,
  onStart,
  onSkip,
  onCompleteSession
}: {
  settings: AppSettings;
  tasks: TaskItem[];
  plans: DailyPlan[];
  activePlan: DailyPlan | null;
  selectedPlanId: string | null;
  prompts: PromptProfile[];
  runAction: (label: string, action: () => Promise<void>) => Promise<void>;
  onSelectPlan: (planId: string) => void;
  onDataChanged: () => Promise<void>;
  activeSession: StudySession | null;
  onGeneratePlan: (date: string, windows: StudyWindow[], promptProfileId?: string) => Promise<void>;
  onConfirmPlan: (planId: string) => Promise<void>;
  onStart: (blockId: string) => Promise<void>;
  onSkip: (blockId: string, reason: string) => Promise<void>;
  onCompleteSession: (notes: string) => Promise<void>;
}): JSX.Element {
  const unresolved = tasks.filter((task) => !['done', 'skipped'].includes(task.status));
  const completedBlocks = activePlan?.blocks.filter((block) => block.status === 'done').length ?? 0;
  const totalBlocks = activePlan?.blocks.length ?? 0;
  const [promptProfileId, setPromptProfileId] = useState<string>('');

  return (
    <section className="workbench-grid">
      <aside className="primary-surface flow-panel">
        <div className="section-header">
          <div>
            <h2>导入与生成</h2>
            <p>今天的任务上下文集中在这里维护。</p>
          </div>
        </div>
        <QuickImportPanel
          prompts={prompts}
          promptProfileId={promptProfileId}
          onPromptProfileChange={setPromptProfileId}
          runAction={runAction}
          onImported={onDataChanged}
        />
        <div className="compact-divider" />
        <div className="side-section">
          <div className="context-row">
            <span>未完成任务</span>
            <strong>{unresolved.length}</strong>
          </div>
          <div className="context-row">
            <span>学习块长度</span>
            <strong>{settings.defaultBlockMinutes} 分钟</strong>
          </div>
          <button
            className="primary-button full"
            disabled={unresolved.length === 0}
            onClick={() => void onGeneratePlan(todayIso, settings.dailyStudyWindows, promptProfileId || undefined)}
          >
            <Wand2 size={16} />
            生成今日草稿
          </button>
          <p className="muted">每次生成都会保存为今天的一条草稿历史，确认后才进入正式执行。</p>
        </div>
      </aside>

      <div className="primary-surface plan-surface">
        <div className="section-header compact-header">
          <div>
            <h2>{activePlan ? `${todayIso} 计划` : '今日计划'}</h2>
            <p>
              {activePlan
                ? `${dailyPlanStatusLabel(activePlan.status)} · ${activePlan.blocks.length} 个时间块`
                : '先导入任务，再生成今日草稿。'}
            </p>
          </div>
          {activePlan?.status === 'draft' && (
            <button className="primary-button" onClick={() => void onConfirmPlan(activePlan.id)}>
              <CheckCircle2 size={16} />
              确认草稿
            </button>
          )}
        </div>
        {activePlan ? (
          <Timeline blocks={activePlan.blocks} onStart={onStart} onSkip={onSkip} />
        ) : (
          <EmptyState title="今天还没有计划" text="先导入任务，再生成 AI 草稿计划。" />
        )}
      </div>
      <aside className="inspector">
        <div className="metric-row">
          <div>
            <span>完成度</span>
            <strong>
              {completedBlocks}/{totalBlocks}
            </strong>
          </div>
          <div>
            <span>历史</span>
            <strong>{plans.length}</strong>
          </div>
        </div>
        <PlanHistory
          plans={plans}
          selectedPlanId={selectedPlanId}
          onSelectPlan={onSelectPlan}
        />
        <FocusBlock activeSession={activeSession} onComplete={onCompleteSession} />
      </aside>
    </section>
  );
}

function Timeline({
  blocks,
  onStart,
  onSkip
}: {
  blocks: DailyPlanBlock[];
  onStart: (blockId: string) => Promise<void>;
  onSkip: (blockId: string, reason: string) => Promise<void>;
}): JSX.Element {
  return (
    <div className="timeline">
      {blocks.map((block) => (
        <div className="timeline-row" key={block.id}>
          <div className="time-cell">
            <span>{block.startTime}</span>
            <small>{block.durationMinutes}m</small>
          </div>
          <div className="block-body">
            <div className="block-title">
              <strong>{block.objective}</strong>
              <span className={`pill ${block.status}`}>{planStatusLabel(block.status)}</span>
            </div>
            <p>{block.action}</p>
            <div className="block-meta">
              <span>输出：{block.expectedOutput}</span>
              <span>验收：{block.successCheck}</span>
            </div>
          </div>
          <div className="row-actions">
            <button className="icon-button" title="开始" onClick={() => void onStart(block.id)}>
              <Play size={16} />
            </button>
            <button
              className="text-button"
              onClick={() => {
                const reason = window.prompt('为什么跳过这个学习块？');
                if (reason) void onSkip(block.id, reason);
              }}
            >
              跳过
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function FocusBlock({
  activeSession,
  onComplete
}: {
  activeSession: StudySession | null;
  onComplete: (notes: string) => Promise<void>;
}): JSX.Element {
  const [notes, setNotes] = useState('');
  return (
    <div className="side-section">
      <h3>当前专注块</h3>
      {activeSession ? (
        <>
          <p className="muted">开始于 {new Date(activeSession.startedAt).toLocaleTimeString()}</p>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="记录本次学习输出或备注"
          />
          <button className="primary-button full" onClick={() => void onComplete(notes)}>
            完成
          </button>
        </>
      ) : (
        <p className="muted">开始一个时间块后，会记录前台应用切换情况。</p>
      )}
    </div>
  );
}

function QuickImportPanel({
  prompts,
  promptProfileId,
  onPromptProfileChange,
  onImported,
  runAction
}: {
  prompts: PromptProfile[];
  promptProfileId: string;
  onPromptProfileChange: (profileId: string) => void;
  onImported: () => Promise<void>;
  runAction: (label: string, action: () => Promise<void>) => Promise<void>;
}): JSX.Element {
  const [source, setSource] = useState<RawImport['source']>('chatgpt');
  const [rawText, setRawText] = useState('');

  return (
    <div className="quick-import">
      <div className="compact-title">
        <ClipboardList size={16} />
        <strong>粘贴计划</strong>
      </div>
      <textarea
        className="compact-input"
        value={rawText}
        onChange={(event) => setRawText(event.target.value)}
        placeholder="粘贴 ChatGPT/Codex 给出的学习计划..."
      />
      <div className="form-grid compact-form">
        <label>
          来源
          <select value={source} onChange={(event) => setSource(event.target.value as RawImport['source'])}>
            <option value="chatgpt">ChatGPT</option>
            <option value="codex">Codex</option>
            <option value="manual">手动</option>
          </select>
        </label>
        <label>
          提示词
          <select value={promptProfileId} onChange={(event) => onPromptProfileChange(event.target.value)}>
            <option value="">默认基础模式</option>
            {prompts.map((prompt) => (
              <option value={prompt.id} key={prompt.id}>
                {prompt.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button
        className="secondary-button full"
        disabled={!rawText.trim()}
        onClick={() =>
          void runAction('导入并解析', async () => {
            const created = await window.studyApp.imports.create(rawText, source);
            await window.studyApp.imports.parse(created.id, promptProfileId || undefined);
            setRawText('');
            await onImported();
          })
        }
      >
        <Wand2 size={16} />
        导入到今日上下文
      </button>
    </div>
  );
}

function PlanHistory({
  plans,
  selectedPlanId,
  onSelectPlan
}: {
  plans: DailyPlan[];
  selectedPlanId: string | null;
  onSelectPlan: (planId: string) => void;
}): JSX.Element {
  return (
    <div className="side-section">
      <div className="compact-title">
        <History size={16} />
        <strong>今日历史</strong>
      </div>
      {plans.length > 0 ? (
        <div className="history-list">
          {plans.map((plan, index) => (
            <button
              className={plan.id === selectedPlanId ? 'history-item active' : 'history-item'}
              key={plan.id}
              onClick={() => onSelectPlan(plan.id)}
            >
              <span>
                <strong>版本 {plans.length - index}</strong>
                <small>{new Date(plan.createdAt).toLocaleTimeString()}</small>
              </span>
              <span className={`pill ${plan.status}`}>{dailyPlanStatusLabel(plan.status)}</span>
              <small>{plan.blocks.length} 块</small>
            </button>
          ))}
        </div>
      ) : (
        <p className="muted">生成今日草稿后，这里会保留每次计划版本。</p>
      )}
    </div>
  );
}

function TasksView({
  tasks,
  runAction,
  onChanged
}: {
  tasks: TaskItem[];
  runAction: (label: string, action: () => Promise<void>) => Promise<void>;
  onChanged: () => Promise<void>;
}): JSX.Element {
  return (
    <section className="primary-surface">
      <div className="section-header">
        <div>
          <h2>任务清单</h2>
          <p>{tasks.length} 个本地任务</p>
        </div>
      </div>
      <div className="task-list">
        {tasks.map((task) => (
          <div className="task-row" key={task.id}>
            <div>
              <strong>{task.title}</strong>
              <p>{task.description || task.acceptanceCriteria || '暂无细节'}</p>
            </div>
            <div className="task-controls">
              <span className="pill">{difficultyLabel(task.difficulty)}</span>
              <select
                value={task.status}
                onChange={(event) =>
                  void runAction('更新任务', async () => {
                    await window.studyApp.tasks.update(task.id, { status: event.target.value as TaskItem['status'] });
                    await onChanged();
                  })
                }
              >
                {Object.entries(taskStatusLabels).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ))}
        {tasks.length === 0 && <EmptyState title="还没有任务" text="导入一份学习计划来创建任务。" />}
      </div>
    </section>
  );
}

function ReviewView({
  review,
  onGenerate
}: {
  review: ReviewResult | null;
  onGenerate: () => Promise<void>;
}): JSX.Element {
  return (
    <section className="two-column">
      <div className="primary-surface">
        <div className="section-header">
          <div>
            <h2>复盘</h2>
            <p>根据本地执行数据生成每日评分和下一步动作。</p>
          </div>
          <button className="primary-button" onClick={() => void onGenerate()}>
            <Wand2 size={16} />
            生成
          </button>
        </div>
        {review ? (
          <div className="review-output">
            <div className="metric-row">
              <div>
                <span>完成度</span>
                <strong>{review.completionScore}</strong>
              </div>
              <div>
                <span>专注度</span>
                <strong>{review.focusScore}</strong>
              </div>
            </div>
            <p>{review.summary}</p>
            <ul>
              {review.nextActions.map((action) => (
                <li key={action}>{action}</li>
              ))}
            </ul>
          </div>
        ) : (
          <EmptyState title="还没有复盘" text="完成或跳过学习块后再生成复盘。" />
        )}
      </div>
      <aside className="inspector">
        <h3>人工确认</h3>
        <p className="muted">复盘建议不会自动覆盖已经确认的计划。</p>
      </aside>
    </section>
  );
}

function SettingsView({
  settings,
  prompts,
  runAction,
  onSaved
}: {
  settings: AppSettings;
  prompts: PromptProfile[];
  runAction: (label: string, action: () => Promise<void>) => Promise<void>;
  onSaved: () => Promise<void>;
}): JSX.Element {
  const [baseUrl, setBaseUrl] = useState(settings.deepseekBaseUrl);
  const [model, setModel] = useState(settings.deepseekModel);
  const [apiKey, setApiKey] = useState('');
  const [blockMinutes, setBlockMinutes] = useState(settings.defaultBlockMinutes);
  const [selectedPromptId, setSelectedPromptId] = useState(prompts[0]?.id ?? '');
  const selectedPrompt = prompts.find((prompt) => prompt.id === selectedPromptId) ?? prompts[0];
  const [promptContent, setPromptContent] = useState(selectedPrompt?.content ?? '');

  useEffect(() => {
    setPromptContent(selectedPrompt?.content ?? '');
  }, [selectedPrompt?.id]);

  return (
    <section className="two-column">
      <div className="primary-surface">
        <div className="section-header">
          <div>
            <h2>设置</h2>
            <p>配置模型、学习节奏和提示词档位。</p>
          </div>
          <button
            className="primary-button"
            onClick={() =>
              void runAction('保存设置', async () => {
                await window.studyApp.settings.update({
                  deepseekBaseUrl: baseUrl,
                  deepseekModel: model,
                  deepseekApiKey: apiKey,
                  defaultBlockMinutes: blockMinutes
                });
                setApiKey('');
                await onSaved();
              })
            }
          >
            保存
          </button>
        </div>
        <div className="form-grid">
          <label>
            DeepSeek Base URL
            <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
          </label>
          <label>
            模型
            <input value={model} onChange={(event) => setModel(event.target.value)} />
          </label>
          <label>
            API Key
            <input
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={settings.hasDeepseekApiKey ? '已加密保存' : '粘贴密钥后保存'}
              type="password"
            />
          </label>
          <label>
            学习块分钟数
            <input
              type="number"
              min={5}
              max={60}
              value={blockMinutes}
              onChange={(event) => setBlockMinutes(Number(event.target.value))}
            />
          </label>
        </div>
      </div>
      <aside className="inspector prompt-editor">
        <h3>提示词档位</h3>
        <select value={selectedPromptId} onChange={(event) => setSelectedPromptId(event.target.value)}>
          {prompts.map((prompt) => (
            <option value={prompt.id} key={prompt.id}>
              {prompt.name} v{prompt.version}
            </option>
          ))}
        </select>
        <textarea value={promptContent} onChange={(event) => setPromptContent(event.target.value)} />
        <button
          className="secondary-button full"
          disabled={!selectedPrompt}
          onClick={() =>
            selectedPrompt &&
            void runAction('保存提示词', async () => {
              await window.studyApp.prompts.update(selectedPrompt.id, promptContent);
              await onSaved();
            })
          }
        >
          保存新版本
        </button>
      </aside>
    </section>
  );
}

function EmptyState({ title, text }: { title: string; text: string }): JSX.Element {
  return (
    <div className="empty-state">
      <Timer size={22} />
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

function toUserErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const withoutIpcPrefix = raw.replace(/^Error invoking remote method '[^']+':\s*/u, '');
  if (withoutIpcPrefix.includes('invalid_type') || withoutIpcPrefix.includes('Required')) {
    return 'AI 返回内容格式不完整，已阻止写入正式计划。请重试生成，或在设置里调整提示词档位。';
  }
  return withoutIpcPrefix.length > 240 ? `${withoutIpcPrefix.slice(0, 240)}...` : withoutIpcPrefix;
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
