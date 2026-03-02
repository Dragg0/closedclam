export interface ToolContext {
  sessionKey: string;
  workspace: string;
}

export interface ToolOutput {
  content: string;
  isError?: boolean;
  image?: {
    buffer: Buffer;
    mimeType: string;
    caption?: string;
  };
  document?: {
    buffer: Buffer;
    mimeType: string;
    fileName: string;
    caption?: string;
  };
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Whether this tool requires user approval before execution */
  requiresApproval?: boolean;
  /** Execute the tool with the given input */
  execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutput>;
}
