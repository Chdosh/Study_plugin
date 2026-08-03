import { useEffect, useRef, useState } from 'react';
import { AppShell, AppWindowFrame } from './components/layout/AppShell';
import { RoadmapTree } from './components/layout/RoadmapTree';
import { TeacherSidebar } from './components/layout/TeacherSidebar';
import { StudyPage } from './pages/StudyPage';
import { RecordsPage } from './pages/RecordsPage';
import { OverviewPage } from './pages/OverviewPage';
import { SettingsPage } from './pages/SettingsPage';
import { Drawer } from './components/shared/Drawer';
import type { ViewKey } from './types/navigation';
import { Timer } from 'lucide-react';
import type {
  AppSettings,
  GoalBrief,
  GoalIntakeState,
  KnowledgeItem,
  LearningRuntimeSnapshot,
  QuestionAnswerResult,
  ReviewResult,
  RuntimeAuditResult,
  StudySession,
  LearningOverviewState,
  TeachStepResult,
  LearningGoal,
  ResumableGuideSummary
} from '../../shared/types';
import { hasCompleteAiConfiguration } from '../../shared/types';
import { localDateIso } from '../../shared/date';
import { deriveLearningTaskStatus } from './domain/learning-status';
import './styles.css';

const todayIso = localDateIso();

export default function App(): JSX.Element {
  const [view, setView] = useState<ViewKey>('overview');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [onboarding, setOnboarding] = useState<GoalIntakeState | null>(null);
  const [todayGuide, setTodayGuide] = useState<LearningOverviewState | null>(null);
  const [activeSession, setActiveSession] = useState<StudySession | null>(null);
  const [learningState, setLearningState] = useState<LearningRuntimeSnapshot | null>(null);
  const [teaching, setTeaching] = useState<TeachStepResult | null>(null);
  const [questionAnswer, setQuestionAnswer] = useState<QuestionAnswerResult | null>(null);
  const [temporaryLearning, setTemporaryLearning] = useState<QuestionAnswerResult | null>(null);
  const [backgroundNotice, setBackgroundNotice] = useState<{
    kind: 'success' | 'error';
    message: string;
  } | null>(null);
  const [review, setReview] = useState<ReviewResult | null>(null);
  const [notice, setNotice] = useState<string>('就绪');
  const [bootError, setBootError] = useState<string | null>(null);
  const [runtimeAudit, setRuntimeAudit] = useState<RuntimeAuditResult | null>(null);
  const [teacherCollapsed, setTeacherCollapsed] = useState(false);
  const [roadmapDrawerOpen, setRoadmapDrawerOpen] = useState(false);
  const [teacherDrawerOpen, setTeacherDrawerOpen] = useState(false);
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);
  const [availableGoals, setAvailableGoals] = useState<LearningGoal[]>([]);
  const [resumableGuides, setResumableGuides] = useState<ResumableGuideSummary[]>([]);
  const [onboardingOperationPending, setOnboardingOperationPending] = useState(false);
  const [planGenerating, setPlanGenerating] = useState(false);
  const [askingQuestion, setAskingQuestion] = useState(false);
  const [learningPending, setLearningPending] = useState(false);
  const [recordsReloadKey, setRecordsReloadKey] = useState(0);
  const mountedRef = useRef(false);
  const failedActionRef = useRef<{ label: string; action: () => Promise<void> } | null>(null);

  async function refresh(): Promise<void> {
    if (!window.studyApp) {
      throw new Error('Electron preload API 不可用，请检查主进程里的 preload 路径。');
    }
    const [nextSettings, nextOnboarding, nextTodayGuide, nextLearningState, latestReview, latestTemporary, goals, nextResumableGuides] = await Promise.all([
      window.studyApp.settings.get(),
      window.studyApp.onboarding.getCurrent(),
      window.studyApp.guides.getOverview(),
      window.studyApp.learning.getState(),
      window.studyApp.reviews.getLatest(),
      window.studyApp.learning.getLatestTemporaryQuestion(),
      window.studyApp.data.listGoals(),
      window.studyApp.guides.listResumable()
    ]);
    setSettings(nextSettings);
    setOnboarding(nextOnboarding);
    setTodayGuide(nextTodayGuide);
    setLearningState(nextLearningState);
    setReview((current) => current ?? latestReview);
    setTemporaryLearning(latestTemporary);
    setAvailableGoals(goals);
    setResumableGuides(nextResumableGuides);
    if (nextTodayGuide?.goal?.id && window.studyApp?.knowledge?.listForGoal) {
      try {
        const items = await window.studyApp.knowledge.listForGoal(nextTodayGuide.goal.id);
        setKnowledgeItems(items);
      } catch { /* best-effort */ }
    }
  }

  async function syncActiveSession(): Promise<void> {
    const [active, nextLearningState, nextTodayGuide] = await Promise.all([
      window.studyApp.sessions.getActive(),
      window.studyApp.learning.getState(),
      window.studyApp.guides.getOverview()
    ]);
    setActiveSession(active);
    setLearningState(nextLearningState);
    setTodayGuide(nextTodayGuide);
  }

  async function createAndActivateInitialPlan(briefPatch?: Partial<GoalBrief>): Promise<void> {
    await window.studyApp.onboarding.generateInitialPlan(briefPatch);
  }

  async function runAction(label: string, action: () => Promise<void>): Promise<void> {
    failedActionRef.current = null;
    setBootError(null);
    setNotice(`${label}...`);
    try {
      await action();
      failedActionRef.current = null;
      setBootError(null);
      setNotice(`${label}完成`);
    } catch (error) {
      failedActionRef.current = { label, action };
      const message = toUserErrorMessage(error);
      setBootError(message);
      setNotice(message);
    }
  }

  async function runActionAndReport(label: string, action: () => Promise<void>): Promise<boolean> {
    let completed = false;
    await runAction(label, async () => {
      await action();
      completed = true;
    });
    return completed;
  }

  async function generateInitialPlan(briefPatch?: Partial<GoalBrief>): Promise<void> {
    setPlanGenerating(true);
    try {
      await createAndActivateInitialPlan(briefPatch);
      await refresh();
    } finally {
      setPlanGenerating(false);
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

  async function runLearningAction(label: string, action: () => Promise<void>): Promise<void> {
    if (learningPending) return;
    setLearningPending(true);
    try {
      await runAction(label, action);
    } finally {
      setLearningPending(false);
    }
  }

  const handleAskQuestion = (question: string) => runAction('回答问题', async () => {
    setAskingQuestion(true);
    try {
      const result = await window.studyApp.learning.askQuestion(question);
      setQuestionAnswer(result);
      setLearningState(await window.studyApp.learning.getState());
    } finally {
      setAskingQuestion(false);
    }
  });

  const handleResolveQuestion = (threadId: string) => runAction('结束问题分支', async () => {
    setLearningState(await window.studyApp.learning.resolveQuestion(threadId));
  });

  async function submitResultAndSyncSession(content: string): Promise<void> {
    try {
      const result = await window.studyApp.learning.submitResult(content);
      setLearningState(result.state);
      setTeaching(null);
      setQuestionAnswer(null);
    } finally {
      await refresh();
      await syncActiveSession();
    }
  }

  useEffect(() => {
    void runAction('加载工作区', async () => {
      const audit = await window.studyApp.system.auditRuntime();
      await Promise.all([refresh(), syncActiveSession()]);
      setRuntimeAudit(audit.fixed.length > 0 ? audit : null);
    });
  }, []);


  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    if (view === 'overview') {
      void refresh();
    }
  }, [view]);

  useEffect(() => {
    if (!window.studyApp?.onSessionStateChanged) return;
    const cleanup = window.studyApp.onSessionStateChanged((session) => {
      setActiveSession(session);
      void refresh();
    });
    return cleanup;
  }, []);

  useEffect(() => {
    if (!window.studyApp?.onEvaluationFinished) return;
    return window.studyApp.onEvaluationFinished((notification) => {
      void refresh();
      if (!notification.triggeredByUser) return;
      setBackgroundNotice(notification.status === 'completed'
        ? {
            kind: 'success',
            message: `学习成果的导师反馈已生成：${notification.result.evaluation.feedback}`
          }
        : {
            kind: 'error',
            message: `成果已保存，学习进度不受影响；导师反馈暂未生成：${notification.message}`
          });
    });
  }, []);

  const shellLearningStatus = learningState?.dailyGuideTask
    ? deriveLearningTaskStatus(learningState.dailyGuideTask)
    : null;
  const sessionLabel = activeSession?.status === 'active' || activeSession?.status === 'paused'
    ? shellLearningStatus?.phase && shellLearningStatus.phase !== 'executing'
      ? shellLearningStatus.label
      : activeSession.status === 'paused' ? '已暂停' : '进行中'
    : null;
  const learningContextTitle = [todayGuide?.goal?.title, todayGuide?.currentStage?.title]
    .filter((item): item is string => Boolean(item))
    .join(' / ');
  const shellPageTitle = view === 'overview'
    ? learningContextTitle || '当前学习'
    : view === 'study'
      ? learningState?.dailyGuideTask?.title ?? '当前任务'
      : view === 'records'
        ? '记录'
        : '设置';

  if (!settings) {
    return (
      <AppWindowFrame>
        <div className="boot">
          <Timer size={24} />
          <span>正在加载</span>
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
      </AppWindowFrame>
    );
  }

  return (
    <>
    <AppShell
      current={view}
      pageTitle={shellPageTitle}
      teacherCollapsed={teacherCollapsed}
      onToggleTeacher={() => setTeacherCollapsed((c) => !c)}
      onSelectView={setView}
      sessionLabel={sessionLabel}
      center={
        <main className="canvas">
          <div className="canvas-body">
            {bootError && (
              <div className="global-notice-bar is-error" role="alert" aria-live="assertive">
                <span className="notice-dot" />
                <span>{bootError}</span>
                <div className="global-notice-actions">
                  {failedActionRef.current && (
                    <button type="button" className="secondary-action" onClick={() => {
                      const failed = failedActionRef.current;
                      if (failed) void runAction(`重试${failed.label}`, failed.action);
                    }}>重试</button>
                  )}
                  <button type="button" className="secondary-action" onClick={() => setView('settings')}>打开设置</button>
                </div>
              </div>
            )}
            {backgroundNotice && (
              <div
                className={`global-notice-bar ${backgroundNotice.kind === 'error' ? 'is-error' : ''}`}
                role="status"
                aria-live="polite"
              >
                <span className="notice-dot" />
                <span>{backgroundNotice.message}</span>
                <div className="global-notice-actions">
                  <button
                    type="button"
                    className="secondary-action"
                    onClick={() => setBackgroundNotice(null)}
                  >
                    知道了
                  </button>
                </div>
              </div>
            )}
            {runtimeAudit && (
              <section className="runtime-audit-banner" role="alert">
                <div>
                  <strong>已恢复学习进度</strong>
                  <p>已安全修复 {runtimeAudit.fixed.length} 项可唯一推导的运行位置。</p>
                  {runtimeAudit.guideChoices.length > 1 && <div className="runtime-guide-choices">{runtimeAudit.guideChoices.map((choice) => <article key={choice.guideId} className={choice.isRecommended ? 'recommended' : ''}><div><strong>{choice.dayTitle}</strong><span>{choice.date} · {choice.taskTitle}</span><small>已完成 {choice.completedTaskCount}/{choice.totalTaskCount} 个任务{choice.hasRecentSession ? ' · 最近学习过' : ''}</small></div>{choice.isRecommended && <em>推荐</em>}<button className="primary-action" type="button" onClick={() => void runAction('选择当前学习日', async () => {
                    const audit = await window.studyApp.system.selectCurrentGuide(choice.guideId);
                    setRuntimeAudit(audit.fixed.length > 0 ? audit : null);
                    await Promise.all([refresh(), syncActiveSession()]);
                  })}>继续这个学习日</button></article>)}</div>}
                </div>
                <div className="runtime-audit-actions">
                  <button className="secondary-action" onClick={() => setRuntimeAudit(null)}>
                    知道了
                  </button>
                </div>
              </section>
            )}
            {view === 'overview' && (
              <OverviewPage
                settings={settings}
                onboarding={onboarding}
                todayGuide={todayGuide}
                activeSession={activeSession}
                learningState={learningState}
                onboardingOperationPending={onboardingOperationPending}
                planGenerating={planGenerating}
                onSendOnboarding={async (content) => {
                  setOnboardingOperationPending(true);
                  let nextOnboarding: GoalIntakeState | null = null;
                  try {
                    const completed = await runActionAndReport('理解学习目标', async () => {
                      nextOnboarding = await window.studyApp.onboarding.sendMessage(content);
                      setOnboarding(nextOnboarding);
                    });
                    if (!completed || !nextOnboarding) return;
                  } finally {
                    setOnboardingOperationPending(false);
                  }
                  await refresh();
                }}
                onGenerateInitialPlan={() => runAction(
                  '生成学习计划',
                  () => generateInitialPlan(onboarding?.intake.brief ?? undefined)
                )}
                temporaryLearning={temporaryLearning}
                availableGoals={availableGoals}
                onAskTemporaryQuestion={(question, threadId) => runAction('临时学习', async () => {
                  setTemporaryLearning(await window.studyApp.learning.askTemporaryQuestion(
                    question,
                    undefined,
                    threadId
                  ));
                })}
                onLinkTemporaryQuestionToGoal={(threadId, goalId) => runAction('关联临时学习记录', async () => {
                  setTemporaryLearning(await window.studyApp.learning.linkTemporaryQuestionToGoal(
                    threadId,
                    goalId
                  ));
                  await refresh();
                })}
                onKeepTemporaryQuestion={(threadId) => runAction('保留临时学习记录', async () => {
                  setTemporaryLearning(await window.studyApp.learning.keepTemporaryQuestion(threadId));
                  await refresh();
                })}
                onConvertTemporaryQuestionToTask={(threadId, goalId) => runAction('转成正式 Task', async () => {
                  const converted = await window.studyApp.learning.convertTemporaryQuestionToTask(
                    threadId,
                    goalId
                  );
                  setTemporaryLearning(converted);
                  await refresh();
                })}
                onCancelPendingQuestion={() => runAction('取消 AI 追问', async () => {
                  setOnboarding(await window.studyApp.onboarding.cancelQuestion());
                  await refresh();
                })}
                onConfirmGuide={(guideId) => runAction('确认当前 Learning Guide', async () => {
                  await window.studyApp.guides.confirmLearningGuide(guideId);
                  await refresh();
                  setView('study');
                })}
                onArchiveTodayAndRestart={() => runAction('归档计划并重新开始', async () => {
                  setOnboarding(await window.studyApp.guides.resetLearningWorkspace());
                  await refresh();
                  setActiveSession(null); setReview(null);
                  setQuestionAnswer(null); setTeaching(null);
                })}
                onNavigate={setView}
                onPrepareCurrentLearningDay={() => runAction('重新生成当前学习单元', async () => {
                  const result = await window.studyApp.guides.prepareCurrentLearningUnit(true);
                  await refresh();
                  if (result.preparationState === 'generation_failed') {
                    throw new Error(result.errorMessage ?? '当前学习单元生成失败，目标和计划已保留。');
                  }
                })}
                knowledgeItems={knowledgeItems}
              />
            )}
            {view === 'study' && (
              <StudyPage
                todayGuide={todayGuide}
                activeSession={activeSession}
                learningState={learningState}
                teaching={teaching}
                questionAnswer={questionAnswer}
                learningPending={learningPending}
                onStartSession={(taskId) => runLearningAction('开始学习', async () => {
                  if (todayGuide?.guide?.status === 'draft') {
                    await window.studyApp.guides.confirmLearningGuide(todayGuide.guide.id);
                  }
                  const session = await window.studyApp.sessions.start(taskId);
                  setActiveSession(session);
                  await refresh();
                  try {
                    const result = await window.studyApp.learning.teachCurrentStep();
                    setTeaching(result);
                    setLearningState(await window.studyApp.learning.getState());
                  } catch (error) {
                    setLearningState(await window.studyApp.learning.getState());
                    throw new Error(
                      `学习已经开始，但导师讲解加载失败：${error instanceof Error ? error.message : String(error)}`
                    );
                  }
                })}
                onPauseSession={() => activeSession
                  ? runAction('暂停学习', async () => {
                      const session = await window.studyApp.sessions.pause(activeSession.id);
                      setActiveSession(session);
                      await syncActiveSession();
                    })
                  : Promise.resolve()}
                onResumeSession={() => activeSession?.taskId
                  ? runAction('恢复学习', async () => {
                      const session = await window.studyApp.sessions.start(activeSession.taskId!);
                      setActiveSession(session);
                      await syncActiveSession();
                    })
                  : Promise.resolve()}
                onEndSession={() => activeSession
                  ? runAction('结束本次 Session', async () => {
                      const session = await window.studyApp.sessions.end(activeSession.id);
                      setActiveSession(session);
                      await refresh();
                      await syncActiveSession();
                    })
                  : Promise.resolve()}
                onTeachStep={() => runLearningAction('展开当前步骤', async () => {
                  const result = await window.studyApp.learning.teachCurrentStep();
                  setTeaching(result);
                  setLearningState(await window.studyApp.learning.getState());
                })}
                onResumeLearningTurn={(pendingInteractionId, answer, expectedContextVersion) =>
                  runLearningAction('继续本轮学习', async () => {
                    const result = await window.studyApp.learning.resumeLearningTurn(
                      pendingInteractionId,
                      answer,
                      expectedContextVersion
                    );
                    setTeaching(result);
                    setLearningState(await window.studyApp.learning.getState());
                  })}
                onCancelLearningTurn={(pendingInteractionId) =>
                  runAction('取消导师询问', async () => {
                    await window.studyApp.learning.cancelLearningTurn(pendingInteractionId);
                    setTeaching(null);
                  })}
                onCompleteCurrentAction={(actionId) => runLearningAction('完成当前步骤', async () => {
                  const nextState = await window.studyApp.learning.completeCurrentAction(actionId);
                  setLearningState(nextState);
                  await refresh();
                  setTeaching(null);
                  if (nextState.dailyGuideAction) {
                    try {
                      const result = await window.studyApp.learning.teachCurrentStep();
                      setTeaching(result);
                      setLearningState(await window.studyApp.learning.getState());
                    } catch (error) {
                      setLearningState(await window.studyApp.learning.getState());
                      setBackgroundNotice({
                        kind: 'error',
                        message: `步骤已推进；下一步讲解加载失败：${error instanceof Error ? error.message : String(error)}`
                      });
                    }
                  }
                })}
                onSkipCurrentAction={(actionId) => runLearningAction('跳过当前步骤', async () => {
                  const nextState = await window.studyApp.learning.skipCurrentAction(actionId);
                  setLearningState(nextState);
                  await refresh();
                  setTeaching(null);
                  if (nextState.dailyGuideAction) {
                    try {
                      const result = await window.studyApp.learning.teachCurrentStep();
                      setTeaching(result);
                      setLearningState(await window.studyApp.learning.getState());
                    } catch (error) {
                      setLearningState(await window.studyApp.learning.getState());
                      setBackgroundNotice({
                        kind: 'error',
                        message: `步骤已跳过；下一步讲解加载失败：${error instanceof Error ? error.message : String(error)}`
                      });
                    }
                  }
                })}
                onAskQuestion={handleAskQuestion}
                onResolveQuestion={handleResolveQuestion}
                onSubmitResult={(content) => runAction('提交学习结果', async () => {
                  await submitResultAndSyncSession(content);
                })}
                onOpenTeacher={() => setTeacherDrawerOpen(true)}
                onOpenRoadmap={() => setRoadmapDrawerOpen(true)}
              />
            )}
            {view === 'records' && (
              <RecordsPage
                review={review}
                todayGuide={todayGuide}
                learningState={learningState}
                availableGoals={availableGoals}
                resumableGuides={resumableGuides}
                onRestoreArchivedGuide={(guideId) => runAction('恢复历史学习任务', async () => {
                  await window.studyApp.guides.restoreArchivedGuide(guideId);
                  setReview(null);
                  await refresh();
                  setRecordsReloadKey((key) => key + 1);
                  setView('study');
                })}
                pendingAdjustment={learningState?.pendingAdjustment ?? null}
                onGenerate={() => runAction('生成复盘', async () => {
                  setReview(await window.studyApp.reviews.generate(todayIso));
                })}
                hasAiConfiguration={hasCompleteAiConfiguration(settings)}
                onDecideAdjustment={(proposalId, status) => runAction(status === 'accepted' ? '接受调整建议' : '拒绝调整建议', async () => {
                  await window.studyApp.learning.decideAdjustment(proposalId, status);
                  await refresh();
                  setRecordsReloadKey((key) => key + 1);
                })}
                onDecideEvaluationRecommendation={(evaluationId, decision) => runAction(
                  decision === 'accepted' ? '采纳导师推荐' : decision === 'declined' ? '不采纳导师推荐' : '暂缓导师推荐',
                  async () => {
                    await window.studyApp.learning.decideEvaluationRecommendation(evaluationId, decision);
                    await refresh();
                    setRecordsReloadKey((key) => key + 1);
                  }
                )}
                onRetryEvaluation={(submissionId) => runAction('重试导师评价', async () => {
                  await window.studyApp.learning.retryEvaluation(submissionId);
                  await refresh();
                  setRecordsReloadKey((key) => key + 1);
                })}
                onConfirmRoadmapStage={(stageId) => runAction('确认阶段成果', async () => {
                  if (!todayGuide?.goal?.id) throw new Error('没有活跃的学习目标。');
                  await window.studyApp.data.confirmRoadmapStage(todayGuide.goal.id, stageId);
                  await refresh();
                })}
                onApplyPlanAdjustments={async (adjustments) => {
                  return runActionWithResult('应用计划调整', async () => {
                    if (!todayGuide?.goal?.id) throw new Error('没有活跃的学习目标。');
                    const proposal = await window.studyApp.data.createPlanProposal(todayGuide.goal.id, {
                      reason: '用户在复盘页确认采纳 AI 计划调整建议',
                      adjustments
                    });
                    const confirmed = await window.studyApp.data.confirmPlanProposal(proposal.id);
                    await refresh();
                    return confirmed.appliedAt ? 1 : 0;
                  });
                }}
                onGenerateRollingPlan={() => runAction('生成下一批任务', async () => {
                  if (!todayGuide?.goal?.id) throw new Error('没有活跃的学习目标。');
                  await window.studyApp.guides.generateRollingPlan(todayGuide.goal.id);
                  await refresh();
                })}
                knowledgeItems={knowledgeItems}
                onSetKnowledgeStatus={(itemId, status) => runAction('更新知识判断', async () => {
                  await window.studyApp.knowledge.setStatus(itemId, status);
                  await refresh();
                })}
                reloadKey={recordsReloadKey}
              />
            )}
            {view === 'settings' && (
              <SettingsPage settings={settings} runAction={runAction} onSaved={refresh} />
            )}
          </div>
        </main>
      }
      teacher={view === 'study' && !teacherDrawerOpen ? (
        <TeacherSidebar
          knowledgeItems={knowledgeItems}
          collapsed={teacherCollapsed}
          onToggleCollapse={() => setTeacherCollapsed((c) => !c)}
          onAskQuestion={handleAskQuestion}
          contextSummary={learningState?.dailyGuideAction?.title ?? learningState?.dailyGuideTask?.title}
          questionAnswer={questionAnswer}
          isAsking={askingQuestion}
        />
      ) : undefined}
    />
    <Drawer open={roadmapDrawerOpen} title="学习大纲" onClose={() => setRoadmapDrawerOpen(false)}>
        <RoadmapTree stages={todayGuide?.roadmap ?? []} nearTermPlanItems={todayGuide?.shortPlan ?? []} />
      </Drawer>
      <Drawer open={teacherDrawerOpen} title="AI 导师" onClose={() => setTeacherDrawerOpen(false)}>
        <TeacherSidebar knowledgeItems={knowledgeItems} collapsed={false} onToggleCollapse={() => setTeacherDrawerOpen(false)} contextSummary={learningState?.dailyGuideAction?.title ?? learningState?.dailyGuideTask?.title} questionAnswer={questionAnswer} isAsking={askingQuestion} onAskQuestion={handleAskQuestion} />
    </Drawer>
    </>
  );
}

function toUserErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const withoutIpcPrefix = raw.replace(/^Error invoking remote method '[^']+':\s*/u, '');
  const categorized = describeError(withoutIpcPrefix);

  switch (categorized.category) {
    case 'missing_config':
      return '缺少 AI API Key。请先在"设置"里填写当前 AI 服务的密钥，再运行 AI 功能。';
    case 'schema_violation':
      return categorized.message;
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
  if (/AI API Key|API [Kk]ey|缺少|密钥/i.test(message)) {
    return { category: 'missing_config', message };
  }
  if (/格式校验|校验问题|结构不完整|格式不完整|ZodError|invalid_type|invalid_union|schema_violation|不是合法 JSON/i.test(message)) {
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
