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
    title: 'Study Supervisor',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
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
  tray.setToolTip('Study Supervisor');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Open Study Supervisor',
        click: () => showMainWindow()
      },
      {
        label: 'Start Current Block',
        click: () => {
          showMainWindow();
          new Notification({
            title: 'Study Supervisor',
            body: 'Open Today and start the current focus block.'
          }).show();
        }
      },
      {
        label: 'Generate Review',
        click: async () => {
          showMainWindow();
          try {
            await appService.generateReview(new Date().toISOString().slice(0, 10));
          } catch {
            new Notification({
              title: 'Review needs settings',
              body: 'Add a DeepSeek API key before generating an AI review.'
            }).show();
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Quit',
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
