import { randomUUID } from 'node:crypto';
import type {
  AccountSummary,
  Position,
  RiskConfig,
  RiskEvaluation,
  SymbolFilter,
  TradeAction,
  TradeRecord,
  TradeSignal,
  TradingMode,
} from '@bot/shared';
import type { BotDatabase } from '../db/database.js';
import type { BinanceFuturesClient } from '../market/binanceClient.js';
import { formatPrice, formatQuantity } from '../market/precision.js';
import { computeUnrealizedPnl } from './positionLifecycle.js';
import { estimateIsolatedLiquidationPrice } from '../risk/riskManager.js';

export interface ExecutionBroker {
  readonly mode: TradingMode;
  getAccountSummary(
    openPositions: Position[],
    riskConfig: RiskConfig,
  ): Promise<AccountSummary>;
  openPosition(
    signal: TradeSignal,
    riskEval: RiskEvaluation,
    filter: SymbolFilter,
    riskConfig: RiskConfig,
  ): Promise<Position>;
  partialClosePosition(
    position: Position,
    fraction: number,
    newStopLoss: number,
    execPrice: number,
    filter: SymbolFilter,
    riskConfig: RiskConfig,
    reason: string,
  ): Promise<Position>;
  updateStopLoss(
    position: Position,
    newStopLoss: number,
    newPeakPrice: number,
    filter: SymbolFilter,
  ): Promise<Position>;
  closePosition(
    position: Position,
    action: Exclude<TradeAction, 'OPEN' | 'PARTIAL_TP1'>,
    execPrice: number,
    riskConfig: RiskConfig,
    reason: string,
  ): Promise<Position>;
  reconcileStartup?(): Promise<void>;
}

function utcDayKey(ts = Date.now()): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/**
 * Simulated isolated-margin USD-M Futures broker backed by live market prices and SQLite.
 */
export class PaperBroker implements ExecutionBroker {
  readonly mode: TradingMode = 'PAPER';

  constructor(private readonly db: BotDatabase) {}

  async getAccountSummary(
    openPositions: Position[],
    riskConfig: RiskConfig,
  ): Promise<AccountSummary> {
    const account = this.db.getPaperAccount();
    const isolatedMarginUsed = openPositions.reduce(
      (sum, p) => sum + p.isolatedMargin,
      0,
    );
    const unrealizedPnl = openPositions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
    const availableBalance = Math.max(0, account.balance - isolatedMarginUsed);
    const totalEquity = account.balance + unrealizedPnl;

    // Daily UTC rollover for Starting Day Equity
    const today = utcDayKey();
    let startingDayEquity = account.startingDayEquity;
    if (account.dayKey !== today) {
      startingDayEquity = totalEquity;
      this.db.updatePaperAccount(account.balance, startingDayEquity, today);
    }

    const dailyPnl = totalEquity - startingDayEquity;
    const dailyPnlPct =
      startingDayEquity > 0 ? (dailyPnl / startingDayEquity) * 100 : 0;
    const stats = this.db.getTradeStats('PAPER');

    return {
      mode: 'PAPER',
      walletBalance: account.balance,
      availableBalance,
      isolatedMarginUsed,
      unrealizedPnl,
      totalEquity,
      startingDayEquity,
      dailyPnl,
      dailyPnlPct,
      dailyLossLimitPct: riskConfig.maxDailyLossPct,
      circuitBreakerTripped: dailyPnlPct <= -riskConfig.maxDailyLossPct,
      totalTrades: stats.totalTrades,
      winRatePct: stats.winRatePct,
      profitFactor: stats.profitFactor,
    };
  }

  async openPosition(
    signal: TradeSignal,
    riskEval: RiskEvaluation,
    filter: SymbolFilter,
    riskConfig: RiskConfig,
  ): Promise<Position> {
    const now = Date.now();
    const slip = riskConfig.slippagePct / 100;
    const fillPrice = formatPrice(
      signal.action === 'LONG'
        ? signal.entryPrice * (1 + slip)
        : signal.entryPrice * (1 - slip),
      filter,
    );
    const qty = riskEval.quantity;
    const notional = fillPrice * qty;
    const fee = notional * (riskConfig.takerFeePct / 100);
    const isolatedMargin = notional / riskEval.leverage;
    const side = signal.action === 'SHORT' ? 'SHORT' : 'LONG';

    const paper = this.db.getPaperAccount();
    this.db.updatePaperAccount(paper.balance - fee);

    const pos: Position = {
      id: randomUUID(),
      mode: 'PAPER',
      symbol: signal.symbol,
      side,
      status: 'OPEN',
      entryPrice: fillPrice,
      markPrice: fillPrice,
      quantity: qty,
      remainingQuantity: qty,
      leverage: riskEval.leverage,
      isolatedMargin,
      stopLoss: formatPrice(signal.stopLoss, filter),
      takeProfit1: formatPrice(signal.takeProfit1, filter),
      takeProfit2: formatPrice(signal.takeProfit2, filter),
      tp1Hit: false,
      trailingActive: false,
      peakPrice: fillPrice,
      entryAtr: signal.atr,
      liquidationPrice: formatPrice(
        estimateIsolatedLiquidationPrice(fillPrice, riskEval.leverage, side),
        filter,
      ),
      unrealizedPnl: 0,
      realizedPnl: -fee,
      feesPaid: fee,
      confidence: signal.confidence,
      entryReasons: signal.reasons,
      closeReason: null,
      slOrderId: `paper-sl-${randomUUID().slice(0, 8)}`,
      tpOrderId: `paper-tp-${randomUUID().slice(0, 8)}`,
      openedAt: now,
      closedAt: null,
    };

    this.db.upsertPosition(pos);
    this.db.insertTrade({
      id: randomUUID(),
      positionId: pos.id,
      mode: 'PAPER',
      symbol: pos.symbol,
      side: pos.side,
      action: 'OPEN',
      price: fillPrice,
      quantity: qty,
      notional,
      fee,
      realizedPnl: -fee,
      reason: signal.reasons.slice(0, 2).join('; ') || 'Signal confirmed',
      exchangeOrderId: null,
      createdAt: now,
    });

    return pos;
  }

  async partialClosePosition(
    position: Position,
    fraction: number,
    newStopLoss: number,
    execPrice: number,
    filter: SymbolFilter,
    riskConfig: RiskConfig,
    reason: string,
  ): Promise<Position> {
    const now = Date.now();
    const rawCloseQty = position.remainingQuantity * fraction;
    let closeQty = formatQuantity(rawCloseQty, filter);
    if (closeQty <= 0 || closeQty >= position.remainingQuantity) {
      closeQty = Number((position.remainingQuantity * 0.5).toFixed(filter.quantityPrecision));
    }
    const remainingQty = Math.max(
      0,
      Number((position.remainingQuantity - closeQty).toFixed(filter.quantityPrecision)),
    );

    const slip = riskConfig.slippagePct / 100;
    const fillPrice =
      position.side === 'LONG' ? execPrice * (1 - slip) : execPrice * (1 + slip);
    const notional = fillPrice * closeQty;
    const fee = notional * (riskConfig.takerFeePct / 100);
    const grossPnl =
      (position.side === 'LONG'
        ? fillPrice - position.entryPrice
        : position.entryPrice - fillPrice) * closeQty;
    const netRealized = grossPnl - fee;

    const paper = this.db.getPaperAccount();
    this.db.updatePaperAccount(paper.balance + netRealized);

    const updatedMargin =
      position.quantity > 0
        ? position.isolatedMargin * (remainingQty / position.quantity)
        : 0;

    const updated: Position = {
      ...position,
      remainingQuantity: remainingQty,
      isolatedMargin: updatedMargin,
      stopLoss: formatPrice(newStopLoss, filter),
      tp1Hit: true,
      trailingActive: true,
      markPrice: execPrice,
      realizedPnl: position.realizedPnl + netRealized,
      feesPaid: position.feesPaid + fee,
      unrealizedPnl: computeUnrealizedPnl(
        { ...position, remainingQuantity: remainingQty },
        execPrice,
      ),
    };

    this.db.upsertPosition(updated);
    this.db.insertTrade({
      id: randomUUID(),
      positionId: position.id,
      mode: 'PAPER',
      symbol: position.symbol,
      side: position.side,
      action: 'PARTIAL_TP1',
      price: fillPrice,
      quantity: closeQty,
      notional,
      fee,
      realizedPnl: netRealized,
      reason,
      exchangeOrderId: null,
      createdAt: now,
    });

    return updated;
  }

  async updateStopLoss(
    position: Position,
    newStopLoss: number,
    newPeakPrice: number,
    filter: SymbolFilter,
  ): Promise<Position> {
    const updated: Position = {
      ...position,
      stopLoss: formatPrice(newStopLoss, filter),
      peakPrice: newPeakPrice,
      trailingActive: true,
    };
    this.db.upsertPosition(updated);
    return updated;
  }

  async closePosition(
    position: Position,
    action: Exclude<TradeAction, 'OPEN' | 'PARTIAL_TP1'>,
    execPrice: number,
    riskConfig: RiskConfig,
    reason: string,
  ): Promise<Position> {
    const now = Date.now();
    const slip = riskConfig.slippagePct / 100;
    const fillPrice =
      position.side === 'LONG' ? execPrice * (1 - slip) : execPrice * (1 + slip);
    const qty = position.remainingQuantity;
    const notional = fillPrice * qty;
    const fee = notional * (riskConfig.takerFeePct / 100);
    const grossPnl =
      (position.side === 'LONG'
        ? fillPrice - position.entryPrice
        : position.entryPrice - fillPrice) * qty;
    const netRealized = grossPnl - fee;

    const paper = this.db.getPaperAccount();
    this.db.updatePaperAccount(paper.balance + netRealized);

    const closed: Position = {
      ...position,
      status: 'CLOSED',
      markPrice: execPrice,
      remainingQuantity: 0,
      isolatedMargin: 0,
      unrealizedPnl: 0,
      realizedPnl: position.realizedPnl + netRealized,
      feesPaid: position.feesPaid + fee,
      closeReason: reason,
      closedAt: now,
    };

    this.db.upsertPosition(closed);
    this.db.insertTrade({
      id: randomUUID(),
      positionId: position.id,
      mode: 'PAPER',
      symbol: position.symbol,
      side: position.side,
      action,
      price: fillPrice,
      quantity: qty,
      notional,
      fee,
      realizedPnl: netRealized,
      reason,
      exchangeOrderId: null,
      createdAt: now,
    });

    return closed;
  }
}

/**
 * Live / Testnet signed Binance USD-M Futures execution broker with server-side SL/TP orders.
 */
export class BinanceFuturesBroker implements ExecutionBroker {
  private dayEquityAnchor: { dayKey: string; equity: number } | null = null;

  constructor(
    public readonly mode: 'TESTNET' | 'LIVE',
    private readonly db: BotDatabase,
    private readonly client: BinanceFuturesClient,
  ) {}

  async getAccountSummary(
    openPositions: Position[],
    riskConfig: RiskConfig,
  ): Promise<AccountSummary> {
    const info = await this.client.getAccountInfo();
    const stats = this.db.getTradeStats(this.mode);
    const cap =
      riskConfig.maxAccountCapitalUsdt && riskConfig.maxAccountCapitalUsdt > 0
        ? riskConfig.maxAccountCapitalUsdt
        : 0;

    let walletBalance = info.totalWalletBalance;
    let availableBalance = info.availableBalance;
    let unrealizedPnl = info.totalUnrealizedProfit;
    let totalEquity =
      info.totalMarginBalance || walletBalance + unrealizedPnl;
    const isolatedMarginUsed = openPositions.reduce(
      (s, p) => s + p.isolatedMargin,
      0,
    );

    if (this.mode === 'TESTNET' && cap > 0) {
      // Scale down Testnet faucet balance (Binance default $10,000) to user's targeted lead copy trader capital (e.g. $500)
      walletBalance = cap + stats.netPnl;
      unrealizedPnl = openPositions.reduce((s, p) => s + p.unrealizedPnl, 0);
      totalEquity = walletBalance + unrealizedPnl;
      availableBalance = Math.max(0, walletBalance - isolatedMarginUsed);
    }

    const today = utcDayKey();
    if (!this.dayEquityAnchor || this.dayEquityAnchor.dayKey !== today) {
      this.dayEquityAnchor = { dayKey: today, equity: totalEquity };
    }
    const startingDayEquity = this.dayEquityAnchor.equity;
    const dailyPnl = totalEquity - startingDayEquity;
    const dailyPnlPct =
      startingDayEquity > 0 ? (dailyPnl / startingDayEquity) * 100 : 0;

    return {
      mode: this.mode,
      walletBalance,
      availableBalance,
      isolatedMarginUsed,
      unrealizedPnl,
      totalEquity,
      startingDayEquity,
      dailyPnl,
      dailyPnlPct,
      dailyLossLimitPct: riskConfig.maxDailyLossPct,
      circuitBreakerTripped: dailyPnlPct <= -riskConfig.maxDailyLossPct,
      totalTrades: stats.totalTrades,
      winRatePct: stats.winRatePct,
      profitFactor: stats.profitFactor,
    };
  }

  async openPosition(
    signal: TradeSignal,
    riskEval: RiskEvaluation,
    filter: SymbolFilter,
    riskConfig: RiskConfig,
  ): Promise<Position> {
    const now = Date.now();
    const side = signal.action === 'SHORT' ? 'SHORT' : 'LONG';
    const orderSide = side === 'LONG' ? 'BUY' : 'SELL';
    const closeSide = side === 'LONG' ? 'SELL' : 'BUY';

    await this.client.setIsolatedMarginAndLeverage(signal.symbol, riskEval.leverage);
    const entryRes = await this.client.placeMarketOrder({
      symbol: signal.symbol,
      side: orderSide,
      quantity: riskEval.quantity,
      clientOrderId: `bot_open_${signal.symbol}_${now}`.slice(0, 32),
    });

    const fillPrice = entryRes.avgPrice > 0 ? entryRes.avgPrice : signal.entryPrice;
    const qty = entryRes.executedQty > 0 ? entryRes.executedQty : riskEval.quantity;
    const slPrice = formatPrice(signal.stopLoss, filter);
    const tp2Price = formatPrice(signal.takeProfit2, filter);

    const [slOrderId, tpOrderId] = await Promise.all([
      this.client
        .placeConditionalCloseOrder({
          symbol: signal.symbol,
          side: closeSide,
          type: 'STOP_MARKET',
          stopPrice: slPrice,
          clientOrderId: `bot_sl_${signal.symbol}_${now}`.slice(0, 32),
        })
        .catch(() => null),
      this.client
        .placeConditionalCloseOrder({
          symbol: signal.symbol,
          side: closeSide,
          type: 'TAKE_PROFIT_MARKET',
          stopPrice: tp2Price,
          clientOrderId: `bot_tp_${signal.symbol}_${now}`.slice(0, 32),
        })
        .catch(() => null),
    ]);

    const notional = fillPrice * qty;
    const fee = notional * (riskConfig.takerFeePct / 100);

    const pos: Position = {
      id: randomUUID(),
      mode: this.mode,
      symbol: signal.symbol,
      side,
      status: 'OPEN',
      entryPrice: fillPrice,
      markPrice: fillPrice,
      quantity: qty,
      remainingQuantity: qty,
      leverage: riskEval.leverage,
      isolatedMargin: notional / riskEval.leverage,
      stopLoss: slPrice,
      takeProfit1: formatPrice(signal.takeProfit1, filter),
      takeProfit2: tp2Price,
      tp1Hit: false,
      trailingActive: false,
      peakPrice: fillPrice,
      entryAtr: signal.atr,
      liquidationPrice: formatPrice(
        estimateIsolatedLiquidationPrice(fillPrice, riskEval.leverage, side),
        filter,
      ),
      unrealizedPnl: 0,
      realizedPnl: -fee,
      feesPaid: fee,
      confidence: signal.confidence,
      entryReasons: signal.reasons,
      closeReason: null,
      slOrderId,
      tpOrderId,
      openedAt: now,
      closedAt: null,
    };

    this.db.upsertPosition(pos);
    this.db.insertTrade({
      id: randomUUID(),
      positionId: pos.id,
      mode: this.mode,
      symbol: pos.symbol,
      side: pos.side,
      action: 'OPEN',
      price: fillPrice,
      quantity: qty,
      notional,
      fee,
      realizedPnl: -fee,
      reason: signal.reasons.slice(0, 2).join('; ') || 'Signal confirmed',
      exchangeOrderId: entryRes.orderId,
      createdAt: now,
    });

    return pos;
  }

  async partialClosePosition(
    position: Position,
    fraction: number,
    newStopLoss: number,
    execPrice: number,
    filter: SymbolFilter,
    riskConfig: RiskConfig,
    reason: string,
  ): Promise<Position> {
    const now = Date.now();
    const closeSide = position.side === 'LONG' ? 'SELL' : 'BUY';
    const closeQty = formatQuantity(position.remainingQuantity * fraction, filter);
    if (closeQty <= 0) {
      return position;
    }

    const res = await this.client.placeMarketOrder({
      symbol: position.symbol,
      side: closeSide,
      quantity: closeQty,
      reduceOnly: true,
      clientOrderId: `bot_tp1_${position.symbol}_${now}`.slice(0, 32),
    });

    if (position.slOrderId) {
      await this.client.cancelOrder(position.symbol, position.slOrderId);
    }
    const formattedSl = formatPrice(newStopLoss, filter);
    const newSlOrderId = await this.client
      .placeConditionalCloseOrder({
        symbol: position.symbol,
        side: closeSide,
        type: 'STOP_MARKET',
        stopPrice: formattedSl,
        clientOrderId: `bot_besl_${position.symbol}_${now}`.slice(0, 32),
      })
      .catch(() => null);

    const fillPrice = res.avgPrice > 0 ? res.avgPrice : execPrice;
    const executed = res.executedQty > 0 ? res.executedQty : closeQty;
    const remainingQty = Math.max(
      0,
      Number((position.remainingQuantity - executed).toFixed(filter.quantityPrecision)),
    );
    const notional = fillPrice * executed;
    const fee = notional * (riskConfig.takerFeePct / 100);
    const grossPnl =
      (position.side === 'LONG'
        ? fillPrice - position.entryPrice
        : position.entryPrice - fillPrice) * executed;
    const netRealized = grossPnl - fee;

    const updated: Position = {
      ...position,
      remainingQuantity: remainingQty,
      isolatedMargin:
        position.quantity > 0
          ? position.isolatedMargin * (remainingQty / position.quantity)
          : 0,
      stopLoss: formattedSl,
      slOrderId: newSlOrderId,
      tp1Hit: true,
      trailingActive: true,
      markPrice: fillPrice,
      realizedPnl: position.realizedPnl + netRealized,
      feesPaid: position.feesPaid + fee,
      unrealizedPnl: computeUnrealizedPnl(
        { ...position, remainingQuantity: remainingQty },
        fillPrice,
      ),
    };

    this.db.upsertPosition(updated);
    this.db.insertTrade({
      id: randomUUID(),
      positionId: position.id,
      mode: this.mode,
      symbol: position.symbol,
      side: position.side,
      action: 'PARTIAL_TP1',
      price: fillPrice,
      quantity: executed,
      notional,
      fee,
      realizedPnl: netRealized,
      reason,
      exchangeOrderId: res.orderId,
      createdAt: now,
    });

    return updated;
  }

  async updateStopLoss(
    position: Position,
    newStopLoss: number,
    newPeakPrice: number,
    filter: SymbolFilter,
  ): Promise<Position> {
    const now = Date.now();
    const closeSide = position.side === 'LONG' ? 'SELL' : 'BUY';
    const formattedSl = formatPrice(newStopLoss, filter);
    if (position.slOrderId) {
      await this.client.cancelOrder(position.symbol, position.slOrderId);
    }
    const newSlOrderId = await this.client
      .placeConditionalCloseOrder({
        symbol: position.symbol,
        side: closeSide,
        type: 'STOP_MARKET',
        stopPrice: formattedSl,
        clientOrderId: `bot_tsl_${position.symbol}_${now}`.slice(0, 32),
      })
      .catch(() => null);

    const updated: Position = {
      ...position,
      stopLoss: formattedSl,
      peakPrice: newPeakPrice,
      trailingActive: true,
      slOrderId: newSlOrderId,
    };
    this.db.upsertPosition(updated);
    return updated;
  }

  async closePosition(
    position: Position,
    action: Exclude<TradeAction, 'OPEN' | 'PARTIAL_TP1'>,
    execPrice: number,
    riskConfig: RiskConfig,
    reason: string,
  ): Promise<Position> {
    const now = Date.now();
    const closeSide = position.side === 'LONG' ? 'SELL' : 'BUY';

    await this.client.cancelAllOpenOrders(position.symbol);
    let fillPrice = execPrice;
    let qty = position.remainingQuantity;
    let exchangeOrderId: string | null = null;

    try {
      const res = await this.client.placeMarketOrder({
        symbol: position.symbol,
        side: closeSide,
        quantity: position.remainingQuantity,
        reduceOnly: true,
        clientOrderId: `bot_cls_${position.symbol}_${now}`.slice(0, 32),
      });
      if (res.avgPrice > 0) fillPrice = res.avgPrice;
      if (res.executedQty > 0) qty = res.executedQty;
      exchangeOrderId = res.orderId;
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      // -2022 ReduceOnly Order is rejected (already closed on exchange by server-side SL/TP)
      if (!msg.includes('-2022')) throw err;
    }

    const notional = fillPrice * qty;
    const fee = notional * (riskConfig.takerFeePct / 100);
    const grossPnl =
      (position.side === 'LONG'
        ? fillPrice - position.entryPrice
        : position.entryPrice - fillPrice) * qty;
    const netRealized = grossPnl - fee;

    const closed: Position = {
      ...position,
      status: 'CLOSED',
      markPrice: fillPrice,
      remainingQuantity: 0,
      isolatedMargin: 0,
      unrealizedPnl: 0,
      realizedPnl: position.realizedPnl + netRealized,
      feesPaid: position.feesPaid + fee,
      closeReason: reason,
      closedAt: now,
    };

    this.db.upsertPosition(closed);
    this.db.insertTrade({
      id: randomUUID(),
      positionId: position.id,
      mode: this.mode,
      symbol: position.symbol,
      side: position.side,
      action,
      price: fillPrice,
      quantity: qty,
      notional,
      fee,
      realizedPnl: netRealized,
      reason,
      exchangeOrderId,
      createdAt: now,
    });

    return closed;
  }

  async reconcileStartup(): Promise<void> {
    const exchangeOpen = await this.client.getPositionRisks();
    const exchangeBySymbol = new Map(exchangeOpen.map((p) => [p.symbol, p]));
    const dbOpen = this.db.getOpenPositions(this.mode);

    // Close DB positions that are no longer open on Binance
    for (const pos of dbOpen) {
      if (!exchangeBySymbol.has(pos.symbol)) {
        this.db.upsertPosition({
          ...pos,
          status: 'CLOSED',
          remainingQuantity: 0,
          isolatedMargin: 0,
          unrealizedPnl: 0,
          closeReason: 'Reconciled closed on exchange',
          closedAt: Date.now(),
        });
      }
    }

    // Import orphan exchange positions not yet tracked locally
    const dbSymbols = new Set(dbOpen.map((p) => p.symbol));
    for (const ex of exchangeOpen) {
      if (dbSymbols.has(ex.symbol)) continue;
      const side = ex.positionAmt > 0 ? 'LONG' : 'SHORT';
      const qty = Math.abs(ex.positionAmt);
      const fallbackSl =
        side === 'LONG' ? ex.entryPrice * 0.975 : ex.entryPrice * 1.025;
      const fallbackTp1 =
        side === 'LONG' ? ex.entryPrice * 1.03 : ex.entryPrice * 0.97;
      const fallbackTp2 =
        side === 'LONG' ? ex.entryPrice * 1.06 : ex.entryPrice * 0.94;

      this.db.upsertPosition({
        id: randomUUID(),
        mode: this.mode,
        symbol: ex.symbol,
        side,
        status: 'OPEN',
        entryPrice: ex.entryPrice,
        markPrice: ex.markPrice,
        quantity: qty,
        remainingQuantity: qty,
        leverage: ex.leverage || 3,
        isolatedMargin: ex.isolatedMargin,
        stopLoss: fallbackSl,
        takeProfit1: fallbackTp1,
        takeProfit2: fallbackTp2,
        tp1Hit: false,
        trailingActive: false,
        peakPrice: ex.markPrice,
        entryAtr: ex.entryPrice * 0.01,
        liquidationPrice: ex.liquidationPrice,
        unrealizedPnl: ex.unRealizedProfit,
        realizedPnl: 0,
        feesPaid: 0,
        confidence: 70,
        entryReasons: ['Imported via exchange reconciliation'],
        closeReason: null,
        slOrderId: null,
        tpOrderId: null,
        openedAt: Date.now(),
        closedAt: null,
      });
    }
  }
}
