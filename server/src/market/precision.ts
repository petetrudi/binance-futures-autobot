import type { SymbolFilter } from '@bot/shared';

function stepDecimals(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 8;
  const text = step.toString().toLowerCase();
  if (text.includes('e-')) {
    const exp = Number(text.split('e-')[1]);
    return Number.isFinite(exp) ? exp : 8;
  }
  const dotIdx = text.indexOf('.');
  return dotIdx === -1 ? 0 : text.length - dotIdx - 1;
}

/**
 * Rounds a number to the nearest exchange step increment without IEEE-754 drift.
 */
export function roundToStep(
  value: number,
  step: number,
  mode: 'floor' | 'round' | 'ceil' = 'floor',
): number {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) {
    return value;
  }
  const decimals = Math.max(stepDecimals(step), 0);
  const scale = 10 ** Math.min(decimals + 4, 12);
  const scaledVal = Math.round(value * scale);
  const scaledStep = Math.round(step * scale);
  if (scaledStep <= 0) return Number(value.toFixed(decimals));

  const ratio = scaledVal / scaledStep;
  const units =
    mode === 'floor'
      ? Math.floor(ratio + 1e-9)
      : mode === 'ceil'
        ? Math.ceil(ratio - 1e-9)
        : Math.round(ratio);

  const result = (units * scaledStep) / scale;
  return Number(result.toFixed(decimals));
}

export function formatQuantity(quantity: number, filter: SymbolFilter): number {
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  const capped = Math.min(quantity, filter.maxQty);
  const rounded = roundToStep(capped, filter.stepSize, 'floor');
  if (rounded < filter.minQty) return 0;
  return Number(rounded.toFixed(filter.quantityPrecision));
}

export function formatPrice(price: number, filter: SymbolFilter): number {
  if (!Number.isFinite(price) || price <= 0) return 0;
  const rounded = roundToStep(price, filter.tickSize, 'round');
  return Number(rounded.toFixed(filter.pricePrecision));
}

export function meetsMinNotional(
  quantity: number,
  price: number,
  filter: SymbolFilter,
): boolean {
  if (quantity <= 0 || price <= 0) return false;
  return quantity * price >= filter.minNotional;
}
