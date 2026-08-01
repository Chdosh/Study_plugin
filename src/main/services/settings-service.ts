import { app, safeStorage } from 'electron';
import type {
  AppSettings,
  LearningStyle,
  StudyWindow,
  UpdateAppSettingsInput
} from '../../shared/types';
import type { StudyStore } from './store';

const defaultWindows: StudyWindow[] = [{ start: '20:00', end: '22:00' }];
// These are legacy physical database keys. Keep them behind this adapter so
// runtime and UI code never use a provider-specific business configuration.
const legacyAiSettingKeys = {
  baseUrl: 'deepseekBaseUrl',
  model: 'deepseekModel',
  encryptedApiKey: 'deepseekApiKeyEncrypted'
} as const;

export interface RuntimeSettings extends AppSettings {
  aiApiKey: string | null;
}

export class SettingsService {
  constructor(private readonly store: StudyStore) {}

  async getAppSettings(): Promise<AppSettings> {
    const [baseUrl, model, autoLaunch, blockMinutes, windowsJson, encryptedKey, learningStyle] = await Promise.all([
      this.store.getSetting(legacyAiSettingKeys.baseUrl),
      this.store.getSetting(legacyAiSettingKeys.model),
      this.store.getSetting('autoLaunch'),
      this.store.getSetting('defaultBlockMinutes'),
      this.store.getSetting('dailyStudyWindows'),
      this.store.getSetting(legacyAiSettingKeys.encryptedApiKey),
      this.store.getSetting('learningStyle')
    ]);

    return {
      aiBaseUrl: baseUrl ?? '',
      aiModel: model ?? '',
      hasAiApiKey: Boolean(encryptedKey),
      autoLaunch: autoLaunch === 'true',
      defaultBlockMinutes: Number(blockMinutes ?? 10),
      dailyStudyWindows: parseWindows(windowsJson),
      learningStyle: parseLearningStyle(learningStyle)
    };
  }

  async getRuntimeSettings(): Promise<RuntimeSettings> {
    const settings = await this.getAppSettings();
    return {
      ...settings,
      aiApiKey: await this.getAiApiKey()
    };
  }

  async updateSettings(patch: UpdateAppSettingsInput): Promise<AppSettings> {
    if (typeof patch.aiBaseUrl === 'string') {
      await this.store.putSetting(legacyAiSettingKeys.baseUrl, patch.aiBaseUrl.trim());
    }
    if (typeof patch.aiModel === 'string') {
      await this.store.putSetting(legacyAiSettingKeys.model, patch.aiModel.trim());
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
    if (typeof patch.aiApiKey === 'string' && patch.aiApiKey.trim()) {
      await this.store.putSetting(
        legacyAiSettingKeys.encryptedApiKey,
        encryptSecret(patch.aiApiKey.trim())
      );
    }
    return this.getAppSettings();
  }

  private async getAiApiKey(): Promise<string | null> {
    const encrypted = await this.store.getSetting(legacyAiSettingKeys.encryptedApiKey);
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
