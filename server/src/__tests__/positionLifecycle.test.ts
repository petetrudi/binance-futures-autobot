import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STRATEGY_CONFIG,
  type CoinNewsContext,
  type Position,
} from '@bot/shared';
import { evaluatePositionTick } from '../execution/positionLifecycle.js';

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
    takeProfit1: 2060,
    takeProfit2: 2112,
    tp1Hit: false,
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

describe('Position lifecycle state machine', () => {
  it('triggers PARTIAL_TP1 and moves stop-loss to break-even with fee buffer', () => {
    const pos = makePosition();
    const decision = evaluatePositionTick(
      pos,
      2065,
      20,
      NEUTRAL_NEWS,
      1_100_000,
      DEFAULT_STRATEGY_CONFIG,
    );

    expect(decision.type).toBe('PARTIAL_TP1');
    if (decision.type !== 'PARTIAL_TP1') throw new Error('Expected PARTIAL_TP1');
    expect(decision.closeQuantityFraction).toBeCloseTo(0.5, 4);
    expect(decision.newStopLoss).toBeGreaterThan(pos.entryPrice);
  });

  it('ratchets trailing stop behind peak price after TP1 without loosening SL', () => {
    const pos = makePosition({
      tp1Hit: true,
      trailingActive: true,
      remainingQuantity: 0.5,
      stopLoss: 2002.4,
      peakPrice: 2090,
    });
    const decision = evaluatePositionTick(
      pos,
      2095,
      20,
      NEUTRAL_NEWS,
      1_200_000,
      DEFAULT_STRATEGY_CONFIG,
    );

    expect(decision.type).toBe('UPDATE_TRAILING_SL');
    if (decision.type !== 'UPDATE_TRAILING_SL') throw new Error('Expected UPDATE_TRAILING_SL');
    // peak = 2095, trail = 1.2 * 20 = 24 => new SL = 2071
    expect(decision.newStopLoss).toBeCloseTo(2071, 2);
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

  it('triggers CLOSE_TP2 when final take-profit target is reached', () => {
    const pos = makePosition({ tp1Hit: true, remainingQuantity: 0.5 });
    const decision = evaluatePositionTick(
      pos,
      2115,
      20,
      NEUTRAL_NEWS,
      1_100_000,
      DEFAULT_STRATEGY_CONFIG,
    );

    expect(decision.type).toBe('CLOSE_TP2');
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
});
