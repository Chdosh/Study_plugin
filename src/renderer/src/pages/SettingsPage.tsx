import { useEffect, useState } from 'react';
import { Brain, Check, Coins, Database, Download, Target, Trash2 } from 'lucide-react';
import type { AppSettings, LearnerFact, LearnerFactScope, LearningStyle } from '../../../shared/types';

export function SettingsPage({
  settings,
  runAction,
  onSaved
}: {
  settings: AppSettings;
  runAction: (label: string, action: () => Promise<void>) => Promise<void>;
  onSaved: () => Promise<void>;
}): JSX.Element {
  const [baseUrl, setBaseUrl] = useState(settings.deepseekBaseUrl);
  const [model, setModel] = useState(settings.deepseekModel);
  const [apiKey, setApiKey] = useState('');
  const [blockMinutes, setBlockMinutes] = useState(settings.defaultBlockMinutes);
  const [learningStyle, setLearningStyle] = useState(settings.learningStyle ?? 'detailed');
  const [saved, setSaved] = useState(false);
  const [goalId, setGoalId] = useState<string | null>(null);
  const [learnerFacts, setLearnerFacts] = useState<LearnerFact[]>([]);
  const [factKey, setFactKey] = useState('');
  const [factValue, setFactValue] = useState('');
  const [factScope, setFactScope] = useState<LearnerFactScope>('goal');
  const [tokenStats, setTokenStats] = useState<{
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCalls: number;
    byOperation: Record<string, { inputTokens: number; outputTokens: number; calls: number }>;
    byDate: Record<string, { inputTokens: number; outputTokens: number; calls: number }>;
  } | null>(null);

  useEffect(() => {
    if (window.studyApp?.stats?.getTokenCost) {
      void window.studyApp.stats.getTokenCost().then(setTokenStats).catch(() => {});
    }
    void refreshLearnerFacts();
  }, []);

  async function refreshLearnerFacts(): Promise<void> {
    if (!window.studyApp?.learnerContext) return;
    const today = await window.studyApp.guides.listToday();
    const currentGoalId = today.goal?.id ?? null;
    setGoalId(currentGoalId);
    if (!currentGoalId) {
      setLearnerFacts([]);
      return;
    }
    setLearnerFacts(await window.studyApp.learnerContext.listForGoal(currentGoalId));
  }

  async function saveLearnerFact(): Promise<void> {
    if (!goalId || !factKey.trim() || !factValue.trim()) return;
    await runAction('保存学习事实', async () => {
      await window.studyApp.learnerContext.proposeFact(goalId, {
        scope: factScope,
        key: factKey.trim(),
        value: factValue.trim(),
        source: 'confirmed',
        confidence: 1
      });
      setFactKey('');
      setFactValue('');
      await refreshLearnerFacts();
    });
  }

  async function handleSave(): Promise<void> {
    await runAction('保存设置', async () => {
      await window.studyApp.settings.update({
        deepseekBaseUrl: baseUrl,
        deepseekModel: model,
        deepseekApiKey: apiKey,
        defaultBlockMinutes: blockMinutes,
        autoLaunch: settings.autoLaunch,
        dailyStudyWindows: settings.dailyStudyWindows,
        learningStyle
      });
      setApiKey('');
      await onSaved();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  }

  return (
    <section className="settings-layout">
      <header className="page-title-block">
        <h1>设置</h1>
        <p>管理 AI 助手与学习偏好</p>
      </header>

      <div className="settings-grid">
        <section className="settings-card">
          <div className="settings-card-title">
            <span className="settings-card-icon ai"><Brain size={22} /></span>
            <h3>AI 助手</h3>
          </div>
          <div className="settings-row">
            <span>API Key</span>
            <span className={`status-badge ${settings.hasDeepseekApiKey ? 'success' : ''}`}>{settings.hasDeepseekApiKey ? '已配置' : '未配置'}</span>
          </div>
          <label className="settings-field">
            <input
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={settings.hasDeepseekApiKey ? '输入新密钥以覆盖（已保存的密钥不会显示）' : '粘贴 DeepSeek API Key'}
              type="password"
              autoComplete="off"
            />
          </label>
          <label className="settings-field">
            <span>Model</span>
            <input value={model} onChange={(event) => setModel(event.target.value)} autoComplete="off" />
          </label>
          <label className="settings-field">
            <span>Base URL</span>
            <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} autoComplete="off" />
          </label>
          <button className="primary-action full" type="button" onClick={() => void handleSave()}>
            {saved ? (
              <span className="save-success"><Check size={16} /> 已保存</span>
            ) : '保存设置'}
          </button>
        </section>

        <section className="settings-card">
          <div className="settings-card-title">
            <span className="settings-card-icon"><Brain size={22} /></span>
            <h3>学习上下文</h3>
          </div>
          <p className="settings-hint">只有你确认的内容会影响后续教程。AI 推断会先作为待确认项显示，不会直接改变计划。</p>
          {!goalId ? (
            <p className="muted">创建学习目标后，可以在这里管理系统记住的环境和偏好。</p>
          ) : (
            <>
              <label className="settings-field">
                <span>作用范围</span>
                <select value={factScope} onChange={(event) => setFactScope(event.target.value as LearnerFactScope)}>
                  <option value="goal">当前目标</option>
                  <option value="global">所有学习目标</option>
                </select>
              </label>
              <label className="settings-field">
                <span>项目，例如：操作系统、模型提供商</span>
                <input value={factKey} onChange={(event) => setFactKey(event.target.value)} placeholder="操作系统" />
              </label>
              <label className="settings-field">
                <span>确认内容</span>
                <input value={factValue} onChange={(event) => setFactValue(event.target.value)} placeholder="Windows" />
              </label>
              <button className="secondary-action full" type="button" disabled={!factKey.trim() || !factValue.trim()} onClick={() => void saveLearnerFact()}>
                保存为已确认事实
              </button>
              <div className="token-cost-table">
                {learnerFacts.length === 0 && <span className="settings-hint">暂无学习事实</span>}
                {learnerFacts.map((fact) => (
                  <div key={fact.id} className="settings-row small">
                    <span>
                      <strong>{fact.key}</strong>：{fact.value}
                      <small className="muted"> · {fact.scope === 'global' ? '全局' : fact.scope === 'goal' ? '当前目标' : '临时任务'} · {fact.source === 'confirmed' ? '已确认' : '待确认'}</small>
                    </span>
                    <span>
                      {fact.source !== 'confirmed' && (
                        <button className="secondary-action" type="button" onClick={() => void runAction('确认学习事实', async () => {
                          await window.studyApp.learnerContext.confirmFact(goalId, fact.key, fact.scope, fact.taskId ?? undefined);
                          await refreshLearnerFacts();
                        })}>确认</button>
                      )}
                      <button className="icon-action" type="button" aria-label={`删除学习事实 ${fact.key}`} onClick={() => void runAction('删除学习事实', async () => {
                        await window.studyApp.learnerContext.deleteFact(goalId, fact.key, fact.scope, fact.taskId ?? undefined);
                        await refreshLearnerFacts();
                      })}><Trash2 size={15} /></button>
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="settings-card">
          <div className="settings-card-title">
            <span className="settings-card-icon"><Target size={22} /></span>
            <h3>学习偏好</h3>
          </div>
          <label className="settings-field">
            <span>默认专注时长（分钟）</span>
            <input
              type="number"
              min={5}
              max={120}
              value={blockMinutes}
              onChange={(event) => setBlockMinutes(Number(event.target.value))}
            />
          </label>
          <label className="settings-field">
            <span>教学风格</span>
            <select
              value={learningStyle}
              onChange={(event) => setLearningStyle(event.target.value as LearningStyle)}
            >
              <option value="detailed">详细</option>
              <option value="concise">简洁</option>
              <option value="code_first">代码优先</option>
            </select>
          </label>
        </section>

        <section className="settings-card">
          <div className="settings-card-title">
            <span className="settings-card-icon"><Database size={22} /></span>
            <h3>数据管理</h3>
          </div>
          <p className="settings-hint">导出当前学习目标的所有数据为 JSON 文件，用于备份或迁移。</p>
          <button
            className="secondary-action full"
            type="button"
            onClick={async () => {
              const today = await window.studyApp.guides.listToday();
              const id = today.goal?.id;
              if (!id) return;
              const data = await window.studyApp.data.exportGoal(id);
              const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `study-data-${id}-${new Date().toISOString().slice(0, 10)}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            <Download size={16} />
            导出学习数据
          </button>
        </section>

        {tokenStats && tokenStats.totalCalls > 0 && (
          <section className="settings-card">
            <div className="settings-card-title">
              <span className="settings-card-icon"><Coins size={22} /></span>
              <h3>Token 用量统计</h3>
            </div>
            <div className="settings-row">
              <span>总输入 tokens</span>
              <strong>{tokenStats.totalInputTokens.toLocaleString()}</strong>
            </div>
            <div className="settings-row">
              <span>总输出 tokens</span>
              <strong>{tokenStats.totalOutputTokens.toLocaleString()}</strong>
            </div>
            <div className="settings-row">
              <span>总调用次数</span>
              <strong>{tokenStats.totalCalls}</strong>
            </div>
            {Object.keys(tokenStats.byOperation).length > 0 && (
              <div className="token-cost-table">
                <span className="settings-hint">按操作类型</span>
                {Object.entries(tokenStats.byOperation).map(([op, stat]) => (
                  <div key={op} className="settings-row small">
                    <span>{op}</span>
                    <span className="muted">{stat.calls} 次 · {stat.inputTokens.toLocaleString()} in / {stat.outputTokens.toLocaleString()} out</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </section>
  );
}
