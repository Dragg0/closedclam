import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { hostname } from 'node:os';
import { CREDENTIALS_PATH, ensureDataDirs } from '../gateway/config.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import { createLogger } from '../utils/logger.js';
import type { OAuthTokens } from './oauth.js';
import type { GmailTokens } from './gmail-oauth.js';

const log = createLogger('credentials');

// Derive an encryption password from machine identity (not high security, but protects at rest)
const MACHINE_KEY = `closedclam-${hostname()}-${process.env.USER || 'default'}`;

export interface StoredCredentials {
  anthropic?: {
    oauth?: OAuthTokens;
    apiKey?: string;
  };
  deepseek?: {
    apiKey?: string;
  };
  gemini?: {
    apiKey?: string;
  };
  brave?: {
    apiKey?: string;
  };
  gmail?: {
    oauth?: GmailTokens;
  };
}

function readStore(): StoredCredentials {
  if (!existsSync(CREDENTIALS_PATH)) return {};
  try {
    const raw = readFileSync(CREDENTIALS_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed._encrypted) {
      const decrypted = decrypt(parsed.data, MACHINE_KEY);
      return JSON.parse(decrypted);
    }
    return parsed;
  } catch (err) {
    log.warn('Failed to read credentials, returning empty', { error: String(err) });
    return {};
  }
}

function writeStore(creds: StoredCredentials) {
  ensureDataDirs();
  const data = encrypt(JSON.stringify(creds), MACHINE_KEY);
  writeFileSync(CREDENTIALS_PATH, JSON.stringify({ _encrypted: true, data }), 'utf-8');
  try {
    chmodSync(CREDENTIALS_PATH, 0o600);
  } catch {
    // Windows may not support chmod
  }
}

export function getCredentials(): StoredCredentials {
  return readStore();
}

export function getOAuthTokens(): OAuthTokens | undefined {
  const creds = readStore();
  return creds.anthropic?.oauth;
}

export function saveOAuthTokens(tokens: OAuthTokens) {
  const creds = readStore();
  creds.anthropic = { ...creds.anthropic, oauth: tokens };
  writeStore(creds);
  log.info('OAuth tokens saved');
}

export function getApiKey(provider: 'anthropic' | 'deepseek' | 'gemini' | 'brave'): string | undefined {
  // Check env vars first
  const envMap: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
    gemini: 'GOOGLE_AI_API_KEY',
    brave: 'BRAVE_API_KEY',
  };

  const envKey = process.env[envMap[provider]];
  if (envKey) return envKey;

  const creds = readStore();
  switch (provider) {
    case 'anthropic': return creds.anthropic?.apiKey;
    case 'deepseek': return creds.deepseek?.apiKey;
    case 'gemini': return creds.gemini?.apiKey;
    case 'brave': return creds.brave?.apiKey;
  }
}

export function saveApiKey(provider: 'anthropic' | 'deepseek' | 'gemini' | 'brave', apiKey: string) {
  const creds = readStore();
  switch (provider) {
    case 'anthropic':
      creds.anthropic = { ...creds.anthropic, apiKey };
      break;
    case 'deepseek':
      creds.deepseek = { apiKey };
      break;
    case 'gemini':
      creds.gemini = { apiKey };
      break;
    case 'brave':
      creds.brave = { apiKey };
      break;
  }
  writeStore(creds);
  log.info(`API key saved for ${provider}`);
}

export function getGmailTokens(): GmailTokens | undefined {
  const creds = readStore();
  return creds.gmail?.oauth;
}

export function saveGmailTokens(tokens: GmailTokens) {
  const creds = readStore();
  creds.gmail = { ...creds.gmail, oauth: tokens };
  writeStore(creds);
  log.info('Gmail tokens saved');
}

export function clearCredentials() {
  writeStore({});
  log.info('All credentials cleared');
}
