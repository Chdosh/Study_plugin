import { useState } from 'react';
import {
  CheckCircle2,
  Circle,
  CircleDot,
  Lock
} from 'lucide-react';
import type { NearTermPlanItem, RoadmapStage } from '../../../../shared/types';

export function RoadmapTree({
  stages,
  nearTermPlanItems
}: {
  stages: RoadmapStage[];
  nearTermPlanItems: NearTermPlanItem[];
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

  function getPlanStatus(items: NearTermPlanItem[]): 'done' | 'active' | 'pending' | 'locked' {
    if (items.length === 0) return 'pending';
    if (items.every((item) => item.sessionStatus === 'completed')) return 'done';
    if (items.some((item) => item.sessionStatus === 'active')) return 'active';
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
    <aside className="roadmap">
      <div className="roadmap-tree">
        {stages.map((stage) => {
          const items = nearTermPlanItems.filter((item) => item.roadmapStageId === stage.id);
          const isExpanded = expandedStages.has(stage.id);
          const status = getPlanStatus(items);
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
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className="tree-node"
                      title={item.title}
                    >
                      <span className={`dot ${item.sessionStatus === 'completed' ? 'done' : item.sessionStatus === 'active' ? 'active' : 'pending'}`} />
                      <span className="label">{item.title}</span>
                      {item.locked && <Lock size={10} style={{ color: 'var(--color-text-subtle)', opacity: 0.5 }} />}
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
