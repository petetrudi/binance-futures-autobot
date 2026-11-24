import type { Candle } from '@bot/shared';

export function makeTrendCandles(
  count: number,
  startPrice: number,
  driftPerBar: number,
  amplitude = 0.004,
  intervalMs = 15 * 60_000,
  startTime = 1_760_000_000_000,
): Candle[] {
  const candles: Candle[] = [];
  let price = startPrice;

  for (let i = 0; i < count; i++) {
    const wave = Math.sin(i * 0.45) * amplitude * price;
    const open = price;
    const close = Math.max(0.01, open + driftPerBar + wave * 0.25);
    const wick = Math.max(Math.abs(close - open) * 0.45, price * amplitude * 0.6);
    const high = Math.max(open, close) + wick;
    const low = Math.max(0.005, Math.min(open, close) - wick);
    const volume = 1_200 + (i % 7 === 0 ? 1_800 : (i % 4) * 200);
    const openTime = startTime + i * intervalMs;
    candles.push({
      openTime,
      open,
      high,
      low,
      close,
      volume,
      closeTime: openTime + intervalMs - 1,
      quoteVolume: volume * close,
    });
    price = close;
  }

  return candles;
}

export function makeChopCandles(
  count: number,
  centerPrice: number,
  swingPct = 0.006,
  intervalMs = 15 * 60_000,
  startTime = 1_760_000_000_000,
): Candle[] {
  const candles: Candle[] = [];
  for (let i = 0; i < count; i++) {
    const prevOffset = Math.sin((i - 1) * 1.1) * swingPct * centerPrice;
    const nextOffset = Math.sin(i * 1.1) * swingPct * centerPrice;
    const open = centerPrice + prevOffset;
    const close = centerPrice + nextOffset;
    const high = Math.max(open, close) + centerPrice * 0.003;
    const low = Math.min(open, close) - centerPrice * 0.003;
    const openTime = startTime + i * intervalMs;
    candles.push({
      openTime,
      open,
      high,
      low,
      close,
      volume: 1_000,
      closeTime: openTime + intervalMs - 1,
      quoteVolume: 1_000 * close,
    });
  }
  return candles;
}
