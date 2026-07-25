import type {
  AgentContext,
  AgentContextKind,
  AgentToolDefinition,
  AgentToolExecution,
  AgentToolExecutionContext,
  AgentToolName,
  MountedAgentTool
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

  describeForContext(context: AgentContextKind, allowedTools?: readonly AgentToolName[]): MountedAgentTool[] {
    const allowed = allowedTools ? new Set(allowedTools) : null;
    return [...this.tools.values()]
      .filter((tool) => tool.contexts.includes(context) && (!allowed || allowed.has(tool.name)))
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputDescription: tool.inputDescription ?? 'JSON object',
        effect: tool.effect ?? 'content'
      }));
  }

  get(name: AgentToolName): AgentToolDefinition<any, any> | null {
    return this.tools.get(name) ?? null;
  }

  async execute<TInput, TOutput>(
    name: AgentToolName,
    input: TInput,
    context: AgentToolExecutionContext
  ): Promise<AgentToolExecution<TOutput>> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown agent tool: ${name}`);
    if (!tool.contexts.includes(context.kind)) {
      throw new Error(`Agent tool ${name} is not mounted for context ${context.kind}`);
    }
    const validatedInput = tool.inputSchema ? tool.inputSchema.parse(input) : input;
    const execution = await tool.execute(validatedInput, context);
    const validatedOutput = tool.outputSchema
      ? tool.outputSchema.parse(execution.output)
      : execution.output;
    return {
      ...execution,
      output: validatedOutput
    } as AgentToolExecution<TOutput>;
  }
}
