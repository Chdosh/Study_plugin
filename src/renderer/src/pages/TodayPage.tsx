import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock3,
  FileText,
  ListChecks,
  Play,
  RotateCcw,
  SendHorizontal,
  Sparkles,
  Target,
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
import { getRoadmapStagePresentation } from '../domain/roadmap-presentation';

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
  const noGuideAction = todayGuide?.todayState === 'stage_review_required'
    ? 'stage_review'
    : todayGuide?.todayState === 'plan_exhausted'
    ? 'rolling_plan'
    : shortPlanDays.length > 0
      ? 'current_unit'
      : 'layered_plan';
  const currentShortPlanDay = shortPlanDays.find((d) => d.id === guide?.shortPlanDayId) ?? null;
  const completedTaskCount = guide?.tasks.filter((t) => t.status === 'done').length ?? 0;

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
                onClick={() => void (noGuideAction === 'stage_review'
                  ? Promise.resolve(onNavigate?.('records'))
                  : noGuideAction === 'current_unit'
                  ? onPrepareCurrentLearningDay()
                  : noGuideAction === 'rolling_plan'
                    ? onGenerateRollingPlan()
                    : onGenerateLayeredPlan(goal.id))}
              >
                <Sparkles size={16} />
                {noGuideAction === 'stage_review'
                  ? '前往记录确认成果'
                  : noGuideAction === 'current_unit'
                  ? todayGuide?.todayState === 'generation_failed'
                    ? '重新生成当前学习单元'
                    : '生成当前学习单元'
                  : noGuideAction === 'rolling_plan'
                    ? '生成下一批任务'
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
  const activeStage = todayGuide?.currentStage ?? null;
  const statusLabel = (status: string): string => ({ planned: '待开始', active: '进行中', done: '已完成', skipped: '已跳过', deferred: '已暂缓' })[status] ?? status;
  const activeStageIndex = activeStage ? roadmap.findIndex((stage) => stage.id === activeStage.id) : -1;
  const actions = currentTask?.actions ?? [];
  const completedActionCount = actions.filter((action) => action.status === 'done' || action.status === 'skipped').length;
  const actionProgressPercent = actions.length > 0 ? Math.round((completedActionCount / actions.length) * 100) : 0;
  const currentAction = actions.find((action) => action.status !== 'done' && action.status !== 'skipped') ?? null;
  const currentActionIndex = currentAction ? actions.findIndex((action) => action.id === currentAction.id) : -1;
  const focusActions = currentActionIndex >= 0
    ? actions.slice(currentActionIndex, currentActionIndex + 3)
    : actions.slice(Math.max(0, actions.length - 3));
  const primaryActionLabel = currentLearningStatus?.phase === 'awaiting_result'
    ? '继续提交'
    : currentLearningStatus?.phase === 'retry_evaluation'
      ? '继续评价'
      : currentLearningStatus?.phase === 'needs_revision'
        ? '继续修改'
        : activeSession?.status === 'paused'
          ? '继续学习'
          : currentTask?.status === 'planned'
            ? '开始学习'
            : '继续学习';


  return (
    <section className="overview-dashboard">
      <header className="overview-dashboard-title">
        <h1>当前学习</h1>
      </header>

      {todayGuide?.stageConflict && <section className="overview-stage-conflict" role="alert"><strong>阶段归属需要确认</strong><p>{todayGuide.stageConflict.message}</p><small>{todayGuide.stageConflict.kind === 'task_day_mismatch'
        ? `任务记录为“${todayGuide.stageConflict.taskStage.title}”，学习单元记录为“${todayGuide.stageConflict.shortPlanDayStage.title}”。`
        : `学习路线记录为“${todayGuide.stageConflict.formalStage.title}”，当前学习单元属于“${todayGuide.stageConflict.learningUnitStage.title}”。`}系统没有静默选择阶段。</small></section>}

      {todayGuide?.todayState === 'generation_failed' && (
        <section className="overview-pending" role="alert"><div><h2>今日执行稿生成失败</h2><p>已有目标和计划已保留，可以重新生成当前学习单元。</p></div><button className="primary-action" type="button" onClick={() => void onPrepareCurrentLearningDay()}>重试生成</button></section>
      )}

      {todayGuide?.todayState === 'stage_review_required' && (
        <section className="overview-pending"><div><h2>当前阶段等待确认</h2><p>阶段成果和历史记录已保留。确认成果后才会进入下一阶段。</p></div><button className="primary-action" type="button" onClick={() => onNavigate?.('records')}>前往记录确认成果</button></section>
      )}

      <div className="overview-dashboard-grid">
        <div className="overview-primary-column">
          <section className="overview-reference-card overview-goal-card" aria-labelledby="overview-goal-title">
            <span className="overview-goal-icon" aria-hidden="true"><Target size={34} /></span>
            <div className="overview-goal-copy">
              <span className="overview-status-label">{activeStage ? '进行中' : '已建立目标'}</span>
              <h2 id="overview-goal-title">{goal?.title ?? guide.todayGoal}</h2>
              <div className="overview-goal-meta">
                {activeStageIndex >= 0 && roadmap.length > 0 && <span>阶段 {activeStageIndex + 1} / {roadmap.length}</span>}
                {activeStage && <span>{activeStage.title}</span>}
                {onboarding?.intake.brief?.availableTime && <span>{onboarding.intake.brief.availableTime}</span>}
              </div>
            </div>
          </section>

          {currentTask ? (
            <section className="overview-reference-card overview-task-card" aria-labelledby="current-task-title">
              <div className="overview-task-topline">
                <span className={`task-status ${currentTask.status}`}>{currentLearningStatus?.label ?? statusLabel(currentTask.status)}</span>
              </div>
              <div className="overview-task-main">
                <div>
                  <span className="section-label">当前任务</span>
                  <h2 id="current-task-title">{currentTask.title}</h2>
                  <p>{currentShortPlanDay?.focus || currentTask.objective}</p>
                </div>
                {guide.status === 'draft' ? (
                  <button className="primary-action overview-task-primary" type="button" onClick={() => void onConfirmGuide(guide.id)}>确认执行稿</button>
                ) : (
                  <button className="primary-action overview-task-primary" type="button" disabled={Boolean(todayGuide?.stageConflict)} onClick={() => onNavigate?.('study')}><Play size={16} />{primaryActionLabel}</button>
                )}
              </div>
              <div className="overview-task-progress" aria-label={`任务进度 ${completedActionCount}/${actions.length} 个行动`}>
                <div><span>任务进度</span><strong>{completedActionCount} / {actions.length} 个行动 · 约 {currentTask.estimatedMinutes.target} 分钟</strong></div>
                <div className="overview-progress-track"><span style={{ width: `${actionProgressPercent}%` }} /></div>
              </div>
              <details className="overview-task-details">
                <summary><ListChecks size={16} />查看任务摘要<ChevronRight size={16} /></summary>
                <div><section><h3>目标与范围</h3><p>{currentTask.objective}</p><p>{currentTask.scope}</p></section><section><h3>预期产出</h3><p>{currentTask.deliverable}</p></section><section><h3>完成标准</h3><ul>{currentTask.doneWhen.map((item) => <li key={item}>{item}</li>)}</ul></section></div>
              </details>
            </section>
          ) : <section className="overview-reference-card overview-empty-task"><strong>当前没有可执行任务</strong><p>计划和历史记录仍然保留，请根据上方状态继续处理。</p></section>}

          <details className="overview-manage overview-reference-card"><summary>计划管理与目标切换</summary><p>当前计划不合适时，可以归档并重新开始；学习记录会保留。</p><button className="secondary-action danger-outline" type="button" onClick={() => setShowRestartConfirm(true)}><RotateCcw size={16} />重新开始新计划</button></details>
        </div>

        <aside className="overview-side-column">
          {roadmap.length > 0 && <section className="overview-reference-card overview-route-card" aria-labelledby="learning-path-title"><header><h2 id="learning-path-title">学习路径</h2><span>当前单元 {completedTaskCount} / {guide.tasks.length} 个任务完成</span></header><div className="overview-route-steps">{roadmap.map((stage, index) => {
            const presentation = getRoadmapStagePresentation(stage, activeStage?.id ?? null);
            return <article className={presentation.className} key={stage.id} aria-current={presentation.isCurrentLearningUnit ? 'step' : undefined}><span>{stage.status === 'completed' ? <CheckCircle2 size={15} /> : index + 1}</span><strong>{stage.title}</strong><small>{presentation.label}</small></article>;
          })}</div></section>}

          <section className="overview-reference-card overview-focus-card" aria-labelledby="today-focus-title">
            <header><h2 id="today-focus-title">今日聚焦</h2></header>
            <div className="overview-focus-list">
              {focusActions.length > 0 ? focusActions.map((action) => {
                const isCurrent = action.id === currentAction?.id;
                const isDone = action.status === 'done';
                return <div className={isCurrent ? 'current' : isDone ? 'done' : ''} key={action.id}>{isDone ? <CheckCircle2 size={18} /> : isCurrent ? <Target size={18} /> : <Circle size={18} />}<span>{action.title}</span><small>{isDone ? '已完成' : action.status === 'skipped' ? '已跳过' : isCurrent ? '当前' : '待进行'}</small></div>;
              }) : <p>当前任务暂时没有行动步骤。</p>}
            </div>
          </section>

        </aside>
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
