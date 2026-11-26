import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STRATEGY_CONFIG,
  type CoinNewsContext,
  type TechnicalAnalysis,
} from '@bot/shared';
import { evaluateSignal } from '../strategy/decisionEngine.js';

function makeTechnical(overrides: Partial<TechnicalAnalysis> = {}): TechnicalAnalysis {
  return {
    symbol: 'SOLUSDT',
    timestamp: Date.now(),
    regime: 'STRONG_TREND_UP',
    trend4h: 'BULLISH',
    trend1h: 'BULLISH',
    trend15m: 'BULLISH',
    technicalScore: 76,
    indicators15m: {
      price: 150,
      ema9: 149.2,
      ema21: 147.8,
      ema50: 145.5,
      ema200: 140.0,
      rsi14: 58,
      macdLine: 1.2,
      macdSignal: 0.7,
      macdHistogram: 0.5,
      atr14: 1.8,
      atrPct: 1.2,
      adx14: 31,
      plusDi: 28,
      minusDi: 13,
      vwap: 148.5,
      bbUpper: 153,
      bbMiddle: 148,
      bbLower: 143,
      volumeRatio: 1.45,
      nearestSupport: 147,
      nearestResistance: 162,
    },
    fundingRate: 0.0001,
    suggestedLongPlan: {
      side: 'LONG',
      entryPrice: 150,
      stopLoss: 147.12,
      takeProfit1: 152.88,
      takeProfit2: 155.18,
      takeProfit3: 158.64,
      riskRewardRatio: 3.0,
      stopDistancePct: 0.0192,
    },
    suggestedShortPlan: {
      side: 'SHORT',
      entryPrice: 150,
      stopLoss: 152.88,
      takeProfit1: 147.12,
      takeProfit2: 144.82,
      takeProfit3: 141.36,
      riskRewardRatio: 3.0,
      stopDistancePct: 0.0192,
    },
    reasons: ['4H & 1H uptrend aligned', 'Price above VWAP with volume confirmation'],
    ...overrides,
  };
}

function makeNews(overrides: Partial<CoinNewsContext> = {}): CoinNewsContext {
  return {
    symbol: 'SOLUSDT',
    newsScore: 48,
    articleCount: 3,
    coinSpecificCount: 2,
    hasRecentHighImpact: false,
    hasBlackSwanAlert: false,
    dominantSentiment: 'BULLISH',
    headlineSummaries: ['Solana ecosystem inflows climb to multi-month highs'],
    ...overrides,
  };
}

describe('Decision fusion engine', () => {
  it('approves LONG when strong bullish technicals align with supportive news', () => {
    const signal = evaluateSignal({
      technical: makeTechnical(),
      newsContext: makeNews(),
      btcChange1hPct: 0.4,
      strategyConfig: DEFAULT_STRATEGY_CONFIG,
    });

    expect(signal.action).toBe('LONG');
    expect(signal.confidence).toBeGreaterThanOrEqual(65);
    expect(signal.vetoReasons).toHaveLength(0);
    expect(signal.emergencyCloseRequired).toBe(false);
  });

  it('vetoes LONG entry on opposite high-impact bearish news', () => {
    const signal = evaluateSignal({
      technical: makeTechnical({ technicalScore: 72 }),
      newsContext: makeNews({
        newsScore: -65,
        hasRecentHighImpact: true,
        dominantSentiment: 'BEARISH',
      }),
      btcChange1hPct: 0.1,
      strategyConfig: DEFAULT_STRATEGY_CONFIG,
    });

    expect(signal.action).toBe('HOLD');
    expect(signal.vetoReasons.some((r) => r.toLowerCase().includes('news'))).toBe(true);
  });

  it('blocks all entries and flags emergency exit when Black Swan alert is active', () => {
    const signal = evaluateSignal({
      technical: makeTechnical(),
      newsContext: makeNews({
        newsScore: -95,
        hasRecentHighImpact: true,
        hasBlackSwanAlert: true,
        dominantSentiment: 'BEARISH',
      }),
      btcChange1hPct: -1.5,
      strategyConfig: DEFAULT_STRATEGY_CONFIG,
    });

    expect(signal.action).toBe('HOLD');
    expect(signal.emergencyCloseRequired).toBe(true);
    expect(signal.vetoReasons.some((r) => r.toLowerCase().includes('black swan'))).toBe(true);
  });

  it('blocks altcoin LONG when BTC has a sharp 1H macro dump', () => {
    const signal = evaluateSignal({
      technical: makeTechnical({ symbol: 'SOLUSDT' }),
      newsContext: makeNews(),
      btcChange1hPct: -3.4,
      strategyConfig: DEFAULT_STRATEGY_CONFIG,
    });

    expect(signal.action).toBe('HOLD');
    expect(signal.vetoReasons.some((r) => r.toLowerCase().includes('btc'))).toBe(true);
  });

  it('holds in low-ADX choppy conditions when confidence threshold is not met', () => {
    const base = makeTechnical();
    const signal = evaluateSignal({
      technical: makeTechnical({
        regime: 'RANGING',
        technicalScore: 20,
        indicators15m: { ...base.indicators15m, adx14: 11 },
      }),
      newsContext: makeNews({ newsScore: 5, dominantSentiment: 'NEUTRAL' }),
      btcChange1hPct: 0,
      strategyConfig: DEFAULT_STRATEGY_CONFIG,
    });

    expect(signal.action).toBe('HOLD');
    expect(signal.vetoReasons.length).toBeGreaterThan(0);
  });
});
