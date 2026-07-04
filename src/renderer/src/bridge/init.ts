/**
 * Bridge initialization module.
 *
 * In Electron mode: window.studyApp already exists (set by preload contextBridge).
 * This module detects it and does nothing.
 *
 * In browser mode: window.studyApp does not exist, so this module installs
 * a MockStudyAppApi that returns realistic data based on URL parameters.
 *
 * Import this at the top of main.tsx to ensure the bridge is ready before
 * any React code runs.
 */
import { MockStudyAppApi } from './mock-api';
import { getPreviewConfig, isBrowserMode } from './url-state';

// Execute immediately on module evaluation.
try {
  if (isBrowserMode()) {
    const config = getPreviewConfig();
    window.studyApp = new MockStudyAppApi(config);
  }
} catch (e) {
  console.warn('[bridge/init] Failed to initialize mock API:', e);
}
