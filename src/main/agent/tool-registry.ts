import type {
  AgentContext,
  AgentContextKind,
  AgentToolDefinition,
  AgentToolExecution,
  AgentToolName
} from './agent-types';

export class ToolRegistry {
  private readonly tools = new Map<AgentToolName, AgentToolDefinition<any, any>>();

  register<TInput, TOutput>(definition: AgentToolDefinition<TInput, TOutput>): void {
    if (this.tools.has(definition.name)) {
      throw new Error(`Agent tool already registered: ${definition.name}`);
    }
    this.tools.set(definition.name, definition);
  }

  listForContext(context: AgentContextKind): AgentToolName[] {
    return [...this.tools.values()]
      .filter((tool) => tool.contexts.includes(context))
      .map((tool) => tool.name);
  }

  async execute<TInput, TOutput>(
    name: AgentToolName,
    input: TInput,
    context: AgentContext
  ): Promise<AgentToolExecution<TOutput>> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown agent tool: ${name}`);
    if (!tool.contexts.includes(context.kind)) {
      throw new Error(`Agent tool ${name} is not mounted for context ${context.kind}`);
    }
    return tool.execute(input, context) as Promise<AgentToolExecution<TOutput>>;
  }
}
