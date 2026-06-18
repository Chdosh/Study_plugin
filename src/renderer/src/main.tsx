import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BookOpen,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
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

type ViewKey = 'today' | 'import' | 'tasks' | 'review' | 'settings';

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

function App(): JSX.Element {
  const [view, setView] = useState<ViewKey>('today');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [plans, setPlans] = useState<DailyPlan[]>([]);
  const [prompts, setPrompts] = useState<PromptProfile[]>([]);
  const [activeSession, setActiveSession] = useState<StudySession | null>(null);
  const [review, setReview] = useState<ReviewResult | null>(null);
  const [notice, setNotice] = useState<string>('就绪');
  const [bootError, setBootError] = useState<string | null>(null);

  const confirmedPlan = useMemo(
    () => plans.find((plan) => plan.status === 'confirmed') ?? plans[0] ?? null,
    [plans]
  );

  async function refresh(): Promise<void> {
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
  }

  async function runAction(label: string, action: () => Promise<void>): Promise<void> {
    setNotice(`${label}...`);
    try {
      await action();
      setBootError(null);
      setNotice(`${label}完成`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
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
        <TopBar settings={settings} notice={notice} onRefresh={() => void runAction('刷新', refresh)} />
        {view === 'today' && (
          <TodayView
            settings={settings}
            tasks={tasks}
            plan={confirmedPlan}
            onGeneratePlan={(date, windows) =>
              runAction('生成计划', async () => {
                await window.studyApp.plans.generate(date, windows);
                await refresh();
              })
            }
            onConfirmPlan={(planId) =>
              runAction('确认计划', async () => {
                await window.studyApp.plans.confirm(planId);
                await refresh();
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
        {view === 'import' && (
          <ImportView
            prompts={prompts}
            onImported={() => runAction('刷新导入结果', refresh)}
            runAction={runAction}
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
    { key: 'today', label: '今日计划', icon: <CalendarClock size={18} /> },
    { key: 'import', label: '导入计划', icon: <ClipboardList size={18} /> },
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
  settings,
  notice,
  onRefresh
}: {
  settings: AppSettings;
  notice: string;
  onRefresh: () => void;
}): JSX.Element {
  return (
    <header className="topbar">
      <div>
        <h1>今日计划</h1>
        <p>{notice}</p>
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

function TodayView({
  settings,
  tasks,
  plan,
  activeSession,
  onGeneratePlan,
  onConfirmPlan,
  onStart,
  onSkip,
  onCompleteSession
}: {
  settings: AppSettings;
  tasks: TaskItem[];
  plan: DailyPlan | null;
  activeSession: StudySession | null;
  onGeneratePlan: (date: string, windows: StudyWindow[]) => Promise<void>;
  onConfirmPlan: (planId: string) => Promise<void>;
  onStart: (blockId: string) => Promise<void>;
  onSkip: (blockId: string, reason: string) => Promise<void>;
  onCompleteSession: (notes: string) => Promise<void>;
}): JSX.Element {
  const unresolved = tasks.filter((task) => !['done', 'skipped'].includes(task.status));
  const completedBlocks = plan?.blocks.filter((block) => block.status === 'done').length ?? 0;
  const totalBlocks = plan?.blocks.length ?? 0;

  return (
    <section className="work-grid">
      <div className="primary-surface">
        <div className="section-header">
          <div>
            <h2>十分钟计划</h2>
            <p>{unresolved.length} 个未完成任务</p>
          </div>
          <div className="button-row">
            <button className="secondary-button" onClick={() => void onGeneratePlan(todayIso, settings.dailyStudyWindows)}>
              <Wand2 size={16} />
              生成
            </button>
            {plan?.status === 'draft' && (
              <button className="primary-button" onClick={() => void onConfirmPlan(plan.id)}>
                <CheckCircle2 size={16} />
                确认
              </button>
            )}
          </div>
        </div>
        {plan ? (
          <Timeline blocks={plan.blocks} onStart={onStart} onSkip={onSkip} />
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
            <span>块长度</span>
            <strong>{settings.defaultBlockMinutes}m</strong>
          </div>
        </div>
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

function ImportView({
  prompts,
  onImported,
  runAction
}: {
  prompts: PromptProfile[];
  onImported: () => Promise<void>;
  runAction: (label: string, action: () => Promise<void>) => Promise<void>;
}): JSX.Element {
  const [source, setSource] = useState<RawImport['source']>('chatgpt');
  const [rawText, setRawText] = useState('');
  const [promptProfileId, setPromptProfileId] = useState<string>('');

  return (
    <section className="two-column">
      <div className="primary-surface">
        <div className="section-header">
          <div>
            <h2>导入计划</h2>
            <p>粘贴来自 ChatGPT、Codex 或手动整理的完整学习计划。</p>
          </div>
        </div>
        <textarea
          className="large-input"
          value={rawText}
          onChange={(event) => setRawText(event.target.value)}
          placeholder="把你的学习计划粘贴到这里..."
        />
        <div className="form-grid">
          <label>
            来源
            <select value={source} onChange={(event) => setSource(event.target.value as RawImport['source'])}>
              <option value="chatgpt">ChatGPT</option>
              <option value="codex">Codex</option>
              <option value="manual">手动</option>
            </select>
          </label>
          <label>
            提示词档位
            <select value={promptProfileId} onChange={(event) => setPromptProfileId(event.target.value)}>
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
          className="primary-button"
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
          导入并解析
        </button>
      </div>
      <aside className="inspector">
        <h3>解析约束</h3>
        <p className="muted">AI 输出必须先变成目标、任务、依赖、时间估算和验收标准，才能进入正式任务清单。</p>
      </aside>
    </section>
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

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
