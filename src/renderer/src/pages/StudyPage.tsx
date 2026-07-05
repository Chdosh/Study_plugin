import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronRight,
  Circle,
  CircleCheck,
  CircleDot,
  ClipboardList,
  Clock3,
  HelpCircle,
  Pause,
  Play,
  Square
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
import { getSessionElapsedSeconds } from '../float-behavior';
import type { ViewKey } from '../types/navigation';

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


export function StudyPage({
  todayGuide,
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
  const guide = todayGuide?.guide ?? null;
  const currentSelection = guide ? getCurrentGuideTaskSelection(guide.tasks, activeSession, learningState) : null;
  const currentPlanBlockId = currentSelection?.planBlockId ?? activeSession?.blockId ?? null;

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
  const taskTitle = toCompactTitle(currentTask?.title ?? '当前任务');
  const currentAction = taskActions[stepIndex] ?? taskActions[0] ?? null;
  const taskObjective = currentTask?.objective ?? '';
  const stepTitle = taskDone
    ? '主任务已完成'
    : allActionsDone
      ? '等待提交当前结果'
    : (currentStepBelongsToTask ? currentStep?.title : null) ?? currentAction?.title ?? '当前步骤';
  const stepInstruction = taskDone
    ? '当前主任务已经通过评价。若还有下一个主任务，可以从今日页继续下一项。'
    : allActionsDone
      ? '当前主任务的行动步骤已经完成。下一步需要提交当前结果，由 AI 评价后决定完成或继续修改。'
    : (currentStepBelongsToTask ? currentStep?.instruction : null) ?? currentAction?.instruction ?? '按当前步骤说明推进。';
  const stepCriteria = taskDone
    ? submissionResult?.evaluation.feedback ?? learningState?.latestEvaluation?.feedback ?? currentTask?.doneWhen.join('\n') ?? ''
    : allActionsDone
      ? currentTask?.doneWhen.join('\n') ?? ''
    : (currentStepBelongsToTask ? currentStep?.successCriteria : null) ?? currentAction?.checkpoint ?? '';
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

  if (!guide) {
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
