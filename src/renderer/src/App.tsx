import { useCallback, useEffect, useRef, useState } from 'react';
import { AiDrawer } from './components/ai/AiDrawer';
import { AppShell } from './components/layout/AppShell';
import { StudyPage } from './pages/StudyPage';
import { ReviewPage } from './pages/ReviewPage';
import { SettingsPage } from './pages/SettingsPage';
import { OverviewPage } from './pages/TodayPage';
import type { ViewKey } from './types/navigation';
import { Timer } from 'lucide-react';
import type {
  AppSettings,
  GoalBrief,
  GoalIntakeState,
  LearningRuntimeSnapshot,
  QuestionAnswerResult,
  ReviewResult,
  SubmissionEvaluationResult,
  StudySession,
  TodayGuideState,
  TeachStepResult
} from '../../shared/types';
import { localDateIso } from '../../shared/date';
import './styles.css';


const todayIso = localDateIso();

export default function App(): JSX.Element {
  const [view, setView] = useState<ViewKey>('overview');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [onboarding, setOnboarding] = useState<GoalIntakeState | null>(null);
  const [todayGuide, setTodayGuide] = useState<TodayGuideState | null>(null);
  const [activeSession, setActiveSession] = useState<StudySession | null>(null);
  const [learningState, setLearningState] = useState<LearningRuntimeSnapshot | null>(null);
  const [teaching, setTeaching] = useState<TeachStepResult | null>(null);
  const [questionAnswer, setQuestionAnswer] = useState<QuestionAnswerResult | null>(null);
  const [submissionResult, setSubmissionResult] = useState<SubmissionEvaluationResult | null>(null);
  const [review, setReview] = useState<ReviewResult | null>(null);
  const [reviewGuide, setReviewGuide] = useState<TodayGuideState | null>(null);
  const [notice, setNotice] = useState<string>('就绪');
  const [bootError, setBootError] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const mountedRef = useRef(false);
  const [showAiDrawer, setShowAiDrawer] = useState(false);
  const [aiDrawerInitialTab, setAiDrawerInitialTab] = useState<'question' | 'submission'>('question');
  const handleOpenDrawer = useCallback((tab: 'question' | 'submission' = 'question'): void => {
    setAiDrawerInitialTab(tab);
    setShowAiDrawer(true);
  }, []);
  const handleCloseDrawer = useCallback((): void => setShowAiDrawer(false), []);

  async function refresh(): Promise<void> {
    if (!window.studyApp) {
      throw new Error('Electron preload API 不可用，请检查主进程里的 preload 路径。');
    }
    const [nextSettings, nextOnboarding, nextTodayGuide, nextLearningState, latestReview] = await Promise.all([
      window.studyApp.settings.get(),
      window.studyApp.onboarding.getCurrent(),
      window.studyApp.guides.listToday(),
      window.studyApp.learning.getState(),
      window.studyApp.reviews.getLatest()
    ]);
    setSettings(nextSettings);
    setOnboarding(nextOnboarding);
    setTodayGuide(nextTodayGuide);
    setLearningState(nextLearningState);
    setReview((current) => current ?? latestReview);
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

  async function submitResultAndSyncSession(content: string): Promise<void> {
    try {
      const result = await window.studyApp.learning.submitResult(content);
      setSubmissionResult(result);
      setTeaching(null);
      setQuestionAnswer(null);
    } finally {
      await refresh();
      await syncActiveSession();
    }
  }

  async function runActionWithResult<T>(label: string, action: () => Promise<T>): Promise<T> {
    setNotice(`${label}...`);
    try {
      const result = await action();
      setBootError(null);
      setNotice(`${label}完成`);
      return result;
    } catch (error) {
      const message = toUserErrorMessage(error);
      setBootError(message);
      setNotice(message);
      throw error;
    }
  }

  async function retrySubmissionEvaluationAndSyncSession(submissionId: string): Promise<void> {
    try {
      const result = await window.studyApp.learning.retrySubmissionEvaluation(submissionId);
      setSubmissionResult(result);
      setTeaching(null);
      setQuestionAnswer(null);
    } finally {
      await refresh();
      await syncActiveSession();
    }
  }

  useEffect(() => {
    void runAction('加载工作区', async () => {
      await refresh();
      await syncActiveSession();
    });
  }, []);

  // Refresh data when navigating back to today (skip initial mount)
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    if (view === 'overview') {
      void refresh();
    }
  }, [view]);

  // Keep renderer state aligned with the single main-process session source.
  useEffect(() => {
    if (!window.studyApp?.onSessionStateChanged) return;
    const cleanup = window.studyApp.onSessionStateChanged((data) => {
      setActiveSession(data.session);
      void refresh();
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
    <AppShell
      current={view}
      collapsed={sidebarCollapsed}
      workspaceClassName={view === 'overview' && todayGuide?.guide ? 'workspace overview-workspace' : 'workspace'}
      onToggleSidebar={() => setSidebarCollapsed((c) => !c)}
      onSelectView={setView}
>
        {notice !== '就绪' && (
          <div className={`global-notice-bar ${bootError ? 'is-error' : ''}`} role="status" aria-live="polite">
            <span className="notice-dot" />
            {notice}
          </div>
        )}
        {view === 'overview' && (
          <OverviewPage
            settings={settings}
            onboarding={onboarding}
            todayGuide={todayGuide}
            activeSession={activeSession}
            learningState={learningState}
            runAction={runAction}
            onSendOnboarding={(content) =>
              runAction('访谈目标', async () => {
                setOnboarding(await window.studyApp.onboarding.sendMessage(content));
                await refresh();
              })
            }
            onConfirmGoal={(briefPatch) =>
              runAction('确认目标并生成计划', async () => {
                const result = await window.studyApp.onboarding.confirmGoal(briefPatch);
                try {
                  await window.studyApp.guides.generateLayeredPlan(result.goal.id);
                } finally {
                  await refresh();
                }
              })
            }
            onGenerateLayeredPlan={(goalId) =>
              runAction('生成分层计划', async () => {
                await window.studyApp.guides.generateLayeredPlan(goalId);
                await refresh();
              })
            }
            onConfirmGuide={(guideId) =>
              runAction('确认今日执行稿', async () => {
                await window.studyApp.guides.confirmDailyGuide(guideId);
                await refresh();
              })
            }
            onArchiveTodayAndRestart={() =>
              runAction('归档计划并重新开始', async () => {
                setOnboarding(await window.studyApp.guides.archiveTodayAndRestart());
                await refresh();
                setActiveSession(null);
                setReviewGuide(null);
                setReview(null);
                setSubmissionResult(null);
                setQuestionAnswer(null);
                setTeaching(null);
              })
            }
            onGenerateRollingPlan={() =>
              runAction('生成下一批任务', async () => {
                if (!todayGuide?.goal?.id) {
                  throw new Error('没有活跃的学习目标。');
                }
                await window.studyApp.guides.generateRollingPlan(todayGuide.goal.id);
                await refresh();
              })
            }
            onNavigate={setView}
            onPrepareCurrentLearningDay={() =>
              runAction('重新生成当前学习单元', async () => {
                const result = await window.studyApp.guides.prepareCurrentLearningDay(true);
                await refresh();
                if (result.todayState !== 'active') {
                  throw new Error(result.errorMessage ?? '当前学习单元仍未生成成功，请稍后重试。');
                }
              })
            }
          />
        )}
        {view === 'study' && (
          <StudyPage
            todayGuide={todayGuide}
            activeSession={activeSession}
            learningState={learningState}
            teaching={teaching}
            questionAnswer={questionAnswer}
            submissionResult={submissionResult}
            onStartSession={(taskId) =>
              runAction('开始学习', async () => {
                if (todayGuide?.guide?.status === 'draft') {
                  await window.studyApp.guides.confirmDailyGuide(todayGuide.guide.id);
                }
                const session = await window.studyApp.sessions.start(taskId);
                setActiveSession(session);
                await refresh();
              })
            }
            onPauseSession={() =>
              activeSession
                ? runAction('暂停学习', async () => {
                    const session = await window.studyApp.sessions.pause(activeSession.id);
                    setActiveSession(session);
                    await syncActiveSession();
                  })
                : Promise.resolve()
            }
            onResumeSession={() =>
              activeSession?.taskId
                ? runAction('恢复学习', async () => {
                    const session = await window.studyApp.sessions.start(activeSession.taskId!);
                    setActiveSession(session);
                    await syncActiveSession();
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
                await refresh();
                setTeaching(null);
              })
            }
            onSkipCurrentAction={() =>
              runAction('跳过当前步骤', async () => {
                setLearningState(await window.studyApp.learning.skipCurrentAction());
                await refresh();
                setTeaching(null);
              })
            }
            onSkipCurrentTask={() =>
              runAction('跳过当前任务', async () => {
                setLearningState(await window.studyApp.learning.skipCurrentTask());
                await refresh();
                setTeaching(null);
              })
            }
            onStartNextSession={() =>
              runAction('生成下一批任务', async () => {
                const closedGuideSnapshot = todayGuide;
                const result = await window.studyApp.guides.startNextSession();
                if (result?.review) {
                  setReview(result.review);
                  setReviewGuide(closedGuideSnapshot);
                }
                if (result.todayState === 'plan_exhausted') {
                  setNotice(result.errorMessage ?? '当前批次任务已完成，请前往复盘页。');
                  await refresh();
                  return;
                }
                if (result.todayState !== 'active') {
                  await refresh();
                  throw new Error(result.errorMessage ?? '下一学习日还没有生成成功，请稍后重试。');
                }
                await refresh();
                setTeaching(null);
                setQuestionAnswer(null);
                setSubmissionResult(null);
              })
            }
            onTerminateLearning={() =>
              runAction('终止学习', async () => {
                setLearningState(await window.studyApp.learning.terminateLearning());
                await refresh();
                setActiveSession(null);
                setTeaching(null);
              })
            }
            onAskQuestion={(question) =>
              runAction('回答提问', async () => {
                const result = await window.studyApp.learning.askQuestion(question);
                setQuestionAnswer(result);
                setLearningState(await window.studyApp.learning.getState());
              })
            }
            onResolveQuestion={(threadId) =>
              runAction('结束问题分支', async () => {
                setLearningState(await window.studyApp.learning.resolveQuestion(threadId));
              })
            }
            onSubmitResult={(content) =>
              runAction('提交学习结果', async () => {
                await submitResultAndSyncSession(content);
              })
            }
            onRetrySubmissionEvaluation={(submissionId) =>
              runAction('重新评价提交', async () => {
                await retrySubmissionEvaluationAndSyncSession(submissionId);
              })
            }
            onOpenDrawer={handleOpenDrawer}
            onGenerateRollingPlan={() =>
              runAction('生成下一批任务', async () => {
                if (!todayGuide?.goal?.id) {
                  throw new Error('没有活跃的学习目标。');
                }
                await window.studyApp.guides.generateRollingPlan(todayGuide.goal.id);
                await refresh();
                setTeaching(null);
                setQuestionAnswer(null);
                setSubmissionResult(null);
              })
            }
          />
        )}
        {view === 'review' && (
          <ReviewPage
            review={review}
            todayGuide={todayGuide}
            reviewGuide={reviewGuide}
            pendingAdjustment={learningState?.pendingAdjustment ?? null}
            onGenerate={() =>
              runAction('生成复盘', async () => {
                setReview(await window.studyApp.reviews.generate(todayIso));
                setReviewGuide(todayGuide);
              })
            }
            hasApiKey={settings.hasDeepseekApiKey}
            onDecideAdjustment={(proposalId, status) =>
              runAction(status === 'accepted' ? '接受调整建议' : '拒绝调整建议', async () => {
                await window.studyApp.learning.decideAdjustment(proposalId, status);
                await refresh();
              })
            }
            onGenerateRollingPlan={() =>
              runAction('生成下一批任务', async () => {
                if (!todayGuide?.goal?.id) {
                  throw new Error('没有活跃的学习目标。');
                }
                await window.studyApp.guides.generateRollingPlan(todayGuide.goal.id);
                await refresh();
                setView('study');
              })
            }
            onApplyPlanAdjustments={async (adjustments) => {
              return runActionWithResult('应用计划调整', async () => {
                if (!todayGuide?.goal?.id) {
                  throw new Error('没有活跃的学习目标。');
                }
                const updated = await window.studyApp.reviews.applyAdjustments(todayGuide.goal.id, adjustments);
                await refresh();
                return updated.length;
              });
            }}
          />
        )}
        {view === 'settings' && (
          <SettingsPage
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
              await submitResultAndSyncSession(content);
            })
          }
          onRetrySubmissionEvaluation={(submissionId) =>
            runAction('重新评价提交', async () => {
              await retrySubmissionEvaluationAndSyncSession(submissionId);
            })
          }
        />
    </AppShell>
  );
}

function toUserErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const withoutIpcPrefix = raw.replace(/^Error invoking remote method '[^']+':\s*/u, '');
  const categorized = describeError(withoutIpcPrefix);

  switch (categorized.category) {
    case 'missing_config':
      return '缺少 DeepSeek API Key。请先在“设置”里填写密钥，再运行 AI 功能。';
    case 'schema_violation':
      return 'AI 返回内容格式不完整，已阻止写入正式计划。请重试，或在设置里调整提示词档位。';
    case 'user_input_error':
      return categorized.message;
    case 'validation_error':
      return categorized.message;
    case 'db_error':
      return '数据保存失败，请重试。如果问题持续，请检查本地数据库权限。';
    case 'ai_failure':
    default:
      if (/timeout|超时/i.test(categorized.message)) {
        return 'AI 响应超时，请稍后重试。';
      }
      return categorized.message.length > 240
        ? `${categorized.message.slice(0, 240)}...`
        : categorized.message;
  }
}

function describeError(message: string): { category: string; message: string } {
  if (/DeepSeek API Key|API [Kk]ey|缺少|密钥/i.test(message)) {
    return { category: 'missing_config', message };
  }
  if (/JSON|schema|valid|parse|required|expected|格式/i.test(message)) {
    return { category: 'schema_violation', message };
  }
  if (/timeout|超时|timed out|ECONNRESET/i.test(message)) {
    return { category: 'ai_failure', message };
  }
  if (/不能为空|必须填写|没有学习步骤|无法提问/i.test(message)) {
    return { category: 'user_input_error', message };
  }
  return { category: 'ai_failure', message };
}
