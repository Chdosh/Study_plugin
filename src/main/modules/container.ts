import { PlanningModule } from './planning/planning';
import { LearningRuntimeModule } from './runtime/runtime';
import { LearnerContextModule } from './context/context';
import { LearningBranchModule } from './branch/branch';
import { LearningHistoryModule } from './history/history';
import type { StudyStore } from '../services/store';

export class LearningModules {
  readonly planning: PlanningModule;
  readonly runtime: LearningRuntimeModule;
  readonly context: LearnerContextModule;
  readonly branch: LearningBranchModule;
  readonly history: LearningHistoryModule;

  constructor(store: StudyStore) {
    this.planning = new PlanningModule(store);
    this.runtime = new LearningRuntimeModule(store);
    this.context = new LearnerContextModule(store);
    this.branch = new LearningBranchModule(store);
    this.history = new LearningHistoryModule(store);
  }
}
