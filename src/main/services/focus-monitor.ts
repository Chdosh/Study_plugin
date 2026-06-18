import type { StudyStore } from './store';
import { getForegroundWindowInfo } from './windows-foreground';

export class FocusMonitor {
  private activeSessionId: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private lastSignature: string | null = null;

  constructor(private readonly store: StudyStore) {}

  start(sessionId: string): void {
    this.stop();
    this.activeSessionId = sessionId;
    this.timer = setInterval(() => {
      void this.captureForeground();
    }, 15000);
    void this.captureForeground();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.activeSessionId = null;
    this.lastSignature = null;
  }

  private async captureForeground(): Promise<void> {
    try {
      const activeWindow = await getForegroundWindowInfo();
      const appName = activeWindow.appName;
      const windowTitle = activeWindow.windowTitle;
      const signature = `${appName}:${windowTitle ?? ''}`;
      if (signature === this.lastSignature) return;
      this.lastSignature = signature;
      await this.store.recordFocusEvent({
        sessionId: this.activeSessionId,
        appName,
        windowTitle,
        eventType: appName === 'Unknown' ? 'unknown' : 'foreground'
      });
    } catch (error) {
      await this.store.recordFocusEvent({
        sessionId: this.activeSessionId,
        appName: 'Focus monitor unavailable',
        windowTitle: error instanceof Error ? error.message : String(error),
        eventType: 'unknown'
      });
    }
  }
}
