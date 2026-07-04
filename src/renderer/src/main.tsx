import './bridge/init';
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
  XCircle,
  ChevronsLeft,
  ChevronsRight
} from 'lucide-react';
import type {
  AppSettings,
  DailyPlan,
  DailyPlanBlock,
  DailyGuideBlock,
  DailyGuideTask,
  GoalBrief,
  GoalIntakeState,
  HistoryIntakeSummary,
  LearningRuntimeSnapshot,
  PlanAdjustmentProposal,
  QuestionAnswerResult,
  ReviewResult,
  SubmissionEvaluationResult,
  StudySession,
  TodayGuideState,
  TeachStepResult,
  TaskItem
} from '../../shared/types';
import { getSessionElapsedSeconds } from './float-behavior';
import { getPreviewConfig } from './bridge/url-state';
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

function toCompactTitle(text: string, maxLength = 30): string {
  const normalized = text.replace(/\s+/gu, ' ').trim();
  const firstSegment = normalized.split(/[，。；、,.]/u).find(Boolean)?.trim() ?? normalized;
  return firstSegment.length > maxLength ? `${firstSegment.slice(0, maxLength)}…` : firstSegment;
}

function App(): JSX.Element {
  const [view, setView] = useState<ViewKey>(() => {
    const previewView = getPreviewConfig().view;
    return previewView === 'settlement' ? 'settlement' : previewView ?? 'today';
  });
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [onboarding, setOnboarding] = useState<GoalIntakeState | null>(null);
  const [todayGuide, setTodayGuide] = useState<TodayGuideState | null>(null);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [plans, setPlans] = useState<DailyPlan[]>([]);
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [studyNotes, setStudyNotes] = useState('');
  const studyElapsedRef = useRef(0);
  const [showAiDrawer, setShowAiDrawer] = useState(false);
  const [aiDrawerInitialTab, setAiDrawerInitialTab] = useState<'question' | 'submission'>('question');
  const handleOpenDrawer = useCallback((tab: 'question' | 'submission' = 'question'): void => {
    setAiDrawerInitialTab(tab);
    setShowAiDrawer(true);
  }, []);
  const handleCloseDrawer = useCallback((): void => setShowAiDrawer(false), []);

  const activePlan = useMemo(
    () => plans.find((plan) => plan.id === selectedPlanId) ?? plans[0] ?? null,
    [plans, selectedPlanId]
  );

  async function refresh(preferredPlanId?: string): Promise<void> {
    if (!window.studyApp) {
      throw new Error('Electron preload API 不可用，请检查主进程里的 preload 路径。');
    }
    const [nextSettings, nextOnboarding, nextTodayGuide, nextTasks, nextPlans, nextLearningState] = await Promise.all([
      window.studyApp.settings.get(),
      window.studyApp.onboarding.getCurrent(),
      window.studyApp.guides.listToday(),
      window.studyApp.tasks.list(),
      window.studyApp.plans.list(todayIso),
      window.studyApp.learning.getState()
    ]);
    setSettings(nextSettings);
    setOnboarding(nextOnboarding);
    setTodayGuide(nextTodayGuide);
    setTasks(nextTasks);
    setPlans(nextPlans);
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
    <div className={sidebarCollapsed ? 'prototype-shell collapsed' : 'prototype-shell'}>
      <Sidebar current={view} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((c) => !c)} onSelect={setView} />
      <main className={view === 'today' && todayGuide?.guide ? 'workspace today-workspace' : 'workspace'}>
        {view === 'today' && (
          <TodayView
            settings={settings}
            onboarding={onboarding}
            todayGuide={todayGuide}
            activeSession={activeSession}
            learningState={learningState}
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
                try {
                  await window.studyApp.guides.generateLayeredPlan(result.goal.id);
                } finally {
                  await refresh(selectedPlanId ?? undefined);
                }
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
            todayGuide={todayGuide}
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
            onTeachStep={() =>
              runAction('展开当前步骤', async () => {
                const result = await window.studyApp.learning.teachCurrentStep();
                setTeaching(result);
                setLearningState(await window.studyApp.learning.getState());
              })
            }
            onCompleteCurrentAction={() =>
              runAction('完成当前步骤', async () => {
                setLearningState(await window.studyApp.learning.completeCurrentAction());
                setTeaching(null);
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
                await refresh(selectedPlanId ?? undefined);
              })
            }
            onOpenDrawer={handleOpenDrawer}
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
            todayGuide={todayGuide}
            activePlan={activePlan}
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
            runAction={runAction}
            onSaved={refresh}
          />
        )}
        <AiDrawer
          show={showAiDrawer}
          initialTab={aiDrawerInitialTab}
          onClose={handleCloseDrawer}
          settings={settings}
          learningState={learningState}
          questionAnswer={questionAnswer}
          submissionResult={submissionResult}
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
              await refresh(selectedPlanId ?? undefined);
            })
          }
        />
      </main>
    </div>
  );
}

function Sidebar({
  current,
  collapsed,
  onToggle,
  onSelect
}: {
  current: ViewKey;
  collapsed: boolean;
  onToggle: () => void;
  onSelect: (view: ViewKey) => void;
}): JSX.Element {
  const items: Array<{ key: ViewKey; label: string; icon: JSX.Element }> = [
    { key: 'today', label: '今日', icon: <Home size={18} /> },
    { key: 'study', label: '学习', icon: <CheckCircle2 size={18} /> },
    { key: 'review', label: '复盘', icon: <FileText size={18} /> },
    { key: 'settings', label: '设置', icon: <Settings size={18} /> }
  ];
  return (
    <aside className={collapsed ? 'sidebar collapsed' : 'sidebar'}>
      <div className="brand">
        <div className="brand-mark">学</div>
        <div className="brand-copy">
          <strong>学习管家</strong>
          <span>AI 学习助手</span>
        </div>
        <button
          className="sidebar-collapse-button"
          type="button"
          aria-label={collapsed ? '展开侧边栏' : '折叠侧边栏'}
          onClick={onToggle}
          title={collapsed ? '展开侧边栏' : '折叠侧边栏'}
        >
          {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
        </button>
      </div>
      <nav className="nav-list" aria-label="主导航">
        {items.map((item) => (
          <button
            className={item.key === current ? 'nav-item active' : 'nav-item'}
            key={item.key}
            onClick={() => onSelect(item.key)}
            title={item.label}
          >
            {item.icon}
            <span className="nav-label">{item.label}</span>
          </button>
        ))}
      </nav>
      <button className="sidebar-user" type="button">
        <span className="sidebar-user-avatar">学</span>
        <span className="nav-label">学习者</span>
        <ChevronRight size={16} />
      </button>
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
  learningState,
  runAction,
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
  learningState: LearningRuntimeSnapshot | null;
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
  const [intakePending, setIntakePending] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyList, setHistoryList] = useState<HistoryIntakeSummary[]>([]);
  const [historyPending, setHistoryPending] = useState(false);
  const [selectedHistoryIntake, setSelectedHistoryIntake] = useState<GoalIntakeState | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const guide = todayGuide?.guide ?? null;
  const goal = todayGuide?.goal ?? onboarding?.activeGoal ?? null;
  const currentSelection = guide ? getCurrentGuideTaskSelection(guide.tasks, guide.blocks, activeSession, learningState) : null;
  const currentBlock = currentSelection?.block ?? null;
  const currentTask = currentSelection?.task ?? null;
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

  async function loadHistory(): Promise<void> {
    setHistoryPending(true);
    setSelectedHistoryIntake(null);
    try {
      setHistoryList(await window.studyApp.history.listAll());
    } catch (error) {
      runAction('加载历史', async () => { throw error; });
    } finally {
      setHistoryPending(false);
    }
  }

  async function loadHistoryIntake(intakeId: string): Promise<void> {
    setHistoryPending(true);
    try {
      setSelectedHistoryIntake(await window.studyApp.history.getById(intakeId));
    } catch (error) {
      runAction('加载会话详情', async () => { throw error; });
    } finally {
      setHistoryPending(false);
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
          {goal && !guide && !(onboarding?.intake.status === 'ready' && briefDraft) && (
            canUseAi ? (
              <button className="primary-action full" type="button" onClick={async () => {
                setPlanLoading(true);
                try {
                  await onGenerateLayeredPlan(goal.id);
                } finally {
                  setPlanLoading(false);
                }
              }}>
                <Sparkles size={16} />
                {onboarding?.intake.status === 'confirmed' ? '重新生成当日计划' : '确认并生成计划'}
              </button>
            ) : (
              <>
                <p className="micro-hint" style={{ margin: '0 0 8px', textAlign: 'center' }}>
                  <AlertTriangle size={14} />
                  请先配置 DeepSeek API Key
                </p>
                <button className="primary-action full" type="button" onClick={() => onGoTo('settings')}>
                  <Settings size={16} />
                  配置模型
                </button>
              </>
            )
          )}
          <button className="secondary-action full" type="button" style={{ marginTop: 12 }} onClick={() => { void loadHistory(); setShowHistory(true); }}>
            <Clock3 size={16} />
            历史会话
          </button>
        </aside>
        {showHistory && (
          <HistoryPanel
            list={historyList}
            pending={historyPending}
            selected={selectedHistoryIntake}
            onSelect={(item) => { void loadHistoryIntake(item.intake.id); }}
            onRegenerate={async (item) => {
              if (item.intake.goalId) {
                setShowHistory(false);
                setPlanLoading(true);
                try {
                  await onGenerateLayeredPlan(item.intake.goalId);
                } finally {
                  setPlanLoading(false);
                }
              }
            }}
            onClose={() => { setShowHistory(false); setSelectedHistoryIntake(null); }}
          />
        )}
        {planLoading && (
          <div className="modal-overlay">
            <div className="modal-box">
              <Loader2 className="spin" size={24} />
              <p>正在生成分层计划，请稍候…</p>
            </div>
          </div>
        )}
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
  const currentPlanBlockId = currentSelection?.planBlockId ?? null;
  const activeSessionBelongsToCurrent = Boolean(currentPlanBlockId && activeSession?.blockId === currentPlanBlockId);
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
  const focusPathItems = [
    goal?.title ?? '当前目标',
    todayGuide?.roadmap[0]?.title ?? '当前阶段',
    guide.weekFocus || '本周重点',
    '今天',
    currentTask?.title ?? currentBlock?.title ?? '当前任务'
  ].filter((item, index, items) => index === 0 || item !== items[index - 1]);
  const handleTodayPrimaryAction = async (): Promise<void> => {
    if (!currentPlanBlockId || guide.status === 'archived') return;
    if (guide.status === 'draft') {
      await onConfirmGuide(guide.id);
      onGoTo('study');
      await onStart(currentPlanBlockId);
      return;
    }
    if (isCurrentActive) {
      onGoTo('study');
      return;
    }
    onGoTo('study');
    await onStart(currentPlanBlockId);
  };

  const totalElapsed = guide.tasks.reduce((sum, t) => sum + (t.totalElapsedMinutes || 0), 0);

  return (
    <section className="today-v2">
      <div className="today-v2-main">
        <header className="page-title-block">
          <h1>今日</h1>
          <p>按计划推进，保持稳定节奏</p>
        </header>

        <section className="today-goal-strip">
          <div className="goal-strip-icon">
            <Target size={44} />
          </div>
          <div className="goal-strip-block">
            <strong>今日总目标</strong>
            <p>{guide.todayGoal}</p>
            {currentTask && (
              <p className="micro-hint">当前主任务：{currentTask.title} · {currentTask.objective}</p>
            )}
            <div className="goal-strip-meta" aria-label="今日概览">
              <span><ListChecks size={16} />{totalCount} 个任务</span>
              <span><Clock3 size={16} />预计 {totalMinutes} 分钟</span>
            </div>
          </div>
          <button className="primary-action goal-strip-action" type="button" disabled={!currentPlanBlockId || guide.status === 'archived'} onClick={() => void handleTodayPrimaryAction()}>
            <Play size={16} />
            {guide.status === 'draft' ? primaryActionLabel : '开始今日学习'}
          </button>
        </section>

        <div className="task-summary-list">
          <h3 className="task-summary-heading">今日任务</h3>
          {guide.tasks.map((task, index) => {
            const taskStepCount = task.actions.length;
            const doneStepCount = task.actions.filter((a) => a.status === 'done').length;
            const isCurrentTask = task.id === currentTask?.id;
            const statusLabel = task.status === 'done' ? '已完成' : task.status === 'active' ? '进行中' : '待开始';
            return (
              <div className={`task-summary-item ${isCurrentTask ? 'current' : ''} ${task.status === 'done' ? 'done' : ''}`} key={task.id}>
                <span className="task-index">{String(index + 1).padStart(2, '0')}</span>
                <div className="task-summary-info">
                  <div className="task-summary-title-row">
                    <strong>{task.title}</strong>
                  </div>
                  <span className="task-meta">
                    {task.actions.slice(0, 4).map((action) => action.title).join('、') || task.doneWhen}
                  </span>
                  {taskStepCount > 0 && (
                    <span className="task-step-progress">
                      <ListChecks size={16} /> {taskStepCount} 个步骤
                      <Clock3 size={16} /> {task.estimatedMinutes.target} 分钟
                    </span>
                  )}
                </div>
                <span className={`task-status-badge ${task.status === 'done' ? 'done' : task.status === 'active' ? 'active' : ''}`}>{statusLabel}</span>
                <ChevronRight size={18} className="task-chevron" />
              </div>
            );
          })}
        </div>
      </div>

      <aside className="today-context-panel" aria-label="今日进度与历史">
        <div className="context-card progress-ring-card">
          <h3>今日进度</h3>
          <div className="progress-ring-widget">
            <div className="progress-ring" style={{ background: `conic-gradient(var(--color-primary) ${progressPercent}%, var(--color-primary-surface) 0)` }}>
              <span>{progressPercent}%</span>
            </div>
            <div className="progress-ring-stats">
              <div>
                <strong>{completedCount}/{totalCount}</strong>
                <span>任务完成</span>
              </div>
              <div>
                <strong>{totalElapsed} 分钟</strong>
                <span>学习时长</span>
              </div>
            </div>
          </div>
        </div>

        <div className="context-card">
          <div className="context-card-head">
            <h3>最近学习</h3>
            <button className="text-action" type="button" onClick={() => void onGoTo('review')}>
              查看全部
              <ChevronRight size={14} />
            </button>
          </div>
          <div className="recent-list">
            {learningState?.recentStepSummaries && learningState.recentStepSummaries.length > 0 ? (
              learningState.recentStepSummaries.slice(0, 3).map((summary) => (
                <div key={summary.id} className="recent-item">
                  <span className="recent-icon"><CheckCircle2 size={14} /></span>
                  <span className="recent-text">{summary.kind === 'step' ? '完成步骤' : summary.kind === 'task' ? '完成任务' : '学习记录'}</span>
                </div>
              ))
            ) : (
              <>
                <div className="recent-item">
                  <span className="recent-icon target"><Target size={16} /></span>
                  <span className="recent-text"><strong>掌握 git init</strong><small>步骤 1/2</small></span>
                  <span className="recent-time">今天 09:42</span>
                </div>
                <div className="recent-item">
                  <span className="recent-icon done"><CheckCircle2 size={16} /></span>
                  <span className="recent-text"><strong>学习计划已生成</strong><small>{totalCount} 个任务 · {totalMinutes} 分钟</small></span>
                  <span className="recent-time">今天 09:40</span>
                </div>
                <div className="recent-item">
                  <span className="recent-icon file"><FileText size={16} /></span>
                  <span className="recent-text"><strong>项目：{goal?.title ?? '当前学习项目'}</strong><small>创建时间：今天 09:40</small></span>
                </div>
              </>
            )}
          </div>
        </div>
      </aside>

      {showHistory && (
        <HistoryPanel
          list={historyList}
          pending={historyPending}
          selected={selectedHistoryIntake}
          onSelect={(item) => { void loadHistoryIntake(item.intake.id); }}
          onRegenerate={async (item) => {
            if (item.intake.goalId) {
              setShowHistory(false);
              setPlanLoading(true);
              try {
                await onGenerateLayeredPlan(item.intake.goalId);
              } finally {
                setPlanLoading(false);
              }
            }
          }}
          onClose={() => { setShowHistory(false); setSelectedHistoryIntake(null); }}
        />
      )}
      {planLoading && (
        <div className="modal-overlay">
          <div className="modal-box">
            <Loader2 className="spin" size={24} />
            <p>正在生成分层计划，请稍候…</p>
          </div>
        </div>
      )}
    </section>
  );
}


function HistoryPanel({
  list,
  pending,
  selected,
  onSelect,
  onRegenerate,
  onClose
}: {
  list: HistoryIntakeSummary[];
  pending: boolean;
  selected: GoalIntakeState | null;
  onSelect: (item: HistoryIntakeSummary) => void;
  onRegenerate: (item: HistoryIntakeSummary) => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <section className="modal-box history-panel" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>历史会话</h2>
          <p>浏览所有历史目标访谈记录，可查看详情或重新生成计划。</p>
          <button className="icon-button" type="button" aria-label="关闭" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="history-list">
          {pending && list.length === 0 && (
            <div className="history-message">
              <Loader2 className="spin" size={20} />
              <span>加载中…</span>
            </div>
          )}
          {!pending && list.length === 0 && (
            <div className="history-message">
              <span>暂无历史会话。</span>
            </div>
          )}
          {list.map((item) => {
            const isSelected = selected?.intake.id === item.intake.id;
            const dateOnly = item.intake.createdAt.slice(0, 10);
            const timeOnly = item.intake.createdAt.slice(11, 19);
            return (
              <article key={item.intake.id} className={`history-item ${isSelected ? 'expanded' : ''}`}>
                <div className="history-item-head" onClick={() => onSelect(item)}>
                  <span className="history-item-title">{item.goalTitle || '（无目标）'}</span>
                  <span className="history-item-meta">{dateOnly} {timeOnly} · {item.messageCount} 条消息 · {statusLabel(item.intake.status)}</span>
                  <ChevronRight size={14} className={`history-chevron ${isSelected ? 'rotated' : ''}`} />
                </div>
                {isSelected && selected && (
                  <div className="history-item-detail">
                    <div className="history-messages">
                      {selected.messages.map((msg) => (
                        <div key={msg.id} className={`history-msg ${msg.role}`}>
                          <strong>{msg.role === 'assistant' ? 'AI' : '你'}</strong>
                          <span>{msg.content.length > 300 ? msg.content.slice(0, 300) + '…' : msg.content}</span>
                        </div>
                      ))}
                    </div>
                    {item.intake.goalId && (
                      <button className="primary-action full" type="button" onClick={() => onRegenerate(item)}>
                        <Sparkles size={16} />
                        据此重新生成计划
                      </button>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function statusLabel(status: string): string {
  const map: Record<string, string> = { collecting: '采集中', ready: '待确认', confirmed: '已确认' };
  return map[status] ?? status;
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
      {blocks.map((block, index) => {
        if (block.kind === 'heading') {
          return <strong className="message-heading" key={`${block.kind}-${index}`}>{block.text}</strong>;
        }
        if (block.kind === 'code') {
          return <pre key={`${block.kind}-${index}`}><code>{block.text}</code></pre>;
        }
        if (block.kind === 'list') {
          const ListTag = block.ordered ? 'ol' : 'ul';
          return (
            <ListTag key={`${block.kind}-${index}`}>
            {block.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
            </ListTag>
          );
        }
        return <p key={`${block.kind}-${index}`}>{block.text}</p>;
      })}
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
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'code'; text: string };

function toMessageBlocks(content: string): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let listOrdered = false;
  let codeLines: string[] = [];
  let inCodeBlock = false;

  function flushParagraph(): void {
    const text = paragraph.join('\n').trim();
    if (text) blocks.push({ kind: 'paragraph', text });
    paragraph = [];
  }

  function flushList(): void {
    if (listItems.length > 0) blocks.push({ kind: 'list', ordered: listOrdered, items: listItems });
    listItems = [];
    listOrdered = false;
  }

  function flushCode(): void {
    if (codeLines.length > 0) blocks.push({ kind: 'code', text: codeLines.join('\n').trimEnd() });
    codeLines = [];
  }

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trimEnd();

    if (/^```/u.test(line.trim())) {
      if (inCodeBlock) {
        flushCode();
        inCodeBlock = false;
      } else {
        flushParagraph();
        flushList();
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(rawLine);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = trimmed.match(/^#{1,6}\s+(.+)$/u);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ kind: 'heading', text: cleanMarkdownText(heading[1]) });
      continue;
    }

    const bullet = trimmed.match(/^([-*•]|\d+[.)、])\s*(.+)$/u);
    if (bullet) {
      flushParagraph();
      const ordered = /^\d/u.test(bullet[1]);
      if (listItems.length > 0 && ordered !== listOrdered) flushList();
      listOrdered = ordered;
      listItems.push(cleanMarkdownText(bullet[2]));
      continue;
    }

    flushList();
    paragraph.push(cleanMarkdownText(trimmed));
  }

  flushParagraph();
  flushList();
  flushCode();
  return blocks.length > 0 ? blocks : [{ kind: 'paragraph', text: content }];
}

function cleanMarkdownText(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/gu, '$1')
    .replace(/__([^_]+)__/gu, '$1')
    .replace(/`([^`]+)`/gu, '$1')
    .trim();
}



function getCurrentGuideBlock(blocks: DailyGuideBlock[], activeSession: StudySession | null): DailyGuideBlock | null {
  if (activeSession?.blockId) {
    const sessionBlock = blocks.find((block) => block.planBlockId === activeSession.blockId);
    if (sessionBlock) return sessionBlock;
  }
  return blocks.find((block) => block.status === 'active') ?? blocks.find((block) => block.status === 'planned') ?? blocks[0] ?? null;
}

interface CurrentGuideTaskSelection {
  task: DailyGuideTask | null;
  block: DailyGuideBlock | null;
  planBlockId: string | null;
}

function getCurrentGuideTaskSelection(
  tasks: DailyGuideTask[],
  blocks: DailyGuideBlock[],
  activeSession: StudySession | null,
  learningState: LearningRuntimeSnapshot | null
): CurrentGuideTaskSelection {
  const persistedBlockId = learningState?.step?.blockId ?? learningState?.state.activeDailyTaskId ?? null;
  const findBlock = (blockId: string | null): DailyGuideBlock | null =>
    blockId ? blocks.find((item) => item.planBlockId === blockId) ?? null : null;
  const findTask = (blockId: string | null): DailyGuideTask | null =>
    blockId ? tasks.find((item) => item.legacyPlanBlockId === blockId) ?? null : null;

  let task = findTask(activeSession?.blockId ?? null);
  let block = findBlock(activeSession?.blockId ?? null);
  if (task?.status === 'done') {
    task = null;
    block = null;
  }

  if (!task && persistedBlockId) {
    task = findTask(persistedBlockId);
    block = findBlock(persistedBlockId);
  }

  if (!task) {
    task = tasks.find((item) => item.status === 'active')
      ?? tasks.find((item) => item.status === 'planned' || item.status === 'deferred')
      ?? tasks.find((item) => item.status === 'done')
      ?? null;
    block = findBlock(task?.legacyPlanBlockId ?? null) ?? getCurrentGuideBlock(blocks, null);
  }

  const planBlockId = task?.legacyPlanBlockId ?? block?.planBlockId ?? null;

  return { task, block, planBlockId };
}



function StudyView({
  todayGuide,
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
  onTeachStep,
  onCompleteCurrentAction,
  onAskQuestion,
  onResolveQuestion,
  onSubmitResult,
  onOpenDrawer,
  onGoTo
}: {
  todayGuide: TodayGuideState | null;
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
  onTeachStep: () => Promise<void>;
  onCompleteCurrentAction: () => Promise<void>;
  onAskQuestion: (question: string) => Promise<void>;
  onResolveQuestion: (threadId: string) => Promise<void>;
  onSubmitResult: (content: string) => Promise<void>;
  onOpenDrawer: (tab?: 'question' | 'submission') => void;
  onGoTo: (view: ViewKey) => void;
}): JSX.Element {
  const blocks = activePlan?.blocks ?? [];
  const guide = todayGuide?.guide ?? null;
  const currentSelection = guide ? getCurrentGuideTaskSelection(guide.tasks, guide.blocks, activeSession, learningState) : null;
  const currentPlanBlockId = currentSelection?.planBlockId ?? activeSession?.blockId ?? null;
  const currentBlock = currentPlanBlockId
    ? blocks.find((b) => b.id === currentPlanBlockId) ?? null
    : null;
  const fallbackBlock = blocks.find((b) => b.status === 'planned' || b.status === 'active') ?? blocks[0] ?? null;
  const displayBlock = currentBlock ?? fallbackBlock;

  const currentTask = currentSelection?.task ?? null;
  const taskActions = currentTask?.actions ?? [];
  const currentStep = learningState?.step ?? null;
  const currentStepBelongsToTask = Boolean(currentStep?.blockId && currentPlanBlockId && currentStep.blockId === currentPlanBlockId);
  const rawStepIndex = currentStepBelongsToTask ? currentStep?.position ?? 0 : 0;
  const stepIndex = taskActions.length > 0 ? Math.min(Math.max(rawStepIndex, 0), taskActions.length - 1) : 0;
  const stepPosition = stepIndex >= 0 ? stepIndex + 1 : 1;
  const totalSteps = Math.max(taskActions.length, 1);
  const allActionsDone = taskActions.length > 0 && taskActions.every((action) => action.status === 'done');
  const taskDone = currentTask?.status === 'done';
  const activeSessionBelongsToCurrent = Boolean(currentPlanBlockId && activeSession?.blockId === currentPlanBlockId);

  const isActive = activeSessionBelongsToCurrent && activeSession?.status === 'active';
  const isPaused = activeSessionBelongsToCurrent && activeSession?.status === 'paused';
  const isNotStarted = !activeSessionBelongsToCurrent || !activeSession || (activeSession.status !== 'active' && activeSession.status !== 'paused');
  const taskTitle = toCompactTitle(currentTask?.title ?? displayBlock?.objective ?? '当前任务');
  const currentAction = taskActions[stepIndex] ?? taskActions[0] ?? null;
  const taskObjective = currentTask?.objective ?? displayBlock?.objective ?? '';
  const stepTitle = taskDone
    ? '主任务已完成'
    : allActionsDone
      ? '等待提交当前结果'
    : (currentStepBelongsToTask ? currentStep?.title : null) ?? currentAction?.title ?? '当前步骤';
  const stepInstruction = taskDone
    ? '当前主任务已经通过评价。若还有下一个主任务，可以从今日页继续下一项。'
    : allActionsDone
      ? '当前主任务的行动步骤已经完成。下一步需要提交当前结果，由 AI 评价后决定完成或继续修改。'
    : (currentStepBelongsToTask ? currentStep?.instruction : null) ?? currentAction?.instruction ?? displayBlock?.action ?? '按当前步骤说明推进。';
  const stepCriteria = taskDone
    ? submissionResult?.evaluation.feedback ?? learningState?.latestEvaluation?.feedback ?? currentTask?.doneWhen.join('\n') ?? displayBlock?.successCheck ?? ''
    : allActionsDone
      ? currentTask?.doneWhen.join('\n') ?? displayBlock?.successCheck ?? ''
    : (currentStepBelongsToTask ? currentStep?.successCriteria : null) ?? currentAction?.checkpoint ?? displayBlock?.successCheck ?? '';
  const sessionStatusText = isActive ? '专注中' : isPaused ? '已暂停' : isNotStarted ? '未开始' : '进行中';
  const sessionStatusClass = isActive ? 'active' : isPaused ? 'paused' : '';

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

  const [showEndConfirm, setShowEndConfirm] = useState(false);

  const handleEndStudy = useCallback((): void => {
    setShowEndConfirm(true);
  }, []);

  const confirmEndStudy = useCallback((): void => {
    setShowEndConfirm(false);
    void onCompleteSession(notes);
  }, [notes, onCompleteSession]);

  const cancelEndStudy = useCallback((): void => {
    setShowEndConfirm(false);
  }, []);

  const progressPercent = totalSteps > 0 ? Math.round((stepPosition / totalSteps) * 100) : 0;

  return (
    <section className="study-layout">
      <div className="study-main">
        <header className="page-title-block">
          <h1>学习</h1>
          <p>专注当下，逐步完成每一个学习动作</p>
        </header>

        <section className="study-session-bar" aria-label="学习会话状态">
          <div className="session-task">
            <span className="session-task-icon"><ChevronRight size={18} /></span>
            <strong>{taskTitle}</strong>
          </div>
          <span className="session-step-label">步骤 {stepPosition}/{totalSteps}</span>
          <span className="session-timer"><Clock3 size={16} />{(isActive || isPaused) ? formatElapsedTime(elapsedSeconds) : '00:00'}</span>
          {isActive || isPaused ? (
            <button
              className="session-pause-button"
              type="button"
              onClick={() => void (isPaused ? onResumeSession() : onPauseSession())}
            >
              {isPaused ? <><Play size={14} />继续</> : <><Pause size={14} />暂停</>}
            </button>
          ) : (
            <span className={`focus-state-pill ${sessionStatusClass}`}>{sessionStatusText}</span>
          )}
        </section>

        <section className="study-current-step-panel focus-execution-panel" aria-label="当前步骤">
          <div className="current-step-heading">
            <div className="current-step-title-block">
              <span className="focus-eyebrow">当前步骤</span>
              <h2>{stepTitle}</h2>
            </div>
            <button className="secondary-action help-button" type="button" onClick={() => void onOpenDrawer()}>
              <HelpCircle size={16} />
              遇到问题
            </button>
          </div>
          <div className="focus-work-list">
            {taskObjective && (
              <article className="focus-work-item">
                <strong>主任务目标</strong>
                <MessageContent content={taskObjective} />
              </article>
            )}
            <article className="focus-work-item primary">
              <strong>操作说明</strong>
              <MessageContent content={stepInstruction} />
            </article>
            {stepCriteria && (
              <article className="focus-work-item">
                <strong>完成标准</strong>
                <MessageContent content={stepCriteria} />
              </article>
            )}
          </div>
          {displayBlock?.fallback && (
            <details className="focus-help-row">
              <summary>
                <HelpCircle size={18} />
                卡住时查看提示
                <ChevronRight size={16} />
              </summary>
              <MessageContent content={displayBlock.fallback} />
            </details>
          )}
          {teaching && (
            <div className="assistant-message assistant-message-system">
              <strong>AI 展开：</strong>
              <MessageContent content={`${teaching.explanation}\n\n${teaching.userAction}`} />
            </div>
          )}
        </section>
      </div>

      <aside className="study-context-panel" aria-label="任务大纲与学习记录">
        <div className="context-section">
          <h3>任务大纲</h3>
          <ol className="step-outline-list">
            {taskActions.map((action, index) => (
              <li key={action.id} className={action.status === 'done' ? 'done' : index === stepIndex ? 'active' : ''}>
                <span className="step-outline-marker">
                  {action.status === 'done' ? <CircleCheck size={14} /> : index === stepIndex ? <CircleDot size={14} /> : <Circle size={14} />}
                </span>
                <span className="step-outline-title">{action.title}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="context-section">
          <h3>本次学习记录</h3>
          <div className="study-record-list">
            {activeSession && (
              <div className="study-record-item">
                <span className="record-icon"><Play size={12} /></span>
                <span>开始学习 {activeSession.startedAt.slice(11, 16)}</span>
              </div>
            )}
            {taskActions.filter((a) => a.status === 'done').map((action) => (
              <div key={action.id} className="study-record-item">
                <span className="record-icon"><CheckCircle2 size={12} /></span>
                <span>完成步骤：{action.title}</span>
              </div>
            ))}
            {isPaused && (
              <div className="study-record-item">
                <span className="record-icon"><Pause size={12} /></span>
                <span>已暂停</span>
              </div>
            )}
          </div>
        </div>

        <div className="context-section current-progress-section">
          <h3>当前进度</h3>
          <div className="current-progress-bar">
            <div style={{ width: `${progressPercent}%` }} />
          </div>
          <span>{stepPosition}/{totalSteps} 步骤</span>
        </div>
      </aside>

      <div className="study-fixed-action-bar">
        <div className="bar-left">
          <button className="text-action back-today" type="button" onClick={() => void onGoTo('today')}>
            返回今日
          </button>
          <button
            className="text-action end-study"
            type="button"
            onClick={() => void handleEndStudy()}
          >
            <Square size={16} />
            结束学习
          </button>
        </div>
        <div className="bar-right">
          {isPaused ? (
            <button className="secondary-action" type="button" onClick={() => void onResumeSession()}>
              <Play size={16} />
              继续学习
            </button>
          ) : isActive ? (
            <button className="secondary-action" type="button" onClick={() => void onPauseSession()}>
              <Pause size={16} />
              暂停
            </button>
          ) : null}
          {isActive && !taskDone && (
            allActionsDone ? (
              <button className="primary-action" type="button" onClick={() => void onOpenDrawer('submission')}>
                <CheckCircle2 size={16} />
                提交当前结果
              </button>
            ) : (
              <button className="primary-action" type="button" onClick={() => void onCompleteCurrentAction()}>
                <CheckCircle2 size={16} />
                完成当前步骤
              </button>
            )
          )}
          <button className="secondary-action" type="button" onClick={() => void onOpenDrawer()}>
            <HelpCircle size={16} />
            遇到问题
          </button>
        </div>
      </div>

      {showEndConfirm && (
        <div className="modal-overlay" onClick={cancelEndStudy}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3>结束学习</h3>
            <p>当前进度将被保留，你可以稍后继续。</p>
            <div className="modal-actions">
              <button className="secondary-action" type="button" onClick={cancelEndStudy}>
                继续学习
              </button>
              <button className="primary-action" type="button" onClick={confirmEndStudy}>
                保存进度并结束
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}


function AiDrawer({
  show,
  initialTab,
  onClose,
  settings,
  learningState,
  questionAnswer,
  submissionResult,
  onTeachStep,
  onAskQuestion,
  onResolveQuestion,
  onSubmitResult
}: {
  show: boolean;
  initialTab: 'question' | 'submission';
  onClose: () => void;
  settings: AppSettings | null;
  learningState: LearningRuntimeSnapshot | null;
  questionAnswer: QuestionAnswerResult | null;
  submissionResult: SubmissionEvaluationResult | null;
  onTeachStep: () => Promise<void>;
  onAskQuestion: (question: string) => Promise<void>;
  onResolveQuestion: (threadId: string) => Promise<void>;
  onSubmitResult: (content: string) => Promise<void>;
}): JSX.Element | null {
  const [question, setQuestion] = useState('');
  const [submission, setSubmission] = useState('');
  const [activeTab, setActiveTab] = useState<'question' | 'submission'>('question');
  const activeThread = learningState?.questionThread ?? null;
  const latestEvaluation = submissionResult?.evaluation ?? learningState?.latestEvaluation ?? null;
  const latestDecision = submissionResult?.decision ?? learningState?.latestDecision ?? null;

  useEffect(() => {
    if (show) {
      setActiveTab(initialTab);
    }
  }, [show, initialTab]);

  if (!show) return null;

  return (
    <div className="ai-drawer-overlay" onClick={onClose}>
      <aside className="ai-drawer" onClick={(event) => event.stopPropagation()} aria-label="AI 学习助手">
        <div className="today-ai-heading">
          <Sparkles size={20} />
          <h3>AI 学习助手</h3>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        {!settings?.hasDeepseekApiKey ? (
          <StatePanel type="ai-unavailable" title="AI 暂不可用" text="请先在设置中配置 DeepSeek API Key，才能使用 AI 学习助手。" />
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

            {activeTab === 'question' && (
              <>
                <label className="assistant-field">
                  提问
                  <textarea
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    placeholder="描述你的问题或卡点..."
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
                    <MessageContent content={questionAnswer.answer} />
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
                  提交结果
                  <textarea
                    value={submission}
                    onChange={(event) => setSubmission(event.target.value)}
                    placeholder="粘贴最终产出、答案或链接..."
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
                <MessageContent content={latestEvaluation.feedback} />
              </div>
            )}

            {latestDecision && (
              <div className="assistant-message">
                <strong>下一步：{latestDecision.decision}</strong>
                <MessageContent content={latestDecision.reason} />
              </div>
            )}
          </>
        )}
      </aside>
    </div>
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
  todayGuide,
  activePlan,
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
  todayGuide: TodayGuideState | null;
  activePlan: DailyPlan | null;
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

  const plannedTasksTotal = todayGuide?.guide?.tasks.length ?? activePlan?.blocks.length ?? 0;
  const tasksTotal = Math.max(plannedTasksTotal, latestSettlement ? 1 : 0);
  const tasksDone = completionScore >= 80 ? tasksTotal : completionScore > 0 ? Math.max(0, tasksTotal - 1) : 0;
  const last7Days = [
    { label: '05/10', value: 45 },
    { label: '05/11', value: 72 },
    { label: '05/12', value: 54 },
    { label: '05/13', value: 68 },
    { label: '05/14', value: 61 },
    { label: '05/15', value: 48 },
    { label: '05/16', value: settlementMinutes || 0 }
  ];
  const maxBar = Math.max(...last7Days.map((d) => d.value), 78);
  const blockerItems = focusScore < 70
    ? ['专注稳定性仍需提升']
    : ['暂未记录明显卡点'];
  const suggestionItems = allActions.length
    ? allActions.slice(0, 3)
    : pendingAdjustment?.reason
      ? [pendingAdjustment.reason]
      : ['保持当前节奏，继续完成剩余任务'];

  return (
    <section className="review-layout">
      <div className="review-main">
        <header className="page-title-block">
          <h1>复盘</h1>
          <p>回顾今天的完成情况，形成可持续的学习节奏</p>
        </header>

        <section className="review-stats-row">
          <div className="review-stat-card">
            <CheckCircle2 size={28} />
            <div>
              <span>今日完成</span>
              <strong>{tasksDone}/{tasksTotal} 任务</strong>
            </div>
          </div>
          <div className="review-stat-card">
            <Clock3 size={28} />
            <div>
              <span>学习时长</span>
              <strong>{settlementMinutes > 0 ? `${settlementMinutes} 分钟` : '-'}</strong>
            </div>
          </div>
          <div className="review-stat-card">
            <TrendingUp size={28} />
            <div>
              <span>完成率</span>
              <strong>{completionScore}%</strong>
            </div>
          </div>
        </section>

        <section className="surface review-summary-card">
          <div className="review-summary-header">
            <span className="summary-icon"><FileText size={22} /></span>
            <div>
              <strong>本次学习总结</strong>
              <p>{review ? review.summary : latestSettlement?.notes || '完成学习后生成总结。'}</p>
            </div>
          </div>
          <div className="review-tag-row">
            <span><CircleDot size={12} />已完成提交记录</span>
            <span><CircleDot size={12} />掌握基础分支操作</span>
            <span className="warning"><CircleDot size={12} />需继续练习冲突处理</span>
          </div>
        </section>

        <section className="surface review-timeline-card">
          <h3>学习记录</h3>
          {!latestSettlement && !review && (
            <p className="muted">暂无学习记录，完成一次学习后会在这里汇总。</p>
          )}
          <div className="review-timeline">
            {latestSettlement && (
              <>
                <div className="timeline-item">
                  <span className="timeline-dot" />
                  <span className="timeline-time">{latestSettlement.session.startedAt.slice(11, 16)}</span>
                  <span className="timeline-text">开始学习</span>
                </div>
                <div className="timeline-item">
                  <span className="timeline-dot" />
                  <span className="timeline-time">-</span>
                  <span className="timeline-text">完成本次学习 · {settlementMinutes} 分钟</span>
                </div>
              </>
            )}
            {review && (
              <div className="timeline-item">
                <span className="timeline-dot" />
                <span className="timeline-time">-</span>
                <span className="timeline-text">生成复盘 · {completionScore}% 完成率</span>
              </div>
            )}
          </div>
        </section>

        {pendingAdjustment?.status === 'pending' && (
          <section className="surface review-adjustment-card">
            <h3>调整建议</h3>
            <p className="muted">AI 建议只有经你确认后才会生效。</p>
            <div className="review-decision-actions">
              <button
                className="primary-action"
                type="button"
                onClick={() => void onDecideAdjustment(pendingAdjustment.id, 'accepted')}
              >
                <CheckCircle2 size={16} />
                采纳建议
              </button>
              <button
                className="secondary-action"
                type="button"
                onClick={() => void onDecideAdjustment(pendingAdjustment.id, 'rejected')}
              >
                <ClipboardCheck size={16} />
                保持原计划
              </button>
            </div>
          </section>
        )}

        {!review && latestSettlement && hasApiKey && !generating && (
          <button className="primary-action review-generate-action" type="button" onClick={() => void onGenerate()}>
            <Sparkles size={16} />
            生成 AI 复盘
          </button>
        )}
        {generating && (
          <div className="micro-hint">
            <Loader2 className="spin" size={16} />
            正在生成复盘…
          </div>
        )}

        <div className="review-footer-actions">
          <button className="primary-action" type="button" onClick={() => onGoTo('today')}>
            <Play size={16} />
            开始下一次学习
          </button>
          <button className="secondary-action" type="button" onClick={() => onGoTo('review')}>
            <CalendarClock size={16} />
            查看全部历史
          </button>
        </div>
      </div>

      <aside className="review-side">
        <section className="context-card chart-card">
          <div className="chart-header">
            <h3>最近 7 天</h3>
            <span className="muted">单位：分钟</span>
          </div>
          <div className="mini-bar-chart">
            {last7Days.map((day) => (
              <div className="bar-column" key={day.label}>
                <div className="bar-track">
                  <div className="bar-fill" style={{ height: maxBar ? `${(day.value / maxBar) * 100}%` : '0%' }} />
                </div>
                <span>{day.label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="context-card issue-card">
          <h3>问题与改进</h3>
          <div className="issue-block">
            <strong><AlertTriangle size={16} /> 本次卡点</strong>
            <ul>
              {blockerItems.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </div>
          <div className="issue-block">
            <strong><Lightbulb size={16} /> 下一步建议</strong>
            <ul>
              {suggestionItems.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="context-card review-note-card">
          <h3>复盘笔记</h3>
          <textarea placeholder="记录对今日学习的感受、收获与需要改进的事项…" maxLength={300} />
          <div>
            <span>0 / 300</span>
            <button className="secondary-action" type="button">保存笔记</button>
          </div>
        </section>
      </aside>
    </section>
  );
}


function SettingsView({
  settings,
  runAction,
  onSaved
}: {
  settings: AppSettings;
  runAction: (label: string, action: () => Promise<void>) => Promise<void>;
  onSaved: () => Promise<void>;
}): JSX.Element {
  const [baseUrl, setBaseUrl] = useState(settings.deepseekBaseUrl);
  const [model, setModel] = useState(settings.deepseekModel);
  const [apiKey, setApiKey] = useState('');
  const [blockMinutes, setBlockMinutes] = useState(settings.defaultBlockMinutes);
  const [restReminder, setRestReminder] = useState(true);
  const [autoNextStep, setAutoNextStep] = useState(false);
  const [autoReviewAfterDone, setAutoReviewAfterDone] = useState(true);
  const [showFloat, setShowFloat] = useState(true);
  const [timerAlert, setTimerAlert] = useState(true);
  const [soundAlert, setSoundAlert] = useState(false);

  async function handleSave(): Promise<void> {
    await runAction('保存设置', async () => {
      await window.studyApp.settings.update({
        deepseekBaseUrl: baseUrl,
        deepseekModel: model,
        deepseekApiKey: apiKey,
        defaultBlockMinutes: blockMinutes,
        autoLaunch: settings.autoLaunch,
        dailyStudyWindows: settings.dailyStudyWindows
      });
      setApiKey('');
      await onSaved();
    });
  }

  return (
    <section className="settings-layout">
      <header className="page-title-block">
        <h1>设置</h1>
        <p>管理你的学习偏好、AI 能力与应用行为</p>
      </header>

      <div className="settings-grid">
        <section className="settings-card">
          <div className="settings-card-title">
            <span className="settings-card-icon ai"><Brain size={22} /></span>
            <h3>AI 助手</h3>
          </div>
          <div className="settings-row">
            <span>API Key 状态</span>
            <span className={`status-badge ${settings.hasDeepseekApiKey ? 'success' : ''}`}>{settings.hasDeepseekApiKey ? '已配置' : '未配置'}</span>
          </div>
          <div className="settings-row">
            <span>Provider</span>
            <span className="settings-value">DeepSeek</span>
          </div>
          <div className="settings-row">
            <span>Model</span>
            <span className="settings-value">{model || 'deepseek-chat'}</span>
          </div>
          <label className="settings-field settings-secret-field">
            API Key
            <input
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={settings.hasDeepseekApiKey ? '已加密保存' : '粘贴密钥后保存'}
              type="password"
            />
          </label>
          <label className="settings-field">
            DeepSeek Base URL
            <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
          </label>
          <button className="primary-action full" type="button" onClick={() => void handleSave()}>
            管理 API 配置
          </button>
          <p className="muted">用于遇到问题时的 AI 辅助与复盘建议生成。</p>
        </section>

        <section className="settings-card">
          <div className="settings-card-title">
            <span className="settings-card-icon"><Target size={22} /></span>
            <h3>学习偏好</h3>
          </div>
          <label className="settings-field inline">
            <span>默认专注时长</span>
            <div className="settings-field-control">
              <input
                type="number"
                min={5}
                max={60}
                value={blockMinutes}
                onChange={(event) => setBlockMinutes(Number(event.target.value))}
              />
              <span>分钟</span>
            </div>
          </label>
          <label className="toggle-row">
            <input type="checkbox" checked={restReminder} onChange={(event) => setRestReminder(event.target.checked)} />
            <span>休息提醒</span>
          </label>
          <label className="toggle-row">
            <input type="checkbox" checked={autoNextStep} onChange={(event) => setAutoNextStep(event.target.checked)} />
            <span>自动进入下一步骤</span>
          </label>
          <label className="toggle-row">
            <input type="checkbox" checked={autoReviewAfterDone} onChange={(event) => setAutoReviewAfterDone(event.target.checked)} />
            <span>完成后自动进入复盘</span>
          </label>
        </section>

        <section className="settings-card">
          <div className="settings-card-title">
            <span className="settings-card-icon"><UserRound size={22} /></span>
            <h3>账户与版本</h3>
          </div>
          <div className="settings-row">
            <span>当前身份</span>
            <span className="settings-value">学习者</span>
          </div>
          <div className="settings-row">
            <span>版本</span>
            <span className="settings-value">v1.0.0</span>
          </div>
          <div className="settings-row">
            <span>最近同步</span>
            <span className="settings-value">今天 {new Date().toTimeString().slice(0, 5)}</span>
          </div>
          <button className="secondary-action full" type="button">检查更新</button>
        </section>

        <section className="settings-card">
          <div className="settings-card-title">
            <span className="settings-card-icon"><Bell size={22} /></span>
            <h3>通知与浮窗</h3>
          </div>
          <label className="toggle-row">
            <input type="checkbox" checked={showFloat} onChange={(event) => setShowFloat(event.target.checked)} />
            <span>学习中显示浮窗</span>
          </label>
          <label className="toggle-row">
            <input type="checkbox" checked={timerAlert} onChange={(event) => setTimerAlert(event.target.checked)} />
            <span>计时提醒</span>
          </label>
          <label className="toggle-row">
            <input type="checkbox" checked={soundAlert} onChange={(event) => setSoundAlert(event.target.checked)} />
            <span>声音提示</span>
          </label>
          <button className="text-action" type="button">预览浮窗样式</button>
        </section>

        <section className="settings-card">
          <div className="settings-card-title">
            <span className="settings-card-icon"><Folder size={22} /></span>
            <h3>数据与记录</h3>
          </div>
          <div className="settings-row">
            <span>本地数据存储位置</span>
            <span className="settings-value muted">D:\StudyAssistant\data</span>
          </div>
          <button className="settings-row-button" type="button">
            <span>导出学习记录</span>
            <ChevronRight size={16} />
          </button>
          <button className="settings-row-button" type="button">
            <span>清空缓存</span>
            <span className="settings-value">12.6 MB</span>
            <ChevronRight size={16} />
          </button>
          <button className="settings-row-button" type="button">
            <span>恢复默认设置</span>
            <ChevronRight size={16} />
          </button>
        </section>
      </div>
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
