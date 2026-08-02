import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ChevronRight,
  Circle,
  FileText,
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
  GoalIntakeState,
  KnowledgeItem,
  LearningGoal,
  LearningRuntimeSnapshot,
  QuestionAnswerResult,
  RoadmapStage,
  StudySession,
  LearningOverviewState
} from '../../../shared/types';
import { hasCompleteAiConfiguration } from '../../../shared/types';
import { TypingDots } from '../components/ai/TypingDots';
import { PendingAgentQuestion } from '../components/ai/PendingAgentQuestion';
import { MessageContent } from '../components/ai/MessageContent';
import { deriveLearningTaskStatus } from '../domain/learning-status';
import { getRoadmapStagePresentation } from '../domain/roadmap-presentation';

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

function TaskActionList({ actions }: { actions: DailyGuideAction[] }): JSX.Element | null {
  if (actions.length === 0) return null;
  const currentActionId = actions.find((action) => action.status === 'planned')?.id ?? null;
  return (
    <ul className="overview-action-list" aria-label="当前任务行动">
      {actions.map((action) => {
        const isDone = action.status === 'done';
        const isSkipped = action.status === 'skipped';
        const isCurrent = action.id === currentActionId;
        return (
          <li className={isDone ? 'done' : isSkipped ? 'skipped' : isCurrent ? 'current' : 'planned'} key={action.id}>
            <span className="overview-action-marker" aria-hidden="true">
              {isDone ? <CheckCircle2 size={18} /> : isSkipped ? <Minus size={18} /> : <Circle size={18} />}
            </span>
            <span>{action.title}</span>
            <small>{isDone ? '已完成' : isSkipped ? '已跳过' : isCurrent ? '当前' : '待进行'}</small>
          </li>
        );
      })}
    </ul>
  );
}

function LearningPathSidebar({
  stages,
  currentStageId,
  showFull,
  onToggleFull
}: {
  stages: RoadmapStage[];
  currentStageId: string | null;
  showFull: boolean;
  onToggleFull: () => void;
}): JSX.Element | null {
  if (stages.length === 0) return null;
  const activeIndex = Math.max(0, stages.findIndex((stage) => stage.id === currentStageId));
  const compactStart = Math.max(0, Math.min(activeIndex - 1, Math.max(0, stages.length - 3)));
  const visibleStages = showFull ? stages : stages.slice(compactStart, compactStart + 3);

  return (
    <section className="overview-reference-card overview-route-card" aria-labelledby="learning-path-title">
      <header>
        <h2 id="learning-path-title">学习路径</h2>
        <span>{stages.length} 个阶段</span>
      </header>
      <div className="overview-route-steps">
        {visibleStages.map((stage) => {
          const index = stages.findIndex((item) => item.id === stage.id);
          const presentation = getRoadmapStagePresentation(stage, currentStageId);
          return (
            <article className={presentation.className} key={stage.id} aria-current={presentation.isCurrentLearningUnit ? 'step' : undefined}>
              <span className="overview-route-marker">{stage.status === 'completed' ? <CheckCircle2 size={17} /> : index + 1}</span>
              <div>
                <strong>{stage.title}</strong>
                <small>{presentation.label}</small>
                {presentation.isCurrentLearningUnit && stage.targetDate && (
                  <small className="overview-route-checkpoint">检查点：{stage.targetDate}</small>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {stages.length > 3 && (
        <button className="text-action overview-route-toggle" type="button" aria-expanded={showFull} onClick={onToggleFull}>
          {showFull ? '收起学习路径' : '查看完整学习路径'}
          <ChevronRight size={15} />
        </button>
      )}
    </section>
  );
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
    <details className="overview-manage">
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
  knowledgeItems: KnowledgeItem[];
}): JSX.Element {
  const [message, setMessage] = useState('');
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(null);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const [showFullRoadmap, setShowFullRoadmap] = useState(false);
  const [temporaryMessage, setTemporaryMessage] = useState('');
  const [temporaryGoalId, setTemporaryGoalId] = useState('');

  const guide = todayGuide?.guide ?? null;
  const roadmap = todayGuide?.roadmap ?? [];
  const goal = todayGuide?.goal ?? onboarding?.activeGoal ?? null;
  const nearTermPlanItems = todayGuide?.shortPlan ?? [];
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
  const intakePending = onboardingOperationPending;
  const hasConfirmedGoalWithoutGuide = onboarding?.intake.status === 'confirmed'
    && Boolean(onboarding.intake.goalId);
  const canGenerateInitialPlan = onboarding?.intake.status === 'ready'
    || hasConfirmedGoalWithoutGuide;
  const latestAssistantMessageId = [...(onboarding?.messages ?? [])].reverse().find((item) => item.role === 'assistant')?.id ?? null;

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
              showFull={showFullRoadmap}
              onToggleFull={() => setShowFullRoadmap((current) => !current)}
            />
          </aside>
        </div>

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
          <div className="generation-path" aria-label="输出路径">
            <Sparkles size={18} />
            <span>将生成：</span>
            <strong>长期大纲</strong>
            <ChevronRight size={16} />
            <strong>近期计划</strong>
            <ChevronRight size={16} />
            <strong>当前 Learning Guide</strong>
          </div>

          <section className="surface intake-chat-panel" aria-label="主动访谈">
            <div className="intake-thread redesigned" aria-label="目标访谈记录">
              {(onboarding?.messages ?? []).length === 0 && (
                <div className="intake-message assistant">
                  <span>AI</span>
                  <div className="message-content">你准备学习什么？可以直接说目标、期限、基础和通常可投入的时间。</div>
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
                  <div>
                    <strong>AI 正在生成完整学习计划</strong>
                    <TypingDots />
                  </div>
                </div>
              )}
            </div>

            {onboarding?.pendingInteraction?.status === 'open' && !intakePending && (
              <PendingAgentQuestion
                interaction={onboarding.pendingInteraction}
                onCancel={() => void onCancelPendingQuestion()}
              />
            )}

            <div className="intake-input-dock">
              <div className="intake-input-box">
                <FileText size={18} />
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="输入你的回答，或补充更多信息..."
                  aria-label="输入学习目标"
                  disabled={intakePending}
                />
              </div>
              <div className="intake-actions">
                <button
                  className="text-action"
                  type="button"
                  disabled={!message.trim() || !hasAiConfiguration || intakePending}
                  onClick={() => {
                    const question = message.trim();
                    setMessage('');
                    void onAskTemporaryQuestion(question);
                  }}
                >
                  <Sparkles size={16} />
                  临时学习这个问题
                </button>
                {!intakePending && canGenerateInitialPlan && (
                  <button className="text-action" type="button" disabled={!hasAiConfiguration} onClick={() => void onGenerateInitialPlan()}>
                    <Wand2 size={16} />
                    生成完整学习计划
                  </button>
                )}
                {!intakePending && !canGenerateInitialPlan && (
                  <button className="text-action" type="button" disabled={!hasAiConfiguration} onClick={() => void send('请使用当前信息生成初步计划。')}>
                    <Wand2 size={16} />
                    使用当前信息生成完整计划
                  </button>
                )}
                <button className="primary-action" type="button" disabled={!message.trim() || !hasAiConfiguration || intakePending} onClick={() => void send(message)}>
                  <SendHorizontal size={16} />
                  {intakePending ? '等待回复' : '发送'}
                </button>
              </div>
            </div>
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
                    <span>{item.role === 'assistant' ? 'AI' : '你'}</span>
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
  const statusLabel = (status: string): string => ({ planned: '待开始', active: '进行中', deferred: '已暂缓', closed: '已结束' })[status] ?? status;
  const actions = currentTask?.actions ?? [];
  const completedActionCount = actions.filter((action) => action.status === 'done' || action.status === 'skipped').length;
  const primaryActionLabel = currentLearningStatus?.phase === 'awaiting_result'
    ? '提交学习成果'
    : activeSession?.status === 'paused'
      ? '继续学习'
      : currentTask?.status === 'planned'
        ? '开始学习'
        : '继续学习';
  const taskConclusion = currentLearningStatus?.phase === 'awaiting_result'
    ? '当前任务内容已处理，下一步提交学习成果。'
    : currentLearningStatus?.phase === 'done'
      ? '当前任务已经结束，可前往记录查看结果。'
      : activeSession?.status === 'paused'
        ? '学习已暂停，可以从上次位置继续。'
        : '继续处理当前任务中的行动。';


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
                <span className={`task-status ${currentTask.status}`}>
                  {currentLearningStatus?.label ?? statusLabel(currentTask.status)}
                </span>
              </div>
              <p className="overview-task-objective">{currentNearTermPlanItem?.focus || currentTask.objective}</p>
              <p className="overview-task-conclusion">{taskConclusion}</p>
              {actions.length > 0 && (
                <div className="overview-actions-block">
                  <div className="overview-actions-header">
                    <strong>行动</strong>
                    <span>{completedActionCount} / {actions.length} 已处理 · 约 {currentTask.estimatedMinutes.target} 分钟</span>
                  </div>
                  <TaskActionList actions={actions} />
                </div>
              )}
              <div className="overview-task-footer">
                <details className="overview-task-details">
                  <summary><ListChecks size={16} />查看任务摘要<ChevronRight size={16} /></summary>
                  <div><section><h3>目标与范围</h3><p>{currentTask.objective}</p><p>{currentTask.scope}</p></section><section><h3>预期产出</h3><p>{currentTask.deliverable}</p></section><section><h3>完成标准</h3><ul>{currentTask.doneWhen.map((item) => <li key={item}>{item}</li>)}</ul></section></div>
                </details>
                {guide.status === 'draft' ? (
                  <button className="primary-action overview-task-primary" type="button" onClick={() => void onConfirmGuide(guide.id)}><Play size={16} />开始学习</button>
                ) : currentLearningStatus?.phase !== 'done' ? (
                  <button className="primary-action overview-task-primary" type="button" onClick={() => onNavigate?.('study')}>
                    {currentLearningStatus?.phase === 'awaiting_result' ? <SendHorizontal size={16} /> : <Play size={16} />}
                    {primaryActionLabel}
                  </button>
                ) : null}
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
            showFull={showFullRoadmap}
            onToggleFull={() => setShowFullRoadmap((current) => !current)}
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
