import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronRight,
  // Clock3, // BUG: 计时控件有bug，暂时移除
  HelpCircle,
  Pause,
  Play,
  MessageCircle,
  ListTree,
  RefreshCw,
  Sparkles,
  Square,
  SkipForward
} from 'lucide-react';
import type {
  LearningRuntimeSnapshot,
  QuestionAnswerResult,
  StudySession,
  SubmissionEvaluationResult,
  TeachStepResult,
  LearningOverviewState,
  TaskClosureKind
} from '../../../shared/types';
import { MessageContent } from '../components/ai/MessageContent';
import { StatePanel } from '../components/shared/StatePanel';
import { getCurrentGuideTaskSelection } from '../domain/guide-selection';
import { computeCommandPolicy } from '../domain/command-policy';
import { deriveLearningTaskStatus } from '../domain/learning-status';
// BUG: 计时控件有bug，暂时移除。相关代码已注释，待修复后恢复。
// import { getSessionElapsedSeconds } from '../session-time';
//
// function formatElapsedTime(totalSeconds: number): string {
//   const hours = Math.floor(totalSeconds / 3600);
//   const minutes = Math.floor((totalSeconds % 3600) / 60);
//   const seconds = totalSeconds % 60;
//   const pad = (n: number): string => String(n).padStart(2, '0');
//   return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
// }


function toCompactTitle(text: string, maxLength = 30): string {
  const normalized = text.replace(/\s+/gu, ' ').trim();
  const firstSegment = normalized.split(/[，。；、,.]/u).find(Boolean)?.trim() ?? normalized;
  return firstSegment.length > maxLength ? `${firstSegment.slice(0, maxLength)}…` : firstSegment;
}

type FeedbackKind = 'success' | 'error';

export function StudyPage({
  todayGuide,
  activeSession,
  learningState,
  teaching,
  questionAnswer,
  submissionResult,
  onStartSession,
  onPauseSession,
  onResumeSession,
  onEndSession,
  onTeachStep,
  onResumeLearningTurn,
  onCancelLearningTurn,
  onCompleteCurrentAction,
  onSkipCurrentAction,
  onCloseCurrentTask,
  onAskQuestion,
  onResolveQuestion,
  onSubmitResult,
  onRetrySubmissionEvaluation,
  onDecideRecommendation,
  onCorrectEvaluation,
  onOpenTeacher,
  onOpenRoadmap
}: {
  todayGuide: LearningOverviewState | null;
  activeSession: StudySession | null;
  learningState: LearningRuntimeSnapshot | null;
  teaching: TeachStepResult | null;
  questionAnswer: QuestionAnswerResult | null;
  submissionResult: SubmissionEvaluationResult | null;
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
  onCompleteCurrentAction: () => Promise<void>;
  onSkipCurrentAction: () => Promise<void>;
  onCloseCurrentTask: (input: {
    taskId: string;
    closureKind: TaskClosureKind;
    closureReason?: string;
    nextStartPoint?: string;
  }) => Promise<void>;
  onAskQuestion: (question: string) => Promise<void>;
  onResolveQuestion: (threadId: string) => Promise<void>;
  onSubmitResult: (content: string) => Promise<void>;
  onRetrySubmissionEvaluation: (submissionId: string) => Promise<void>;
  onDecideRecommendation: (
    evaluationId: string,
    decision: 'accepted' | 'declined' | 'deferred',
    reason?: string
  ) => Promise<void>;
  onCorrectEvaluation: (evaluationId: string, reason: string) => Promise<void>;
  onOpenTeacher: () => void;
  onOpenRoadmap: () => void;
}): JSX.Element {
  const guide = todayGuide?.guide ?? null;
  const currentSelection = guide ? getCurrentGuideTaskSelection(guide.tasks, activeSession, learningState) : null;
  const currentTaskId = currentSelection?.task?.id ?? activeSession?.taskId ?? null;

  const currentTask = currentSelection?.task ?? null;
  const taskActions = currentTask?.actions ?? [];
  const pendingSubmission = learningState?.latestSubmission?.evaluationStatus !== 'completed'
    ? learningState?.latestSubmission ?? null
    : null;
  const pendingRecommendation =
    learningState?.latestEvaluation?.recommendationDecision === 'pending'
    && learningState.latestDecision
      ? {
          evaluation: learningState.latestEvaluation,
          decision: learningState.latestDecision
        }
      : null;
  const recommendsTaskClosure = pendingRecommendation?.decision.taskCompleted === true;
  const allActionsDone = taskActions.length > 0 && taskActions.every((action) => action.status === 'done' || action.status === 'skipped');
  const taskDone = currentTask?.status === 'done';
  const waitingLearningTurn = teaching?.pendingInteraction?.status === 'open';
  const activeSessionBelongsToCurrent = Boolean(currentTaskId && activeSession?.taskId === currentTaskId);

  const isActive = activeSessionBelongsToCurrent && activeSession?.status === 'active';
  const isPaused = activeSessionBelongsToCurrent && activeSession?.status === 'paused';
  const isNotStarted = !taskDone && (!activeSessionBelongsToCurrent || !activeSession || (activeSession.status !== 'active' && activeSession.status !== 'paused'));
  const allTasksDone = guide
    ? guide.tasks.length > 0
      && guide.tasks.every((task) => task.status === 'done' || task.status === 'skipped')
    : false;
  const nextPlannedTask = taskDone && currentTask
    ? guide!.tasks.find((t) => t.status === 'planned' || t.status === 'active') ?? null
    : null;
  const taskTitle = toCompactTitle(currentTask?.title ?? (allTasksDone ? '当前学习单元' : '当前任务'));
  const currentAction = taskActions.find((a) => a.status !== 'done' && a.status !== 'skipped') ?? null;
  const learningStatus = currentTask ? deriveLearningTaskStatus(currentTask, learningState?.latestSubmission ? {
    evaluationStatus: learningState.latestSubmission.evaluationStatus,
    evaluationResult: learningState.latestEvaluation?.result
  } : null) : null;
  const taskObjective = currentTask?.objective ?? '';
  const completedActionCount = taskActions.filter((action) => action.status === 'done' || action.status === 'skipped').length;
  const stepTitle = allTasksDone && !currentTask
    ? '当前任务已全部结束'
    : pendingSubmission
      ? pendingSubmission.evaluationStatus === 'failed' ? '等待重新评价' : '评价中'
    : taskDone
      ? '主任务已完成'
    : learningStatus?.phase === 'needs_revision'
      ? '等待修改'
    : allActionsDone
      ? '等待提交当前结果'
    : currentAction?.title ?? '当前步骤';
  const stepInstruction = allTasksDone && !currentTask
    ? '当前批次学习任务已全部完成。请前往复盘页查看学习总结，复盘后可根据当前学习路径生成下一批任务。'
    : pendingSubmission
      ? pendingSubmission.evaluationStatus === 'failed'
        ? '你的提交已经保存在本地，但上次评价失败。重新评价会复用原提交记录。'
        : '你的提交已经保存在本地，AI 正在评价。'
    : taskDone
      ? nextPlannedTask
        ? `当前主任务已经通过评价。下一任务：${nextPlannedTask.title}`
        : '当前主任务已经通过评价。今天所有任务已完成。'
    : learningStatus?.phase === 'needs_revision'
      ? '评价尚未通过。请根据反馈修改结果后再次提交，原提交和评价记录会继续保留。'
    : allActionsDone
      ? '当前主任务的行动步骤已经完成。下一步需要提交当前结果，由 AI 评价后决定完成或继续修改。'
    : currentAction?.instruction ?? '按当前步骤说明推进。';
  const stepCriteria = taskDone
    ? submissionResult?.evaluation.feedback ?? learningState?.latestEvaluation?.feedback ?? currentTask?.doneWhen.join('\n') ?? ''
    : pendingSubmission
      ? currentTask?.doneWhen.join('\n') ?? ''
    : allActionsDone
      ? currentTask?.doneWhen.join('\n') ?? ''
    : currentAction?.checkpoint ?? '';
  const sessionStatusText = isActive ? '专注中' : isPaused ? '已暂停' : isNotStarted ? '未开始' : '进行中';
  const sessionStatusClass = isActive ? 'active' : isPaused ? 'paused' : '';

  // BUG: 计时控件有bug，暂时移除
  // const [elapsedSeconds, setElapsedSeconds] = useState(0);
  // const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const commandPolicy = computeCommandPolicy(learningState, currentTask?.guideId ? {
    guideId: currentTask.guideId,
    taskId: currentTask.id,
    taskStatus: currentTask.status
  } : null);

  const [feedback, setFeedback] = useState<{ message: string; kind: FeedbackKind } | null>(null);
  const [submissionContent, setSubmissionContent] = useState('');
  const [turnAnswer, setTurnAnswer] = useState('');
  const [recommendationReason, setRecommendationReason] = useState('');
  const [evaluationCorrection, setEvaluationCorrection] = useState('');
  const [closingTask, setClosingTask] = useState(false);
  const [closureKind, setClosureKind] = useState<TaskClosureKind>('completed');
  const [closureReason, setClosureReason] = useState('');
  const [nextStartPoint, setNextStartPoint] = useState('');
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
    if (learningStatus?.phase === 'awaiting_result' || learningStatus?.phase === 'needs_revision') {
      submissionInputRef.current?.focus();
    }
  }, [learningStatus?.phase]);

  // BUG: 计时控件有bug，暂时移除。待修复后恢复以下计时逻辑：
  // useEffect(() => {
  //   if (timerRef.current) clearInterval(timerRef.current);
  //   if (isActive && activeSession?.startedAt) {
  //     const computeElapsed = (): number => getSessionElapsedSeconds(activeSession);
  //     const initial = computeElapsed();
  //     setElapsedSeconds(initial);
  //     timerRef.current = setInterval(() => {
  //       const s = computeElapsed();
  //       setElapsedSeconds(s);
  //     }, 1000);
  //     return () => { if (timerRef.current) clearInterval(timerRef.current); };
  //   }
  //   if (isPaused && activeSession?.durationMinutes != null) {
  //     const total = getSessionElapsedSeconds(activeSession);
  //     setElapsedSeconds(total);
  //   }
  //   return () => { if (timerRef.current) clearInterval(timerRef.current); };
  // }, [isActive, isPaused, activeSession?.startedAt, activeSession?.durationMinutes]);

  if (!guide) {
    return (
      <section className="study-layout">
        <div className="study-main">
          <StatePanel type="empty" title="还没有执行稿" text="请先在总览页完成目标确认并生成当前 Learning Guide。" />
        </div>
      </section>
    );
  }

  return (
    <section className="study-layout">
      <header className="study-page-header">
        <div>
          <span className="page-kicker">当前学习</span>
          <h1>{taskTitle}</h1>
        </div>
        <div className="study-header-actions">
          <span className={`focus-state-pill ${taskDone || allTasksDone ? 'completed' : sessionStatusClass}`}>{taskDone || allTasksDone ? '已完成' : sessionStatusText}</span>
          {isActive && commandPolicy.canPause ? (
            <button className="session-pause-button" type="button" onClick={() => void onPauseSession()}><Pause size={14} />暂停</button>
          ) : null}
          {(isActive || isPaused) ? (
            <button className="secondary-action" type="button" onClick={() => void onEndSession()}>
              <Square size={14} />结束 Session
            </button>
          ) : null}
          <button className="secondary-action" type="button" onClick={onOpenRoadmap}><ListTree size={15} />学习路径</button>
          <button className="secondary-action study-teacher-drawer-trigger" type="button" onClick={onOpenTeacher}><MessageCircle size={15} />向导师提问</button>
        </div>
      </header>

      <div className="study-content-grid">
        <section className="study-current-step-panel focus-execution-panel" aria-label="当前步骤">
          <div className="current-step-heading">
            <div className="current-step-title-block">
              <span className="focus-eyebrow">当前步骤</span>
              <h2>{stepTitle}</h2>
            </div>
            {!taskDone && !allActionsDone && <button className="secondary-action" type="button" disabled={!isActive || waitingLearningTurn} title={!isActive ? '开始或继续学习后可展开当前步骤' : waitingLearningTurn ? '请先回答或取消导师当前问题' : undefined} onClick={() => void onTeachStep()}><Sparkles size={15} />展开步骤</button>}
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
            {learningState?.latestSubmission && (
              <article className="focus-work-item">
                <strong>最新成果 · 第 {learningState.submissionAttempts.length} 次尝试</strong>
                <MessageContent content={learningState.latestSubmission.content} />
                {learningState.latestEvaluation && (
                  <small>
                    {learningState.latestEvaluation.source === 'user_correction'
                      ? '用户已追加评价纠正'
                      : learningState.latestEvaluation.result === 'passed'
                        ? '本次评价：通过'
                        : learningState.latestEvaluation.result === 'partial'
                          ? '本次评价：部分达到'
                          : learningState.latestEvaluation.result === 'failed'
                            ? '本次评价：未达到'
                            : '本次评价：需要确认'}
                  </small>
                )}
              </article>
            )}
            {learningState?.latestEvaluation?.source === 'ai' && (
              <article className="focus-work-item">
                <strong>评价有事实错误？</strong>
                <textarea
                  value={evaluationCorrection}
                  onChange={(event) => setEvaluationCorrection(event.target.value)}
                  placeholder="写明哪项判断不准确；原评价会保留，纠正会作为新事实追加。"
                />
                <button
                  className="secondary-action"
                  type="button"
                  disabled={!evaluationCorrection.trim()}
                  onClick={() => void onCorrectEvaluation(
                    learningState.latestEvaluation!.id,
                    evaluationCorrection
                  ).then(() => {
                    setEvaluationCorrection('');
                    showFeedback('已追加评价纠正');
                  })}
                >
                  记录纠正
                </button>
              </article>
            )}
            {currentTask?.deliverable && (
              <article className="focus-work-item"><strong>预期产出</strong><MessageContent content={currentTask.deliverable} /></article>
            )}
          </div>
          {currentTask?.quickHint && (
            <details className="focus-help-row">
              <summary>
                <HelpCircle size={18} />
                卡住时查看提示
                <ChevronRight size={16} />
              </summary>
              <MessageContent content={currentTask.quickHint} />
            </details>
          )}
          {teaching && (
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
                  <label htmlFor="learning-turn-answer">补充信息</label>
                  <textarea
                    id="learning-turn-answer"
                    value={turnAnswer}
                    onChange={(event) => setTurnAnswer(event.target.value)}
                    placeholder="回答后会继续同一个 Learning Turn"
                  />
                  <div className="submission-actions">
                    <button
                      className="primary-action"
                      type="button"
                      disabled={!turnAnswer.trim()}
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

        {taskActions.length > 0 && <aside className="study-side-column">
          <section className="study-progress-card" aria-label={`任务步骤，已处理 ${completedActionCount} / ${taskActions.length}`}>
            <header><strong>任务步骤</strong><span>{completedActionCount} / {taskActions.length} 已处理</span></header>
            <ol className="study-action-list">
              {taskActions.map((action, index) => {
                const done = action.status === 'done' || action.status === 'skipped';
                const active = action.id === currentAction?.id;
                return <li key={action.id} className={done ? 'done' : active ? 'active' : ''}><span>{done ? <CheckCircle2 size={15} /> : active ? <Play size={13} /> : index + 1}</span><div><strong>{active ? '正在执行' : action.title}</strong><small>{action.status === 'skipped' ? '已跳过' : done ? '已完成' : active ? '当前步骤见左侧' : '待进行'}</small></div></li>;
              })}
            </ol>
          </section>
        </aside>}

      </div>

      <div className="study-fixed-action-bar">
        <div className="bar-left">
          {feedback && (
            <span className={`inline-feedback ${feedback.kind === 'success' ? 'success' : 'error'}`}>
              {feedback.kind === 'success' ? '✓ ' : '✗ '}{feedback.message}
            </span>
          )}
        </div>
        <div className="bar-right">
          {waitingLearningTurn ? (
            <div className="bar-right-group">
              <span className="micro-hint" style={{ margin: 0 }}>
                导师正在等待你的回答；回答或取消后再推进当前步骤。
              </span>
            </div>
          ) : pendingSubmission ? (
            <div className="bar-right-group">
              <span className="micro-hint" style={{ margin: 0 }}>
                提交已保存，评价未完成。
              </span>
              <button className="primary-action" type="button" onClick={() => void onRetrySubmissionEvaluation(pendingSubmission.id)}>
                <RefreshCw size={16} />
                重新评价
              </button>
            </div>
          ) : pendingRecommendation ? (
            <div className="bar-right-group">
              <span className="micro-hint" style={{ margin: 0 }}>
                {pendingRecommendation.decision.reason}
                {recommendsTaskClosure && activeSessionBelongsToCurrent
                  && (activeSession?.status === 'active' || activeSession?.status === 'paused')
                  ? '；采纳后只关闭 Task，当前 Session 会保持未结束，请按需要单独结束。'
                  : recommendsTaskClosure && !allActionsDone
                    ? '；当前仍有未处理 Action，关闭 Task 不会自动修改这些 Action。'
                    : ''}
              </span>
              <input
                aria-label="建议决定原因"
                value={recommendationReason}
                onChange={(event) => setRecommendationReason(event.target.value)}
                placeholder="可选：记录采纳、暂缓或拒绝原因"
              />
              <button className="primary-action" type="button" onClick={() => {
                void onDecideRecommendation(
                  pendingRecommendation.evaluation.id,
                  'accepted',
                  recommendationReason
                ).then(() => {
                  setRecommendationReason('');
                  showFeedback('已采纳评价建议');
                });
              }}>
                <CheckCircle2 size={16} />
                {recommendsTaskClosure && activeSessionBelongsToCurrent
                  && (activeSession?.status === 'active' || activeSession?.status === 'paused')
                  ? '关闭 Task（保留 Session）'
                  : '采纳建议'}
              </button>
              <button className="secondary-action" type="button" onClick={() => {
                void onDecideRecommendation(
                  pendingRecommendation.evaluation.id,
                  'deferred',
                  recommendationReason
                ).then(() => {
                  setRecommendationReason('');
                  showFeedback('已保留建议，稍后决定');
                });
              }}>
                稍后决定
              </button>
              <button className="secondary-action" type="button" onClick={() => {
                void onDecideRecommendation(
                  pendingRecommendation.evaluation.id,
                  'declined',
                  recommendationReason
                ).then(() => {
                  setRecommendationReason('');
                  showFeedback('已记录不采纳');
                });
              }}>
                不采纳
              </button>
              <div className="study-submit-inline">
                <textarea
                  ref={submissionInputRef}
                  value={submissionContent}
                  onChange={(event) => setSubmissionContent(event.target.value)}
                  placeholder="也可以先提交修改后的新版本；原尝试和评价会保留"
                  aria-label="新版本学习结果"
                />
                <button
                  className="secondary-action"
                  type="button"
                  disabled={!submissionContent.trim()}
                  onClick={() => {
                    const content = submissionContent.trim();
                    if (!content) return;
                    void onSubmitResult(content).then(() => {
                      setSubmissionContent('');
                      showFeedback('新版本已提交，旧评价仍保留');
                    });
                  }}
                >
                  提交新版本
                </button>
              </div>
            </div>
          ) : allTasksDone ? (
            <div className="bar-right-group">
              <span className="micro-hint" style={{ margin: 0 }}>
                <CheckCircle2 size={14} />
                当前学习单元中的 Task 均已结束，请前往记录页查看复盘和下一步。
              </span>
            </div>
          ) : (
            <div className="bar-right-group">
              {isNotStarted && currentTaskId && commandPolicy.canStart ? (
                <button className="primary-action" type="button" onClick={() => {
                  void onStartSession(currentTaskId!).then(() => showFeedback('已开始任务'));
                }}>
                  <Play size={16} />
                  开始任务
                </button>
              ) : null}
              {isNotStarted && currentTaskId && !commandPolicy.canStart && (
                <button className="primary-action" type="button" disabled title={commandPolicy.reasons.canStart ?? ''}>
                  <Play size={16} />
                  开始任务
                </button>
              )}
              {isActive && commandPolicy.canCompleteAction && !allActionsDone ? (
                <button className="primary-action" type="button" onClick={() => {
                  void onCompleteCurrentAction().then(() => showFeedback('步骤已完成'));
                }}>
                  <CheckCircle2 size={16} />
                  完成步骤
                </button>
              ) : null}
              {isActive && commandPolicy.canSkipAction && !allActionsDone ? (
                <button className="secondary-action" type="button" onClick={() => {
                  void onSkipCurrentAction().then(() => showFeedback('已跳过当前步骤'));
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
              {commandPolicy.canSubmit ? (
                <div className="study-submit-inline">
                  <textarea ref={submissionInputRef} value={submissionContent} onChange={(event) => setSubmissionContent(event.target.value)} placeholder={currentTask?.deliverable ? `提交结果：${currentTask.deliverable}` : '说明你完成了什么，并粘贴必要的运行结果或验证证据'} aria-label="学习结果" />
                  <button className={allActionsDone ? 'primary-action' : 'secondary-action'} type="button" disabled={!submissionContent.trim()} title={!submissionContent.trim() ? '请先填写学习结果或验证证据' : undefined} onClick={() => {
                    const content = submissionContent.trim();
                    if (!content) return;
                    void onSubmitResult(content).then(() => { setSubmissionContent(''); showFeedback('学习结果已提交'); });
                  }}><CheckCircle2 size={16} />提交结果</button>
                </div>
              ) : null}
              {!taskDone && commandPolicy.canCloseTask && currentTask ? (
                closingTask ? (
                  <div className="task-closure-panel" role="group" aria-label="收口当前 Task">
                    <select
                      aria-label="Task 收口结果"
                      value={closureKind}
                      onChange={(event) => setClosureKind(event.target.value as TaskClosureKind)}
                    >
                      <option value="completed">已完成</option>
                      <option value="partial">部分完成</option>
                      <option value="abandoned">放弃</option>
                      <option value="replaced">被其他 Task 替代</option>
                    </select>
                    <input
                      aria-label="Task 收口原因"
                      value={closureReason}
                      onChange={(event) => setClosureReason(event.target.value)}
                      placeholder="可选：记录收口原因"
                    />
                    <input
                      aria-label="下次继续位置"
                      value={nextStartPoint}
                      onChange={(event) => setNextStartPoint(event.target.value)}
                      placeholder="可选：下次从哪里继续"
                    />
                    <span className="micro-hint">
                      未完成 Action 会原样保留；收口 Task 不会结束当前 Session。
                    </span>
                    <button className="primary-action" type="button" onClick={() => {
                      void onCloseCurrentTask({
                        taskId: currentTask.id,
                        closureKind,
                        closureReason: closureReason.trim() || undefined,
                        nextStartPoint: nextStartPoint.trim() || undefined
                      }).then(() => {
                        setClosingTask(false);
                        setClosureReason('');
                        setNextStartPoint('');
                        showFeedback('Task 已收口，Session 状态保持不变');
                      });
                    }}>
                      <CheckCircle2 size={16} />
                      确认收口
                    </button>
                    <button className="secondary-action" type="button" onClick={() => setClosingTask(false)}>
                      取消
                    </button>
                  </div>
                ) : (
                  <button className="secondary-action" type="button" onClick={() => setClosingTask(true)}>
                    <CheckCircle2 size={16} />
                    收口 Task
                  </button>
                )
              ) : null}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
