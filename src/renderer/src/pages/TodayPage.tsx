import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileText,
  Lightbulb,
  ListChecks,
  Loader2,
  Play,
  RotateCcw,
  SendHorizontal,
  Settings,
  Sparkles,
  Target,
  Trophy,
  UserRound,
  Wand2
} from 'lucide-react';
import type {
  AppSettings,
  GoalBrief,
  GoalIntakeState,
  HistoryIntakeSummary,
  LearningRuntimeSnapshot,
  StudySession,
  TodayGuideState
} from '../../../shared/types';
import { MessageContent } from '../components/ai/MessageContent';
import { TypingDots } from '../components/ai/TypingDots';
import { TopBar } from '../components/layout/TopBar';
import { HistoryPanel } from '../components/shared/HistoryPanel';
import { GoalBriefEditor } from '../components/today/GoalBriefEditor';
import { getCurrentGuideTaskSelection } from '../domain/guide-selection';
import { getSessionElapsedSeconds } from '../float-behavior';
import type { ViewKey } from '../types/navigation';

const todayIso = new Date().toISOString().slice(0, 10);

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatMinutes(totalMinutes: number): string {
  if (totalMinutes < 60) return totalMinutes + '分钟';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? hours + '小时' + minutes + '分钟' : hours + '小时';
}

export function TodayPage({
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
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const guide = todayGuide?.guide ?? null;
  const goal = todayGuide?.goal ?? onboarding?.activeGoal ?? null;
  const currentSelection = guide ? getCurrentGuideTaskSelection(guide.tasks, activeSession, learningState) : null;
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

  const guideTasks = guide.tasks;
  const completedCount = guideTasks.filter((task) => task.status === 'done').length;
  const totalCount = guideTasks.length;
  const totalMinutes = guideTasks.reduce((sum, task) => sum + task.estimatedMinutes.target, 0);
  const progressPercent = totalCount > 0 ? clampPercent((completedCount / totalCount) * 100) : 0;
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
    currentTask?.title ?? '当前任务'
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

        <div className="context-card restart-plan-card">
          <h3>计划管理</h3>
          <p>当前计划不合适时，可以归档今天的计划，重新和 AI 确认目标并生成一版新计划。</p>
          <button className="secondary-action danger-outline full" type="button" onClick={() => setShowRestartConfirm(true)}>
            <RotateCcw size={16} />
            重新开始新计划
          </button>
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
      {showRestartConfirm && (
        <div className="modal-overlay" onClick={() => setShowRestartConfirm(false)}>
          <div className="modal-box restart-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <AlertTriangle size={28} />
            <h3>重新开始新计划？</h3>
            <p>当前今日计划会被归档，学习历史会保留。正在进行的学习会先暂停，然后回到目标访谈入口。</p>
            <div className="modal-actions">
              <button className="secondary-action" type="button" onClick={() => setShowRestartConfirm(false)}>
                取消
              </button>
              <button
                className="secondary-action danger-outline"
                type="button"
                onClick={async () => {
                  setShowRestartConfirm(false);
                  await onArchiveTodayAndRestart();
                }}
              >
                <RotateCcw size={16} />
                确认重新开始
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}


