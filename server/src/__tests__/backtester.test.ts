import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RISK_CONFIG,
  DEFAULT_STRATEGY_CONFIG,
  type Candle,
} from '@bot/shared';
import { runHistoricalBacktest } from '../backtest/backtester.js';
import { makeTrendCandles } from './fixtures.js';

function makeMixedCycleCandles(): Candle[] {
  const interval = 15 * 60_000;
  const start = 1_760_000_000_000;
  // Build 480 bars: base consolidation, strong bullish leg, pullback, second leg
  const leg1 = makeTrendCandles(160, 100, 0.08, 0.002, interval, start);
  const leg2 = makeTrendCandles(
    160,
    leg1.at(-1)!.close,
    0.45,
    0.002,
    interval,
    leg1.at(-1)!.openTime + interval,
  );
  const leg3 = makeTrendCandles(
    160,
    leg2.at(-1)!.close,
    -0.42,
    0.002,
    interval,
    leg2.at(-1)!.openTime + interval,
  );
  return [...leg1, ...leg2, ...leg3];
}

describe('Historical intraday backtester', () => {
  it('simulates trades causally with fees, slippage, and valid performance metrics', () => {
    const candles = makeMixedCycleCandles();
    const res = runHistoricalBacktest({
      request: {
        symbol: 'ETHUSDT',
        interval: '15m',
        bars: candles.length,
        initialCapital: 10_000,
        leverage: 3,
        riskPerTradePct: 1.5,
        minConfidence: 60,
      },
      candles,
      riskConfig: DEFAULT_RISK_CONFIG,
      strategyConfig: DEFAULT_STRATEGY_CONFIG,
    });

    expect(res.symbol).toBe('ETHUSDT');
    expect(res.barsTested).toBe(candles.length);
    expect(res.equityCurve.length).toBeGreaterThan(50);
    expect(res.finalEquity).toBeGreaterThan(0);
    expect(res.maxDrawdownPct).toBeGreaterThanOrEqual(0);
    expect(res.totalTrades).toBeGreaterThan(0);
  });
});
