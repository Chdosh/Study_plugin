import type { PromptProfile, StudyWindow, TaskItem } from '../../shared/types';

export function buildImportPrompt(rawText: string, profile: PromptProfile): string {
  return [
    profile.content,
    '',
    'Parse this pasted study plan into durable local data.',
    'Rules:',
    '- Preserve the learner intent.',
    '- Split large items into concrete tasks.',
    '- Estimate time in minutes.',
    '- Use difficulty values only: foundation, standard, advanced, exam.',
    '- Keep dependencies by title when one task clearly requires another.',
    '',
    'Output JSON shape:',
    '{ "goals": [...], "tasks": [...] }',
    '',
    'Pasted plan:',
    rawText
  ].join('\n');
}

export function buildPlanPrompt(params: {
  date: string;
  windows: StudyWindow[];
  tasks: TaskItem[];
  profile: PromptProfile;
  blockMinutes: number;
}): string {
  return [
    params.profile.content,
    '',
    `Create a ${params.blockMinutes}-minute block study plan for ${params.date}.`,
    'Rules:',
    '- Use only unresolved tasks.',
    '- Every block must have objective, action, expectedOutput, material, successCheck, and fallback.',
    '- Prefer active output over passive reading.',
    '- If a task is too large, plan the next useful slice.',
    '- AI output is a draft; the user will confirm before it becomes official.',
    '',
    `Available windows: ${JSON.stringify(params.windows)}`,
    `Tasks: ${JSON.stringify(params.tasks)}`
  ].join('\n');
}

export function buildReviewPrompt(params: {
  date: string;
  snapshot: unknown;
  profile: PromptProfile;
}): string {
  return [
    params.profile.content,
    '',
    `Review study execution for ${params.date}.`,
    'Score completion and focus from 0 to 100.',
    'Explain the day in practical terms and give concise next actions.',
    'Do not shame the learner. Focus on corrective planning.',
    '',
    `Snapshot: ${JSON.stringify(params.snapshot)}`
  ].join('\n');
}
