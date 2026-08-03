import { describe, expect, it } from 'vitest';
import { operationInstruction } from './learning-turn';

describe('操作提示词契约：propose_goal', () => {
  const rules = operationInstruction('propose_goal');

  it('截止日期不是必问项，缺失按"未明确"处理', () => {
    expect(rules).toContain('截止日期不是必问项');
  });

  it('用户说"直接开始"或"使用当前信息生成初步计划"时一律 ready，不得再追问', () => {
    expect(rules).toContain('直接开始');
    expect(rules).toContain('不得再追问');
  });

  it('ready 回复必须一句话确认，不输出路线预览或追加问题', () => {
    expect(rules).toContain('不要输出路线预览');
    expect(rules).toContain('也不要附带追加问题');
  });

  it('不重复问已回答的信息', () => {
    expect(rules).toContain('不要重复问用户已经回答过的信息');
  });

  it('追问一次通过 questions 字段输出 2-4 个问题，不逐条往返', () => {
    expect(rules).toContain('questions');
    expect(rules).toContain('2-4 个最关键的问题');
    expect(rules).toContain('不要逐条往返追问');
  });

  it('ready 时把学习方向写进 brief.direction', () => {
    expect(rules).toContain('brief.direction');
    expect(rules).toContain('不写具体日期');
  });

  it('首次访谈先确认学习深度并写入 brief.depth', () => {
    expect(rules).toContain('brief.depth');
    expect(rules).toContain('从零系统学');
    expect(rules).toContain('快速了解架构');
    expect(rules).toContain('专项深入');
  });
});

describe('操作提示词契约：核心教学工具', () => {
  it('explain 必须回答当前问题并指引返回主线', () => {
    expect(operationInstruction('explain')).toContain('返回原 Action 主线');
  });

  it('evaluate 只评价已持久化的提交，不直接推进 Task', () => {
    const rules = operationInstruction('evaluate');
    expect(rules).toContain('不直接推进 Task');
  });

  it('propose_roadmap 有截止日期时才设置检查点日期', () => {
    expect(operationInstruction('propose_roadmap')).toContain('有截止日期时');
  });

  it('propose_roadmap 对"快速了解架构"目标只生成概览阶段，不插入基础补齐', () => {
    const rules = operationInstruction('propose_roadmap');
    expect(rules).toContain('快速了解架构');
    expect(rules).toContain('1-2 个概览阶段');
    expect(rules).toContain('不插入基础补齐');
    expect(rules).toContain('从零系统学');
  });

  it('reflect 不得按日历连续性或前台窗口推断投入', () => {
    const rules = operationInstruction('reflect');
    expect(rules).toContain('不得按连续天数');
    expect(rules).toContain('不编造统计');
  });
});
