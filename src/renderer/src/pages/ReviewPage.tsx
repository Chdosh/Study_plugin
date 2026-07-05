import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  ClipboardCheck,
  Clock3,
  FileText,
  Lightbulb,
  Loader2,
  Sparkles,
  TrendingUp
} from 'lucide-react';
import type { PlanAdjustmentProposal, ReviewResult, TodayGuideState } from '../../../shared/types';

export function ReviewPage({
  review,
  todayGuide,
  pendingAdjustment,
  onGenerate,
  hasApiKey,
  onDecideAdjustment
}: {
  review: ReviewResult | null;
  todayGuide: TodayGuideState | null;
  pendingAdjustment: PlanAdjustmentProposal | null;
  onGenerate: () => Promise<void>;
  hasApiKey: boolean;
  onDecideAdjustment: (proposalId: string, status: 'accepted' | 'rejected') => Promise<void>;
}): JSX.Element {
  const [generating, setGenerating] = useState(false);

  const allActions = review?.nextActions ?? [];
  const guideTasks = todayGuide?.guide?.tasks ?? [];
  const recordedMinutes = guideTasks.reduce((sum, task) => sum + (task.totalElapsedMinutes || 0), 0);
  const focusScore = review?.focusScore ?? 0;

  const plannedTasksTotal = todayGuide?.guide?.tasks.length ?? 0;
  const tasksTotal = plannedTasksTotal;
  const tasksDone = guideTasks.filter((task) => task.status === 'done').length;
  // AI review 的 completionScore 仅作复盘评分参考，不覆盖基于 task status 的事实统计
  const completionScore = plannedTasksTotal > 0 ? Math.round((tasksDone / plannedTasksTotal) * 100) : 0;
  const last7Days = [
    { label: '05/10', value: 45 },
    { label: '05/11', value: 72 },
    { label: '05/12', value: 54 },
    { label: '05/13', value: 68 },
    { label: '05/14', value: 61 },
    { label: '05/15', value: 48 },
    { label: '05/16', value: recordedMinutes || 0 }
  ];
  const maxBar = Math.max(...last7Days.map((d) => d.value), 78);
  const blockerItems = focusScore < 70
    ? ['专注稳定性仍需提升']
    : ['暂未记录明显卡点'];
  const suggestionItems = allActions.length
    ? allActions.slice(0, 3)
    : pendingAdjustment?.reason
      ? [pendingAdjustment.reason]
      : tasksDone === tasksTotal && tasksTotal > 0
        ? ['今天任务已全部完成，可以复盘并开启下一天。']
        : ['保持当前节奏，继续完成剩余任务'];

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
            <h3>调整建议</h3>
            <p className="muted">基于上次评估建议。AI 建议只有经你确认后才会生效。</p>
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
          <div className="issue-block">
            <strong><AlertTriangle size={16} /> 本次卡点</strong>
            <ul>
              {blockerItems.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </div>
          <div className="issue-block">
            <strong><Lightbulb size={16} /> 下一步建议</strong>
            <ul>
              {suggestionItems.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="context-card review-note-card">
          <h3>复盘笔记</h3>
          <textarea placeholder="记录对今日学习的感受、收获与需要改进的事项…" maxLength={300} />
          <div>
            <span>0 / 300</span>
            <button className="secondary-action" type="button">保存笔记</button>
          </div>
        </section>
      </aside>
    </section>
  );
}


