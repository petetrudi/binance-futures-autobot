import {
  DEFAULT_RISK_CONFIG,
  DEFAULT_STRATEGY_CONFIG,
  type BacktestEquityPoint,
  type BacktestRequest,
  type BacktestResult,
  type BacktestTrade,
  type Candle,
  type CoinNewsContext,
  type Position,
  type RiskConfig,
  type StrategyConfig,
  type SymbolFilter,
} from '@bot/shared';
import { analyzeMultiTimeframe } from '../analysis/technicalAnalyzer.js';
import { atr } from '../analysis/indicators.js';
import { evaluateSignal } from '../strategy/decisionEngine.js';
import { evaluateRisk, estimateIsolatedLiquidationPrice } from '../risk/riskManager.js';
import { evaluatePositionTick } from '../execution/positionLifecycle.js';
import { roundToStep } from '../market/precision.js';

export interface BacktestInput {
  request: BacktestRequest;
  candles: Candle[];
  riskConfig?: RiskConfig;
  strategyConfig?: StrategyConfig;
}

const NEUTRAL_NEWS_CTX: CoinNewsContext = {
  symbol: 'MARKET',
  newsScore: 0,
  articleCount: 0,
  coinSpecificCount: 0,
  hasRecentHighImpact: false,
  hasBlackSwanAlert: false,
  dominantSentiment: 'NEUTRAL',
  headlineSummaries: [],
};

function resampleCandles(candles: Candle[], groupSize: number): Candle[] {
  if (groupSize <= 1) return candles;
  const out: Candle[] = [];
  for (let i = 0; i < candles.length; i += groupSize) {
    const chunk = candles.slice(i, i + groupSize);
    if (chunk.length === 0) continue;
    out.push({
      openTime: chunk[0].openTime,
      open: chunk[0].open,
      high: Math.max(...chunk.map((c) => c.high)),
      low: Math.min(...chunk.map((c) => c.low)),
      close: chunk.at(-1)!.close,
      volume: chunk.reduce((s, c) => s + c.volume, 0),
      closeTime: chunk.at(-1)!.closeTime,
    });
  }
  return out;
}

/**
 * Runs a strictly causal bar-by-bar intraday futures backtest with taker fees, slippage,
 * partial TP1 + break-even SL move, and ATR trailing stop management.
 */
export function runHistoricalBacktest({
  request,
  candles,
  riskConfig = DEFAULT_RISK_CONFIG,
  strategyConfig = DEFAULT_STRATEGY_CONFIG,
}: BacktestInput): BacktestResult {
  const effectiveRisk: RiskConfig = {
    ...riskConfig,
    defaultLeverage: request.leverage,
    riskPerTradePct: request.riskPerTradePct,
  };
  const effectiveStrategy: StrategyConfig = {
    ...strategyConfig,
    minConfidence: request.minConfidence,
  };

  const warmup = Math.min(120, Math.floor(candles.length * 0.3));
  let balance = request.initialCapital;
  let peakEquity = balance;
  let maxDrawdownPct = 0;

  let activePos: Position | null = null;
  let lastClosedAt = 0;
  const trades: BacktestTrade[] = [];
  const equityCurve: BacktestEquityPoint[] = [];
  const barReturns: number[] = [];
  let prevEquity = balance;

  const h1Group = request.interval === '15m' ? 4 : 1;
  const h4Group = request.interval === '15m' ? 16 : 4;
  const feeRate = effectiveRisk.takerFeePct / 100;
  const slipRate = effectiveRisk.slippagePct / 100;

  const refPrice = candles[0]?.close || 100;
  const stepSize = refPrice >= 1000 ? 0.001 : refPrice >= 10 ? 0.01 : 1;
  const tickSize = refPrice >= 1000 ? 0.1 : refPrice >= 10 ? 0.001 : 0.0001;
  const filter: SymbolFilter = {
    symbol: request.symbol,
    baseAsset: request.symbol.replace(/USDT$/, ''),
    quoteAsset: 'USDT',
    pricePrecision: refPrice >= 1000 ? 1 : refPrice >= 10 ? 3 : 4,
    quantityPrecision: refPrice >= 1000 ? 3 : refPrice >= 10 ? 2 : 0,
    tickSize,
    stepSize,
    minQty: stepSize,
    maxQty: 1_000_000,
    minNotional: 5,
    maxLeverage: 50,
  };

  for (let i = warmup; i < candles.length; i++) {
    const bar = candles[i];
    const windowExec = candles.slice(Math.max(0, i - 220), i + 1);
    const curAtr = atr(windowExec, 14);

    // 1. Evaluate open position intra-bar (check SL conservatively first, then TP/trailing)
    if (activePos) {
      const checkPrices =
        activePos.side === 'LONG'
          ? [bar.low, bar.high, bar.close]
          : [bar.high, bar.low, bar.close];

      for (const px of checkPrices) {
        if (!activePos) break;
        const decision = evaluatePositionTick(
          activePos,
          px,
          curAtr,
          null,
          bar.closeTime,
          effectiveStrategy,
        );

        if (decision.type === 'HOLD') {
          activePos.peakPrice = decision.updatedPeakPrice;
        } else if (decision.type === 'UPDATE_TRAILING_SL') {
          activePos.peakPrice = decision.updatedPeakPrice;
          activePos.stopLoss = roundToStep(decision.newStopLoss, tickSize, 'round');
          activePos.trailingActive = true;
        } else if (decision.type === 'PARTIAL_TP1') {
          const closeQty = roundToStep(
            activePos.remainingQuantity * decision.closeQuantityFraction,
            stepSize,
            'floor',
          );
          if (closeQty > 0 && closeQty < activePos.remainingQuantity) {
            const fill =
              activePos.side === 'LONG'
                ? decision.triggerPrice * (1 - slipRate)
                : decision.triggerPrice * (1 + slipRate);
            const fee = fill * closeQty * feeRate;
            const gross =
              (activePos.side === 'LONG'
                ? fill - activePos.entryPrice
                : activePos.entryPrice - fill) * closeQty;
            const net = gross - fee;
            balance += net;
            activePos.remainingQuantity -= closeQty;
            activePos.realizedPnl += net;
            activePos.feesPaid += fee;
            activePos.tp1Hit = true;
            activePos.trailingActive = true;
            activePos.stopLoss = roundToStep(decision.newStopLoss, tickSize, 'round');
            trades.push({
              entryTime: activePos.openedAt,
              exitTime: bar.closeTime,
              side: activePos.side,
              entryPrice: activePos.entryPrice,
              exitPrice: fill,
              quantity: closeQty,
              realizedPnl: net,
              feesPaid: fee,
              exitReason: 'Partial TP1',
              confidence: activePos.confidence,
            });
          }
        } else if (
          decision.type === 'CLOSE_SL' ||
          decision.type === 'CLOSE_TP2' ||
          decision.type === 'CLOSE_TIME_EXIT'
        ) {
          const fill =
            activePos.side === 'LONG'
              ? decision.triggerPrice * (1 - slipRate)
              : decision.triggerPrice * (1 + slipRate);
          const qty = activePos.remainingQuantity;
          const fee = fill * qty * feeRate;
          const gross =
            (activePos.side === 'LONG'
              ? fill - activePos.entryPrice
              : activePos.entryPrice - fill) * qty;
          const net = gross - fee;
          balance += net;
          trades.push({
            entryTime: activePos.openedAt,
            exitTime: bar.closeTime,
            side: activePos.side,
            entryPrice: activePos.entryPrice,
            exitPrice: fill,
            quantity: qty,
            realizedPnl: net,
            feesPaid: activePos.feesPaid + fee,
            exitReason: decision.reason,
            confidence: activePos.confidence,
          });
          lastClosedAt = bar.closeTime;
          activePos = null;
        }
      }
    }

    // 2. If flat, run technical + decision + risk pipeline on closed bar
    if (!activePos && i < candles.length - 1) {
      const c1h = resampleCandles(windowExec, h1Group);
      const c4h = resampleCandles(candles.slice(0, i + 1), h4Group).slice(-220);
      const tech = analyzeMultiTimeframe(
        request.symbol,
        windowExec,
        c1h,
        c4h,
        0,
        effectiveStrategy,
      );
      const signal = evaluateSignal({
        technical: tech,
        newsContext: { ...NEUTRAL_NEWS_CTX, symbol: request.symbol },
        btcChange1hPct: 0,
        strategyConfig: effectiveStrategy,
      });

      if (signal.action !== 'HOLD') {
        const recentMap = new Map<string, number>();
        if (lastClosedAt > 0) recentMap.set(request.symbol, lastClosedAt);

        const riskEval = evaluateRisk({
          signal,
          account: {
            mode: 'PAPER',
            walletBalance: balance,
            availableBalance: balance,
            isolatedMarginUsed: 0,
            unrealizedPnl: 0,
            totalEquity: balance,
            startingDayEquity: balance,
            dailyPnl: 0,
            dailyPnlPct: 0,
            dailyLossLimitPct: effectiveRisk.maxDailyLossPct,
            circuitBreakerTripped: false,
            totalTrades: trades.length,
            winRatePct: 0,
            profitFactor: 0,
          },
          openPositions: [],
          symbolFilter: filter,
          recentClosedSymbolTimes: recentMap,
          riskConfig: effectiveRisk,
          botState: { killSwitchActive: false, running: true },
          nowMs: bar.closeTime,
        });

        if (riskEval.approved) {
          const fill =
            signal.action === 'LONG'
              ? signal.entryPrice * (1 + slipRate)
              : signal.entryPrice * (1 - slipRate);
          const fee = fill * riskEval.quantity * feeRate;
          balance -= fee;
          activePos = {
            id: `bt-${i}`,
            mode: 'PAPER',
            symbol: request.symbol,
            side: signal.action,
            status: 'OPEN',
            entryPrice: fill,
            markPrice: fill,
            quantity: riskEval.quantity,
            remainingQuantity: riskEval.quantity,
            leverage: riskEval.leverage,
            isolatedMargin: (fill * riskEval.quantity) / riskEval.leverage,
            stopLoss: signal.stopLoss,
            takeProfit1: signal.takeProfit1,
            takeProfit2: signal.takeProfit2,
            tp1Hit: false,
            trailingActive: false,
            peakPrice: fill,
            entryAtr: signal.atr,
            liquidationPrice: estimateIsolatedLiquidationPrice(
              fill,
              riskEval.leverage,
              signal.action,
            ),
            unrealizedPnl: 0,
            realizedPnl: -fee,
            feesPaid: fee,
            confidence: signal.confidence,
            entryReasons: signal.reasons,
            closeReason: null,
            slOrderId: null,
            tpOrderId: null,
            openedAt: bar.closeTime,
            closedAt: null,
          };
        }
      }
    }

    const markUpl = activePos
      ? (activePos.side === 'LONG'
          ? bar.close - activePos.entryPrice
          : activePos.entryPrice - bar.close) * activePos.remainingQuantity
      : 0;
    const equity = balance + markUpl;
    peakEquity = Math.max(peakEquity, equity);
    const ddPct = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
    maxDrawdownPct = Math.max(maxDrawdownPct, ddPct);

    if (prevEquity > 0) {
      barReturns.push((equity - prevEquity) / prevEquity);
    }
    prevEquity = equity;

    equityCurve.push({
      time: Math.floor(bar.closeTime / 1000),
      equity: Number(equity.toFixed(2)),
    });
  }

  // Close remaining open position at final candle close
  if (activePos && candles.length > 0) {
    const last = candles.at(-1)!;
    const fill =
      activePos.side === 'LONG'
        ? last.close * (1 - slipRate)
        : last.close * (1 + slipRate);
    const qty = activePos.remainingQuantity;
    const fee = fill * qty * feeRate;
    const gross =
      (activePos.side === 'LONG'
        ? fill - activePos.entryPrice
        : activePos.entryPrice - fill) * qty;
    const net = gross - fee;
    balance += net;
    trades.push({
      entryTime: activePos.openedAt,
      exitTime: last.closeTime,
      side: activePos.side,
      entryPrice: activePos.entryPrice,
      exitPrice: fill,
      quantity: qty,
      realizedPnl: net,
      feesPaid: activePos.feesPaid + fee,
      exitReason: 'End of backtest window',
      confidence: activePos.confidence,
    });
  }

  const winningTrades = trades.filter((t) => t.realizedPnl > 0);
  const losingTrades = trades.filter((t) => t.realizedPnl < 0);
  const grossProfit = winningTrades.reduce((s, t) => s + t.realizedPnl, 0);
  const grossLoss = Math.abs(losingTrades.reduce((s, t) => s + t.realizedPnl, 0));
  const profitFactor =
    grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0;

  const meanRet =
    barReturns.length > 0
      ? barReturns.reduce((a, b) => a + b, 0) / barReturns.length
      : 0;
  const stdRet =
    barReturns.length > 1
      ? Math.sqrt(
          barReturns.reduce((s, r) => s + (r - meanRet) ** 2, 0) /
            (barReturns.length - 1),
        )
      : 0;
  const barsPerYear = request.interval === '15m' ? 35_040 : 8_760;
  const sharpeRatio = stdRet > 0 ? (meanRet / stdRet) * Math.sqrt(barsPerYear) : 0;

  const finalEquity = Number(balance.toFixed(2));
  const netPnlUsdt = Number((finalEquity - request.initialCapital).toFixed(2));
  const netPnlPct =
    request.initialCapital > 0 ? (netPnlUsdt / request.initialCapital) * 100 : 0;

  return {
    symbol: request.symbol,
    interval: request.interval,
    barsTested: candles.length,
    startTime: candles[0]?.openTime ?? 0,
    endTime: candles.at(-1)?.closeTime ?? 0,
    initialCapital: request.initialCapital,
    finalEquity,
    netPnlUsdt,
    netPnlPct: Number(netPnlPct.toFixed(2)),
    totalTrades: trades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRatePct:
      trades.length > 0 ? Number(((winningTrades.length / trades.length) * 100).toFixed(2)) : 0,
    profitFactor: Number(profitFactor.toFixed(2)),
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
    sharpeRatio: Number(sharpeRatio.toFixed(2)),
    equityCurve,
    trades,
  };
}
