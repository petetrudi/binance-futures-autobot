import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RISK_CONFIG,
  type AccountSummary,
  type Position,
  type SymbolFilter,
  type TradeSignal,
} from '@bot/shared';
import { evaluateRisk } from '../risk/riskManager.js';

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

function makeSignal(overrides: Partial<TradeSignal> = {}): TradeSignal {
  return {
    id: 'sig-1',
    symbol: 'SOLUSDT',
    action: 'LONG',
    regime: 'STRONG_TREND_UP',
    technicalScore: 76,
    newsScore: 40,
    compositeScore: 65,
    confidence: 78,
    entryPrice: 150,
    stopLoss: 147,
    takeProfit1: 154.5,
    takeProfit2: 158.4,
    riskRewardRatio: 2.8,
    atr: 1.8,
    executed: false,
    emergencyCloseRequired: false,
    reasons: ['Strong trend'],
    vetoReasons: [],
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeAccount(overrides: Partial<AccountSummary> = {}): AccountSummary {
  return {
    mode: 'PAPER',
    walletBalance: 10_000,
    availableBalance: 10_000,
    isolatedMarginUsed: 0,
    unrealizedPnl: 0,
    totalEquity: 10_000,
    startingDayEquity: 10_000,
    dailyPnl: 0,
    dailyPnlPct: 0,
    dailyLossLimitPct: 5,
    circuitBreakerTripped: false,
    totalTrades: 0,
    winRatePct: 0,
    profitFactor: 0,
    ...overrides,
  };
}

function makeOpenPosition(symbol: string, side: 'LONG' | 'SHORT' = 'LONG'): Position {
  return {
    id: `pos-${symbol}`,
    mode: 'PAPER',
    symbol,
    side,
    status: 'OPEN',
    entryPrice: 100,
    markPrice: 100,
    quantity: 10,
    remainingQuantity: 10,
    leverage: 3,
    isolatedMargin: 333,
    stopLoss: 97,
    takeProfit1: 104.5,
    takeProfit2: 108.4,
    tp1Hit: false,
    trailingActive: false,
    peakPrice: 100,
    entryAtr: 1.5,
    liquidationPrice: 67,
    unrealizedPnl: 0,
    realizedPnl: 0,
    feesPaid: 0.5,
    confidence: 75,
    entryReasons: [],
    closeReason: null,
    slOrderId: null,
    tpOrderId: null,
    openedAt: Date.now() - 10_000,
    closedAt: null,
  };
}

describe('Risk management engine', () => {
  it('sizes position by riskPerTradePct and stop-loss distance', () => {
    const res = evaluateRisk({
      signal: makeSignal(),
      account: makeAccount(),
      openPositions: [],
      symbolFilter: SOL_FILTER,
      recentClosedSymbolTimes: new Map(),
      riskConfig: DEFAULT_RISK_CONFIG,
      botState: { killSwitchActive: false, running: true },
      nowMs: Date.now(),
    });

    // Equity = 10,000, risk = 1.5% = 150 USDT. SL distance = 3/150 = 2%.
    // Raw notional = 150 / 0.02 = 7,500 USDT. Leverage 3x => margin = 2,500 USDT (<= 25% of 10,000 = 2,500).
    // Qty = 7,500 / 150 = 50 SOL.
    expect(res.approved).toBe(true);
    expect(res.quantity).toBe(50);
    expect(res.requiredMarginUsdt).toBeLessThanOrEqual(2505);
    expect(res.estimatedLiquidationPrice).toBeLessThan(147);
  });

  it('rejects entries when daily drawdown circuit breaker is tripped', () => {
    const res = evaluateRisk({
      signal: makeSignal(),
      account: makeAccount({
        totalEquity: 9400,
        startingDayEquity: 10_000,
        dailyPnl: -600,
        dailyPnlPct: -6,
        circuitBreakerTripped: true,
      }),
      openPositions: [],
      symbolFilter: SOL_FILTER,
      recentClosedSymbolTimes: new Map(),
      riskConfig: DEFAULT_RISK_CONFIG,
      botState: { killSwitchActive: false, running: true },
      nowMs: Date.now(),
    });

    expect(res.approved).toBe(false);
    expect(res.rejectionReason?.toLowerCase()).toContain('daily');
  });

  it('rejects duplicate symbol or exceeding same-direction correlation limit', () => {
    const dupRes = evaluateRisk({
      signal: makeSignal({ symbol: 'SOLUSDT' }),
      account: makeAccount(),
      openPositions: [makeOpenPosition('SOLUSDT', 'LONG')],
      symbolFilter: SOL_FILTER,
      recentClosedSymbolTimes: new Map(),
      riskConfig: DEFAULT_RISK_CONFIG,
      botState: { killSwitchActive: false, running: true },
      nowMs: Date.now(),
    });
    expect(dupRes.approved).toBe(false);

    const corrRes = evaluateRisk({
      signal: makeSignal({ symbol: 'SOLUSDT', action: 'LONG' }),
      account: makeAccount(),
      openPositions: [makeOpenPosition('BTCUSDT', 'LONG'), makeOpenPosition('ETHUSDT', 'LONG')],
      symbolFilter: SOL_FILTER,
      recentClosedSymbolTimes: new Map(),
      riskConfig: DEFAULT_RISK_CONFIG,
      botState: { killSwitchActive: false, running: true },
      nowMs: Date.now(),
    });
    expect(corrRes.approved).toBe(false);
    expect(corrRes.rejectionReason?.toLowerCase()).toContain('direction');
  });

  it('enforces per-symbol stop-loss cooldown window', () => {
    const now = Date.now();
    const res = evaluateRisk({
      signal: makeSignal({ symbol: 'SOLUSDT' }),
      account: makeAccount(),
      openPositions: [],
      symbolFilter: SOL_FILTER,
      recentClosedSymbolTimes: new Map([['SOLUSDT', now - 10 * 60_000]]),
      riskConfig: DEFAULT_RISK_CONFIG,
      botState: { killSwitchActive: false, running: true },
      nowMs: now,
    });

    expect(res.approved).toBe(false);
    expect(res.rejectionReason?.toLowerCase()).toContain('cooldown');
  });
});
