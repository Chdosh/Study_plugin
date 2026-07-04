/// <reference types="vite/client" />

import type { FloatWindowApi, StudyAppApi } from '../../shared/types';

declare global {
  interface Window {
    studyApp: StudyAppApi;
    floatApp: FloatWindowApi;
  }
}
