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
  SkipForward
} from 'lucide-react';
import type {
  LearningRuntimeSnapshot,
  QuestionAnswerResult,
  StudySession,
  SubmissionEvaluationResult,
  TeachStepResult,
  TodayGuideState
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
  onTeachStep,
  onCompleteCurrentAction,
  onSkipCurrentAction,
  onSkipCurrentTask,
  onAskQuestion,
  onResolveQuestion,
  onSubmitResult,
  onRetrySubmissionEvaluation,
  onOpenTeacher,
  onOpenRoadmap
}: {
  todayGuide: TodayGuideState | null;
  activeSession: StudySession | null;
  learningState: LearningRuntimeSnapshot | null;
  teaching: TeachStepResult | null;
  questionAnswer: QuestionAnswerResult | null;
  submissionResult: SubmissionEvaluationResult | null;
  onStartSession: (taskId: string) => Promise<void>;
  onPauseSession: () => Promise<void>;
  onResumeSession: () => Promise<void>;
  onTeachStep: () => Promise<void>;
  onCompleteCurrentAction: () => Promise<void>;
  onSkipCurrentAction: () => Promise<void>;
  onSkipCurrentTask: () => Promise<void>;
  onAskQuestion: (question: string) => Promise<void>;
  onResolveQuestion: (threadId: string) => Promise<void>;
  onSubmitResult: (content: string) => Promise<void>;
  onRetrySubmissionEvaluation: (submissionId: string) => Promise<void>;
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
  const allActionsDone = taskActions.length > 0 && taskActions.every((action) => action.status === 'done' || action.status === 'skipped');
  const taskDone = currentTask?.status === 'done';
  const activeSessionBelongsToCurrent = Boolean(currentTaskId && activeSession?.taskId === currentTaskId);

  const isActive = activeSessionBelongsToCurrent && activeSession?.status === 'active';
  const isPaused = activeSessionBelongsToCurrent && activeSession?.status === 'paused';
  const isNotStarted = !taskDone && (!activeSessionBelongsToCurrent || !activeSession || (activeSession.status !== 'active' && activeSession.status !== 'paused'));
  const allTasksDone = guide ? guide.tasks.length > 0 && guide.tasks.every((t) => t.status === 'done') : false;
  const nextPlannedTask = taskDone && currentTask
    ? guide!.tasks.find((t) => t.status === 'planned' || t.status === 'active') ?? null
    : null;
  const taskTitle = toCompactTitle(currentTask?.title ?? (allTasksDone ? '今日学习' : '当前任务'));
  const currentAction = taskActions.find((a) => a.status !== 'done' && a.status !== 'skipped') ?? null;
  const learningStatus = currentTask ? deriveLearningTaskStatus(currentTask, learningState?.latestSubmission ? {
    evaluationStatus: learningState.latestSubmission.evaluationStatus,
    evaluationResult: learningState.latestEvaluation?.result
  } : null) : null;
  const taskObjective = currentTask?.objective ?? '';
  const completedActionCount = taskActions.filter((action) => action.status === 'done' || action.status === 'skipped').length;
  const stepTitle = allTasksDone && !currentTask
    ? '今日任务已全部完成'
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

  const commandPolicy = computeCommandPolicy(learningState, currentTask ? {
    guideId: currentTask.guideId,
    taskId: currentTask.id,
    taskStatus: currentTask.status
  } : null);

  const [feedback, setFeedback] = useState<{ message: string; kind: FeedbackKind } | null>(null);
  const [submissionContent, setSubmissionContent] = useState('');
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
          <StatePanel type="empty" title="还没有执行稿" text="请先在总览页完成目标确认和今日执行稿生成。" />
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
            {!taskDone && !allActionsDone && <button className="secondary-action" type="button" disabled={!isActive} title={!isActive ? '开始或继续学习后可展开当前步骤' : undefined} onClick={() => void onTeachStep()}><Sparkles size={15} />展开步骤</button>}
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
              <strong>AI 展开：</strong>
              <MessageContent content={`${teaching.explanation}\n\n${teaching.userAction}`} />
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
          {pendingSubmission ? (
            <div className="bar-right-group">
              <span className="micro-hint" style={{ margin: 0 }}>
                提交已保存，评价未完成。
              </span>
              <button className="primary-action" type="button" onClick={() => void onRetrySubmissionEvaluation(pendingSubmission.id)}>
                <RefreshCw size={16} />
                重新评价
              </button>
            </div>
          ) : allTasksDone ? (
            <div className="bar-right-group">
              <span className="micro-hint" style={{ margin: 0 }}>
                <CheckCircle2 size={14} />
                当前批次任务已全部完成，请前往复盘页查看总结。
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
              {allActionsDone && commandPolicy.canSubmit ? (
                <div className="study-submit-inline">
                  <textarea ref={submissionInputRef} value={submissionContent} onChange={(event) => setSubmissionContent(event.target.value)} placeholder={currentTask?.deliverable ? `提交结果：${currentTask.deliverable}` : '说明你完成了什么，并粘贴必要的运行结果或验证证据'} aria-label="学习结果" />
                  <button className="primary-action" type="button" disabled={!submissionContent.trim()} title={!submissionContent.trim() ? '请先填写学习结果或验证证据' : undefined} onClick={() => {
                    const content = submissionContent.trim();
                    if (!content) return;
                    void onSubmitResult(content).then(() => { setSubmissionContent(''); showFeedback('学习结果已提交'); });
                  }}><CheckCircle2 size={16} />提交结果</button>
                </div>
              ) : null}
              {!taskDone && commandPolicy.canSkipTask ? (
                <button className="secondary-action" type="button" onClick={() => {
                  void onSkipCurrentTask().then(() => showFeedback('已跳过此任务'));
                }}>
                  <SkipForward size={16} />
                  跳过此任务
                </button>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
