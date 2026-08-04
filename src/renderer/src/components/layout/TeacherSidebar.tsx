import { useState, useRef, useEffect } from 'react';
import { SendHorizontal } from 'lucide-react';
import type { KnowledgeItem, QuestionMessage } from '../../../../shared/types';

function ChatTab({
  onAskQuestion,
  messages,
  pendingQuestion,
  isAsking
}: {
  onAskQuestion: (question: string) => void;
  messages: QuestionMessage[];
  pendingQuestion?: string | null;
  isAsking?: boolean;
}): JSX.Element {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isAsking, pendingQuestion]);

  function send(): void {
    const value = input.trim();
    if (!value) return;
    setInput('');
    onAskQuestion(value);
  }

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, overflowY: 'auto' }}>
        {messages.length === 0 && (
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{
              width: 22, height: 22, borderRadius: '50%',
              background: 'var(--color-bg-surface-muted)',
              display: 'grid', placeItems: 'center', fontSize: 10, flexShrink: 0
            }}>A</div>
            <div style={{
              maxWidth: '85%', padding: '10px 14px', borderRadius: 12,
              background: 'var(--color-bg-surface-muted)', fontSize: 13, lineHeight: 1.65,
              borderBottomLeftRadius: 3
            }}>
              你好！我是你的 AI 学习助手。随时可以问我关于当前步骤的问题。
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} style={{ display: 'flex', gap: 8, justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
            {msg.role === 'assistant' && <div style={{
              width: 22, height: 22, borderRadius: '50%',
              background: 'var(--color-bg-surface-muted)',
              display: 'grid', placeItems: 'center', fontSize: 10, flexShrink: 0
            }}>A</div>}
            <div style={{
              maxWidth: '85%', padding: '10px 14px', borderRadius: 12,
              background: msg.role === 'user' ? 'var(--color-primary)' : 'var(--color-bg-surface-muted)',
              color: msg.role === 'user' ? 'white' : 'var(--color-text)',
              fontSize: 13, lineHeight: 1.65,
              borderBottomRightRadius: msg.role === 'user' ? 3 : 12,
              borderBottomLeftRadius: msg.role === 'assistant' ? 3 : 12
            }}>
              {msg.content}
            </div>
          </div>
        ))}
        {pendingQuestion && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <div style={{
              maxWidth: '85%', padding: '10px 14px', borderRadius: 12,
              background: 'var(--color-primary)', color: 'white',
              fontSize: 13, lineHeight: 1.65, borderBottomRightRadius: 3
            }}>
              {pendingQuestion}
            </div>
          </div>
        )}
        {isAsking && (
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{
              width: 22, height: 22, borderRadius: '50%',
              background: 'var(--color-bg-surface-muted)',
              display: 'grid', placeItems: 'center', fontSize: 10, flexShrink: 0
            }}>A</div>
            <div style={{
              maxWidth: '85%', padding: '10px 14px', borderRadius: 12,
              background: 'var(--color-bg-surface-muted)', fontSize: 13, lineHeight: 1.65,
              borderBottomLeftRadius: 3, color: 'var(--color-text-subtle)'
            }}>
              正在思考...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <div className="teacher-input" style={{ marginTop: 'auto' }}>
        <div className="teacher-input-box">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入问题..."
            onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
          />
          <button
            onClick={send}
            style={{
              width: 26, height: 26, borderRadius: '50%', border: 'none',
              background: 'var(--color-primary)', color: 'white',
              display: 'grid', placeItems: 'center', cursor: 'pointer'
            }}
          >
            <SendHorizontal size={12} />
          </button>
        </div>
      </div>
    </>
  );
}

function ContextTab({
  knowledgeItems
}: {
  knowledgeItems: KnowledgeItem[];
}): JSX.Element {
  const weakness = knowledgeItems.filter((k) => k.status === 'active').slice(0, 5);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{
          fontSize: 11, fontWeight: 500, textTransform: 'uppercase',
          letterSpacing: '0.06em', color: 'var(--color-text-subtle)', marginBottom: 8
        }}>薄弱点 Top {weakness.length}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {weakness.map((item) => (
            <div key={item.id} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
              borderBottom: '1px solid var(--color-border-default)', fontSize: 13
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                background: item.sourceType === 'misconception' ? 'var(--color-warning)' : 'var(--color-info)'
              }} />
              <span style={{ flex: 1, color: 'var(--color-text-muted)' }}>{item.key}</span>
              {item.occurrenceCount >= 2 && (
                <span style={{
                  fontSize: 10, padding: '2px 8px', borderRadius: 10,
                  background: 'var(--color-warning-light)', color: 'var(--color-warning)',
                  fontWeight: 500
                }}>复习队列</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function TeacherSidebar({
  knowledgeItems,
  collapsed,
  onToggleCollapse,
  onAskQuestion,
  contextSummary,
  messages,
  pendingQuestion,
  isAsking
}: {
  knowledgeItems: KnowledgeItem[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  onAskQuestion: (question: string) => void;
  contextSummary?: string;
  messages: QuestionMessage[];
  pendingQuestion?: string | null;
  isAsking?: boolean;
}): JSX.Element {
  const [activeTab, setActiveTab] = useState<'chat' | 'context'>('chat');

  if (collapsed) return <></>;

  return (
    <section className="teacher">
      <div className="teacher-tabs">
        <button className="teacher-tab-collapse" onClick={onToggleCollapse} title="折叠导师舱">»</button>
        <button
          className={activeTab === 'chat' ? 'teacher-tab active' : 'teacher-tab'}
          onClick={() => setActiveTab('chat')}
          style={{ marginLeft: 20 }}
        >
          提问
        </button>
        <button
          className={activeTab === 'context' ? 'teacher-tab active' : 'teacher-tab'}
          onClick={() => setActiveTab('context')}
        >
          上下文
        </button>
      </div>
      <div className="teacher-body">
        {contextSummary && <p className="teacher-context-line" title={contextSummary}>当前上下文：{contextSummary}</p>}
        {activeTab === 'chat' ? (
          <ChatTab onAskQuestion={onAskQuestion} messages={messages} pendingQuestion={pendingQuestion} isAsking={isAsking} />
        ) : (
          <ContextTab knowledgeItems={knowledgeItems} />
        )}
      </div>
    </section>
  );
}
