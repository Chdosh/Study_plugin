import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, Menu, Notification, Tray, nativeImage, shell } from 'electron';
import { electronApp, is, optimizer } from '@electron-toolkit/utils';
import { createDatabase } from './db/client';
import { registerIpcHandlers } from './ipc';
import { AppService } from './services/app-service';
import { SettingsService } from './services/settings-service';
import { StudyStore } from './services/store';
import type { StudySession } from '../shared/types';

let mainWindow: BrowserWindow | null = null;
let floatWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
const __dirname = dirname(fileURLToPath(import.meta.url));
let isQuitting = false;
let hasActiveSession = false;

function showFloatWindow(): void {
  if (floatWindow && !floatWindow.isDestroyed()) {
    floatWindow.show();
  }
}

function hideFloatWindow(): void {
  if (floatWindow && !floatWindow.isDestroyed()) {
    floatWindow.hide();
    // Reset window size to collapsed state
    floatWindow.setSize(420, 56);
  }
}

function handleSessionFloatVisibility(session: StudySession): void {
  if (session.status === 'active' || session.status === 'paused') {
    hasActiveSession = true;
    showFloatWindow();
  } else if (session.status === 'completed' || session.status === 'skipped') {
    hasActiveSession = false;
    hideFloatWindow();
  }
}

function createMainWindow(appService: AppService): BrowserWindow {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 640,
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

  // BUG-004 fix: if no active session, close main window quits the app
  window.on('close', (event) => {
    if (!isQuitting) {
      if (hasActiveSession) {
        // Active session — hide main window, keep float
        event.preventDefault();
        window.hide();
      } else {
        // No active session — quit the entire app
        isQuitting = true;
        app.quit();
      }
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

function createFloatWindow(appService: AppService): BrowserWindow {
  const window = new BrowserWindow({
    width: 420,
    height: 56,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    title: '学习浮窗',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Allow setSize to work by setting min/max range
  window.setMinimumSize(420, 56);
  window.setMaximumSize(420, 300);

  window.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      window.hide();
    }
    // When isQuitting, allow the window to actually close so app can quit
  });

  window.on('move', () => {
    const [x, y] = window.getPosition();
    void appService.saveFloatPosition(x, y);
  });

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/float-index.html`);
  } else {
    void window.loadFile(join(__dirname, '../renderer/float-index.html'));
  }

  return window;
}

async function restoreFloatPosition(window: BrowserWindow, appService: AppService): Promise<void> {
  const pos = await appService.getFloatPosition();
  if (pos) {
    window.setPosition(pos.x, pos.y);
  }
}

async function recoverActiveSession(appService: AppService): Promise<void> {
  const active = await appService.getActiveSession();
  if (active) {
    hasActiveSession = true;
    showFloatWindow();
  } else {
    hasActiveSession = false;
    hideFloatWindow();
  }
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
            body: '打开"今日计划"，开始当前专注学习块。'
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
  app.setName('study-supervisor');
  if (process.env.STUDY_SUPERVISOR_USER_DATA_DIR) {
    app.setPath('userData', process.env.STUDY_SUPERVISOR_USER_DATA_DIR);
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  const { db } = await createDatabase(app.getPath('userData'));
  const store = new StudyStore(db);
  await store.seedDefaults();
  const settings = new SettingsService(store);
  const appService = new AppService(store, settings, () => mainWindow, () => floatWindow);
  registerIpcHandlers(appService);

  mainWindow = createMainWindow(appService);
  floatWindow = createFloatWindow(appService);
  createTray(appService);

  await restoreFloatPosition(floatWindow, appService);
  await recoverActiveSession(appService);

  const originalPush = appService.pushSessionState.bind(appService);
  appService.pushSessionState = async (session: StudySession) => {
    await originalPush(session);
    handleSessionFloatVisibility(session);
  };

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow(appService);
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
    app.quit();
  }
});
