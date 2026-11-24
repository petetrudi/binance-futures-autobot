import {
  DEFAULT_STRATEGY_CONFIG,
  type CoinNewsContext,
  type Position,
  type StrategyConfig,
} from '@bot/shared';

export type LifecycleDecision =
  | { type: 'HOLD'; updatedPeakPrice: number; reason: string }
  | { type: 'CLOSE_SL'; triggerPrice: number; reason: string }
  | { type: 'CLOSE_TP2'; triggerPrice: number; reason: string }
  | {
      type: 'PARTIAL_TP1';
      triggerPrice: number;
      closeQuantityFraction: number;
      newStopLoss: number;
      reason: string;
    }
  | { type: 'UPDATE_TRAILING_SL'; newStopLoss: number; updatedPeakPrice: number; reason: string }
  | { type: 'EMERGENCY_CLOSE'; triggerPrice: number; reason: string }
  | { type: 'CLOSE_TIME_EXIT'; triggerPrice: number; reason: string };

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
 * Pure deterministic position lifecycle evaluator handling Black Swan exits, hard SL,
 * TP1 partial take-profit + break-even SL move, ATR trailing stop, TP2, and intraday time exit.
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

  // 3. Final Take Profit (TP2)
  const tp2Hit = isLong ? markPrice >= position.takeProfit2 : markPrice <= position.takeProfit2;
  if (tp2Hit) {
    return {
      type: 'CLOSE_TP2',
      triggerPrice: position.takeProfit2,
      reason: `TP2 target reached at ${position.takeProfit2}`,
    };
  }

  // 4. Partial Take Profit 1 (50% close + Break-Even SL with 0.12% fee buffer)
  if (!position.tp1Hit) {
    const tp1Hit = isLong ? markPrice >= position.takeProfit1 : markPrice <= position.takeProfit1;
    if (tp1Hit) {
      const beBuffer = 0.0012;
      const breakEvenSl = isLong
        ? position.entryPrice * (1 + beBuffer)
        : position.entryPrice * (1 - beBuffer);

      return {
        type: 'PARTIAL_TP1',
        triggerPrice: position.takeProfit1,
        closeQuantityFraction: 0.5,
        newStopLoss: breakEvenSl,
        reason: `TP1 reached at ${position.takeProfit1}; closing 50% and moving SL to break-even`,
      };
    }
  }

  // 5. ATR Trailing Stop Ratchet (once TP1 hit or trailing already active)
  if (position.tp1Hit || position.trailingActive) {
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

  // 6. Intraday Max Hold Time Exit (avoid dead capital if position stalls near flat)
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
