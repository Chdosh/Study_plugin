import fs from 'node:fs';

const tsxPath = process.argv[2] ?? 'src/renderer/src/main.tsx';
const tsx = fs.readFileSync(tsxPath, 'utf8');

const usedClasses = new Set();

// 提取 className 属性后面的表达式或字符串，直到该属性结束（跨越单行的简单情况）
// 1. 双引号字符串: className="foo bar"
// 2. 单引号字符串: className='foo bar'
// 3. 模板字符串: className={`foo ${cond ? 'bar' : ''}`}
// 4. 条件表达式: className={cond ? 'foo' : 'bar'}
// 5. 对象/变量: className={cx('foo', bar)} (只提取字面量)

// 从任意表达式片段中提取字面量字符串（包括模板字符串字面量部分）
function extractLiteralStrings(expr) {
  const result = [];
  // 双引号/单引号字符串
  const quoteRe = /(["'])(?:\\.|(?!\1)[^\\])*?\1/g;
  let m;
  while ((m = quoteRe.exec(expr)) !== null) {
    result.push(m[0].slice(1, -1));
  }
  // 模板字符串字面量部分（去掉 ${...}）
  const tplRe = /`((?:[^`\\]|\\.|\\\$\{[^}]*\})*)`/g;
  while ((m = tplRe.exec(expr)) !== null) {
    const cleaned = m[1].replace(/\$\{([^}]|\{[^}]*\})*\}/g, ' ');
    result.push(cleaned);
  }
  return result;
}

// 匹配 className 属性
// 支持多行className，使用大括号平衡计数
const classNameRe = /className\s*=\s*/g;
let match;
while ((match = classNameRe.exec(tsx)) !== null) {
  const start = match.index + match[0].length;
  let end = start;
  const char = tsx[start];
  if (char === '"' || char === "'") {
    // 简单字符串属性
    const closeRe = new RegExp(`[${char === '"' ? '"' : "'"}]`, 'g');
    closeRe.lastIndex = start + 1;
    const close = closeRe.exec(tsx);
    if (close) end = close.index + 1;
  } else if (char === '{') {
    // JS 表达式，找匹配的 }
    let depth = 1;
    for (let i = start + 1; i < tsx.length && depth > 0; i++) {
      if (tsx[i] === '{') depth++;
      else if (tsx[i] === '}') depth--;
      end = i + 1;
    }
  }
  const expr = tsx.slice(start, end);
  const literals = extractLiteralStrings(expr);
  for (const lit of literals) {
    lit.split(/\s+/).forEach((token) => {
      const clean = token.trim();
      if (clean) usedClasses.add(clean);
    });
  }
}

// 补充从 TS 联合类型中推断的状态类名（如 StatePanel 的 type）
const typeUnionRe = /type\s*:\s*'([^']+)'(?:\s*\|\s*'([^']+)')*/g;
while ((match = typeUnionRe.exec(tsx)) !== null) {
  const full = match[0];
  const parts = full.match(/'[^']*'/g) ?? [];
  for (const p of parts) usedClasses.add(p.slice(1, -1));
}

// 补充一些全局状态类名
['active', 'paused', 'done', 'current', 'pending', 'planned', 'loading', 'empty', 'error', 'ai-unavailable', 'completed', 'partial', 'accepted', 'rejected', 'confirmed', 'draft', 'archived', 'skipped'].forEach((c) => usedClasses.add(c));

const sorted = [...usedClasses].sort();
console.log(sorted.join('\n'));
console.log(`\nTotal: ${sorted.length}`);
