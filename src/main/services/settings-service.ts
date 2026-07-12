import { app, safeStorage } from 'electron';
import type { AppSettings, LearningStyle, StudyWindow } from '../../shared/types';
import type { StudyStore } from './store';

const defaultWindows: StudyWindow[] = [{ start: '20:00', end: '22:00' }];

export class SettingsService {
  constructor(private readonly store: StudyStore) {}

  async getAppSettings(): Promise<AppSettings> {
    const [baseUrl, model, autoLaunch, blockMinutes, windowsJson, encryptedKey, learningStyle] = await Promise.all([
      this.store.getSetting('deepseekBaseUrl'),
      this.store.getSetting('deepseekModel'),
      this.store.getSetting('autoLaunch'),
      this.store.getSetting('defaultBlockMinutes'),
      this.store.getSetting('dailyStudyWindows'),
      this.store.getSetting('deepseekApiKeyEncrypted'),
      this.store.getSetting('learningStyle')
    ]);

    return {
      deepseekBaseUrl: baseUrl ?? 'https://api.deepseek.com',
      deepseekModel: model ?? 'deepseek-chat',
      hasDeepseekApiKey: Boolean(encryptedKey),
      autoLaunch: autoLaunch === 'true',
      defaultBlockMinutes: Number(blockMinutes ?? 10),
      dailyStudyWindows: parseWindows(windowsJson),
      learningStyle: parseLearningStyle(learningStyle)
    };
  }

  async getRuntimeSettings() {
    const settings = await this.getAppSettings();
    return {
      ...settings,
      deepseekApiKey: await this.getDeepseekApiKey()
    };
  }

  async updateSettings(patch: Partial<AppSettings> & { deepseekApiKey?: string }): Promise<AppSettings> {
    if (typeof patch.deepseekBaseUrl === 'string') {
      await this.store.putSetting('deepseekBaseUrl', patch.deepseekBaseUrl);
    }
    if (typeof patch.deepseekModel === 'string') {
      await this.store.putSetting('deepseekModel', patch.deepseekModel);
    }
    if (typeof patch.defaultBlockMinutes === 'number') {
      await this.store.putSetting('defaultBlockMinutes', String(patch.defaultBlockMinutes));
    }
    if (Array.isArray(patch.dailyStudyWindows)) {
      await this.store.putSetting('dailyStudyWindows', JSON.stringify(patch.dailyStudyWindows));
    }
    if (typeof patch.autoLaunch === 'boolean') {
      await this.store.putSetting('autoLaunch', String(patch.autoLaunch));
      app.setLoginItemSettings({
        openAtLogin: patch.autoLaunch
      });
    }
    if (typeof patch.learningStyle === 'string') {
      await this.store.putSetting('learningStyle', patch.learningStyle);
    }
    if (typeof patch.deepseekApiKey === 'string' && patch.deepseekApiKey.trim()) {
      await this.store.putSetting('deepseekApiKeyEncrypted', encryptSecret(patch.deepseekApiKey.trim()));
    }
    return this.getAppSettings();
  }

  private async getDeepseekApiKey(): Promise<string | null> {
    const encrypted = await this.store.getSetting('deepseekApiKeyEncrypted');
    if (!encrypted) return null;
    return decryptSecret(encrypted);
  }
}

function encryptSecret(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Electron safeStorage encryption is not available on this system.');
  }
  return safeStorage.encryptString(value).toString('base64');
}

function decryptSecret(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Electron safeStorage encryption is not available on this system.');
  }
  return safeStorage.decryptString(Buffer.from(value, 'base64'));
}

function parseWindows(value: string | null): StudyWindow[] {
  if (!value) return defaultWindows;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return defaultWindows;
    return parsed.filter(isStudyWindow);
  } catch {
    return defaultWindows;
  }
}

function parseLearningStyle(value: string | null): LearningStyle {
  if (value === 'concise' || value === 'code_first') return value;
  return 'detailed';
}

function isStudyWindow(value: unknown): value is StudyWindow {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as StudyWindow).start === 'string' &&
    typeof (value as StudyWindow).end === 'string'
  );
}
