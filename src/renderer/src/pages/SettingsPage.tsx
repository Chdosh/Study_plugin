import { useState } from 'react';
import { Brain, Check, Database, Download, Target } from 'lucide-react';
import type { AppSettings } from '../../../shared/types';

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
  const [saved, setSaved] = useState(false);

  async function handleSave(): Promise<void> {
    await runAction('保存设置', async () => {
      await window.studyApp.settings.update({
        deepseekBaseUrl: baseUrl,
        deepseekModel: model,
        deepseekApiKey: apiKey,
        defaultBlockMinutes: blockMinutes,
        autoLaunch: settings.autoLaunch,
        dailyStudyWindows: settings.dailyStudyWindows
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
      </div>
    </section>
  );
}
