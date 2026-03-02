import { z } from 'zod';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import JSON5 from 'json5';

export const DATA_DIR = join(homedir(), '.closedclam');
export const CONFIG_PATH = join(DATA_DIR, 'config.json5');
export const CREDENTIALS_PATH = join(DATA_DIR, 'credentials.json');
export const MEMORY_DIR = join(DATA_DIR, 'memory');
export const SESSIONS_DIR = join(DATA_DIR, 'sessions');
export const SKILLS_DIR = join(DATA_DIR, 'skills');
export const INSTALLED_SKILLS_DIR = join(SKILLS_DIR, 'installed');

const ConfigSchema = z.object({
  telegram: z.object({
    botToken: z.string().min(1),
    allowedUsers: z.array(z.number()).default([]),
    webhookUrl: z.string().optional(),
  }),
  providers: z.object({
    anthropic: z.object({
      authMode: z.enum(['oauth', 'apikey']).default('oauth'),
      model: z.string().default('claude-sonnet-4-20250514'),
      maxTokens: z.number().default(8192),
    }).default({}),
    deepseek: z.object({
      model: z.string().default('deepseek-chat'),
      reasonerModel: z.string().default('deepseek-reasoner'),
      baseUrl: z.string().default('https://api.deepseek.com'),
    }).default({}),
    gemini: z.object({
      model: z.string().default('gemini-2.0-flash-exp'),
      imageModel: z.string().default('gemini-2.0-flash-exp'),
    }).default({}),
  }).default({}),
  defaultProvider: z.string().default('anthropic'),
  defaultModel: z.string().default('claude-haiku-4-5-20251001'),
  agent: z.object({
    maxToolIterations: z.number().default(10),
    compactionThreshold: z.number().default(0.8),
    maxContextTokens: z.number().default(180000),
    sessionTimeoutMinutes: z.number().default(30),
  }).default({}),
  workspace: z.string().default(process.cwd()),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Config = z.infer<typeof ConfigSchema>;

let cachedConfig: Config | null = null;

export function ensureDataDirs() {
  for (const dir of [DATA_DIR, MEMORY_DIR, SESSIONS_DIR, SKILLS_DIR, INSTALLED_SKILLS_DIR]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

export function loadConfig(): Config {
  if (cachedConfig) return cachedConfig;

  ensureDataDirs();

  let raw: Record<string, unknown> = {};

  if (existsSync(CONFIG_PATH)) {
    const text = readFileSync(CONFIG_PATH, 'utf-8');
    raw = JSON5.parse(text);
  }

  // Apply env var overrides
  if (process.env.TELEGRAM_BOT_TOKEN) {
    raw.telegram = {
      ...(raw.telegram as Record<string, unknown> || {}),
      botToken: process.env.TELEGRAM_BOT_TOKEN,
    };
  }
  if (process.env.TELEGRAM_ALLOWED_USERS) {
    const users = process.env.TELEGRAM_ALLOWED_USERS.split(',').map(Number).filter(Boolean);
    raw.telegram = {
      ...(raw.telegram as Record<string, unknown> || {}),
      allowedUsers: users,
    };
  }
  if (process.env.WORKSPACE_ROOT) {
    raw.workspace = process.env.WORKSPACE_ROOT;
  }
  if (process.env.LOG_LEVEL) {
    raw.logLevel = process.env.LOG_LEVEL;
  }

  cachedConfig = ConfigSchema.parse(raw);
  return cachedConfig;
}

export function saveConfig(config: Partial<Record<string, unknown>>) {
  ensureDataDirs();
  let existing: Record<string, unknown> = {};
  if (existsSync(CONFIG_PATH)) {
    existing = JSON5.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  }
  const merged = { ...existing, ...config };
  writeFileSync(CONFIG_PATH, JSON5.stringify(merged, null, 2), 'utf-8');
  cachedConfig = null; // bust cache
}

export function configExists(): boolean {
  return existsSync(CONFIG_PATH);
}

export function resetConfigCache() {
  cachedConfig = null;
}
