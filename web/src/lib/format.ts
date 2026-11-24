export function fmtPrice(val: number): string {
  if (!Number.isFinite(val)) return '—';
  if (val === 0) return '0.00';
  if (val >= 1000) return val.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
  if (val >= 10) return val.toFixed(3);
  if (val >= 0.1) return val.toFixed(4);
  return val.toFixed(6);
}

export function fmtUsdt(val: number, signed = false): string {
  if (!Number.isFinite(val)) return '—';
  const abs = Math.abs(val).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (signed) {
    return `${val >= 0 ? '+' : '-'}$${abs}`;
  }
  return `${val < 0 ? '-' : ''}$${abs}`;
}

export function fmtCompactUsd(val: number): string {
  if (!Number.isFinite(val)) return '—';
  if (val >= 1_000_000_000) return `$${(val / 1_000_000_000).toFixed(2)}B`;
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
}

export function fmtPct(val: number, signed = true): string {
  if (!Number.isFinite(val)) return '—';
  const sign = signed && val > 0 ? '+' : '';
  return `${sign}${val.toFixed(2)}%`;
}

export function fmtTimeAgo(tsMs: number | null | undefined): string {
  if (!tsMs) return 'Never';
  const diffSec = Math.max(0, Math.floor((Date.now() - tsMs) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

export function fmtClock(tsMs: number): string {
  return new Date(tsMs).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
