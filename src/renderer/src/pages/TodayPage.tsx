import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Circle,
  CircleDot,
  Clock3,
  FileText,
  ListChecks,
  Lock,
  Play,
  RotateCcw,
  SendHorizontal,
  Sparkles,
  Wand2
} from 'lucide-react';
import type {
  AppSettings,
  GoalBrief,
  GoalIntakeState,
  HistoryIntakeSummary,
  LearningRuntimeSnapshot,
  StudySession,
  TodayGuideState
} from '../../../shared/types';
import { TypingDots } from '../components/ai/TypingDots';
import { HistoryPanel } from '../components/shared/HistoryPanel';
import { GoalBriefEditor } from '../components/today/GoalBriefEditor';

export function OverviewPage({
  settings,
  onboarding,
  todayGuide,
  activeSession,
  learningState,
  runAction,
  onSendOnboarding,
  onConfirmGoal,
  onGenerateLayeredPlan,
  onConfirmGuide,
  onArchiveTodayAndRestart,
  onGenerateRollingPlan,
  onPrepareCurrentLearningDay,
  onNavigate
}: {
  settings: AppSettings;
  onboarding: GoalIntakeState | null;
  todayGuide: TodayGuideState | null;
  activeSession: StudySession | null;
  learningState: LearningRuntimeSnapshot | null;
  runAction: (label: string, action: () => Promise<void>) => Promise<void>;
  onSendOnboarding: (content: string) => Promise<void>;
  onConfirmGoal: (briefPatch?: Partial<GoalBrief>) => Promise<void>;
  onGenerateLayeredPlan: (goalId: string) => Promise<void>;
  onConfirmGuide: (guideId: string) => Promise<void>;
  onArchiveTodayAndRestart: () => Promise<void>;
  onGenerateRollingPlan: () => Promise<void>;
  onPrepareCurrentLearningDay: () => Promise<void>;
  onNavigate?: (view: 'study' | 'review') => void;
}): JSX.Element {
  const [message, setMessage] = useState('');
  const [briefDraft, setBriefDraft] = useState<GoalBrief | null>(null);
  const [intakePending, setIntakePending] = useState(false);
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [historyList, setHistoryList] = useState<HistoryIntakeSummary[]>([]);
  const [historyPending, setHistoryPending] = useState(false);
  const [selectedHistoryIntake, setSelectedHistoryIntake] = useState<GoalIntakeState | null>(null);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);

  const guide = todayGuide?.guide ?? null;
  const roadmap = todayGuide?.roadmap ?? [];
  const goal = todayGuide?.goal ?? onboarding?.activeGoal ?? null;
  const shortPlanDays = todayGuide?.shortPlan ?? [];
  const currentShortPlanDay = shortPlanDays.find((d) => d.id === guide?.shortPlanDayId) ?? null;
  const completedTaskCount = guide?.tasks.filter((t) => t.status === 'done').length ?? 0;
  const pendingEvaluationCount = todayGuide?.pendingEvaluations?.length ?? 0;
  const hasPendingItems = guide?.status === 'draft' || pendingEvaluationCount > 0;
  const totalTaskCount = guide?.tasks.length ?? 0;
  const totalElapsedMinutes = guide?.tasks.reduce((sum, t) => sum + (t.totalElapsedMinutes || 0), 0) ?? 0;

  useEffect(() => {
    if (onboarding?.intake.brief) {
      setBriefDraft(onboarding.intake.brief);
    }
  }, [onboarding?.intake.id, onboarding?.intake.brief]);

  async function send(text: string): Promise<void> {
    const content = text.trim();
    if (!content) return;
    setMessage('');
    setPendingUserMessage(content);
    setIntakePending(true);
    try {
      await onSendOnboarding(content);
    } finally {
      setPendingUserMessage(null);
      setIntakePending(false);
    }
  }

  async function loadHistory(): Promise<void> {
    setHistoryPending(true);
    setSelectedHistoryIntake(null);
    try {
      setHistoryList(await window.studyApp.history.listAll());
    } catch (error) {
      runAction('加载历史', async () => { throw error; });
    } finally {
      setHistoryPending(false);
    }
  }

  async function loadHistoryIntake(intakeId: string): Promise<void> {
    setHistoryPending(true);
    try {
      setSelectedHistoryIntake(await window.studyApp.history.getById(intakeId));
    } catch (error) {
      runAction('加载会话详情', async () => { throw error; });
    } finally {
      setHistoryPending(false);
    }
  }

  const hasApiKey = settings.hasDeepseekApiKey;
  const latestAssistantMessageId = [...(onboarding?.messages ?? [])].reverse().find((item) => item.role === 'assistant')?.id ?? null;

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
            <strong>今日执行稿</strong>
          </div>

          <section className="surface intake-chat-panel" aria-label="主动访谈">
            <div className="intake-thread redesigned" aria-label="目标访谈记录">
              {(onboarding?.messages ?? []).length === 0 && (
                <div className="intake-message assistant">
                  <span>AI</span>
                  <div className="message-content">你准备学习什么？可以直接说目标、期限、基础和每天可投入时间。</div>
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
                  <TypingDots />
                </div>
              )}
            </div>

            <div className="intake-input-dock">
              <div className="intake-input-box">
                <FileText size={18} />
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="输入你的回答，或补充更多信息..."
                  aria-label="输入学习目标"
                />
              </div>
              <div className="intake-actions">
                <button className="secondary-action" type="button" disabled={!hasApiKey || intakePending} onClick={() => void send('直接开始，先生成计划。')}>
                  <Wand2 size={16} />
                  直接开始
                </button>
                <button className="primary-action" type="button" disabled={!message.trim() || !hasApiKey || intakePending} onClick={() => void send(message)}>
                  <SendHorizontal size={16} />
                  {intakePending ? '等待回复' : '发送'}
                </button>
              </div>
            </div>
          </section>
        </div>

        <aside className="context-panel intake-summary-panel">
          <h3>目标理解摘要</h3>
          <p>基于你的回答，AI 会自动提炼要点，并在确认后生成计划。</p>
          {onboarding?.intake.status === 'ready' && briefDraft ? (
            <GoalBriefEditor
              brief={briefDraft}
              onChange={setBriefDraft}
              onConfirm={() => void onConfirmGoal(briefDraft)}
            />
          ) : (
            <div className="brief-summary-list">
              <div>
                <strong>目标</strong>
                <span>{briefDraft?.title || goal?.title || '—'}</span>
              </div>
              {briefDraft?.targetOutcome && (
                <div>
                  <strong>期望结果</strong>
                  <span>{briefDraft.targetOutcome}</span>
                </div>
              )}
              {briefDraft?.currentLevel && (
                <div>
                  <strong>当前基础</strong>
                  <span>{briefDraft.currentLevel}</span>
                </div>
              )}
              {briefDraft?.availableTime && (
                <div>
                  <strong>时间与约束</strong>
                  <span>{briefDraft.availableTime}</span>
                </div>
              )}
            </div>
          )}
          {goal && !guide && !(onboarding?.intake.status === 'ready' && briefDraft) && (
            hasApiKey ? (
              <button
                className="primary-action full"
                type="button"
                disabled={!hasApiKey}
                onClick={() => void (todayGuide?.todayState === 'generation_failed'
                  ? onPrepareCurrentLearningDay()
                  : onGenerateLayeredPlan(goal.id))}
              >
                <Sparkles size={16} />
                {todayGuide?.todayState === 'generation_failed'
                  ? '重新生成当前学习单元'
                  : onboarding?.intake.status === 'confirmed'
                    ? '重新生成当日计划'
                    : '确认并生成计划'}
              </button>
            ) : (
              <p className="micro-hint" style={{ margin: '0 0 8px', textAlign: 'center' }}>
                请先在设置页配置 DeepSeek API Key
              </p>
            )
          )}
          <button className="secondary-action full" type="button" style={{ marginTop: 12 }} onClick={() => { void loadHistory(); setShowHistory(true); }}>
            <Clock3 size={16} />
            历史会话
          </button>
        </aside>

        {showHistory && (
          <HistoryPanel
            list={historyList}
            pending={historyPending}
            selected={selectedHistoryIntake}
            onSelect={(item) => { void loadHistoryIntake(item.intake.id); }}
            onRegenerate={async (item) => {
              if (item.intake.goalId) {
                setShowHistory(false);
                await onGenerateLayeredPlan(item.intake.goalId);
              }
            }}
            onClose={() => { setShowHistory(false); setSelectedHistoryIntake(null); }}
          />
        )}
      </section>
    );
  }

  // 有计划：概览
  const currentBatchExhausted = todayGuide?.todayState === 'plan_exhausted';
  const hasActiveGuide = guide.sessionStatus === 'active';
  const currentUnitTitle = currentShortPlanDay?.title ?? guide.todayGoal;
  const currentUnitLabel = currentShortPlanDay ? '当前学习单元' : null;


  return (
    <section className="overview-layout">
      <div className="overview-main">
        <header className="page-title-block">
          <h1>{goal?.title ?? '学习概览'}</h1>
          <p>
            {currentUnitLabel ? `${currentUnitLabel} · ${currentUnitTitle}` : guide.todayGoal}
            {currentShortPlanDay?.locked && <span className="locked-badge"><Lock size={12} /> 已锁定</span>}
          </p>
        </header>

        {hasPendingItems && (
          <section className="surface pending-center-card" aria-label="待处理">
            <h3><ListChecks size={16} /> 待处理</h3>
            <div className="pending-items">
              {guide.status === 'draft' && (
                <div className="pending-item">
                  <FileText size={14} />
                  <span>今日执行稿尚未确认</span>
                  <button className="secondary-action small" type="button" onClick={() => void onConfirmGuide(guide.id)}>
                    去确认
                  </button>
                </div>
              )}
              {pendingEvaluationCount > 0 && (
                <div className="pending-item">
                  <Clock3 size={14} />
                  <span>{pendingEvaluationCount} 条评价未完成</span>
                  <button className="secondary-action small" type="button" onClick={() => onNavigate?.('study')}>
                    去评价
                  </button>
                </div>
              )}
              {learningState?.pendingAdjustment?.status === 'pending' && (
                <div className="pending-item">
                  <AlertTriangle size={14} />
                  <span>有待确认的调整建议</span>
                  <button className="secondary-action small" type="button" onClick={() => onNavigate?.('review')}>
                    查看
                  </button>
                </div>
              )}
            </div>
          </section>
        )}

        {todayGuide?.todayState === 'generation_failed' && !hasPendingItems && (
          <section className="surface generation-retry-card" aria-live="polite">
            <div>
              <strong>当前学习单元尚未生成成功</strong>
              <p>已保留原学习单元和日期，可以安全重试，不会跳过或覆盖历史记录。</p>
            </div>
            <button className="primary-action" type="button" onClick={() => void onPrepareCurrentLearningDay()}>
              <RotateCcw size={16} />
              重新生成执行稿
            </button>
          </section>
        )}

        {/* 学习路径 */}
        {roadmap.length > 0 && (
          <section className="surface roadmap-panel" aria-label="学习路径">
            <h3>学习路径</h3>
            <div className="roadmap-stages">
              {roadmap.map((stage, index) => {
                const displayStatus = stage.status;
                const stageDone = displayStatus === 'completed';
                const stageActive = displayStatus === 'active' || displayStatus === 'adjusted' || displayStatus === 'blocked';
                const stageStatusLabel = getRoadmapStageStatusLabel(displayStatus);
                return (
                  <div
                    className={`roadmap-stage-item ${stageActive ? 'current' : ''} ${stageDone ? 'done' : ''}`}
                    key={stage.id ?? index}
                  >
                    <span className="stage-marker">
                      {stageDone ? <CheckCircle2 size={16} /> : stageActive ? <CircleDot size={16} /> : <Circle size={16} />}
                    </span>
                    <div className="stage-info">
                      <strong>{stage.title}</strong>
                      <span>{stage.objective} · {stageStatusLabel}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* 状态 */}
        {guide.status === 'draft' ? (
          <button className="primary-action full" type="button" onClick={() => void onConfirmGuide(guide.id)}>
            <CheckCircle2 size={16} />
            确认今日执行稿
          </button>
        ) : currentBatchExhausted ? (
          <div className="surface overview-complete-block">
            <CheckCircle2 size={28} style={{ color: 'var(--color-primary)' }} />
            <p>当前批次学习任务已全部完成</p>
            <p className="muted">复盘后可根据学习路径继续生成下一批任务</p>
            <button className="primary-action" type="button" style={{ marginTop: 12 }} onClick={() => void onGenerateRollingPlan()}>
              <Play size={16} />
              生成下一批任务
            </button>
          </div>
        ) : (
          <div className="surface overview-go-study">
            <ListChecks size={18} />
            <span>
              {hasActiveGuide
                ? (completedTaskCount === totalTaskCount && totalTaskCount > 0
                     ? '当前学习单元任务已完成，进入「复盘」页查看总结'
                    : '进入「学习」页执行当前任务')
                : currentUnitLabel
                  ? '当前学习单元准备就绪，进入「学习」页开始'
                  : '进入「学习」页开始任务'}
            </span>
          </div>
        )}
      </div>

      {/* 右侧：精简统计 */}
      <aside className="overview-side">
        <div className="context-card">
          <h3>进度</h3>
          <div className="overview-stats">
            <div className="stat-item">
              <strong>{currentUnitLabel ?? '—'}</strong>
              <span>进度位置</span>
            </div>
            <div className="stat-item">
              <strong>{totalTaskCount > 0 ? `${completedTaskCount}/${totalTaskCount}` : '—'}</strong>
              <span>今日任务</span>
            </div>
            <div className="stat-item">
              <strong>{totalElapsedMinutes > 0 ? `${totalElapsedMinutes}分钟` : '—'}</strong>
              <span>学习时长</span>
            </div>
          </div>
        </div>

        <div className="context-card">
          <div className="context-card-head">
            <h3>最近学习</h3>
          </div>
          <div className="recent-list">
            {completedTaskCount > 0 ? (
              guide.tasks.filter((t) => t.status === 'done').slice(-3).reverse().map((task) => (
                <div key={task.id} className="recent-item">
                  <span className="recent-icon"><CheckCircle2 size={14} /></span>
                  <span className="recent-text">{task.title}</span>
                </div>
              ))
            ) : (
              <div className="recent-item">
                <span className="recent-icon"><Play size={14} /></span>
                <span className="recent-text">尚未开始执行任务</span>
              </div>
            )}
          </div>
        </div>

        <div className="context-card">
          <h3>计划管理</h3>
          <p>当前计划不合适时，可以归档并重新开始。</p>
          <button className="secondary-action danger-outline full" type="button" onClick={() => setShowRestartConfirm(true)}>
            <RotateCcw size={16} />
            重新开始新计划
          </button>
        </div>
      </aside>

      {showHistory && (
        <HistoryPanel
          list={historyList}
          pending={historyPending}
          selected={selectedHistoryIntake}
          onSelect={(item) => { void loadHistoryIntake(item.intake.id); }}
          onRegenerate={async (item) => {
            if (item.intake.goalId) {
              setShowHistory(false);
              await onGenerateLayeredPlan(item.intake.goalId);
            }
          }}
          onClose={() => { setShowHistory(false); setSelectedHistoryIntake(null); }}
        />
      )}
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

function getRoadmapStageStatusLabel(status: string): string {
  switch (status) {
    case 'active':
      return '进行中';
    case 'completed':
      return '已完成';
    case 'blocked':
      return '受阻';
    case 'adjusted':
      return '已调整';
    case 'pending':
    default:
      return '待开始';
  }
}
