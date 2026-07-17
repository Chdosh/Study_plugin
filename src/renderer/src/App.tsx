import { useEffect, useRef, useState } from 'react';
import { AppShell } from './components/layout/AppShell';
import { RoadmapTree } from './components/layout/RoadmapTree';
import { TeacherSidebar } from './components/layout/TeacherSidebar';
import { StudyPage } from './pages/StudyPage';
import { RecordsPage } from './pages/RecordsPage';
import { OverviewPage } from './pages/TodayPage';
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
  SubmissionEvaluationResult,
  StudySession,
  TodayGuideState,
  TeachStepResult
} from '../../shared/types';
import { localDateIso } from '../../shared/date';
import { deriveLearningTaskStatus } from './domain/learning-status';
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
  const [notice, setNotice] = useState<string>('就绪');
  const [bootError, setBootError] = useState<string | null>(null);
  const [runtimeAudit, setRuntimeAudit] = useState<RuntimeAuditResult | null>(null);
  const [teacherCollapsed, setTeacherCollapsed] = useState(false);
  const [roadmapDrawerOpen, setRoadmapDrawerOpen] = useState(false);
  const [teacherDrawerOpen, setTeacherDrawerOpen] = useState(false);
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);
  const mountedRef = useRef(false);
  const failedActionRef = useRef<{ label: string; action: () => Promise<void> } | null>(null);

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
      const audit = await window.studyApp.system.auditRuntime();
      await Promise.all([refresh(), syncActiveSession()]);
      setRuntimeAudit(audit.fixed.length > 0 || audit.requiresUserAction ? audit : null);
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
    const cleanup = window.studyApp.onSessionStateChanged((data) => {
      setActiveSession(data.session);
      void refresh();
    });
    return cleanup;
  }, []);

  function canvasTitle(): string {
    if (view === 'overview') return todayGuide?.goal?.title ?? '学习概览';
    if (view === 'study') return learningState?.dailyGuideTask?.title ?? '当前任务';
    if (view === 'records') return '';
    return '设置';
  }

  const shellLearningStatus = learningState?.dailyGuideTask ? deriveLearningTaskStatus(learningState.dailyGuideTask, learningState.latestSubmission ? {
    evaluationStatus: learningState.latestSubmission.evaluationStatus,
    evaluationResult: learningState.latestEvaluation?.result
  } : null) : null;
  const sessionLabel = activeSession?.status === 'active' || activeSession?.status === 'paused'
    ? shellLearningStatus?.phase && shellLearningStatus.phase !== 'executing'
      ? shellLearningStatus.label
      : activeSession.status === 'paused' ? '已暂停' : '进行中'
    : null;

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
    <>
    <AppShell
      current={view}
      teacherCollapsed={teacherCollapsed}
      onToggleTeacher={() => setTeacherCollapsed((c) => !c)}
      onSelectView={setView}
      sessionLabel={sessionLabel}
      center={
        <main className="canvas">
          <div className={`canvas-hdr ${view === 'settings' || view === 'records' || view === 'study' || view === 'overview' ? 'is-settings' : ''}`}>
            <div className="canvas-hdr-title">{canvasTitle()}</div>
          </div>
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
            {runtimeAudit && (
              <section className={`runtime-audit-banner ${runtimeAudit.requiresUserAction ? 'has-conflict' : ''}`} role="alert">
                <div>
                  <strong>{runtimeAudit.requiresUserAction ? '学习进度需要确认' : '已恢复学习进度'}</strong>
                  <p>
                    {runtimeAudit.requiresUserAction
                      ? '发现无法自动判断的学习状态，系统没有删除数据或推进任务。'
                      : `已安全修复 ${runtimeAudit.fixed.length} 项可唯一推导的运行位置。`}
                  </p>
                  {runtimeAudit.guideChoices.length > 1 && <div className="runtime-guide-choices">{runtimeAudit.guideChoices.map((choice) => <article key={choice.guideId} className={choice.isRecommended ? 'recommended' : ''}><div><strong>{choice.dayTitle}</strong><span>{choice.date} · {choice.taskTitle}</span><small>已完成 {choice.completedTaskCount}/{choice.totalTaskCount} 个任务{choice.hasRecentSession ? ' · 最近学习过' : ''}</small></div>{choice.isRecommended && <em>推荐</em>}<button className="primary-action" type="button" onClick={() => void runAction('选择当前学习日', async () => {
                    const audit = await window.studyApp.system.selectCurrentGuide(choice.guideId);
                    setRuntimeAudit(audit.fixed.length > 0 || audit.requiresUserAction ? audit : null);
                    await Promise.all([refresh(), syncActiveSession()]);
                  })}>继续这个学习日</button></article>)}</div>}
                  {runtimeAudit.learningUnitChoices.length > 0 && <div className="runtime-guide-choices">{runtimeAudit.learningUnitChoices.map((choice) => <article key={choice.guideId}><div><strong>{choice.dayTitle}</strong><span>{choice.date} · {choice.taskTitles.join('、')}</span><small>已完成 {choice.completedTaskCount} · 已跳过 {choice.skippedTaskCount} · 共 {choice.totalTaskCount} 个任务</small></div><button className="primary-action" type="button" onClick={() => void runAction('恢复历史学习单元', async () => {
                    const audit = await window.studyApp.system.resolveLearningUnit(choice.guideId, 'restore');
                    setRuntimeAudit(audit.fixed.length > 0 || audit.requiresUserAction ? audit : null);
                    await Promise.all([refresh(), syncActiveSession()]);
                  })}>恢复此单元</button><button className="secondary-action" type="button" onClick={() => void runAction('确认跳过历史学习单元', async () => {
                    const audit = await window.studyApp.system.resolveLearningUnit(choice.guideId, 'skip');
                    setRuntimeAudit(audit.fixed.length > 0 || audit.requiresUserAction ? audit : null);
                    await Promise.all([refresh(), syncActiveSession()]);
                  })}>确认跳过</button></article>)}</div>}
                  {runtimeAudit.conflicts.some((conflict) => conflict.field !== 'dailyGuides.current' && conflict.field !== 'learningUnits.lifecycle') && <small>另有学习状态需要确认。系统已保留数据，请重新检查。</small>}
                </div>
                <div className="runtime-audit-actions">
                  {runtimeAudit.requiresUserAction && (
                    <button className="secondary-action" onClick={() => void runAction('重新检查学习进度', async () => {
                      const audit = await window.studyApp.system.auditRuntime();
                      setRuntimeAudit(audit.fixed.length > 0 || audit.requiresUserAction ? audit : null);
                      await refresh();
                    })}>重新检查</button>
                  )}
                  <button className="secondary-action" onClick={() => setRuntimeAudit(null)}>
                    {runtimeAudit.requiresUserAction ? '保留数据，稍后处理' : '知道了'}
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
                runAction={runAction}
                onSendOnboarding={(content) => runAction('访谈目标', async () => {
                  setOnboarding(await window.studyApp.onboarding.sendMessage(content));
                  await refresh();
                })}
                onConfirmGoal={(briefPatch) => runAction('确认目标并生成计划', async () => {
                  const result = await window.studyApp.onboarding.confirmGoal(briefPatch);
                  try { await window.studyApp.guides.generateLayeredPlan(result.goal.id); }
                  finally { await refresh(); }
                })}
                onGenerateLayeredPlan={(goalId) => runAction('生成分层计划', async () => {
                  await window.studyApp.guides.generateLayeredPlan(goalId);
                  await refresh();
                })}
                onConfirmGuide={(guideId) => runAction('确认今日执行稿', async () => {
                  await window.studyApp.guides.confirmDailyGuide(guideId);
                  await refresh();
                })}
                onArchiveTodayAndRestart={() => runAction('归档计划并重新开始', async () => {
                  setOnboarding(await window.studyApp.guides.archiveTodayAndRestart());
                  await refresh();
                  setActiveSession(null); setReview(null);
                  setSubmissionResult(null); setQuestionAnswer(null); setTeaching(null);
                })}
                onGenerateRollingPlan={() => runAction('生成下一批任务', async () => {
                  if (!todayGuide?.goal?.id) throw new Error('没有活跃的学习目标。');
                  await window.studyApp.guides.generateRollingPlan(todayGuide.goal.id);
                  await refresh();
                })}
                onNavigate={setView}
                onPrepareCurrentLearningDay={() => runAction('重新生成当前学习单元', async () => {
                  const result = await window.studyApp.guides.prepareCurrentLearningDay(true);
                  await refresh();
                  if (result.todayState !== 'active') throw new Error(result.errorMessage ?? '当前学习单元仍未生成成功，请稍后重试。');
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
                submissionResult={submissionResult}
                onStartSession={(taskId) => runAction('开始学习', async () => {
                  if (todayGuide?.guide?.status === 'draft') {
                    await window.studyApp.guides.confirmDailyGuide(todayGuide.guide.id);
                  }
                  const session = await window.studyApp.sessions.start(taskId);
                  setActiveSession(session);
                  await refresh();
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
                onTeachStep={() => runAction('展开当前步骤', async () => {
                  const result = await window.studyApp.learning.teachCurrentStep();
                  setTeaching(result);
                  setLearningState(await window.studyApp.learning.getState());
                })}
                onCompleteCurrentAction={() => runAction('完成当前步骤', async () => {
                  setLearningState(await window.studyApp.learning.completeCurrentAction());
                  await refresh();
                  setTeaching(null);
                })}
                onSkipCurrentAction={() => runAction('跳过当前步骤', async () => {
                  setLearningState(await window.studyApp.learning.skipCurrentAction());
                  await refresh();
                  setTeaching(null);
                })}
                onSkipCurrentTask={() => runAction('跳过当前任务', async () => {
                  setLearningState(await window.studyApp.learning.skipCurrentTask());
                  await refresh();
                  await syncActiveSession();
                  setTeaching(null);
                })}
                onAskQuestion={(question) => runAction('回答提问', async () => {
                  const result = await window.studyApp.learning.askQuestion(question);
                  setQuestionAnswer(result);
                  setLearningState(await window.studyApp.learning.getState());
                })}
                onResolveQuestion={(threadId) => runAction('结束问题分支', async () => {
                  setLearningState(await window.studyApp.learning.resolveQuestion(threadId));
                })}
                onSubmitResult={(content) => runAction('提交学习结果', async () => {
                  await submitResultAndSyncSession(content);
                })}
                onRetrySubmissionEvaluation={(submissionId) => runAction('重新评价提交', async () => {
                  await retrySubmissionEvaluationAndSyncSession(submissionId);
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
                pendingAdjustment={learningState?.pendingAdjustment ?? null}
                onGenerate={() => runAction('生成复盘', async () => {
                  setReview(await window.studyApp.reviews.generate(todayIso));
                })}
                hasApiKey={settings.hasDeepseekApiKey}
                onDecideAdjustment={(proposalId, status) => runAction(status === 'accepted' ? '接受调整建议' : '拒绝调整建议', async () => {
                  await window.studyApp.learning.decideAdjustment(proposalId, status);
                  await refresh();
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
              />
            )}
            {view === 'settings' && (
              <SettingsPage settings={settings} runAction={runAction} onSaved={refresh} />
            )}
          </div>
        </main>
      }
      teacher={view === 'study' ? (
        <TeacherSidebar
          knowledgeItems={knowledgeItems}
          collapsed={teacherCollapsed}
          onToggleCollapse={() => setTeacherCollapsed((c) => !c)}
          onAskQuestion={(question) => runAction('回答问题', async () => {
            const result = await window.studyApp.learning.askQuestion(question);
            setQuestionAnswer(result);
            setLearningState(await window.studyApp.learning.getState());
          })}
          contextSummary={learningState?.dailyGuideAction?.title ?? learningState?.dailyGuideTask?.title}
          questionAnswer={questionAnswer}
          activeThreadId={learningState?.questionThread?.id ?? null}
          onResolveQuestion={(threadId) => void runAction('结束问题分支', async () => { setLearningState(await window.studyApp.learning.resolveQuestion(threadId)); })}
        />
      ) : undefined}
    />
    <Drawer open={roadmapDrawerOpen} title="学习大纲" onClose={() => setRoadmapDrawerOpen(false)}>
        <RoadmapTree stages={todayGuide?.roadmap ?? []} shortPlanDays={todayGuide?.shortPlan ?? []} knowledgeItems={knowledgeItems} collapsed={false} onToggleCollapse={() => setRoadmapDrawerOpen(false)} />
      </Drawer>
      <Drawer open={teacherDrawerOpen} title="AI 导师" onClose={() => setTeacherDrawerOpen(false)}>
        <TeacherSidebar knowledgeItems={knowledgeItems} collapsed={false} onToggleCollapse={() => setTeacherDrawerOpen(false)} contextSummary={learningState?.dailyGuideAction?.title ?? learningState?.dailyGuideTask?.title} questionAnswer={questionAnswer} activeThreadId={learningState?.questionThread?.id ?? null} onResolveQuestion={(threadId) => void runAction('结束问题分支', async () => { setLearningState(await window.studyApp.learning.resolveQuestion(threadId)); })} onAskQuestion={(question) => runAction('回答问题', async () => {
          const result = await window.studyApp.learning.askQuestion(question);
          setQuestionAnswer(result);
          setLearningState(await window.studyApp.learning.getState());
        })} />
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
      return '缺少 DeepSeek API Key。请先在"设置"里填写密钥，再运行 AI 功能。';
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
