import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  ClipboardCheck,
  Clock3,
  FileText,
  Lightbulb,
  Loader2,
  Play,
  Sparkles,
  TrendingUp
} from 'lucide-react';
import type { KnowledgeItem, PlanAdjustmentProposal, ReviewResult, TodayGuideState } from '../../../shared/types';

export function ReviewPage({
  review,
  todayGuide,
  reviewGuide,
  pendingAdjustment,
  onGenerate,
  hasApiKey,
  onDecideAdjustment,
  onGenerateRollingPlan,
  onApplyPlanAdjustments
}: {
  review: ReviewResult | null;
  todayGuide: TodayGuideState | null;
  reviewGuide: TodayGuideState | null;
  pendingAdjustment: PlanAdjustmentProposal | null;
  onGenerate: () => Promise<void>;
  hasApiKey: boolean;
  onDecideAdjustment: (proposalId: string, status: 'accepted' | 'rejected') => Promise<void>;
  onGenerateRollingPlan?: () => Promise<void>;
  onApplyPlanAdjustments?: (adjustments: ReviewResult['planAdjustments']) => Promise<void>;
}): JSX.Element {
  const [generating, setGenerating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [adjustmentsApplied, setAdjustmentsApplied] = useState(false);
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);

  useEffect(() => {
    setAdjustmentsApplied(false);
  }, [review?.reviewId]);

  useEffect(() => {
    if (todayGuide?.goal?.id && window.studyApp?.knowledge?.listForGoal) {
      void window.studyApp.knowledge.listForGoal(todayGuide.goal.id).then(setKnowledgeItems).catch(() => {});
    }
  }, [todayGuide?.goal?.id]);

  const allActions = review?.nextActions ?? [];
  const displayGuide = review ? reviewGuide : todayGuide;
  const guideTasks = displayGuide?.guide?.tasks ?? [];
  const recordedMinutes = guideTasks.reduce((sum, task) => sum + (task.totalElapsedMinutes || 0), 0);
  const focusScore = review?.focusScore ?? 0;

  const plannedTasksTotal = displayGuide?.guide?.tasks.length ?? 0;
  const tasksTotal = plannedTasksTotal;
  const tasksDone = guideTasks.filter((task) => task.status === 'done').length;
  // AI review 的 completionScore 仅作复盘评分参考，不覆盖基于 task status 的事实统计
  const completionScore = review
    ? review.completionScore
    : plannedTasksTotal > 0
      ? Math.round((tasksDone / plannedTasksTotal) * 100)
      : 0;
  const todayLabel = `${new Date().getMonth() + 1}/${String(new Date().getDate()).padStart(2, '0')}`;
  const last7Days = [
    { label: '—', value: 0 },
    { label: '—', value: 0 },
    { label: '—', value: 0 },
    { label: '—', value: 0 },
    { label: '—', value: 0 },
    { label: '—', value: 0 },
    { label: todayLabel, value: recordedMinutes || 0 }
  ];
  const maxBar = Math.max(...last7Days.map((d) => d.value), 1);
  const hasReview = Boolean(review);
  const blockerItems: string[] = [];
  const suggestionItems: string[] = [];
  if (hasReview && review) {
    if (focusScore < 70) blockerItems.push('专注稳定性仍需提升');
    review.nextActions.forEach((a) => { if (a) suggestionItems.push(a); });
  } else if (tasksDone === tasksTotal && tasksTotal > 0) {
    suggestionItems.push('当前批次任务已全部完成，可以复盘并根据学习路径生成下一批任务。');
  } else if (pendingAdjustment?.reason) {
    suggestionItems.push(pendingAdjustment.reason);
  }

  return (
    <section className="review-layout">
      <div className="review-main">
        <header className="page-title-block">
          <h1>复盘</h1>
          <p>回顾今天的完成情况，形成可持续的学习节奏</p>
        </header>

        <section className="review-stats-row">
          <div className="review-stat-card">
            <CheckCircle2 size={28} />
            <div>
              <span>今日完成</span>
              <strong>{tasksDone}/{tasksTotal} 任务</strong>
            </div>
          </div>
          <div className="review-stat-card">
            <Clock3 size={28} />
            <div>
              <span>学习时长</span>
              <strong>{recordedMinutes > 0 ? `${recordedMinutes} 分钟` : '-'}</strong>
            </div>
          </div>
          <div className="review-stat-card">
            <TrendingUp size={28} />
            <div>
              <span>完成率</span>
              <strong>{completionScore}%</strong>
            </div>
          </div>
        </section>

        <section className="surface review-summary-card">
          <div className="review-summary-header">
            <span className="summary-icon"><FileText size={22} /></span>
            <div>
              <strong>本次学习总结</strong>
              <p>{review ? review.summary : '完成主任务后，可以在这里手动生成或查看复盘。'}</p>
            </div>
          </div>
          <div className="review-tag-row">
            {guideTasks.filter((t) => t.status === 'done').map((task) => (
              <span key={task.id}><CircleDot size={12} />已完成：{task.title}</span>
            ))}
            {guideTasks.filter((t) => t.status !== 'done').map((task) => (
              <span key={task.id} className="warning"><CircleDot size={12} />待完成：{task.title}</span>
            ))}
            {guideTasks.length === 0 && (
              <span><CircleDot size={12} />暂无任务记录</span>
            )}
          </div>
        </section>

        <section className="surface review-timeline-card">
          <h3>学习记录</h3>
          {!review && recordedMinutes <= 0 && (
            <p className="muted">暂无学习记录，完成一次学习后会在这里汇总。</p>
          )}
          <div className="review-timeline">
            {recordedMinutes > 0 && (
              <div className="timeline-item">
                <span className="timeline-dot" />
                <span className="timeline-time">今日</span>
                <span className="timeline-text">累计学习 · {recordedMinutes} 分钟</span>
              </div>
            )}
            {review && (
              <div className="timeline-item">
                <span className="timeline-dot" />
                <span className="timeline-time">-</span>
                <span className="timeline-text">生成复盘 · {completionScore}% 完成率</span>
              </div>
            )}
          </div>
        </section>

        {pendingAdjustment?.status === 'pending' && (
          <section className="surface review-adjustment-card">
            <h3><AlertTriangle size={16} /> 即时补救建议</h3>
            <p className="muted">基于上次评估的即时建议，仅影响当前学习路径推进。</p>
            <p className="muted">{pendingAdjustment.reason}</p>
            <div className="review-decision-actions">
              <button
                className="primary-action"
                type="button"
                onClick={() => void onDecideAdjustment(pendingAdjustment.id, 'accepted')}
              >
                <CheckCircle2 size={16} />
                采纳建议
              </button>
              <button
                className="secondary-action"
                type="button"
                onClick={() => void onDecideAdjustment(pendingAdjustment.id, 'rejected')}
              >
                <ClipboardCheck size={16} />
                保持原计划
              </button>
            </div>
          </section>
        )}

        {!review && hasApiKey && !generating && (
          <button
            className="primary-action review-generate-action"
            type="button"
            onClick={() => {
              setGenerating(true);
              void onGenerate().finally(() => setGenerating(false));
            }}
          >
            <Sparkles size={16} />
            生成 AI 复盘
          </button>
        )}
        {generating && (
          <div className="micro-hint">
            <Loader2 className="spin" size={16} />
            正在生成复盘…
          </div>
        )}
        {review && review.planAdjustments.length > 0 && onApplyPlanAdjustments && (
          <section className="surface review-adjustment-card">
            <h3><Lightbulb size={16} /> 计划调整建议</h3>
            <p className="muted">
              {adjustmentsApplied ? '调整建议已应用到尚未执行的学习单元。' : 'AI 建议对尚未执行的学习单元做以下调整：'}
            </p>
            <div className="adjustment-items">
              {review.planAdjustments.map((adj, idx) => (
                <div key={idx} className="adjustment-item">
                  <strong>第 {adj.dayIndex} 单元：{adj.title}</strong>
                  <span>重点：{adj.focus}</span>
                  <span>预期产出：{adj.expectedOutput}</span>
                  <span className="muted">原因：{adj.reason}</span>
                </div>
              ))}
            </div>
            <div className="review-decision-actions">
              <button
                className="primary-action"
                type="button"
                disabled={applying || adjustmentsApplied}
                onClick={() => {
                  setApplying(true);
                  void onApplyPlanAdjustments(review.planAdjustments)
                    .then(() => setAdjustmentsApplied(true))
                    .finally(() => setApplying(false));
                }}
              >
                <CheckCircle2 size={16} />
                {adjustmentsApplied ? '已应用调整' : '采纳调整建议'}
              </button>
            </div>
          </section>
        )}
        {review && onGenerateRollingPlan && (
          <button
            className="primary-action review-generate-action"
            type="button"
            style={{ marginTop: 12 }}
            onClick={() => void onGenerateRollingPlan()}
          >
            <Play size={16} />
            生成下一批学习任务
          </button>
        )}
        {knowledgeItems.length > 0 && (
          <section className="surface review-knowledge-card">
            <h3><Lightbulb size={16} /> 错题与薄弱点</h3>
            <div className="knowledge-items">
              {knowledgeItems.map((item) => (
                <div key={item.id} className="knowledge-item">
                  <div className="knowledge-item-head">
                    <strong>{item.key}</strong>
                    {item.occurrenceCount >= 2 && (
                      <span className="knowledge-badge review-worthy">{item.occurrenceCount}×</span>
                    )}
                    {item.sourceType === 'misconception' && <span className="knowledge-badge error">错误</span>}
                    {item.sourceType === 'weakness' && <span className="knowledge-badge warning">薄弱</span>}
                  </div>
                  <span className="knowledge-item-summary">{item.summary}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      <aside className="review-side">
        <section className="context-card chart-card">
          <div className="chart-header">
            <h3>最近 7 天</h3>
            <span className="muted">单位：分钟</span>
          </div>
          <div className="mini-bar-chart">
            {last7Days.map((day) => (
              <div className="bar-column" key={day.label}>
                <div className="bar-track">
                  <div className="bar-fill" style={{ height: maxBar ? `${(day.value / maxBar) * 100}%` : '0%' }} />
                </div>
                <span>{day.label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="context-card issue-card">
          <h3>问题与改进</h3>
          {blockerItems.length > 0 && (
            <div className="issue-block">
              <strong><AlertTriangle size={16} /> 本次卡点</strong>
              <ul>
                {blockerItems.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {suggestionItems.length > 0 && (
            <div className="issue-block">
              <strong><Lightbulb size={16} /> 下一步建议</strong>
              <ul>
                {suggestionItems.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {blockerItems.length === 0 && suggestionItems.length === 0 && (
            <p className="muted">完成学习并生成复盘后，这里会显示卡点与改进建议。</p>
          )}
        </section>


      </aside>
    </section>
  );
}
