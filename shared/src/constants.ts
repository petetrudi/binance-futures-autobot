import type { RiskConfig, StrategyConfig } from './types.js';

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  defaultLeverage: 3,
  riskPerTradePct: 1.5,
  maxMarginPerTradePct: 25,
  maxConcurrentPositions: 3,
  maxSameDirectionPositions: 2,
  maxDailyLossPct: 5,
  symbolCooldownMinutes: 45,
  takerFeePct: 0.05,
  slippagePct: 0.03,
};

export const DEFAULT_STRATEGY_CONFIG: StrategyConfig = {
  minVolume24hUsdt: 20_000_000,
  scannerTopN: 8,
  minConfidence: 65,
  minRiskReward: 1.8,
  minAdx: 18,
  stopLossAtrMultiplier: 1.6,
  tp1RiskReward: 1.5,
  tp2RiskReward: 2.8,
  trailingAtrMultiplier: 1.2,
  maxHoldHours: 12,
  scanIntervalSeconds: 60,
  newsRefreshMinutes: 3,
  enableAutoTrading: true,
  btcMacroShockPct: 2.5,
  geminiModel: 'gemini-3.8-flash',
};

export const STABLECOIN_SYMBOLS = new Set([
  'USDCUSDT',
  'FDUSDUSDT',
  'BUSDUSDT',
  'TUSDUSDT',
  'USDPUSDT',
  'DAIUSDT',
  'EURUSDT',
]);
