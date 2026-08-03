import { useState } from 'react';
import { SendHorizontal } from 'lucide-react';
import type { GoalIntakeQuestion } from '../../../../shared/types';

export function GoalIntakeQuestionForm({
  questions,
  disabled,
  onSubmit
}: {
  questions: GoalIntakeQuestion[];
  disabled: boolean;
  onSubmit: (composed: string) => void;
}) {
  const [answers, setAnswers] = useState<string[]>(() => questions.map(() => ''));
  const answeredCount = answers.filter((answer) => answer.trim().length > 0).length;

  function setAnswer(index: number, value: string) {
    setAnswers((current) => current.map((item, i) => (i === index ? value : item)));
  }

  function submit(): void {
    const composed = questions
      .map((question, index) => {
        const answer = answers[index]?.trim();
        return answer ? `${index + 1}. ${answer}` : '';
      })
      .filter(Boolean)
      .join('\n');
    if (!composed) return;
    onSubmit(composed);
  }

  return (
    <div className="intake-questions">
      <span className="intake-questions-title">请回答以下问题（可一次全部填写）：</span>
      {questions.map((question, index) => (
        <div className="intake-question" key={`${question.prompt}-${index}`}>
          <span className="intake-question-prompt">
            <span className="intake-question-num">{index + 1}</span>
            {question.prompt}
          </span>
          {question.options.length > 0 && (
            <div className="intake-question-options">
              {question.options.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`option-action${answers[index] === option ? ' selected' : ''}`}
                  onClick={() => setAnswer(index, option)}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
          <input
            className="intake-question-input"
            value={answers[index]}
            onChange={(event) => setAnswer(index, event.target.value)}
            placeholder="或直接输入你的回答..."
            aria-label={`问题 ${index + 1} 的回答`}
          />
        </div>
      ))}
      <div className="intake-questions-submit">
        <button className="primary-action" type="button" disabled={disabled || answeredCount === 0} onClick={submit}>
          <SendHorizontal size={16} />
          提交回答
        </button>
        <span className="intake-questions-hint">已回答 {answeredCount} / {questions.length} 个问题</span>
      </div>
    </div>
  );
}
