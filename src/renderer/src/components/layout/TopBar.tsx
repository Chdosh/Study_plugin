import { Bell, Search, Sparkles } from 'lucide-react';

export function TopBar({
  title,
  subtitle,
  notice,
  onRefresh
}: {
  title: string;
  subtitle: string;
  notice: string;
  onRefresh: () => void;
}): JSX.Element {
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const weekday = weekdays[now.getDay()];

  return (
    <header className="topbar">
      <div>
        <h1>{title}</h1>
        <p className="topbar-subtitle">
          {subtitle}
          {notice !== '就绪' && <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>({notice})</span>}
          <Sparkles size={14} />
        </p>
      </div>
      <div className="topbar-actions" aria-label="今日工具">
        <button className="icon-button" type="button" aria-label="搜索" onClick={onRefresh}>
          <Search size={20} />
        </button>
        <button className="icon-button notification-button" type="button" aria-label="通知">
          <Bell size={20} />
          <span />
        </button>
        <div className="date-chip">
          <span>{month}月{day}日</span>
          <strong>{weekday}</strong>
        </div>
      </div>
    </header>
  );
}

