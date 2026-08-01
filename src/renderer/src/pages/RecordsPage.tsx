import { useEffect, useMemo, useState } from 'react';
import { BookOpenCheck, Brain, CalendarClock, ClipboardCheck, FileCheck2, FileText, Lightbulb, Loader2, Sparkles } from 'lucide-react';
import type { KnowledgeItem, LearningGoal, LearningOverviewState, LearningRuntimeSnapshot, PlanAdjustmentProposal, PlanVersionEntry, ResumableGuideSummary, ReviewResult } from '../../../shared/types';
import { deriveLearningTaskStatus } from '../domain/learning-status';

type RecordTab = 'timeline' | 'knowledge' | 'versions';
type ExportRow = Record<string, unknown>;
export type TimelineEvent = {
  id: string;
  at: string;
  kind: string;
  title: string;
  summary: string;
  details?: string[];
  evaluationId?: string;
  recommendedAction?: string;
  recommendationDecision?: string;
  applicationStatus?: string | null;
  submissionId?: string;
  evaluationStatus?: string;
};

function rows(value: unknown): ExportRow[] { return Array.isArray(value) ? value.filter((item): item is ExportRow => Boolean(item) && typeof item === 'object') : []; }
function text(value: unknown): string { return typeof value === 'string' ? value : ''; }
function normalizedText(value: string): string { return value.replace(/[\s，。！？、,.!?；;：:]/gu, '').toLowerCase(); }
export function getLatestQuestionAnswer(exportData: Record<string, unknown>, threadId: string): string {
  let latestAnswer = '';
  let latestCreatedAt = '';
  for (const message of rows(exportData.questionMessages)) {
    const content = text(message.content);
    const createdAt = text(message.createdAt);
    if (text(message.threadId) === threadId && text(message.role) === 'assistant' && content && createdAt >= latestCreatedAt) {
      latestAnswer = content;
      latestCreatedAt = createdAt;
    }
  }
  return latestAnswer;
}
function readableVersionTitle(summary: string, version: number): string {
  if (!summary) return `更新学习计划（版本 ${version}）`;
  if (/Daily guide for short plan day/i.test(summary)) return '生成学习日执行稿';
  if (/review|复盘/i.test(summary)) return '采纳复盘调整建议';
  if (/rolling|下一批/i.test(summary)) return '生成下一批学习任务';
  if (/^[\x00-\x7F]+$/.test(summary)) return `更新学习计划（版本 ${version}）`;
  return summary;
}

export function RecordsPage({ review, todayGuide, learningState, availableGoals, resumableGuides, onRestoreArchivedGuide, pendingAdjustment, onGenerate, hasAiConfiguration, onDecideAdjustment, onDecideEvaluationRecommendation, onRetryEvaluation, onConfirmRoadmapStage, onApplyPlanAdjustments, onGenerateRollingPlan, knowledgeItems, onSetKnowledgeStatus, reloadKey }: {
  review: ReviewResult | null;
  todayGuide: LearningOverviewState | null;
  learningState: LearningRuntimeSnapshot | null;
  availableGoals: LearningGoal[];
  resumableGuides: ResumableGuideSummary[];
  onRestoreArchivedGuide: (guideId: string) => Promise<void>;
  pendingAdjustment: PlanAdjustmentProposal | null;
  onGenerate: () => Promise<void>;
  hasAiConfiguration: boolean;
  onDecideAdjustment: (proposalId: string, status: 'accepted' | 'rejected') => Promise<void>;
  onDecideEvaluationRecommendation?: (evaluationId: string, decision: 'accepted' | 'declined' | 'deferred') => Promise<void>;
  onRetryEvaluation?: (submissionId: string) => Promise<void>;
  onConfirmRoadmapStage?: (stageId: string) => Promise<void>;
  onApplyPlanAdjustments?: (adjustments: ReviewResult['planAdjustments']) => Promise<number>;
  onGenerateRollingPlan?: () => Promise<void>;
  knowledgeItems: KnowledgeItem[];
  onSetKnowledgeStatus: (itemId: string, status: KnowledgeItem['status']) => Promise<void>;
  reloadKey?: number;
}): JSX.Element {
  const [tab, setTab] = useState<RecordTab>('timeline');
  const [exportData, setExportData] = useState<Record<string, unknown>>({});
  const [versions, setVersions] = useState<PlanVersionEntry[]>([]);
  const [selectedKnowledgeItems, setSelectedKnowledgeItems] = useState<KnowledgeItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [confirmingGuideId, setConfirmingGuideId] = useState<string | null>(null);
  const [retryingSubmissionId, setRetryingSubmissionId] = useState<string | null>(null);

  const currentGoalId = todayGuide?.goal?.id ?? null;
  const selectedGoal = availableGoals.find((goal) => goal.id === selectedGoalId)
    ?? availableGoals.find((goal) => goal.id === currentGoalId)
    ?? availableGoals[0]
    ?? null;
  const selectedGoalIsCurrent = selectedGoal?.id === currentGoalId;
  const resumableForSelectedGoal = selectedGoal
    ? resumableGuides.filter((guide) => guide.goalId === selectedGoal.id)
    : [];

  useEffect(() => {
    const goalId = selectedGoal?.id;
    if (!goalId) { setExportData({}); setVersions([]); return; }
    setSelectedId(null);
    setLoading(true);
    void Promise.all([window.studyApp.data.exportGoal(goalId), window.studyApp.data.getPlanVersions(goalId)])
      .then(([data, nextVersions]) => { setExportData(data); setVersions(nextVersions); })
      .finally(() => setLoading(false));
  }, [selectedGoal?.id, reloadKey]);

  useEffect(() => {
    if (!selectedGoal?.id) {
      setSelectedKnowledgeItems([]);
      return;
    }
    void window.studyApp.knowledge.listForGoal(selectedGoal.id)
      .then(setSelectedKnowledgeItems)
      .catch(() => setSelectedKnowledgeItems([]));
  }, [selectedGoal?.id, reloadKey]);

  const knowledgeItemsForView = selectedGoalIsCurrent ? knowledgeItems : selectedKnowledgeItems;

  const events = useMemo<TimelineEvent[]>(() => {
    const tasks = rows(exportData.learningTasks);
    const taskTitle = new Map(tasks.map((task) => [text(task.id), text(task.title) || '学习任务']));
    const actions = rows(exportData.learningActions);
    const actionTitle = new Map(actions.map((action) => [text(action.id), text(action.title) || '行动步骤']));
    const submissions = rows(exportData.learningSubmissions)
      .sort((left, right) => text(left.createdAt).localeCompare(text(right.createdAt)));
    const attemptIndex = new Map<string, number>();
    const taskAttempts = new Map<string, number>();
    for (const submission of submissions) {
      const taskId = text(submission.taskId);
      const next = (taskAttempts.get(taskId) ?? 0) + 1;
      taskAttempts.set(taskId, next);
      attemptIndex.set(text(submission.id), next);
    }
    const submissionById = new Map(submissions.map((submission) => [text(submission.id), submission]));
    const result: TimelineEvent[] = [];
    const currentTaskStatus = learningState?.dailyGuideTask
      ? deriveLearningTaskStatus(learningState.dailyGuideTask)
      : null;
    rows(exportData.focusSessions).forEach((session) => {
      const isCurrent = text(session.taskId) === learningState?.dailyGuideTask?.id && ['active', 'paused'].includes(text(session.status));
      const sessionLabel = isCurrent && currentTaskStatus?.phase !== 'executing'
        ? currentTaskStatus?.label ?? '进行中'
          : text(session.status) === 'completed' ? '已完成' : text(session.status) === 'paused' ? '已暂停' : '进行中';
      result.push({ id: `session-${text(session.id)}`, at: text(session.startedAt), kind: '学习会话', title: taskTitle.get(text(session.taskId)) ?? '学习会话', summary: `${sessionLabel}${Number(session.durationMinutes) > 0 ? ` · ${Number(session.durationMinutes)} 分钟` : ''}` });
    });
    actions.filter((action) => ['done', 'skipped'].includes(text(action.status))).forEach((action) => result.push({ id: `action-${text(action.id)}`, at: text(action.completedAt) || text(action.updatedAt), kind: '行动', title: actionTitle.get(text(action.id)) ?? '行动步骤', summary: text(action.status) === 'done' ? '步骤已完成' : '步骤已跳过' }));
    submissions.forEach((submission) => {
      const attempt = attemptIndex.get(text(submission.id)) ?? 1;
      const title = taskTitle.get(text(submission.taskId)) ?? '学习任务';
      const evaluationStatus = text(submission.evaluationStatus) || 'waiting';
      const evaluationSummary = evaluationStatus === 'completed'
        ? '导师反馈已生成'
        : evaluationStatus === 'failed'
          ? '导师反馈未生成，学习进度不受影响'
          : '导师反馈生成中';
      result.push({
        id: `submission-${text(submission.id)}`,
        at: text(submission.createdAt),
        kind: '提交',
        title: `${title} · 第 ${attempt} 次尝试`,
        summary: `成果原文已保存 · ${evaluationSummary}`,
        details: [text(submission.content)],
        submissionId: text(submission.id),
        evaluationStatus
      });
    });
    rows(exportData.learningEvaluations).forEach((evaluation) => {
      const submission = submissionById.get(text(evaluation.submissionId));
      const attempt = attemptIndex.get(text(evaluation.submissionId)) ?? 1;
      const title = submission
        ? taskTitle.get(text(submission.taskId)) ?? '学习任务'
        : '学习任务';
      const source = text(evaluation.source);
      const recommendationDecision = text(evaluation.recommendationDecision);
      const recommendationAction = extractRecommendationAction(text(evaluation.recommendationJson));
      result.push({
        id: `evaluation-${text(evaluation.id)}`,
        at: text(evaluation.createdAt),
        kind: source === 'user_correction' ? '评价纠正' : '评价',
        title: `${title} · 第 ${attempt} 次尝试`,
        summary: text(evaluation.feedback) || '评价已完成',
        details: [
          source === 'user_correction'
            ? `纠正原评价：${text(evaluation.supersedesEvaluationId)}`
            : `结果：${evaluationResultLabel(text(evaluation.result))}`,
          recommendationDecision
            ? `本评价建议：${recommendationDecisionLabel(recommendationDecision)}`
            : ''
        ].filter(Boolean),
        evaluationId: source === 'user_correction' ? undefined : text(evaluation.id) || undefined,
        recommendedAction: recommendationAction,
        recommendationDecision: recommendationDecision || undefined,
        applicationStatus: text(evaluation.applicationStatus) || null
      });
    });
    rows(exportData.conversationThreads).forEach((thread) => result.push({ id: `question-${text(thread.id)}`, at: text(thread.createdAt), kind: '问题', title: text(thread.question) || '问题分支', summary: getLatestQuestionAnswer(exportData, text(thread.id)) || text(thread.resolutionSummary) || (text(thread.status) === 'resolved' ? '问题已解决' : '待继续处理') }));
    if (selectedGoalIsCurrent && review) result.push({ id: `review-${review.reviewId}`, at: `${todayGuide?.guide?.date ?? new Date().toISOString().slice(0, 10)}T23:59:00`, kind: '复盘', title: '学习复盘', summary: review.summary });
    return result.filter((item) => item.at).sort((a, b) => b.at.localeCompare(a.at));
  }, [exportData, learningState, review, selectedGoalIsCurrent, todayGuide?.guide?.date]);

  const selected = events.find((item) => item.id === selectedId) ?? events[0] ?? null;
  const selectedSummary = selected && normalizedText(selected.summary) !== normalizedText(selected.title) ? selected.summary : '';
  const stageReady = selectedGoalIsCurrent
    ? todayGuide?.roadmap.find((stage) => stage.status === 'ready_for_review') ?? null
    : null;
  const finalStageReady = stageReady
    ? !todayGuide?.roadmap.some((stage) =>
        stage.position > stageReady.position && stage.status !== 'completed'
      )
    : false;

  return (
    <section className="records-page">
      <header className="records-header"><div><h1>记录</h1><p>追溯学习过程、结果证据，以及计划如何随学习结果变化。</p></div>{loading && <span className="records-loading"><Loader2 className="spin" size={15} />正在整理记录</span>}</header>

      <section className="records-history-toolbar" aria-label="历史目标">
        <label htmlFor="records-goal-select">查看目标</label>
        <select
          id="records-goal-select"
          value={selectedGoal?.id ?? ''}
          onChange={(event) => {
            setSelectedGoalId(event.target.value || null);
            setConfirmingGuideId(null);
          }}
          disabled={availableGoals.length === 0}
        >
          {availableGoals.length === 0 && <option value="">暂无目标</option>}
          {availableGoals.map((goal) => (
            <option key={goal.id} value={goal.id}>
              {goal.title} · {goal.status === 'active' ? '进行中' : goal.status === 'done' ? '已完成' : '已归档'}
            </option>
          ))}
        </select>
        {!selectedGoalIsCurrent && selectedGoal && <span className="records-history-readonly">历史记录只读</span>}
      </section>

      {selectedGoal?.status === 'archived' && resumableForSelectedGoal.length > 0 && (
        <section className="records-history-recovery">
          <div>
            <strong>这个目标还有未完成任务</strong>
            <p>恢复后会切换当前学习目标；已完成的 Task 和历史记录不会改变。</p>
          </div>
          {resumableForSelectedGoal.map((guide) => {
            const confirming = confirmingGuideId === guide.guideId;
            const sessionRunning = learningState?.state.sessionStatus === 'active'
              || learningState?.state.sessionStatus === 'paused';
            return (
              <div className="records-history-recovery-row" key={guide.guideId}>
                <span>{guide.taskTitle} · 已完成 {guide.completedTaskCount}/{guide.totalTaskCount} 个任务</span>
                {sessionRunning ? (
                  <small>请先结束当前 Session</small>
                ) : confirming ? (
                  <span className="records-pending-buttons">
                    <button className="primary-action" type="button" onClick={() => {
                      setConfirmingGuideId(null);
                      void onRestoreArchivedGuide(guide.guideId);
                    }}>确认恢复</button>
                    <button className="secondary-action" type="button" onClick={() => setConfirmingGuideId(null)}>取消</button>
                  </span>
                ) : (
                  <button className="secondary-action" type="button" onClick={() => setConfirmingGuideId(guide.guideId)}>恢复并继续</button>
                )}
              </div>
            );
          })}
        </section>
      )}

      {(stageReady || (selectedGoalIsCurrent && pendingAdjustment?.status === 'pending')) && <section className="records-pending">
        <header><div><span className="page-kicker">待处理</span><h2>需要你的决定</h2></div></header>
        {stageReady && onConfirmRoadmapStage && <div className="records-pending-row"><span className="records-pending-icon"><ClipboardCheck size={18} /></span><div><strong>{finalStageReady ? '最终成果待确认' : '阶段成果待确认'}</strong><p>“{stageReady.title}”需要人工复核后才会推进。{finalStageReady ? '确认后将完成当前 Goal。' : ''}</p></div><button className="primary-action" type="button" onClick={() => void onConfirmRoadmapStage(stageReady.id)}>{finalStageReady ? '确认成果并完成目标' : '确认阶段成果'}</button></div>}
        {pendingAdjustment?.status === 'pending' && <div className="records-pending-row"><span className="records-pending-icon"><BookOpenCheck size={18} /></span><div><strong>即时调整待决定</strong><p>{pendingAdjustment.reason}</p></div><div className="records-pending-buttons"><button className="primary-action" type="button" onClick={() => void onDecideAdjustment(pendingAdjustment.id, 'accepted')}>采纳建议</button><button className="secondary-action" type="button" onClick={() => void onDecideAdjustment(pendingAdjustment.id, 'rejected')}>保持原计划</button></div></div>}
      </section>}

      <section className="records-browser-card">
        <nav className="records-tabs" aria-label="记录类型">{([['timeline', '时间线', events.length], ['knowledge', '知识沉淀', knowledgeItemsForView.length], ['versions', '计划版本', versions.length]] as const).map(([key, label, count]) => <button key={key} type="button" className={tab === key ? 'active' : ''} onClick={() => setTab(key)}><span>{label}</span><small>{count}</small></button>)}</nav>

        {tab === 'timeline' && <div className="records-master-detail">
        <div className="record-list">{events.length === 0 ? <div className="records-empty"><CalendarClock size={20} /><strong>还没有学习记录</strong><span>开始一次学习后，Session、步骤、提交和评价会按时间汇总在这里。</span></div> : events.map((event) => <button type="button" key={event.id} className={selected?.id === event.id ? 'record-row active' : 'record-row'} onClick={() => setSelectedId(event.id)}><span>{event.kind}</span><strong>{event.title}</strong><small>{new Date(event.at).toLocaleString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small></button>)}</div>
        <article className="record-detail">{selected ? <><span className="record-kind">{selected.kind}</span><h2>{selected.title}</h2>{selectedSummary && <p>{selectedSummary}</p>}{selected.details?.map((detail) => <p key={detail}>{detail}</p>)}
          {selectedGoalIsCurrent && selected.kind === '评价' && canDecideEvaluationRecommendation(selected) && onDecideEvaluationRecommendation ? (
            <div className="records-pending-buttons">
              <button className="primary-action" type="button" onClick={() => void onDecideEvaluationRecommendation(selected.evaluationId!, 'accepted')}>{selected.recommendedAction === 'complete_task' ? '采纳推荐并完成任务' : '采纳推荐'}</button>
              <button className="secondary-action" type="button" onClick={() => void onDecideEvaluationRecommendation(selected.evaluationId!, 'deferred')}>稍后决定</button>
              <button className="secondary-action" type="button" onClick={() => void onDecideEvaluationRecommendation(selected.evaluationId!, 'declined')}>不采纳</button>
            </div>
          ) : null}
          {selectedGoalIsCurrent && selected.kind === '评价' && canRetryEvaluationRecommendation(selected) && onDecideEvaluationRecommendation ? (
            <div className="records-pending-buttons">
              <button className="primary-action" type="button" onClick={() => void onDecideEvaluationRecommendation(selected.evaluationId!, 'accepted')}>重试应用</button>
            </div>
          ) : null}
          {canRetrySubmissionEvaluation(selected) && onRetryEvaluation ? (
            <div className="records-pending-buttons">
              <button
                className="primary-action"
                type="button"
                disabled={retryingSubmissionId === selected.submissionId}
                onClick={() => {
                  setRetryingSubmissionId(selected.submissionId!);
                  void onRetryEvaluation(selected.submissionId!).finally(() => setRetryingSubmissionId(null));
                }}
              >
                {retryingSubmissionId === selected.submissionId ? '正在重试…' : '重试导师评价'}
              </button>
            </div>
          ) : null}
        </> : <div className="records-empty"><FileText size={20} /><span>选择一条记录查看详情。</span></div>}
          {selectedGoalIsCurrent && review && selected?.kind === '复盘' && <section className="review-result"><h3>后续行动与计划调整</h3>{review.nextActions.length > 0 && <ul>{review.nextActions.map((item) => <li key={item}>{item}</li>)}</ul>}{review.planAdjustments.length > 0 && onApplyPlanAdjustments && <><div className="proposal-note"><Brain size={16} /><span>以下是 AI 建议，尚未应用到正式计划。</span></div>{review.planAdjustments.map((item) => <div className="record-proposal" key={`${item.itemIndex}-${item.title}`}><strong>第 {item.itemIndex} 单元 · {item.title}</strong><span>{item.focus}</span><small>影响范围：尚未执行的对应学习单元</small></div>)}<button className="primary-action" type="button" disabled={applying} onClick={() => { setApplying(true); void onApplyPlanAdjustments(review.planAdjustments).finally(() => setApplying(false)); }}>{applying ? '正在应用…' : '确认应用调整'}</button></>}</section>}
        </article>
        </div>}

        {tab === 'knowledge' && <div className="knowledge-records">{knowledgeItemsForView.length === 0 ? <div className="records-empty"><Lightbulb size={20} /><strong>暂无知识沉淀</strong><span>重复薄弱点、纠正和洞见会在完成评价后出现。</span></div> : knowledgeItemsForView.map((item) => <article key={item.id}><span>{item.masteryLabel}</span><h3>{item.key}</h3><p>{item.summary}</p><p>{item.masteryReason}</p><small>{item.evidenceCount > 1 ? `${item.evidenceCount} 条真实证据` : '1 条真实证据'} · {item.status === 'resolved' ? '用户已确认' : item.status === 'dormant' ? '已排除后续关注' : '持续关注'}</small>{selectedGoalIsCurrent && <div className="records-pending-buttons">{item.status === 'active' ? <><button className="secondary-action" type="button" onClick={() => void onSetKnowledgeStatus(item.id, 'resolved')}>纠正为已掌握</button><button className="secondary-action" type="button" onClick={() => void onSetKnowledgeStatus(item.id, 'dormant')}>排除后续关注</button></> : <button className="secondary-action" type="button" onClick={() => void onSetKnowledgeStatus(item.id, 'active')}>恢复关注</button>}</div>}</article>)}</div>}

        {tab === 'versions' && <div className="version-records">{versions.length === 0 ? <div className="records-empty"><FileCheck2 size={20} /><strong>暂无计划版本</strong><span>生成或确认计划调整后会在这里保留版本记录。</span></div> : versions.map((version) => <article key={version.version}><span>v{version.version}</span><div><h3>{readableVersionTitle(version.changeSummary, version.version)}</h3><p>{new Date(version.createdAt).toLocaleString('zh-CN')}</p>{version.snapshot?.shortPlan?.length ? <small>涉及：{version.snapshot.shortPlan.map((item) => `第 ${item.itemIndex} 单元`).join('、')}</small> : null}</div></article>)}</div>}
      </section>

      <section className="records-actions">
        {selectedGoalIsCurrent && !review && hasAiConfiguration && <button className="secondary-action records-review-action" type="button" disabled={generating} onClick={() => { setGenerating(true); void onGenerate().finally(() => setGenerating(false)); }}><Sparkles size={16} />{generating ? '正在生成复盘…' : '按需生成复盘'}</button>}
        {selectedGoalIsCurrent && todayGuide?.preparationState === 'plan_exhausted' && onGenerateRollingPlan && (
          <button
            className="secondary-action records-review-action"
            type="button"
            onClick={() => void onGenerateRollingPlan()}
          >
            生成下一批学习任务
          </button>
        )}
      </section>
    </section>
  );
}

function evaluationResultLabel(result: string): string {
  if (result === 'passed') return '通过';
  if (result === 'partial') return '部分达到';
  if (result === 'failed') return '未达到';
  return '需要确认';
}

function recommendationDecisionLabel(decision: string): string {
  if (decision === 'accepted') return '已采纳';
  if (decision === 'declined') return '未采纳';
  if (decision === 'deferred') return '稍后决定';
  return '待决定';
}

function extractRecommendationAction(raw: string): string | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return typeof parsed.action === 'string' ? parsed.action : undefined;
  } catch {
    return undefined;
  }
}

export function canDecideEvaluationRecommendation(event: TimelineEvent): boolean {
  return Boolean(
    event.kind === '评价'
    && event.evaluationId
    && (!event.recommendationDecision || event.recommendationDecision === 'deferred')
  );
}

export function canRetryEvaluationRecommendation(event: TimelineEvent): boolean {
  return Boolean(
    event.kind === '评价'
    && event.evaluationId
    && event.recommendationDecision === 'accepted'
    && event.applicationStatus === 'failed'
  );
}

export function canRetrySubmissionEvaluation(event: TimelineEvent): boolean {
  return Boolean(
    event.kind === '提交'
    && event.submissionId
    && event.evaluationStatus === 'failed'
  );
}
