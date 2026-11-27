export type TradingMode = 'PAPER' | 'TESTNET' | 'LIVE';

export type Timeframe = '5m' | '15m' | '1h' | '4h';

export type Side = 'LONG' | 'SHORT';

export type SignalAction = 'LONG' | 'SHORT' | 'HOLD';

export type MarketRegime =
  | 'STRONG_TREND_UP'
  | 'STRONG_TREND_DOWN'
  | 'RANGING'
  | 'HIGH_VOLATILITY_CHOP';

export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  quoteVolume?: number;
}

export interface SymbolFilter {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  pricePrecision: number;
  quantityPrecision: number;
  tickSize: number;
  stepSize: number;
  minQty: number;
  maxQty: number;
  minNotional: number;
  maxLeverage: number;
}

export interface MarketTicker {
  symbol: string;
  lastPrice: number;
  markPrice: number;
  indexPrice: number;
  priceChangePercent24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  quoteVolume24h: number;
  fundingRate: number;
  nextFundingTime: number;
  updatedAt: number;
}

export interface ScannerCandidate {
  symbol: string;
  lastPrice: number;
  markPrice: number;
  priceChangePercent24h: number;
  intradayRangePct: number;
  quoteVolume24h: number;
  fundingRate: number;
  liquidityScore: number;
  volatilityScore: number;
  catalystScore: number;
  scannerScore: number;
  activeNewsCount: number;
  hasHighImpactNews: boolean;
  reasons: string[];
  updatedAt: number;
}

export interface TechnicalIndicators {
  price: number;
  ema9: number;
  ema21: number;
  ema50: number;
  ema200: number;
  rsi14: number;
  macdLine: number;
  macdSignal: number;
  macdHistogram: number;
  atr14: number;
  atrPct: number;
  adx14: number;
  plusDi: number;
  minusDi: number;
  vwap: number;
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
  volumeRatio: number;
  nearestSupport: number | null;
  nearestResistance: number | null;
}

export interface TradePlan {
  side: Side;
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  takeProfit3: number;
  riskRewardRatio: number;
  stopDistancePct: number;
}

export interface TechnicalAnalysis {
  symbol: string;
  timestamp: number;
  regime: MarketRegime;
  trend4h: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  trend1h: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  trend15m: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  technicalScore: number; // -100 to +100
  indicators15m: TechnicalIndicators;
  fundingRate: number;
  suggestedLongPlan: TradePlan;
  suggestedShortPlan: TradePlan;
  reasons: string[];
}

export type NewsImpact = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type SentimentLabel = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
export type NewsAnalysisSource = 'GEMINI_AI' | 'LEXICON';

export interface NewsItem {
  id: string;
  urlHash: string;
  source: string;
  title: string;
  url: string;
  publishedAt: number;
  symbols: string[];
  sentiment: SentimentLabel;
  score: number; // -100 to +100
  impact: NewsImpact;
  isBlackSwan: boolean;
  summary: string;
  analysisSource: NewsAnalysisSource;
  createdAt: number;
}

export interface CoinNewsContext {
  symbol: string;
  newsScore: number; // -100 to +100
  articleCount: number;
  coinSpecificCount: number;
  hasRecentHighImpact: boolean;
  hasBlackSwanAlert: boolean;
  dominantSentiment: SentimentLabel;
  headlineSummaries: string[];
}

export interface TradeSignal {
  id: string;
  symbol: string;
  action: SignalAction;
  regime: MarketRegime;
  technicalScore: number;
  newsScore: number;
  compositeScore: number;
  confidence: number; // 0 to 100
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  takeProfit3: number;
  riskRewardRatio: number;
  atr: number;
  executed: boolean;
  emergencyCloseRequired: boolean;
  reasons: string[];
  vetoReasons: string[];
  createdAt: number;
}

export interface RiskConfig {
  defaultLeverage: number;
  riskPerTradePct: number;
  maxMarginPerTradePct: number;
  maxConcurrentPositions: number;
  maxSameDirectionPositions: number;
  maxDailyLossPct: number;
  symbolCooldownMinutes: number;
  takerFeePct: number;
  slippagePct: number;
  maxAccountCapitalUsdt?: number;
}

export interface StrategyConfig {
  minVolume24hUsdt: number;
  scannerTopN: number;
  minConfidence: number;
  minRiskReward: number;
  minAdx: number;
  stopLossAtrMultiplier: number;
  tp1RiskReward: number;
  tp2RiskReward: number;
  tp3RiskReward: number;
  tp1ClosePct: number;
  tp2ClosePct: number;
  trailingAtrMultiplier: number;
  maxHoldHours: number;
  scanIntervalSeconds: number;
  newsRefreshMinutes: number;
  enableAutoTrading: boolean;
  btcMacroShockPct: number;
  geminiModel: string;
}

export interface RiskEvaluation {
  approved: boolean;
  rejectionReason: string | null;
  quantity: number;
  notionalUsdt: number;
  requiredMarginUsdt: number;
  leverage: number;
  riskUsdt: number;
  rewardUsdt: number;
  estimatedLiquidationPrice: number;
}

export type PositionStatus = 'OPEN' | 'CLOSED';

export interface Position {
  id: string;
  mode: TradingMode;
  symbol: string;
  side: Side;
  status: PositionStatus;
  entryPrice: number;
  markPrice: number;
  quantity: number;
  remainingQuantity: number;
  leverage: number;
  isolatedMargin: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  takeProfit3: number;
  tp1Hit: boolean;
  tp2Hit: boolean;
  trailingActive: boolean;
  peakPrice: number;
  entryAtr: number;
  liquidationPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  feesPaid: number;
  confidence: number;
  entryReasons: string[];
  closeReason: string | null;
  slOrderId: string | null;
  tpOrderId: string | null;
  openedAt: number;
  closedAt: number | null;
}

export type TradeAction =
  | 'OPEN'
  | 'PARTIAL_TP1'
  | 'PARTIAL_TP2'
  | 'CLOSE_SL'
  | 'CLOSE_TP2'
  | 'CLOSE_TP3'
  | 'CLOSE_TRAILING'
  | 'CLOSE_EMERGENCY'
  | 'CLOSE_TIME_EXIT'
  | 'CLOSE_MANUAL'
  | 'CLOSE_KILL_SWITCH'
  | 'LIQUIDATION';

export interface TradeRecord {
  id: string;
  positionId: string;
  mode: TradingMode;
  symbol: string;
  side: Side;
  action: TradeAction;
  price: number;
  quantity: number;
  notional: number;
  fee: number;
  realizedPnl: number;
  reason: string;
  exchangeOrderId: string | null;
  createdAt: number;
}

export interface AccountSummary {
  mode: TradingMode;
  walletBalance: number;
  availableBalance: number;
  isolatedMarginUsed: number;
  unrealizedPnl: number;
  totalEquity: number;
  initialCapitalUsdt?: number;
  startingDayEquity: number;
  dailyPnl: number;
  dailyPnlPct: number;
  dailyLossLimitPct: number;
  circuitBreakerTripped: boolean;
  totalTrades: number;
  winRatePct: number;
  profitFactor: number;
}

export interface BacktestRequest {
  symbol: string;
  interval: '15m' | '1h';
  bars: number;
  initialCapital: number;
  leverage: number;
  riskPerTradePct: number;
  minConfidence: number;
}

export interface BacktestEquityPoint {
  time: number;
  equity: number;
}

export interface BacktestTrade {
  entryTime: number;
  exitTime: number;
  side: Side;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  realizedPnl: number;
  feesPaid: number;
  exitReason: string;
  confidence: number;
}

export interface BacktestResult {
  symbol: string;
  interval: string;
  barsTested: number;
  startTime: number;
  endTime: number;
  initialCapital: number;
  finalEquity: number;
  netPnlUsdt: number;
  netPnlPct: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePct: number;
  profitFactor: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  equityCurve: BacktestEquityPoint[];
  trades: BacktestTrade[];
}

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';

export interface SystemLog {
  id: number;
  level: LogLevel;
  module: string;
  message: string;
  meta: Record<string, unknown> | null;
  createdAt: number;
}

export interface BotStatus {
  running: boolean;
  mode: TradingMode;
  killSwitchActive: boolean;
  marketStreamConnected: boolean;
  klinesFallbackActive: boolean;
  geminiEnabled: boolean;
  telegramEnabled: boolean;
  lastScanAt: number | null;
  lastNewsRefreshAt: number | null;
  lastTickAt: number | null;
  scannerInProgress: boolean;
  newsRefreshInProgress: boolean;
  uptimeSeconds: number;
}

export interface SettingsView {
  mode: TradingMode;
  liveConfirmed: boolean;
  risk: RiskConfig;
  strategy: StrategyConfig;
  credentials: {
    hasBinanceKey: boolean;
    hasBinanceSecret: boolean;
    hasGeminiKey: boolean;
    hasCryptoPanicKey: boolean;
    hasTelegramConfig: boolean;
    binanceFapiBaseUrl: string;
    binanceFwsBaseUrl: string;
  };
}

export interface SettingsUpdatePayload {
  mode?: TradingMode;
  liveConfirmed?: boolean;
  risk?: Partial<RiskConfig>;
  strategy?: Partial<StrategyConfig>;
  credentials?: {
    binanceApiKey?: string;
    binanceApiSecret?: string;
    geminiApiKey?: string;
    cryptoPanicApiKey?: string;
    telegramBotToken?: string;
    telegramChatId?: string;
    binanceFapiBaseUrl?: string;
    binanceFwsBaseUrl?: string;
  };
}

export interface CandleChartResponse {
  symbol: string;
  interval: Timeframe;
  candles: Candle[];
  ema9: Array<{ time: number; value: number }>;
  ema21: Array<{ time: number; value: number }>;
  ema50: Array<{ time: number; value: number }>;
  technical: TechnicalAnalysis | null;
  newsContext: CoinNewsContext | null;
}

export interface AuthStatusResponse {
  pinRequired: boolean;
  pinLength: number;
  authenticated: boolean;
  isDefaultPin?: boolean;
}

export interface AuthVerifyResponse {
  token: string;
  expiresAt: number;
  isDefaultPin: boolean;
}

export interface DashboardSnapshot {
  status: BotStatus;
  account: AccountSummary;
  positions: Position[];
  closedPositions: Position[];
  scanner: ScannerCandidate[];
  signals: TradeSignal[];
  news: NewsItem[];
  trades: TradeRecord[];
  logs: SystemLog[];
  settings: SettingsView;
}

export type WsMessage =
  | { type: 'snapshot'; data: DashboardSnapshot }
  | { type: 'tick'; data: { status: BotStatus; account: AccountSummary; positions: Position[] } }
  | { type: 'scanner'; data: { scanner: ScannerCandidate[]; signals: TradeSignal[] } }
  | { type: 'news'; data: { news: NewsItem[] } }
  | { type: 'log'; data: SystemLog };
