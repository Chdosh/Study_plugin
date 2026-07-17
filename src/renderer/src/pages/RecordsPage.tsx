import { useEffect, useMemo, useState } from 'react';
import { BookOpenCheck, Brain, CalendarClock, ClipboardCheck, FileCheck2, FileText, Lightbulb, Loader2, Sparkles } from 'lucide-react';
import type { KnowledgeItem, LearningRuntimeSnapshot, PlanAdjustmentProposal, PlanVersionEntry, ReviewResult, TodayGuideState } from '../../../shared/types';
import { deriveLearningTaskStatus } from '../domain/learning-status';

type RecordTab = 'timeline' | 'knowledge' | 'versions';
type ExportRow = Record<string, unknown>;
type TimelineEvent = { id: string; at: string; kind: string; title: string; summary: string };

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

export function RecordsPage({ review, todayGuide, learningState, pendingAdjustment, onGenerate, hasApiKey, onDecideAdjustment, onConfirmRoadmapStage, onApplyPlanAdjustments, onGenerateRollingPlan, knowledgeItems }: {
  review: ReviewResult | null;
  todayGuide: TodayGuideState | null;
  learningState: LearningRuntimeSnapshot | null;
  pendingAdjustment: PlanAdjustmentProposal | null;
  onGenerate: () => Promise<void>;
  hasApiKey: boolean;
  onDecideAdjustment: (proposalId: string, status: 'accepted' | 'rejected') => Promise<void>;
  onConfirmRoadmapStage?: (stageId: string) => Promise<void>;
  onApplyPlanAdjustments?: (adjustments: ReviewResult['planAdjustments']) => Promise<number>;
  onGenerateRollingPlan?: () => Promise<void>;
  knowledgeItems: KnowledgeItem[];
}): JSX.Element {
  const [tab, setTab] = useState<RecordTab>('timeline');
  const [exportData, setExportData] = useState<Record<string, unknown>>({});
  const [versions, setVersions] = useState<PlanVersionEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    const goalId = todayGuide?.goal?.id;
    if (!goalId) { setExportData({}); setVersions([]); return; }
    setLoading(true);
    void Promise.all([window.studyApp.data.exportGoal(goalId), window.studyApp.data.getPlanVersions(goalId)])
      .then(([data, nextVersions]) => { setExportData(data); setVersions(nextVersions); })
      .finally(() => setLoading(false));
  }, [todayGuide?.goal?.id]);

  const events = useMemo<TimelineEvent[]>(() => {
    const tasks = rows(exportData.dailyGuideTasks);
    const taskTitle = new Map(tasks.map((task) => [text(task.id), text(task.title) || '学习任务']));
    const actions = rows(exportData.dailyGuideActions);
    const actionTitle = new Map(actions.map((action) => [text(action.id), text(action.title) || '行动步骤']));
    const result: TimelineEvent[] = [];
    const currentTaskStatus = learningState?.dailyGuideTask ? deriveLearningTaskStatus(learningState.dailyGuideTask, learningState.latestSubmission ? {
      evaluationStatus: learningState.latestSubmission.evaluationStatus,
      evaluationResult: learningState.latestEvaluation?.result
    } : null) : null;
    rows(exportData.studySessions).forEach((session) => {
      const isCurrent = text(session.taskId) === learningState?.dailyGuideTask?.id && ['active', 'paused'].includes(text(session.status));
      const sessionLabel = isCurrent && currentTaskStatus?.phase !== 'executing'
        ? currentTaskStatus?.label ?? '进行中'
          : text(session.status) === 'completed' ? '已完成' : text(session.status) === 'paused' ? '已暂停' : '进行中';
      result.push({ id: `session-${text(session.id)}`, at: text(session.startedAt), kind: '学习会话', title: taskTitle.get(text(session.taskId)) ?? '学习会话', summary: `${sessionLabel}${Number(session.durationMinutes) > 0 ? ` · ${Number(session.durationMinutes)} 分钟` : ''}` });
    });
    actions.filter((action) => ['done', 'skipped'].includes(text(action.status))).forEach((action) => result.push({ id: `action-${text(action.id)}`, at: text(action.completedAt) || text(action.updatedAt), kind: '行动', title: actionTitle.get(text(action.id)) ?? '行动步骤', summary: text(action.status) === 'done' ? '步骤已完成' : '步骤已跳过' }));
    rows(exportData.submissions).forEach((submission) => result.push({ id: `submission-${text(submission.id)}`, at: text(submission.createdAt), kind: '提交', title: actionTitle.get(text(submission.dailyGuideActionId)) ?? '主任务结果', summary: '学习结果已保存' }));
    rows(exportData.evaluations).forEach((evaluation) => result.push({ id: `evaluation-${text(evaluation.id)}`, at: text(evaluation.createdAt), kind: '评价', title: '提交评价结果', summary: text(evaluation.feedback) || text(evaluation.summary) || '评价已完成' }));
    rows(exportData.questionThreads).forEach((thread) => result.push({ id: `question-${text(thread.id)}`, at: text(thread.createdAt), kind: '问题', title: text(thread.question) || '问题分支', summary: getLatestQuestionAnswer(exportData, text(thread.id)) || text(thread.resolutionSummary) || (text(thread.status) === 'resolved' ? '问题已解决' : '待继续处理') }));
    if (review) result.push({ id: `review-${review.reviewId}`, at: `${todayGuide?.guide?.date ?? new Date().toISOString().slice(0, 10)}T23:59:00`, kind: '复盘', title: '学习复盘', summary: review.summary });
    return result.filter((item) => item.at).sort((a, b) => b.at.localeCompare(a.at));
  }, [exportData, learningState, review, todayGuide?.guide?.date]);

  const selected = events.find((item) => item.id === selectedId) ?? events[0] ?? null;
  const selectedSummary = selected && normalizedText(selected.summary) !== normalizedText(selected.title) ? selected.summary : '';
  const stageReady = todayGuide?.roadmap.find((stage) => stage.status === 'ready_for_review') ?? null;

  return (
    <section className="records-page">
      <header className="records-header"><div><h1>记录</h1><p>追溯学习过程、结果证据，以及计划如何随学习结果变化。</p></div>{loading && <span className="records-loading"><Loader2 className="spin" size={15} />正在整理记录</span>}</header>

      {(stageReady || pendingAdjustment?.status === 'pending') && <section className="records-pending">
        <header><div><span className="page-kicker">待处理</span><h2>需要你的决定</h2></div></header>
        {stageReady && onConfirmRoadmapStage && <div className="records-pending-row"><span className="records-pending-icon"><ClipboardCheck size={18} /></span><div><strong>阶段成果待确认</strong><p>“{stageReady.title}”需要人工复核后才会推进。</p></div><button className="primary-action" type="button" onClick={() => void onConfirmRoadmapStage(stageReady.id)}>确认阶段成果</button></div>}
        {pendingAdjustment?.status === 'pending' && <div className="records-pending-row"><span className="records-pending-icon"><BookOpenCheck size={18} /></span><div><strong>即时调整待决定</strong><p>{pendingAdjustment.reason}</p></div><div className="records-pending-buttons"><button className="primary-action" type="button" onClick={() => void onDecideAdjustment(pendingAdjustment.id, 'accepted')}>采纳建议</button><button className="secondary-action" type="button" onClick={() => void onDecideAdjustment(pendingAdjustment.id, 'rejected')}>保持原计划</button></div></div>}
      </section>}

      <section className="records-browser-card">
        <nav className="records-tabs" aria-label="记录类型">{([['timeline', '时间线', events.length], ['knowledge', '知识沉淀', knowledgeItems.length], ['versions', '计划版本', versions.length]] as const).map(([key, label, count]) => <button key={key} type="button" className={tab === key ? 'active' : ''} onClick={() => setTab(key)}><span>{label}</span><small>{count}</small></button>)}</nav>

        {tab === 'timeline' && <div className="records-master-detail">
        <div className="record-list">{events.length === 0 ? <div className="records-empty"><CalendarClock size={20} /><strong>还没有学习记录</strong><span>开始一次学习后，Session、步骤、提交和评价会按时间汇总在这里。</span></div> : events.map((event) => <button type="button" key={event.id} className={selected?.id === event.id ? 'record-row active' : 'record-row'} onClick={() => setSelectedId(event.id)}><span>{event.kind}</span><strong>{event.title}</strong><small>{new Date(event.at).toLocaleString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small></button>)}</div>
        <article className="record-detail">{selected ? <><span className="record-kind">{selected.kind}</span><h2>{selected.title}</h2>{selectedSummary && <p>{selectedSummary}</p>}</> : <div className="records-empty"><FileText size={20} /><span>选择一条记录查看详情。</span></div>}
          {review && selected?.kind === '复盘' && <section className="review-result"><h3>后续行动与计划调整</h3>{review.nextActions.length > 0 && <ul>{review.nextActions.map((item) => <li key={item}>{item}</li>)}</ul>}{review.planAdjustments.length > 0 && onApplyPlanAdjustments && <><div className="proposal-note"><Brain size={16} /><span>以下是 AI 建议，尚未应用到正式计划。</span></div>{review.planAdjustments.map((item) => <div className="record-proposal" key={`${item.dayIndex}-${item.title}`}><strong>第 {item.dayIndex} 单元 · {item.title}</strong><span>{item.focus}</span><small>影响范围：尚未执行的对应学习单元</small></div>)}<button className="primary-action" type="button" disabled={applying} onClick={() => { setApplying(true); void onApplyPlanAdjustments(review.planAdjustments).finally(() => setApplying(false)); }}>{applying ? '正在应用…' : '确认应用调整'}</button></>}</section>}
        </article>
        </div>}

        {tab === 'knowledge' && <div className="knowledge-records">{knowledgeItems.length === 0 ? <div className="records-empty"><Lightbulb size={20} /><strong>暂无知识沉淀</strong><span>重复薄弱点、纠正和洞见会在完成评价后出现。</span></div> : knowledgeItems.map((item) => <article key={item.id}><span>{item.sourceType === 'misconception' ? '错误' : item.sourceType === 'weakness' ? '薄弱点' : item.sourceType === 'correction' ? '纠正' : '洞见'}</span><h3>{item.key}</h3><p>{item.summary}</p><small>{item.occurrenceCount > 1 ? `出现 ${item.occurrenceCount} 次` : '首次记录'} · {item.status === 'resolved' ? '已解决' : '持续关注'}</small></article>)}</div>}

        {tab === 'versions' && <div className="version-records">{versions.length === 0 ? <div className="records-empty"><FileCheck2 size={20} /><strong>暂无计划版本</strong><span>生成或确认计划调整后会在这里保留版本记录。</span></div> : versions.map((version) => <article key={version.version}><span>v{version.version}</span><div><h3>{readableVersionTitle(version.changeSummary, version.version)}</h3><p>{new Date(version.createdAt).toLocaleString('zh-CN')}</p>{version.snapshot?.shortPlan?.length ? <small>涉及：{version.snapshot.shortPlan.map((day) => `第 ${day.dayIndex} 单元`).join('、')}</small> : null}</div></article>)}</div>}
      </section>

      <section className="records-actions">
        {!review && hasApiKey && <button className="secondary-action records-review-action" type="button" disabled={generating} onClick={() => { setGenerating(true); void onGenerate().finally(() => setGenerating(false)); }}><Sparkles size={16} />{generating ? '正在生成复盘…' : '按需生成复盘'}</button>}
        {review && onGenerateRollingPlan && <button className="secondary-action records-review-action" type="button" onClick={() => void onGenerateRollingPlan()}>生成下一批学习任务</button>}
      </section>
    </section>
  );
}
