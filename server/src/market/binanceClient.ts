import { createHmac } from 'node:crypto';
import type {
  Candle,
  MarketTicker,
  SymbolFilter,
  Timeframe,
  TradingMode,
} from '@bot/shared';

export interface BinanceClientConfig {
  mode: TradingMode;
  apiKey?: string;
  apiSecret?: string;
  fapiBaseUrl?: string;
}

export interface BinanceOrderResult {
  orderId: string;
  clientOrderId: string;
  symbol: string;
  status: string;
  avgPrice: number;
  executedQty: number;
}

export interface BinanceAccountInfo {
  totalWalletBalance: number;
  availableBalance: number;
  totalUnrealizedProfit: number;
  totalMarginBalance: number;
}

export interface BinanceExchangePosition {
  symbol: string;
  positionAmt: number;
  entryPrice: number;
  markPrice: number;
  unRealizedProfit: number;
  liquidationPrice: number;
  leverage: number;
  isolatedMargin: number;
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const VISION_BASE_URL = 'https://data-api.binance.vision';
const TESTNET_FAPI_URL = 'https://testnet.binancefuture.com';
const LIVE_FAPI_URL = 'https://fapi.binance.com';

const KLINE_TTL_MS: Record<Timeframe, number> = {
  '5m': 20_000,
  '15m': 45_000,
  '1h': 120_000,
  '4h': 300_000,
};

function mapThousandSymbol(symbol: string): { spotSymbol: string; scale: number } {
  if (symbol.startsWith('1000') && symbol.endsWith('USDT')) {
    return { spotSymbol: symbol.slice(4), scale: 1000 };
  }
  if (symbol.startsWith('1MBABYDOGE')) {
    return { spotSymbol: symbol.slice(2), scale: 1_000_000 };
  }
  return { spotSymbol: symbol, scale: 1 };
}

function parseKlineArray(raw: unknown[][], scale = 1): Candle[] {
  return raw.map((row) => ({
    openTime: Number(row[0]),
    open: Number(row[1]) * scale,
    high: Number(row[2]) * scale,
    low: Number(row[3]) * scale,
    close: Number(row[4]) * scale,
    volume: Number(row[5]) / scale,
    closeTime: Number(row[6]),
    quoteVolume: Number(row[7] ?? 0),
  }));
}

export class BinanceFuturesClient {
  private mode: TradingMode;
  private apiKey: string;
  private apiSecret: string;
  private customFapiUrl: string;
  private timeOffsetMs = 0;
  private lastTimeSyncAt = 0;

  private futuresKlinesBannedUntil = 0;
  private exchangeFiltersCache: CacheEntry<Map<string, SymbolFilter>> | null = null;
  private klinesCache = new Map<string, CacheEntry<Candle[]>>();

  constructor(config: BinanceClientConfig) {
    this.mode = config.mode;
    this.apiKey = config.apiKey ?? '';
    this.apiSecret = config.apiSecret ?? '';
    this.customFapiUrl = config.fapiBaseUrl ?? '';
  }

  updateConfig(config: Partial<BinanceClientConfig>): void {
    if (config.mode !== undefined) this.mode = config.mode;
    if (config.apiKey !== undefined) this.apiKey = config.apiKey;
    if (config.apiSecret !== undefined) this.apiSecret = config.apiSecret;
    if (config.fapiBaseUrl !== undefined) this.customFapiUrl = config.fapiBaseUrl;
  }

  getFapiBaseUrl(): string {
    if (this.customFapiUrl.trim()) {
      return this.customFapiUrl.trim().replace(/\/+$/, '');
    }
    if (this.mode === 'LIVE') return LIVE_FAPI_URL;
    return TESTNET_FAPI_URL;
  }

  isKlinesFallbackActive(): boolean {
    return Date.now() < this.futuresKlinesBannedUntil;
  }

  private async fetchJson<T>(
    url: string,
    init?: RequestInit & { timeoutMs?: number },
  ): Promise<{ ok: boolean; status: number; data: T | null; text: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), init?.timeoutMs ?? 8000);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      const text = await res.text();
      if (!res.ok) {
        return { ok: false, status: res.status, data: null, text };
      }
      return { ok: true, status: res.status, data: JSON.parse(text) as T, text };
    } catch (err) {
      return {
        ok: false,
        status: 0,
        data: null,
        text: err instanceof Error ? err.message : String(err),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async syncServerTime(): Promise<void> {
    if (Date.now() - this.lastTimeSyncAt < 60_000) return;
    const base = this.getFapiBaseUrl();
    const res = await this.fetchJson<{ serverTime: number }>(`${base}/fapi/v1/time`, {
      timeoutMs: 5000,
    });
    if (res.ok && res.data?.serverTime) {
      this.timeOffsetMs = res.data.serverTime - Date.now();
      this.lastTimeSyncAt = Date.now();
    }
  }

  private signParams(params: Record<string, string | number | boolean | undefined>): string {
    const entries = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => [k, String(v)] as const);
    entries.push(['timestamp', String(Date.now() + this.timeOffsetMs)]);
    entries.push(['recvWindow', '5000']);

    const query = new URLSearchParams(entries as unknown as [string, string][]).toString();
    const signature = createHmac('sha256', this.apiSecret)
      .update(query)
      .digest('hex');
    return `${query}&signature=${signature}`;
  }

  private async signedRequest<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    params: Record<string, string | number | boolean | undefined> = {},
  ): Promise<T> {
    if (!this.apiKey || !this.apiSecret) {
      throw new Error('Binance API key and secret are required for signed Futures requests');
    }
    await this.syncServerTime();
    const qs = this.signParams(params);
    const url = `${this.getFapiBaseUrl()}${path}?${qs}`;
    const res = await this.fetchJson<T>(url, {
      method,
      headers: {
        'X-MBX-APIKEY': this.apiKey,
        'Content-Type': 'application/json',
      },
      timeoutMs: 10_000,
    });

    if (!res.ok || res.data === null) {
      throw new Error(`Binance API ${method} ${path} failed (${res.status}): ${res.text}`);
    }
    return res.data;
  }

  /**
   * Loads USDT-M perpetual symbol precision rules (tickSize, stepSize, minNotional).
   */
  async getExchangeFilters(): Promise<Map<string, SymbolFilter>> {
    if (
      this.exchangeFiltersCache &&
      Date.now() < this.exchangeFiltersCache.expiresAt
    ) {
      return this.exchangeFiltersCache.data;
    }

    const base = this.getFapiBaseUrl();
    const res = await this.fetchJson<{
      symbols: Array<{
        symbol: string;
        status: string;
        contractType: string;
        quoteAsset: string;
        baseAsset: string;
        pricePrecision: number;
        quantityPrecision: number;
        filters: Array<Record<string, string>>;
      }>;
    }>(`${base}/fapi/v1/exchangeInfo`, { timeoutMs: 10_000 });

    if (!res.ok || !res.data?.symbols) {
      if (this.exchangeFiltersCache) return this.exchangeFiltersCache.data;
      return new Map();
    }

    const map = new Map<string, SymbolFilter>();
    for (const sym of res.data.symbols) {
      if (
        sym.status !== 'TRADING' ||
        sym.contractType !== 'PERPETUAL' ||
        sym.quoteAsset !== 'USDT'
      ) {
        continue;
      }
      const priceFilter = sym.filters.find((f) => f.filterType === 'PRICE_FILTER');
      const lotFilter = sym.filters.find((f) => f.filterType === 'LOT_SIZE');
      const minNotionalFilter = sym.filters.find(
        (f) => f.filterType === 'MIN_NOTIONAL',
      );

      map.set(sym.symbol, {
        symbol: sym.symbol,
        baseAsset: sym.baseAsset,
        quoteAsset: sym.quoteAsset,
        pricePrecision: Number(sym.pricePrecision ?? 2),
        quantityPrecision: Number(sym.quantityPrecision ?? 3),
        tickSize: Number(priceFilter?.tickSize ?? 0.01),
        stepSize: Number(lotFilter?.stepSize ?? 0.001),
        minQty: Number(lotFilter?.minQty ?? 0.001),
        maxQty: Number(lotFilter?.maxQty ?? 100_000),
        minNotional: Number(minNotionalFilter?.notional ?? 5),
        maxLeverage: 50,
      });
    }

    this.exchangeFiltersCache = {
      data: map,
      expiresAt: Date.now() + 6 * 3_600_000,
    };
    return map;
  }

  getDefaultFilter(symbol: string, lastPrice: number): SymbolFilter {
    const tickSize = lastPrice >= 1000 ? 0.1 : lastPrice >= 10 ? 0.01 : 0.0001;
    const stepSize = lastPrice >= 1000 ? 0.001 : lastPrice >= 10 ? 0.1 : 1;
    return {
      symbol,
      baseAsset: symbol.replace(/USDT$/, ''),
      quoteAsset: 'USDT',
      pricePrecision: lastPrice >= 1000 ? 1 : lastPrice >= 10 ? 2 : 4,
      quantityPrecision: lastPrice >= 1000 ? 3 : lastPrice >= 10 ? 1 : 0,
      tickSize,
      stepSize,
      minQty: stepSize,
      maxQty: 100_000,
      minNotional: 5,
      maxLeverage: 25,
    };
  }

  /**
   * Fetches initial 24h ticker + funding snapshot via REST when WebSocket cache is warming up.
   */
  async fetchTickersRest(): Promise<MarketTicker[]> {
    const base = this.getFapiBaseUrl();
    const [tickerRes, premiumRes] = await Promise.all([
      this.fetchJson<Array<Record<string, string>>>(`${base}/fapi/v1/ticker/24hr`, {
        timeoutMs: 8000,
      }),
      this.fetchJson<Array<Record<string, string | number>>>(
        `${base}/fapi/v1/premiumIndex`,
        { timeoutMs: 8000 },
      ),
    ]);

    const fundingMap = new Map<
      string,
      { markPrice: number; indexPrice: number; fundingRate: number; nextFundingTime: number }
    >();
    if (premiumRes.ok && Array.isArray(premiumRes.data)) {
      for (const p of premiumRes.data) {
        fundingMap.set(String(p.symbol), {
          markPrice: Number(p.markPrice ?? 0),
          indexPrice: Number(p.indexPrice ?? 0),
          fundingRate: Number(p.lastFundingRate ?? 0),
          nextFundingTime: Number(p.nextFundingTime ?? 0),
        });
      }
    }

    if (tickerRes.ok && Array.isArray(tickerRes.data)) {
      const now = Date.now();
      return tickerRes.data
        .filter((t) => String(t.symbol).endsWith('USDT'))
        .map((t) => {
          const sym = String(t.symbol);
          const lastPrice = Number(t.lastPrice ?? 0);
          const prem = fundingMap.get(sym);
          return {
            symbol: sym,
            lastPrice,
            markPrice: prem?.markPrice || lastPrice,
            indexPrice: prem?.indexPrice || lastPrice,
            priceChangePercent24h: Number(t.priceChangePercent ?? 0),
            high24h: Number(t.highPrice ?? lastPrice),
            low24h: Number(t.lowPrice ?? lastPrice),
            volume24h: Number(t.volume ?? 0),
            quoteVolume24h: Number(t.quoteVolume ?? 0),
            fundingRate: prem?.fundingRate ?? 0,
            nextFundingTime: prem?.nextFundingTime ?? 0,
            updatedAt: now,
          };
        });
    }

    // Fallback to public spot mirror for baseline prices if Futures REST is unreachable
    const visionRes = await this.fetchJson<Array<Record<string, string>>>(
      `${VISION_BASE_URL}/api/v3/ticker/24hr`,
      { timeoutMs: 8000 },
    );
    if (!visionRes.ok || !Array.isArray(visionRes.data)) return [];
    const now = Date.now();
    return visionRes.data
      .filter((t) => String(t.symbol).endsWith('USDT'))
      .map((t) => {
        const lastPrice = Number(t.lastPrice ?? 0);
        return {
          symbol: String(t.symbol),
          lastPrice,
          markPrice: lastPrice,
          indexPrice: lastPrice,
          priceChangePercent24h: Number(t.priceChangePercent ?? 0),
          high24h: Number(t.highPrice ?? lastPrice),
          low24h: Number(t.lowPrice ?? lastPrice),
          volume24h: Number(t.volume ?? 0),
          quoteVolume24h: Number(t.quoteVolume ?? 0),
          fundingRate: 0,
          nextFundingTime: 0,
          updatedAt: now,
        };
      });
  }

  private realSpotVolumeCache: {
    data: Map<string, { quoteVolume: number; priceChangePercent: number }>;
    expiresAt: number;
  } | null = null;

  /**
   * Fetches real 24h ticker metrics from public spot data to filter dummy testnet volume.
   */
  async getRealSpotVolumeMap(): Promise<
    Map<string, { quoteVolume: number; priceChangePercent: number }>
  > {
    if (this.realSpotVolumeCache && Date.now() < this.realSpotVolumeCache.expiresAt) {
      return this.realSpotVolumeCache.data;
    }
    const res = await this.fetchJson<Array<Record<string, string>>>(
      `${VISION_BASE_URL}/api/v3/ticker/24hr`,
      { timeoutMs: 8000 },
    );
    const map = new Map<string, { quoteVolume: number; priceChangePercent: number }>();
    if (res.ok && Array.isArray(res.data)) {
      for (const t of res.data) {
        const sym = String(t.symbol);
        if (sym.endsWith('USDT')) {
          map.set(sym, {
            quoteVolume: Number(t.quoteVolume ?? 0),
            priceChangePercent: Number(t.priceChangePercent ?? 0),
          });
        }
      }
      this.realSpotVolumeCache = {
        data: map,
        expiresAt: Date.now() + 60_000,
      };
    }
    return map;
  }

  /**
   * Fetches OHLCV klines with TTL caching and automatic fallback to Binance Vision
   * if Futures klines hits HTTP 418/429 rate limits or network blocks.
   */
  async getKlines(
    symbol: string,
    interval: Timeframe,
    limit = 220,
  ): Promise<Candle[]> {
    const cacheKey = `${symbol}:${interval}:${limit}`;
    const cached = this.klinesCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.data;
    }

    let candles: Candle[] = [];

    // Try Futures klines if not currently in 418/429 cooldown
    if (Date.now() >= this.futuresKlinesBannedUntil) {
      const fapiUrl = `${this.getFapiBaseUrl()}/fapi/v1/klines?symbol=${encodeURIComponent(
        symbol,
      )}&interval=${interval}&limit=${limit}`;
      const fapiRes = await this.fetchJson<unknown[][]>(fapiUrl, { timeoutMs: 6000 });
      if (fapiRes.ok && Array.isArray(fapiRes.data)) {
        candles = parseKlineArray(fapiRes.data, 1);
      } else if (fapiRes.status === 418 || fapiRes.status === 429 || fapiRes.status === 0) {
        this.futuresKlinesBannedUntil = Date.now() + 5 * 60_000;
      }
    }

    // Automatic fallback to public data-api.binance.vision
    if (candles.length === 0) {
      const { spotSymbol, scale } = mapThousandSymbol(symbol);
      const visionUrl = `${VISION_BASE_URL}/api/v3/klines?symbol=${encodeURIComponent(
        spotSymbol,
      )}&interval=${interval}&limit=${limit}`;
      const visionRes = await this.fetchJson<unknown[][]>(visionUrl, { timeoutMs: 8000 });
      if (visionRes.ok && Array.isArray(visionRes.data)) {
        candles = parseKlineArray(visionRes.data, scale);
      }
    }

    if (candles.length > 0) {
      this.klinesCache.set(cacheKey, {
        data: candles,
        expiresAt: Date.now() + KLINE_TTL_MS[interval],
      });
      return candles;
    }

    return cached?.data ?? [];
  }

  // --- Signed Trading Endpoints (TESTNET / LIVE) ---

  async setIsolatedMarginAndLeverage(symbol: string, leverage: number): Promise<void> {
    try {
      await this.signedRequest('POST', '/fapi/v1/marginType', {
        symbol,
        marginType: 'ISOLATED',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      // -4046 means already isolated
      if (!msg.includes('-4046')) throw err;
    }

    await this.signedRequest('POST', '/fapi/v1/leverage', {
      symbol,
      leverage,
    });
  }

  async placeMarketOrder(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    reduceOnly?: boolean;
    clientOrderId: string;
  }): Promise<BinanceOrderResult> {
    const data = await this.signedRequest<Record<string, unknown>>(
      'POST',
      '/fapi/v1/order',
      {
        symbol: params.symbol,
        side: params.side,
        type: 'MARKET',
        quantity: params.quantity,
        reduceOnly: params.reduceOnly ? 'true' : undefined,
        newClientOrderId: params.clientOrderId,
      },
    );
    return {
      orderId: String(data.orderId ?? ''),
      clientOrderId: String(data.clientOrderId ?? params.clientOrderId),
      symbol: String(data.symbol ?? params.symbol),
      status: String(data.status ?? 'FILLED'),
      avgPrice: Number(data.avgPrice ?? 0),
      executedQty: Number(data.executedQty ?? params.quantity),
    };
  }

  async placeConditionalCloseOrder(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    type: 'STOP_MARKET' | 'TAKE_PROFIT_MARKET';
    stopPrice: number;
    clientOrderId: string;
  }): Promise<string> {
    const data = await this.signedRequest<Record<string, unknown>>(
      'POST',
      '/fapi/v1/order',
      {
        symbol: params.symbol,
        side: params.side,
        type: params.type,
        stopPrice: params.stopPrice,
        closePosition: 'true',
        workingType: 'MARK_PRICE',
        newClientOrderId: params.clientOrderId,
      },
    );
    return String(data.orderId ?? '');
  }

  async cancelOrder(symbol: string, orderId: string): Promise<void> {
    try {
      await this.signedRequest('DELETE', '/fapi/v1/order', { symbol, orderId });
    } catch {
      // Order may already be filled or expired
    }
  }

  async cancelAllOpenOrders(symbol: string): Promise<void> {
    try {
      await this.signedRequest('DELETE', '/fapi/v1/allOpenOrders', { symbol });
    } catch {
      // Ignore if none open
    }
  }

  async getAccountInfo(): Promise<BinanceAccountInfo> {
    const data = await this.signedRequest<Record<string, unknown>>(
      'GET',
      '/fapi/v2/account',
    );
    return {
      totalWalletBalance: Number(data.totalWalletBalance ?? 0),
      availableBalance: Number(data.availableBalance ?? 0),
      totalUnrealizedProfit: Number(data.totalUnrealizedProfit ?? 0),
      totalMarginBalance: Number(data.totalMarginBalance ?? 0),
    };
  }

  async getPositionRisks(): Promise<BinanceExchangePosition[]> {
    const rows = await this.signedRequest<Array<Record<string, unknown>>>(
      'GET',
      '/fapi/v2/positionRisk',
    );
    return rows
      .map((r) => ({
        symbol: String(r.symbol ?? ''),
        positionAmt: Number(r.positionAmt ?? 0),
        entryPrice: Number(r.entryPrice ?? 0),
        markPrice: Number(r.markPrice ?? 0),
        unRealizedProfit: Number(r.unRealizedProfit ?? 0),
        liquidationPrice: Number(r.liquidationPrice ?? 0),
        leverage: Number(r.leverage ?? 1),
        isolatedMargin: Number(r.isolatedMargin ?? 0),
      }))
      .filter((p) => Math.abs(p.positionAmt) > 0);
  }
}
