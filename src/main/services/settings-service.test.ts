import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    setLoginItemSettings: vi.fn()
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
    decryptString: (value: Buffer) => value.toString().replace(/^encrypted:/, '')
  }
}));

import type { StudyStore } from './store';
import { SettingsService } from './settings-service';

describe('SettingsService AI provider boundary', () => {
  it('does not silently choose a provider for a new database', async () => {
    const { service } = createFixture();

    await expect(service.getAppSettings()).resolves.toMatchObject({
      aiBaseUrl: '',
      aiModel: '',
      hasAiApiKey: false
    });
  });

  it('maps legacy physical keys to provider-neutral runtime settings', async () => {
    const { service, values } = createFixture({
      deepseekBaseUrl: 'https://api.example.test/v1',
      deepseekModel: 'example-model',
      deepseekApiKeyEncrypted: Buffer.from('encrypted:secret').toString('base64')
    });

    await expect(service.getRuntimeSettings()).resolves.toMatchObject({
      aiBaseUrl: 'https://api.example.test/v1',
      aiModel: 'example-model',
      aiApiKey: 'secret',
      hasAiApiKey: true
    });

    await service.updateSettings({
      aiBaseUrl: ' https://api.changed.test/v1 ',
      aiModel: ' changed-model ',
      aiApiKey: ' changed-secret '
    });

    expect(values.get('deepseekBaseUrl')).toBe('https://api.changed.test/v1');
    expect(values.get('deepseekModel')).toBe('changed-model');
    expect(values.get('deepseekApiKeyEncrypted')).toBe(
      Buffer.from('encrypted:changed-secret').toString('base64')
    );
  });
});

function createFixture(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const store = {
    getSetting: vi.fn(async (key: string) => values.get(key) ?? null),
    putSetting: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
    })
  } as unknown as StudyStore;
  return {
    service: new SettingsService(store),
    values
  };
}
