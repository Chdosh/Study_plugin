export const SCENARIO_DELAY_MS = 1500;

export interface PreviewConfig {
  view: 'today' | 'study' | 'review' | 'settings' | 'settlement' | null;
  guide: 'has-guide' | 'no-guide' | null;
  session: 'normal' | 'running' | 'paused' | null;
  review: 'normal' | 'completed' | null;
  scenario: 'normal' | 'empty' | 'long-title' | 'many-tasks' | 'ai-unavailable' | 'loading' | 'error' | null;
}

let cached: PreviewConfig | null = null;

export function getPreviewConfig(): PreviewConfig {
  if (cached) return cached;
  const params = new URLSearchParams(window.location.search);
  const rawPreview = params.get('preview');
  const rawState = params.get('state');
  const rawGuide = params.get('guide');
  const rawScenario = params.get('scenario');

  const validViews = ['today', 'study', 'review', 'settings', 'settlement'] as const;
  const view = validViews.includes(rawPreview as typeof validViews[number])
    ? (rawPreview as PreviewConfig['view'])
    : null;

  const validSessions = ['running', 'paused'] as const;
  const session = validSessions.includes(rawState as typeof validSessions[number])
    ? (rawState as PreviewConfig['session'])
    : null;

  const validGuides = ['has-guide', 'no-guide'] as const;
  const guide = validGuides.includes(rawGuide as typeof validGuides[number])
    ? (rawGuide as PreviewConfig['guide'])
    : null;

  const validReviews = ['completed'] as const;
  const review = validReviews.includes(rawState as typeof validReviews[number])
    ? (rawState as PreviewConfig['review'])
    : null;

  const validScenarios = ['empty', 'long-title', 'many-tasks', 'ai-unavailable', 'loading', 'error'] as const;
  const scenario = validScenarios.includes(rawScenario as typeof validScenarios[number])
    ? (rawScenario as PreviewConfig['scenario'])
    : null;

  cached = { view, guide, session, review, scenario };
  return cached;
}

export function isBrowserMode(): boolean {
  return typeof window !== 'undefined' && !('studyApp' in window);
}
