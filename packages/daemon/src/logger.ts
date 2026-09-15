type Level = 'info' | 'warn' | 'error';

/**
 * Plain line logging - launchd redirects stdout/stderr to
 * ~/Library/Logs/claude-notification.log, so there is nothing to rotate here.
 */
function emit(level: Level, message: string): void {
  const line = `${new Date().toISOString()} [${level}] ${message}`;
  if (level === 'error') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const log = {
  info: (m: string) => emit('info', m),
  warn: (m: string) => emit('warn', m),
  error: (m: string) => emit('error', m),
};

/**
 * Warnings repeat every poll by nature (a changed file shape stays changed),
 * which would flood the log at 12 lines a minute. This logs each distinct
 * message once per process.
 */
export class WarnOnce {
  private readonly seen = new Set<string>();

  warn(message: string): void {
    if (this.seen.has(message)) return;
    this.seen.add(message);
    log.warn(message);
  }
}
