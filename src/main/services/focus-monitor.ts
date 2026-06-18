import type { StudyStore } from './store';

interface ActiveWindowResult {
  title?: string;
  owner?: {
    name?: string;
  };
}

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
      const activeWin = await import('active-win');
      const activeWindow = (await activeWin.activeWindow()) as ActiveWindowResult | undefined;
      const appName = activeWindow?.owner?.name ?? 'Unknown';
      const windowTitle = activeWindow?.title ?? null;
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
