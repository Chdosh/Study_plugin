import type { Id, ReviewResult } from '../../../shared/types';
import type { SettingsService } from '../../services/settings-service';
import type { StudyStore } from '../../services/store';
import type { LearnerContextModule } from '../context/context';
import type { LearningTurnModule } from '../learning-turn/learning-turn';

export class LearningReviewModule {
  constructor(
    private readonly store: StudyStore,
    private readonly settings: SettingsService,
    private readonly context: LearnerContextModule,
    private readonly learningTurn: LearningTurnModule
  ) {}

  async generateForGuide(guideId: Id): Promise<ReviewResult> {
    const guide = await this.store.getDailyGuideById(guideId);
    if (!guide) throw new Error(`Guide not found: ${guideId}`);
    const [snapshot, profile, runtimeSettings, reviewContext, knowledge] = await Promise.all([
      this.store.getGuideSnapshot(guideId),
      this.store.getPromptProfile(),
      this.settings.getRuntimeSettings(),
      this.context.build('generate_review'),
      this.store.getKnowledgeContextForGoal(guide.goalId)
    ]);
    const input = {
      learningUnit: snapshot,
      knowledgeEvidence: knowledge,
      context: reviewContext.context,
      profile,
      settings: runtimeSettings,
      traceId: `ta_${crypto.randomUUID()}`
    };
    const run = await this.learningTurn.startTool<typeof input, Omit<ReviewResult, 'reviewId' | 'date'>>({
      toolName: 'reflect',
      input,
      context: {
        kind: 'review',
        scopeType: 'learning_guide',
        scopeId: guideId,
        goalId: guide.goalId,
        contextVersion: 1
      },
      audit: {
        kind: 'reflection',
        date: guide.date,
        provider: 'deepseek',
        model: runtimeSettings.deepseekModel,
        promptProfileId: profile.id,
        promptVersionId: profile.activeVersionId,
        inputSnapshot: {
          guideId,
          evidence: snapshot,
          contextSourceIds: [
            ...reviewContext.contextSourceIds,
            ...knowledge.knowledgeItems.map((item) => item.id),
            ...knowledge.reviewKnowledgeItems.map((item) => item.id)
          ]
        },
        outputSchemaVersion: 'review.v1'
      }
    });
    return { reviewId: run.runReviewId, date: guide.date, ...run.output };
  }

  async generateCurrent(fallbackDate?: string): Promise<ReviewResult> {
    const current = await this.store.getActiveGuide();
    const guide = current.guide ?? (fallbackDate
      ? await this.store.getGuideByDate(fallbackDate)
      : null);
    if (!guide) throw new Error('没有可复盘的 Learning Guide。');
    return this.generateForGuide(guide.id);
  }
}
