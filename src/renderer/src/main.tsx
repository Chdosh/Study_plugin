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

function App(): JSX.Element {
  const [view, setView] = useState<ViewKey>('today');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [plans, setPlans] = useState<DailyPlan[]>([]);
  const [prompts, setPrompts] = useState<PromptProfile[]>([]);
  const [activeSession, setActiveSession] = useState<StudySession | null>(null);
  const [review, setReview] = useState<ReviewResult | null>(null);
  const [notice, setNotice] = useState<string>('Ready');

  const confirmedPlan = useMemo(
    () => plans.find((plan) => plan.status === 'confirmed') ?? plans[0] ?? null,
    [plans]
  );

  async function refresh(): Promise<void> {
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
      setNotice(`${label} completed`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  useEffect(() => {
    void runAction('Loading workspace', refresh);
  }, []);

  if (!settings) {
    return (
      <div className="boot">
        <Timer size={24} />
        <span>Loading Study Supervisor</span>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Sidebar current={view} onSelect={setView} />
      <main className="workspace">
        <TopBar settings={settings} notice={notice} onRefresh={() => void runAction('Refresh', refresh)} />
        {view === 'today' && (
          <TodayView
            settings={settings}
            tasks={tasks}
            plan={confirmedPlan}
            onGeneratePlan={(date, windows) =>
              runAction('Generate plan', async () => {
                await window.studyApp.plans.generate(date, windows);
                await refresh();
              })
            }
            onConfirmPlan={(planId) =>
              runAction('Confirm plan', async () => {
                await window.studyApp.plans.confirm(planId);
                await refresh();
              })
            }
            onStart={(blockId) =>
              runAction('Start session', async () => {
                const session = await window.studyApp.sessions.start(blockId);
                setActiveSession(session);
                await refresh();
              })
            }
            onSkip={(blockId, reason) =>
              runAction('Skip block', async () => {
                await window.studyApp.sessions.skip(blockId, reason);
                await refresh();
              })
            }
            activeSession={activeSession}
            onCompleteSession={(notes) =>
              activeSession
                ? runAction('Complete session', async () => {
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
            onImported={() => runAction('Refresh imports', refresh)}
            runAction={runAction}
          />
        )}
        {view === 'tasks' && <TasksView tasks={tasks} runAction={runAction} onChanged={refresh} />}
        {view === 'review' && (
          <ReviewView
            review={review}
            onGenerate={() =>
              runAction('Generate review', async () => {
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
    { key: 'today', label: 'Today', icon: <CalendarClock size={18} /> },
    { key: 'import', label: 'Import Plan', icon: <ClipboardList size={18} /> },
    { key: 'tasks', label: 'Tasks', icon: <BookOpen size={18} /> },
    { key: 'review', label: 'Review', icon: <RotateCcw size={18} /> },
    { key: 'settings', label: 'Settings', icon: <Settings size={18} /> }
  ];
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">SS</div>
        <div>
          <strong>Study Supervisor</strong>
          <span>Local AI planner</span>
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
        <h1>Today</h1>
        <p>{notice}</p>
      </div>
      <div className="top-actions">
        <span className={settings.hasDeepseekApiKey ? 'status ok' : 'status warn'}>
          <KeyRound size={14} />
          {settings.hasDeepseekApiKey ? 'DeepSeek ready' : 'API key needed'}
        </span>
        <button className="icon-button" onClick={onRefresh} title="Refresh">
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
            <h2>Ten-minute plan</h2>
            <p>{unresolved.length} unresolved tasks</p>
          </div>
          <div className="button-row">
            <button className="secondary-button" onClick={() => void onGeneratePlan(todayIso, settings.dailyStudyWindows)}>
              <Wand2 size={16} />
              Generate
            </button>
            {plan?.status === 'draft' && (
              <button className="primary-button" onClick={() => void onConfirmPlan(plan.id)}>
                <CheckCircle2 size={16} />
                Confirm
              </button>
            )}
          </div>
        </div>
        {plan ? (
          <Timeline blocks={plan.blocks} onStart={onStart} onSkip={onSkip} />
        ) : (
          <EmptyState title="No plan for today" text="Generate a draft after importing tasks." />
        )}
      </div>
      <aside className="inspector">
        <div className="metric-row">
          <div>
            <span>Completion</span>
            <strong>
              {completedBlocks}/{totalBlocks}
            </strong>
          </div>
          <div>
            <span>Block size</span>
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
              <span className={`pill ${block.status}`}>{block.status}</span>
            </div>
            <p>{block.action}</p>
            <div className="block-meta">
              <span>Output: {block.expectedOutput}</span>
              <span>Check: {block.successCheck}</span>
            </div>
          </div>
          <div className="row-actions">
            <button className="icon-button" title="Start" onClick={() => void onStart(block.id)}>
              <Play size={16} />
            </button>
            <button
              className="text-button"
              onClick={() => {
                const reason = window.prompt('Reason for skipping this block?');
                if (reason) void onSkip(block.id, reason);
              }}
            >
              Skip
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
      <h3>Focus Block</h3>
      {activeSession ? (
        <>
          <p className="muted">Started {new Date(activeSession.startedAt).toLocaleTimeString()}</p>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Session notes or output"
          />
          <button className="primary-button full" onClick={() => void onComplete(notes)}>
            Complete
          </button>
        </>
      ) : (
        <p className="muted">Start a timeline block to begin monitoring foreground app changes.</p>
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
            <h2>Import Plan</h2>
            <p>Paste a full plan from ChatGPT, Codex, or manual notes.</p>
          </div>
        </div>
        <textarea
          className="large-input"
          value={rawText}
          onChange={(event) => setRawText(event.target.value)}
          placeholder="Paste your study plan here..."
        />
        <div className="form-grid">
          <label>
            Source
            <select value={source} onChange={(event) => setSource(event.target.value as RawImport['source'])}>
              <option value="chatgpt">ChatGPT</option>
              <option value="codex">Codex</option>
              <option value="manual">Manual</option>
            </select>
          </label>
          <label>
            Prompt profile
            <select value={promptProfileId} onChange={(event) => setPromptProfileId(event.target.value)}>
              <option value="">Foundation default</option>
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
            void runAction('Import and parse', async () => {
              const created = await window.studyApp.imports.create(rawText, source);
              await window.studyApp.imports.parse(created.id, promptProfileId || undefined);
              setRawText('');
              await onImported();
            })
          }
        >
          <Wand2 size={16} />
          Import and Parse
        </button>
      </div>
      <aside className="inspector">
        <h3>Parsing Contract</h3>
        <p className="muted">AI output must become goals, tasks, dependencies, estimates, and checks before it enters the task list.</p>
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
          <h2>Task List</h2>
          <p>{tasks.length} local tasks</p>
        </div>
      </div>
      <div className="task-list">
        {tasks.map((task) => (
          <div className="task-row" key={task.id}>
            <div>
              <strong>{task.title}</strong>
              <p>{task.description || task.acceptanceCriteria || 'No details yet'}</p>
            </div>
            <div className="task-controls">
              <span className="pill">{task.difficulty}</span>
              <select
                value={task.status}
                onChange={(event) =>
                  void runAction('Update task', async () => {
                    await window.studyApp.tasks.update(task.id, { status: event.target.value as TaskItem['status'] });
                    await onChanged();
                  })
                }
              >
                <option value="backlog">backlog</option>
                <option value="planned">planned</option>
                <option value="in_progress">in progress</option>
                <option value="done">done</option>
                <option value="skipped">skipped</option>
              </select>
            </div>
          </div>
        ))}
        {tasks.length === 0 && <EmptyState title="No tasks" text="Import a plan to create tasks." />}
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
            <h2>Review</h2>
            <p>Generate a daily score and next actions from local execution data.</p>
          </div>
          <button className="primary-button" onClick={() => void onGenerate()}>
            <Wand2 size={16} />
            Generate
          </button>
        </div>
        {review ? (
          <div className="review-output">
            <div className="metric-row">
              <div>
                <span>Completion</span>
                <strong>{review.completionScore}</strong>
              </div>
              <div>
                <span>Focus</span>
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
          <EmptyState title="No review yet" text="Generate after a study session or skipped block." />
        )}
      </div>
      <aside className="inspector">
        <h3>Human confirmation</h3>
        <p className="muted">Review suggestions do not overwrite confirmed plans automatically.</p>
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
            <h2>Settings</h2>
            <p>Provider, schedule, and prompt profiles.</p>
          </div>
          <button
            className="primary-button"
            onClick={() =>
              void runAction('Save settings', async () => {
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
            Save
          </button>
        </div>
        <div className="form-grid">
          <label>
            DeepSeek base URL
            <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
          </label>
          <label>
            Model
            <input value={model} onChange={(event) => setModel(event.target.value)} />
          </label>
          <label>
            API key
            <input
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={settings.hasDeepseekApiKey ? 'Stored securely' : 'Paste key to store'}
              type="password"
            />
          </label>
          <label>
            Block minutes
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
        <h3>Prompt Profiles</h3>
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
            void runAction('Save prompt', async () => {
              await window.studyApp.prompts.update(selectedPrompt.id, promptContent);
              await onSaved();
            })
          }
        >
          Save Prompt Version
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
