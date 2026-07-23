import type { PendingAgentInteraction } from '../../../../shared/types';

export function PendingAgentQuestion({
  interaction,
  onCancel
}: {
  interaction: PendingAgentInteraction;
  onCancel: () => void;
}) {
  return (
    <div className="pending-agent-question" role="status" aria-live="polite">
      <strong>等待你的回答</strong>
      <span>{interaction.question}</span>
      <small>直接在下方回复后，AI 会继续同一次处理流程。</small>
      <button className="text-action" type="button" onClick={onCancel}>
        取消这次追问
      </button>
    </div>
  );
}
