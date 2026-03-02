import { createServer, type Server } from 'node:http';
import { URL } from 'node:url';
import { google } from 'googleapis';
import { createLogger } from '../utils/logger.js';

const log = createLogger('gmail-oauth');

const REDIRECT_URI_BASE = 'http://localhost';
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
];

export interface GmailTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // unix ms
  scope: string;
}

export function createOAuth2Client(clientId: string, clientSecret: string, port: number) {
  const redirectUri = `${REDIRECT_URI_BASE}:${port}/oauth/callback`;
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function buildGmailAuthURL(client: InstanceType<typeof google.auth.OAuth2>): string {
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });
}

export async function exchangeGmailCode(
  client: InstanceType<typeof google.auth.OAuth2>,
  code: string,
): Promise<GmailTokens> {
  const { tokens } = await client.getToken(code);

  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error('Missing access_token or refresh_token in response');
  }

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: tokens.expiry_date || Date.now() + 3600 * 1000,
    scope: tokens.scope || SCOPES.join(' '),
  };
}

export async function refreshGmailToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<GmailTokens> {
  const client = new google.auth.OAuth2(clientId, clientSecret);
  client.setCredentials({ refresh_token: refreshToken });

  const { credentials } = await client.refreshAccessToken();

  return {
    accessToken: credentials.access_token!,
    refreshToken: credentials.refresh_token || refreshToken,
    expiresAt: credentials.expiry_date || Date.now() + 3600 * 1000,
    scope: credentials.scope || SCOPES.join(' '),
  };
}

/**
 * Start a temporary local HTTP server to capture the Gmail OAuth redirect.
 */
export function startGmailAuth(
  clientId: string,
  clientSecret: string,
  port: number,
): { url: string; waitForCode: Promise<string>; close: () => void } {
  const oauth2Client = createOAuth2Client(clientId, clientSecret, port);
  const authUrl = buildGmailAuthURL(oauth2Client);

  let server: Server;
  let resolveCode: (code: string) => void;
  let rejectCode: (err: Error) => void;

  const waitForCode = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  server = createServer((req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`);

    if (url.pathname === '/oauth/callback') {
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`<html><body><h1>Gmail OAuth Error</h1><p>${error}</p></body></html>`);
        rejectCode(new Error(`Gmail OAuth error: ${error}`));
        return;
      }

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`<html><body><h1>Missing code</h1></body></html>`);
        rejectCode(new Error('No authorization code received'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body><h1>ClosedClam</h1><p>Gmail authorization successful! You can close this tab.</p></body></html>`);
      resolveCode(code);
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(port, '127.0.0.1', () => {
    log.info(`Gmail OAuth callback server listening on port ${port}`);
  });

  return {
    url: authUrl,
    waitForCode,
    close: () => {
      server.close();
    },
  };
}
