import { useState } from 'react';
import { Brain, ChevronRight, Folder, Target, UserRound } from 'lucide-react';
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
    });
  }

  return (
    <section className="settings-layout">
      <header className="page-title-block">
        <h1>设置</h1>
        <p>管理你的学习偏好、AI 能力与应用行为</p>
      </header>

      <div className="settings-grid">
        <section className="settings-card">
          <div className="settings-card-title">
            <span className="settings-card-icon ai"><Brain size={22} /></span>
            <h3>AI 助手</h3>
          </div>
          <div className="settings-row">
            <span>API Key 状态</span>
            <span className={`status-badge ${settings.hasDeepseekApiKey ? 'success' : ''}`}>{settings.hasDeepseekApiKey ? '已配置' : '未配置'}</span>
          </div>
          <div className="settings-row">
            <span>Provider</span>
            <span className="settings-value">DeepSeek</span>
          </div>
          <div className="settings-row">
            <span>Model</span>
            <span className="settings-value">{model || 'deepseek-chat'}</span>
          </div>
          <label className="settings-field settings-secret-field">
            API Key
            <input
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={settings.hasDeepseekApiKey ? '已加密保存' : '粘贴密钥后保存'}
              type="password"
            />
          </label>
          <label className="settings-field">
            DeepSeek Base URL
            <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
          </label>
          <button className="primary-action full" type="button" onClick={() => void handleSave()}>
            管理 API 配置
          </button>
          <p className="muted">用于遇到问题时的 AI 辅助与复盘建议生成。</p>
        </section>

        <section className="settings-card">
          <div className="settings-card-title">
            <span className="settings-card-icon"><Target size={22} /></span>
            <h3>学习偏好</h3>
          </div>
          <label className="settings-field inline">
            <span>默认专注时长</span>
            <div className="settings-field-control">
              <input
                type="number"
                min={5}
                max={60}
                value={blockMinutes}
                onChange={(event) => setBlockMinutes(Number(event.target.value))}
              />
              <span>分钟</span>
            </div>
          </label>
        </section>

        <section className="settings-card">
          <div className="settings-card-title">
            <span className="settings-card-icon"><UserRound size={22} /></span>
            <h3>账户与版本</h3>
          </div>
          <div className="settings-row">
            <span>当前身份</span>
            <span className="settings-value">学习者</span>
          </div>
          <div className="settings-row">
            <span>版本</span>
            <span className="settings-value">v1.0.0</span>
          </div>
          <div className="settings-row">
            <span>最近同步</span>
            <span className="settings-value">今天 {new Date().toTimeString().slice(0, 5)}</span>
          </div>
          <button className="secondary-action full" type="button">检查更新</button>
        </section>

        <section className="settings-card">
          <div className="settings-card-title">
            <span className="settings-card-icon"><Folder size={22} /></span>
            <h3>数据与记录</h3>
          </div>
          <div className="settings-row">
            <span>本地数据存储位置</span>
            <span className="settings-value muted">D:\StudyAssistant\data</span>
          </div>
          <button className="settings-row-button" type="button">
            <span>导出学习记录</span>
            <ChevronRight size={16} />
          </button>
          <button className="settings-row-button" type="button">
            <span>清空缓存</span>
            <span className="settings-value">12.6 MB</span>
            <ChevronRight size={16} />
          </button>
          <button className="settings-row-button" type="button">
            <span>恢复默认设置</span>
            <ChevronRight size={16} />
          </button>
        </section>
      </div>
    </section>
  );
}
