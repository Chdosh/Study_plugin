import type { ReactNode } from 'react';
import type { ViewKey } from '../../types/navigation';
import { ActivityBar } from './ActivityBar';

interface AppShellProps {
  current: ViewKey;
  onSelectView: (view: ViewKey) => void;
  teacherCollapsed?: boolean;
  onToggleTeacher?: () => void;
  center?: ReactNode;
  teacher?: ReactNode;
  sessionLabel?: string | null;
}

export function AppShell({
  current,
  teacherCollapsed,
  onToggleTeacher,
  onSelectView,
  center,
  teacher,
  sessionLabel
}: AppShellProps): JSX.Element {
  return (
    <div className="shell-v2">
      <ActivityBar
        current={current}
        onSelect={onSelectView}
        sessionLabel={sessionLabel}
      />
      {center}
      {teacher}
      {teacherCollapsed && (
        <button type="button" className="panel-expand-btn right visible" onClick={onToggleTeacher} aria-label="展开 AI 导师" title="展开 AI 导师">提问</button>
      )}
    </div>
  );
}
