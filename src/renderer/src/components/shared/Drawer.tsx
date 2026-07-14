import type { ReactNode } from 'react';
import { X } from 'lucide-react';

export function Drawer({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }): JSX.Element | null {
  return (
    <div className={`drawer-layer ${open ? 'is-open' : ''}`} role="presentation" aria-hidden={!open} onMouseDown={onClose}>
      <section className="drawer-panel" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <header><strong>{title}</strong><button type="button" className="icon-action" aria-label={`关闭${title}`} title={`关闭${title}`} onClick={onClose}><X size={18} /></button></header>
        <div className="drawer-content">{children}</div>
      </section>
    </div>
  );
}
