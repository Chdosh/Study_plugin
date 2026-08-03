import { z } from 'zod';

export function describeZodSchema(schema: z.ZodTypeAny): string {
  const lines: string[] = [];
  emitSchema(schema, lines, 0);
  return lines.join('\n');
}

function emitSchema(schema: z.ZodTypeAny, lines: string[], depth: number): void {
  const unwrapped = unwrapWrapper(schema);
  if (unwrapped !== schema) {
    emitSchema(unwrapped, lines, depth);
    return;
  }
  if (schema instanceof z.ZodUnion) {
    for (const [index, option] of schema.options.entries()) {
      lines.push(`${'  '.repeat(depth)}${index === 0 ? '分支（二选一，只能选一个分支的字段）：' : '或分支：'}`);
      emitSchema(option, lines, depth + 1);
    }
    return;
  }
  if (schema instanceof z.ZodObject) {
    for (const [key, value] of Object.entries(schema.shape as Record<string, z.ZodTypeAny>)) {
      const required = !(value instanceof z.ZodDefault || value.isOptional());
      emitField(key, value, required, lines, depth);
    }
  } else {
    lines.push(`${'  '.repeat(depth)}${typeLabel(schema)}`);
  }
}

function emitField(
  key: string,
  schema: z.ZodTypeAny,
  required: boolean,
  lines: string[],
  depth: number
): void {
  const indent = '  '.repeat(depth);
  if (schema instanceof z.ZodObject) {
    lines.push(`${indent}${key}: 对象${required ? '(必填)' : '(可选)'} {`);
    emitSchema(schema, lines, depth + 1);
    lines.push(`${indent}}`);
    return;
  }
  if (schema instanceof z.ZodArray && schema.element instanceof z.ZodObject) {
    lines.push(`${indent}${key}: 数组${required ? '(必填)' : '(可选)'} [{`);
    emitSchema(schema.element, lines, depth + 1);
    lines.push(`${indent}}]`);
    return;
  }
  lines.push(`${indent}${key}: ${typeLabel(schema)}${required ? '(必填)' : '(可选)'}`);
}

function typeLabel(schema: z.ZodTypeAny): string {
  const inner = unwrapWrapper(schema);
  if (inner !== schema) return typeLabel(inner);
  if (schema instanceof z.ZodArray) return `数组[${typeLabel(schema.element)}]`;
  if (schema instanceof z.ZodUnion) return schema.options.map(typeLabel).join(' 或 ');
  if (schema instanceof z.ZodEnum) return `枚举(${schema.options.join('|')})`;
  if (schema instanceof z.ZodString) return hasMinLength(schema) ? '非空字符串' : '字符串';
  if (schema instanceof z.ZodNumber) return '数字';
  if (schema instanceof z.ZodBoolean) return '布尔';
  if (schema instanceof z.ZodLiteral) return `常量(${String(schema.value)})`;
  if (schema instanceof z.ZodRecord) return '对象(任意键)';
  if (schema instanceof z.ZodObject) return '对象';
  return 'unknown';
}

function unwrapWrapper(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodEffects) return schema.innerType();
  if (schema instanceof z.ZodDefault) return schema._def.innerType ?? schema;
  if (schema instanceof z.ZodOptional) return schema._def.innerType ?? schema;
  if (schema instanceof z.ZodNullable) return schema._def.innerType ?? schema;
  return schema;
}

function hasMinLength(schema: z.ZodString): boolean {
  const def = (schema as unknown as {
    _def?: { checks?: Array<{ kind?: string; value?: unknown }> };
  })._def;
  const checks = def?.checks ?? [];
  return checks.some((check) => check.kind === 'min' && typeof check.value === 'number' && check.value >= 1);
}
