import { useEffect, useMemo, useState } from 'react';
import { BookOpenCheck, Brain, CalendarClock, ClipboardCheck, FileCheck2, FileText, Lightbulb, Loader2, Sparkles } from 'lucide-react';
import type { KnowledgeItem, LearningGoal, LearningOverviewState, LearningRuntimeSnapshot, PlanAdjustmentProposal, PlanVersionEntry, ResumableGuideSummary, ReviewResult } from '../../../shared/types';

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

type TaskRecord = {
  id: string;
  kind: 'task';
  at: string;
  title: string;
  statusLabel: string;
  task: ExportRow;
  actions: ExportRow[];
  sessions: ExportRow[];
  submissions: ExportRow[];
  evaluations: ExportRow[];
  questions: Array<{ thread: ExportRow; answer: string }>;
};

type StandaloneRecord = {
  id: string;
  kind: 'question' | 'review';
  at: string;
  title: string;
  summary: string;
};

type LearningRecord = TaskRecord | StandaloneRecord;

function rows(value: unknown): ExportRow[] { return Array.isArray(value) ? value.filter((item): item is ExportRow => Boolean(item) && typeof item === 'object') : []; }
function text(value: unknown): string { return typeof value === 'string' ? value : ''; }
export function getLatestQuestionAnswer(exportData: Record<string, unknown>, threadId: string): string {
  let latestAnswer = '';
  let latestCreatedAt = '';
  const messages = rows(exportData.conversationMessages).length > 0
    ? rows(exportData.conversationMessages)
    : rows(exportData.questionMessages);
  for (const message of messages) {
    const content = text(message.content);
    const createdAt = text(message.createdAt);
    if (text(message.threadId) === threadId && text(message.role) === 'assistant' && content && createdAt >= latestCreatedAt) {
      latestAnswer = content;
      latestCreatedAt = createdAt;
    }
  }
  return latestAnswer;
}
function dateTime(value: string): string {
  if (!value) return '';
  return new Date(value).toLocaleString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function latestDate(values: string[]): string {
  return values.filter(Boolean).sort((left, right) => right.localeCompare(left))[0] ?? '';
}
function taskStatusLabel(task: ExportRow, isCurrent: boolean): string {
  if (isCurrent) return '当前学习';
  const closure = text(task.closureKind);
  if (closure === 'completed') return '已完成';
  if (closure === 'partial') return '部分完成';
  if (closure === 'abandoned') return '已放弃';
  if (closure === 'replaced') return '已替换';
  if (text(task.status) === 'deferred') return '已暂缓';
  return '学习记录';
}
function actionStatusLabel(status: string): string {
  if (status === 'done') return '已完成';
  if (status === 'skipped') return '已跳过';
  return '未完成';
}
function evaluationEvent(evaluation: ExportRow, title: string): TimelineEvent {
  const source = text(evaluation.source);
  return {
    id: `evaluation-${text(evaluation.id)}`,
    at: text(evaluation.createdAt),
    kind: source === 'user_correction' ? '评价纠正' : '评价',
    title,
    summary: text(evaluation.feedback) || '评价已完成',
    evaluationId: source === 'user_correction' ? undefined : text(evaluation.id) || undefined,
    recommendedAction: extractRecommendationAction(text(evaluation.recommendationJson)),
    recommendationDecision: text(evaluation.recommendationDecision) || undefined,
    applicationStatus: text(evaluation.applicationStatus) || null
  };
}
function submissionEvent(submission: ExportRow, title: string): TimelineEvent {
  return {
    id: `submission-${text(submission.id)}`,
    at: text(submission.createdAt),
    kind: '提交',
    title,
    summary: text(submission.content),
    submissionId: text(submission.id),
    evaluationStatus: text(submission.evaluationStatus) || 'waiting'
  };
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

  const records = useMemo<LearningRecord[]>(() => {
    const tasks = rows(exportData.learningTasks);
    const actions = rows(exportData.learningActions);
    const sessions = rows(exportData.focusSessions);
    const submissions = rows(exportData.learningSubmissions);
    const evaluations = rows(exportData.learningEvaluations);
    const messages = rows(exportData.conversationMessages);
    const threads = rows(exportData.conversationThreads);
    const currentTaskId = learningState?.dailyGuideTask?.id ?? '';
    const threadTaskId = new Map<string, string>();
    for (const message of messages) {
      const linkedTaskId = text(message.linkedTaskId);
      if (linkedTaskId) threadTaskId.set(text(message.threadId), linkedTaskId);
    }

    const taskRecords: TaskRecord[] = tasks.flatMap((task) => {
      const taskId = text(task.id);
      const taskActions = actions.filter((item) => text(item.taskId) === taskId);
      const taskSessions = sessions.filter((item) => text(item.taskId) === taskId);
      const taskSubmissions = submissions.filter((item) => text(item.taskId) === taskId)
        .sort((left, right) => text(right.createdAt).localeCompare(text(left.createdAt)));
      const submissionIds = new Set(taskSubmissions.map((item) => text(item.id)));
      const taskEvaluations = evaluations.filter((item) => submissionIds.has(text(item.submissionId)))
        .sort((left, right) => text(right.createdAt).localeCompare(text(left.createdAt)));
      const taskQuestions = threads
        .filter((thread) => threadTaskId.get(text(thread.id)) === taskId)
        .map((thread) => ({ thread, answer: getLatestQuestionAnswer(exportData, text(thread.id)) }));
      const isCurrent = taskId === currentTaskId;
      const hasActivity = isCurrent
        || text(task.status) !== 'planned'
        || taskActions.some((item) => text(item.status) !== 'planned')
        || taskSessions.length > 0
        || taskSubmissions.length > 0
        || taskQuestions.length > 0;
      if (!hasActivity) return [];
      const at = latestDate([
        text(task.updatedAt),
        ...taskActions.map((item) => text(item.completedAt)),
        ...taskSessions.map((item) => text(item.endedAt) || text(item.startedAt)),
        ...taskSubmissions.map((item) => text(item.createdAt)),
        ...taskEvaluations.map((item) => text(item.createdAt)),
        ...taskQuestions.map(({ thread }) => text(thread.updatedAt) || text(thread.createdAt))
      ]);
      return [{
        id: `task-${taskId}`,
        kind: 'task' as const,
        at,
        title: text(task.title) || '学习任务',
        statusLabel: taskStatusLabel(task, isCurrent),
        task,
        actions: taskActions.sort((left, right) => Number(left.position) - Number(right.position)),
        sessions: taskSessions,
        submissions: taskSubmissions,
        evaluations: taskEvaluations,
        questions: taskQuestions
      }];
    });

    const standaloneQuestions: StandaloneRecord[] = threads
      .filter((thread) => !threadTaskId.get(text(thread.id)))
      .map((thread) => ({
        id: `question-${text(thread.id)}`,
        kind: 'question' as const,
        at: text(thread.updatedAt) || text(thread.createdAt),
        title: text(thread.question) || '独立问题',
        summary: getLatestQuestionAnswer(exportData, text(thread.id)) || text(thread.resolutionSummary) || '尚未形成回答'
      }));
    const reviewRecords: StandaloneRecord[] = selectedGoalIsCurrent && review ? [{
      id: `review-${review.reviewId}`,
      kind: 'review',
      at: `${todayGuide?.guide?.date ?? new Date().toISOString().slice(0, 10)}T23:59:00`,
      title: '学习复盘',
      summary: review.summary
    }] : [];
    return [...taskRecords, ...standaloneQuestions, ...reviewRecords]
      .filter((item) => item.at)
      .sort((left, right) => right.at.localeCompare(left.at));
  }, [exportData, learningState, review, selectedGoalIsCurrent, todayGuide?.guide?.date]);

  const selected = records.find((item) => item.id === selectedId) ?? records[0] ?? null;
  const selectedTask = selected?.kind === 'task' ? selected : null;
  const selectedTaskDoneActions = selectedTask?.actions.filter((item) => text(item.status) === 'done').length ?? 0;
  const selectedTaskMinutes = selectedTask
    ? Math.round(selectedTask.sessions.reduce((total, item) => total + Number(item.durationSeconds || 0), 0) / 60)
    : 0;
  const latestSubmission = selectedTask?.submissions[0] ?? null;
  const latestSubmissionEvent = latestSubmission && selectedTask
    ? submissionEvent(latestSubmission, selectedTask.title)
    : null;
  const latestEvaluation = selectedTask?.evaluations[0] ?? null;
  const latestEvaluationEvent = latestEvaluation && selectedTask
    ? evaluationEvent(latestEvaluation, selectedTask.title)
    : null;
  const selectedTaskFollowup = selectedTask && text(selectedTask.task.closureKind)
    ? text(selectedTask.task.nextStartPoint)
      || text(selectedTask.task.closureReason)
      || (text(selectedTask.task.closureKind) === 'completed' ? '任务已完成，后续学习按当前计划继续。' : '')
    : '';
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
      <div className="records-view-toolbar">
        <nav className="records-tabs" aria-label="记录类型">{([['timeline', '学习记录', records.length], ['knowledge', '知识与薄弱点', knowledgeItemsForView.length], ['versions', '计划变更', versions.length]] as const).map(([key, label, count]) => <button key={key} type="button" className={tab === key ? 'active' : ''} onClick={() => setTab(key)}><span>{label}</span>{count > 0 && <small>{count}</small>}</button>)}</nav>
        <div className="records-goal-filter">
          <select
            id="records-goal-select"
            aria-label="选择要查看的学习目标"
            value={selectedGoal?.id ?? ''}
            onChange={(event) => {
              setSelectedGoalId(event.target.value || null);
              setConfirmingGuideId(null);
            }}
            disabled={availableGoals.length === 0}
          >
            {availableGoals.length === 0 && <option value="">暂无目标</option>}
            {availableGoals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}
          </select>
          {loading && <span className="records-loading"><Loader2 className="spin" size={15} />正在整理</span>}
          {!selectedGoalIsCurrent && selectedGoal && <span className="records-history-readonly">历史记录只读</span>}
        </div>
      </div>

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

      {tab === 'timeline' && <div className="records-dashboard-grid">
        <article className="record-detail records-reference-card">{selectedTask ? <>
          <header className="record-detail-header"><div><span className="section-label">任务记录</span><h2>{selectedTask.title}</h2><p>{dateTime(selectedTask.at)}</p></div></header>
          <div className="record-overview"><span>完成 <strong>{selectedTaskDoneActions}/{selectedTask.actions.length}</strong> 个行动</span>{selectedTaskMinutes > 0 && <span>学习 <strong>{selectedTaskMinutes}</strong> 分钟</span>}{selectedTask.questions.length > 0 && <span>提出 <strong>{selectedTask.questions.length}</strong> 个问题</span>}{selectedTask.submissions.length > 0 && <span>提交 <strong>{selectedTask.submissions.length}</strong> 次成果</span>}</div>

          <section className="record-detail-section"><h3>本次完成</h3>{selectedTask.actions.length > 0 ? <div className="record-action-list">{selectedTask.actions.map((action) => <div key={text(action.id)} className={`record-action ${text(action.status)}`}><span>{actionStatusLabel(text(action.status))}</span><div><strong>{text(action.title)}</strong>{text(action.progressNote) && <p>{text(action.progressNote)}</p>}</div></div>)}</div> : <p className="record-section-empty">没有单独拆分行动步骤。</p>}</section>

          {selectedTask.submissions.length > 0 && <section className="record-detail-section"><h3>成果与证据</h3>{selectedTask.submissions.map((submission, index) => <div className="record-evidence" key={text(submission.id)}><div><strong>第 {selectedTask.submissions.length - index} 次提交</strong><time>{dateTime(text(submission.createdAt))}</time></div><p>{text(submission.content) || '已提交成果，但没有文字说明。'}</p></div>)}
          {latestSubmissionEvent && canRetrySubmissionEvaluation(latestSubmissionEvent) && onRetryEvaluation && <button className="secondary-action" type="button" disabled={retryingSubmissionId === latestSubmissionEvent.submissionId} onClick={() => { setRetryingSubmissionId(latestSubmissionEvent.submissionId!); void onRetryEvaluation(latestSubmissionEvent.submissionId!).finally(() => setRetryingSubmissionId(null)); }}>{retryingSubmissionId === latestSubmissionEvent.submissionId ? '正在重试…' : '重试导师评价'}</button>}</section>}

          {latestEvaluation && <section className="record-detail-section"><h3>导师评价</h3><div className="record-evaluation-result"><span>{evaluationResultLabel(text(latestEvaluation.result))}</span><p>{text(latestEvaluation.feedback) || '评价已完成。'}</p></div>{text(latestEvaluation.recommendationDecision) && <small>建议状态：{recommendationDecisionLabel(text(latestEvaluation.recommendationDecision))}</small>}
          {selectedGoalIsCurrent && latestEvaluationEvent && canDecideEvaluationRecommendation(latestEvaluationEvent) && onDecideEvaluationRecommendation && <div className="records-pending-buttons"><button className="primary-action" type="button" onClick={() => void onDecideEvaluationRecommendation(latestEvaluationEvent.evaluationId!, 'accepted')}>{latestEvaluationEvent.recommendedAction === 'complete_task' ? '采纳推荐并完成任务' : '采纳推荐'}</button><button className="secondary-action" type="button" onClick={() => void onDecideEvaluationRecommendation(latestEvaluationEvent.evaluationId!, 'deferred')}>稍后决定</button><button className="secondary-action" type="button" onClick={() => void onDecideEvaluationRecommendation(latestEvaluationEvent.evaluationId!, 'declined')}>不采纳</button></div>}
          {selectedGoalIsCurrent && latestEvaluationEvent && canRetryEvaluationRecommendation(latestEvaluationEvent) && onDecideEvaluationRecommendation && <button className="primary-action" type="button" onClick={() => void onDecideEvaluationRecommendation(latestEvaluationEvent.evaluationId!, 'accepted')}>重试应用</button>}</section>}

          {selectedTask.questions.length > 0 && <section className="record-detail-section"><h3>提问与澄清</h3>{selectedTask.questions.map(({ thread, answer }) => <div className="record-question" key={text(thread.id)}><strong>{text(thread.question)}</strong><p>{answer || text(thread.resolutionSummary) || '尚未形成回答。'}</p></div>)}</section>}

          {selectedTask.submissions.length === 0 && <p className="record-completion-note">完成任务并提交成果后，这里会保存成果证据和导师评价。</p>}
          {selectedTaskFollowup && <section className="record-detail-section"><h3>后续安排</h3><p>{selectedTaskFollowup}</p></section>}
        </> : selected && selected.kind !== 'task' ? <>
          <header className="record-detail-header"><div><span className="section-label">{selected.kind === 'review' ? '学习复盘' : '独立问题'}</span><h2>{selected.title}</h2><p>{dateTime(selected.at)}</p></div></header><p>{selected.summary}</p>
          {selected.kind === 'review' && selectedGoalIsCurrent && review && <section className="review-result"><h3>后续行动与计划调整</h3>{review.nextActions.length > 0 && <ul>{review.nextActions.map((item) => <li key={item}>{item}</li>)}</ul>}{review.planAdjustments.length > 0 && onApplyPlanAdjustments && <><div className="proposal-note"><Brain size={16} /><span>以下是 AI 建议，尚未应用到正式计划。</span></div>{review.planAdjustments.map((item) => <div className="record-proposal" key={`${item.itemIndex}-${item.title}`}><strong>第 {item.itemIndex} 单元 · {item.title}</strong><span>{item.focus}</span><small>影响范围：尚未执行的对应学习单元</small></div>)}<button className="primary-action" type="button" disabled={applying} onClick={() => { setApplying(true); void onApplyPlanAdjustments(review.planAdjustments).finally(() => setApplying(false)); }}>{applying ? '正在应用…' : '确认应用调整'}</button></>}</section>}
        </> : <div className="records-empty"><FileText size={20} /><span>选择一条记录查看详情。</span></div>}</article>

        <aside className="record-index records-reference-card"><header><h2>学习记录</h2><span>{records.length} 项</span></header><div className="record-list">{records.length === 0 ? <div className="records-empty"><CalendarClock size={20} /><strong>还没有学习记录</strong><span>开始执行学习任务后，这里会按任务汇总记录。</span></div> : records.map((record) => {
          const isTask = record.kind === 'task';
          const doneActions = isTask ? record.actions.filter((item) => text(item.status) === 'done').length : 0;
          const summaryParts = isTask ? [record.actions.length > 0 ? `${doneActions}/${record.actions.length} 步` : '', record.questions.length > 0 ? `${record.questions.length} 个问题` : '', record.submissions.length > 0 ? `${record.submissions.length} 次提交` : ''].filter(Boolean) : [];
          return <button type="button" key={record.id} className={selected?.id === record.id ? 'record-row active' : 'record-row'} onClick={() => setSelectedId(record.id)}><div className="record-row-heading"><strong>{record.title}</strong><span>{isTask ? record.statusLabel : record.kind === 'review' ? '复盘' : '独立问题'}</span></div><small>{dateTime(record.at)}</small>{isTask && summaryParts.length > 0 && <em>{summaryParts.join(' · ')}</em>}</button>;
        })}</div></aside>
      </div>}

      {tab === 'knowledge' && <section className="records-reference-card knowledge-records">{knowledgeItemsForView.length === 0 ? <div className="records-empty"><Lightbulb size={20} /><strong>暂无知识与薄弱点记录</strong><span>重复薄弱点、纠正和洞见会在完成评价后出现。</span></div> : knowledgeItemsForView.map((item) => <article key={item.id}><span>{item.masteryLabel}</span><h3>{item.key}</h3><p>{item.summary}</p><p>{item.masteryReason}</p><small>{item.evidenceCount > 1 ? `${item.evidenceCount} 条真实证据` : '1 条真实证据'} · {item.status === 'resolved' ? '用户已确认' : item.status === 'dormant' ? '已排除后续关注' : '持续关注'}</small>{selectedGoalIsCurrent && <div className="records-pending-buttons">{item.status === 'active' ? <><button className="secondary-action" type="button" onClick={() => void onSetKnowledgeStatus(item.id, 'resolved')}>纠正为已掌握</button><button className="secondary-action" type="button" onClick={() => void onSetKnowledgeStatus(item.id, 'dormant')}>排除后续关注</button></> : <button className="secondary-action" type="button" onClick={() => void onSetKnowledgeStatus(item.id, 'active')}>恢复关注</button>}</div>}</article>)}</section>}

      {tab === 'versions' && <section className="records-reference-card version-records">{versions.length === 0 ? <div className="records-empty"><FileCheck2 size={20} /><strong>暂无计划变更</strong><span>生成或确认计划调整后会在这里保留变更记录。</span></div> : versions.map((version) => <article key={version.version}><span>v{version.version}</span><div><h3>{readableVersionTitle(version.changeSummary, version.version)}</h3><p>{new Date(version.createdAt).toLocaleString('zh-CN')}</p>{version.snapshot?.shortPlan?.length ? <small>涉及：{version.snapshot.shortPlan.map((item) => `第 ${item.itemIndex} 单元`).join('、')}</small> : null}</div></article>)}</section>}

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
