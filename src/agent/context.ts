import type { MemoryManager } from '../memory/manager.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('context');

const BASE_SYSTEM_PROMPT = `You are ClosedClam, a personal AI assistant. You are helpful, direct, and highly capable.

Core behaviors:
- Use tools proactively when they would help answer the user's question
- Be concise unless asked for detail
- Remember information the user shares using the memory_write tool
- When asked about past conversations or preferences, use memory_search first

Available capabilities:
- Execute shell commands (exec)
- Read, write, and edit files (read_file, write_file, edit_file)
- Search the web (web_search) and fetch URLs (web_fetch)
- Generate images (generate_image) when asked
- Conduct deep research (deep_research) for complex topics
- Manage your own memories (memory_search, memory_write)
- Install and manage skills (search_skills, install_skill, list_skills, create_skill)

Today's date: ${new Date().toISOString().slice(0, 10)}`;

export class ContextBuilder {
  private memory: MemoryManager | null = null;
  private skillInjector: { getActiveSkillsPrompt(): string } | null = null;

  setMemory(memory: MemoryManager): void {
    this.memory = memory;
  }

  setSkillInjector(injector: { getActiveSkillsPrompt(): string }): void {
    this.skillInjector = injector;
  }

  async buildSystemPrompt(_sessionKey: string): Promise<string> {
    let prompt = BASE_SYSTEM_PROMPT;

    // Inject memory context
    if (this.memory) {
      const memoryBlock = this.memory.getContextBlock();
      if (memoryBlock) {
        prompt += `\n\n## Your Memories\n\n${memoryBlock}`;
      }
    }

    // Inject active skill instructions
    if (this.skillInjector) {
      const skillBlock = this.skillInjector.getActiveSkillsPrompt();
      if (skillBlock) {
        prompt += `\n\n## Active Skills\n\n${skillBlock}`;
      }
    }

    return prompt;
  }
}
