import type { Candle } from '@bot/shared';

export function sma(values: number[], period: number): number {
  if (values.length === 0 || period <= 0) return 0;
  const slice = values.slice(-period);
  return slice.reduce((acc, v) => acc + v, 0) / slice.length;
}

export function emaSeries(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const result: number[] = new Array(values.length);

  if (values.length < period) {
    let running = values[0];
    result[0] = running;
    for (let i = 1; i < values.length; i++) {
      running = values[i] * k + running * (1 - k);
      result[i] = running;
    }
    return result;
  }

  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  seed /= period;

  for (let i = 0; i < period - 1; i++) result[i] = values[i];
  result[period - 1] = seed;

  let prev = seed;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    result[i] = prev;
  }
  return result;
}

export function ema(values: number[], period: number): number {
  const series = emaSeries(values, period);
  return series.at(-1) ?? 0;
}

export function rsi(values: number[], period = 14): number {
  if (values.length <= period) return 50;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gainSum += diff;
    else lossSum += -diff;
  }

  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function macd(
  values: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): { macdLine: number; signalLine: number; histogram: number } {
  if (values.length < slowPeriod + 2) {
    return { macdLine: 0, signalLine: 0, histogram: 0 };
  }
  const fast = emaSeries(values, fastPeriod);
  const slow = emaSeries(values, slowPeriod);
  const macdSeries = values.map((_, i) => fast[i] - slow[i]);
  const validMacd = macdSeries.slice(slowPeriod - 1);
  const signalSeries = emaSeries(validMacd, signalPeriod);

  const macdLine = validMacd.at(-1) ?? 0;
  const signalLine = signalSeries.at(-1) ?? 0;
  return {
    macdLine,
    signalLine,
    histogram: macdLine - signalLine,
  };
}

export function atr(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i];
    const prevClose = candles[i - 1].close;
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prevClose),
      Math.abs(cur.low - prevClose),
    );
    trs.push(tr);
  }

  if (trs.length < period) {
    return trs.reduce((a, b) => a + b, 0) / trs.length;
  }

  let wilderAtr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    wilderAtr = (wilderAtr * (period - 1) + trs[i]) / period;
  }
  return wilderAtr;
}

export function bollingerBands(
  values: number[],
  period = 20,
  stdMult = 2,
): { upper: number; middle: number; lower: number } {
  if (values.length === 0) return { upper: 0, middle: 0, lower: 0 };
  const slice = values.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / slice.length;
  const variance =
    slice.reduce((acc, v) => acc + (v - middle) ** 2, 0) / slice.length;
  const stdDev = Math.sqrt(variance);
  return {
    upper: middle + stdMult * stdDev,
    middle,
    lower: middle - stdMult * stdDev,
  };
}

export function adx(
  candles: Candle[],
  period = 14,
): { adx: number; plusDi: number; minusDi: number } {
  if (candles.length <= period * 2) {
    return { adx: 15, plusDi: 15, minusDi: 15 };
  }

  const trList: number[] = [];
  const plusDmList: number[] = [];
  const minusDmList: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i];
    const prev = candles[i - 1];
    const upMove = cur.high - prev.high;
    const downMove = prev.low - cur.low;

    plusDmList.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDmList.push(downMove > upMove && downMove > 0 ? downMove : 0);

    trList.push(
      Math.max(
        cur.high - cur.low,
        Math.abs(cur.high - prev.close),
        Math.abs(cur.low - prev.close),
      ),
    );
  }

  let smoothTr = trList.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothPlusDm = plusDmList.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothMinusDm = minusDmList.slice(0, period).reduce((a, b) => a + b, 0);

  const dxValues: number[] = [];
  let lastPlusDi = 0;
  let lastMinusDi = 0;

  for (let i = period; i < trList.length; i++) {
    if (i > period) {
      smoothTr = smoothTr - smoothTr / period + trList[i];
      smoothPlusDm = smoothPlusDm - smoothPlusDm / period + plusDmList[i];
      smoothMinusDm = smoothMinusDm - smoothMinusDm / period + minusDmList[i];
    }

    lastPlusDi = smoothTr > 0 ? (100 * smoothPlusDm) / smoothTr : 0;
    lastMinusDi = smoothTr > 0 ? (100 * smoothMinusDm) / smoothTr : 0;
    const diSum = lastPlusDi + lastMinusDi;
    dxValues.push(diSum > 0 ? (100 * Math.abs(lastPlusDi - lastMinusDi)) / diSum : 0);
  }

  if (dxValues.length < period) {
    const avgDx = dxValues.reduce((a, b) => a + b, 0) / Math.max(dxValues.length, 1);
    return { adx: avgDx, plusDi: lastPlusDi, minusDi: lastMinusDi };
  }

  let adxVal = dxValues.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dxValues.length; i++) {
    adxVal = (adxVal * (period - 1) + dxValues[i]) / period;
  }

  return {
    adx: adxVal,
    plusDi: lastPlusDi,
    minusDi: lastMinusDi,
  };
}

export function vwap(candles: Candle[]): number {
  if (candles.length === 0) return 0;
  let pvSum = 0;
  let volSum = 0;
  for (const c of candles) {
    const typical = (c.high + c.low + c.close) / 3;
    pvSum += typical * c.volume;
    volSum += c.volume;
  }
  return volSum > 0 ? pvSum / volSum : candles.at(-1)!.close;
}

export function volumeRatio(candles: Candle[], lookback = 20): number {
  if (candles.length < 2) return 1;
  const current = candles.at(-1)!.volume;
  const prior = candles.slice(-(lookback + 1), -1);
  if (prior.length === 0) return 1;
  const avg = prior.reduce((acc, c) => acc + c.volume, 0) / prior.length;
  return avg > 0 ? current / avg : 1;
}

export function detectSupportResistance(
  candles: Candle[],
  lookback = 80,
): { nearestSupport: number | null; nearestResistance: number | null } {
  const window = candles.slice(-lookback);
  if (window.length < 7) {
    return { nearestSupport: null, nearestResistance: null };
  }

  const currentPrice = window.at(-1)!.close;
  const supports: number[] = [];
  const resistances: number[] = [];

  for (let i = 2; i < window.length - 2; i++) {
    const c = window[i];
    if (
      c.low < window[i - 1].low &&
      c.low < window[i - 2].low &&
      c.low <= window[i + 1].low &&
      c.low <= window[i + 2].low
    ) {
      supports.push(c.low);
    }
    if (
      c.high > window[i - 1].high &&
      c.high > window[i - 2].high &&
      c.high >= window[i + 1].high &&
      c.high >= window[i + 2].high
    ) {
      resistances.push(c.high);
    }
  }

  const below = supports.filter((s) => s < currentPrice);
  const above = resistances.filter((r) => r > currentPrice);

  return {
    nearestSupport: below.length > 0 ? Math.max(...below) : null,
    nearestResistance: above.length > 0 ? Math.min(...above) : null,
  };
}
