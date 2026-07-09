import { ChevronRight, Loader2, Sparkles, X } from 'lucide-react';
import type { GoalIntakeState, HistoryIntakeSummary } from '../../../../shared/types';

export function HistoryPanel({
  list,
  pending,
  selected,
  onSelect,
  onRegenerate,
  onClose
}: {
  list: HistoryIntakeSummary[];
  pending: boolean;
  selected: GoalIntakeState | null;
  onSelect: (item: HistoryIntakeSummary) => void;
  onRegenerate: (item: HistoryIntakeSummary) => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <section className="modal-box history-panel" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>历史会话</h2>
          <p>浏览所有历史目标访谈记录，可查看详情或重新生成计划。</p>
          <button className="icon-button" type="button" aria-label="关闭" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="history-list">
          {pending && list.length === 0 && (
            <div className="history-message">
              <Loader2 className="spin" size={20} />
              <span>加载中…</span>
            </div>
          )}
          {!pending && list.length === 0 && (
            <div className="history-message">
              <span>暂无历史会话。</span>
            </div>
          )}
          {list.map((item) => {
            const isSelected = selected?.intake.id === item.intake.id;
            const dateOnly = item.intake.createdAt.slice(0, 10);
            const timeOnly = item.intake.createdAt.slice(11, 19);
            return (
              <article key={item.intake.id} className={`history-item ${isSelected ? 'expanded' : ''}`}>
                <div className="history-item-head" onClick={() => onSelect(item)}>
                  <span className="history-item-title">{item.goalTitle || '（无目标）'}</span>
                  <span className="history-item-meta">{dateOnly} {timeOnly} · {item.messageCount} 条消息 · {statusLabel(item.intake.status)}</span>
                  <ChevronRight size={14} className={`history-chevron ${isSelected ? 'rotated' : ''}`} />
                </div>
                {isSelected && selected && (
                  <div className="history-item-detail">
                    <div className="history-messages">
                      {selected.messages.map((msg) => (
                        <div key={msg.id} className={`history-msg ${msg.role}`}>
                          <strong>{msg.role === 'assistant' ? 'AI' : '你'}</strong>
                          <span>{msg.content.length > 300 ? msg.content.slice(0, 300) + '…' : msg.content}</span>
                        </div>
                      ))}
                    </div>
                    {item.intake.goalId && (
                      <button className="primary-action full" type="button" onClick={() => onRegenerate(item)}>
                        <Sparkles size={16} />
                        据此重新生成计划
                      </button>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function statusLabel(status: string): string {
  const map: Record<string, string> = { collecting: '采集中', ready: '待确认', confirmed: '已确认' };
  return map[status] ?? status;
}

