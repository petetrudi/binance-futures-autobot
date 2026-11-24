import { randomUUID } from 'node:crypto';
import {
  DEFAULT_STRATEGY_CONFIG,
  type CoinNewsContext,
  type SignalAction,
  type StrategyConfig,
  type TechnicalAnalysis,
  type TradeSignal,
} from '@bot/shared';

export interface DecisionInput {
  technical: TechnicalAnalysis;
  newsContext: CoinNewsContext;
  btcChange1hPct: number;
  strategyConfig?: StrategyConfig;
}

/**
 * Fuses multi-timeframe technical analysis, news sentiment intelligence, and macro filters
 * into an actionable TradeSignal (LONG, SHORT, or HOLD) with explicit veto reasoning.
 */
export function evaluateSignal({
  technical,
  newsContext,
  btcChange1hPct,
  strategyConfig = DEFAULT_STRATEGY_CONFIG,
}: DecisionInput): TradeSignal {
  const reasons = [...technical.reasons, ...newsContext.headlineSummaries.slice(0, 2)];
  const vetoReasons: string[] = [];

  // Adaptive weighting: if no news exists, technical carries full weight;
  // high-impact coin-specific news gets larger weight when present.
  const hasNews = newsContext.articleCount > 0;
  const hasStrongCatalyst =
    hasNews && newsContext.hasRecentHighImpact && newsContext.coinSpecificCount > 0;
  const techWeight = !hasNews ? 1.0 : hasStrongCatalyst ? 0.55 : 0.7;
  const newsWeight = !hasNews ? 0.0 : hasStrongCatalyst ? 0.45 : 0.3;

  const compositeScore = Math.round(
    technical.technicalScore * techWeight + newsContext.newsScore * newsWeight,
  );

  // Determine directional candidate from composite score (or technical anchor if neutral news)
  const rawSide: 'LONG' | 'SHORT' | null =
    compositeScore >= 20 ? 'LONG' : compositeScore <= -20 ? 'SHORT' : null;

  const plan =
    rawSide === 'SHORT' ? technical.suggestedShortPlan : technical.suggestedLongPlan;

  // Confidence scales cleanly from 0-100 combining score magnitude & alignment bonus
  const sameSideNews =
    (rawSide === 'LONG' && newsContext.newsScore > 15) ||
    (rawSide === 'SHORT' && newsContext.newsScore < -15);
  const alignmentBonus = sameSideNews ? 10 : 0;
  const confidence = Math.min(100, Math.round(Math.abs(compositeScore) * 1.05 + alignmentBonus));

  // Hard Safety Vetoes
  if (newsContext.hasBlackSwanAlert) {
    vetoReasons.push('Black Swan critical news alert active — blocking new entries');
  }

  if (technical.regime === 'HIGH_VOLATILITY_CHOP') {
    vetoReasons.push('High volatility chop regime detected');
  }

  if (technical.indicators15m.adx14 < strategyConfig.minAdx && Math.abs(technical.technicalScore) < 65) {
    vetoReasons.push(
      `ADX ${technical.indicators15m.adx14.toFixed(1)} below minimum ${strategyConfig.minAdx}`,
    );
  }

  if (
    (rawSide === 'LONG' || technical.technicalScore >= 40) &&
    newsContext.hasRecentHighImpact &&
    newsContext.newsScore <= -45
  ) {
    vetoReasons.push(
      `High-impact bearish news conflict (news score ${newsContext.newsScore})`,
    );
  }

  if (
    (rawSide === 'SHORT' || technical.technicalScore <= -40) &&
    newsContext.hasRecentHighImpact &&
    newsContext.newsScore >= 45
  ) {
    vetoReasons.push(
      `High-impact bullish news conflict (news score ${newsContext.newsScore})`,
    );
  }

  if (technical.symbol !== 'BTCUSDT') {
    if (rawSide === 'LONG' && btcChange1hPct <= -strategyConfig.btcMacroShockPct) {
      vetoReasons.push(`BTC 1H macro dump (${btcChange1hPct.toFixed(2)}%) blocks altcoin LONG`);
    }
    if (rawSide === 'SHORT' && btcChange1hPct >= strategyConfig.btcMacroShockPct) {
      vetoReasons.push(`BTC 1H macro surge (+${btcChange1hPct.toFixed(2)}%) blocks altcoin SHORT`);
    }
  }

  if (plan.riskRewardRatio < strategyConfig.minRiskReward) {
    vetoReasons.push(
      `Risk:Reward ${plan.riskRewardRatio.toFixed(2)} below minimum ${strategyConfig.minRiskReward}`,
    );
  }

  if (confidence < strategyConfig.minConfidence) {
    vetoReasons.push(
      `Confidence ${confidence}% below threshold ${strategyConfig.minConfidence}%`,
    );
  }

  let action: SignalAction = 'HOLD';
  if (rawSide !== null && vetoReasons.length === 0) {
    action = rawSide;
  }

  return {
    id: randomUUID(),
    symbol: technical.symbol,
    action,
    regime: technical.regime,
    technicalScore: technical.technicalScore,
    newsScore: newsContext.newsScore,
    compositeScore,
    confidence,
    entryPrice: plan.entryPrice,
    stopLoss: plan.stopLoss,
    takeProfit1: plan.takeProfit1,
    takeProfit2: plan.takeProfit2,
    riskRewardRatio: plan.riskRewardRatio,
    atr: technical.indicators15m.atr14,
    executed: false,
    emergencyCloseRequired: newsContext.hasBlackSwanAlert,
    reasons,
    vetoReasons,
    createdAt: Date.now(),
  };
}
