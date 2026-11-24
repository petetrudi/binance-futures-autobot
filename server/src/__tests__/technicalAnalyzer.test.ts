import { describe, expect, it } from 'vitest';
import { analyzeMultiTimeframe } from '../analysis/technicalAnalyzer.js';
import { makeChopCandles, makeTrendCandles } from './fixtures.js';

describe('Multi-timeframe technical analyzer', () => {
  it('classifies aligned bullish trend with positive technical score and valid LONG/SHORT plans', () => {
    const c15m = makeTrendCandles(220, 100, 0.35, 0.003, 15 * 60_000);
    const c1h = makeTrendCandles(220, 100, 0.6, 0.003, 60 * 60_000);
    const c4h = makeTrendCandles(220, 100, 1.1, 0.003, 4 * 60 * 60_000);

    const analysis = analyzeMultiTimeframe('ETHUSDT', c15m, c1h, c4h, 0.0001);

    expect(analysis.symbol).toBe('ETHUSDT');
    expect(analysis.trend4h).toBe('BULLISH');
    expect(analysis.trend1h).toBe('BULLISH');
    expect(analysis.regime).toBe('STRONG_TREND_UP');
    expect(analysis.technicalScore).toBeGreaterThan(40);
    expect(analysis.suggestedLongPlan.stopLoss).toBeLessThan(analysis.suggestedLongPlan.entryPrice);
    expect(analysis.suggestedLongPlan.takeProfit1).toBeGreaterThan(analysis.suggestedLongPlan.entryPrice);
    expect(analysis.suggestedLongPlan.takeProfit2).toBeGreaterThan(analysis.suggestedLongPlan.takeProfit1);
    expect(analysis.suggestedLongPlan.riskRewardRatio).toBeGreaterThan(1.5);
    expect(analysis.reasons.length).toBeGreaterThan(0);
  });

  it('classifies aligned bearish trend with negative technical score', () => {
    const c15m = makeTrendCandles(220, 400, -0.55, 0.002, 15 * 60_000);
    const c1h = makeTrendCandles(220, 400, -0.8, 0.002, 60 * 60_000);
    const c4h = makeTrendCandles(220, 400, -1.2, 0.002, 4 * 60 * 60_000);

    const analysis = analyzeMultiTimeframe('SOLUSDT', c15m, c1h, c4h, -0.0001);

    expect(analysis.trend4h).toBe('BEARISH');
    expect(analysis.trend1h).toBe('BEARISH');
    expect(analysis.regime).toBe('STRONG_TREND_DOWN');
    expect(analysis.technicalScore).toBeLessThan(-40);
    expect(analysis.suggestedShortPlan.stopLoss).toBeGreaterThan(analysis.suggestedShortPlan.entryPrice);
    expect(analysis.suggestedShortPlan.takeProfit2).toBeLessThan(analysis.suggestedShortPlan.takeProfit1);
  });

  it('identifies ranging market on choppy sideways candles', () => {
    const c15m = makeChopCandles(220, 100, 0.005);
    const c1h = makeChopCandles(220, 100, 0.005);
    const c4h = makeChopCandles(220, 100, 0.005);

    const analysis = analyzeMultiTimeframe('ADAUSDT', c15m, c1h, c4h, 0.0001);
    expect(['RANGING', 'HIGH_VOLATILITY_CHOP']).toContain(analysis.regime);
    expect(Math.abs(analysis.technicalScore)).toBeLessThan(40);
  });
});
