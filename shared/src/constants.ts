import type { RiskConfig, StrategyConfig } from './types.js';

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  defaultLeverage: 2,
  riskPerTradePct: 0.75,
  maxMarginPerTradePct: 10,
  maxConcurrentPositions: 2,
  maxSameDirectionPositions: 2,
  maxDailyLossPct: 3,
  symbolCooldownMinutes: 45,
  takerFeePct: 0.05,
  slippagePct: 0.03,
  maxAccountCapitalUsdt: 500,
};

export const DEFAULT_STRATEGY_CONFIG: StrategyConfig = {
  minVolume24hUsdt: 20_000_000,
  scannerTopN: 8,
  minConfidence: 72,
  minRiskReward: 1.8,
  minAdx: 18,
  stopLossAtrMultiplier: 1.6,
  tp1RiskReward: 1.0,
  tp2RiskReward: 1.8,
  tp3RiskReward: 3.0,
  tp1ClosePct: 50,
  tp2ClosePct: 30,
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
