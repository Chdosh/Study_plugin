import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, Menu, Notification, Tray, nativeImage, shell } from 'electron';
import { electronApp, is, optimizer } from '@electron-toolkit/utils';
import { createDatabase } from './db/client';
import { registerIpcHandlers } from './ipc';
import { AppService } from './services/app-service';
import { SettingsService } from './services/settings-service';
import { StudyStore } from './services/store';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
const __dirname = dirname(fileURLToPath(import.meta.url));
let isQuitting = false;

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1040,
    minHeight: 680,
    title: '学习管家',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  window.on('ready-to-show', () => {
    window.show();
  });

  window.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      window.hide();
    }
  });

  window.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return window;
}

function createTray(appService: AppService): void {
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAALUlEQVR4AWP4//8/AyUYTFhYGAZGRkYGEgATqAGjBoYaGGpgqIGhBoaSAAAncxM25FVcJwAAAABJRU5ErkJggg=='
  );
  tray = new Tray(icon);
  tray.setToolTip('学习管家');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '打开学习管家',
        click: () => showMainWindow()
      },
      {
        label: '开始当前学习块',
        click: () => {
          showMainWindow();
          new Notification({
            title: '学习管家',
            body: '打开“今日计划”，开始当前专注学习块。'
          }).show();
        }
      },
      {
        label: '生成今日复盘',
        click: async () => {
          showMainWindow();
          try {
            await appService.generateReview(new Date().toISOString().slice(0, 10));
          } catch {
            new Notification({
              title: '需要先完成设置',
              body: '生成 AI 复盘前，请先在设置里填写 DeepSeek API Key。'
            }).show();
          }
        }
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ])
  );
  tray.on('double-click', () => showMainWindow());
}

function showMainWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function main(): Promise<void> {
  electronApp.setAppUserModelId('local.study.supervisor');

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  const { db } = await createDatabase(app.getPath('userData'));
  const store = new StudyStore(db);
  await store.seedDefaults();
  const settings = new SettingsService(store);
  const appService = new AppService(store, settings, () => mainWindow);
  registerIpcHandlers(appService);

  mainWindow = createMainWindow();
  createTray(appService);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    } else {
      showMainWindow();
    }
  });
}

app.whenReady().then(() => {
  void main();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Keep tray app alive on Windows unless the explicit Quit menu item is used.
  }
});
