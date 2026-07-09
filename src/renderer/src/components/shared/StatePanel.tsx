import { BookOpen, Brain, Loader2, XCircle } from 'lucide-react';

export function StatePanel({ type, title, text }: { type: 'empty' | 'loading' | 'error' | 'ai-unavailable'; title: string; text: string }): JSX.Element {
  const icon = {
    empty: <BookOpen size={18} />,
    loading: <Loader2 size={18} />,
    error: <XCircle size={18} />,
    'ai-unavailable': <Brain size={18} />
  }[type];
  return (
    <div className={`state-panel ${type}`}>
      {icon}
      <div>
        <strong>{title}</strong>
        <span>{text}</span>
      </div>
    </div>
  );
}

