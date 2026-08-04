import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ChevronRight,
  Circle,
  History,
  ListChecks,
  Minus,
  Play,
  RotateCcw,
  SendHorizontal,
  Sparkles,
  Wand2
} from 'lucide-react';
import type {
  AppSettings,
  DailyGuideAction,
  DailyGuideTask,
  GoalIntakeState,
  GoalProgressStatus,
  KnowledgeItem,
  LearningGoal,
  LearningRuntimeSnapshot,
  QuestionAnswerResult,
  RoadmapStage,
  StudySession,
  LearningOverviewState
} from '../../../shared/types';
import { hasCompleteAiConfiguration } from '../../../shared/types';
import { DEFAULT_AI_REQUEST_TIMEOUT_MS } from '../../../shared/ai-request';
import { TypingDots } from '../components/ai/TypingDots';
import { PendingAgentQuestion } from '../components/ai/PendingAgentQuestion';
import { GoalIntakeQuestionForm } from '../components/ai/GoalIntakeQuestionForm';
import { MessageContent } from '../components/ai/MessageContent';
import { deriveLearningTaskStatus } from '../domain/learning-status';
import { getRoadmapStagePresentation } from '../domain/roadmap-presentation';
import type { StudyViewTarget } from '../types/navigation';

function GoalContextLine({
  goalTitle,
  stageTitle,
  contextLabel,
  status,
  statusClass
}: {
  goalTitle: string;
  stageTitle: string | null;
  contextLabel?: string;
  status: string;
  statusClass: string;
}): JSX.Element {
  return (
    <div className="overview-task-topline">
      <nav className="overview-goal-reference" aria-label="当前学习位置">
        <span>{goalTitle}</span>
        {stageTitle && <><i aria-hidden="true">/</i><span>{stageTitle}</span></>}
        {contextLabel && <><i aria-hidden="true">/</i><strong>{contextLabel}</strong></>}
      </nav>
      <span className={`task-status ${statusClass}`}>{status}</span>
    </div>
  );
}

function TaskActionList({
  actions,
  taskId,
  currentTaskEntryLabel,
  onOpen
}: {
  actions: DailyGuideAction[];
  taskId: string;
  currentTaskEntryLabel?: string | null;
  onOpen: (target: StudyViewTarget) => void;
}): JSX.Element | null {
  if (actions.length === 0 && !currentTaskEntryLabel) return null;
  const currentActionId = actions.find((action) => action.status === 'planned')?.id ?? null;
  return (
    <ul className="overview-action-list" aria-label="当前任务行动">
      {actions.map((action) => {
        const isDone = action.status === 'done';
        const isSkipped = action.status === 'skipped';
        const isCurrent = action.id === currentActionId;
        const className = isDone ? 'done' : isSkipped ? 'skipped' : isCurrent ? 'current' : 'planned';
        const content = (
          <>
            <span className="overview-action-marker" aria-hidden="true">
              {isDone ? <CheckCircle2 size={18} /> : isSkipped ? <Minus size={18} /> : <Circle size={18} />}
            </span>
            <span className="overview-action-title">{action.title}</span>
            <small>{isDone ? '已完成' : isSkipped ? '已跳过' : isCurrent ? '当前' : '待进行'}</small>
          </>
        );
        return (
          <li className={className} key={action.id}>
            {isDone || isSkipped ? (
              <button
                className="overview-action-entry"
                type="button"
                onClick={() => onOpen({ kind: 'review', taskId, actionId: action.id })}
                aria-label={`查看${isSkipped ? '已跳过' : '已完成'}步骤：${action.title}`}
              >
                {content}
              </button>
            ) : isCurrent ? (
              <button
                className="overview-action-entry"
                type="button"
                onClick={() => onOpen({ kind: 'current' })}
                aria-label={`进入当前步骤：${action.title}`}
              >
                {content}
              </button>
            ) : (
              <div className="overview-action-entry" aria-disabled="true">
                {content}
              </div>
            )}
          </li>
        );
      })}
      {!currentActionId && currentTaskEntryLabel && (
        <li className="current">
          <button
            className="overview-action-entry"
            type="button"
            onClick={() => onOpen({ kind: 'current' })}
            aria-label={currentTaskEntryLabel}
          >
            <span className="overview-action-marker" aria-hidden="true"><Circle size={18} /></span>
            <span className="overview-action-title">{currentTaskEntryLabel}</span>
            <small>当前</small>
          </button>
        </li>
      )}
    </ul>
  );
}

function LearningPathSidebar({
  stages,
  currentStageId,
  currentTaskId,
  tasks,
  direction,
  goalProgressStatus
}: {
  stages: RoadmapStage[];
  currentStageId: string | null;
  currentTaskId: string | null;
  tasks: DailyGuideTask[];
  direction?: string;
  goalProgressStatus?: GoalProgressStatus;
}): JSX.Element | null {
  if (stages.length === 0) return null;
  return (
    <section className="overview-reference-card overview-route-card" aria-labelledby="learning-path-title">
      <header>
        <h2 id="learning-path-title">学习路径</h2>
      </header>
      {((goalProgressStatus && goalProgressStatus !== 'on_schedule') || direction) && (
        <div className="overview-route-summary">
          {goalProgressStatus && goalProgressStatus !== 'on_schedule' && (
            <span className={`goal-progress-chip ${goalProgressStatus}`}>
              {goalProgressLabel(goalProgressStatus)}
            </span>
          )}
          {direction && <p className="overview-route-direction">{direction}</p>}
        </div>
      )}
      <div className="overview-route-steps">
        {stages.map((stage) => {
          const index = stages.findIndex((item) => item.id === stage.id);
          const presentation = getRoadmapStagePresentation(stage, currentStageId);
          const stageTasks = tasks.filter((task) => {
            const isCurrentTask = task.id === currentTaskId || task.status === 'active';
            const belongsToStage = task.roadmapStageId === stage.id
              || (isCurrentTask && stage.id === currentStageId);
            return belongsToStage
            && (
              task.status === 'closed'
              || isCurrentTask
            );
          });
          return (
            <article className={presentation.className} key={stage.id} aria-current={presentation.isCurrentLearningUnit ? 'step' : undefined}>
              <span className="overview-route-marker">{index + 1}</span>
              <div>
                <strong>{stage.title}</strong>
                {stageTasks.length > 0 && (
                  <ul className="overview-route-items">
                    {stageTasks.map((task) => {
                      const isCurrentTask = task.id === currentTaskId || task.status === 'active';
                      const className = task.status === 'closed'
                        ? 'completed'
                        : isCurrentTask ? 'active current' : task.status;
                      return (
                        <li key={task.id} className={className}>
                          <span>学习单元 · {task.title}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function goalProgressLabel(status: GoalProgressStatus): string {
  const labels: Record<GoalProgressStatus, string> = {
    schedule_unset: '未设期限',
    on_schedule: '进度正常',
    checkpoint_missed: '错过检查点',
    goal_due: '目标到期',
    completed: '目标已完成'
  };
  return labels[status];
}

const GENERATION_SLOW_SECONDS = 60;
const GENERATION_NEAR_TIMEOUT_SECONDS = Math.floor(DEFAULT_AI_REQUEST_TIMEOUT_MS / 1000 * 2 / 3);

export function pendingGenerationLabel(
  planGenerating: boolean,
  elapsedSeconds: number,
  planPhase?: string | null
): string {
  if (planGenerating) {
    const base = planPhase ?? '正在生成完整学习计划';
    return elapsedSeconds < GENERATION_SLOW_SECONDS
      ? `${base}…约需 1 分钟`
      : `${base}，已等待 ${elapsedSeconds} 秒，接近完成`;
  }
  if (elapsedSeconds < 30) {
    return 'AI 正在生成回答';
  }
  if (elapsedSeconds < GENERATION_NEAR_TIMEOUT_SECONDS) {
    return `AI 正在生成回答（已等待 ${elapsedSeconds} 秒，仍在生成）`;
  }
  return `AI 响应较慢，已等待 ${elapsedSeconds} 秒；超时后会自动提示失败原因，可稍后重试`;
}

function PlanManagement({
  canViewHistory,
  onViewHistory,
  onRestart
}: {
  canViewHistory: boolean;
  onViewHistory: () => void;
  onRestart: () => void;
}): JSX.Element {
  return (
    <details className="overview-manage overview-reference-card">
      <summary>
        <span>计划与历史</span>
        <ChevronRight size={16} />
      </summary>
      <div className="overview-manage-content">
        <p>可在记录中查看已归档目标与计划，并显式恢复需要继续的学习任务；当前学习记录不会被覆盖。</p>
        <div className="overview-manage-actions">
          <button className="secondary-action" type="button" disabled={!canViewHistory} onClick={onViewHistory}>
            <History size={16} />
            查看与恢复历史计划
          </button>
          <button className="secondary-action danger-outline" type="button" onClick={onRestart}>
            <RotateCcw size={16} />
            重新开始新计划
          </button>
        </div>
      </div>
    </details>
  );
}

export function OverviewPage({
  settings,
  onboarding,
  todayGuide,
  activeSession,
  learningState,
  onSendOnboarding,
  onGenerateInitialPlan,
  onboardingOperationPending,
  planGenerating,
  temporaryLearning,
  onAskTemporaryQuestion,
  onLinkTemporaryQuestionToGoal,
  onKeepTemporaryQuestion,
  onConvertTemporaryQuestionToTask,
  availableGoals,
  onCancelPendingQuestion,
  onConfirmGuide,
  onArchiveTodayAndRestart,
  onPrepareCurrentLearningDay,
  onNavigate,
  onOpenStudyTarget,
  knowledgeItems
}: {
  settings: AppSettings;
  onboarding: GoalIntakeState | null;
  todayGuide: LearningOverviewState | null;
  activeSession: StudySession | null;
  learningState: LearningRuntimeSnapshot | null;
onSendOnboarding: (content: string) => Promise<void>;
  onGenerateInitialPlan: () => Promise<void>;
  onboardingOperationPending: boolean;
  planGenerating: boolean;
  temporaryLearning: QuestionAnswerResult | null;
  onAskTemporaryQuestion: (question: string, threadId?: string) => Promise<void>;
  onLinkTemporaryQuestionToGoal: (threadId: string, goalId: string) => Promise<void>;
  onKeepTemporaryQuestion: (threadId: string) => Promise<void>;
  onConvertTemporaryQuestionToTask: (threadId: string, goalId: string) => Promise<void>;
  availableGoals: LearningGoal[];
  onCancelPendingQuestion: () => Promise<void>;
  onConfirmGuide: (guideId: string) => Promise<void>;
  onArchiveTodayAndRestart: () => Promise<void>;
  onPrepareCurrentLearningDay: () => Promise<void>;
  onNavigate?: (view: 'study' | 'records') => void;
  onOpenStudyTarget: (target: StudyViewTarget) => void;
  knowledgeItems: KnowledgeItem[];
}): JSX.Element {
  const [message, setMessage] = useState('');
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(null);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const [temporaryMessage, setTemporaryMessage] = useState('');
  const [temporaryGoalId, setTemporaryGoalId] = useState('');
  const [pendingElapsedSeconds, setPendingElapsedSeconds] = useState(0);

  const guide = todayGuide?.guide ?? null;
  const roadmap = todayGuide?.roadmap ?? [];
  const goal = todayGuide?.goal ?? onboarding?.activeGoal ?? null;
  const nearTermPlanItems = todayGuide?.shortPlan ?? [];
  const intakePending = onboardingOperationPending || planGenerating;
  useEffect(() => {
    if (!intakePending) {
      setPendingElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    setPendingElapsedSeconds(0);
    const timer = window.setInterval(() => {
      setPendingElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [intakePending]);
  useEffect(() => {
    setTemporaryGoalId((current) =>
      current
      || temporaryLearning?.thread.goalId
      || goal?.id
      || availableGoals.find((item) => item.status === 'active')?.id
      || ''
    );
  }, [availableGoals, goal?.id, temporaryLearning?.thread.goalId]);
  const currentNearTermPlanItem = nearTermPlanItems.find((item) => item.id === guide?.nearTermPlanItemId) ?? null;
  async function send(text: string): Promise<void> {
    const content = text.trim();
    if (!content) return;
    setMessage('');
    setPendingUserMessage(content);
    try {
      await onSendOnboarding(content);
    } finally {
      setPendingUserMessage(null);
    }
  }

  const hasAiConfiguration = hasCompleteAiConfiguration(settings);
  const hasConfirmedGoalWithoutGuide = onboarding?.intake.status === 'confirmed'
    && Boolean(onboarding.intake.goalId);
  const canGenerateInitialPlan = onboarding?.intake.status === 'ready'
    || hasConfirmedGoalWithoutGuide;
  const showQuestionForm = onboarding?.intake.status === 'collecting'
    && (onboarding.intake.questions?.length ?? 0) > 0
    && !intakePending;
  const [showIntakeHistory, setShowIntakeHistory] = useState(false);
const latestAssistantMessageId = [...(onboarding?.messages ?? [])].reverse().find((item) => item.role === 'assistant')?.id ?? null;

  const renderIntakeChat = (detailed: boolean): JSX.Element => (
    <>
      <div className="intake-thread" aria-label="目标访谈记录">
        {(onboarding?.messages ?? []).length === 0 && (
          <div className="intake-message assistant">
            <span className="intake-message-meta">学习管家</span>
            <div className="message-content">你准备学习什么？可以直接说目标、期限、基础和通常可投入的时间。</div>
          </div>
        )}
        {(onboarding?.messages ?? []).map((item) => (
          <div className={item.role === 'assistant' ? 'intake-message assistant' : 'intake-message user'} key={item.id}>
            <span className="intake-message-meta">{item.role === 'assistant' ? '学习管家' : '你'}</span>
            <div className="message-content">{item.content}</div>
          </div>
        ))}
        {pendingUserMessage && (
          <div className="intake-message user">
            <span className="intake-message-meta">你</span>
            <div className="message-content">{pendingUserMessage}</div>
          </div>
        )}
        {showQuestionForm && (
          <div className="intake-message assistant">
            <span className="intake-message-meta">学习管家</span>
            <div className="message-content">根据你的描述，我还想确认下面几点，以便更精准地制定计划（可直接填写，一次全部回答）：</div>
            <GoalIntakeQuestionForm
              questions={onboarding!.intake.questions}
              disabled={!hasAiConfiguration}
              onSubmit={(composed) => void send(composed)}
            />
          </div>
        )}
        {onboarding?.pendingInteraction?.status === 'open' && !intakePending && (
          <div className="intake-message assistant">
            <span className="intake-message-meta">学习管家</span>
            <PendingAgentQuestion
              interaction={onboarding.pendingInteraction}
              onCancel={() => void onCancelPendingQuestion()}
              onAnswer={(text) => void send(text)}
            />
          </div>
        )}
        {intakePending && (
          <div className="intake-message assistant pending" aria-live="polite">
            <span className="intake-message-meta">学习管家</span>
            <div className="message-content">
              <strong>{pendingGenerationLabel(planGenerating, pendingElapsedSeconds, todayGuide?.planPhase)}</strong>
              <TypingDots />
            </div>
          </div>
        )}
      </div>

      {onboarding?.intake.status === 'ready'
        && onboarding.intake.brief
        && !intakePending
        && (
          <div className="summary-card">
            <div className="summary-card-head">
              <div>
                <span className="summary-eyebrow">目标已确认</span>
                <h3>{onboarding.intake.brief.title}</h3>
              </div>
              {onboarding.intake.brief.depth && (
                <span className="badge">{onboarding.intake.brief.depth}</span>
              )}
            </div>
            {onboarding.intake.brief.direction && (
              <div className="summary-direction">
                <span>学习方向</span>
                <p>{onboarding.intake.brief.direction}</p>
              </div>
            )}
            <div className="summary-fields">
              <div className="summary-field">
                <span>预期成果</span>
                <strong>{onboarding.intake.brief.targetOutcome}</strong>
              </div>
              <div className="summary-field">
                <span>当前基础</span>
                <strong>{onboarding.intake.brief.currentLevel}</strong>
              </div>
              <div className="summary-field">
                <span>时间投入</span>
                <strong>{onboarding.intake.brief.availableTime}</strong>
              </div>
              <div className="summary-field">
                <span>达成限期</span>
                <strong>{onboarding.intake.brief.deadline || '未明确'}</strong>
              </div>
            </div>
            <div className="summary-actions">
              <button className="primary-action" type="button" disabled={!hasAiConfiguration} onClick={() => void onGenerateInitialPlan()}>
                <Wand2 size={16} />
                确认并生成计划
              </button>
            </div>
          </div>
        )}

      {onboarding?.intake.status === 'ready'
        && !onboarding.intake.brief
        && !intakePending
        && (
          <p className="intake-incomplete-note">目标信息还不完整，请补充你想达到的具体结果（例如能独立完成什么），然后继续。</p>
        )}

      {onboarding?.intake.status === 'confirmed'
        && Boolean(onboarding.intake.goalId)
        && !intakePending
        && (
          <div className="summary-card">
            <div className="summary-card-head">
              <div>
                <span className="summary-eyebrow">目标已确认</span>
                <h3>{onboarding.intake.brief?.title ?? '学习目标'}</h3>
              </div>
              {onboarding.intake.brief?.depth && (
                <span className="badge">{onboarding.intake.brief.depth}</span>
              )}
            </div>
            {onboarding.intake.brief?.direction && (
              <div className="summary-direction">
                <span>学习方向</span>
                <p>{onboarding.intake.brief.direction}</p>
              </div>
            )}
            <p className="summary-confirm-note">目标与方向已确认，生成完整学习计划约需 1 分钟，包含长期大纲、近期安排与首日学习任务。</p>
            <div className="summary-actions">
              <button className="primary-action" type="button" disabled={!hasAiConfiguration} onClick={() => void onGenerateInitialPlan()}>
                <Wand2 size={16} />
                生成完整学习计划
              </button>
              <button className="secondary-action" type="button" disabled={!hasAiConfiguration} onClick={() => void send('请使用当前信息生成初步计划。')}>
                使用当前信息生成完整计划
              </button>
            </div>
          </div>
        )}

      {!showQuestionForm && (
        <div className="intake-input-dock">
          <div className="intake-input-box">
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="输入你的回答，或补充更多信息..."
              aria-label="输入学习目标"
              disabled={intakePending}
            />
            <button className="primary-action" type="button" disabled={!message.trim() || !hasAiConfiguration || intakePending} onClick={() => void send(message)}>
              <SendHorizontal size={16} />
              {intakePending ? '等待回复' : '发送'}
            </button>
          </div>
          {detailed && !intakePending && (
            <button className="text-action intake-temporary-trigger" type="button" disabled={!message.trim() || !hasAiConfiguration} onClick={() => {
              const question = message.trim();
              setMessage('');
              void onAskTemporaryQuestion(question);
            }}>
              <Sparkles size={16} />
              临时学习这个问题
            </button>
          )}
        </div>
      )}
    </>
  );

  if (!guide && goal && todayGuide) {
    const preparationState = todayGuide.preparationState;
    const activeStage = todayGuide.currentStage
      ?? roadmap.find((stage) => stage.status === 'active' || stage.status === 'ready_for_review')
      ?? null;
    const nextPlanItem = nearTermPlanItems.find((item) => item.sessionStatus === 'active')
      ?? nearTermPlanItems.find((item) => item.sessionStatus === 'pending')
      ?? null;
    const canPrepare = preparationState === 'ready_to_generate'
      || preparationState === 'generation_failed'
      || preparationState === 'completed';
    const needsRecords = preparationState === 'stage_review_required'
      || preparationState === 'plan_exhausted';
    if (planGenerating) {
      return (
        <section className="overview-dashboard">
          <section className="overview-reference-card overview-task-card">
            <GoalContextLine
              goalTitle={goal.title}
              stageTitle={activeStage?.title ?? null}
              contextLabel="生成学习计划"
              status="生成中"
              statusClass="active"
            />
            <div className="overview-task-main">
              <div>
                <span className="section-label">正在生成完整学习计划</span>
                <h2>{todayGuide.planPhase ?? '正在规划学习计划'}</h2>
                <p>{pendingGenerationLabel(true, pendingElapsedSeconds, todayGuide.planPhase)}</p>
              </div>
            </div>
          </section>
        </section>
      );
    }
    return (
      <section className="overview-dashboard">
        {preparationState === 'generation_failed' && (
          <section className="overview-pending" role="alert">
            <div>
              <h2>当前执行稿生成失败</h2>
              <p>{todayGuide.errorMessage ?? '生成过程中发生未知错误。'} 目标和近期计划均已保留。</p>
            </div>
          </section>
        )}

        <div className="overview-dashboard-grid">
          <div className="overview-primary-column">
            <section className="overview-reference-card overview-task-card" aria-labelledby="next-unit-title">
              <GoalContextLine
                goalTitle={goal.title}
                stageTitle={activeStage?.title ?? null}
                contextLabel="近期安排"
                status="下一步"
                statusClass="planned"
              />
              <div className="overview-task-main">
                <div>
                  <span className="section-label">近期学习单元</span>
                  <h2 id="next-unit-title">{nextPlanItem?.title ?? '准备后续学习安排'}</h2>
                  <p>{nextPlanItem?.focus ?? (
                    needsRecords
                      ? '当前阶段需要先处理复盘或后续计划。'
                      : '目标和学习路径已保留，可以继续生成当前学习单元。'
                  )}</p>
                </div>
                {canPrepare && (
                  <button className="primary-action overview-task-primary" type="button" onClick={() => void onPrepareCurrentLearningDay()}>
                    <Wand2 size={16} />
                    生成当前学习单元
                  </button>
                )}
                {preparationState === 'generating' && (
                  <button className="primary-action overview-task-primary" type="button" disabled>
                    正在生成当前学习单元…
                  </button>
                )}
                {needsRecords && (
                  <button className="primary-action overview-task-primary" type="button" onClick={() => onNavigate?.('records')}>
                    前往记录处理
                  </button>
                )}
              </div>
            </section>

            <PlanManagement
              canViewHistory={Boolean(onNavigate)}
              onViewHistory={() => onNavigate?.('records')}
              onRestart={() => setShowRestartConfirm(true)}
            />
          </div>

          <aside className="overview-side-column">
            <LearningPathSidebar
              stages={roadmap}
              currentStageId={activeStage?.id ?? null}
              currentTaskId={learningState?.dailyGuideTask?.id ?? null}
              tasks={[]}
              direction={onboarding?.intake.brief?.direction}
              goalProgressStatus={todayGuide.goalProgress.status}
            />
          </aside>
        </div>

        {(onboarding?.messages?.length ?? 0) > 0 && (
          <section className="surface intake-chat-panel" aria-label="目标访谈记录">
            <div className="current-step-heading">
              <div>
                <span className="focus-eyebrow">目标访谈</span>
                <h2>访谈记录</h2>
              </div>
              <span className="micro-hint">历史对话仍保留，可继续补充信息。</span>
            </div>
            {showIntakeHistory ? (
              <>
                {renderIntakeChat(false)}
                <div className="intake-history-collapsed">
                  <div><History size={16} /><span>访谈记录已展开</span></div>
                  <button type="button" onClick={() => setShowIntakeHistory(false)}>收起对话</button>
                </div>
              </>
            ) : (
              <div className="intake-history-collapsed">
                <div><History size={16} /><span>访谈记录已收纳</span></div>
                <button type="button" onClick={() => setShowIntakeHistory(true)}>查看历史对话</button>
              </div>
            )}
          </section>
        )}

        {showRestartConfirm && (
          <div className="modal-overlay" onClick={() => setShowRestartConfirm(false)}>
            <div className="modal-box restart-confirm-modal" onClick={(event) => event.stopPropagation()}>
              <h3>重新开始新计划？</h3>
              <p>当前计划会被归档，学习历史会保留。</p>
              <div className="modal-actions">
                <button className="secondary-action" type="button" onClick={() => setShowRestartConfirm(false)}>取消</button>
                <button className="secondary-action danger-outline" type="button" onClick={async () => {
                  setShowRestartConfirm(false);
                  await onArchiveTodayAndRestart();
                }}><RotateCcw size={16} />确认重新开始</button>
              </div>
            </div>
          </div>
        )}
      </section>
    );
  }

  // 无计划：访谈入口
  if (!guide) {
    return (
      <section className="intake-workspace">
        <div className="intake-main">
<section className="surface intake-chat-panel" aria-label="主动访谈">
            {renderIntakeChat(true)}
          </section>
          {temporaryLearning && (
            <section className="surface intake-chat-panel" aria-label="临时学习记录">
              <div className="current-step-heading">
                <div>
                  <span className="focus-eyebrow">临时学习</span>
                  <h2>{temporaryLearning.thread.question}</h2>
                </div>
                <span className="micro-hint">
                  {temporaryLearning.thread.status === 'open' ? '可继续原对话，或显式选择收口方式。' : '此临时学习已收口。'}
                </span>
              </div>
              <div className="intake-thread redesigned">
                {temporaryLearning.messages.map((item) => (
                  <div className={item.role === 'assistant' ? 'intake-message assistant' : 'intake-message user'} key={item.id}>
                    <span className="intake-message-meta">{item.role === 'assistant' ? '学习管家' : '你的输入'}</span>
                    <div className="message-content"><MessageContent content={item.content} /></div>
                  </div>
                ))}
              </div>
              {temporaryLearning.thread.status === 'open' && (
                <>
                  <div className="submission-composer">
                    <label htmlFor="temporary-follow-up">继续这段临时学习</label>
                    <textarea
                      id="temporary-follow-up"
                      value={temporaryMessage}
                      onChange={(event) => setTemporaryMessage(event.target.value)}
                      placeholder="继续追问会写入同一个 Thread"
                    />
                    <button
                      className="primary-action"
                      type="button"
                      disabled={!temporaryMessage.trim()}
                      onClick={() => {
                        const question = temporaryMessage.trim();
                        if (!question) return;
                        void onAskTemporaryQuestion(
                          question,
                          temporaryLearning.thread.id
                        ).then(() => setTemporaryMessage(''));
                      }}
                    >
                      继续对话
                    </button>
                  </div>
                  <div className="temporary-disposition">
                    <select
                      aria-label="临时学习对应 Goal"
                      value={temporaryGoalId}
                      onChange={(event) => setTemporaryGoalId(event.target.value)}
                    >
                      <option value="">选择已有 Goal</option>
                      {availableGoals.map((item) => (
                        <option key={item.id} value={item.id}>{item.title}</option>
                      ))}
                    </select>
                    <button
                      className="secondary-action"
                      type="button"
                      onClick={() => void onKeepTemporaryQuestion(temporaryLearning.thread.id)}
                    >
                      仅保留记录
                    </button>
                    <button
                      className="secondary-action"
                      type="button"
                      disabled={!temporaryGoalId}
                      onClick={() => void onLinkTemporaryQuestionToGoal(
                        temporaryLearning.thread.id,
                        temporaryGoalId
                      )}
                    >
                      关联已有 Goal
                    </button>
                    <button
                      className="secondary-action"
                      type="button"
                      disabled={!temporaryGoalId}
                      onClick={() => void onConvertTemporaryQuestionToTask(
                        temporaryLearning.thread.id,
                        temporaryGoalId
                      )}
                    >
                      转成正式 Task
                    </button>
                  </div>
                  <p className="micro-hint">
                    不会自动创建 Goal 或调整 Roadmap。转成 Task 时优先加入对应 Goal 的当前 Guide，否则保存为未安排 Task。
                  </p>
                </>
              )}
            </section>
          )}
        </div>

      </section>
    );
  }

  // 有计划：目标与计划总览
  const currentTask = guide.tasks.find((task) => task.id === learningState?.dailyGuideTask?.id)
    ?? guide.tasks.find((task) => task.status === 'active')
    ?? guide.tasks.find((task) => task.status === 'planned' || task.status === 'deferred')
    ?? guide.tasks[0]
    ?? null;
  const currentLearningStatus = currentTask ? deriveLearningTaskStatus(currentTask) : null;
  const activeStage = todayGuide?.currentStage ?? null;
  const goalProgress = todayGuide?.goalProgress ?? null;
  const actions = currentTask?.actions ?? [];
  const completedActionCount = actions.filter((action) => action.status === 'done' || action.status === 'skipped').length;
  const currentTaskEntryLabel = currentLearningStatus?.phase === 'awaiting_result'
    ? '提交学习成果'
    : actions.length === 0 && currentLearningStatus?.phase !== 'done'
      ? '进入当前任务'
      : null;
  return (
    <section className="overview-dashboard">
      {goalProgress?.status === 'checkpoint_missed' && (
        <section className="overview-stage-conflict" role="status">
          <strong>阶段检查点已过</strong>
          <p>“{goalProgress.currentStageTitle}”尚未确认达到阶段标准，原学习位置和记录均已保留。</p>
          <small>阶段检查点：{goalProgress.currentStageTargetDate}。继续当前任务，或前往记录查看证据后再决定是否调整计划。</small>
        </section>
      )}

      {goalProgress?.status === 'goal_due' && (
        <section className="overview-stage-conflict" role="alert">
          <strong>目标截止日期已到</strong>
          <p>当前 Goal 的成功标准尚未全部确认，系统没有自动关闭或重建计划。</p>
          <small>截止日期：{goalProgress.dueDate}。请结合记录决定继续原目标、调整范围或重新确认期限。</small>
        </section>
      )}

      {todayGuide?.preparationState === 'generation_failed' && (
        <section className="overview-pending" role="alert"><div><h2>当前执行稿生成失败</h2><p>{todayGuide.errorMessage ?? '生成过程中发生未知错误。'} 已有目标和近期计划均已保留，可以直接重试。</p></div><button className="primary-action" type="button" onClick={() => void onPrepareCurrentLearningDay()}>重试生成</button></section>
      )}

      {todayGuide?.preparationState === 'stage_review_required' && (
        <section className="overview-pending"><div><h2>当前阶段等待确认</h2><p>阶段成果和历史记录已保留。确认成果后才会进入下一阶段。</p></div><button className="primary-action" type="button" onClick={() => onNavigate?.('records')}>前往记录确认成果</button></section>
      )}

      <div className="overview-dashboard-grid">
        <div className="overview-primary-column">
          {currentTask ? (
            <section className="overview-reference-card overview-task-card" aria-label="当前任务">
              <div className="overview-task-heading">
                <h2>{currentTask.title}</h2>
              </div>
              <p className="overview-task-objective">{currentNearTermPlanItem?.focus || currentTask.objective}</p>
              {(actions.length > 0 || currentTaskEntryLabel) && (
                <div className="overview-actions-block">
                  <div className="overview-actions-header">
                    <strong>行动步骤</strong>
                    <span>{actions.length > 0 ? `${completedActionCount} / ${actions.length} 已处理 · ` : ''}约 {currentTask.estimatedMinutes.target} 分钟</span>
                  </div>
                  <TaskActionList
                    actions={actions}
                    taskId={currentTask.id}
                    currentTaskEntryLabel={currentTaskEntryLabel}
                    onOpen={(target) => {
                      if (target.kind === 'current' && guide.status === 'draft') {
                        void onConfirmGuide(guide.id);
                        return;
                      }
                      onOpenStudyTarget(target);
                    }}
                  />
                </div>
              )}
              <div className="overview-task-footer">
                <details className="overview-task-details">
                  <summary><ListChecks size={16} />查看任务摘要<ChevronRight size={16} /></summary>
                  <div><section><h3>目标与范围</h3><p>{currentTask.objective}</p><p>{currentTask.scope}</p></section><section><h3>预期产出</h3><p>{currentTask.deliverable}</p></section><section><h3>完成标准</h3><ul>{currentTask.doneWhen.map((item) => <li key={item}>{item}</li>)}</ul></section></div>
                </details>
              </div>
            </section>
          ) : <section className="overview-reference-card overview-empty-task"><strong>当前没有可执行任务</strong><p>计划和历史记录仍然保留，请根据上方状态继续处理。</p></section>}

          <PlanManagement
            canViewHistory={Boolean(onNavigate)}
            onViewHistory={() => onNavigate?.('records')}
            onRestart={() => setShowRestartConfirm(true)}
          />
        </div>

        <aside className="overview-side-column">
          <LearningPathSidebar
            stages={roadmap}
            currentStageId={activeStage?.id ?? null}
            currentTaskId={currentTask?.id ?? null}
            tasks={guide.tasks}
            direction={onboarding?.intake.brief?.direction}
            goalProgressStatus={todayGuide?.goalProgress.status}
          />
        </aside>
      </div>

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
