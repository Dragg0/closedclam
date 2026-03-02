import { createServer, type Server } from 'node:http';
import { URL } from 'node:url';
import { generateCodeVerifier, generateCodeChallenge } from '../utils/crypto.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('oauth');

const AUTHORIZE_URL = 'https://claude.ai/oauth/authorize';
const TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
const CLIENT_ID = '4da270f0-e352-4fa1-baec-27213e9c4832'; // Claude Code client ID
const REDIRECT_URI_BASE = 'http://localhost';

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // unix ms
  scope: string;
}

export interface PKCEPair {
  verifier: string;
  challenge: string;
}

export function generatePKCE(): PKCEPair {
  const verifier = generateCodeVerifier();
  const challenge = generateCodeChallenge(verifier);
  return { verifier, challenge };
}

export function buildAuthorizationURL(pkce: PKCEPair, port: number): string {
  const redirectUri = `${REDIRECT_URI_BASE}:${port}/oauth/callback`;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    scope: 'user:inference',
    state: generateCodeVerifier().slice(0, 16),
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(
  code: string,
  pkceVerifier: string,
  port: number,
): Promise<OAuthTokens> {
  const redirectUri = `${REDIRECT_URI_BASE}:${port}/oauth/callback`;

  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      redirect_uri: redirectUri,
      code_verifier: pkceVerifier,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Token exchange failed (${resp.status}): ${body}`);
  }

  const data = (await resp.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    scope: data.scope || 'user:inference',
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<OAuthTokens> {
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Token refresh failed (${resp.status}): ${body}`);
  }

  const data = (await resp.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    scope: data.scope || 'user:inference',
  };
}

/**
 * Start a temporary local HTTP server to capture the OAuth redirect.
 * Returns a promise that resolves with the authorization code.
 */
export function startCallbackServer(port: number): { url: string; pkce: PKCEPair; waitForCode: Promise<string>; close: () => void } {
  const pkce = generatePKCE();
  const authUrl = buildAuthorizationURL(pkce, port);

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
        res.end(`<html><body><h1>OAuth Error</h1><p>${error}</p></body></html>`);
        rejectCode(new Error(`OAuth error: ${error}`));
        return;
      }

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`<html><body><h1>Missing code</h1></body></html>`);
        rejectCode(new Error('No authorization code received'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body><h1>ClosedClam</h1><p>Authorization successful! You can close this tab.</p></body></html>`);
      resolveCode(code);
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(port, '127.0.0.1', () => {
    log.info(`OAuth callback server listening on port ${port}`);
  });

  return {
    url: authUrl,
    pkce,
    waitForCode,
    close: () => {
      server.close();
    },
  };
}
