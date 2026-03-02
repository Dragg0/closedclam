import { getOAuthTokens, saveOAuthTokens, getApiKey } from './credentials.js';
import { refreshAccessToken, type OAuthTokens } from './oauth.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('auth-providers');

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes before expiry
const HEALTH_CHECK_INTERVAL_MS = 60 * 1000; // 1 minute

interface ProviderHealth {
  name: string;
  status: 'healthy' | 'degraded' | 'down';
  lastCheck: number;
  lastError?: string;
}

export class AuthProviderManager {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private health: Map<string, ProviderHealth> = new Map();

  constructor() {
    this.startRefreshLoop();
  }

  private startRefreshLoop(): void {
    // Check token expiry every minute
    this.refreshTimer = setInterval(async () => {
      await this.checkAndRefreshTokens();
    }, HEALTH_CHECK_INTERVAL_MS);

    // Initial check
    this.checkAndRefreshTokens();
  }

  private async checkAndRefreshTokens(): Promise<void> {
    const tokens = getOAuthTokens();
    if (!tokens) return;

    const now = Date.now();
    if (now >= tokens.expiresAt - TOKEN_REFRESH_BUFFER_MS) {
      log.info('Proactively refreshing OAuth token...');
      try {
        const newTokens = await refreshAccessToken(tokens.refreshToken);
        saveOAuthTokens(newTokens);
        this.updateHealth('anthropic-oauth', 'healthy');
        log.info('Token proactively refreshed');
      } catch (err) {
        this.updateHealth('anthropic-oauth', 'degraded', String(err));
        log.error('Proactive token refresh failed', { error: String(err) });
      }
    } else {
      this.updateHealth('anthropic-oauth', 'healthy');
    }
  }

  private updateHealth(name: string, status: ProviderHealth['status'], error?: string): void {
    this.health.set(name, {
      name,
      status,
      lastCheck: Date.now(),
      lastError: error,
    });
  }

  /** Get health status of all auth providers */
  getHealth(): ProviderHealth[] {
    const statuses: ProviderHealth[] = [];

    // OAuth status
    const oauthTokens = getOAuthTokens();
    if (oauthTokens) {
      const existing = this.health.get('anthropic-oauth');
      statuses.push(existing || { name: 'anthropic-oauth', status: 'healthy', lastCheck: Date.now() });
    }

    // API key statuses
    for (const provider of ['anthropic', 'deepseek', 'gemini', 'brave'] as const) {
      const key = getApiKey(provider);
      if (key) {
        statuses.push({ name: `${provider}-apikey`, status: 'healthy', lastCheck: Date.now() });
      }
    }

    return statuses;
  }

  /** Check if a specific provider has valid credentials */
  isProviderReady(provider: string): boolean {
    switch (provider) {
      case 'anthropic': {
        const tokens = getOAuthTokens();
        if (tokens && tokens.expiresAt > Date.now()) return true;
        return !!getApiKey('anthropic');
      }
      case 'deepseek':
        return !!getApiKey('deepseek');
      case 'gemini':
        return !!getApiKey('gemini');
      case 'brave':
        return !!getApiKey('brave');
      default:
        return false;
    }
  }

  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
}
