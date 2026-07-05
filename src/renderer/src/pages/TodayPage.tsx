import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Circle,
  CircleDot,
  Clock3,
  FileText,
  Lightbulb,
  ListChecks,
  Loader2,
  RotateCcw,
  SendHorizontal,
  Sparkles,
  Target,
  Trophy,
  UserRound,
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
import { MessageContent } from '../components/ai/MessageContent';
import { TypingDots } from '../components/ai/TypingDots';
import { HistoryPanel } from '../components/shared/HistoryPanel';
import { GoalBriefEditor } from '../components/today/GoalBriefEditor';
import { getCurrentGuideTaskSelection } from '../domain/guide-selection';

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function TodayPage({
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
  onArchiveTodayAndRestart
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
}): JSX.Element {
  const [message, setMessage] = useState('');
  const [briefDraft, setBriefDraft] = useState<GoalBrief | null>(null);
  const [intakePending, setIntakePending] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyList, setHistoryList] = useState<HistoryIntakeSummary[]>([]);
  const [historyPending, setHistoryPending] = useState(false);
  const [selectedHistoryIntake, setSelectedHistoryIntake] = useState<GoalIntakeState | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const guide = todayGuide?.guide ?? null;
  const goal = todayGuide?.goal ?? onboarding?.activeGoal ?? null;
  const currentSelection = guide ? getCurrentGuideTaskSelection(guide.tasks, activeSession, learningState) : null;
  const currentTask = currentSelection?.task ?? null;
  const canUseAi = settings.hasDeepseekApiKey;
  const latestAssistantMessageId = [...(onboarding?.messages ?? [])].reverse().find((item) => item.role === 'assistant')?.id ?? null;

  useEffect(() => {
    if (onboarding?.intake.brief) {
      setBriefDraft(onboarding.intake.brief);
    }
  }, [onboarding?.intake.id, onboarding?.intake.brief]);

  async function send(text: string): Promise<void> {
    const content = text.trim();
    if (!content) return;
    setMessage('');
    setIntakePending(true);
    try {
      await onSendOnboarding(content);
    } finally {
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

  // ---- 无计划：访谈入口 ----
  if (!guide) {
    return (
      <section className="intake-workspace">
        <div className="intake-main">
          <div className="generation-path" aria-label="输出路径">
            <Sparkles size={18} />
            <span>将生成：</span>
            <strong>长期大纲</strong>
            <ChevronRight size={16} />
            <strong>短期计划</strong>
            <ChevronRight size={16} />
            <strong>今日执行稿</strong>
          </div>

          <section className="surface intake-chat-panel" aria-label="主动访谈">
            <div className="intake-thread redesigned" aria-label="目标访谈记录">
              {(onboarding?.messages ?? []).length === 0 && (
                <div className="intake-message assistant">
                  <span>AI</span>
                  <MessageContent content="你准备学习什么？可以直接说目标、期限、基础和每天可投入时间。" />
                </div>
              )}
              {(onboarding?.messages ?? []).map((item) => (
                <div className={item.role === 'assistant' ? 'intake-message assistant' : 'intake-message user'} key={item.id}>
                  <span>{item.role === 'assistant' ? 'AI' : '你'}</span>
                  <MessageContent content={item.content} animated={item.role === 'assistant' && item.id === latestAssistantMessageId} />
                </div>
              ))}
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
                <button className="secondary-action" type="button" disabled={!canUseAi || intakePending} onClick={() => void send('直接开始，先生成计划。')}>
                  <Wand2 size={16} />
                  直接开始
                </button>
                <button className="primary-action" type="button" disabled={!message.trim() || !canUseAi || intakePending} onClick={() => void send(message)}>
                  <SendHorizontal size={16} />
                  {intakePending ? '等待回复' : '发送'}
                </button>
              </div>
            </div>
          </section>
          <p className="micro-hint">
            <Lightbulb size={14} />
            没有思路？点击"直接开始"，由 AI 先发起引导式提问。
          </p>
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
                <Target size={24} />
                <strong>目标</strong>
                <span>{briefDraft?.title || goal?.title || '等待你描述核心目标'}</span>
              </div>
              <div>
                <Trophy size={24} />
                <strong>期望结果</strong>
                <span>{briefDraft?.targetOutcome || '例如完成一个可验收产出'}</span>
              </div>
              <div>
                <UserRound size={24} />
                <strong>当前基础</strong>
                <span>{briefDraft?.currentLevel || '当前知识、技能或资源基础'}</span>
              </div>
              <div>
                <CalendarClock size={24} />
                <strong>时间与约束</strong>
                <span>{briefDraft?.availableTime || '可投入时间、ddl、限制条件等'}</span>
              </div>
            </div>
          )}
          {goal && !guide && !(onboarding?.intake.status === 'ready' && briefDraft) && (
            canUseAi ? (
              <button className="primary-action full" type="button" onClick={async () => {
                setPlanLoading(true);
                try {
                  await onGenerateLayeredPlan(goal.id);
                } finally {
                  setPlanLoading(false);
                }
              }}>
                <Sparkles size={16} />
                {onboarding?.intake.status === 'confirmed' ? '重新生成当日计划' : '确认并生成计划'}
              </button>
            ) : (
              <>
                <p className="micro-hint" style={{ margin: '0 0 8px', textAlign: 'center' }}>
                  <AlertTriangle size={14} />
                  请先在设置页配置 DeepSeek API Key
                </p>
              </>
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
                setPlanLoading(true);
                try {
                  await onGenerateLayeredPlan(item.intake.goalId);
                } finally {
                  setPlanLoading(false);
                }
              }
            }}
            onClose={() => { setShowHistory(false); setSelectedHistoryIntake(null); }}
          />
        )}
        {planLoading && (
          <div className="modal-overlay">
            <div className="modal-box">
              <Loader2 className="spin" size={24} />
              <p>正在生成分层计划，请稍候…</p>
            </div>
          </div>
        )}
      </section>
    );
  }

  // ---- 有计划：学习进度 + 知识库 ----
  const guideTasks = guide.tasks;
  const completedCount = guideTasks.filter((task) => task.status === 'done').length;
  const totalCount = guideTasks.length;
  const totalMinutes = guideTasks.reduce((sum, task) => sum + task.estimatedMinutes.target, 0);
  const progressPercent = totalCount > 0 ? clampPercent((completedCount / totalCount) * 100) : 0;
  const totalElapsed = guide.tasks.reduce((sum, t) => sum + (t.totalElapsedMinutes || 0), 0);

  return (
    <section className="today-v2">
      {/* ======== 左侧：学习进度 ======== */}
      <div className="today-v2-main">
        <header className="page-title-block">
          <h1>{goal?.title ?? '学习进度'}</h1>
          <p>{guide.todayGoal}</p>
        </header>

        {/* 今日任务列表 */}
        <section className="surface today-task-list-panel" aria-label="今日任务">
          <h3>
            <ListChecks size={18} />
            今日任务 ({completedCount}/{totalCount})
          </h3>
          <div className="today-task-list">
            {guideTasks.map((task, index) => {
              const isCurrent = task.id === currentTask?.id;
              const taskDone = task.status === 'done';
              const taskActive = task.status === 'active';
              const progressPct = task.totalElapsedMinutes > 0 && task.estimatedMinutes.target > 0
                ? Math.round(Math.min(task.totalElapsedMinutes / task.estimatedMinutes.target, 1) * 100)
                : 0;
              return (
                <div
                  className={`today-task-item ${isCurrent ? 'current' : ''} ${taskDone ? 'done' : ''} ${taskActive ? 'active' : ''}`}
                  key={task.id}
                >
                  <span className="task-index">{index + 1}</span>
                  <div className="task-info">
                    <div className="task-header">
                      <strong>{task.title}</strong>
                      <span className={`task-status-badge ${task.status}`}>
                        {taskDone ? '已完成' : taskActive ? '进行中' : '待开始'}
                      </span>
                    </div>
                    <span className="task-meta">
                      <Clock3 size={12} />
                      {task.estimatedMinutes.target} 分钟
                      {task.totalElapsedMinutes > 0 && ` · 已投入 ${task.totalElapsedMinutes} 分钟`}
                    </span>
                    {isCurrent && !taskDone && (
                      <div className="task-progress">
                        <div className="task-progress-bar">
                          <div style={{ width: `${progressPct}%` }} />
                        </div>
                        <span>{progressPct}%</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 学习路径（折叠） */}
        {todayGuide?.roadmap && todayGuide.roadmap.length > 0 && (
          <section className="surface roadmap-stages-panel" aria-label="学习路径">
            <h3>学习路径</h3>
            <div className="roadmap-stage-list">
              {todayGuide.roadmap.map((stage, index) => {
                const isCurrentStage = index === 0;
                const stageDone = completedCount === totalCount && totalCount > 0;
                return (
                  <div
                    className={`roadmap-stage-item ${isCurrentStage ? 'current' : ''} ${stageDone && isCurrentStage ? 'done' : ''}`}
                    key={stage.id ?? index}
                  >
                    <span className="stage-marker">
                      {stageDone && isCurrentStage ? (
                        <CheckCircle2 size={16} />
                      ) : isCurrentStage ? (
                        <CircleDot size={16} />
                      ) : (
                        <Circle size={16} />
                      )}
                    </span>
                    <div className="stage-info">
                      <strong>{stage.title}</strong>
                      <span>{stage.objective}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {guide.status === 'draft' ? (
          <button
            className="primary-action full"
            type="button"
            onClick={() => void onConfirmGuide(guide.id)}
            style={{ marginTop: 8 }}
          >
            <CheckCircle2 size={16} />
            确认今日执行稿
          </button>
        ) : completedCount === totalCount && totalCount > 0 ? (
          <div className="today-completed-block" style={{ marginTop: 12, textAlign: 'center' }}>
            <CheckCircle2 size={28} style={{ color: 'var(--color-primary)' }} />
            <p style={{ margin: '8px 0', fontWeight: 600 }}>今日任务已全部完成</p>
          </div>
        ) : (
          <div className="micro-hint" style={{ marginTop: 8 }}>
            <CheckCircle2 size={14} />
            今日执行稿已确认。开始、暂停、提交都在"学习"页完成。
          </div>
        )}
      </div>

      {/* ======== 右侧：知识库 + 进度 ======== */}
      <aside className="today-context-panel" aria-label="知识库与进度">
        {/* 今日进度环 */}
        <div className="context-card progress-ring-card">
          <h3>今日进度</h3>
          <div className="progress-ring-widget">
            <div
              className="progress-ring"
              style={{
                background: `conic-gradient(var(--color-primary) ${progressPercent}%, var(--color-primary-surface) 0)`
              }}
            >
              <span>{progressPercent}%</span>
            </div>
            <div className="progress-ring-stats">
              <div>
                <strong>{completedCount}/{totalCount}</strong>
                <span>任务完成</span>
              </div>
              <div>
                <strong>{totalElapsed} 分钟</strong>
                <span>学习时长</span>
              </div>
            </div>
          </div>
        </div>

        {/* 知识库（预留） */}
        <div className="context-card knowledge-base-card">
          <div className="context-card-head">
            <h3>
              <BookOpen size={16} />
              知识库
            </h3>
          </div>
          <p className="muted">
            你已掌握的概念、笔记和反思会沉淀在这里。完成更多学习任务后，知识库将自动生长。
          </p>
          <div className="knowledge-placeholder">
            <div className="placeholder-item">
              <span className="placeholder-dot" />
              <span>{completedCount > 0 ? '已有学习记录，知识卡片待整理' : '暂无积累，开始学习后自动记录'}</span>
            </div>
          </div>
        </div>

        {/* 最近学习 */}
        <div className="context-card">
          <div className="context-card-head">
            <h3>最近学习</h3>
          </div>
          <div className="recent-list">
            {learningState?.latestEvaluation ? (
              [learningState.latestEvaluation].map((_summary) => (
                <div key="recent-eval" className="recent-item">
                  <span className="recent-icon"><CheckCircle2 size={14} /></span>
                  <span className="recent-text">
                    最近评价完成
                  </span>
                </div>
              ))
            ) : completedCount > 0 ? (
              guideTasks.filter((t) => t.status === 'done').slice(0, 3).map((task) => (
                <div key={task.id} className="recent-item">
                  <span className="recent-icon"><CheckCircle2 size={14} /></span>
                  <span className="recent-text">完成任务：{task.title}</span>
                </div>
              ))
            ) : (
              <div className="recent-item">
                <span className="recent-icon file"><FileText size={16} /></span>
                <span className="recent-text">
                  <strong>计划已生成</strong>
                  <small>{totalCount} 个任务 · {totalMinutes} 分钟</small>
                </span>
              </div>
            )}
          </div>
        </div>

        {/* 计划管理 */}
        <div className="context-card restart-plan-card">
          <h3>计划管理</h3>
          <p>当前计划不合适时，可以归档并重新开始。</p>
          <button className="secondary-action danger-outline full" type="button" onClick={() => setShowRestartConfirm(true)}>
            <RotateCcw size={16} />
            重新开始新计划
          </button>
        </div>
      </aside>

      {/* 弹窗 */}
      {showHistory && (
        <HistoryPanel
          list={historyList}
          pending={historyPending}
          selected={selectedHistoryIntake}
          onSelect={(item) => { void loadHistoryIntake(item.intake.id); }}
          onRegenerate={async (item) => {
            if (item.intake.goalId) {
              setShowHistory(false);
              setPlanLoading(true);
              try {
                await onGenerateLayeredPlan(item.intake.goalId);
              } finally {
                setPlanLoading(false);
              }
            }
          }}
          onClose={() => { setShowHistory(false); setSelectedHistoryIntake(null); }}
        />
      )}
      {planLoading && (
        <div className="modal-overlay">
          <div className="modal-box">
            <Loader2 className="spin" size={24} />
            <p>正在生成分层计划，请稍候…</p>
          </div>
        </div>
      )}
      {showRestartConfirm && (
        <div className="modal-overlay" onClick={() => setShowRestartConfirm(false)}>
          <div className="modal-box restart-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <AlertTriangle size={28} />
            <h3>重新开始新计划？</h3>
            <p>当前今日计划会被归档，学习历史会保留。正在进行的学习会先暂停，然后回到目标访谈入口。</p>
            <div className="modal-actions">
              <button className="secondary-action" type="button" onClick={() => setShowRestartConfirm(false)}>
                取消
              </button>
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
