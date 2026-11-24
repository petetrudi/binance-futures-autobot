import {
  DEFAULT_RISK_CONFIG,
  type AccountSummary,
  type Position,
  type RiskConfig,
  type RiskEvaluation,
  type SymbolFilter,
  type TradeSignal,
} from '@bot/shared';
import { formatQuantity, meetsMinNotional } from '../market/precision.js';

export interface RiskEvaluationInput {
  signal: TradeSignal;
  account: AccountSummary;
  openPositions: Position[];
  symbolFilter: SymbolFilter;
  recentClosedSymbolTimes: Map<string, number>;
  riskConfig?: RiskConfig;
  botState: { killSwitchActive: boolean; running: boolean };
  nowMs?: number;
}

function reject(reason: string, leverage: number): RiskEvaluation {
  return {
    approved: false,
    rejectionReason: reason,
    quantity: 0,
    notionalUsdt: 0,
    requiredMarginUsdt: 0,
    leverage,
    riskUsdt: 0,
    rewardUsdt: 0,
    estimatedLiquidationPrice: 0,
  };
}

/**
 * Estimates isolated margin liquidation price accounting for maintenance margin rate (~0.5%).
 */
export function estimateIsolatedLiquidationPrice(
  entryPrice: number,
  leverage: number,
  side: 'LONG' | 'SHORT',
): number {
  const mmr = 0.005;
  const marginRatio = Math.max(1 / Math.max(leverage, 1) - mmr, 0.01);
  if (side === 'LONG') {
    return Math.max(0, entryPrice * (1 - marginRatio));
  }
  return entryPrice * (1 + marginRatio);
}

/**
 * Enforces portfolio circuit breakers, correlation caps, cooldowns, and ATR-based position sizing.
 */
export function evaluateRisk({
  signal,
  account,
  openPositions,
  symbolFilter,
  recentClosedSymbolTimes,
  riskConfig = DEFAULT_RISK_CONFIG,
  botState,
  nowMs = Date.now(),
}: RiskEvaluationInput): RiskEvaluation {
  const leverage = Math.min(riskConfig.defaultLeverage, symbolFilter.maxLeverage);

  if (botState.killSwitchActive || !botState.running) {
    return reject('Bot is paused or kill switch is active', leverage);
  }

  if (signal.action === 'HOLD') {
    return reject('Signal action is HOLD', leverage);
  }

  if (account.circuitBreakerTripped || account.dailyPnlPct <= -riskConfig.maxDailyLossPct) {
    return reject(
      `Daily loss circuit breaker reached (${account.dailyPnlPct.toFixed(2)}% <= -${riskConfig.maxDailyLossPct}%)`,
      leverage,
    );
  }

  if (openPositions.length >= riskConfig.maxConcurrentPositions) {
    return reject(
      `Max concurrent positions reached (${openPositions.length}/${riskConfig.maxConcurrentPositions})`,
      leverage,
    );
  }

  if (openPositions.some((p) => p.symbol === signal.symbol)) {
    return reject(`Already holding an open position on ${signal.symbol}`, leverage);
  }

  const sameDirCount = openPositions.filter((p) => p.side === signal.action).length;
  if (sameDirCount >= riskConfig.maxSameDirectionPositions) {
    return reject(
      `Max same-direction exposure reached (${sameDirCount}/${riskConfig.maxSameDirectionPositions} ${signal.action})`,
      leverage,
    );
  }

  const lastClosed = recentClosedSymbolTimes.get(signal.symbol);
  if (lastClosed !== undefined) {
    const cooldownMs = riskConfig.symbolCooldownMinutes * 60_000;
    const remainingMs = cooldownMs - (nowMs - lastClosed);
    if (remainingMs > 0) {
      const mins = Math.ceil(remainingMs / 60_000);
      return reject(`${signal.symbol} in cooldown for ${mins}m after previous exit`, leverage);
    }
  }

  const entry = signal.entryPrice;
  const stopDist = Math.abs(entry - signal.stopLoss);
  if (entry <= 0 || stopDist <= 0) {
    return reject('Invalid entry or stop-loss distance', leverage);
  }

  const stopDistPct = stopDist / entry;
  const capitalCap =
    riskConfig.maxAccountCapitalUsdt && riskConfig.maxAccountCapitalUsdt > 0
      ? riskConfig.maxAccountCapitalUsdt
      : undefined;

  const effectiveEquity = capitalCap
    ? Math.min(Math.max(0, account.totalEquity), capitalCap)
    : Math.max(0, account.totalEquity);

  const effectiveAvailable = capitalCap
    ? Math.min(Math.max(0, account.availableBalance), capitalCap)
    : Math.max(0, account.availableBalance);

  const riskBudgetUsdt = effectiveEquity * (riskConfig.riskPerTradePct / 100);
  const desiredNotional = riskBudgetUsdt / stopDistPct;

  const maxMarginUsdt = Math.min(
    effectiveAvailable * 0.95,
    effectiveEquity * (riskConfig.maxMarginPerTradePct / 100),
  );
  const maxNotionalByMargin = maxMarginUsdt * leverage;
  const targetNotional = Math.min(desiredNotional, maxNotionalByMargin);

  const quantity = formatQuantity(targetNotional / entry, symbolFilter);
  if (quantity <= 0 || !meetsMinNotional(quantity, entry, symbolFilter)) {
    return reject(
      `Sized quantity below ${symbolFilter.symbol} minNotional (${symbolFilter.minNotional} USDT)`,
      leverage,
    );
  }

  const actualNotional = quantity * entry;
  const requiredMarginUsdt = actualNotional / leverage;
  const feeBuffer = actualNotional * ((riskConfig.takerFeePct * 2) / 100);
  if (requiredMarginUsdt + feeBuffer > account.availableBalance) {
    return reject('Insufficient available margin balance', leverage);
  }

  const riskUsdt = quantity * stopDist;
  const rewardUsdt = quantity * Math.abs(signal.takeProfit2 - entry);
  const estimatedLiquidationPrice = estimateIsolatedLiquidationPrice(
    entry,
    leverage,
    signal.action,
  );

  return {
    approved: true,
    rejectionReason: null,
    quantity,
    notionalUsdt: actualNotional,
    requiredMarginUsdt,
    leverage,
    riskUsdt,
    rewardUsdt,
    estimatedLiquidationPrice,
  };
}
