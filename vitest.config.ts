import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    // threads 池在 Windows CI 上偶发 ERR_IPC_CHANNEL_CLOSED；
    // 改用单 fork 进程串行跑文件，牺牲一点并行度换取 CI 稳定。
    pool: 'forks',
    fileParallelism: false,
    poolOptions: {
      forks: { singleFork: true }
    }
  }
});
