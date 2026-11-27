import type {
  AccountSummary,
  AuthStatusResponse,
  AuthVerifyResponse,
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

let inMemoryAuthToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function setAuthToken(token: string | null): void {
  inMemoryAuthToken = token;
}

export function getAuthToken(): string | null {
  return inMemoryAuthToken;
}

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

export class ApiError extends Error {
  status: number;
  remainingAttempts?: number;
  retryAfterSeconds?: number;

  constructor(
    message: string,
    status: number,
    meta?: { remainingAttempts?: number; retryAfterSeconds?: number },
  ) {
    super(message);
    this.status = status;
    this.remainingAttempts = meta?.remainingAttempts;
    this.retryAfterSeconds = meta?.retryAfterSeconds;
  }
}

async function request<T>(
  path: string,
  init?: RequestInit & { skipAuthRedirect?: boolean },
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init?.headers as Record<string, string> | undefined) ?? {}),
  };
  if (inMemoryAuthToken) {
    headers.Authorization = `Bearer ${inMemoryAuthToken}`;
  }

  const res = await fetch(path, {
    ...init,
    headers,
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    remainingAttempts?: number;
    retryAfterSeconds?: number;
  };
  if (!res.ok) {
    if (res.status === 401 && !init?.skipAuthRedirect) {
      inMemoryAuthToken = null;
      unauthorizedHandler?.();
    }
    throw new ApiError(
      data.error || `Request failed (${res.status})`,
      res.status,
      {
        remainingAttempts: data.remainingAttempts,
        retryAfterSeconds: data.retryAfterSeconds,
      },
    );
  }
  return data as T;
}

export const api = {
  getAuthStatus: () =>
    request<AuthStatusResponse>('/api/auth/status', { skipAuthRedirect: true }),
  verifyPin: (pin: string) =>
    request<AuthVerifyResponse>('/api/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ pin }),
      skipAuthRedirect: true,
    }),
  changePin: (currentPin: string, newPin: string) =>
    request<AuthVerifyResponse>('/api/auth/change-pin', {
      method: 'POST',
      body: JSON.stringify({ currentPin, newPin }),
    }),
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
