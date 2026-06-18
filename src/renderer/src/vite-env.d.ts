/// <reference types="vite/client" />

import type { StudyAppApi } from '../../shared/types';

declare global {
  interface Window {
    studyApp: StudyAppApi;
  }
}
