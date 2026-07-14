import { PlanningModule } from './planning/planning';
import { LearningRuntimeModule } from './runtime/runtime';
import { LearnerContextModule } from './context/context';
import { LearningBranchModule } from './branch/branch';
import type { StudyStore } from '../services/store';

export class LearningModules {
  readonly planning: PlanningModule;
  readonly runtime: LearningRuntimeModule;
  readonly context: LearnerContextModule;
  readonly branch: LearningBranchModule;

  constructor(store: StudyStore) {
    this.planning = new PlanningModule(store);
    this.runtime = new LearningRuntimeModule(store.getRuntimePersistence());
    this.context = new LearnerContextModule(store);
    this.branch = new LearningBranchModule(store);
  }
}
