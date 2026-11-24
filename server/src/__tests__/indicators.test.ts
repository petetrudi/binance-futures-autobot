import { describe, expect, it } from 'vitest';
import {
  adx,
  atr,
  bollingerBands,
  detectSupportResistance,
  ema,
  macd,
  rsi,
  sma,
  volumeRatio,
  vwap,
} from '../analysis/indicators.js';
import { makeTrendCandles } from './fixtures.js';

describe('Technical indicators engine', () => {
  it('computes SMA and EMA accurately on sequential arrays', () => {
    expect(sma([10, 20, 30, 40, 50], 3)).toBeCloseTo(40, 6);
    const e = ema([10, 11, 12, 13, 14, 15], 3);
    expect(e).toBeGreaterThan(13);
    expect(e).toBeLessThan(15);
  });

  it('computes RSI near upper zone on strong uptrend and lower zone on strong downtrend', () => {
    const up = makeTrendCandles(60, 100, 1.4, 0.001).map((c) => c.close);
    const down = makeTrendCandles(60, 200, -1.4, 0.001).map((c) => c.close);

    expect(rsi(up, 14)).toBeGreaterThan(68);
    expect(rsi(down, 14)).toBeLessThan(32);
  });

  it('computes positive MACD histogram on accelerating uptrend', () => {
    const up = makeTrendCandles(80, 100, 1.5, 0.001).map((c) => c.close);
    const res = macd(up);
    expect(res.macdLine).toBeGreaterThan(0);
    expect(res.signalLine).toBeGreaterThan(0);
  });

  it('computes positive Wilder ATR and ADX on directional candles', () => {
    const candles = makeTrendCandles(80, 100, 1.2, 0.002);
    const atrVal = atr(candles, 14);
    const adxVal = adx(candles, 14);

    expect(atrVal).toBeGreaterThan(0);
    expect(adxVal.adx).toBeGreaterThan(25);
    expect(adxVal.plusDi).toBeGreaterThan(adxVal.minusDi);
  });

  it('computes Bollinger Bands ordered lower < middle < upper', () => {
    const closes = makeTrendCandles(40, 500, 1.2, 0.008).map((c) => c.close);
    const bb = bollingerBands(closes, 20, 2);
    expect(bb.lower).toBeLessThan(bb.middle);
    expect(bb.middle).toBeLessThan(bb.upper);
  });

  it('computes VWAP, volumeRatio, and nearest Support/Resistance levels', () => {
    const candles = makeTrendCandles(60, 100, 0.3, 0.015);
    const vwapVal = vwap(candles.slice(-24));
    const volRatio = volumeRatio(candles, 20);
    const sr = detectSupportResistance(candles, 100);

    expect(vwapVal).toBeGreaterThan(80);
    expect(volRatio).toBeGreaterThan(0);
    expect(sr.nearestSupport === null || sr.nearestSupport <= candles.at(-1)!.close).toBe(true);
    expect(sr.nearestResistance === null || sr.nearestResistance >= candles.at(-1)!.close).toBe(true);
  });
});
