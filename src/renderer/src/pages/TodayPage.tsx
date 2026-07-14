import { useEffect, useState } from 'react';
import {
  ChevronRight,
  Clock3,
  FileText,
  Lock,
  RotateCcw,
  SendHorizontal,
  Sparkles,
  Wand2
} from 'lucide-react';
import type {
  AppSettings,
  GoalBrief,
  GoalIntakeState,
  HistoryIntakeSummary,
  KnowledgeItem,
  LearningRuntimeSnapshot,
  StudySession,
  TodayGuideState
} from '../../../shared/types';
import { TypingDots } from '../components/ai/TypingDots';
import { HistoryPanel } from '../components/shared/HistoryPanel';
import { GoalBriefEditor } from '../components/today/GoalBriefEditor';
import { deriveLearningTaskStatus } from '../domain/learning-status';

export function OverviewPage({
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
  onGenerateRollingPlan,
  onPrepareCurrentLearningDay,
  onNavigate,
  knowledgeItems
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
  onGenerateRollingPlan: () => Promise<void>;
  onPrepareCurrentLearningDay: () => Promise<void>;
  onNavigate?: (view: 'study' | 'records') => void;
  knowledgeItems: KnowledgeItem[];
}): JSX.Element {
  const [message, setMessage] = useState('');
  const [briefDraft, setBriefDraft] = useState<GoalBrief | null>(null);
  const [intakePending, setIntakePending] = useState(false);
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [historyList, setHistoryList] = useState<HistoryIntakeSummary[]>([]);
  const [historyPending, setHistoryPending] = useState(false);
  const [selectedHistoryIntake, setSelectedHistoryIntake] = useState<GoalIntakeState | null>(null);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);

  const guide = todayGuide?.guide ?? null;
  const roadmap = todayGuide?.roadmap ?? [];
  const goal = todayGuide?.goal ?? onboarding?.activeGoal ?? null;
  const shortPlanDays = todayGuide?.shortPlan ?? [];
  const currentShortPlanDay = shortPlanDays.find((d) => d.id === guide?.shortPlanDayId) ?? null;
  const completedTaskCount = guide?.tasks.filter((t) => t.status === 'done').length ?? 0;
  const totalElapsedMinutes = guide?.tasks.reduce((sum, t) => sum + (t.totalElapsedMinutes || 0), 0) ?? 0;

  useEffect(() => {
    if (onboarding?.intake.brief) {
      setBriefDraft(onboarding.intake.brief);
    }
  }, [onboarding?.intake.id, onboarding?.intake.brief]);

  async function send(text: string): Promise<void> {
    const content = text.trim();
    if (!content) return;
    setMessage('');
    setPendingUserMessage(content);
    setIntakePending(true);
    try {
      await onSendOnboarding(content);
    } finally {
      setPendingUserMessage(null);
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

  const hasApiKey = settings.hasDeepseekApiKey;
  const latestAssistantMessageId = [...(onboarding?.messages ?? [])].reverse().find((item) => item.role === 'assistant')?.id ?? null;

  // 无计划：访谈入口
  if (!guide) {
    return (
      <section className="intake-workspace">
        <div className="intake-main">
          <div className="generation-path" aria-label="输出路径">
            <Sparkles size={18} />
            <span>将生成：</span>
            <strong>长期大纲</strong>
            <ChevronRight size={16} />
            <strong>近期计划</strong>
            <ChevronRight size={16} />
            <strong>今日执行稿</strong>
          </div>

          <section className="surface intake-chat-panel" aria-label="主动访谈">
            <div className="intake-thread redesigned" aria-label="目标访谈记录">
              {(onboarding?.messages ?? []).length === 0 && (
                <div className="intake-message assistant">
                  <span>AI</span>
                  <div className="message-content">你准备学习什么？可以直接说目标、期限、基础和每天可投入时间。</div>
                </div>
              )}
              {(onboarding?.messages ?? []).map((item) => (
                <div className={item.role === 'assistant' ? 'intake-message assistant' : 'intake-message user'} key={item.id}>
                  <span>{item.role === 'assistant' ? 'AI' : '你'}</span>
                  <div className="message-content">{item.content}</div>
                </div>
              ))}
              {pendingUserMessage && (
                <div className="intake-message user">
                  <span>你</span>
                  <div className="message-content">{pendingUserMessage}</div>
                </div>
              )}
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
                <button className="text-action" type="button" disabled={!hasApiKey || intakePending} onClick={() => void send('请使用当前信息生成初步计划。')}>
                  <Wand2 size={16} />
                  使用当前信息生成初步计划
                </button>
                <button className="primary-action" type="button" disabled={!message.trim() || !hasApiKey || intakePending} onClick={() => void send(message)}>
                  <SendHorizontal size={16} />
                  {intakePending ? '等待回复' : '发送'}
                </button>
              </div>
            </div>
          </section>
        </div>

        {(onboarding?.intake.status === 'ready' || goal) && <aside className="context-panel intake-summary-panel">
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
                <strong>目标</strong>
                <span>{briefDraft?.title || goal?.title || '—'}</span>
              </div>
              {briefDraft?.targetOutcome && (
                <div>
                  <strong>期望结果</strong>
                  <span>{briefDraft.targetOutcome}</span>
                </div>
              )}
              {briefDraft?.currentLevel && (
                <div>
                  <strong>当前基础</strong>
                  <span>{briefDraft.currentLevel}</span>
                </div>
              )}
              {briefDraft?.availableTime && (
                <div>
                  <strong>时间与约束</strong>
                  <span>{briefDraft.availableTime}</span>
                </div>
              )}
            </div>
          )}
          {goal && !guide && !(onboarding?.intake.status === 'ready' && briefDraft) && (
            hasApiKey ? (
              <button
                className="primary-action full"
                type="button"
                disabled={!hasApiKey}
                onClick={() => void (todayGuide?.todayState === 'generation_failed'
                  ? onPrepareCurrentLearningDay()
                  : onGenerateLayeredPlan(goal.id))}
              >
                <Sparkles size={16} />
                {todayGuide?.todayState === 'generation_failed'
                  ? '重新生成当前学习单元'
                  : onboarding?.intake.status === 'confirmed'
                    ? '重新生成当日计划'
                    : '确认并生成计划'}
              </button>
            ) : (
              <p className="micro-hint" style={{ margin: '0 0 8px', textAlign: 'center' }}>
                请先在设置页配置 DeepSeek API Key
              </p>
            )
          )}
          <button className="secondary-action full" type="button" style={{ marginTop: 12 }} onClick={() => { void loadHistory(); setShowHistory(true); }}>
            <Clock3 size={16} />
            历史会话
          </button>
        </aside>}

        {showHistory && (
          <HistoryPanel
            list={historyList}
            pending={historyPending}
            selected={selectedHistoryIntake}
            onSelect={(item) => { void loadHistoryIntake(item.intake.id); }}
            onRegenerate={async (item) => {
              if (item.intake.goalId) {
                setShowHistory(false);
                await onGenerateLayeredPlan(item.intake.goalId);
              }
            }}
            onClose={() => { setShowHistory(false); setSelectedHistoryIntake(null); }}
          />
        )}
      </section>
    );
  }

  // 有计划：目标与计划总览
  const currentTask = guide.tasks.find((task) => task.id === learningState?.dailyGuideTask?.id)
    ?? guide.tasks.find((task) => task.status === 'active')
    ?? guide.tasks.find((task) => task.status === 'planned' || task.status === 'deferred')
    ?? guide.tasks[0]
    ?? null;
  const currentLearningStatus = currentTask ? deriveLearningTaskStatus(currentTask, learningState?.latestSubmission ? {
    evaluationStatus: learningState.latestSubmission.evaluationStatus,
    evaluationResult: learningState.latestEvaluation?.result
  } : null) : null;
  const activeStage = roadmap.find((stage) => stage.status === 'active' || stage.status === 'adjusted' || stage.status === 'blocked');
  const statusLabel = (status: string): string => ({ planned: '待开始', active: '进行中', done: '已完成', skipped: '已跳过', deferred: '已暂缓' })[status] ?? status;


  return (
    <section className="today-v2">
      <div className="today-v2-main">
        <header className="overview-goal-header">
          <span className="section-label">当前学习目标</span>
          <h1>{goal?.title ?? guide.todayGoal}</h1>
          {goal?.description && <p>{goal.description}</p>}
        </header>

        {activeStage && <section className="overview-stage"><div><span className="section-label">当前阶段</span><h2>{activeStage.title}</h2><p>{activeStage.objective || activeStage.direction}</p></div><span className={`stage-state ${activeStage.status}`}>{activeStage.status === 'blocked' ? '需要处理' : activeStage.status === 'adjusted' ? '已调整' : '进行中'}</span></section>}

        {roadmap.length > 0 && <section className="overview-path"><h2>学习路径</h2><div>{roadmap.map((stage, index) => <article className={stage.id === activeStage?.id ? 'active' : stage.status === 'completed' ? 'done' : ''} key={stage.id}><span>{index + 1}</span><div><strong>{stage.title}</strong><small>{stage.objective}</small></div></article>)}</div></section>}

        {currentTask ? (
          <section className="current-task-focus" aria-labelledby="current-task-title">
            <div className="current-task-heading">
              <div><span className="section-label">当前主任务</span><h2 id="current-task-title">{currentTask.title}</h2></div>
              <span className={`task-status ${currentTask.status}`}>{currentLearningStatus?.label ?? statusLabel(currentTask.status)} · 约 {currentTask.estimatedMinutes.target} 分钟</span>
            </div>
            <div className="task-focus-reason"><h3>为什么现在做</h3><p>{currentShortPlanDay?.focus || activeStage?.direction || currentTask.objective}</p></div>
            {guide.status === 'draft' && (
              <button className="primary-action" type="button" onClick={() => void onConfirmGuide(guide.id)}>
                确认今日执行稿
              </button>
            )}
            {guide.status !== 'draft' && <button className="primary-action" type="button" onClick={() => onNavigate?.('study')}>{currentLearningStatus?.phase === 'awaiting_result' ? '继续提交' : currentLearningStatus?.phase === 'retry_evaluation' ? '继续评价' : currentLearningStatus?.phase === 'needs_revision' ? '继续修改' : '进入学习'}</button>}
          </section>
        ) : <p className="kb-empty">今日执行稿中暂时没有任务。</p>}

        {todayGuide?.todayState === 'generation_failed' && (
          <section className="overview-pending" role="alert"><div><h2>今日执行稿生成失败</h2><p>已有目标和计划已保留，可以重新生成当前学习单元。</p></div><button className="primary-action" type="button" onClick={() => void onPrepareCurrentLearningDay()}>重试生成</button></section>
        )}

        <details className="overview-manage"><summary>计划管理与目标切换</summary><p>当前计划不合适时，可以归档并重新开始；学习记录会保留。</p><button className="secondary-action danger-outline" type="button" onClick={() => setShowRestartConfirm(true)}><RotateCcw size={16} />重新开始新计划</button></details>
      </div>

      {showHistory && (
        <HistoryPanel
          list={historyList}
          pending={historyPending}
          selected={selectedHistoryIntake}
          onSelect={(item) => { void loadHistoryIntake(item.intake.id); }}
          onRegenerate={async (item) => {
            if (item.intake.goalId) {
              setShowHistory(false);
              await onGenerateLayeredPlan(item.intake.goalId);
            }
          }}
          onClose={() => { setShowHistory(false); setSelectedHistoryIntake(null); }}
        />
      )}
      {showRestartConfirm && (
        <div className="modal-overlay" onClick={() => setShowRestartConfirm(false)}>
          <div className="modal-box restart-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <h3>重新开始新计划？</h3>
            <p>当前今日计划会被归档，学习历史会保留。</p>
            <div className="modal-actions">
              <button className="secondary-action" type="button" onClick={() => setShowRestartConfirm(false)}>取消</button>
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
