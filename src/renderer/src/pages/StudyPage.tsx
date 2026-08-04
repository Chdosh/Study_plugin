import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronRight,
  HelpCircle,
  Pause,
  Play,
  MessageCircle,
  ListTree,
  Sparkles,
  Square,
  SkipForward
} from 'lucide-react';
import type {
  LearningRuntimeSnapshot,
  QuestionAnswerResult,
  StudySession,
  TeachStepResult,
  LearningOverviewState
} from '../../../shared/types';
import { MessageContent } from '../components/ai/MessageContent';
import { StatePanel } from '../components/shared/StatePanel';
import { getCurrentGuideTaskSelection } from '../domain/guide-selection';
import { computeCommandPolicy } from '../domain/command-policy';
import { deriveLearningTaskStatus } from '../domain/learning-status';
import { resolveStudyView } from '../domain/study-view';
import type { StudyViewTarget } from '../types/navigation';
import { areAllActionsTerminal } from '../../../shared/learning-flow';

type FeedbackKind = 'success' | 'error';

export function StudyPage({
  todayGuide,
  activeSession,
  learningState,
  teaching,
  questionAnswer,
  learningPending,
  viewTarget,
  onReturnToCurrent,
  onStartSession,
  onPauseSession,
  onResumeSession,
  onEndSession,
  onTeachStep,
  onResumeLearningTurn,
  onCancelLearningTurn,
  onCompleteCurrentAction,
  onSkipCurrentAction,
  onAskQuestion,
  onResolveQuestion,
  onSubmitResult,
  onOpenTeacher,
  onOpenRoadmap
}: {
  todayGuide: LearningOverviewState | null;
  activeSession: StudySession | null;
  learningState: LearningRuntimeSnapshot | null;
  teaching: TeachStepResult | null;
  questionAnswer: QuestionAnswerResult | null;
  learningPending: boolean;
  viewTarget: StudyViewTarget;
  onReturnToCurrent: () => void;
  onStartSession: (taskId: string) => Promise<void>;
  onPauseSession: () => Promise<void>;
  onResumeSession: () => Promise<void>;
  onEndSession: () => Promise<void>;
  onTeachStep: () => Promise<void>;
  onResumeLearningTurn: (
    pendingInteractionId: string,
    answer: string,
    expectedContextVersion: number
  ) => Promise<void>;
  onCancelLearningTurn: (pendingInteractionId: string) => Promise<void>;
  onCompleteCurrentAction: (actionId: string, note?: string) => Promise<void>;
  onSkipCurrentAction: (actionId: string) => Promise<void>;
  onAskQuestion: (question: string) => Promise<void>;
  onResolveQuestion: (threadId: string) => Promise<void>;
  onSubmitResult: (content: string) => Promise<void>;
  onOpenTeacher: () => void;
  onOpenRoadmap: () => void;
}): JSX.Element {
  const guide = todayGuide?.guide ?? null;
  const currentSelection = guide ? getCurrentGuideTaskSelection(guide.tasks, activeSession, learningState) : null;
  const resolvedView = guide
    ? resolveStudyView(guide.tasks, activeSession, learningState, viewTarget)
    : { mode: 'execution' as const, task: null, action: null };
  const isReadOnly = resolvedView.mode === 'read_only';
  const currentTaskId = currentSelection?.task?.id ?? activeSession?.taskId ?? null;

  const currentTask = currentSelection?.task ?? null;
  const taskActions = currentTask?.actions ?? [];
  const allActionsDone = areAllActionsTerminal(taskActions);
  const taskDone = currentTask?.status === 'closed';
  const waitingLearningTurn = teaching?.pendingInteraction?.status === 'open';
  const activeSessionBelongsToCurrent = Boolean(currentTaskId && activeSession?.taskId === currentTaskId);
  const hasOpenSession = activeSession?.status === 'active' || activeSession?.status === 'paused';
  const openSessionBelongsToPreviousTask = Boolean(hasOpenSession && !activeSessionBelongsToCurrent);

  const isActive = activeSessionBelongsToCurrent && activeSession?.status === 'active';
  const isPaused = activeSessionBelongsToCurrent && activeSession?.status === 'paused';
  const isNotStarted = !taskDone && !hasOpenSession;
  const allTasksDone = guide
    ? guide.tasks.length > 0
      && guide.tasks.every((task) => task.status === 'closed')
    : false;
  const nextPlannedTask = taskDone && currentTask
    ? guide!.tasks.find((t) => t.status === 'planned' || t.status === 'active') ?? null
    : null;
  const currentAction = taskActions.find((a) => a.status !== 'done' && a.status !== 'skipped') ?? null;
  const displayedTask = isReadOnly ? resolvedView.task : currentTask;
  const displayedAction = isReadOnly ? resolvedView.action : currentAction;
  const displayedTaskActions = displayedTask?.actions ?? [];
  const displayedCompletedActionCount = displayedTaskActions.filter(
    (action) => action.status === 'done' || action.status === 'skipped'
  ).length;
  const learningStatus = currentTask ? deriveLearningTaskStatus(currentTask) : null;
  const taskObjective = currentTask?.objective ?? '';
  const completedActionCount = taskActions.filter((action) => action.status === 'done' || action.status === 'skipped').length;
  const stepTitle = allTasksDone && !currentTask
    ? '当前任务已全部结束'
    : taskDone
      ? '主任务已完成'
    : allActionsDone
      ? '等待提交当前结果'
    : currentAction?.title ?? '当前步骤';
  const stepInstruction = allTasksDone && !currentTask
    ? '当前批次学习任务已全部完成。请前往复盘页查看学习总结，复盘后可根据当前学习路径生成下一批任务。'
    : taskDone
      ? nextPlannedTask
        ? `当前学习任务已经完成。下一项：${nextPlannedTask.title}`
        : '当前主任务已经完成。当前批次的所有任务已结束。'
    : allActionsDone
      ? '这一组学习步骤已经完成。提交成果后会立即进入下一项，导师反馈将在后台生成。'
    : currentAction?.instruction ?? '按当前步骤说明推进。';
  const stepCriteria = taskDone
    ? currentTask?.doneWhen.join('\n') ?? ''
    : allActionsDone
      ? currentTask?.doneWhen.join('\n') ?? ''
    : currentAction?.checkpoint ?? '';
  const displayedStepTitle = isReadOnly ? displayedAction?.title ?? '历史步骤' : stepTitle;
  const displayedInstruction = isReadOnly ? displayedAction?.instruction ?? '' : stepInstruction;
  const displayedCriteria = isReadOnly ? displayedAction?.checkpoint ?? '' : stepCriteria;
  const displayedObjective = isReadOnly ? displayedTask?.objective ?? '' : taskObjective;
  const sessionStatusText = openSessionBelongsToPreviousTask
    ? activeSession?.status === 'paused' ? '上一步学习已暂停' : '上一步学习仍在进行'
    : isActive ? '专注中' : isPaused ? '已暂停' : isNotStarted ? '未开始' : '进行中';
  const sessionStatusClass = activeSession?.status === 'active'
    ? 'active'
    : activeSession?.status === 'paused' ? 'paused' : '';

  const commandPolicy = computeCommandPolicy(learningState, currentTask?.guideId ? {
    guideId: currentTask.guideId,
    taskId: currentTask.id,
    taskStatus: currentTask.status
  } : null);

  const [feedback, setFeedback] = useState<{ message: string; kind: FeedbackKind } | null>(null);
  const [submissionContent, setSubmissionContent] = useState('');
  const [turnAnswer, setTurnAnswer] = useState('');
  const [actionNote, setActionNote] = useState('');
  const submissionInputRef = useRef<HTMLTextAreaElement | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showFeedback = useCallback((message: string, kind: FeedbackKind = 'success') => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    setFeedback({ message, kind });
    feedbackTimerRef.current = setTimeout(() => {
      setFeedback(null);
      feedbackTimerRef.current = null;
    }, 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isReadOnly && learningStatus?.phase === 'awaiting_result') {
      submissionInputRef.current?.focus();
    }
  }, [isReadOnly, learningStatus?.phase]);

  useEffect(() => {
    if (viewTarget.kind === 'review' && !isReadOnly) {
      onReturnToCurrent();
    }
  }, [isReadOnly, onReturnToCurrent, viewTarget.kind]);

  if (!guide) {
    return (
      <section className="study-layout">
        <div className="study-main">
          <StatePanel type="empty" title="还没有学习内容" text="请先在概览页确认目标并生成学习计划。" />
        </div>
      </section>
    );
  }

  return (
    <section className="study-layout">
      <header className="study-page-header">
        <div className="study-header-actions">
          <span className={`focus-state-pill ${isReadOnly || taskDone || allTasksDone ? 'completed' : sessionStatusClass}`}>
            {isReadOnly ? displayedAction?.status === 'skipped' ? '已跳过' : '已完成' : taskDone || allTasksDone ? '已完成' : sessionStatusText}
          </span>
          {!isReadOnly && (
            <>
              {activeSession?.status === 'active' ? (
                <button className="session-pause-button" type="button" onClick={() => void onPauseSession()}><Pause size={14} />暂停</button>
              ) : null}
              {hasOpenSession ? (
                <button className="secondary-action" type="button" onClick={() => void onEndSession()}>
                  <Square size={14} />结束本次学习
                </button>
              ) : null}
              <button className="secondary-action" type="button" onClick={onOpenRoadmap}><ListTree size={15} />学习路径</button>
              <button className="secondary-action study-teacher-drawer-trigger" type="button" onClick={onOpenTeacher}><MessageCircle size={15} />向导师提问</button>
            </>
          )}
        </div>
      </header>

      <div className="study-content-grid">
        <section className="study-current-step-panel focus-execution-panel" aria-label={isReadOnly ? '历史步骤' : '当前步骤'}>
          <div className="current-step-heading">
            <div className="current-step-title-block">
              <span className="focus-eyebrow">{isReadOnly ? displayedAction?.status === 'skipped' ? '已跳过步骤' : '已完成步骤' : '当前步骤'}</span>
              <h2>{displayedStepTitle}</h2>
            </div>
          </div>
          <div className="focus-work-list">
            {displayedObjective && (
              <article className="focus-work-item">
                <strong>学习目标</strong>
                <MessageContent content={displayedObjective} />
              </article>
            )}
            <article className="focus-work-item primary">
              <strong>操作说明</strong>
              <MessageContent content={displayedInstruction} />
            </article>
            {displayedCriteria && (
              <article className="focus-work-item">
                <strong>完成标准</strong>
                <MessageContent content={displayedCriteria} />
              </article>
            )}
            {displayedTask?.deliverable && (
              <article className="focus-work-item"><strong>预期产出</strong><MessageContent content={displayedTask.deliverable} /></article>
            )}
            {isReadOnly && displayedAction?.progressNote && (
              <article className="focus-work-item"><strong>已记录成果</strong><MessageContent content={displayedAction.progressNote} /></article>
            )}
          </div>
          {!isReadOnly && currentTask?.quickHint && (
            <details className="focus-help-row">
              <summary>
                <HelpCircle size={18} />
                卡住时查看提示
                <ChevronRight size={16} />
              </summary>
              <MessageContent content={currentTask.quickHint} />
            </details>
          )}
          {!isReadOnly && teaching && (
            <div className="assistant-message assistant-message-system">
              {teaching.artifacts.map((artifact, index) => (
                <div key={`${artifact.kind}-${index}`} className="learning-turn-artifact">
                  <strong>{artifact.kind === 'quiz'
                    ? '理解检查'
                    : artifact.kind === 'practice'
                      ? '练习'
                      : artifact.kind === 'evaluation'
                        ? '即时反馈'
                        : artifact.kind === 'question'
                          ? '导师追问'
                          : 'AI 展开'}</strong>
                  <MessageContent content={[artifact.explanation, artifact.userAction].filter(Boolean).join('\n\n')} />
                </div>
              ))}
              {teaching.pendingInteraction?.status === 'open' && (
                <div className="submission-composer">
                  {teaching.pendingInteraction.answerMode === 'single_choice'
                    && teaching.pendingInteraction.options.length > 0
                    && (
                      <div className="pending-agent-options">
                        {teaching.pendingInteraction.options.map((option) => (
                          <button
                            key={option}
                            className="option-action"
                            type="button"
                            disabled={learningPending}
                            onClick={() => {
                              const pending = teaching.pendingInteraction!;
                              void onResumeLearningTurn(
                                pending.id,
                                option,
                                pending.expectedContextVersion
                              );
                            }}
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                    )}
                  {teaching.pendingInteraction.answerMode !== 'single_choice' && (
                    <>
                      <label htmlFor="learning-turn-answer">补充信息</label>
                      <textarea
                        id="learning-turn-answer"
                        value={turnAnswer}
                        onChange={(event) => setTurnAnswer(event.target.value)}
                        placeholder="回答后会继续同一个 Learning Turn"
                      />
                    </>
                  )}
                  <div className="submission-actions">
                    <button
                      className="primary-action"
                      type="button"
                      disabled={teaching.pendingInteraction.answerMode === 'single_choice' || !turnAnswer.trim() || learningPending}
                      onClick={() => {
                        const pending = teaching.pendingInteraction!;
                        void onResumeLearningTurn(
                          pending.id,
                          turnAnswer,
                          pending.expectedContextVersion
                        ).then(() => setTurnAnswer(''));
                      }}
                    >
                      继续本轮学习
                    </button>
                    <button
                      className="secondary-action"
                      type="button"
                      onClick={() => void onCancelLearningTurn(teaching.pendingInteraction!.id)}
                    >
                      取消询问
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {displayedTaskActions.length > 0 && <aside className="study-side-column">
          <section className="study-progress-card" aria-label={`任务步骤，已处理 ${displayedCompletedActionCount} / ${displayedTaskActions.length}`}>
            <header><strong>任务步骤</strong><span>{displayedCompletedActionCount} / {displayedTaskActions.length} 已处理</span></header>
            <ol className="study-action-list">
              {displayedTaskActions.map((action, index) => {
                const done = action.status === 'done' || action.status === 'skipped';
                const active = action.id === displayedAction?.id;
                return <li key={action.id} className={`${done ? 'done' : active ? 'active' : ''}${isReadOnly && active ? ' reviewing' : ''}`}><span>{done ? <CheckCircle2 size={15} /> : active ? <Play size={13} /> : index + 1}</span><div><strong>{action.title}</strong><small>{action.status === 'skipped' ? '已跳过' : done ? '已完成' : active ? '正在学习' : '待进行'}</small></div></li>;
              })}
            </ol>
          </section>
        </aside>}

      </div>

      <div className="study-fixed-action-bar">
        <div className="bar-left">
          {!isReadOnly && feedback && (
            <span className={`inline-feedback ${feedback.kind === 'success' ? 'success' : 'error'}`}>
              {feedback.kind === 'success' ? '✓ ' : '✗ '}{feedback.message}
            </span>
          )}
        </div>
        <div className="bar-right">
          {isReadOnly ? (
            <div className="bar-right-group">
              <button className="primary-action" type="button" onClick={onReturnToCurrent}>
                回到当前进度
              </button>
            </div>
          ) : waitingLearningTurn ? (
            <div className="bar-right-group">
              <span className="micro-hint" style={{ margin: 0 }}>
                导师正在等待你的回答；回答或取消后再推进当前步骤。
              </span>
            </div>
          ) : allTasksDone ? (
            <div className="bar-right-group">
              <span className="micro-hint" style={{ margin: 0 }}>
                <CheckCircle2 size={14} />
                当前学习单元已经结束。
              </span>
              {hasOpenSession ? (
                <button className="primary-action" type="button" onClick={() => void onEndSession()}>
                  <Square size={16} />
                  结束本次学习
                </button>
              ) : null}
            </div>
          ) : (
            <div className="bar-right-group">
              {commandPolicy.primaryCommand === 'end_session' ? (
                <button className="primary-action" type="button" onClick={() => void onEndSession()}>
                  <Square size={16} />
                  结束上一步并继续
                </button>
              ) : null}
              {isNotStarted && currentTaskId && commandPolicy.canStart ? (
                <button className="primary-action" type="button" disabled={learningPending} onClick={() => {
                  void onStartSession(currentTaskId!).then(() => showFeedback('已开始学习'));
                }}>
                  <Play size={16} />
                  开始学习
                </button>
              ) : null}
              {isNotStarted && currentTaskId && !commandPolicy.canStart
                && commandPolicy.primaryCommand !== 'end_session' && (
                <button className="primary-action" type="button" disabled title={commandPolicy.reasons.canStart ?? ''}>
                  <Play size={16} />
                  开始学习
                </button>
              )}
              {isActive && commandPolicy.canCompleteAction && !allActionsDone && !waitingLearningTurn && !teaching ? (
                <button className="primary-action" type="button" disabled={learningPending} title={learningPending ? '正在处理，请稍候' : undefined} onClick={() => void onTeachStep()}>
                  <Sparkles size={16} />
                  请导师讲解这一步
                </button>
              ) : null}
              {isActive && commandPolicy.canCompleteAction && !allActionsDone && !waitingLearningTurn ? (
                <>
                  <input
                    className="action-note-input"
                    value={actionNote}
                    onChange={(event) => setActionNote(event.target.value)}
                    placeholder="这一步的成果？（可选，提交时自动汇总）"
                    aria-label="当前步骤成果"
                  />
                  <button className="primary-action" type="button" disabled={learningPending} onClick={() => {
                    if (currentAction) {
                      const note = actionNote.trim() || undefined;
                      setActionNote('');
                      void onCompleteCurrentAction(currentAction.id, note).then(() => showFeedback('步骤已完成'));
                    }
                  }}>
                    <CheckCircle2 size={16} />
                    完成步骤
                  </button>
                </>
              ) : null}
              {isActive && commandPolicy.canSkipAction && !allActionsDone && !waitingLearningTurn ? (
                <button className="secondary-action" type="button" disabled={learningPending} onClick={() => {
                  if (currentAction) {
                    void onSkipCurrentAction(currentAction.id).then(() => showFeedback('已跳过当前步骤'));
                  }
                }}>
                  <SkipForward size={16} />
                  跳过步骤
                </button>
              ) : null}
              {isPaused && commandPolicy.canResume ? (
                <button className="primary-action" type="button" onClick={() => {
                  void onResumeSession().then(() => showFeedback('已恢复学习'));
                }}>
                  <Play size={16} />
                  继续学习
                </button>
              ) : null}
              {commandPolicy.canSubmit && commandPolicy.primaryCommand === 'submit' ? (
                <div className="study-submit-inline">
                  {currentTask && renderActionSummary(currentTask)}
                  <textarea ref={submissionInputRef} value={submissionContent} onChange={(event) => setSubmissionContent(event.target.value)} placeholder={currentTask?.deliverable ? `补充最终总结与验证证据：${currentTask.deliverable}` : '补充最终总结与验证证据（前面步骤的成果已自动汇总）'} aria-label="学习结果" />
                  <button className="primary-action" type="button" disabled={!submissionContent.trim()} title={!submissionContent.trim() ? '请补充最终总结与验证证据' : undefined} onClick={() => {
                    const content = submissionContent.trim();
                    if (!content) return;
                    void onSubmitResult(content).then(() => {
                      setSubmissionContent('');
                      showFeedback('学习结果已提交');
                    });
                  }}><CheckCircle2 size={16} />提交结果</button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function renderActionSummary(task: { actions: Array<{ title: string; status: string; progressNote: string | null }> }): JSX.Element | null {
  const entries = task.actions.map((action, index) => {
    if (action.status === 'done') {
      return (
        <li key={action.title}>
          <span>{index + 1}. {action.title}</span>
          {action.progressNote ? <em>{action.progressNote}</em> : <em className="empty">（未记录产出）</em>}
        </li>
      );
    }
    if (action.status === 'skipped') {
      return (
        <li key={action.title} className="skipped">
          <span>{index + 1}. {action.title}</span>
          <em>已跳过</em>
        </li>
      );
    }
    return null;
  }).filter(Boolean) as JSX.Element[];
  if (entries.length === 0) return null;
  return (
    <div className="study-submit-summary">
      <strong>步骤成果</strong>
      <ul>{entries}</ul>
    </div>
  );
}
