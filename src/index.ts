import 'dotenv/config';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { configExists, saveConfig, loadConfig, ensureDataDirs, MEMORY_DIR } from './gateway/config.js';
import { startCallbackServer, exchangeCodeForTokens } from './auth/oauth.js';
import { saveOAuthTokens, saveApiKey, getOAuthTokens, getApiKey, saveGmailTokens } from './auth/credentials.js';
import { startGmailAuth, createOAuth2Client, exchangeGmailCode } from './auth/gmail-oauth.js';
import { Gateway } from './gateway/server.js';
import { setLogLevel } from './utils/logger.js';
import { join } from 'node:path';

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

async function onboarding(): Promise<void> {
  console.log(`
  ┌─────────────────────────────┐
  │   🐚 ClosedClam v0.1.0     │
  │   Personal AI Agent         │
  └─────────────────────────────┘
  `);
  console.log('First-run setup. You\'ll need:\n');
  console.log('  1. A Telegram Bot Token (from @BotFather)');
  console.log('  2. Anthropic auth (OAuth or API key)');
  console.log('  3. (Optional) DeepSeek, Gemini, Brave API keys\n');

  // Step 1: Telegram
  const botToken = await ask('Telegram Bot Token: ');
  if (!botToken) {
    console.error('Bot token is required. Exiting.');
    process.exit(1);
  }

  const userIdStr = await ask('Your Telegram User ID (comma-separated, Enter to allow all): ');
  const allowedUsers = userIdStr ? userIdStr.split(',').map(Number).filter(Boolean) : [];
  if (allowedUsers.length === 0) {
    console.log('  ⚠️  No user restriction set. Anyone can message your bot.');
  }

  // Step 2: Anthropic auth
  console.log('\nAnthropic Authentication:');
  console.log('  1. OAuth (Claude Pro/Max subscription auth)');
  console.log('  2. API Key (standard billing)');
  const authChoice = await ask('Choose (1 or 2): ');

  let authMode: 'oauth' | 'apikey' = 'oauth';

  if (authChoice !== '2') {
    // OAuth flow
    const port = parseInt(process.env.OAUTH_CALLBACK_PORT || '8976', 10);
    console.log('\nStarting OAuth flow...');
    const server = startCallbackServer(port);
    console.log(`\n  Open in your browser:\n  ${server.url}\n`);
    console.log('Waiting for authorization...');

    try {
      const code = await server.waitForCode;
      server.close();
      console.log('Exchanging code for tokens...');
      const tokens = await exchangeCodeForTokens(code, server.pkce.verifier, port);
      saveOAuthTokens(tokens);
      console.log('  ✓ OAuth tokens saved!\n');
      authMode = 'oauth';
    } catch (err) {
      server.close();
      console.error(`\nOAuth failed: ${err}`);
      console.log('Falling back to API key.\n');
      authMode = 'apikey';
      const apiKey = await ask('Anthropic API Key: ');
      if (apiKey) {
        saveApiKey('anthropic', apiKey);
        console.log('  ✓ API key saved!\n');
      }
    }
  } else {
    authMode = 'apikey';
    const apiKey = await ask('Anthropic API Key: ');
    if (apiKey) {
      saveApiKey('anthropic', apiKey);
      console.log('  ✓ API key saved!\n');
    }
  }

  // Step 3: Optional providers
  console.log('Optional providers (Enter to skip):\n');

  const dsKey = await ask('DeepSeek API Key (for deep research): ');
  if (dsKey) { saveApiKey('deepseek', dsKey); console.log('  ✓ Saved'); }

  const geminiKey = await ask('Google AI API Key (for image generation): ');
  if (geminiKey) { saveApiKey('gemini', geminiKey); console.log('  ✓ Saved'); }

  const braveKey = await ask('Brave Search API Key (for web search): ');
  if (braveKey) { saveApiKey('brave', braveKey); console.log('  ✓ Saved'); }

  // Step 4: Gmail integration
  console.log('\nGmail Integration (Enter to skip):');
  console.log('  Requires a Google Cloud project with Gmail API enabled.');
  console.log('  Create OAuth 2.0 credentials (Desktop app) at console.cloud.google.com\n');

  const gmailClientId = await ask('Gmail OAuth Client ID: ');
  const gmailClientSecret = gmailClientId ? await ask('Gmail OAuth Client Secret: ') : '';

  let gmailConfig: { clientId?: string; clientSecret?: string } = {};

  if (gmailClientId && gmailClientSecret) {
    gmailConfig = { clientId: gmailClientId, clientSecret: gmailClientSecret };

    const gmailPort = parseInt(process.env.GMAIL_CALLBACK_PORT || '8976', 10);
    console.log('\nStarting Gmail OAuth flow...');
    const gmailServer = startGmailAuth(gmailClientId, gmailClientSecret, gmailPort);
    console.log(`\n  Open in your browser:\n  ${gmailServer.url}\n`);
    console.log('Waiting for Gmail authorization...');

    try {
      const gmailCode = await gmailServer.waitForCode;
      gmailServer.close();
      console.log('Exchanging code for Gmail tokens...');
      const oauth2Client = createOAuth2Client(gmailClientId, gmailClientSecret, gmailPort);
      const gmailTokens = await exchangeGmailCode(oauth2Client, gmailCode);
      saveGmailTokens(gmailTokens);
      console.log('  ✓ Gmail OAuth tokens saved!\n');
    } catch (err) {
      gmailServer.close();
      console.error(`\nGmail OAuth failed: ${err}`);
      console.log('You can set up Gmail later by re-running setup.\n');
    }
  }

  // Save config
  saveConfig({
    telegram: { botToken, allowedUsers },
    providers: { anthropic: { authMode }, gmail: gmailConfig },
  });

  // Initialize MEMORY.md
  const memFile = join(MEMORY_DIR, 'MEMORY.md');
  if (!existsSync(memFile)) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(memFile, '# Long-Term Memory\n\n', 'utf-8');
  }

  console.log('\n  ✓ Configuration saved!');
  console.log('  Starting ClosedClam...\n');
}

async function main(): Promise<void> {
  ensureDataDirs();

  // First-run detection
  const hasEnvConfig = !!process.env.TELEGRAM_BOT_TOKEN;
  if (!configExists() && !hasEnvConfig) {
    await onboarding();
    rl.close();
  } else {
    rl.close();
  }

  // Verify we have minimum config
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error('Invalid configuration:', err);
    console.log('Delete ~/.closedclam/config.json5 and restart to re-run setup.');
    process.exit(1);
  }

  setLogLevel(config.logLevel);

  // Verify credentials exist
  const hasOAuth = !!getOAuthTokens();
  const hasApiKey = !!getApiKey('anthropic');
  if (!hasOAuth && !hasApiKey) {
    console.error('No Anthropic credentials found.');
    console.log('Set ANTHROPIC_API_KEY env var or delete ~/.closedclam/ to re-run setup.');
    process.exit(1);
  }

  // Start the gateway
  console.log('🐚 Starting ClosedClam...');
  const gateway = new Gateway();

  try {
    await gateway.start();
  } catch (err) {
    console.error('Failed to start:', err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
