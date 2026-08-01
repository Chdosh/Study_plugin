import { PlanningModule } from './planning/planning';
import { LearnerContextModule } from './context/context';
import type { StudyStore } from '../services/store';
import type { SettingsService } from '../services/settings-service';
import type { AgentLoop } from '../agent/agent-loop';
import { LearningTurnModule } from './learning-turn/learning-turn';
import { LearningConversationModule } from './conversation/conversation';
import { LearningReviewModule } from './review/review';
import { LearningEvaluationModule } from './evaluation/evaluation';
import { LearningExecutionModule } from './execution/execution';

export class LearningModules {
  readonly planning: PlanningModule;
  readonly context: LearnerContextModule;
  readonly learningTurn: LearningTurnModule;
  readonly conversation: LearningConversationModule;
  readonly review: LearningReviewModule;
  readonly evaluation: LearningEvaluationModule;
  readonly execution: LearningExecutionModule;

  constructor(store: StudyStore, settings: SettingsService, agentLoop: AgentLoop) {
    this.context = new LearnerContextModule(store);
    this.execution = new LearningExecutionModule(store);
    this.learningTurn = new LearningTurnModule(store, settings, this.context, agentLoop);
    this.planning = new PlanningModule(store, settings, this.learningTurn);
    this.conversation = new LearningConversationModule(
      store,
      settings,
      this.context,
      this.learningTurn
    );
    this.review = new LearningReviewModule(store, settings, this.context, this.learningTurn);
    this.evaluation = new LearningEvaluationModule(store, settings, this.context, this.learningTurn);
  }
}
