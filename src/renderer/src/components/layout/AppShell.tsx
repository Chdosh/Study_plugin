import type { ReactNode } from 'react';
import type { ViewKey } from '../../types/navigation';
import { Sidebar } from './Sidebar';

interface AppShellProps {
  current: ViewKey;
  collapsed: boolean;
  workspaceClassName: string;
  onToggleSidebar: () => void;
  onSelectView: (view: ViewKey) => void;
  children: ReactNode;
}

export function AppShell({
  current,
  collapsed,
  workspaceClassName,
  onToggleSidebar,
  onSelectView,
  children
}: AppShellProps): JSX.Element {
  return (
    <div className={collapsed ? 'prototype-shell collapsed' : 'prototype-shell'}>
      <Sidebar current={current} collapsed={collapsed} onToggle={onToggleSidebar} onSelect={onSelectView} />
      <main className={workspaceClassName}>{children}</main>
    </div>
  );
}
