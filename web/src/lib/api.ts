import type {
  AccountSummary,
  BacktestRequest,
  BacktestResult,
  BotStatus,
  CandleChartResponse,
  DashboardSnapshot,
  NewsItem,
  Position,
  ScannerCandidate,
  SettingsUpdatePayload,
  SettingsView,
  Timeframe,
  TradeSignal,
} from '@bot/shared';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  getDashboard: () => request<DashboardSnapshot>('/api/dashboard'),
  getCandles: (symbol: string, interval: Timeframe = '15m', limit = 200) =>
    request<CandleChartResponse>(
      `/api/candles/${encodeURIComponent(symbol)}?interval=${interval}&limit=${limit}`,
    ),
  startBot: () => request<{ status: BotStatus }>('/api/bot/start', { method: 'POST' }),
  pauseBot: () => request<{ status: BotStatus }>('/api/bot/pause', { method: 'POST' }),
  triggerKillSwitch: () =>
    request<DashboardSnapshot>('/api/bot/kill-switch', { method: 'POST' }),
  runScanner: () =>
    request<{ scanner: ScannerCandidate[]; signals: TradeSignal[] }>(
      '/api/scanner/run',
      { method: 'POST' },
    ),
  refreshNews: () =>
    request<{ news: NewsItem[] }>('/api/news/refresh', { method: 'POST' }),
  closePosition: (id: string) =>
    request<{ position: Position }>(`/api/positions/${encodeURIComponent(id)}/close`, {
      method: 'POST',
    }),
  resetPaper: (balance: number) =>
    request<{ account: AccountSummary }>('/api/paper/reset', {
      method: 'POST',
      body: JSON.stringify({ balance }),
    }),
  runBacktest: (payload: BacktestRequest) =>
    request<BacktestResult>('/api/backtest/run', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateSettings: (payload: SettingsUpdatePayload) =>
    request<SettingsView>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
};
