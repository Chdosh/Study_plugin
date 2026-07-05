import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type { StudySession } from '../../../../shared/types';
import { StatePanel } from '../shared/StatePanel';
import type { ViewKey } from '../../types/navigation';

export function SettlementView({
  activeSession,
  notes,
  onNotesChange,
  onBack,
  onSave,
  onGoTo
}: {
  activeSession: StudySession | null;
  notes: string;
  onNotesChange: (notes: string) => void;
  onBack: () => void;
  onSave: () => void;
  onGoTo: (view: ViewKey) => void;
}): JSX.Element {
  const [result, setResult] = useState<'completed' | 'partial' | 'skipped'>('completed');
  const isEmpty = !activeSession;

  const totalMinutes = activeSession?.durationMinutes ?? 0;
  const duration = totalMinutes > 0 ? `${totalMinutes} 分钟` : '未知';

  return (
    <section className="page-grid">
      <div className="main-column">
        <section className="surface">
          <div className="section-heading">
            <div>
              <h3>学习结束结算</h3>
              <p>确认完成程度后才进入复盘。这里不自动完成整个任务。</p>
            </div>
          </div>

          {isEmpty && <StatePanel type="empty" title="没有可结算的学习会话" text="请先开始一个学习块。" />}

          {!isEmpty && (
            <>
              <div className="settlement-options">
                <label className={result === 'completed' ? 'choice active' : 'choice'}>
                  <input type="radio" name="result" checked={result === 'completed'} onChange={() => setResult('completed')} />
                  <span>
                    <strong>完成本块</strong>
                    <small>达成本块验收标准，但不默认完成整个任务。</small>
                  </span>
                </label>
                <label className={result === 'partial' ? 'choice active' : 'choice'}>
                  <input type="radio" name="result" checked={result === 'partial'} onChange={() => setResult('partial')} />
                  <span>
                    <strong>部分完成</strong>
                    <small>保留剩余动作，后续继续规划。</small>
                  </span>
                </label>
                <label className={result === 'skipped' ? 'choice active' : 'choice'}>
                  <input type="radio" name="result" checked={result === 'skipped'} onChange={() => setResult('skipped')} />
                  <span>
                    <strong>跳过</strong>
                    <small>需要记录原因，供复盘使用。</small>
                  </span>
                </label>
              </div>

              <div className="study-card">
                <div className="detail">
                  <span>本次时长</span>
                  <strong>{duration}</strong>
                </div>
                <div className="detail">
                  <span>实际输出</span>
                  <strong>{notes || '尚未填写输出'}</strong>
                </div>
                <div className="detail">
                  <span>任务状态</span>
                  <strong>仅完成学习块；任务是否完成需要单独确认。</strong>
                </div>
              </div>

              <div className="session-controls">
                <button className="secondary-action" onClick={onBack}>
                  返回修改
                </button>
                <button className="primary-action" onClick={onSave}>
                  保存结算并进入复盘
                  <ArrowRight size={18} />
                </button>
              </div>
            </>
          )}
        </section>
      </div>

      <aside className="context-panel">
        <h3>结算规则</h3>
        <p>学习块完成不等于任务自动完成。用户确认后，复盘页才读取这次数据。</p>
        <div className="advice-list">
          <span>完成：更新块进度。</span>
          <span>部分完成：保留后续动作。</span>
          <span>跳过：必须记录原因。</span>
        </div>
      </aside>
    </section>
  );
}

