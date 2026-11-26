import {
  DEFAULT_STRATEGY_CONFIG,
  type CoinNewsContext,
  type Position,
  type StrategyConfig,
  type SymbolFilter,
} from '@bot/shared';
import { formatQuantity, meetsMinNotional, roundToStep } from '../market/precision.js';

export type LifecycleDecision =
  | { type: 'HOLD'; updatedPeakPrice: number; reason: string }
  | { type: 'CLOSE_SL'; triggerPrice: number; reason: string }
  | { type: 'CLOSE_TP3'; triggerPrice: number; reason: string }
  | {
      type: 'PARTIAL_TP1';
      triggerPrice: number;
      closeQuantityTarget: number;
      closePctOfInitial: number;
      newStopLoss: number;
      activateTrailing: false;
      reason: string;
    }
  | {
      type: 'PARTIAL_TP2';
      triggerPrice: number;
      closeQuantityTarget: number;
      closePctOfInitial: number;
      newStopLoss: number;
      activateTrailing: true;
      reason: string;
    }
  | { type: 'UPDATE_TRAILING_SL'; newStopLoss: number; updatedPeakPrice: number; reason: string }
  | { type: 'EMERGENCY_CLOSE'; triggerPrice: number; reason: string }
  | { type: 'CLOSE_TIME_EXIT'; triggerPrice: number; reason: string };

/**
 * Resolves an exchange-safe partial close quantity from the initial position size while
 * ensuring any remaining runner stays above Binance minQty and minNotional thresholds.
 * Returns 0 when remainingQuantity is an atomic unsplittable lot so the caller can advance
 * TP flags and stop-loss protection without submitting an invalid exchange order.
 */
export function resolvePartialCloseQuantity(
  remainingQuantity: number,
  initialQuantity: number,
  closePctOfInitial: number,
  execPrice: number,
  filter: SymbolFilter,
): number {
  if (
    remainingQuantity <= 0 ||
    initialQuantity <= 0 ||
    closePctOfInitial <= 0 ||
    execPrice <= 0
  ) {
    return 0;
  }

  const desiredRaw = Math.min(remainingQuantity, initialQuantity * (closePctOfInitial / 100));
  const minNotionalLot = roundToStep(filter.minNotional / execPrice, filter.stepSize, 'ceil');
  const minOrderQty = Math.max(
    filter.minQty,
    Number(minNotionalLot.toFixed(filter.quantityPrecision)),
  );

  let closeQty = formatQuantity(desiredRaw, filter);
  if ((closeQty <= 0 || !meetsMinNotional(closeQty, execPrice, filter)) && minOrderQty < remainingQuantity) {
    closeQty = minOrderQty;
  }
  if (closeQty <= 0 || closeQty >= remainingQuantity) {
    closeQty = formatQuantity(remainingQuantity - minOrderQty, filter);
  }

  let rem = Number((remainingQuantity - closeQty).toFixed(filter.quantityPrecision));
  if (rem < filter.minQty || !meetsMinNotional(rem, execPrice, filter)) {
    closeQty = formatQuantity(remainingQuantity - minOrderQty, filter);
    rem = Number((remainingQuantity - closeQty).toFixed(filter.quantityPrecision));
  }

  if (
    closeQty <= 0 ||
    rem < filter.minQty ||
    !meetsMinNotional(closeQty, execPrice, filter) ||
    !meetsMinNotional(rem, execPrice, filter)
  ) {
    return 0;
  }

  return closeQty;
}

/**
 * Computes unrealized PnL for an open position at a given mark price.
 */
export function computeUnrealizedPnl(position: Position, markPrice: number): number {
  const diff =
    position.side === 'LONG'
      ? markPrice - position.entryPrice
      : position.entryPrice - markPrice;
  return diff * position.remainingQuantity;
}

/**
 * Pure deterministic 3-TP position lifecycle evaluator:
 * - Black Swan emergency exit & Hard SL
 * - TP1 partial close (50% initial) + Break-Even SL (+0.12% fee buffer)
 * - TP2 partial close (30% initial) + SL locked at TP1 + ATR trailing activation
 * - ATR trailing ratchet after TP2 toward final TP3 close (20% runner)
 */
export function evaluatePositionTick(
  position: Position,
  markPrice: number,
  currentAtr: number,
  newsContext: CoinNewsContext | null,
  nowMs: number,
  strategyConfig: StrategyConfig = DEFAULT_STRATEGY_CONFIG,
): LifecycleDecision {
  const isLong = position.side === 'LONG';
  const peakPrice = isLong
    ? Math.max(position.peakPrice, markPrice)
    : Math.min(position.peakPrice, markPrice);

  // 1. Black Swan Emergency News Exit
  if (newsContext?.hasBlackSwanAlert) {
    const adverseForLong = isLong && newsContext.newsScore <= -40;
    const adverseForShort = !isLong && newsContext.newsScore >= 40;
    if (adverseForLong || adverseForShort) {
      return {
        type: 'EMERGENCY_CLOSE',
        triggerPrice: markPrice,
        reason: `Black Swan emergency exit triggered (news score ${newsContext.newsScore})`,
      };
    }
  }

  // 2. Hard Stop Loss
  const slHit = isLong ? markPrice <= position.stopLoss : markPrice >= position.stopLoss;
  if (slHit) {
    return {
      type: 'CLOSE_SL',
      triggerPrice: position.stopLoss,
      reason: position.trailingActive
        ? `Trailing Stop Loss triggered at ${position.stopLoss}`
        : `Hard Stop Loss triggered at ${position.stopLoss}`,
    };
  }

  // 3. Final Take Profit (TP3)
  const tp3Hit = isLong ? markPrice >= position.takeProfit3 : markPrice <= position.takeProfit3;
  if (tp3Hit) {
    return {
      type: 'CLOSE_TP3',
      triggerPrice: position.takeProfit3,
      reason: `TP3 final target reached at ${position.takeProfit3}`,
    };
  }

  // 4. Partial Take Profit 1 (default 50% initial + Break-Even SL with 0.12% fee buffer)
  if (!position.tp1Hit) {
    const tp1Hit = isLong ? markPrice >= position.takeProfit1 : markPrice <= position.takeProfit1;
    if (tp1Hit) {
      const beBuffer = 0.0012;
      const rawBeSl = isLong
        ? position.entryPrice * (1 + beBuffer)
        : position.entryPrice * (1 - beBuffer);
      const breakEvenSl = isLong
        ? Math.max(position.stopLoss, rawBeSl)
        : Math.min(position.stopLoss, rawBeSl);
      const closePctOfInitial = strategyConfig.tp1ClosePct;

      return {
        type: 'PARTIAL_TP1',
        triggerPrice: position.takeProfit1,
        closeQuantityTarget: position.quantity * (closePctOfInitial / 100),
        closePctOfInitial,
        newStopLoss: breakEvenSl,
        activateTrailing: false,
        reason: `TP1 reached at ${position.takeProfit1}; closing ${closePctOfInitial}% and moving SL to break-even`,
      };
    }
  }

  // 5. Partial Take Profit 2 (default 30% initial + SL locked at TP1 + activate ATR trailing)
  if (!position.tp2Hit) {
    const tp2Hit = isLong ? markPrice >= position.takeProfit2 : markPrice <= position.takeProfit2;
    if (tp2Hit) {
      const tp1LockedSl = isLong
        ? Math.max(position.stopLoss, position.takeProfit1)
        : Math.min(position.stopLoss, position.takeProfit1);
      const closePctOfInitial = strategyConfig.tp2ClosePct;

      return {
        type: 'PARTIAL_TP2',
        triggerPrice: position.takeProfit2,
        closeQuantityTarget: position.quantity * (closePctOfInitial / 100),
        closePctOfInitial,
        newStopLoss: tp1LockedSl,
        activateTrailing: true,
        reason: `TP2 reached at ${position.takeProfit2}; closing ${closePctOfInitial}%, moving SL to TP1 (${tp1LockedSl}), and activating trailing`,
      };
    }
  }

  // 6. ATR Trailing Stop Ratchet (once TP2 hit or trailing already active)
  if (position.tp2Hit || position.trailingActive) {
    const atrBasis = currentAtr > 0 ? currentAtr : position.entryAtr;
    const trailOffset = atrBasis * strategyConfig.trailingAtrMultiplier;
    const candidateSl = isLong ? peakPrice - trailOffset : peakPrice + trailOffset;
    const meaningfulImprovement = isLong
      ? candidateSl > position.stopLoss * 1.0005
      : candidateSl < position.stopLoss * 0.9995;

    if (meaningfulImprovement) {
      return {
        type: 'UPDATE_TRAILING_SL',
        newStopLoss: candidateSl,
        updatedPeakPrice: peakPrice,
        reason: `Trailing SL ratcheted to ${candidateSl.toFixed(4)}`,
      };
    }
  }

  // 7. Intraday Max Hold Time Exit (avoid dead capital if position stalls near flat)
  const holdMs = nowMs - position.openedAt;
  const maxHoldMs = strategyConfig.maxHoldHours * 3_600_000;
  if (holdMs >= maxHoldMs) {
    return {
      type: 'CLOSE_TIME_EXIT',
      triggerPrice: markPrice,
      reason: `Intraday max hold window (${strategyConfig.maxHoldHours}h) elapsed`,
    };
  }

  return {
    type: 'HOLD',
    updatedPeakPrice: peakPrice,
    reason: 'Position active within thresholds',
  };
}
