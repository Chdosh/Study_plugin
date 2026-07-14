import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  CircleDot,
  Lock,
  TrendingUp
} from 'lucide-react';
import type { KnowledgeItem, RoadmapStage, ShortPlanDay } from '../../../../shared/types';

export function RoadmapTree({
  stages,
  shortPlanDays,
  knowledgeItems,
  collapsed,
  onToggleCollapse,
  onSelectTask
}: {
  stages: RoadmapStage[];
  shortPlanDays: ShortPlanDay[];
  knowledgeItems: KnowledgeItem[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSelectTask?: (taskId: string) => void;
}): JSX.Element {
  const [expandedStages, setExpandedStages] = useState<Set<string>>(
    new Set(stages.filter((s) => s.status === 'active').map((s) => s.id))
  );

  function toggleStage(stageId: string): void {
    setExpandedStages((prev) => {
      const next = new Set(prev);
      if (next.has(stageId)) next.delete(stageId);
      else next.add(stageId);
      return next;
    });
  }

  if (collapsed) return <></>;

  function getDayStatus(days: ShortPlanDay[]): 'done' | 'active' | 'pending' | 'locked' {
    if (days.length === 0) return 'pending';
    if (days.every((d) => d.sessionStatus === 'completed')) return 'done';
    if (days.some((d) => d.sessionStatus === 'active')) return 'active';
    return 'pending';
  }

  function stageIcon(status: string): JSX.Element {
    switch (status) {
      case 'completed': return <CheckCircle2 size={14} style={{ color: 'var(--color-success)' }} />;
      case 'active': return <CircleDot size={14} style={{ color: 'var(--color-primary)' }} />;
      default: return <Circle size={14} style={{ color: 'var(--color-border-strong)' }} />;
    }
  }

  return (
    <aside className="roadmap" style={{ display: collapsed ? 'none' : 'flex' }}>
      <div className="roadmap-hdr">
        <span>学习大纲</span>
        <button className="collapse-btn" onClick={onToggleCollapse} title="折叠大纲">«</button>
      </div>
      <div className="roadmap-tree">
        {stages.map((stage) => {
          const days = shortPlanDays.filter((d) => d.roadmapStageId === stage.id);
          const isExpanded = expandedStages.has(stage.id);
          const status = getDayStatus(days);
          return (
            <div key={stage.id}>
              <div
                className={`tree-stage-hdr ${isExpanded ? 'open' : ''}`}
                onClick={() => toggleStage(stage.id)}
              >
                <span className="chevron">▶</span>
                {stageIcon(stage.status)}
                {stage.title}
              </div>
              {isExpanded && (
                <div className="tree-children">
                  {days.map((day) => (
                    <div
                      key={day.id}
                      className={`tree-node ${onSelectTask ? 'is-interactive' : ''}`}
                      onClick={onSelectTask ? () => onSelectTask(day.id) : undefined}
                      title={day.title}
                    >
                      <span className={`dot ${day.sessionStatus === 'completed' ? 'done' : day.sessionStatus === 'active' ? 'active' : 'pending'}`} />
                      <span className="label">{day.title}</span>
                      {day.locked && <Lock size={10} style={{ color: 'var(--color-text-subtle)', opacity: 0.5 }} />}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
