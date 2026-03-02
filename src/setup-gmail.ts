import 'dotenv/config';
import { createInterface } from 'node:readline';
import { loadConfig, saveConfig, ensureDataDirs } from './gateway/config.js';
import { startGmailAuth, createOAuth2Client, exchangeGmailCode } from './auth/gmail-oauth.js';
import { saveGmailTokens, getGmailTokens } from './auth/credentials.js';

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

async function main() {
  ensureDataDirs();

  console.log('\n  Gmail Setup for ClosedClam\n');

  // Check if already configured
  const existing = getGmailTokens();
  if (existing) {
    const overwrite = await ask('Gmail tokens already exist. Overwrite? (y/N): ');
    if (overwrite.toLowerCase() !== 'y') {
      console.log('Aborted.');
      rl.close();
      return;
    }
  }

  // Check config for existing client ID/secret
  let config;
  try {
    config = loadConfig();
  } catch {
    console.error('No config found. Run the bot first to complete initial setup.');
    rl.close();
    process.exit(1);
  }

  let clientId = config.providers.gmail.clientId || process.env.GMAIL_CLIENT_ID || '';
  let clientSecret = config.providers.gmail.clientSecret || process.env.GMAIL_CLIENT_SECRET || '';

  if (clientId && clientSecret) {
    console.log(`  Using existing Client ID: ${clientId.slice(0, 20)}...`);
    const useExisting = await ask('  Use these credentials? (Y/n): ');
    if (useExisting.toLowerCase() === 'n') {
      clientId = '';
      clientSecret = '';
    }
  }

  if (!clientId) {
    console.log('  Prerequisites:');
    console.log('    1. Enable Gmail API at console.cloud.google.com');
    console.log('    2. Create OAuth 2.0 credentials (Desktop app)');
    console.log('    3. Add your email as a test user on the consent screen\n');

    clientId = await ask('Gmail OAuth Client ID: ');
    if (!clientId) {
      console.log('Aborted.');
      rl.close();
      return;
    }
    clientSecret = await ask('Gmail OAuth Client Secret: ');
    if (!clientSecret) {
      console.log('Aborted.');
      rl.close();
      return;
    }
  }

  // Save client ID/secret to config
  saveConfig({
    providers: { ...config.providers, gmail: { clientId, clientSecret } },
  });
  console.log('  ✓ Client credentials saved to config\n');

  // Run OAuth flow
  const port = parseInt(process.env.GMAIL_CALLBACK_PORT || '8976', 10);
  console.log('Starting Gmail OAuth flow...');
  const server = startGmailAuth(clientId, clientSecret, port);
  console.log(`\n  Open in your browser:\n  ${server.url}\n`);
  console.log('Waiting for authorization...');

  try {
    const code = await server.waitForCode;
    server.close();
    console.log('Exchanging code for tokens...');
    const oauth2Client = createOAuth2Client(clientId, clientSecret, port);
    const tokens = await exchangeGmailCode(oauth2Client, code);
    saveGmailTokens(tokens);
    console.log('  ✓ Gmail OAuth tokens saved!');
    console.log('\n  Gmail is ready. Restart the bot to activate.\n');
  } catch (err) {
    server.close();
    console.error(`\nGmail OAuth failed: ${err}`);
    console.log('Check your credentials and try again.\n');
  }

  rl.close();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
