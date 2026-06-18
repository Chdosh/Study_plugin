import { describe, expect, it } from 'vitest';
import { dailyPlanAgentOutputSchema, importAgentOutputSchema } from './schemas';

describe('AI output schemas', () => {
  it('accepts a valid import-agent output', () => {
    const result = importAgentOutputSchema.parse({
      goals: [
        {
          title: 'Learn TypeScript',
          description: 'Build foundations',
          priority: 3,
          dueDate: null
        }
      ],
      tasks: [
        {
          title: 'Read generics guide',
          description: 'Focus on constraints',
          goalTitle: 'Learn TypeScript',
          priority: 2,
          difficulty: 'foundation',
          estimateMinutes: 30,
          acceptanceCriteria: 'Explain generic constraints',
          dependsOnTitles: []
        }
      ]
    });

    expect(result.tasks[0].estimateMinutes).toBe(30);
  });

  it('rejects an invalid daily plan block duration', () => {
    expect(() =>
      dailyPlanAgentOutputSchema.parse({
        blocks: [
          {
            taskTitle: 'Read generics guide',
            startTime: '20:00',
            endTime: '20:02',
            durationMinutes: 2,
            objective: 'Learn generics',
            action: 'Read and summarize',
            expectedOutput: 'Short note',
            difficulty: 'foundation',
            material: 'Docs',
            successCheck: 'Can explain it',
            fallback: 'Read simpler intro'
          }
        ]
      })
    ).toThrow();
  });
});
