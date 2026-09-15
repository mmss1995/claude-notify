export const colors = {
  bg: '#0b0f14',
  card: '#151b23',
  cardAlt: '#1b222c',
  border: '#232c38',
  text: '#e6edf3',
  textDim: '#8b98a5',
  accent: '#58a6ff',
  danger: '#f85149',
  warn: '#d29922',
} as const;

/** Maps a session status to its pill colour. Unknown statuses stay neutral. */
export function statusColor(status: string): string {
  switch (status) {
    case 'waiting':
      return '#d29922';
    case 'busy':
      return '#58a6ff';
    case 'idle':
      return '#3fb950';
    default:
      return '#8b98a5';
  }
}

export function statusLabel(status: string): string {
  switch (status) {
    case 'waiting':
      return 'NEEDS YOU';
    case 'busy':
      return 'WORKING';
    case 'idle':
      return 'IDLE';
    default:
      return status.toUpperCase();
  }
}

export function age(from: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - from) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}
