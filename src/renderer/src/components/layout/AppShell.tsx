import type { ReactNode } from 'react';
import type { ViewKey } from '../../types/navigation';
import { ActivityBar } from './ActivityBar';

const VIEW_TITLES: Record<ViewKey, string> = {
  overview: '概览',
  study: '学习',
  records: '记录',
  settings: '设置'
};

interface AppShellProps {
  current: ViewKey;
  pageTitle?: string;
  onSelectView: (view: ViewKey) => void;
  teacherCollapsed?: boolean;
  onToggleTeacher?: () => void;
  center?: ReactNode;
  teacher?: ReactNode;
  sessionLabel?: string | null;
}

function AppTitleBar({ section, title }: { section?: string; title?: string }): JSX.Element {
  return (
    <header className="app-titlebar" aria-label="应用标题栏">
      {section && <span className="app-titlebar-section">{section}</span>}
      {title && <h1 className="app-titlebar-title">{title}</h1>}
    </header>
  );
}

export function AppWindowFrame({ children, section, title }: { children: ReactNode; section?: string; title?: string }): JSX.Element {
  return (
    <div className="app-frame">
      <AppTitleBar section={section} title={title} />
      {children}
    </div>
  );
}

export function AppShell({
  current,
  pageTitle,
  teacherCollapsed,
  onToggleTeacher,
  onSelectView,
  center,
  teacher,
  sessionLabel
}: AppShellProps): JSX.Element {
  return (
    <AppWindowFrame section={VIEW_TITLES[current]} title={pageTitle ?? VIEW_TITLES[current]}>
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
