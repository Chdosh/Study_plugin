import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowRight,
  AlertTriangle,
  Bell,
  BookOpen,
  Brain,
  CalendarClock,
  CheckCircle2,
  Circle,
  CircleCheck,
  CircleDot,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  FileText,
  Folder,
  HelpCircle,
  Home,
  Lightbulb,
  ListChecks,
  Loader2,
  Pause,
  PencilLine,
  Play,
  RotateCcw,
  Search,
  SendHorizontal,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  Target,
  Timer,
  TrendingUp,
  Trophy,
  Upload,
  UserRound,
  Wand2,
  X,
  XCircle
} from 'lucide-react';
import type {
  AppSettings,
  DailyPlan,
  DailyPlanBlock,
  DailyGuideBlock,
  DailyGuideTask,
  GoalBrief,
  GoalIntakeState,
  LearningRuntimeSnapshot,
  PlanAdjustmentProposal,
  PromptProfile,
  QuestionAnswerResult,
  ReviewResult,
  SubmissionEvaluationResult,
  StudySession,
  StudyWindow,
  TodayGuideState,
  TeachStepResult,
  TaskItem
} from '../../shared/types';
import { getSessionElapsedSeconds } from './float-behavior';
import './styles.css';

type ViewKey = 'today' | 'study' | 'review' | 'settings' | 'settlement';

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

function difficultyLabel(difficulty: TaskItem['difficulty'] | string): string {
  return difficultyLabels[difficulty as TaskItem['difficulty']] ?? difficulty;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatMinutes(totalMinutes: number): string {
  if (totalMinutes < 60) return `${totalMinutes}分钟`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}小时${minutes}分钟` : `${hours}小时`;
}

function formatElapsedTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

function App(): JSX.Element {
  const [view, setView] = useState<ViewKey>('today');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [onboarding, setOnboarding] = useState<GoalIntakeState | null>(null);
  const [todayGuide, setTodayGuide] = useState<TodayGuideState | null>(null);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [plans, setPlans] = useState<DailyPlan[]>([]);
  const [prompts, setPrompts] = useState<PromptProfile[]>([]);
  const [activeSession, setActiveSession] = useState<StudySession | null>(null);
  const [learningState, setLearningState] = useState<LearningRuntimeSnapshot | null>(null);
  const [teaching, setTeaching] = useState<TeachStepResult | null>(null);
  const [questionAnswer, setQuestionAnswer] = useState<QuestionAnswerResult | null>(null);
  const [submissionResult, setSubmissionResult] = useState<SubmissionEvaluationResult | null>(null);
  const [review, setReview] = useState<ReviewResult | null>(null);
  const [autoGenerateReview, setAutoGenerateReview] = useState(false);
  const [latestSettlement, setLatestSettlement] = useState<LocalSettlement | null>(null);
  const [notice, setNotice] = useState<string>('就绪');
  const [bootError, setBootError] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [studyNotes, setStudyNotes] = useState('');
  const studyElapsedRef = useRef(0);

  const activePlan = useMemo(
    () => plans.find((plan) => plan.id === selectedPlanId) ?? plans[0] ?? null,
    [plans, selectedPlanId]
  );

  const viewTitle: Record<ViewKey, [string, string]> = {
    today: ['今日', '专注当下，持续进步'],
    study: ['学习', '专注当下，深入理解，稳步提升'],
    review: ['复盘', '回看执行，调整下一步'],
    settings: ['设置', '配置模型、学习节奏和提示词档位。'],
    settlement: ['学习结算', '确认输出，沉淀进展']
  };

  const [title, subtitle] = view === 'today' && !todayGuide?.guide
    ? ['主动访谈', '我们一起澄清你的学习目标，生成专属计划。']
    : viewTitle[view];

  async function refresh(preferredPlanId?: string): Promise<void> {
    if (!window.studyApp) {
      throw new Error('Electron preload API 不可用，请检查主进程里的 preload 路径。');
    }
    const [nextSettings, nextOnboarding, nextTodayGuide, nextTasks, nextPlans, nextPrompts, nextLearningState] = await Promise.all([
      window.studyApp.settings.get(),
      window.studyApp.onboarding.getCurrent(),
      window.studyApp.guides.listToday(),
      window.studyApp.tasks.list(),
      window.studyApp.plans.list(todayIso),
      window.studyApp.prompts.list(),
      window.studyApp.learning.getState()
    ]);
    setSettings(nextSettings);
    setOnboarding(nextOnboarding);
    setTodayGuide(nextTodayGuide);
    setTasks(nextTasks);
    setPlans(nextPlans);
    setPrompts(nextPrompts);
    setLearningState(nextLearningState);
    setSelectedPlanId((current) => {
      if (preferredPlanId && nextPlans.some((plan) => plan.id === preferredPlanId)) return preferredPlanId;
      if (current && nextPlans.some((plan) => plan.id === current)) return current;
      return nextPlans[0]?.id ?? null;
    });
  }

  async function syncActiveSession(): Promise<void> {
    const [active, nextLearningState, nextTodayGuide] = await Promise.all([
      window.studyApp.sessions.getActive(),
      window.studyApp.learning.getState(),
      window.studyApp.guides.listToday()
    ]);
    setActiveSession(active?.session ?? null);
    setLearningState(nextLearningState);
    setTodayGuide(nextTodayGuide);
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
    void runAction('加载工作区', async () => {
      await refresh();
      await syncActiveSession();
    });
  }, []);

  // Listen for session state changes from main process (e.g., from float window)
  useEffect(() => {
    if (!window.studyApp?.onSessionStateChanged) return;
    const cleanup = window.studyApp.onSessionStateChanged((data) => {
      setActiveSession(data.session);
      if (data.session?.status === 'completed' || data.session?.status === 'skipped') {
        void refresh();
        setView((current) => (current === 'review' ? current : 'settlement'));
      }
    });
    return cleanup;
  }, []);

  useEffect(() => {
    if (!window.studyApp?.onNavigate) return;
    const cleanup = window.studyApp.onNavigate((page) => {
      const validPages: ViewKey[] = ['today', 'study', 'review', 'settings'];
      if (validPages.includes(page as ViewKey)) {
        setView(page as ViewKey);
        if (page === 'study') {
          void syncActiveSession();
        }
      }
    });
    return cleanup;
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
            <button className="secondary-action" onClick={() => void runAction('重试启动', refresh)}>
              重试
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="prototype-shell">
      <Sidebar current={view} onSelect={setView} />
      <main className="workspace">
        <TopBar
          title={title}
          subtitle={subtitle}
          notice={notice}
          onRefresh={() => void runAction('刷新', refresh)}
        />
        {view === 'today' && (
          <TodayView
            settings={settings}
            onboarding={onboarding}
            todayGuide={todayGuide}
            activeSession={activeSession}
            runAction={runAction}
            onSendOnboarding={(content) =>
              runAction('访谈目标', async () => {
                setOnboarding(await window.studyApp.onboarding.sendMessage(content));
                await refresh(selectedPlanId ?? undefined);
              })
            }
            onConfirmGoal={(briefPatch) =>
              runAction('确认目标并生成计划', async () => {
                const result = await window.studyApp.onboarding.confirmGoal(briefPatch);
                await window.studyApp.guides.generateLayeredPlan(result.goal.id);
                await refresh(selectedPlanId ?? undefined);
              })
            }
            onGenerateLayeredPlan={(goalId) =>
              runAction('生成分层计划', async () => {
                await window.studyApp.guides.generateLayeredPlan(goalId);
                await refresh(selectedPlanId ?? undefined);
              })
            }
            onConfirmGuide={(guideId) =>
              runAction('确认今日执行稿', async () => {
                await window.studyApp.guides.confirmDailyGuide(guideId);
                await refresh(selectedPlanId ?? undefined);
              })
            }
            onArchiveTodayAndRestart={() =>
              runAction('归档计划并重新开始', async () => {
                setOnboarding(await window.studyApp.guides.archiveTodayAndRestart());
                await refresh();
                setActiveSession(null);
              })
            }
            onStart={(blockId) =>
              runAction('开始学习', async () => {
                const session = await window.studyApp.sessions.start(blockId);
                setActiveSession(session);
                await refresh();
              })
            }
            onPause={() =>
              runAction('暂停学习', async () => {
                if (!activeSession) return;
                const session = await window.studyApp.sessions.pause(activeSession.id);
                setActiveSession(session);
                await refresh();
              })
            }
            onEnd={() =>
              runAction('结束本次学习', async () => {
                if (!activeSession) return;
                const session = await window.studyApp.sessions.pause(activeSession.id);
                setActiveSession(session);
                await refresh();
              })
            }
            onGoTo={setView}
          />
        )}
        {view === 'study' && (
          <StudyView
            activePlan={activePlan}
            activeSession={activeSession}
            learningState={learningState}
            teaching={teaching}
            questionAnswer={questionAnswer}
            submissionResult={submissionResult}
            notes={studyNotes}
            onNotesChange={setStudyNotes}
            onElapsedChange={(seconds) => { studyElapsedRef.current = seconds; }}
            onPauseSession={() =>
              activeSession
                ? runAction('暂停学习', async () => {
                    const session = await window.studyApp.sessions.pause(activeSession.id);
                    setActiveSession(session);
                    setLearningState(await window.studyApp.learning.getState());
                  })
                : Promise.resolve()
            }
            onResumeSession={() =>
              activeSession?.blockId
                ? runAction('恢复学习', async () => {
                    const session = await window.studyApp.sessions.start(activeSession.blockId!);
                    setActiveSession(session);
                    setLearningState(await window.studyApp.learning.getState());
                  })
                : Promise.resolve()
            }
            onCompleteSession={(notes) =>
              activeSession
                ? runAction('完成学习', async () => {
                    const session = await window.studyApp.sessions.complete(activeSession.id, notes);
                    setActiveSession(session);
                    await refresh();
                    setView((current) => (current === 'review' ? current : 'settlement'));
                  })
                : Promise.resolve()
            }
            onStart={(blockId) =>
              runAction('开始学习', async () => {
                const session = await window.studyApp.sessions.start(blockId);
                setActiveSession(session);
                await refresh();
              })
            }
            onTeachStep={() =>
              runAction('展开当前步骤', async () => {
                const result = await window.studyApp.learning.teachCurrentStep();
                setTeaching(result);
                setLearningState(await window.studyApp.learning.getState());
              })
            }
            onAskQuestion={(question) =>
              runAction('回答问题', async () => {
                const result = await window.studyApp.learning.askQuestion(question);
                setQuestionAnswer(result);
                setLearningState(await window.studyApp.learning.getState());
              })
            }
            onResolveQuestion={(threadId) =>
              runAction('收束问题分支', async () => {
                setLearningState(await window.studyApp.learning.resolveQuestion(threadId));
              })
            }
            onSubmitResult={(content) =>
              runAction('评估学习结果', async () => {
                const result = await window.studyApp.learning.submitResult(content);
                setSubmissionResult(result);
                setTeaching(null);
                setQuestionAnswer(null);
                setLearningState(await window.studyApp.learning.getState());
              })
            }
            onGoTo={setView}
          />
        )}
        {view === 'settlement' && (
          <SettlementView
            activeSession={activeSession}
            notes={studyNotes}
            onNotesChange={setStudyNotes}
            onBack={() => setView('study')}
            onSave={() => {
              if (activeSession) {
                setLatestSettlement({
                  session: activeSession,
                  elapsedSeconds: Math.round((activeSession.durationMinutes ?? 0) * 60),
                  notes: studyNotes
                });
              }
              setActiveSession(null);
              setStudyNotes('');
              setAutoGenerateReview(true);
              setView('review');
            }}
            onGoTo={setView}
          />
        )}
        {view === 'review' && (
          <ReviewView
            review={review}
            latestSettlement={latestSettlement}
            pendingAdjustment={learningState?.pendingAdjustment ?? null}
            autoGenerate={autoGenerateReview}
            onAutoGenerated={() => setAutoGenerateReview(false)}
            onGenerate={() =>
              runAction('生成复盘', async () => {
                setReview(await window.studyApp.reviews.generate(todayIso));
              })
            }
            hasApiKey={settings.hasDeepseekApiKey}
            onDecideAdjustment={(proposalId, status) =>
              runAction(status === 'accepted' ? '接受调整建议' : '拒绝调整建议', async () => {
                await window.studyApp.learning.decideAdjustment(proposalId, status);
                await refresh(selectedPlanId ?? undefined);
              })
            }
            onGoTo={setView}
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
    { key: 'today', label: '今日', icon: <Home size={18} /> },
    { key: 'study', label: '学习', icon: <CheckCircle2 size={18} /> },
    { key: 'review', label: '复盘', icon: <FileText size={18} /> },
    { key: 'settings', label: '设置', icon: <Settings size={18} /> }
  ];
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">学</div>
        <div>
          <strong>学习管家</strong>
          <span>AI 学习助手</span>
        </div>
      </div>
      <nav className="nav-list" aria-label="主导航">
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
  notice,
  onRefresh
}: {
  title: string;
  subtitle: string;
  notice: string;
  onRefresh: () => void;
}): JSX.Element {
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const weekday = weekdays[now.getDay()];

  return (
    <header className="topbar">
      <div>
        <h1>{title}</h1>
        <p className="topbar-subtitle">
          {subtitle}
          {notice !== '就绪' && <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>({notice})</span>}
          <Sparkles size={14} />
        </p>
      </div>
      <div className="topbar-actions" aria-label="今日工具">
        <button className="icon-button" type="button" aria-label="搜索" onClick={onRefresh}>
          <Search size={20} />
        </button>
        <button className="icon-button notification-button" type="button" aria-label="通知">
          <Bell size={20} />
          <span />
        </button>
        <div className="date-chip">
          <span>{month}月{day}日</span>
          <strong>{weekday}</strong>
        </div>
      </div>
    </header>
  );
}

function StatePanel({ type, title, text }: { type: 'empty' | 'loading' | 'error' | 'ai-unavailable'; title: string; text: string }): JSX.Element {
  const icon = {
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

function TodayView({
  settings,
  onboarding,
  todayGuide,
  activeSession,
  onSendOnboarding,
  onConfirmGoal,
  onGenerateLayeredPlan,
  onConfirmGuide,
  onArchiveTodayAndRestart,
  onStart,
  onPause,
  onEnd,
  onGoTo
}: {
  settings: AppSettings;
  onboarding: GoalIntakeState | null;
  todayGuide: TodayGuideState | null;
  activeSession: StudySession | null;
  runAction: (label: string, action: () => Promise<void>) => Promise<void>;
  onSendOnboarding: (content: string) => Promise<void>;
  onConfirmGoal: (briefPatch?: Partial<GoalBrief>) => Promise<void>;
  onGenerateLayeredPlan: (goalId: string) => Promise<void>;
  onConfirmGuide: (guideId: string) => Promise<void>;
  onArchiveTodayAndRestart: () => Promise<void>;
  onStart: (blockId: string) => Promise<void>;
  onPause: () => Promise<void>;
  onEnd: () => Promise<void>;
  onGoTo: (view: ViewKey) => void;
}): JSX.Element {
  const [message, setMessage] = useState('');
  const [briefDraft, setBriefDraft] = useState<GoalBrief | null>(null);
  const [expandedBlockId, setExpandedBlockId] = useState<string | null>(null);
  const [showRoadmap, setShowRoadmap] = useState(false);
  const [intakePending, setIntakePending] = useState(false);
  const guide = todayGuide?.guide ?? null;
  const goal = todayGuide?.goal ?? onboarding?.activeGoal ?? null;
  const currentBlock = guide ? getCurrentGuideBlock(guide.blocks, activeSession) : null;
  const currentTask = currentBlock ? guide?.tasks.find((task) => task.legacyPlanBlockId === currentBlock.planBlockId) ?? null : null;
  const previewBlock = guide?.blocks.find((block) => block.id === expandedBlockId && block.id !== currentBlock?.id) ?? null;
  const canUseAi = settings.hasDeepseekApiKey;
  const latestAssistantMessageId = [...(onboarding?.messages ?? [])].reverse().find((item) => item.role === 'assistant')?.id ?? null;

  useEffect(() => {
    if (onboarding?.intake.brief) {
      setBriefDraft(onboarding.intake.brief);
    }
  }, [onboarding?.intake.id, onboarding?.intake.brief]);

  async function send(text: string): Promise<void> {
    const content = text.trim();
    if (!content) return;
    setMessage('');
    setIntakePending(true);
    try {
      await onSendOnboarding(content);
    } finally {
      setIntakePending(false);
    }
  }

  if (!guide) {
    return (
      <section className="intake-workspace">
        <div className="intake-main">
          <div className="generation-path" aria-label="输出路径">
            <Sparkles size={18} />
            <span>将生成：</span>
            <strong>长期大纲</strong>
            <ChevronRight size={16} />
            <strong>短期计划</strong>
            <ChevronRight size={16} />
            <strong>今日执行稿</strong>
          </div>

          <section className="surface intake-chat-panel" aria-label="主动访谈">
            <div className="intake-thread redesigned" aria-label="目标访谈记录">
              {(onboarding?.messages ?? []).length === 0 && (
                <div className="intake-message assistant">
                  <span>AI</span>
                  <MessageContent content="你准备学习什么？可以直接说目标、期限、基础和每天可投入时间。" />
                </div>
              )}
              {(onboarding?.messages ?? []).map((item) => (
                <div className={item.role === 'assistant' ? 'intake-message assistant' : 'intake-message user'} key={item.id}>
                  <span>{item.role === 'assistant' ? 'AI' : '你'}</span>
                  <MessageContent content={item.content} animated={item.role === 'assistant' && item.id === latestAssistantMessageId} />
                </div>
              ))}
              {intakePending && (
                <div className="intake-message assistant pending" aria-live="polite">
                  <span>AI</span>
                  <TypingDots />
                </div>
              )}
            </div>

            <div className="intake-input-dock">
              <div className="intake-input-box">
                <FileText size={18} />
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="输入你的回答，或补充更多信息..."
                  aria-label="输入学习目标"
                />
              </div>
              <div className="intake-actions">
                <button className="secondary-action" type="button" disabled={!canUseAi || intakePending} onClick={() => void send('直接开始，先生成计划。')}>
                  <Wand2 size={16} />
                  直接开始
                </button>
                <button className="primary-action" type="button" disabled={!message.trim() || !canUseAi || intakePending} onClick={() => void send(message)}>
                  <SendHorizontal size={16} />
                  {intakePending ? '等待回复' : '发送'}
                </button>
              </div>
            </div>
          </section>
          <p className="micro-hint">
            <Lightbulb size={14} />
            没有思路？点击“直接开始”，由 AI 先发起引导式提问。
          </p>
        </div>

        <aside className="context-panel intake-summary-panel">
          <h3>目标理解摘要</h3>
          <p>基于你的回答，AI 会自动提炼要点，并在确认后生成计划。</p>
          {onboarding?.intake.status === 'ready' && briefDraft ? (
            <GoalBriefEditor
              brief={briefDraft}
              onChange={setBriefDraft}
              onConfirm={() => void onConfirmGoal(briefDraft)}
            />
          ) : (
            <div className="brief-summary-list">
              <div>
                <Target size={24} />
                <strong>目标</strong>
                <span>{briefDraft?.title || goal?.title || '等待你描述核心目标'}</span>
              </div>
              <div>
                <Trophy size={24} />
                <strong>期望结果</strong>
                <span>{briefDraft?.targetOutcome || '例如完成一个可验收产出'}</span>
              </div>
              <div>
                <UserRound size={24} />
                <strong>当前基础</strong>
                <span>{briefDraft?.currentLevel || '当前知识、技能或资源基础'}</span>
              </div>
              <div>
                <CalendarClock size={24} />
                <strong>时间与约束</strong>
                <span>{briefDraft?.availableTime || '可投入时间、ddl、限制条件等'}</span>
              </div>
            </div>
          )}
          {goal && !guide && (
            <button className="primary-action full" type="button" disabled={!canUseAi} onClick={() => void onGenerateLayeredPlan(goal.id)}>
              <Sparkles size={16} />
              确认并生成计划
            </button>
          )}
          {!canUseAi && (
            <button className="secondary-action full" type="button" onClick={() => onGoTo('settings')}>
              <Settings size={16} />
              配置模型
            </button>
          )}
        </aside>
      </section>
    );
  }

  const guideTasks = guide.tasks.length > 0 ? guide.tasks : [];
  const completedCount = guideTasks.length > 0 ? guideTasks.filter((task) => task.status === 'done').length : guide.blocks.filter((block) => block.status === 'done').length;
  const totalCount = guideTasks.length > 0 ? guideTasks.length : guide.blocks.length;
  const totalMinutes = guideTasks.length > 0
    ? guideTasks.reduce((sum, task) => sum + task.estimatedMinutes.target, 0)
    : guide.blocks.reduce((sum, block) => sum + block.durationMinutes, 0);
  const progressPercent = totalCount > 0 ? clampPercent((completedCount / totalCount) * 100) : 0;
  const otherBlocks = guide.blocks.filter((block) => block.id !== currentBlock?.id);
  const activeSessionBelongsToCurrent = Boolean(currentBlock && activeSession?.blockId === currentBlock.planBlockId);
  const isCurrentActive = activeSessionBelongsToCurrent && activeSession?.status === 'active';
  const isCurrentPaused = activeSessionBelongsToCurrent && activeSession?.status === 'paused';
  const elapsedMinutes = activeSession ? Math.max(0, Math.round(getSessionElapsedSeconds(activeSession) / 60)) : 0;
  const primaryActionLabel = guide.status === 'draft'
    ? '确认并开始'
    : isCurrentActive
      ? '进入学习'
      : isCurrentPaused
        ? '继续当前任务'
        : '开始当前任务';
  const handleTodayPrimaryAction = async (): Promise<void> => {
    if (!currentBlock || guide.status === 'archived') return;
    if (guide.status === 'draft') {
      await onConfirmGuide(guide.id);
      onGoTo('study');
      await onStart(currentBlock.planBlockId);
      return;
    }
    if (isCurrentActive) {
      onGoTo('study');
      return;
    }
    onGoTo('study');
    await onStart(currentBlock.planBlockId);
  };

  return (
    <section className="today-v2">
      <div className="today-v2-main">
        <section className="focus-path" aria-label="学习路径">
          <button type="button" onClick={() => setShowRoadmap((value) => !value)}>
            <span>{goal?.title ?? '当前目标'}</span>
            <ChevronRight size={14} />
            <span>{todayGuide?.roadmap[0]?.title ?? '当前阶段'}</span>
            <ChevronRight size={14} />
            <span>{guide.weekFocus || '本周重点'}</span>
            <ChevronRight size={14} />
            <span>今天</span>
            <ChevronRight size={14} />
            <strong>{currentBlock?.title ?? '当前任务'}</strong>
          </button>
        </section>

        {showRoadmap && (
          <section className="surface roadmap-preview">
            <div className="section-heading compact-heading">
              <div>
                <h3>长期大纲</h3>
                <p>只读路径，用于理解方向，不在这里做复杂编辑。</p>
              </div>
            </div>
            <div className="roadmap-list">
              {todayGuide?.roadmap.map((stage) => (
                <article key={stage.id}>
                  <strong>{stage.title}</strong>
                  <p>{stage.direction}</p>
                  <small>{stage.successCriteria}</small>
                </article>
              ))}
            </div>
          </section>
        )}

        <section className="today-goal-strip">
          <div className="goal-strip-icon">
            <Target size={44} />
          </div>
          <div className="goal-strip-block">
            <strong>今日总目标</strong>
            <p>{guide.todayGoal}</p>
          </div>
          <div className="goal-strip-divider" />
          <div className="goal-strip-block">
            <strong>今日完成标准</strong>
            <p>{guide.acceptanceCriteria[0] ?? '清晰、可衡量，完成后可验收。'}</p>
          </div>
          <button className="primary-action goal-strip-action" type="button" disabled={!currentBlock || guide.status === 'archived'} onClick={() => void handleTodayPrimaryAction()}>
            <Play size={16} />
            {primaryActionLabel}
          </button>
        </section>

        {currentBlock && (
          <GuideBlockDetail
            block={currentBlock}
            task={currentTask}
            isCurrent
            guideStatus={guide.status}
            activeSession={activeSession}
            onStart={onStart}
            onPause={onPause}
            onEnd={onEnd}
          />
        )}

          <section className="surface guide-list">
            <div className="section-heading compact-heading">
              <div>
                <h3>今日其他任务</h3>
                <p>{otherBlocks.length > 0 ? `${otherBlocks.length} 项待查看` : '当前没有更多任务'}</p>
              </div>
            </div>
          {otherBlocks.map((block) => {
            const isExpanded = block.id === previewBlock?.id;
            return (
              <article className="guide-row" key={block.id}>
                <button
                  type="button"
                  onClick={() => setExpandedBlockId((current) => (current === block.id ? null : block.id))}
                >
                  <span className="guide-row-time">{block.startTime}</span>
                  <strong>{block.title}</strong>
                  <small>{planStatusLabel(block.status)} · {block.durationMinutes} 分钟</small>
                  <ChevronRight size={14} />
                </button>
                {isExpanded && (
                  <div className="guide-row-preview">
                    <p>{block.action}</p>
                    <span>产出：{block.expectedOutput}</span>
                    <span>完成标准：{block.successCriteria}</span>
                    <span>卡住时：{block.fallback}</span>
                  </div>
                )}
              </article>
            );
          })}
          {otherBlocks.length === 0 && (
            <p className="muted">今天只有当前任务，完成后进入复盘确认下一步。</p>
          )}
        </section>

        <section className="surface guide-boundaries" id="today-boundaries">
          <h3>今天不要做 / 学习边界</h3>
          <div className="boundary-chip-grid">
            {guide.boundaries.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </section>
      </div>

      <aside className="context-panel today-support-panel">
        <section>
          <h3>今日进度</h3>
          <div className="support-progress">
            <div className="support-ring" style={{ '--progress': `${progressPercent}%` } as React.CSSProperties}>
              <strong>{progressPercent}%</strong>
            </div>
            <div className="support-progress-copy">
              <span>已用时间：{elapsedMinutes > 0 ? formatMinutes(elapsedMinutes) : '尚未开始'}</span>
              <span>预计总时长：{formatMinutes(totalMinutes)}</span>
              <span>任务完成：{completedCount} / {totalCount}</span>
            </div>
          </div>
        </section>
        <section>
          <h3>结束验收</h3>
          <div className="check-list">
            {guide.acceptanceCriteria.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
          <button className="secondary-action full" type="button" onClick={() => document.getElementById('current-task-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
            查看验收清单
          </button>
        </section>
        <section>
          <h3>学习边界</h3>
          <div className="check-list">
            {guide.boundaries.slice(0, 4).map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
          <button className="secondary-action full" type="button" onClick={() => document.getElementById('today-boundaries')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
            查看完整边界
          </button>
        </section>
        <div className="compact-divider" />
        <div className="support-note">
          <Lightbulb size={16} />
          <span>完成当前任务后，系统会自动推荐下一步学习内容。</span>
        </div>
        <button
          className="secondary-action full"
          type="button"
          onClick={() => {
            if (window.confirm('归档当前今日执行稿和计划历史，并重新开始一次主动访谈？')) {
              void onArchiveTodayAndRestart();
            }
          }}
        >
          <RotateCcw size={16} />
          归档计划，重新开始
        </button>
      </aside>
    </section>
  );
}

function GoalBriefEditor({
  brief,
  onChange,
  onConfirm
}: {
  brief: GoalBrief;
  onChange: (brief: GoalBrief) => void;
  onConfirm: () => void;
}): JSX.Element {
  return (
    <section className="goal-brief-editor">
      <div>
        <h4>目标理解</h4>
        <p>确认后会生成长期大纲、前三天安排和第一天执行稿。</p>
      </div>
      <label>
        目标标题
        <input value={brief.title} onChange={(event) => onChange({ ...brief, title: event.target.value })} />
      </label>
      <label>
        最终结果
        <textarea value={brief.targetOutcome} onChange={(event) => onChange({ ...brief, targetOutcome: event.target.value })} />
      </label>
      <div className="form-grid compact-form">
        <label>
          当前基础
          <input value={brief.currentLevel} onChange={(event) => onChange({ ...brief, currentLevel: event.target.value })} />
        </label>
        <label>
          可用时间
          <input value={brief.availableTime} onChange={(event) => onChange({ ...brief, availableTime: event.target.value })} />
        </label>
        <label>
          截止时间
          <input value={brief.deadline} onChange={(event) => onChange({ ...brief, deadline: event.target.value })} />
        </label>
      </div>
      <button className="primary-action full" type="button" disabled={!brief.title.trim()} onClick={onConfirm}>
        <CheckCircle2 size={16} />
        确认目标并生成计划
      </button>
    </section>
  );
}

function MessageContent({ content, animated }: { content: string; animated?: boolean }): JSX.Element {
  const renderedText = useTypewriterText(content, Boolean(animated));
  const blocks = useMemo(() => toMessageBlocks(renderedText), [renderedText]);

  return (
    <div className="message-content">
      {blocks.map((block, index) =>
        block.kind === 'list' ? (
          <ul key={`${block.kind}-${index}`}>
            {block.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p key={`${block.kind}-${index}`}>{block.text}</p>
        )
      )}
      {animated && renderedText.length < content.length && <span className="type-cursor" aria-hidden="true" />}
    </div>
  );
}

function TypingDots(): JSX.Element {
  return (
    <div className="typing-dots" aria-label="AI 正在思考">
      <span />
      <span />
      <span />
    </div>
  );
}

function useTypewriterText(text: string, enabled: boolean): string {
  const [visibleText, setVisibleText] = useState(enabled ? '' : text);

  useEffect(() => {
    if (!enabled) {
      setVisibleText(text);
      return;
    }

    setVisibleText('');
    let index = 0;
    const timer = window.setInterval(() => {
      index += 1;
      setVisibleText(text.slice(0, index));
      if (index >= text.length) {
        window.clearInterval(timer);
      }
    }, 16);

    return () => window.clearInterval(timer);
  }, [text, enabled]);

  return visibleText;
}

type MessageBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] };

function toMessageBlocks(content: string): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];

  function flushParagraph(): void {
    const text = paragraph.join(' ').trim();
    if (text) blocks.push({ kind: 'paragraph', text });
    paragraph = [];
  }

  function flushList(): void {
    if (listItems.length > 0) blocks.push({ kind: 'list', items: listItems });
    listItems = [];
  }

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const bullet = line.match(/^([-*•]|\d+[.)、])\s*(.+)$/u);
    if (bullet) {
      flushParagraph();
      listItems.push(bullet[2].trim());
      continue;
    }

    flushList();
    paragraph.push(line.replace(/^#{1,6}\s*/u, ''));
  }

  flushParagraph();
  flushList();
  return blocks.length > 0 ? blocks : [{ kind: 'paragraph', text: content }];
}

function GuideBlockDetail({
  block,
  task,
  guideStatus,
  activeSession,
  onStart,
  onPause,
  onEnd
}: {
  block: DailyGuideBlock;
  task: DailyGuideTask | null;
  isCurrent: boolean;
  guideStatus: 'draft' | 'confirmed' | 'archived';
  activeSession: StudySession | null;
  onStart: (blockId: string) => Promise<void>;
  onPause: () => Promise<void>;
  onEnd: () => Promise<void>;
}): JSX.Element {
  const isActiveBlock = activeSession?.blockId === block.planBlockId;
  const isActive = isActiveBlock && activeSession?.status === 'active';
  const isPaused = isActiveBlock && activeSession?.status === 'paused';
  const canStart = guideStatus === 'confirmed' && !isActive;
  return (
    <section className="surface current-guide-block redesigned" id="current-task-detail">
      <div className="current-task-heading">
        <div>
          <FileText size={28} />
          <h3>{block.title}</h3>
        </div>
        <small>
          {task
            ? `${task.estimatedMinutes.min}-${task.estimatedMinutes.target}-${task.estimatedMinutes.max} 分钟 · ${planStatusLabel(task.status)}`
            : `${block.startTime} - ${block.endTime} · ${block.durationMinutes} 分钟 · ${planStatusLabel(block.status)}`}
        </small>
      </div>

      <div className="task-detail-table">
        <div className="task-detail-row">
          <Target size={24} />
          <strong>目标</strong>
          <span>{block.objective}</span>
        </div>
        {task && (
          <div className="task-detail-row">
            <Clock3 size={24} />
            <strong>范围</strong>
            <span>{task.scope}</span>
          </div>
        )}
        <div className="task-detail-row">
          <ListChecks size={24} />
          <strong>执行动作</strong>
          <span>{task ? task.actions.map((action) => `${action.position + 1}. ${action.title}：${action.instruction}`).join('\n') : block.action}</span>
        </div>
        <div className="task-detail-row">
          <Folder size={24} />
          <strong>最终提交</strong>
          <span>{task ? `${task.deliverable}（${task.submissionPolicy}）` : block.expectedOutput}</span>
        </div>
        <div className="task-detail-row">
          <ShieldCheck size={24} />
          <strong>完成标准</strong>
          <span>{task ? task.doneWhen.join('；') : block.successCriteria}</span>
        </div>
        <details className="task-fallback-row">
          <summary>
            <HelpCircle size={24} />
            <strong>卡住时怎么办（折叠）</strong>
            <ChevronRight size={18} />
          </summary>
          <p>{task?.quickHint ?? block.fallback}</p>
        </details>
      </div>

      <div className="task-operation-bar">
        <strong>任务操作</strong>
        <div>
          {isActive ? (
            <>
              <button className="secondary-action" type="button" onClick={() => void onPause()}>
                <Pause size={16} />
                暂停
              </button>
              <button className="secondary-action" type="button" onClick={() => void onEnd()}>
                <Square size={16} />
                结束本次
              </button>
            </>
          ) : (
            <button className="primary-action" type="button" disabled={!canStart} onClick={() => void onStart(block.planBlockId)}>
              <Play size={16} />
              {isPaused ? '继续任务' : '开始任务'}
            </button>
          )}
        </div>
      </div>
      {guideStatus === 'draft' && <p className="muted">先确认今日执行稿后再开始学习。</p>}
    </section>
  );
}

function getCurrentGuideBlock(blocks: DailyGuideBlock[], activeSession: StudySession | null): DailyGuideBlock | null {
  if (activeSession?.blockId) {
    const sessionBlock = blocks.find((block) => block.planBlockId === activeSession.blockId);
    if (sessionBlock) return sessionBlock;
  }
  return blocks.find((block) => block.status === 'active') ?? blocks.find((block) => block.status === 'planned') ?? blocks[0] ?? null;
}

function LegacyTodayView({
  settings,
  tasks,
  plans,
  activePlan,
  activeSession,
  onStart,
  onGoTo
}: {
  settings: AppSettings;
  tasks: TaskItem[];
  plans: DailyPlan[];
  activePlan: DailyPlan | null;
  activeSession: StudySession | null;
  onStart: (blockId: string) => Promise<void>;
  onGoTo: (view: ViewKey) => void;
}): JSX.Element {
  const [aiExpanded, setAiExpanded] = useState(false);
  const isEmpty = !activePlan || activePlan.blocks.length === 0;
  const aiUnavailable = !settings.hasDeepseekApiKey;
  const blocks = activePlan?.blocks ?? [];
  const current = blocks.find((b) => b.status === 'planned' || b.status === 'active') ?? blocks[0] ?? null;
  const completedCount = blocks.filter((b) => b.status === 'done').length;
  const totalCount = blocks.length;
  const percent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const totalMinutes = blocks.reduce((sum, b) => sum + b.durationMinutes, 0);

  return (
    <section className={aiExpanded ? 'today-layout ai-expanded-layout' : 'today-layout'}>
      <div className="today-main">
        <section className="today-focus-panel" aria-label="当前重点任务">
          {isEmpty && (
            <div className="today-empty-state">
              <BookOpen size={24} />
              <div>
                <h2>今天还没有确认计划</h2>
                <p>确认今日计划后，这里会显示当前最应该开始的学习块。</p>
              </div>
            </div>
          )}

          {!isEmpty && current && (
            <>
              <div className="today-focus-copy">
                <span className="focus-label">当前重点</span>
                <h2>{current.objective}</h2>
                <p>{current.action}</p>
                <div className="focus-meta">
                  <span>
                    <Clock3 size={16} />
                    预计 {current.durationMinutes} 分钟
                  </span>
                  <span>
                    <BookOpen size={16} />
                    {planStatusLabel(current.status)}
                  </span>
                </div>
                <div className="today-actions">
                  <button
                    className="primary-action"
                    disabled={isEmpty}
                    onClick={() => void onStart(current.id)}
                  >
                    <Play size={18} />
                    开始学习
                  </button>
                  <button className="secondary-action quiet" type="button" onClick={() => onGoTo('today')}>
                    回到今日
                  </button>
                </div>
              </div>
              <div className="today-progress-ring" aria-label={`今日进度 ${percent}%`}>
                <div className="progress-ring">
                  <div>
                    <strong>{percent}%</strong>
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
              <p>{isEmpty ? '暂无任务' : `${totalCount} 项任务 · 预计 ${totalMinutes} 分钟`}</p>
            </div>
            {!isEmpty && (
              <button className="text-action" type="button" onClick={() => onGoTo('today')}>
                查看执行稿
              </button>
            )}
          </div>
          {isEmpty ? (
            <div className="timeline-empty">
              <ListChecks size={18} />
              <span>确认今日计划后会显示学习顺序和预计时间。</span>
            </div>
          ) : (
            <div className="timeline-list">
              {blocks.map((block, index) => {
                const isCurrent = block.status === 'planned' || block.status === 'active';
                const isDone = block.status === 'done';
                const tags = isDone
                  ? ['已完成']
                  : isCurrent
                    ? [difficultyLabel(block.difficulty), '进行中']
                    : [difficultyLabel(block.difficulty), '待开始'];
                const blockPercent = isDone ? '100%' : isCurrent ? `${percent}%` : '0%';
                return (
                  <article className={isCurrent && !isDone ? 'timeline-row current' : 'timeline-row'} key={block.id}>
                    <div className="timeline-time">
                      <strong>{block.startTime}</strong>
                      <span>{block.durationMinutes} 分钟</span>
                    </div>
                    <div className="timeline-axis" aria-hidden="true">
                      <span className="timeline-dot" />
                      {index < blocks.length - 1 && <span className="timeline-line" />}
                    </div>
                    <div className="timeline-content">
                      <strong>{block.objective}</strong>
                      <p>{block.action}</p>
                      <div className="timeline-tags">
                        {tags.map((tag) => (
                          <span className={tag === '进行中' ? 'active' : ''} key={tag}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className={isCurrent && !isDone ? 'timeline-progress active' : 'timeline-progress'}>
                      {blockPercent}
                    </div>
                    <ChevronRight size={16} className="timeline-chevron" />
                  </article>
                );
              })}
              <button className="timeline-footer" type="button" onClick={() => onGoTo('today')}>
                回到今日执行稿（{totalCount}）
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </section>
      </div>

      <TodayAiPanel expanded={aiExpanded} unavailable={aiUnavailable} onClose={() => setAiExpanded(false)} onExpand={() => setAiExpanded(true)} />
    </section>
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
          <StatePanel type="ai-unavailable" title="AI 暂不可用" text="请先在设置中配置 DeepSeek API Key；本地学习计划仍可执行。" />
        ) : (
          <>
            <div className="ai-teacher-tabs" role="tablist" aria-label="AI 教师模式">
              <button className="active" type="button">讲解</button>
              <button type="button">检查</button>
              <button type="button">规划</button>
            </div>

            <div className="ai-current-content">
              <span>当前内容</span>
              <button type="button">
                AI 功能开发中
                <ChevronRight size={14} />
              </button>
            </div>

            <div className="ai-teacher-thread">
              <span className="teacher-avatar">
                <Sparkles size={14} />
              </span>
              <div className="teacher-bubble">
                AI 教师功能正在开发中，后续将支持讲解、检查和规划模式。
              </div>
            </div>

            <div className="ai-disclaimer">
              <span>内容由 AI 生成，仅供参考</span>
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
        <StatePanel type="ai-unavailable" title="AI 暂不可用" text="请先在设置中配置 DeepSeek API Key；本地学习计划仍可执行。" />
      ) : (
        <>
          <div className="ai-advice-cards">
            <article className="ai-advice-card">
              <div>
                <strong>AI 功能开发中</strong>
                <p>后续将提供专注建议、知识巩固和学习节奏分析。</p>
              </div>
              <span className="advice-icon">
                <Lightbulb size={22} />
              </span>
            </article>
            <article className="ai-advice-card">
              <div>
                <strong>知识巩固</strong>
                <p>AI 学习建议功能即将上线。</p>
              </div>
              <span className="advice-icon">
                <BookOpen size={22} />
              </span>
            </article>
            <article className="ai-advice-card">
              <div>
                <strong>学习节奏</strong>
                <p>AI 学习节奏分析功能即将上线。</p>
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

function StudyView({
  activePlan,
  activeSession,
  learningState,
  teaching,
  questionAnswer,
  submissionResult,
  notes,
  onNotesChange,
  onElapsedChange,
  onPauseSession,
  onResumeSession,
  onCompleteSession,
  onStart,
  onTeachStep,
  onAskQuestion,
  onResolveQuestion,
  onSubmitResult,
  onGoTo
}: {
  activePlan: DailyPlan | null;
  activeSession: StudySession | null;
  learningState: LearningRuntimeSnapshot | null;
  teaching: TeachStepResult | null;
  questionAnswer: QuestionAnswerResult | null;
  submissionResult: SubmissionEvaluationResult | null;
  notes: string;
  onNotesChange: (notes: string) => void;
  onElapsedChange: (seconds: number) => void;
  onPauseSession: () => Promise<void>;
  onResumeSession: () => Promise<void>;
  onCompleteSession: (notes: string) => Promise<void>;
  onStart: (blockId: string) => Promise<void>;
  onTeachStep: () => Promise<void>;
  onAskQuestion: (question: string) => Promise<void>;
  onResolveQuestion: (threadId: string) => Promise<void>;
  onSubmitResult: (content: string) => Promise<void>;
  onGoTo: (view: ViewKey) => void;
}): JSX.Element {
  const blocks = activePlan?.blocks ?? [];
  const currentBlock = activeSession
    ? blocks.find((b) => b.id === activeSession.blockId)
    : null;
  const fallbackBlock = blocks.find((b) => b.status === 'planned' || b.status === 'active') ?? blocks[0] ?? null;
  const displayBlock = currentBlock ?? fallbackBlock;
  const isActive = activeSession?.status === 'active';
  const isPaused = activeSession?.status === 'paused';
  const completedCount = blocks.filter((b) => b.status === 'done').length;
  const currentStep = learningState?.step ?? null;
  const activeIndex = Math.max(0, blocks.findIndex((block) => block.id === displayBlock?.id));
  const stepPosition = blocks.length > 0 ? activeIndex + 1 : 0;
  const taskTitle = displayBlock?.objective ?? '当前任务';
  const stepTitle = currentStep?.title ?? displayBlock?.objective ?? '当前步骤';
  const stepObjective = currentStep?.objective ?? displayBlock?.objective ?? '开始后会生成目标。';
  const stepInstruction = currentStep?.instruction ?? displayBlock?.action ?? '点击开始学习后继续。';
  const stepOutput = currentStep?.expectedOutput ?? displayBlock?.expectedOutput ?? '完成当前任务的可验收产出。';
  const stepCriteria = currentStep?.successCriteria ?? displayBlock?.successCheck ?? '达到今日执行稿中的完成标准。';

  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Timer: elapsed = durationMinutes (accumulated) + live active time
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);

    if (isActive && activeSession?.startedAt) {
      const computeElapsed = (): number => getSessionElapsedSeconds(activeSession);
      const initial = computeElapsed();
      setElapsedSeconds(initial);
      onElapsedChange(initial);
      timerRef.current = setInterval(() => {
        const s = computeElapsed();
        setElapsedSeconds(s);
        onElapsedChange(s);
      }, 1000);
      return () => { if (timerRef.current) clearInterval(timerRef.current); };
    }
    if (isPaused && activeSession?.durationMinutes != null) {
      const total = getSessionElapsedSeconds(activeSession);
      setElapsedSeconds(total);
      onElapsedChange(total);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isActive, isPaused, activeSession?.startedAt, activeSession?.durationMinutes]);

  if (!activePlan || !displayBlock) {
    return (
      <section className="study-layout">
        <div className="study-main">
          <StatePanel type="empty" title="今日还没有执行稿" text="回到今日页，通过主动访谈生成第一天执行稿。" />
          <button className="primary-action" onClick={() => onGoTo('today')}>
            <ClipboardList size={16} />
            回到今日
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="study-layout">
      <div className="study-main">
        <section className="study-session-bar" aria-label="学习会话状态">
          <Target size={24} />
          <strong>{taskTitle}</strong>
          <span>步骤 {stepPosition}/{blocks.length || 1}</span>
          <span>
            <Clock3 size={18} />
            {(isActive || isPaused) ? formatElapsedTime(elapsedSeconds) : '00:00'}
          </span>
          <div>
            {(isActive || isPaused) ? (
              isPaused ? (
                <button className="secondary-action" type="button" onClick={() => void onResumeSession()}>
                  <Play size={16} />
                  继续
                </button>
              ) : (
                <button className="secondary-action" type="button" onClick={() => void onPauseSession()}>
                  <Pause size={16} />
                  暂停
                </button>
              )
            ) : (
              <button className="primary-action" type="button" onClick={() => void onStart(displayBlock.id)}>
                <Play size={16} />
                开始
              </button>
            )}
            {(isActive || isPaused) && (
              <button className="secondary-action danger-outline" type="button" onClick={() => void onCompleteSession(notes)}>
                <Square size={16} />
                结束
              </button>
            )}
          </div>
        </section>

        <section className="study-current-step-panel" aria-label="当前学习步骤">
          <div className="current-step-heading">
            <ClipboardCheck size={30} />
            <div>
              <h2>{stepTitle}</h2>
              <p>{currentStep ? '当前步骤已建立，可提问、提交结果并接受评估。' : '当前先按今日执行稿推进，开始后会建立可恢复步骤。'}</p>
            </div>
          </div>
          <div className="learning-detail-list">
            <div>
              <Target size={24} />
              <strong>目标</strong>
              <span>{stepObjective}</span>
            </div>
            <div>
              <ListChecks size={24} />
              <strong>具体操作</strong>
              <span>{stepInstruction}</span>
            </div>
            <div>
              <Folder size={24} />
              <strong>预期产出</strong>
              <span>{stepOutput}</span>
            </div>
            <div>
              <ShieldCheck size={24} />
              <strong>完成标准</strong>
              <span>{stepCriteria}</span>
            </div>
            <details>
              <summary>
                <HelpCircle size={24} />
                <strong>卡住时怎么办（折叠）</strong>
                <ChevronRight size={18} />
              </summary>
              <p>{displayBlock.fallback}</p>
            </details>
          </div>
          {teaching && (
            <div className="assistant-message assistant-message-system">
              <strong>AI 展开：</strong>
              <p>{teaching.explanation}</p>
              <p>{teaching.userAction}</p>
            </div>
          )}
        </section>

        <StudyProgressSteps blocks={blocks} activeBlockId={displayBlock.id} />

        <section className="study-tip-panel">
          <Lightbulb size={22} />
          <div>
            <strong>学习小贴士</strong>
            <p>主内容区只聚焦当前步骤，减少分心；AI 侧栏承载提问与提交，随时获得支持与反馈。</p>
          </div>
        </section>
      </div>

      <StudyAiPanel
        unavailable={!activeSession}
        learningState={learningState}
        questionAnswer={questionAnswer}
        submissionResult={submissionResult}
        onTeachStep={onTeachStep}
        onAskQuestion={onAskQuestion}
        onResolveQuestion={onResolveQuestion}
        onSubmitResult={onSubmitResult}
      />
    </section>
  );
}

function StudyProgressSteps({ blocks, activeBlockId }: { blocks: DailyPlanBlock[]; activeBlockId: string }): JSX.Element {
  return (
    <div className="study-progress-steps" aria-label="今日学习进度">
      <div className="section-heading compact-heading">
        <div>
          <h3>今日步骤进度</h3>
          <p>当前步骤展开，其他步骤只保留标题和状态。</p>
        </div>
      </div>
      {blocks.map((block, index) => {
        const isDone = block.status === 'done';
        const isActive = block.id === activeBlockId;
        const className = isDone ? 'study-step done' : isActive ? 'study-step active' : 'study-step';
        return (
          <div className={className} key={block.id}>
            <span>
              {isDone ? <CheckCircle2 size={16} /> : isActive ? <Play size={14} /> : <Circle size={16} />}
            </span>
            <strong>步骤 {index + 1}：{block.objective}</strong>
            <small>{isDone ? '已完成' : isActive ? '进行中' : '待进行'}</small>
          </div>
        );
      })}
    </div>
  );
}

function StudyAiPanel({
  unavailable,
  learningState,
  questionAnswer,
  submissionResult,
  onTeachStep,
  onAskQuestion,
  onResolveQuestion,
  onSubmitResult
}: {
  unavailable: boolean;
  learningState: LearningRuntimeSnapshot | null;
  questionAnswer: QuestionAnswerResult | null;
  submissionResult: SubmissionEvaluationResult | null;
  onTeachStep: () => Promise<void>;
  onAskQuestion: (question: string) => Promise<void>;
  onResolveQuestion: (threadId: string) => Promise<void>;
  onSubmitResult: (content: string) => Promise<void>;
}): JSX.Element {
  const [question, setQuestion] = useState('');
  const [submission, setSubmission] = useState('');
  const [activeTab, setActiveTab] = useState<'question' | 'submission'>('question');
  const activeThread = learningState?.questionThread ?? null;
  const latestEvaluation = submissionResult?.evaluation ?? learningState?.latestEvaluation ?? null;
  const latestDecision = submissionResult?.decision ?? learningState?.latestDecision ?? null;

  return (
    <aside className="study-ai-panel" aria-label="AI 学习助手">
      <div className="today-ai-heading">
        <Sparkles size={20} />
        <h3>AI 学习助手</h3>
      </div>
      {unavailable ? (
        <StatePanel type="ai-unavailable" title="AI 学习助手不可用" text="开始学习后可使用笔记功能；AI 助手需要先配置 API Key。" />
      ) : (
        <>
          <div className="assistant-tabs" role="tablist" aria-label="AI 助手内容">
            <button className={activeTab === 'question' ? 'active' : ''} type="button" onClick={() => setActiveTab('question')}>
              提问
            </button>
            <button className={activeTab === 'submission' ? 'active' : ''} type="button" onClick={() => setActiveTab('submission')}>
              提交结果
            </button>
          </div>

          <div className="assistant-context-card">
            <strong>当前上下文</strong>
            <p>{learningState?.step ? learningState.step.title : '正在完成当前学习任务。'}</p>
          </div>

          {activeTab === 'question' && (
            <>
              <label className="assistant-field">
                提问输入区
                <textarea
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="在此描述你的问题或卡点..."
                  aria-label="针对当前步骤提问"
                />
                <small>{question.length}/1000</small>
              </label>
              <button
                className="secondary-action full"
                type="button"
                onClick={() => void onTeachStep()}
                disabled={!learningState?.step}
              >
                <Sparkles size={16} />
                展开当前步骤
              </button>
              <button
                className="primary-action full"
                type="button"
                disabled={!question.trim()}
                onClick={() => {
                  const value = question.trim();
                  if (!value) return;
                  setQuestion('');
                  void onAskQuestion(value);
                }}
              >
                <SendHorizontal size={16} />
                发送
              </button>
              {questionAnswer && (
                <div className="assistant-message">
                  <strong>回答</strong>
                  <p>{questionAnswer.answer}</p>
                  <small>{questionAnswer.returnToStepInstruction}</small>
                </div>
              )}
              {activeThread?.status === 'open' && (
                <button className="secondary-action full" type="button" onClick={() => void onResolveQuestion(activeThread.id)}>
                  问题已解决，回到主线
                </button>
              )}
            </>
          )}

          {activeTab === 'submission' && (
            <div className="submission-panel">
              <label className="assistant-field">
                学习结果提交区
                <textarea
                  value={submission}
                  onChange={(event) => setSubmission(event.target.value)}
                  placeholder="提交本步骤的学习结果、答案或产出"
                  aria-label="提交学习结果"
                />
              </label>
              <div className="upload-dropzone">
                <Upload size={26} />
                <span>拖拽文件或截图到此</span>
                <small>支持图片 / 文档 / 链接等说明文本</small>
              </div>
              <button
                className="primary-action full"
                type="button"
                disabled={!learningState?.step || !submission.trim()}
                onClick={() => {
                  const value = submission.trim();
                  if (!value) return;
                  setSubmission('');
                  void onSubmitResult(value);
                }}
              >
                <CheckCircle2 size={16} />
                提交并评估
              </button>
            </div>
          )}

          {latestEvaluation && (
            <div className="assistant-message assistant-message-system">
              <strong>评估：{latestEvaluation.result} · 掌握度 {latestEvaluation.mastery}</strong>
              <p>{latestEvaluation.feedback}</p>
            </div>
          )}

          {latestDecision && (
            <div className="assistant-message">
              <strong>下一步：{latestDecision.decision}</strong>
              <p>{latestDecision.reason}</p>
            </div>
          )}
        </>
      )}
    </aside>
  );
}

function SettlementView({
  activeSession,
  notes,
  onNotesChange,
  onBack,
  onSave,
  onGoTo
}: {
  activeSession: StudySession | null;
  notes: string;
  onNotesChange: (notes: string) => void;
  onBack: () => void;
  onSave: () => void;
  onGoTo: (view: ViewKey) => void;
}): JSX.Element {
  const [result, setResult] = useState<'completed' | 'partial' | 'skipped'>('completed');
  const isEmpty = !activeSession;

  const totalMinutes = activeSession?.durationMinutes ?? 0;
  const duration = totalMinutes > 0 ? `${totalMinutes} 分钟` : '未知';

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

          {isEmpty && <StatePanel type="empty" title="没有可结算的学习会话" text="请先开始一个学习块。" />}

          {!isEmpty && (
            <>
              <div className="settlement-options">
                <label className={result === 'completed' ? 'choice active' : 'choice'}>
                  <input type="radio" name="result" checked={result === 'completed'} onChange={() => setResult('completed')} />
                  <span>
                    <strong>完成本块</strong>
                    <small>达成本块验收标准，但不默认完成整个任务。</small>
                  </span>
                </label>
                <label className={result === 'partial' ? 'choice active' : 'choice'}>
                  <input type="radio" name="result" checked={result === 'partial'} onChange={() => setResult('partial')} />
                  <span>
                    <strong>部分完成</strong>
                    <small>保留剩余动作，后续继续规划。</small>
                  </span>
                </label>
                <label className={result === 'skipped' ? 'choice active' : 'choice'}>
                  <input type="radio" name="result" checked={result === 'skipped'} onChange={() => setResult('skipped')} />
                  <span>
                    <strong>跳过</strong>
                    <small>需要记录原因，供复盘使用。</small>
                  </span>
                </label>
              </div>

              <div className="study-card">
                <div className="detail">
                  <span>本次时长</span>
                  <strong>{duration}</strong>
                </div>
                <div className="detail">
                  <span>实际输出</span>
                  <strong>{notes || '尚未填写输出'}</strong>
                </div>
                <div className="detail">
                  <span>任务状态</span>
                  <strong>仅完成学习块；任务是否完成需要单独确认。</strong>
                </div>
              </div>

              <div className="session-controls">
                <button className="secondary-action" onClick={onBack}>
                  返回修改
                </button>
                <button className="primary-action" onClick={onSave}>
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
        <p>学习块完成不等于任务自动完成。用户确认后，复盘页才读取这次数据。</p>
        <div className="advice-list">
          <span>完成：更新块进度。</span>
          <span>部分完成：保留后续动作。</span>
          <span>跳过：必须记录原因。</span>
        </div>
      </aside>
    </section>
  );
}

interface LocalSettlement {
  session: StudySession;
  elapsedSeconds: number;
  notes: string;
}

function ReviewView({
  review,
  latestSettlement,
  pendingAdjustment,
  autoGenerate,
  onAutoGenerated,
  onGenerate,
  hasApiKey,
  onDecideAdjustment,
  onGoTo
}: {
  review: ReviewResult | null;
  latestSettlement: LocalSettlement | null;
  pendingAdjustment: PlanAdjustmentProposal | null;
  autoGenerate: boolean;
  onAutoGenerated: () => void;
  onGenerate: () => Promise<void>;
  hasApiKey: boolean;
  onDecideAdjustment: (proposalId: string, status: 'accepted' | 'rejected') => Promise<void>;
  onGoTo: (view: ViewKey) => void;
}): JSX.Element {
  const [generating, setGenerating] = useState(false);
  const autoTriggeredRef = useRef(false);

  // Reset auto-trigger guard when autoGenerate flag changes
  useEffect(() => {
    if (!autoGenerate) {
      autoTriggeredRef.current = false;
    }
  }, [autoGenerate]);

  // Auto-generate review when navigating from settlement
  useEffect(() => {
    if (autoGenerate && !review && hasApiKey && !autoTriggeredRef.current) {
      autoTriggeredRef.current = true;
      onAutoGenerated();
      setGenerating(true);
      void onGenerate().finally(() => setGenerating(false));
    }
  }, [autoGenerate, review, hasApiKey]);

  const allActions = review?.nextActions ?? [];
  const totalCount = allActions.length;
  const settlementMinutes = latestSettlement
    ? Math.max(1, Math.round(latestSettlement.elapsedSeconds / 60))
    : 0;
  const completionScore = review?.completionScore ?? (latestSettlement ? 65 : 0);
  const focusScore = review?.focusScore ?? (latestSettlement ? 75 : 0);
  const stageProgress = review ? 25 : latestSettlement ? 20 : 0;

  return (
    <section className="review-layout">
      <div className="review-main">
        <section className="review-summary-strip">
          <div>
            <CheckCircle2 size={54} />
            <strong>完成情况</strong>
            <span>{completionScore >= 80 ? '很好' : completionScore > 0 ? '良好' : '待复盘'}</span>
            <small>完成率 {completionScore}%</small>
          </div>
          <div>
            <Clock3 size={54} />
            <strong>总时长</strong>
            <span>{settlementMinutes > 0 ? formatMinutes(settlementMinutes) : review ? '已统计' : '暂无'}</span>
            <small>专注时长</small>
          </div>
          <div>
            <TrendingUp size={54} />
            <strong>任务进度</strong>
            <span>本阶段 {stageProgress}%</span>
            <small>本周任务 {review ? '2 / 8' : '待生成'}</small>
          </div>
        </section>

        <section className="surface review-flow-card">
          <h3><span>1</span> 今日结果概览</h3>
          {!review && !hasApiKey && !latestSettlement && (
            <StatePanel type="ai-unavailable" title="AI 不可用" text="请先在设置中配置 DeepSeek API Key。" />
          )}
          {!review && hasApiKey && !generating && !latestSettlement && (
            <StatePanel type="empty" title="还没有复盘" text="完成或跳过学习块后再生成复盘。" />
          )}
          {!review && hasApiKey && generating && (
            <StatePanel type="loading" title="正在生成复盘" text="AI 正在分析今日学习数据..." />
          )}
          <div className="result-overview-list">
            <div>
              <CircleCheck size={18} />
              <strong>已完成</strong>
              <span>{review ? review.summary : latestSettlement?.notes || '完成的任务与重点概览。'}</span>
              <ChevronRight size={18} />
            </div>
            <div>
              <AlertTriangle size={18} />
              <strong>部分完成</strong>
              <span>{latestSettlement ? '部分完成的任务与原因概览。' : '等待本次结算数据。'}</span>
              <ChevronRight size={18} />
            </div>
            <div>
              <XCircle size={18} />
              <strong>未完成</strong>
              <span>未完成任务与影响概览。</span>
              <ChevronRight size={18} />
            </div>
          </div>
          {!review && latestSettlement && hasApiKey && (
            <button className="primary-action" type="button" onClick={() => void onGenerate()}>
              <Sparkles size={16} />
              生成 AI 复盘
            </button>
          )}
        </section>

        <section className="surface review-flow-card">
          <h3><span>2</span> AI 评估与反馈</h3>
          <div className="review-evaluation-grid">
            <div>
              <ListChecks size={28} />
              <strong>结果判断</strong>
              <p>{review ? review.summary : '对今日学习结果的综合判断与简述。'}</p>
            </div>
            <div>
              <FileText size={28} />
              <strong>证据摘要</strong>
              <p>{latestSettlement?.notes || '基于行为数据与任务表现的关键证据。'}</p>
            </div>
            <div>
              <AlertTriangle size={28} />
              <strong>主要问题</strong>
              <p>{focusScore < 70 ? '专注稳定性仍需提升。' : '影响目标达成的核心问题点。'}</p>
            </div>
            <div>
              <TrendingUp size={28} />
              <strong>建议方向</strong>
              <p>{allActions[0] || pendingAdjustment?.reason || '从方法、节奏、专注等维度给出优化方向。'}</p>
            </div>
          </div>
        </section>

        <section className="surface review-flow-card">
          <h3><span>3</span> 调整 proposal</h3>
          <p className="muted">根据评估结果选择下一步动作。AI 建议只有经你确认后才会生效。</p>
          <div className="adjustment-choice-grid">
            {['建议继续', '补做', '重做', '进入下一项'].map((label, index) => (
              <button className={index === 0 ? 'adjustment-choice active' : 'adjustment-choice'} type="button" key={label}>
                {index === 0 ? <CircleDot size={18} /> : <Circle size={18} />}
                <strong>{label}</strong>
                <span>{allActions[index] || ['保持当前计划与节奏。', '补做未完成的任务。', '调整方式后重新完成。', '前置达标，进入下一项。'][index]}</span>
              </button>
            ))}
          </div>
          <div className="review-decision-actions">
            <button
              className="primary-action"
              type="button"
              disabled={!pendingAdjustment || pendingAdjustment.status !== 'pending'}
              onClick={() => pendingAdjustment && void onDecideAdjustment(pendingAdjustment.id, 'accepted')}
            >
              <CheckCircle2 size={16} />
              采纳建议
            </button>
            <button
              className="secondary-action"
              type="button"
              disabled={!pendingAdjustment || pendingAdjustment.status !== 'pending'}
              onClick={() => pendingAdjustment && void onDecideAdjustment(pendingAdjustment.id, 'rejected')}
            >
              <ClipboardCheck size={16} />
              保持原计划
            </button>
          </div>
          {totalCount > 0 && <p className="muted">本次共有 {totalCount} 条 AI 后续建议，仍需你确认后才会影响计划。</p>}
        </section>

        <section className="surface review-flow-card">
          <h3><span>4</span> 明日启动预告</h3>
          <div className="tomorrow-preview-row">
            <span><Clock3 size={18} />建议 09:00</span>
            <span><ClipboardList size={18} />重点任务预告</span>
            <span><Timer size={18} />约 1小时10分</span>
            <span><Bell size={18} />关键提醒</span>
          </div>
        </section>

        <div className="session-controls">
          <button className="secondary-action" onClick={() => onGoTo('today')}>
            <ClipboardList size={16} />
            回到今日执行稿
          </button>
          <button className="primary-action" onClick={() => onGoTo('today')}>
            回到今日
          </button>
        </div>
      </div>

      <aside className="review-side">
        <section className="context-panel review-note-panel">
          <h3>复盘笔记 <PencilLine size={16} /></h3>
          <textarea placeholder="记录对今日学习的感受、收获与需要改进的事项..." maxLength={300} />
          <div>
            <span>0 / 300</span>
            <button className="secondary-action" type="button">保存笔记</button>
          </div>
        </section>
        <section className="context-panel">
          <h3>常见原因归类</h3>
          <div className="reason-list">
            {['计划过高，超出当前能力', '时间分配不当', '启动延迟 / 注意力分散', '资源使用不足', '其他原因'].map((item) => (
              <span key={item}>{item}<strong>X 次</strong></span>
            ))}
          </div>
        </section>
        <section className="context-panel stage-path-panel">
          <h3>本周阶段路径</h3>
          <p>阶段：基础巩固期（第 2 周 / 共 4 周）</p>
          <div className="stage-dots">
            <span />
            <span className="active" />
            <span />
            <span />
          </div>
          <strong>本周目标：夯基础，稳节奏，提升正确率</strong>
        </section>
        <div className="support-note">
          <Lightbulb size={16} />
          <span>复盘是为了更好地推进。你的每一次调整，都会让学习更有效。</span>
        </div>
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
  const [autoLaunch, setAutoLaunch] = useState(settings.autoLaunch);
  const [windows, setWindows] = useState<StudyWindow[]>(settings.dailyStudyWindows);
  const [selectedPromptId, setSelectedPromptId] = useState(prompts[0]?.id ?? '');
  const selectedPrompt = prompts.find((prompt) => prompt.id === selectedPromptId) ?? prompts[0];
  const [promptContent, setPromptContent] = useState(selectedPrompt?.content ?? '');

  useEffect(() => {
    setPromptContent(selectedPrompt?.content ?? '');
  }, [selectedPrompt?.id]);

  function addWindow(): void {
    setWindows((prev) => [...prev, { start: '20:00', end: '22:00' }]);
  }

  function removeWindow(index: number): void {
    setWindows((prev) => prev.filter((_, i) => i !== index));
  }

  function updateWindow(index: number, field: 'start' | 'end', value: string): void {
    setWindows((prev) => prev.map((w, i) => (i === index ? { ...w, [field]: value } : w)));
  }

  return (
    <section className="page-grid">
      <div className="main-column">
        <section className="surface">
          <div className="section-heading">
            <div>
              <h3>设置</h3>
              <p>配置模型、学习节奏和提示词档位。</p>
            </div>
            <button
              className="primary-action"
              onClick={() =>
                void runAction('保存设置', async () => {
                  await window.studyApp.settings.update({
                    deepseekBaseUrl: baseUrl,
                    deepseekModel: model,
                    deepseekApiKey: apiKey,
                    defaultBlockMinutes: blockMinutes,
                    autoLaunch,
                    dailyStudyWindows: windows
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
          <div className="compact-divider" />
          <div className="settings-section">
            <h3>每日学习时间窗</h3>
            <p className="muted">设置每天可用于学习的时间段，生成计划时会参考这些时间窗。</p>
            <div className="window-list">
              {windows.length === 0 && (
                <p className="muted">暂未配置时间窗，点击下方按钮添加。</p>
              )}
              {windows.map((w, index) => (
                <div className="window-row" key={index}>
                  <input
                    type="time"
                    value={w.start}
                    onChange={(event) => updateWindow(index, 'start', event.target.value)}
                  />
                  <span className="window-separator">—</span>
                  <input
                    type="time"
                    value={w.end}
                    onChange={(event) => updateWindow(index, 'end', event.target.value)}
                  />
                  <button
                    className="icon-button danger"
                    title="删除"
                    onClick={() => removeWindow(index)}
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
            <button className="secondary-action" onClick={addWindow}>
              + 添加时间窗
            </button>
          </div>
          <div className="compact-divider" />
          <div className="settings-section">
            <h3>桌面行为</h3>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={autoLaunch}
                onChange={(event) => setAutoLaunch(event.target.checked)}
              />
              <span>开机自启</span>
            </label>
          </div>
          <div className="compact-divider" />
          <div className="settings-section">
            <h3>隐私与监控</h3>
            <p className="muted">当前只记录前台应用名、窗口标题和切换事件。不会截屏、录屏或记录键盘。</p>
          </div>
        </section>
      </div>
      <aside className="context-panel prompt-editor">
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
          className="secondary-action full"
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
