import type { PendingAgentInteraction } from '../../../../shared/types';

export function PendingAgentQuestion({
  interaction,
  onCancel,
  onAnswer
}: {
  interaction: PendingAgentInteraction;
  onCancel: () => void;
  onAnswer?: (text: string) => void;
}) {
  const hasOptions = interaction.answerMode === 'single_choice'
    && interaction.options.length > 0;
  return (
    <div className="pending-agent-question" role="status" aria-live="polite">
      <p className="pending-agent-question-text">{interaction.question}</p>
      {hasOptions ? (
        <>
          <span className="pending-agent-options-title">请选择最符合你情况的选项：</span>
          <div className="pending-agent-options">
            {interaction.options.map((option) => (
              <button
                key={option}
                className="option-action"
                type="button"
                onClick={() => onAnswer?.(option)}
              >
                {option}
              </button>
            ))}
          </div>
        </>
      ) : (
        <small>直接在下方输入你的回答，AI 会继续同一次处理流程。</small>
      )}
      <button className="text-action" type="button" onClick={onCancel}>
        取消这次追问
      </button>
    </div>
  );
}
