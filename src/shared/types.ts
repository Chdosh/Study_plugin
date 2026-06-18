export type Id = string;

export type PromptProfileKey = 'foundation' | 'standard' | 'advanced' | 'exam' | 'recovery';

export interface AppSettings {
  deepseekBaseUrl: string;
  deepseekModel: string;
  hasDeepseekApiKey: boolean;
  autoLaunch: boolean;
  defaultBlockMinutes: number;
  dailyStudyWindows: StudyWindow[];
}

export interface StudyWindow {
  start: string;
  end: string;
}

export interface RawImport {
  id: Id;
  source: 'chatgpt' | 'codex' | 'manual';
  rawText: string;
  status: 'created' | 'parsed' | 'failed';
  createdAt: string;
  parsedAt: string | null;
}

export interface TaskItem {
  id: Id;
  goalId: Id | null;
  sourceImportId: Id | null;
  title: string;
  description: string | null;
  status: 'backlog' | 'planned' | 'in_progress' | 'done' | 'skipped';
  priority: number;
  difficulty: 'foundation' | 'standard' | 'advanced' | 'exam';
  estimateMinutes: number;
  acceptanceCriteria: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DailyPlanBlock {
  id: Id;
  planId: Id;
  taskId: Id | null;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  objective: string;
  action: string;
  expectedOutput: string;
  difficulty: string;
  material: string;
  successCheck: string;
  fallback: string;
  status: 'planned' | 'active' | 'done' | 'skipped' | 'deferred';
  position: number;
}

export interface DailyPlan {
  id: Id;
  date: string;
  status: 'draft' | 'confirmed' | 'archived';
  availableWindowsJson: string;
  createdAt: string;
  confirmedAt: string | null;
  version: number;
  blocks: DailyPlanBlock[];
}

export interface StudySession {
  id: Id;
  blockId: Id | null;
  taskId: Id | null;
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number | null;
  status: 'active' | 'paused' | 'completed' | 'skipped';
  focusScore: number | null;
  notes: string | null;
}

export interface PromptProfile {
  id: Id;
  key: PromptProfileKey;
  name: string;
  description: string;
  activeVersionId: Id | null;
  version: number;
  content: string;
}

export interface ImportParseResult {
  importId: Id;
  goalsCreated: number;
  tasksCreated: number;
  tasks: TaskItem[];
}

export interface ReviewResult {
  reviewId: Id;
  date: string;
  completionScore: number;
  focusScore: number;
  summary: string;
  nextActions: string[];
}

export interface StudyAppApi {
  settings: {
    get: () => Promise<AppSettings>;
    update: (patch: Partial<AppSettings> & { deepseekApiKey?: string }) => Promise<AppSettings>;
  };
  imports: {
    create: (rawText: string, source: RawImport['source']) => Promise<RawImport>;
    parse: (importId: Id, promptProfileId?: Id) => Promise<ImportParseResult>;
  };
  tasks: {
    list: () => Promise<TaskItem[]>;
    update: (taskId: Id, patch: Partial<TaskItem>) => Promise<TaskItem>;
  };
  plans: {
    list: (date?: string) => Promise<DailyPlan[]>;
    generate: (date: string, availableWindows: StudyWindow[], promptProfileId?: Id) => Promise<DailyPlan>;
    confirm: (planId: Id) => Promise<DailyPlan>;
  };
  sessions: {
    start: (blockId: Id) => Promise<StudySession>;
    pause: (sessionId: Id) => Promise<StudySession>;
    complete: (sessionId: Id, notes?: string) => Promise<StudySession>;
    skip: (blockId: Id, reason: string) => Promise<void>;
  };
  reviews: {
    generate: (date: string) => Promise<ReviewResult>;
  };
  prompts: {
    list: () => Promise<PromptProfile[]>;
    update: (profileId: Id, content: string) => Promise<PromptProfile>;
  };
}
