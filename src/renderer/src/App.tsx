import { useCallback, useEffect, useRef, useState } from 'react';
import { AiDrawer } from './components/ai/AiDrawer';
import { AppShell } from './components/layout/AppShell';
import { StudyPage } from './pages/StudyPage';
import { ReviewPage } from './pages/ReviewPage';
import { SettingsPage } from './pages/SettingsPage';
import { TodayPage } from './pages/TodayPage';
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
import { getPreviewConfig } from './bridge/url-state';
import './styles.css';


const todayIso = new Date().toISOString().slice(0, 10);

export default function App(): JSX.Element {
  const [view, setView] = useState<ViewKey>(() => {
    const previewView = getPreviewConfig().view;
    return previewView ?? 'today';
  });
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
    const [nextSettings, nextOnboarding, nextTodayGuide, nextLearningState] = await Promise.all([
      window.studyApp.settings.get(),
      window.studyApp.onboarding.getCurrent(),
      window.studyApp.guides.listToday(),
      window.studyApp.learning.getState()
    ]);
    setSettings(nextSettings);
    setOnboarding(nextOnboarding);
    setTodayGuide(nextTodayGuide);
    setLearningState(nextLearningState);
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
    const result = await window.studyApp.learning.submitResult(content);
    setSubmissionResult(result);
    setTeaching(null);
    setQuestionAnswer(null);

    await refresh();
    await syncActiveSession();
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
    if (view === 'today') {
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
      workspaceClassName={view === 'today' && todayGuide?.guide ? 'workspace today-workspace' : 'workspace'}
      onToggleSidebar={() => setSidebarCollapsed((c) => !c)}
      onSelectView={setView}
    >
        {view === 'today' && (
          <TodayPage
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
            onStartSession={(blockId) =>
              runAction('开始学习', async () => {
                if (todayGuide?.guide?.status === 'draft') {
                  await window.studyApp.guides.confirmDailyGuide(todayGuide.guide.id);
                }
                const session = await window.studyApp.sessions.start(blockId);
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
              activeSession?.blockId
                ? runAction('恢复学习', async () => {
                    const session = await window.studyApp.sessions.start(activeSession.blockId!);
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
            onOpenDrawer={handleOpenDrawer}
          />
        )}
        {view === 'review' && (
          <ReviewPage
            review={review}
            todayGuide={todayGuide}
            pendingAdjustment={learningState?.pendingAdjustment ?? null}
            onGenerate={() =>
              runAction('生成复盘', async () => {
                setReview(await window.studyApp.reviews.generate(todayIso));
              })
            }
            hasApiKey={settings.hasDeepseekApiKey}
            onDecideAdjustment={(proposalId, status) =>
              runAction(status === 'accepted' ? '接受调整建议' : '拒绝调整建议', async () => {
                await window.studyApp.learning.decideAdjustment(proposalId, status);
                await refresh();
              })
            }
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
        />
    </AppShell>
  );
}

function toUserErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const withoutIpcPrefix = raw.replace(/^Error invoking remote method '[^']+':\s*/u, '');
  if (withoutIpcPrefix.includes('invalid_type') || withoutIpcPrefix.includes('Required')) {
    return 'AI 返回内容格式不完整，已阻止写入正式计划。请重试生成，或在设置里调整提示词档位。';
  }
  return withoutIpcPrefix.length > 240 ? `${withoutIpcPrefix.slice(0, 240)}...` : withoutIpcPrefix;
}
