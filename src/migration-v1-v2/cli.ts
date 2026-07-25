import { resolve } from 'node:path';
import { ensureV2Database, restoreV1Archive } from './upgrade';

const [commandOrPath, maybePath] = process.argv.slice(2);

if (!commandOrPath) {
  throw new Error(
    '用法：npm run db:upgrade-v2 -- <应用数据目录>，或 npm run db:restore-v1 -- <应用数据目录>'
  );
}

if (commandOrPath === 'restore') {
  if (!maybePath) throw new Error('恢复 V1 时必须提供应用数据目录。');
  const root = resolve(maybePath);
  restoreV1Archive({
    archivePath: resolve(root, 'study-supervisor-v1-archive.db'),
    restorePath: resolve(root, 'study-supervisor.db')
  });
  process.stdout.write('V1 归档已恢复到 study-supervisor.db。\n');
} else {
  const result = await ensureV2Database(resolve(commandOrPath));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
