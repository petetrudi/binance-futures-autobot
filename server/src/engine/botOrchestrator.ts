import { EventEmitter } from 'node:events';
import type {
  AccountSummary,
  BacktestRequest,
  BacktestResult,
  BotStatus,
  CandleChartResponse,
  DashboardSnapshot,
  LogLevel,
  NewsItem,
  Position,
  RiskConfig,
  ScannerCandidate,
  SettingsUpdatePayload,
  SettingsView,
  StrategyConfig,
  SymbolFilter,
  SystemLog,
  TechnicalAnalysis,
  Timeframe,
  TradeSignal,
  TradingMode,
} from '@bot/shared';
import { emaSeries } from '../analysis/indicators.js';
import { analyzeMultiTimeframe } from '../analysis/technicalAnalyzer.js';
import { runHistoricalBacktest } from '../backtest/backtester.js';
import type { BotDatabase } from '../db/database.js';
import {
  BinanceFuturesBroker,
  PaperBroker,
  type ExecutionBroker,
} from '../execution/broker.js';
import {
  computeUnrealizedPnl,
  evaluatePositionTick,
} from '../execution/positionLifecycle.js';
import { scanMarketCandidates } from '../market/autoScanner.js';
import type { BinanceFuturesClient } from '../market/binanceClient.js';
import type { MarketStream } from '../market/marketStream.js';
import { fetchCryptoNews } from '../news/newsFetcher.js';
import {
  analyzeArticlesBatch,
  getCoinNewsContext,
} from '../news/sentimentAnalyzer.js';
import type { TelegramNotifier } from '../notifications/telegramNotifier.js';
import { evaluateRisk } from '../risk/riskManager.js';
import { evaluateSignal } from '../strategy/decisionEngine.js';

export interface RuntimeCredentials {
  binanceApiKey: string;
  binanceApiSecret: string;
  binanceFapiBaseUrl: string;
  binanceFwsBaseUrl: string;
  geminiApiKey: string;
  cryptoPanicApiKey: string;
  telegramBotToken: string;
  telegramChatId: string;
}

export class BotOrchestrator extends EventEmitter {
  private running = true;
  private killSwitchActive = false;
  private liveConfirmed = false;
  private mode: TradingMode;
  private riskConfig: RiskConfig;
  private strategyConfig: StrategyConfig;
  private credentials: RuntimeCredentials;
  private broker: ExecutionBroker;

  private scannerCandidates: ScannerCandidate[] = [];
  private latestTechnical = new Map<string, TechnicalAnalysis>();
  private latestSignals = new Map<string, TradeSignal>();
  private exchangeFilters = new Map<string, SymbolFilter>();
  private perpetualSymbols = new Set<string>();

  private lastScanAt: number | null = null;
  private lastNewsRefreshAt: number | null = null;
  private lastTickAt: number | null = null;
  private lastExchangeSyncAt = 0;
  private scannerInProgress = false;
  private newsRefreshInProgress = false;
  private tickInProgress = false;
  private readonly startedAt = Date.now();

  private positionTimer: NodeJS.Timeout | null = null;
  private scanTimer: NodeJS.Timeout | null = null;
  private newsTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: BotDatabase,
    private readonly binanceClient: BinanceFuturesClient,
    private readonly marketStream: MarketStream,
    private readonly telegram: TelegramNotifier,
    initialCreds: RuntimeCredentials,
    envModeOverride?: TradingMode,
    liveConfirmed = false,
  ) {
    super();
    this.credentials = { ...initialCreds };
    this.liveConfirmed = liveConfirmed;
    this.riskConfig = db.getRiskConfig();
    this.strategyConfig = db.getStrategyConfig();

    const storedMode = envModeOverride ?? db.getTradingMode();
    if (
      (storedMode === 'TESTNET' || storedMode === 'LIVE') &&
      (!this.credentials.binanceApiKey || !this.credentials.binanceApiSecret)
    ) {
      this.mode = 'PAPER';
      db.saveTradingMode('PAPER');
    } else if (storedMode === 'LIVE' && !this.liveConfirmed) {
      this.mode = 'PAPER';
      db.saveTradingMode('PAPER');
    } else {
      this.mode = storedMode;
    }

    this.binanceClient.updateConfig({
      mode: this.mode,
      apiKey: this.credentials.binanceApiKey,
      apiSecret: this.credentials.binanceApiSecret,
      fapiBaseUrl: this.credentials.binanceFapiBaseUrl,
    });
    this.telegram.updateCredentials(
      this.credentials.telegramBotToken,
      this.credentials.telegramChatId,
    );
    this.broker = this.createBroker(this.mode);
  }

  private createBroker(mode: TradingMode): ExecutionBroker {
    if (mode === 'TESTNET' || mode === 'LIVE') {
      return new BinanceFuturesBroker(mode, this.db, this.binanceClient);
    }
    return new PaperBroker(this.db);
  }

  private log(
    level: LogLevel,
    module: string,
    message: string,
    meta: Record<string, unknown> | null = null,
  ): SystemLog {
    const entry = this.db.addLog(level, module, message, meta);
    this.emit('log', entry);
    return entry;
  }

  async startEngine(): Promise<void> {
    this.log('INFO', 'Engine', `Starting autonomous bot engine in ${this.mode} mode`);

    // Load exchange precision filters (non-fatal if offline briefly)
    try {
      this.exchangeFilters = await this.binanceClient.getExchangeFilters();
      this.perpetualSymbols = new Set(this.exchangeFilters.keys());
      this.log(
        'INFO',
        'Market',
        `Loaded ${this.exchangeFilters.size} USD-M perpetual symbol filters`,
      );
    } catch (err) {
      this.log('WARN', 'Market', 'Failed to preload exchange filters', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    await this.marketStream.start();

    if (this.broker.reconcileStartup) {
      try {
        await this.broker.reconcileStartup();
        this.log('INFO', 'Broker', `Reconciled ${this.mode} exchange positions`);
      } catch (err) {
        this.log('WARN', 'Broker', 'Startup position reconciliation failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Kick off initial news + scanner cycle asynchronously so HTTP server binds immediately
    void (async () => {
      await this.refreshNews();
      await this.runScannerCycle();
    })();

    this.scheduleTimers();
  }

  private scheduleTimers(): void {
    this.clearTimers();

    this.positionTimer = setInterval(() => {
      void this.monitorPositionsTick();
    }, 2000);

    const scanMs = Math.max(15, this.strategyConfig.scanIntervalSeconds) * 1000;
    this.scanTimer = setInterval(() => {
      void this.runScannerCycle();
    }, scanMs);

    const newsMs = Math.max(1, this.strategyConfig.newsRefreshMinutes) * 60_000;
    this.newsTimer = setInterval(() => {
      void this.refreshNews();
    }, newsMs);
  }

  private clearTimers(): void {
    if (this.positionTimer) clearInterval(this.positionTimer);
    if (this.scanTimer) clearInterval(this.scanTimer);
    if (this.newsTimer) clearInterval(this.newsTimer);
    this.positionTimer = null;
    this.scanTimer = null;
    this.newsTimer = null;
  }

  async shutdown(): Promise<void> {
    this.clearTimers();
    this.marketStream.stop();
    this.db.close();
  }

  private getFilter(symbol: string, fallbackPrice: number): SymbolFilter {
    return (
      this.exchangeFilters.get(symbol) ??
      this.binanceClient.getDefaultFilter(symbol, fallbackPrice)
    );
  }

  async refreshNews(): Promise<NewsItem[]> {
    if (this.newsRefreshInProgress) return this.db.getRecentNews(50);
    this.newsRefreshInProgress = true;
    try {
      const raw = await fetchCryptoNews(this.credentials.cryptoPanicApiKey);
      const unseen = raw.filter((item) => !this.db.hasNewsHash(item.urlHash));
      if (unseen.length > 0) {
        const analyzed = await analyzeArticlesBatch(unseen.slice(0, 24), {
          apiKey: this.credentials.geminiApiKey,
          model: this.strategyConfig.geminiModel,
        });
        const inserted = this.db.insertNewsItems(analyzed);
        if (inserted > 0) {
          const aiCount = analyzed.filter((n) => n.analysisSource === 'GEMINI_AI').length;
          this.log(
            'INFO',
            'News',
            `Ingested ${inserted} new articles (${aiCount} Gemini AI, ${inserted - aiCount} Lexicon)`,
          );
          const blackSwans = analyzed.filter((n) => n.isBlackSwan);
          for (const bs of blackSwans) {
            this.log('WARN', 'News', `BLACK SWAN ALERT: ${bs.title}`, {
              symbols: bs.symbols,
              score: bs.score,
            });
            void this.telegram.sendAlert('BLACK SWAN NEWS ALERT', [
              `Title: ${bs.title}`,
              `Symbols: ${bs.symbols.join(', ')}`,
              `Score: ${bs.score}`,
            ]);
          }
        }
      }
      this.lastNewsRefreshAt = Date.now();
      const recent = this.db.getRecentNews(60);
      this.emit('news', { news: recent });
      return recent;
    } catch (err) {
      this.log('ERROR', 'News', 'News refresh cycle failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return this.db.getRecentNews(60);
    } finally {
      this.newsRefreshInProgress = false;
    }
  }

  async runScannerCycle(): Promise<{
    scanner: ScannerCandidate[];
    signals: TradeSignal[];
  }> {
    if (this.scannerInProgress) {
      return {
        scanner: this.scannerCandidates,
        signals: Array.from(this.latestSignals.values()),
      };
    }

    this.scannerInProgress = true;
    try {
      let tickers = this.marketStream.getAllTickers();
      if (tickers.length === 0) {
        tickers = await this.binanceClient.fetchTickersRest();
      }
      const recentNews = this.db.getRecentNews(80, Date.now() - 12 * 3_600_000);
      const realVolumeMap = await this.binanceClient.getRealSpotVolumeMap();

      const candidates = scanMarketCandidates(
        tickers,
        recentNews,
        this.perpetualSymbols,
        this.strategyConfig,
        Date.now(),
        realVolumeMap,
      );
      this.scannerCandidates = candidates;

      // Compute BTC 1H change for macro shock protection
      let btcChange1hPct = 0;
      const btc1h = await this.binanceClient.getKlines('BTCUSDT', '1h', 3);
      if (btc1h.length >= 2) {
        const prev = btc1h[btc1h.length - 2].close;
        const cur = btc1h[btc1h.length - 1].close;
        if (prev > 0) btcChange1hPct = ((cur - prev) / prev) * 100;
      }

      // Analyze top candidates concurrently in small batches to avoid burst rate limits
      const cycleSignals: TradeSignal[] = [];
      for (const candidate of candidates) {
        try {
          const [c15m, c1h, c4h] = await Promise.all([
            this.binanceClient.getKlines(candidate.symbol, '15m', 220),
            this.binanceClient.getKlines(candidate.symbol, '1h', 160),
            this.binanceClient.getKlines(candidate.symbol, '4h', 160),
          ]);
          if (c15m.length < 60 || c1h.length < 40 || c4h.length < 30) {
            continue;
          }

          const tech = analyzeMultiTimeframe(
            candidate.symbol,
            c15m,
            c1h,
            c4h,
            candidate.fundingRate,
            this.strategyConfig,
          );
          this.latestTechnical.set(candidate.symbol, tech);

          const newsCtx = getCoinNewsContext(candidate.symbol, recentNews, 12);
          let signal = evaluateSignal({
            technical: tech,
            newsContext: newsCtx,
            btcChange1hPct,
            strategyConfig: this.strategyConfig,
          });

          // Handle emergency exit if Black Swan flagged for an active position
          if (signal.emergencyCloseRequired) {
            const openPos = this.db
              .getOpenPositions(this.mode)
              .find((p) => p.symbol === candidate.symbol);
            if (openPos) {
              const px = this.marketStream.getMarkPrice(openPos.symbol) ?? candidate.markPrice;
              await this.closePositionInternal(
                openPos,
                'CLOSE_EMERGENCY',
                px,
                'Black Swan emergency signal exit',
              );
            }
          }

          // Autonomous Order Execution when active & risk approves
          if (
            signal.action !== 'HOLD' &&
            this.running &&
            !this.killSwitchActive &&
            this.strategyConfig.enableAutoTrading
          ) {
            const openPositions = this.db.getOpenPositions(this.mode);
            const account = await this.broker.getAccountSummary(
              openPositions,
              this.riskConfig,
            );
            const filter = this.getFilter(candidate.symbol, candidate.lastPrice);
            const recentClosed = this.db.getRecentClosedSymbolTimes(this.mode);
            const riskEval = evaluateRisk({
              signal,
              account,
              openPositions,
              symbolFilter: filter,
              recentClosedSymbolTimes: recentClosed,
              riskConfig: this.riskConfig,
              botState: {
                killSwitchActive: this.killSwitchActive,
                running: this.running,
              },
            });

            if (riskEval.approved) {
              const opened = await this.broker.openPosition(
                signal,
                riskEval,
                filter,
                this.riskConfig,
              );
              signal = { ...signal, executed: true };
              this.log(
                'SUCCESS',
                'Execution',
                `Opened ${opened.side} ${opened.symbol} @ ${opened.entryPrice} (${opened.quantity} qty, ${opened.leverage}x)`,
                {
                  positionId: opened.id,
                  stopLoss: opened.stopLoss,
                  tp1: opened.takeProfit1,
                  tp2: opened.takeProfit2,
                  tp3: opened.takeProfit3,
                },
              );
              void this.telegram.sendAlert(`OPEN ${opened.side} ${opened.symbol}`, [
                `Mode: ${this.mode} (${opened.leverage}x Isolated)`,
                `Entry: ${opened.entryPrice}`,
                `Qty: ${opened.quantity}`,
                `SL: ${opened.stopLoss} | TP1: ${opened.takeProfit1} | TP2: ${opened.takeProfit2} | TP3: ${opened.takeProfit3}`,
                `Confidence: ${signal.confidence}%`,
              ]);
              this.emitSnapshotUpdate();
            } else if (riskEval.rejectionReason) {
              signal = {
                ...signal,
                vetoReasons: [...signal.vetoReasons, `Risk: ${riskEval.rejectionReason}`],
              };
            }
          }

          this.latestSignals.set(candidate.symbol, signal);
          if (signal.action !== 'HOLD' || signal.executed) {
            this.db.insertSignal(signal);
          }
          cycleSignals.push(signal);
        } catch (err) {
          this.log('WARN', 'Scanner', `Skipped ${candidate.symbol} analysis`, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
        if (candidates.length > 10) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      }

      const activeSymbols = new Set([
        ...candidates.map((c) => c.symbol),
        ...this.db.getOpenPositions(this.mode).map((p) => p.symbol),
      ]);
      for (const sym of this.latestSignals.keys()) {
        if (!activeSymbols.has(sym)) {
          this.latestSignals.delete(sym);
        }
      }

      this.lastScanAt = Date.now();
      const sortedSignals = this.getOrderedSignals();
      this.emit('scanner', {
        scanner: this.scannerCandidates,
        signals: sortedSignals,
      });
      return { scanner: this.scannerCandidates, signals: sortedSignals };
    } finally {
      this.scannerInProgress = false;
    }
  }

  private getOrderedSignals(): TradeSignal[] {
    return Array.from(this.latestSignals.values()).sort(
      (a, b) => Math.abs(b.compositeScore) - Math.abs(a.compositeScore),
    );
  }

  private async closePositionInternal(
    position: Position,
    action:
      | 'CLOSE_SL'
      | 'CLOSE_TP2'
      | 'CLOSE_TP3'
      | 'CLOSE_TRAILING'
      | 'CLOSE_EMERGENCY'
      | 'CLOSE_TIME_EXIT'
      | 'CLOSE_MANUAL'
      | 'CLOSE_KILL_SWITCH'
      | 'LIQUIDATION',
    price: number,
    reason: string,
  ): Promise<Position> {
    const closed = await this.broker.closePosition(
      position,
      action,
      price,
      this.riskConfig,
      reason,
    );
    const level: LogLevel = closed.realizedPnl >= 0 ? 'SUCCESS' : 'WARN';
    this.log(
      level,
      'Position',
      `Closed ${closed.side} ${closed.symbol} (${action}): PnL ${closed.realizedPnl >= 0 ? '+' : ''}${closed.realizedPnl.toFixed(2)} USDT`,
      { positionId: closed.id, reason },
    );
    void this.telegram.sendAlert(`CLOSE ${closed.side} ${closed.symbol}`, [
      `Action: ${action}`,
      `Exit Price: ${price}`,
      `Realized PnL: ${closed.realizedPnl >= 0 ? '+' : ''}${closed.realizedPnl.toFixed(2)} USDT`,
      `Reason: ${reason}`,
    ]);
    this.emitSnapshotUpdate();
    return closed;
  }

  async monitorPositionsTick(): Promise<void> {
    if (this.tickInProgress) return;
    this.tickInProgress = true;
    try {
      const now = Date.now();
      if (
        this.mode !== 'PAPER' &&
        this.broker.reconcileStartup &&
        !this.binanceClient.isSignedRateLimited() &&
        now - this.lastExchangeSyncAt >= 45_000
      ) {
        this.lastExchangeSyncAt = now;
        const beforeCount = this.db.getOpenPositions(this.mode).length;
        try {
          await this.broker.reconcileStartup();
          const afterCount = this.db.getOpenPositions(this.mode).length;
          if (afterCount !== beforeCount) {
            this.emitSnapshotUpdate();
          }
        } catch {
          // Non-fatal exchange sync error; retry next window
        }
      }

      const openPositions = this.db.getOpenPositions(this.mode);
      const recentNews =
        openPositions.length > 0
          ? this.db.getRecentNews(40, Date.now() - 6 * 3_600_000)
          : [];

      for (const pos of openPositions) {
        const markPrice = this.marketStream.getMarkPrice(pos.symbol);
        if (!markPrice || markPrice <= 0) continue;

        const filter = this.getFilter(pos.symbol, markPrice);
        const tech = this.latestTechnical.get(pos.symbol);
        const curAtr = tech?.indicators15m.atr14 ?? pos.entryAtr;
        const newsCtx = getCoinNewsContext(pos.symbol, recentNews, 6, now);

        // Check liquidation first for realistic Paper simulation
        const liquidated =
          this.mode === 'PAPER' &&
          (pos.side === 'LONG'
            ? markPrice <= pos.liquidationPrice
            : markPrice >= pos.liquidationPrice);
        if (liquidated) {
          await this.closePositionInternal(
            pos,
            'LIQUIDATION',
            pos.liquidationPrice,
            `Isolated margin liquidation reached at ${pos.liquidationPrice}`,
          );
          continue;
        }

        const decision = evaluatePositionTick(
          pos,
          markPrice,
          curAtr,
          newsCtx,
          now,
          this.strategyConfig,
        );

        if (decision.type === 'HOLD') {
          const updated: Position = {
            ...pos,
            markPrice,
            peakPrice: decision.updatedPeakPrice,
            unrealizedPnl: computeUnrealizedPnl(pos, markPrice),
          };
          this.db.upsertPosition(updated);
        } else if (decision.type === 'PARTIAL_TP1' || decision.type === 'PARTIAL_TP2') {
          const stage = decision.type === 'PARTIAL_TP1' ? 'TP1' : 'TP2';
          const updated = await this.broker.partialClosePosition({
            position: pos,
            stage,
            closePctOfInitial: decision.closePctOfInitial,
            newStopLoss: decision.newStopLoss,
            activateTrailing: decision.activateTrailing,
            execPrice: markPrice,
            filter,
            riskConfig: this.riskConfig,
            reason: decision.reason,
          });
          const slDesc =
            stage === 'TP1'
              ? `Break-Even (${updated.stopLoss})`
              : `TP1 (${updated.stopLoss}) + Trailing`;
          this.log(
            'SUCCESS',
            'Position',
            `${stage} partial close on ${pos.symbol}: SL moved to ${slDesc}`,
          );
          void this.telegram.sendAlert(`PARTIAL ${stage} ${pos.symbol}`, [
            `Price: ${markPrice}`,
            `SL moved to ${slDesc}`,
            `Remaining Qty: ${updated.remainingQuantity}`,
          ]);
          this.emitSnapshotUpdate();
        } else if (decision.type === 'UPDATE_TRAILING_SL') {
          await this.broker.updateStopLoss(
            { ...pos, markPrice, unrealizedPnl: computeUnrealizedPnl(pos, markPrice) },
            decision.newStopLoss,
            decision.updatedPeakPrice,
            filter,
          );
        } else if (decision.type === 'CLOSE_SL') {
          await this.closePositionInternal(
            pos,
            pos.trailingActive ? 'CLOSE_TRAILING' : 'CLOSE_SL',
            markPrice,
            decision.reason,
          );
        } else if (decision.type === 'CLOSE_TP3') {
          await this.closePositionInternal(pos, 'CLOSE_TP3', markPrice, decision.reason);
        } else if (decision.type === 'EMERGENCY_CLOSE') {
          await this.closePositionInternal(
            pos,
            'CLOSE_EMERGENCY',
            markPrice,
            decision.reason,
          );
        } else if (decision.type === 'CLOSE_TIME_EXIT') {
          await this.closePositionInternal(
            pos,
            'CLOSE_TIME_EXIT',
            markPrice,
            decision.reason,
          );
        }
      }

      this.lastTickAt = now;
      const latestOpen = this.db.getOpenPositions(this.mode);
      const account = await this.broker.getAccountSummary(latestOpen, this.riskConfig);

      if (account.circuitBreakerTripped && this.running) {
        this.running = false;
        this.log(
          'ERROR',
          'Risk',
          `Daily Loss Circuit Breaker tripped (${account.dailyPnlPct.toFixed(2)}%). Auto-trading paused.`,
        );
        void this.telegram.sendAlert('DAILY LOSS CIRCUIT BREAKER', [
          `Daily PnL: ${account.dailyPnlPct.toFixed(2)}%`,
          'Auto-trading has been automatically PAUSED.',
        ]);
      }

      this.emit('tick', {
        status: this.getBotStatus(),
        account,
        positions: latestOpen,
      });
    } catch (err) {
      this.log('ERROR', 'Monitor', 'Position monitor tick failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.tickInProgress = false;
    }
  }

  startAutoTrading(): BotStatus {
    this.killSwitchActive = false;
    this.running = true;
    this.log('SUCCESS', 'Control', 'Autonomous trading STARTED');
    return this.getBotStatus();
  }

  pauseAutoTrading(): BotStatus {
    this.running = false;
    this.log('WARN', 'Control', 'Autonomous trading PAUSED');
    return this.getBotStatus();
  }

  async activateKillSwitch(): Promise<DashboardSnapshot> {
    this.killSwitchActive = true;
    this.running = false;
    this.log('ERROR', 'KillSwitch', 'EMERGENCY KILL SWITCH ACTIVATED — closing all positions');

    const open = this.db.getOpenPositions(this.mode);
    for (const pos of open) {
      const px = this.marketStream.getMarkPrice(pos.symbol) ?? pos.markPrice;
      try {
        await this.closePositionInternal(
          pos,
          'CLOSE_KILL_SWITCH',
          px,
          'Emergency Kill Switch triggered by user',
        );
      } catch (err) {
        this.log('ERROR', 'KillSwitch', `Failed closing ${pos.symbol}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    void this.telegram.sendAlert('KILL SWITCH ACTIVATED', [
      `Mode: ${this.mode}`,
      `Closed ${open.length} open position(s) and paused bot.`,
    ]);
    return this.getDashboardSnapshot();
  }

  async manualClosePosition(positionId: string): Promise<Position> {
    const pos = this.db.getPositionById(positionId);
    if (!pos || pos.status !== 'OPEN') {
      throw new Error('Position not found or already closed');
    }
    const px = this.marketStream.getMarkPrice(pos.symbol) ?? pos.markPrice;
    return this.closePositionInternal(pos, 'CLOSE_MANUAL', px, 'Manual close from dashboard');
  }

  resetPaperAccount(balance = 500): AccountSummary {
    if (this.mode !== 'PAPER') {
      throw new Error('Paper reset is only allowed in PAPER trading mode');
    }
    const safeBalance = Math.max(100, Math.min(10_000_000, Number(balance) || 500));
    this.db.resetPaperAccount(safeBalance);
    this.log('INFO', 'Paper', `Paper account reset to ${safeBalance.toFixed(2)} USDT`);
    this.emitSnapshotUpdate();
    return {
      mode: 'PAPER',
      walletBalance: safeBalance,
      availableBalance: safeBalance,
      isolatedMarginUsed: 0,
      unrealizedPnl: 0,
      totalEquity: safeBalance,
      initialCapitalUsdt: safeBalance,
      startingDayEquity: safeBalance,
      dailyPnl: 0,
      dailyPnlPct: 0,
      dailyLossLimitPct: this.riskConfig.maxDailyLossPct,
      circuitBreakerTripped: false,
      totalTrades: this.db.getTradeStats('PAPER').totalTrades,
      winRatePct: this.db.getTradeStats('PAPER').winRatePct,
      profitFactor: this.db.getTradeStats('PAPER').profitFactor,
    };
  }

  async getChartData(
    symbol: string,
    interval: Timeframe = '15m',
    limit = 200,
  ): Promise<CandleChartResponse> {
    const upper = symbol.toUpperCase();
    const rawCandles = await this.binanceClient.getKlines(upper, interval, limit);
    // Deduplicate & sort strictly ascending by timestamp for lightweight-charts safety
    const seenTimes = new Set<number>();
    const candles = rawCandles
      .filter((c) => {
        const tSec = Math.floor(c.openTime / 1000);
        if (seenTimes.has(tSec)) return false;
        seenTimes.add(tSec);
        return true;
      })
      .sort((a, b) => a.openTime - b.openTime);

    const closes = candles.map((c) => c.close);
    const e9 = emaSeries(closes, 9);
    const e21 = emaSeries(closes, 21);
    const e50 = emaSeries(closes, 50);

    const ema9 = candles.map((c, i) => ({
      time: Math.floor(c.openTime / 1000),
      value: e9[i] ?? c.close,
    }));
    const ema21 = candles.map((c, i) => ({
      time: Math.floor(c.openTime / 1000),
      value: e21[i] ?? c.close,
    }));
    const ema50 = candles.map((c, i) => ({
      time: Math.floor(c.openTime / 1000),
      value: e50[i] ?? c.close,
    }));

    let technical = this.latestTechnical.get(upper) ?? null;
    if (!technical && candles.length >= 60) {
      const [c15m, c1h, c4h] =
        interval === '15m'
          ? [
              candles,
              await this.binanceClient.getKlines(upper, '1h', 160),
              await this.binanceClient.getKlines(upper, '4h', 160),
            ]
          : await Promise.all([
              this.binanceClient.getKlines(upper, '15m', 220),
              this.binanceClient.getKlines(upper, '1h', 160),
              this.binanceClient.getKlines(upper, '4h', 160),
            ]);

      if (c15m.length >= 60 && c1h.length >= 30 && c4h.length >= 25) {
        const ticker = this.marketStream.getTicker(upper);
        technical = analyzeMultiTimeframe(
          upper,
          c15m,
          c1h,
          c4h,
          ticker?.fundingRate ?? 0,
          this.strategyConfig,
        );
        this.latestTechnical.set(upper, technical);
      }
    }

    const recentNews = this.db.getRecentNews(60, Date.now() - 12 * 3_600_000);
    const newsContext = getCoinNewsContext(upper, recentNews, 12);

    return {
      symbol: upper,
      interval,
      candles,
      ema9,
      ema21,
      ema50,
      technical,
      newsContext,
    };
  }

  async runBacktest(req: BacktestRequest): Promise<BacktestResult> {
    const symbol = req.symbol.toUpperCase();
    const bars = Math.min(Math.max(Number(req.bars) || 350, 150), 1000);
    const candles = await this.binanceClient.getKlines(symbol, req.interval, bars);
    if (candles.length < 120) {
      throw new Error(`Insufficient historical candles returned for ${symbol} (${candles.length})`);
    }
    return runHistoricalBacktest({
      request: { ...req, symbol, bars },
      candles,
      riskConfig: this.riskConfig,
      strategyConfig: this.strategyConfig,
    });
  }

  getBotStatus(): BotStatus {
    return {
      running: this.running,
      mode: this.mode,
      killSwitchActive: this.killSwitchActive,
      marketStreamConnected: this.marketStream.isConnected(),
      klinesFallbackActive: this.binanceClient.isKlinesFallbackActive(),
      geminiEnabled: Boolean(this.credentials.geminiApiKey),
      telegramEnabled: this.telegram.isEnabled(),
      lastScanAt: this.lastScanAt,
      lastNewsRefreshAt: this.lastNewsRefreshAt,
      lastTickAt: this.lastTickAt,
      scannerInProgress: this.scannerInProgress,
      newsRefreshInProgress: this.newsRefreshInProgress,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
    };
  }

  getSettingsView(): SettingsView {
    return {
      mode: this.mode,
      liveConfirmed: this.liveConfirmed,
      risk: this.riskConfig,
      strategy: this.strategyConfig,
      credentials: {
        hasBinanceKey: Boolean(this.credentials.binanceApiKey),
        hasBinanceSecret: Boolean(this.credentials.binanceApiSecret),
        hasGeminiKey: Boolean(this.credentials.geminiApiKey),
        hasCryptoPanicKey: Boolean(this.credentials.cryptoPanicApiKey),
        hasTelegramConfig: this.telegram.isEnabled(),
        binanceFapiBaseUrl: this.credentials.binanceFapiBaseUrl,
        binanceFwsBaseUrl: this.credentials.binanceFwsBaseUrl,
      },
    };
  }

  async updateSettings(payload: SettingsUpdatePayload): Promise<SettingsView> {
    if (payload.credentials) {
      const c = payload.credentials;
      if (c.binanceApiKey !== undefined && c.binanceApiKey.trim()) {
        this.credentials.binanceApiKey = c.binanceApiKey.trim();
      }
      if (c.binanceApiSecret !== undefined && c.binanceApiSecret.trim()) {
        this.credentials.binanceApiSecret = c.binanceApiSecret.trim();
      }
      if (c.geminiApiKey !== undefined) {
        this.credentials.geminiApiKey = c.geminiApiKey.trim();
      }
      if (c.cryptoPanicApiKey !== undefined) {
        this.credentials.cryptoPanicApiKey = c.cryptoPanicApiKey.trim();
      }
      if (c.telegramBotToken !== undefined) {
        this.credentials.telegramBotToken = c.telegramBotToken.trim();
      }
      if (c.telegramChatId !== undefined) {
        this.credentials.telegramChatId = c.telegramChatId.trim();
      }
      if (c.binanceFapiBaseUrl !== undefined) {
        this.credentials.binanceFapiBaseUrl = c.binanceFapiBaseUrl.trim();
      }
      if (c.binanceFwsBaseUrl !== undefined) {
        this.credentials.binanceFwsBaseUrl = c.binanceFwsBaseUrl.trim();
      }
    }

    if (payload.liveConfirmed !== undefined) {
      this.liveConfirmed = Boolean(payload.liveConfirmed);
    }

    if (payload.risk) {
      this.riskConfig = { ...this.riskConfig, ...payload.risk };
      this.db.saveRiskConfig(this.riskConfig);
    }

    let timersNeedReset = false;
    if (payload.strategy) {
      const mergedStrat = { ...this.strategyConfig, ...payload.strategy };
      if (
        !Number.isInteger(mergedStrat.scannerTopN) ||
        mergedStrat.scannerTopN < 3 ||
        mergedStrat.scannerTopN > 40
      ) {
        throw new Error('Top scan pairs (scannerTopN) must be an integer between 3 and 40');
      }
      if (
        mergedStrat.tp1RiskReward <= 0 ||
        mergedStrat.tp2RiskReward <= mergedStrat.tp1RiskReward ||
        mergedStrat.tp3RiskReward <= mergedStrat.tp2RiskReward
      ) {
        throw new Error('Take Profit R:R targets must satisfy 0 < TP1 < TP2 < TP3');
      }
      if (
        mergedStrat.tp1ClosePct < 10 ||
        mergedStrat.tp2ClosePct < 10 ||
        mergedStrat.tp1ClosePct + mergedStrat.tp2ClosePct > 90
      ) {
        throw new Error('TP1 and TP2 close percentages must be >= 10% and total <= 90%');
      }
      if (
        payload.strategy.scanIntervalSeconds !== undefined ||
        payload.strategy.newsRefreshMinutes !== undefined
      ) {
        timersNeedReset = true;
      }
      this.strategyConfig = mergedStrat;
      this.db.saveStrategyConfig(this.strategyConfig);
    }

    if (payload.mode && payload.mode !== this.mode) {
      if (
        (payload.mode === 'TESTNET' || payload.mode === 'LIVE') &&
        (!this.credentials.binanceApiKey || !this.credentials.binanceApiSecret)
      ) {
        throw new Error(`Binance API Key and Secret are required to switch to ${payload.mode}`);
      }
      if (payload.mode === 'LIVE' && !this.liveConfirmed) {
        throw new Error('Explicit LIVE trading confirmation is required before enabling LIVE mode');
      }
      this.mode = payload.mode;
      this.db.saveTradingMode(this.mode);
      this.broker = this.createBroker(this.mode);
      if (this.broker.reconcileStartup) {
        await this.broker.reconcileStartup();
      }
      this.log('WARN', 'Settings', `Switched trading mode to ${this.mode}`);
    }

    this.binanceClient.updateConfig({
      mode: this.mode,
      apiKey: this.credentials.binanceApiKey,
      apiSecret: this.credentials.binanceApiSecret,
      fapiBaseUrl: this.credentials.binanceFapiBaseUrl,
    });
    this.marketStream.updateEndpoint(this.mode, this.credentials.binanceFwsBaseUrl);
    this.telegram.updateCredentials(
      this.credentials.telegramBotToken,
      this.credentials.telegramChatId,
    );

    if (timersNeedReset) {
      this.scheduleTimers();
    }

    this.log('INFO', 'Settings', 'Updated bot risk, strategy, or credential settings');
    return this.getSettingsView();
  }

  private emitSnapshotUpdate(): void {
    void this.getDashboardSnapshot()
      .then((snapshot) => this.emit('snapshot', snapshot))
      .catch(() => undefined);
  }

  async getDashboardSnapshot(): Promise<DashboardSnapshot> {
    const positions = this.db.getOpenPositions(this.mode);
    const closedPositions = this.db.getClosedPositions(this.mode, 100);
    let account: AccountSummary;
    try {
      account = await this.broker.getAccountSummary(positions, this.riskConfig);
    } catch {
      const cap = this.riskConfig.maxAccountCapitalUsdt ?? 500;
      const stats = this.db.getTradeStats(this.mode);
      const marginUsed = positions.reduce((s, p) => s + p.isolatedMargin, 0);
      const unrealized = positions.reduce((s, p) => s + p.unrealizedPnl, 0);
      const wallet = cap + stats.netPnl;
      account = {
        mode: this.mode,
        walletBalance: wallet,
        availableBalance: Math.max(0, wallet - marginUsed),
        isolatedMarginUsed: marginUsed,
        unrealizedPnl: unrealized,
        totalEquity: wallet + unrealized,
        initialCapitalUsdt: cap,
        startingDayEquity: cap,
        dailyPnl: stats.netPnl + unrealized,
        dailyPnlPct: cap > 0 ? ((stats.netPnl + unrealized) / cap) * 100 : 0,
        dailyLossLimitPct: this.riskConfig.maxDailyLossPct,
        circuitBreakerTripped: false,
        totalTrades: stats.totalTrades,
        winRatePct: stats.winRatePct,
        profitFactor: stats.profitFactor,
      };
    }

    return {
      status: this.getBotStatus(),
      account,
      positions,
      closedPositions,
      scanner: this.scannerCandidates,
      signals: this.getOrderedSignals(),
      news: this.db.getRecentNews(60),
      trades: this.db.getRecentTrades(this.mode, 100),
      logs: this.db.getRecentLogs(100),
      settings: this.getSettingsView(),
    };
  }
}
