import {
  DEFAULT_STRATEGY_CONFIG,
  type Candle,
  type MarketRegime,
  type Side,
  type StrategyConfig,
  type TechnicalAnalysis,
  type TechnicalIndicators,
  type TradePlan,
} from '@bot/shared';
import {
  adx,
  atr,
  bollingerBands,
  detectSupportResistance,
  ema,
  macd,
  rsi,
  volumeRatio,
  vwap,
} from './indicators.js';

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function classifyTimeframeTrend(candles: Candle[]): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
  if (candles.length < 25) return 'NEUTRAL';
  const closes = candles.map((c) => c.close);
  const price = closes.at(-1)!;
  const e21 = ema(closes, 21);
  const e50 = ema(closes, Math.min(50, closes.length));
  const emaSpreadPct = e50 > 0 ? Math.abs(e21 - e50) / e50 : 0;
  const { adx: adxVal, plusDi, minusDi } = adx(candles, 14);

  if (adxVal < 18 && emaSpreadPct < 0.0025) {
    return 'NEUTRAL';
  }
  if (price > e21 && e21 > e50 && emaSpreadPct >= 0.0015 && plusDi >= minusDi) {
    return 'BULLISH';
  }
  if (price < e21 && e21 < e50 && emaSpreadPct >= 0.0015 && minusDi >= plusDi) {
    return 'BEARISH';
  }
  return 'NEUTRAL';
}

function classifyRegime(
  ind: TechnicalIndicators,
  trend4h: 'BULLISH' | 'BEARISH' | 'NEUTRAL',
  trend1h: 'BULLISH' | 'BEARISH' | 'NEUTRAL',
): MarketRegime {
  if (ind.atrPct > 3.2 && ind.adx14 < 22) {
    return 'HIGH_VOLATILITY_CHOP';
  }
  if (
    ind.adx14 >= 22 &&
    ind.plusDi > ind.minusDi &&
    (trend4h === 'BULLISH' || trend1h === 'BULLISH')
  ) {
    return 'STRONG_TREND_UP';
  }
  if (
    ind.adx14 >= 22 &&
    ind.minusDi > ind.plusDi &&
    (trend4h === 'BEARISH' || trend1h === 'BEARISH')
  ) {
    return 'STRONG_TREND_DOWN';
  }
  return 'RANGING';
}

function buildTradePlan(
  side: Side,
  price: number,
  atrVal: number,
  nearestSupport: number | null,
  nearestResistance: number | null,
  config: StrategyConfig,
): TradePlan {
  const safeAtr = Math.max(atrVal, price * 0.004);
  const baseDistance = safeAtr * config.stopLossAtrMultiplier;
  const minDistance = price * 0.006;
  const maxDistance = price * 0.055;

  let stopLoss: number;
  if (side === 'LONG') {
    const atrStop = price - baseDistance;
    const structuralStop =
      nearestSupport !== null && nearestSupport < price
        ? nearestSupport - safeAtr * 0.35
        : atrStop;
    const rawStop = Math.min(atrStop, structuralStop);
    const dist = clamp(price - rawStop, minDistance, maxDistance);
    stopLoss = price - dist;
  } else {
    const atrStop = price + baseDistance;
    const structuralStop =
      nearestResistance !== null && nearestResistance > price
        ? nearestResistance + safeAtr * 0.35
        : atrStop;
    const rawStop = Math.max(atrStop, structuralStop);
    const dist = clamp(rawStop - price, minDistance, maxDistance);
    stopLoss = price + dist;
  }

  const riskDist = Math.abs(price - stopLoss);
  const sign = side === 'LONG' ? 1 : -1;
  const takeProfit1 = price + sign * riskDist * config.tp1RiskReward;
  const takeProfit2 = price + sign * riskDist * config.tp2RiskReward;

  return {
    side,
    entryPrice: price,
    stopLoss,
    takeProfit1,
    takeProfit2,
    riskRewardRatio: config.tp2RiskReward,
    stopDistancePct: riskDist / price,
  };
}

/**
 * Performs multi-timeframe technical analysis across 15m (execution), 1H (setup), and 4H (macro bias).
 */
export function analyzeMultiTimeframe(
  symbol: string,
  candles15m: Candle[],
  candles1h: Candle[],
  candles4h: Candle[],
  fundingRate = 0,
  strategyConfig: StrategyConfig = DEFAULT_STRATEGY_CONFIG,
): TechnicalAnalysis {
  const closes = candles15m.map((c) => c.close);
  const price = closes.at(-1) ?? 0;

  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const ema50 = ema(closes, Math.min(50, closes.length));
  const ema200 = ema(closes, Math.min(200, closes.length));
  const rsi14 = rsi(closes, 14);
  const macdVal = macd(closes);
  const atr14 = atr(candles15m, 14);
  const atrPct = price > 0 ? (atr14 / price) * 100 : 0;
  const adxVal = adx(candles15m, 14);
  const bb = bollingerBands(closes, 20, 2);
  const vwapVal = vwap(candles15m.slice(-32));
  const volRatio = volumeRatio(candles15m, 20);
  const sr = detectSupportResistance(candles15m, 90);

  const indicators15m: TechnicalIndicators = {
    price,
    ema9,
    ema21,
    ema50,
    ema200,
    rsi14,
    macdLine: macdVal.macdLine,
    macdSignal: macdVal.signalLine,
    macdHistogram: macdVal.histogram,
    atr14,
    atrPct,
    adx14: adxVal.adx,
    plusDi: adxVal.plusDi,
    minusDi: adxVal.minusDi,
    vwap: vwapVal,
    bbUpper: bb.upper,
    bbMiddle: bb.middle,
    bbLower: bb.lower,
    volumeRatio: volRatio,
    nearestSupport: sr.nearestSupport,
    nearestResistance: sr.nearestResistance,
  };

  const trend4h = classifyTimeframeTrend(candles4h);
  const trend1h = classifyTimeframeTrend(candles1h);
  const trend15m = classifyTimeframeTrend(candles15m);
  const regime = classifyRegime(indicators15m, trend4h, trend1h);

  let score = 0;
  const reasons: string[] = [];

  // 1. Higher timeframe trend alignment (+/- 32)
  if (trend4h === 'BULLISH') score += 16;
  else if (trend4h === 'BEARISH') score -= 16;

  if (trend1h === 'BULLISH') score += 16;
  else if (trend1h === 'BEARISH') score -= 16;

  if (trend4h === trend1h && trend4h !== 'NEUTRAL') {
    reasons.push(`4H & 1H trends aligned ${trend4h}`);
  }

  // 2. 15m EMA Ribbon & VWAP Structure (+/- 28)
  if (ema9 > ema21 && ema21 > ema50) {
    score += 18;
    reasons.push('15m EMA 9 > 21 > 50 bullish stack');
  } else if (ema9 < ema21 && ema21 < ema50) {
    score -= 18;
    reasons.push('15m EMA 9 < 21 < 50 bearish stack');
  }

  if (price > vwapVal) {
    score += 10;
    reasons.push('Price trading above session VWAP');
  } else if (price < vwapVal) {
    score -= 10;
    reasons.push('Price trading below session VWAP');
  }

  // 3. Momentum: MACD + RSI (+/- 22)
  if (macdVal.histogram > 0 && macdVal.macdLine > macdVal.signalLine) {
    score += 12;
  } else if (macdVal.histogram < 0 && macdVal.macdLine < macdVal.signalLine) {
    score -= 12;
  }

  if (rsi14 >= 52 && rsi14 <= 72) {
    score += 10;
    reasons.push(`Healthy bullish RSI (${rsi14.toFixed(1)})`);
  } else if (rsi14 <= 48 && rsi14 >= 28) {
    score -= 10;
    reasons.push(`Bearish momentum RSI (${rsi14.toFixed(1)})`);
  } else if (rsi14 > 78) {
    score -= 8;
    reasons.push(`RSI overbought risk (${rsi14.toFixed(1)})`);
  } else if (rsi14 < 22) {
    score += 8;
    reasons.push(`RSI oversold bounce risk (${rsi14.toFixed(1)})`);
  }

  // 4. ADX + Volume Expansion (+/- 12)
  if (adxVal.adx >= strategyConfig.minAdx) {
    const dir = adxVal.plusDi >= adxVal.minusDi ? 1 : -1;
    score += dir * (volRatio >= 1.2 ? 12 : 6);
    if (volRatio >= 1.2) {
      reasons.push(`ADX ${adxVal.adx.toFixed(1)} with ${volRatio.toFixed(2)}x volume`);
    }
  } else {
    reasons.push(`Weak trend strength (ADX ${adxVal.adx.toFixed(1)})`);
  }

  // 5. Funding Rate Crowding Guard (+/- 6)
  if (fundingRate > 0.0008) {
    score -= 6;
    reasons.push(`Elevated positive funding (${(fundingRate * 100).toFixed(3)}%)`);
  } else if (fundingRate < -0.0008) {
    score += 6;
    reasons.push(`Negative funding short squeeze skew (${(fundingRate * 100).toFixed(3)}%)`);
  }

  // Dampen trend score in ranging or choppy regimes to prevent whipsaw entries
  if (regime === 'RANGING' || regime === 'HIGH_VOLATILITY_CHOP') {
    score *= 0.45;
  }

  const technicalScore = clamp(Math.round(score), -100, 100);

  return {
    symbol,
    timestamp: candles15m.at(-1)?.closeTime ?? Date.now(),
    regime,
    trend4h,
    trend1h,
    trend15m,
    technicalScore,
    indicators15m,
    fundingRate,
    suggestedLongPlan: buildTradePlan(
      'LONG',
      price,
      atr14,
      sr.nearestSupport,
      sr.nearestResistance,
      strategyConfig,
    ),
    suggestedShortPlan: buildTradePlan(
      'SHORT',
      price,
      atr14,
      sr.nearestSupport,
      sr.nearestResistance,
      strategyConfig,
    ),
    reasons,
  };
}
