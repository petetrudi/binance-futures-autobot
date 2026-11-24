import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import type { MarketTicker, TradingMode } from '@bot/shared';
import type { BinanceFuturesClient } from './binanceClient.js';

const TESTNET_FWS_URL = 'wss://stream.binancefuture.com';
const LIVE_FWS_URL = 'wss://fstream.binance.com';

export class MarketStream extends EventEmitter {
  private tickers = new Map<string, MarketTicker>();
  private ws: WebSocket | null = null;
  private connected = false;
  private stopped = false;
  private reconnectDelayMs = 2000;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private lastEmitAt = 0;

  constructor(
    private mode: TradingMode,
    private customFwsUrl: string,
    private restClient: BinanceFuturesClient,
  ) {
    super();
  }

  isConnected(): boolean {
    return this.connected;
  }

  getAllTickers(): MarketTicker[] {
    return Array.from(this.tickers.values());
  }

  getTicker(symbol: string): MarketTicker | undefined {
    return this.tickers.get(symbol);
  }

  getMarkPrice(symbol: string): number | undefined {
    const t = this.tickers.get(symbol);
    return t ? t.markPrice || t.lastPrice : undefined;
  }

  updateEndpoint(mode: TradingMode, customFwsUrl: string): void {
    const changed = this.mode !== mode || this.customFwsUrl !== customFwsUrl;
    this.mode = mode;
    this.customFwsUrl = customFwsUrl;
    if (changed && !this.stopped) {
      this.restartSocket();
    }
  }

  private getWsUrl(): string {
    const base = this.customFwsUrl.trim()
      ? this.customFwsUrl.trim().replace(/\/+$/, '')
      : this.mode === 'LIVE'
        ? LIVE_FWS_URL
        : TESTNET_FWS_URL;
    return `${base}/stream?streams=!ticker@arr/!markPrice@arr@1s`;
  }

  async start(): Promise<void> {
    this.stopped = false;
    // Warm up ticker map via REST immediately so scanner works right away
    try {
      const initial = await this.restClient.fetchTickersRest();
      for (const item of initial) {
        this.tickers.set(item.symbol, item);
      }
    } catch {
      // Non-fatal; WebSocket will populate
    }
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.connected = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
  }

  private restartSocket(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.connect();
  }

  private connect(): void {
    if (this.stopped) return;
    const url = this.getWsUrl();
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on('open', () => {
      this.connected = true;
      this.reconnectDelayMs = 2000;
      this.emit('status', true);
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          stream?: string;
          data?: Array<Record<string, unknown>>;
        };
        if (!Array.isArray(msg.data)) return;
        const now = Date.now();

        if (msg.stream === '!ticker@arr') {
          for (const t of msg.data) {
            const sym = String(t.s ?? '');
            if (!sym.endsWith('USDT')) continue;
            const prev = this.tickers.get(sym);
            const lastPrice = Number(t.c ?? prev?.lastPrice ?? 0);
            this.tickers.set(sym, {
              symbol: sym,
              lastPrice,
              markPrice: prev?.markPrice || lastPrice,
              indexPrice: prev?.indexPrice || lastPrice,
              priceChangePercent24h: Number(t.P ?? prev?.priceChangePercent24h ?? 0),
              high24h: Number(t.h ?? prev?.high24h ?? lastPrice),
              low24h: Number(t.l ?? prev?.low24h ?? lastPrice),
              volume24h: Number(t.v ?? prev?.volume24h ?? 0),
              quoteVolume24h: Number(t.q ?? prev?.quoteVolume24h ?? 0),
              fundingRate: prev?.fundingRate ?? 0,
              nextFundingTime: prev?.nextFundingTime ?? 0,
              updatedAt: now,
            });
          }
        } else if (msg.stream === '!markPrice@arr@1s') {
          for (const m of msg.data) {
            const sym = String(m.s ?? '');
            if (!sym.endsWith('USDT')) continue;
            const prev = this.tickers.get(sym);
            const markPrice = Number(m.p ?? prev?.markPrice ?? 0);
            if (!prev) {
              this.tickers.set(sym, {
                symbol: sym,
                lastPrice: markPrice,
                markPrice,
                indexPrice: Number(m.i ?? markPrice),
                priceChangePercent24h: 0,
                high24h: markPrice,
                low24h: markPrice,
                volume24h: 0,
                quoteVolume24h: 0,
                fundingRate: Number(m.r ?? 0),
                nextFundingTime: Number(m.T ?? 0),
                updatedAt: now,
              });
            } else {
              prev.markPrice = markPrice;
              prev.indexPrice = Number(m.i ?? prev.indexPrice);
              prev.fundingRate = Number(m.r ?? prev.fundingRate);
              prev.nextFundingTime = Number(m.T ?? prev.nextFundingTime);
              prev.updatedAt = now;
            }
          }
        }

        if (now - this.lastEmitAt >= 1000) {
          this.lastEmitAt = now;
          this.emit('tick');
        }
      } catch {
        // Ignore malformed frame
      }
    });

    ws.on('close', () => {
      this.connected = false;
      this.emit('status', false);
      this.scheduleReconnect();
    });

    ws.on('error', () => {
      this.connected = false;
      this.emit('status', false);
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 30_000);
      this.connect();
    }, this.reconnectDelayMs);
  }
}
