import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, RefreshCw, SendHorizontal, Sparkles, Upload, X } from 'lucide-react';
import type {
  AppSettings,
  LearningRuntimeSnapshot,
  QuestionAnswerResult,
  SubmissionEvaluationResult
} from '../../../../shared/types';
import { MessageContent } from './MessageContent';
import { StatePanel } from '../shared/StatePanel';

function mapEvaluationResult(result: string): string {
  const map: Record<string, string> = {
    passed: '已通过',
    partial: '部分完成',
    failed: '未通过',
    unclear: '需要补充'
  };
  return map[result] ?? result;
}

function mapDecisionLabel(decision: string): string {
  const map: Record<string, string> = {
    complete_task: '当前主任务已完成',
    remediate: '需要修改后再提交'
  };
  return map[decision] ?? decision;
}

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
  onCloseBranch,
  onSubmitResult,
  onRetrySubmissionEvaluation
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
  onCloseBranch: (threadId: string, strategy: 'close' | 'extract_knowledge' | 'propose_fact' | 'promote_task', options?: { summary?: string; promoteTaskId?: string; factProposal?: { sourceType: 'insight'; key: string; summary: string } }) => Promise<void>;
  onSubmitResult: (content: string) => Promise<void>;
  onRetrySubmissionEvaluation: (submissionId: string) => Promise<void>;
}): JSX.Element | null {
  const [question, setQuestion] = useState('');
  const [submission, setSubmission] = useState('');
  const [activeTab, setActiveTab] = useState<'question' | 'submission'>('question');
  const [submitted, setSubmitted] = useState(false);
  const [showClosureOptions, setShowClosureOptions] = useState(false);
  const [branchSummary, setBranchSummary] = useState('');
  const [branchFactKey, setBranchFactKey] = useState('');
  const prevSubmissionResultRef = useRef<SubmissionEvaluationResult | null>(null);
  const activeThread = learningState?.questionThread ?? null;
  const latestEvaluation = submissionResult?.evaluation ?? learningState?.latestEvaluation ?? null;
  const latestDecision = submissionResult?.decision ?? learningState?.latestDecision ?? null;
  const pendingSubmission = learningState?.latestSubmission?.evaluationStatus !== 'completed'
    ? learningState?.latestSubmission ?? null
    : null;

  useEffect(() => {
    if (show) {
      setActiveTab(initialTab);
    }
  }, [show, initialTab]);

  // Track submission completion for post-submit state
  useEffect(() => {
    if (submissionResult && submissionResult !== prevSubmissionResultRef.current) {
      prevSubmissionResultRef.current = submissionResult;
      setSubmitted(true);
    }
  }, [submissionResult]);

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
                  disabled={!learningState?.dailyGuideAction}
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
                  <>
                    {!showClosureOptions ? (
                      <button className="secondary-action full" type="button" onClick={() => setShowClosureOptions(true)}>
                        关闭分支
                      </button>
                    ) : (
                      <div className="branch-closure-options">
                        <span className="branch-closure-label">如何处理这个分支？</span>
                        <label className="assistant-field">
                          分支总结（可选）
                          <textarea value={branchSummary} onChange={(event) => setBranchSummary(event.target.value)} placeholder="例如：确认当前项目使用 Windows 和 DeepSeek" />
                        </label>
                        <button className="secondary-action full" type="button" onClick={() => {
                          setShowClosureOptions(false);
                          void onCloseBranch(activeThread.id, 'close', { summary: branchSummary.trim() || undefined });
                        }}>
                          仅关闭
                        </button>
                        <button className="secondary-action full" type="button" onClick={() => {
                          setShowClosureOptions(false);
                          void onCloseBranch(activeThread.id, 'extract_knowledge', { summary: branchSummary.trim() || undefined });
                        }}>
                          提取为知识
                        </button>
                        <label className="assistant-field">
                          长期偏好项目
                          <input value={branchFactKey} onChange={(event) => setBranchFactKey(event.target.value)} placeholder="例如：操作系统" />
                        </label>
                        <button className="secondary-action full" type="button" disabled={!branchFactKey.trim() || !branchSummary.trim()} onClick={() => {
                          setShowClosureOptions(false);
                          void onCloseBranch(activeThread.id, 'propose_fact', {
                            summary: branchSummary.trim(),
                            factProposal: { sourceType: 'insight', key: branchFactKey.trim(), summary: branchSummary.trim() }
                          });
                        }}>
                          提议为长期偏好（稍后确认）
                        </button>
                        <button className="primary-action full" type="button" disabled={!learningState?.dailyGuideTask} onClick={() => {
                          const taskId = learningState?.dailyGuideTask?.id;
                          if (!taskId) return;
                          setShowClosureOptions(false);
                          void onCloseBranch(activeThread.id, 'promote_task', { summary: branchSummary.trim() || undefined, promoteTaskId: taskId });
                        }}>
                          提升为后续正式任务
                        </button>
                      </div>
                    )}
                  </>
                )}
              </>
            )}

            {activeTab === 'submission' && (
              <div className="submission-panel">
                {pendingSubmission ? (
                  <div className="submission-complete-state">
                    <AlertCircle size={24} />
                    <strong>{pendingSubmission.evaluationStatus === 'failed' ? '提交已保存，评价失败' : '提交已保存，等待评价'}</strong>
                    <p>你的提交内容仍保存在本地。重新评价会复用原提交，不会创建重复记录。</p>
                    <button
                      className="primary-action full"
                      type="button"
                      onClick={() => void onRetrySubmissionEvaluation(pendingSubmission.id)}
                    >
                      <RefreshCw size={16} />
                      重新评价
                    </button>
                  </div>
                ) : submitted && latestEvaluation ? (
                  <div className="submission-complete-state">
                    <CheckCircle2 size={24} />
                    <strong>已提交并完成评估</strong>
                    <p>评估结果和下一步已显示在下方。关闭抽屉即可继续学习。</p>
                    <button
                      className="secondary-action full"
                      type="button"
                      onClick={() => {
                        setSubmitted(false);
                        setSubmission('');
                      }}
                    >
                      提交新的结果
                    </button>
                  </div>
                ) : (
                  <>
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
                      disabled={!learningState?.dailyGuideAction || !submission.trim()}
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
                  </>
                )}
              </div>
            )}

            {latestEvaluation && (
              <div className="assistant-message assistant-message-system">
                <strong>评估：{mapEvaluationResult(latestEvaluation.result)} · 掌握度 {latestEvaluation.mastery}</strong>
                <MessageContent content={latestEvaluation.feedback} />
              </div>
            )}

            {latestDecision && (
              <div className="assistant-message">
                <strong>下一步：{mapDecisionLabel(latestDecision.decision)}</strong>
                <MessageContent content={latestDecision.reason} />
              </div>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

