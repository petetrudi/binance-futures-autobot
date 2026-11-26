import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STRATEGY_CONFIG,
  type MarketTicker,
  type NewsItem,
} from '@bot/shared';
import { scanMarketCandidates } from '../market/autoScanner.js';

function makeTicker(
  symbol: string,
  quoteVolume24h: number,
  priceChangePercent24h: number,
  highLowSpanPct: number,
  fundingRate = 0.0001,
): MarketTicker {
  const lastPrice = 100;
  const half = (highLowSpanPct / 100) * 50;
  return {
    symbol,
    lastPrice,
    markPrice: lastPrice,
    indexPrice: lastPrice,
    priceChangePercent24h,
    high24h: lastPrice + half,
    low24h: Math.max(1, lastPrice - half),
    volume24h: quoteVolume24h / lastPrice,
    quoteVolume24h,
    fundingRate,
    nextFundingTime: Date.now() + 3600_000,
    updatedAt: Date.now(),
  };
}

describe('Auto-Scanner ranking engine', () => {
  it('filters out stablecoins and low-volume illiquid pairs', () => {
    const tickers: MarketTicker[] = [
      makeTicker('BTCUSDT', 5_000_000_000, 1.5, 4),
      makeTicker('USDCUSDT', 800_000_000, 0.01, 0.1),
      makeTicker('ILLIQUIDUSDT', 500_000, 18, 25),
      makeTicker('SOLUSDT', 1_200_000_000, 4.8, 7.5),
    ];

    const candidates = scanMarketCandidates(
      tickers,
      [],
      new Set(['BTCUSDT', 'USDCUSDT', 'ILLIQUIDUSDT', 'SOLUSDT']),
      DEFAULT_STRATEGY_CONFIG,
    );

    const symbols = candidates.map((c) => c.symbol);
    expect(symbols).toContain('BTCUSDT');
    expect(symbols).toContain('SOLUSDT');
    expect(symbols).not.toContain('USDCUSDT');
    expect(symbols).not.toContain('ILLIQUIDUSDT');
  });

  it('boosts coins with active high-impact news catalyst and keeps BTCUSDT benchmark', () => {
    const now = Date.now();
    const tickers: MarketTicker[] = [
      makeTicker('BTCUSDT', 4_000_000_000, 0.5, 2.2),
      makeTicker('ETHUSDT', 2_000_000_000, 1.2, 3.0),
      makeTicker('AVAXUSDT', 300_000_000, 3.8, 6.2),
    ];

    const news: NewsItem[] = [
      {
        id: 'n1',
        urlHash: 'h1',
        source: 'CoinTelegraph',
        title: 'Avalanche institutional subnet launch drives surge in volume',
        url: 'https://example.com',
        publishedAt: now - 20 * 60_000,
        symbols: ['AVAXUSDT'],
        sentiment: 'BULLISH',
        score: 75,
        impact: 'HIGH',
        isBlackSwan: false,
        summary: 'Major AVAX institutional catalyst',
        analysisSource: 'GEMINI_AI',
        createdAt: now,
      },
    ];

    const candidates = scanMarketCandidates(
      tickers,
      news,
      new Set(['BTCUSDT', 'ETHUSDT', 'AVAXUSDT']),
      { ...DEFAULT_STRATEGY_CONFIG, scannerTopN: 2 },
    );

    expect(candidates.some((c) => c.symbol === 'BTCUSDT')).toBe(true);
    const avax = candidates.find((c) => c.symbol === 'AVAXUSDT');
    expect(avax).toBeDefined();
    expect(avax!.hasHighImpactNews).toBe(true);
    expect(avax!.catalystScore).toBeGreaterThan(0);
  });

  it('overlays real spot volume to filter out fake dummy testnet volumes', () => {
    const tickers: MarketTicker[] = [
      makeTicker('BTCUSDT', 500_000_000_000, 0.5, 3), // fake testnet inflated vol
      makeTicker('DUMMYUSDT', 80_000_000_000, 12, 15), // fake testnet coin
      makeTicker('SOLUSDT', 200_000_000_000, 2.5, 6),
    ];

    const realMap = new Map<string, { quoteVolume: number; priceChangePercent: number }>([
      ['BTCUSDT', { quoteVolume: 1_800_000_000, priceChangePercent: -1.5 }],
      ['SOLUSDT', { quoteVolume: 350_000_000, priceChangePercent: 2.1 }],
      // DUMMYUSDT not present in real Binance spot market
    ]);

    const candidates = scanMarketCandidates(
      tickers,
      [],
      new Set(['BTCUSDT', 'DUMMYUSDT', 'SOLUSDT']),
      { ...DEFAULT_STRATEGY_CONFIG, minVolume24hUsdt: 20_000_000 },
      Date.now(),
      realMap,
    );

    const symbols = candidates.map((c) => c.symbol);
    expect(symbols).toContain('BTCUSDT');
    expect(symbols).toContain('SOLUSDT');
    expect(symbols).not.toContain('DUMMYUSDT');
  });

  it('defaults to scanning top 20 candidates when 25+ liquid pairs exist', () => {
    expect(DEFAULT_STRATEGY_CONFIG.scannerTopN).toBe(20);
    const tickers: MarketTicker[] = Array.from({ length: 25 }, (_, i) =>
      makeTicker(i === 0 ? 'BTCUSDT' : `COIN${i}USDT`, 800_000_000 - i * 15_000_000, 3 + (i % 5), 6),
    );
    const allow = new Set(tickers.map((t) => t.symbol));
    const candidates = scanMarketCandidates(tickers, [], allow, DEFAULT_STRATEGY_CONFIG);

    expect(candidates).toHaveLength(20);
    expect(candidates.some((c) => c.symbol === 'BTCUSDT')).toBe(true);
  });
});
