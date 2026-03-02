type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[currentLevel];
}

function formatEntry(level: LogLevel, module: string, message: string, data?: Record<string, unknown>) {
  return JSON.stringify({
    ts: new Date().toISOString(),
    level,
    module,
    msg: message,
    ...data,
  });
}

export function setLogLevel(level: LogLevel) {
  currentLevel = level;
}

export function createLogger(module: string) {
  return {
    debug(msg: string, data?: Record<string, unknown>) {
      if (shouldLog('debug')) console.debug(formatEntry('debug', module, msg, data));
    },
    info(msg: string, data?: Record<string, unknown>) {
      if (shouldLog('info')) console.info(formatEntry('info', module, msg, data));
    },
    warn(msg: string, data?: Record<string, unknown>) {
      if (shouldLog('warn')) console.warn(formatEntry('warn', module, msg, data));
    },
    error(msg: string, data?: Record<string, unknown>) {
      if (shouldLog('error')) console.error(formatEntry('error', module, msg, data));
    },
  };
}
