import { CheckCircle2, ChevronRight, ChevronsLeft, ChevronsRight, FileText, Home, Settings } from 'lucide-react';
import type { ViewKey } from '../../types/navigation';

export function Sidebar({
  current,
  collapsed,
  onToggle,
  onSelect
}: {
  current: ViewKey;
  collapsed: boolean;
  onToggle: () => void;
  onSelect: (view: ViewKey) => void;
}): JSX.Element {
  const items: Array<{ key: ViewKey; label: string; icon: JSX.Element }> = [
    { key: 'overview', label: '概览', icon: <Home size={18} /> },
    { key: 'study', label: '学习', icon: <CheckCircle2 size={18} /> },
    { key: 'review', label: '复盘', icon: <FileText size={18} /> },
    { key: 'settings', label: '设置', icon: <Settings size={18} /> }
  ];
  return (
    <aside className={collapsed ? 'sidebar collapsed' : 'sidebar'}>
      <div className="brand">
        <div className="brand-mark">学</div>
        <div className="brand-copy">
          <strong>学习管家</strong>
          <span>AI 学习助手</span>
        </div>
        <button
          className="sidebar-collapse-button"
          type="button"
          aria-label={collapsed ? '展开侧边栏' : '折叠侧边栏'}
          onClick={onToggle}
          title={collapsed ? '展开侧边栏' : '折叠侧边栏'}
        >
          {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
        </button>
      </div>
      <nav className="nav-list" aria-label="主导航">
        {items.map((item) => (
          <button
            className={item.key === current ? 'nav-item active' : 'nav-item'}
            key={item.key}
            onClick={() => onSelect(item.key)}
            title={item.label}
          >
            {item.icon}
            <span className="nav-label">{item.label}</span>
          </button>
        ))}
      </nav>
      <button className="sidebar-user" type="button">
        <span className="sidebar-user-avatar">学</span>
        <span className="nav-label">学习者</span>
        <ChevronRight size={16} />
      </button>
    </aside>
  );
}


