import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STRATEGY_CONFIG,
  type CoinNewsContext,
  type Position,
  type SymbolFilter,
} from '@bot/shared';
import {
  evaluatePositionTick,
  resolvePartialCloseQuantity,
} from '../execution/positionLifecycle.js';

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: 'pos-1',
    mode: 'PAPER',
    symbol: 'ETHUSDT',
    side: 'LONG',
    status: 'OPEN',
    entryPrice: 2000,
    markPrice: 2000,
    quantity: 1,
    remainingQuantity: 1,
    leverage: 3,
    isolatedMargin: 666.67,
    stopLoss: 1960,
    takeProfit1: 2040,
    takeProfit2: 2072,
    takeProfit3: 2120,
    tp1Hit: false,
    tp2Hit: false,
    trailingActive: false,
    peakPrice: 2000,
    entryAtr: 20,
    liquidationPrice: 1340,
    unrealizedPnl: 0,
    realizedPnl: 0,
    feesPaid: 1,
    confidence: 80,
    entryReasons: ['Aligned uptrend'],
    closeReason: null,
    slOrderId: null,
    tpOrderId: null,
    openedAt: 1_000_000,
    closedAt: null,
    ...overrides,
  };
}

const NEUTRAL_NEWS: CoinNewsContext = {
  symbol: 'ETHUSDT',
  newsScore: 0,
  articleCount: 0,
  coinSpecificCount: 0,
  hasRecentHighImpact: false,
  hasBlackSwanAlert: false,
  dominantSentiment: 'NEUTRAL',
  headlineSummaries: [],
};

const BTC_FILTER: SymbolFilter = {
  symbol: 'BTCUSDT',
  baseAsset: 'BTC',
  quoteAsset: 'USDT',
  pricePrecision: 1,
  quantityPrecision: 3,
  tickSize: 0.1,
  stepSize: 0.001,
  minQty: 0.001,
  maxQty: 1000,
  minNotional: 5,
  maxLeverage: 50,
};

const SOL_FILTER: SymbolFilter = {
  symbol: 'SOLUSDT',
  baseAsset: 'SOL',
  quoteAsset: 'USDT',
  pricePrecision: 3,
  quantityPrecision: 1,
  tickSize: 0.001,
  stepSize: 0.1,
  minQty: 0.1,
  maxQty: 10_000,
  minNotional: 5,
  maxLeverage: 50,
};

describe('Position lifecycle 3-TP state machine', () => {
  it('triggers PARTIAL_TP1 (50% of initial qty) and moves stop-loss to break-even with fee buffer', () => {
    const pos = makePosition();
    const decision = evaluatePositionTick(
      pos,
      2045,
      20,
      NEUTRAL_NEWS,
      1_100_000,
      DEFAULT_STRATEGY_CONFIG,
    );

    expect(decision.type).toBe('PARTIAL_TP1');
    if (decision.type !== 'PARTIAL_TP1') throw new Error('Expected PARTIAL_TP1');
    expect(decision.closeQuantityTarget).toBeCloseTo(0.5, 4);
    expect(decision.newStopLoss).toBeGreaterThan(pos.entryPrice);
    expect(decision.activateTrailing).toBe(false);
  });

  it('holds at break-even SL between TP1 and TP2 without activating trailing prematurely', () => {
    const pos = makePosition({
      tp1Hit: true,
      tp2Hit: false,
      trailingActive: false,
      remainingQuantity: 0.5,
      stopLoss: 2002.4,
      peakPrice: 2055,
    });
    const decision = evaluatePositionTick(
      pos,
      2065,
      20,
      NEUTRAL_NEWS,
      1_150_000,
      DEFAULT_STRATEGY_CONFIG,
    );

    expect(decision.type).toBe('HOLD');
  });

  it('triggers PARTIAL_TP2 (30% of initial qty), moves SL to TP1, and activates trailing', () => {
    const pos = makePosition({
      tp1Hit: true,
      tp2Hit: false,
      trailingActive: false,
      remainingQuantity: 0.5,
      stopLoss: 2002.4,
      peakPrice: 2065,
    });
    const decision = evaluatePositionTick(
      pos,
      2075,
      20,
      NEUTRAL_NEWS,
      1_200_000,
      DEFAULT_STRATEGY_CONFIG,
    );

    expect(decision.type).toBe('PARTIAL_TP2');
    if (decision.type !== 'PARTIAL_TP2') throw new Error('Expected PARTIAL_TP2');
    expect(decision.closeQuantityTarget).toBeCloseTo(0.3, 4);
    expect(decision.newStopLoss).toBe(pos.takeProfit1);
    expect(decision.activateTrailing).toBe(true);
  });

  it('ratchets trailing stop behind peak price after TP2 without dropping below TP1', () => {
    const pos = makePosition({
      tp1Hit: true,
      tp2Hit: true,
      trailingActive: true,
      remainingQuantity: 0.2,
      stopLoss: 2040,
      peakPrice: 2090,
    });
    const decision = evaluatePositionTick(
      pos,
      2105,
      20,
      NEUTRAL_NEWS,
      1_250_000,
      DEFAULT_STRATEGY_CONFIG,
    );

    expect(decision.type).toBe('UPDATE_TRAILING_SL');
    if (decision.type !== 'UPDATE_TRAILING_SL') throw new Error('Expected UPDATE_TRAILING_SL');
    // peak = 2105, trail = 1.2 * 20 = 24 => new SL = 2081 (> TP1 2040)
    expect(decision.newStopLoss).toBeCloseTo(2081, 2);
  });

  it('triggers CLOSE_SL when stop-loss is breached', () => {
    const pos = makePosition();
    const decision = evaluatePositionTick(
      pos,
      1958,
      20,
      NEUTRAL_NEWS,
      1_100_000,
      DEFAULT_STRATEGY_CONFIG,
    );

    expect(decision.type).toBe('CLOSE_SL');
  });

  it('triggers CLOSE_TP3 when final take-profit target is reached', () => {
    const pos = makePosition({ tp1Hit: true, tp2Hit: true, remainingQuantity: 0.2 });
    const decision = evaluatePositionTick(
      pos,
      2122,
      20,
      NEUTRAL_NEWS,
      1_300_000,
      DEFAULT_STRATEGY_CONFIG,
    );

    expect(decision.type).toBe('CLOSE_TP3');
  });

  it('triggers EMERGENCY_CLOSE on Black Swan negative news for open LONG', () => {
    const pos = makePosition();
    const decision = evaluatePositionTick(
      pos,
      2005,
      20,
      {
        ...NEUTRAL_NEWS,
        newsScore: -90,
        hasRecentHighImpact: true,
        hasBlackSwanAlert: true,
        dominantSentiment: 'BEARISH',
      },
      1_100_000,
      DEFAULT_STRATEGY_CONFIG,
    );

    expect(decision.type).toBe('EMERGENCY_CLOSE');
  });

  it('splits 50% / 30% / 20% cleanly on normal lot sizes and guards atomic lots (0.001 BTC runner)', () => {
    const solQty = 2.1;
    const tp1Sol = resolvePartialCloseQuantity(solQty, solQty, 50, 70, SOL_FILTER);
    expect(tp1Sol).toBeCloseTo(1.0, 2);
    const tp2Sol = resolvePartialCloseQuantity(solQty - tp1Sol, solQty, 30, 72, SOL_FILTER);
    expect(tp2Sol).toBeCloseTo(0.6, 2);
    expect(Number((solQty - tp1Sol - tp2Sol).toFixed(1))).toBeCloseTo(0.5, 2);

    // BTC 0.002 can split 0.001 at TP1, leaving atomic 0.001 which cannot split further at TP2
    const btcTp1 = resolvePartialCloseQuantity(0.002, 0.002, 50, 61000, BTC_FILTER);
    expect(btcTp1).toBe(0.001);
    const btcTp2 = resolvePartialCloseQuantity(0.001, 0.002, 30, 62000, BTC_FILTER);
    expect(btcTp2).toBe(0);
  });
});
