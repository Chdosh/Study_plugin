import { useEffect, useState } from 'react';
import { CheckCircle2, SendHorizontal, Sparkles, Upload, X } from 'lucide-react';
import type {
  AppSettings,
  LearningRuntimeSnapshot,
  QuestionAnswerResult,
  SubmissionEvaluationResult
} from '../../../../shared/types';
import { MessageContent } from './MessageContent';
import { StatePanel } from '../shared/StatePanel';

export function AiDrawer({
  show,
  initialTab,
  onClose,
  settings,
  learningState,
  questionAnswer,
  submissionResult,
  onTeachStep,
  onAskQuestion,
  onResolveQuestion,
  onSubmitResult
}: {
  show: boolean;
  initialTab: 'question' | 'submission';
  onClose: () => void;
  settings: AppSettings | null;
  learningState: LearningRuntimeSnapshot | null;
  questionAnswer: QuestionAnswerResult | null;
  submissionResult: SubmissionEvaluationResult | null;
  onTeachStep: () => Promise<void>;
  onAskQuestion: (question: string) => Promise<void>;
  onResolveQuestion: (threadId: string) => Promise<void>;
  onSubmitResult: (content: string) => Promise<void>;
}): JSX.Element | null {
  const [question, setQuestion] = useState('');
  const [submission, setSubmission] = useState('');
  const [activeTab, setActiveTab] = useState<'question' | 'submission'>('question');
  const activeThread = learningState?.questionThread ?? null;
  const latestEvaluation = submissionResult?.evaluation ?? learningState?.latestEvaluation ?? null;
  const latestDecision = submissionResult?.decision ?? learningState?.latestDecision ?? null;

  useEffect(() => {
    if (show) {
      setActiveTab(initialTab);
    }
  }, [show, initialTab]);

  if (!show) return null;

  return (
    <div className="ai-drawer-overlay" onClick={onClose}>
      <aside className="ai-drawer" onClick={(event) => event.stopPropagation()} aria-label="AI 学习助手">
        <div className="today-ai-heading">
          <Sparkles size={20} />
          <h3>AI 学习助手</h3>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        {!settings?.hasDeepseekApiKey ? (
          <StatePanel type="ai-unavailable" title="AI 暂不可用" text="请先在设置中配置 DeepSeek API Key，才能使用 AI 学习助手。" />
        ) : (
          <>
            <div className="assistant-tabs" role="tablist" aria-label="AI 助手内容">
              <button className={activeTab === 'question' ? 'active' : ''} type="button" onClick={() => setActiveTab('question')}>
                提问
              </button>
              <button className={activeTab === 'submission' ? 'active' : ''} type="button" onClick={() => setActiveTab('submission')}>
                提交结果
              </button>
            </div>

            {activeTab === 'question' && (
              <>
                <label className="assistant-field">
                  提问
                  <textarea
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    placeholder="描述你的问题或卡点..."
                    aria-label="针对当前步骤提问"
                  />
                  <small>{question.length}/1000</small>
                </label>
                <button
                  className="secondary-action full"
                  type="button"
                  onClick={() => void onTeachStep()}
                  disabled={!learningState?.step}
                >
                  <Sparkles size={16} />
                  展开当前步骤
                </button>
                <button
                  className="primary-action full"
                  type="button"
                  disabled={!question.trim()}
                  onClick={() => {
                    const value = question.trim();
                    if (!value) return;
                    setQuestion('');
                    void onAskQuestion(value);
                  }}
                >
                  <SendHorizontal size={16} />
                  发送
                </button>
                {questionAnswer && (
                  <div className="assistant-message">
                    <strong>回答</strong>
                    <MessageContent content={questionAnswer.answer} />
                    <small>{questionAnswer.returnToStepInstruction}</small>
                  </div>
                )}
                {activeThread?.status === 'open' && (
                  <button className="secondary-action full" type="button" onClick={() => void onResolveQuestion(activeThread.id)}>
                    问题已解决，回到主线
                  </button>
                )}
              </>
            )}

            {activeTab === 'submission' && (
              <div className="submission-panel">
                <label className="assistant-field">
                  提交结果
                  <textarea
                    value={submission}
                    onChange={(event) => setSubmission(event.target.value)}
                    placeholder="粘贴最终产出、答案或链接..."
                    aria-label="提交学习结果"
                  />
                </label>
                <div className="upload-dropzone">
                  <Upload size={26} />
                  <span>拖拽文件或截图到此</span>
                  <small>支持图片 / 文档 / 链接等说明文本</small>
                </div>
                <button
                  className="primary-action full"
                  type="button"
                  disabled={!learningState?.step || !submission.trim()}
                  onClick={() => {
                    const value = submission.trim();
                    if (!value) return;
                    setSubmission('');
                    void onSubmitResult(value);
                  }}
                >
                  <CheckCircle2 size={16} />
                  提交并评估
                </button>
              </div>
            )}

            {latestEvaluation && (
              <div className="assistant-message assistant-message-system">
                <strong>评估：{latestEvaluation.result} · 掌握度 {latestEvaluation.mastery}</strong>
                <MessageContent content={latestEvaluation.feedback} />
              </div>
            )}

            {latestDecision && (
              <div className="assistant-message">
                <strong>下一步：{latestDecision.decision}</strong>
                <MessageContent content={latestDecision.reason} />
              </div>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

