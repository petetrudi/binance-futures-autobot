import { describe, expect, it } from 'vitest';
import type { SymbolFilter } from '@bot/shared';
import {
  formatPrice,
  formatQuantity,
  meetsMinNotional,
  roundToStep,
} from '../market/precision.js';

const BTC_FILTER: SymbolFilter = {
  symbol: 'BTCUSDT',
  baseAsset: 'BTC',
  quoteAsset: 'USDT',
  pricePrecision: 1,
  quantityPrecision: 3,
  tickSize: 0.1,
  stepSize: 0.001,
  minQty: 0.001,
  maxQty: 1000,
  minNotional: 5,
  maxLeverage: 125,
};

const DOGE_FILTER: SymbolFilter = {
  symbol: 'DOGEUSDT',
  baseAsset: 'DOGE',
  quoteAsset: 'USDT',
  pricePrecision: 5,
  quantityPrecision: 0,
  tickSize: 0.00001,
  stepSize: 1,
  minQty: 1,
  maxQty: 1_000_000,
  minNotional: 5,
  maxLeverage: 75,
};

describe('Binance exchange precision helpers', () => {
  it('rounds values to step without IEEE-754 floating-point drift', () => {
    expect(roundToStep(0.30000000000000004, 0.1, 'floor')).toBe(0.3);
    expect(roundToStep(1.2399, 0.01, 'floor')).toBe(1.23);
    expect(roundToStep(1.231, 0.01, 'ceil')).toBe(1.24);
    expect(roundToStep(1.236, 0.01, 'round')).toBe(1.24);
    expect(roundToStep(100.07, 0.05, 'round')).toBe(100.05);
  });

  it('formats quantity respecting stepSize, minQty, and maxQty', () => {
    expect(formatQuantity(0.12398, BTC_FILTER)).toBe(0.123);
    expect(formatQuantity(0.0004, BTC_FILTER)).toBe(0);
    expect(formatQuantity(2500, BTC_FILTER)).toBe(1000);
    expect(formatQuantity(48.9, DOGE_FILTER)).toBe(48);
  });

  it('formats price respecting tickSize', () => {
    expect(formatPrice(61234.567, BTC_FILTER)).toBe(61234.6);
    expect(formatPrice(0.1234567, DOGE_FILTER)).toBe(0.12346);
  });

  it('validates minNotional requirement accurately', () => {
    expect(meetsMinNotional(0.001, 60000, BTC_FILTER)).toBe(true);
    expect(meetsMinNotional(30, 0.15, DOGE_FILTER)).toBe(false);
    expect(meetsMinNotional(35, 0.15, DOGE_FILTER)).toBe(true);
  });
});
