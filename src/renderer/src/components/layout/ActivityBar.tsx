import type { ViewKey } from '../../types/navigation';
import { BookOpen, ChartNoAxesColumnIncreasing, Clock3, Map, Settings } from 'lucide-react';

export function ActivityBar({
  current,
  onSelect,
  sessionLabel
}: {
  current: ViewKey;
  onSelect: (view: ViewKey) => void;
  sessionLabel?: string | null;
}): JSX.Element {
  const items = [
    { key: 'overview' as const, label: '概览', icon: Map },
    { key: 'study' as const, label: '学习', icon: BookOpen },
    { key: 'records' as const, label: '记录', icon: ChartNoAxesColumnIncreasing },
    { key: 'settings' as const, label: '设置', icon: Settings }
  ];
  return (
    <div className="activity-bar">
      {items.map((item) => (
        <button
          type="button"
          key={item.key}
          className={item.key === current ? 'ab-icon active' : 'ab-icon'}
          onClick={() => onSelect(item.key)}
          title={item.label}
          aria-label={item.label}
          aria-current={item.key === current ? 'page' : undefined}
        >
          <item.icon size={17} aria-hidden="true" />
        </button>
      ))}
      <div className="ab-spacer" />
      {sessionLabel ? <button type="button" className="ab-session-status" title={`当前 Session：${sessionLabel}`} aria-label={`当前 Session：${sessionLabel}`} onClick={() => onSelect('study')}><Clock3 size={15} /><span className="ab-session-dot" /></button> : <div className="ab-status" title="本地运行中" />}
    </div>
  );
}
