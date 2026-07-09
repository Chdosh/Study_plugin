import { CheckCircle2 } from 'lucide-react';
import type { GoalBrief } from '../../../../shared/types';

export function GoalBriefEditor({
  brief,
  onChange,
  onConfirm
}: {
  brief: GoalBrief;
  onChange: (brief: GoalBrief) => void;
  onConfirm: () => void;
}): JSX.Element {
  return (
    <section className="goal-brief-editor">
      <div>
        <h4>目标理解</h4>
        <p>确认后会生成长期大纲、前三天安排和第一天执行稿。</p>
      </div>
      <label>
        目标标题
        <input value={brief.title} onChange={(event) => onChange({ ...brief, title: event.target.value })} />
      </label>
      <label>
        最终结果
        <textarea value={brief.targetOutcome} onChange={(event) => onChange({ ...brief, targetOutcome: event.target.value })} />
      </label>
      <div className="form-grid compact-form">
        <label>
          当前基础
          <input value={brief.currentLevel} onChange={(event) => onChange({ ...brief, currentLevel: event.target.value })} />
        </label>
        <label>
          可用时间
          <input value={brief.availableTime} onChange={(event) => onChange({ ...brief, availableTime: event.target.value })} />
        </label>
        <label>
          截止时间
          <input value={brief.deadline} onChange={(event) => onChange({ ...brief, deadline: event.target.value })} />
        </label>
      </div>
      <button className="primary-action full" type="button" disabled={!brief.title.trim()} onClick={onConfirm}>
        <CheckCircle2 size={16} />
        确认目标并生成计划
      </button>
    </section>
  );
}

