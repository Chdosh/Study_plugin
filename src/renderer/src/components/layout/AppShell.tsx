import type { ReactNode } from 'react';
import { BookOpenCheck } from 'lucide-react';
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

function AppTitleBar(): JSX.Element {
  return (
    <header className="app-titlebar" aria-label="应用标题栏">
      <span className="app-titlebar-mark" aria-hidden="true">
        <BookOpenCheck size={17} strokeWidth={1.8} />
      </span>
      <span className="app-titlebar-name">学习管家</span>
    </header>
  );
}

export function AppWindowFrame({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="app-frame">
      <AppTitleBar />
      {children}
    </div>
  );
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
    <AppWindowFrame>
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
    </AppWindowFrame>
  );
}
