import { z } from 'zod';

export const studyWindowSchema = z.object({
  start: z.string().min(1),
  end: z.string().min(1)
});

export const importAgentOutputSchema = z.object({
  goals: z.array(
    z.object({
      title: z.string().min(1),
      description: z.string().default(''),
      priority: z.number().int().min(1).max(5).default(3),
      dueDate: z.string().nullable().default(null)
    })
  ),
  tasks: z.array(
    z.object({
      title: z.string().min(1),
      description: z.string().default(''),
      goalTitle: z.string().nullable().default(null),
      priority: z.number().int().min(1).max(5).default(3),
      difficulty: z.enum(['foundation', 'standard', 'advanced', 'exam']).default('foundation'),
      estimateMinutes: z.number().int().min(10).max(480).default(30),
      acceptanceCriteria: z.string().default(''),
      dependsOnTitles: z.array(z.string()).default([])
    })
  )
});

export const dailyPlanAgentOutputSchema = z.object({
  blocks: z.array(
    z.object({
      taskTitle: z.string().nullable().default(null),
      startTime: z.string().min(1),
      endTime: z.string().min(1),
      durationMinutes: z.number().int().min(5).max(120),
      objective: z.string().min(1),
      action: z.string().min(1),
      expectedOutput: z.string().min(1),
      difficulty: z.string().min(1),
      material: z.string().min(1),
      successCheck: z.string().min(1),
      fallback: z.string().min(1)
    })
  )
});

export const evaluationAgentOutputSchema = z.object({
  completionScore: z.number().min(0).max(100),
  focusScore: z.number().min(0).max(100),
  difficultyFit: z.string().min(1),
  delayReason: z.string().default(''),
  nextAction: z.string().min(1)
});

export const reviewAgentOutputSchema = z.object({
  completionScore: z.number().min(0).max(100),
  focusScore: z.number().min(0).max(100),
  summary: z.string().min(1),
  nextActions: z.array(z.string()).default([])
});

export type ImportAgentOutput = z.infer<typeof importAgentOutputSchema>;
export type DailyPlanAgentOutput = z.infer<typeof dailyPlanAgentOutputSchema>;
export type ReviewAgentOutput = z.infer<typeof reviewAgentOutputSchema>;
