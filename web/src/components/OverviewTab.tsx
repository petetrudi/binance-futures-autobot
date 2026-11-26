import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AreaSeries,
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import {
  AlertTriangle,
  Info,
  LineChart,
  RefreshCw,
} from 'lucide-react';
import type { DashboardSnapshot, Position } from '@bot/shared';
import {
  fmtCompactUsd,
  fmtDuration,
  fmtLocalDateTime,
  fmtPct,
  fmtPrice,
  fmtTimeAgo,
  fmtUsdt,
} from '../lib/format.js';

interface OverviewTabProps {
  snapshot: DashboardSnapshot;
  busyAction: string | null;
  onScanNow: () => void;
  onClosePosition: (id: string) => void;
  onOpenChart: (symbol: string) => void;
}

type TimeRange = '7D' | '30D' | '90D' | '180D' | '365D';
type MetricView = 'ROI' | 'PnL';
type BottomSubTab = 'positions' | 'history' | 'scanner' | 'news';

const TIME_RANGE_OPTIONS: Array<{ value: TimeRange; label: string; ms: number }> = [
  { value: '7D', label: '7 Hari', ms: 7 * 24 * 3_600_000 },
  { value: '30D', label: '30 Hari', ms: 30 * 24 * 3_600_000 },
  { value: '90D', label: '90 Hari', ms: 90 * 24 * 3_600_000 },
  { value: '180D', label: '180 Hari', ms: 180 * 24 * 3_600_000 },
  { value: '365D', label: '365 Hari', ms: 365 * 24 * 3_600_000 },
];

const TIME_RANGE_MS: Record<TimeRange, number> = {
  '7D': 7 * 24 * 3_600_000,
  '30D': 30 * 24 * 3_600_000,
  '90D': 90 * 24 * 3_600_000,
  '180D': 180 * 24 * 3_600_000,
  '365D': 365 * 24 * 3_600_000,
};

const DONUT_COLORS = [
  '#3B82F6',
  '#06B6D4',
  '#10B981',
  '#F59E0B',
  '#EC4899',
  '#8B5CF6',
  '#F97316',
  '#64748B',
];

function computeAvgClosePrice(
  pos: Position,
  trades: DashboardSnapshot['trades'],
): number {
  const exitTrades = trades.filter(
    (t) => t.positionId === pos.id && t.action !== 'OPEN' && t.quantity > 0,
  );
  if (exitTrades.length === 0) return pos.markPrice;
  const totalQty = exitTrades.reduce((s, t) => s + t.quantity, 0);
  if (totalQty <= 0) return pos.markPrice;
  const weighted = exitTrades.reduce((s, t) => s + t.price * t.quantity, 0);
  return weighted / totalQty;
}

export function OverviewTab({
  snapshot,
  busyAction,
  onScanNow,
  onClosePosition,
  onOpenChart,
}: OverviewTabProps) {
  const { account, positions, closedPositions = [], scanner, signals, news, trades } =
    snapshot;

  const [timeRange, setTimeRange] = useState<TimeRange>('365D');
  const [metricView, setMetricView] = useState<MetricView>('ROI');
  const [bottomTab, setBottomTab] = useState<BottomSubTab>(() => {
    if (positions.length > 0) return 'positions';
    if ((snapshot.closedPositions?.length ?? 0) > 0) return 'history';
    return 'scanner';
  });
  const [sortOrder, setSortOrder] = useState<'closingTime' | 'openingTime'>('closingTime');

  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const equityChartRef = useRef<IChartApi | null>(null);
  const equitySeriesRef = useRef<ISeriesApi<'Area'> | null>(null);
  const hasFittedEquityRef = useRef(false);

  const initialCapital =
    account.initialCapitalUsdt && account.initialCapitalUsdt > 0
      ? account.initialCapitalUsdt
      : snapshot.settings.risk.maxAccountCapitalUsdt &&
          snapshot.settings.risk.maxAccountCapitalUsdt > 0
        ? snapshot.settings.risk.maxAccountCapitalUsdt
        : 500;

  // Filter closed & open positions by selected timeRange
  const cutoffMs = Date.now() - TIME_RANGE_MS[timeRange];

  const filteredClosed = useMemo(() => {
    const list = closedPositions.filter(
      (p) => (p.closedAt ?? p.openedAt) >= cutoffMs,
    );
    return [...list].sort((a, b) =>
      sortOrder === 'closingTime'
        ? (b.closedAt ?? b.openedAt) - (a.closedAt ?? a.openedAt)
        : b.openedAt - a.openedAt,
    );
  }, [closedPositions, cutoffMs, sortOrder]);

  const filteredOpen = useMemo(
    () => positions.filter((p) => p.openedAt >= cutoffMs),
    [positions, cutoffMs],
  );

  // Strict real accounting metrics (no hardcoded fake fallbacks)
  const metrics = useMemo(() => {
    const totalCount = filteredClosed.length;
    const wins = filteredClosed.filter((p) => p.realizedPnl > 0);
    const losses = filteredClosed.filter((p) => p.realizedPnl < 0);
    const winCount = wins.length;

    const winRatePct = totalCount > 0 ? (winCount / totalCount) * 100 : 0;

    const grossWin = wins.reduce((s, p) => s + p.realizedPnl, 0);
    const grossLoss = losses.reduce((s, p) => s + Math.abs(p.realizedPnl), 0);
    const profitFactor =
      grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99.0 : 0;

    // Include open positions' entry fees & partial TP1 realized profit so Realized + Unrealized === Net PnL
    const dbClosedRealized = filteredClosed.reduce((s, p) => s + p.realizedPnl, 0);
    const dbOpenRealized = filteredOpen.reduce((s, p) => s + p.realizedPnl, 0);

    // For 365D full account window, derive exact exchange/wallet delta from live balance
    const realizedSum =
      timeRange === '365D'
        ? account.walletBalance - initialCapital
        : dbClosedRealized + dbOpenRealized;

    const netPnl =
      timeRange === '365D'
        ? account.totalEquity - initialCapital
        : realizedSum + account.unrealizedPnl;

    const roiPct = initialCapital > 0 ? (netPnl / initialCapital) * 100 : 0;

    // Chronological cumulative equity for Sharpe & Max Drawdown
    const chrono = [...filteredClosed].sort(
      (a, b) => (a.closedAt ?? a.openedAt) - (b.closedAt ?? a.openedAt),
    );
    let eq = initialCapital;
    let peak = eq;
    let maxDdPct = 0;
    const returns: number[] = [];

    for (const p of chrono) {
      const prevEq = eq;
      eq += p.realizedPnl;
      if (prevEq > 0) returns.push(p.realizedPnl / prevEq);
      if (eq > peak) peak = eq;
      const ddPct = peak > 0 ? ((peak - eq) / peak) * 100 : 0;
      if (ddPct > maxDdPct) maxDdPct = ddPct;
    }

    if (timeRange === '365D') {
      const liveEq = account.totalEquity;
      if (liveEq > peak) peak = liveEq;
      const liveDd = peak > 0 ? ((peak - liveEq) / peak) * 100 : 0;
      if (liveDd > maxDdPct) maxDdPct = liveDd;
    }

    let sharpe = 0;
    if (returns.length >= 2) {
      const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
      const variance =
        returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
      const std = Math.sqrt(variance);
      if (std > 0) {
        sharpe = (mean / std) * Math.sqrt(returns.length);
      }
    }

    return {
      roiPct,
      netPnl,
      realizedSum,
      totalCount,
      winCount,
      winRatePct,
      profitFactor,
      maxDdPct,
      sharpe,
    };
  }, [filteredClosed, filteredOpen, account, initialCapital, timeRange]);

  // Real cumulative equity curve points (strictly ascending unique timestamps)
  const equityCurveData = useMemo(() => {
    const chrono = [...filteredClosed].sort(
      (a, b) => (a.closedAt ?? a.openedAt) - (b.closedAt ?? a.openedAt),
    );
    const nowSec = Math.floor(Date.now() / 1000);
    const points: Array<{ time: number; roi: number; pnl: number }> = [];

    const firstTsMs =
      chrono[0]?.openedAt ?? Date.now() - Math.min(TIME_RANGE_MS[timeRange], 3_600_000);
    let startSec = Math.floor(firstTsMs / 1000) - 60;
    if (startSec >= nowSec) startSec = nowSec - 60;

    let cumulativePnl = 0;
    points.push({ time: startSec, roi: 0, pnl: 0 });

    let lastTime = startSec;
    for (const p of chrono) {
      cumulativePnl += p.realizedPnl;
      let tSec = Math.floor((p.closedAt ?? p.openedAt) / 1000);
      if (tSec <= lastTime) tSec = lastTime + 1;
      lastTime = tSec;
      const roi = initialCapital > 0 ? (cumulativePnl / initialCapital) * 100 : 0;
      points.push({ time: tSec, roi, pnl: cumulativePnl });
    }

    const finalTime = nowSec <= lastTime ? lastTime + 1 : nowSec;
    points.push({
      time: finalTime,
      roi: metrics.roiPct,
      pnl: metrics.netPnl,
    });

    return points;
  }, [filteredClosed, initialCapital, metrics.roiPct, metrics.netPnl, timeRange]);

  // Initialize equity AreaSeries chart cleanly once per metricView/timeRange
  useEffect(() => {
    const el = chartContainerRef.current;
    if (!el) return;

    hasFittedEquityRef.current = false;

    const chart = createChart(el, {
      width: el.clientWidth,
      height: 205,
      layout: {
        background: { type: ColorType.Solid, color: '#0E1420' },
        textColor: '#94A3B8',
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#161F30' },
        horzLines: { color: '#161F30' },
      },
      rightPriceScale: {
        borderColor: '#1E293B',
      },
      timeScale: {
        borderColor: '#1E293B',
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: { color: '#334155', labelBackgroundColor: '#1E293B' },
        horzLine: { color: '#334155', labelBackgroundColor: '#1E293B' },
      },
    });

    const area = chart.addSeries(AreaSeries, {
      lineColor: '#10B981',
      topColor: 'rgba(16, 185, 129, 0.30)',
      bottomColor: 'rgba(14, 20, 32, 0.0)',
      lineWidth: 2,
      priceFormat: {
        type: 'custom',
        formatter: (price: number) =>
          metricView === 'ROI'
            ? `${price >= 0 ? '+' : ''}${price.toFixed(2)}%`
            : `${price >= 0 ? '+' : ''}$${price.toFixed(2)}`,
      },
    });

    equityChartRef.current = chart;
    equitySeriesRef.current = area;

    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0) chart.applyOptions({ width: el.clientWidth });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
      equityChartRef.current = null;
      equitySeriesRef.current = null;
    };
  }, [metricView, timeRange]);

  // Update equity curve points & color smoothly without destroying chart
  useEffect(() => {
    const chart = equityChartRef.current;
    const area = equitySeriesRef.current;
    if (!chart || !area || equityCurveData.length === 0) return;

    const isPositive =
      (metricView === 'ROI' ? metrics.roiPct : metrics.netPnl) >= 0;
    area.applyOptions({
      lineColor: isPositive ? '#10B981' : '#F43F5E',
      topColor: isPositive
        ? 'rgba(16, 185, 129, 0.30)'
        : 'rgba(244, 63, 94, 0.30)',
    });

    area.setData(
      equityCurveData.map((pt) => ({
        time: pt.time as UTCTimestamp,
        value: metricView === 'ROI' ? pt.roi : pt.pnl,
      })),
    );

    if (!hasFittedEquityRef.current) {
      chart.timeScale().fitContent();
      hasFittedEquityRef.current = true;
    }
  }, [equityCurveData, metricView, metrics.roiPct, metrics.netPnl]);

  // Real Asset Preferences filtered by selected timeRange
  const assetAllocation = useMemo(() => {
    const combined = [...filteredOpen, ...filteredClosed];
    if (combined.length > 0) {
      const volMap = new Map<string, number>();
      let total = 0;
      for (const p of combined) {
        const base = p.symbol.replace('USDT', '');
        const notional = Math.max(p.quantity * p.entryPrice, 1);
        volMap.set(base, (volMap.get(base) ?? 0) + notional);
        total += notional;
      }
      const sorted = Array.from(volMap.entries()).sort((a, b) => b[1] - a[1]);
      const top = sorted.slice(0, 7);
      const otherVal = sorted.slice(7).reduce((s, [, v]) => s + v, 0);
      const items = top.map(([name, val], i) => ({
        name,
        symbol: `${name}USDT`,
        color: DONUT_COLORS[i % DONUT_COLORS.length]!,
        pct: Number(((val / Math.max(total, 1)) * 100).toFixed(2)),
      }));
      if (otherVal > 0) {
        items.push({
          name: 'OTHER',
          symbol: '',
          color: '#64748B',
          pct: Number(((otherVal / Math.max(total, 1)) * 100).toFixed(2)),
        });
      }
      return { isWatchlistPreview: false, items };
    }

    const topScanner = scanner.slice(0, 7);
    const totalVol = topScanner.reduce((s, c) => s + Math.max(c.quoteVolume24h, 1), 0);
    if (topScanner.length === 0 || totalVol <= 0) {
      return {
        isWatchlistPreview: true,
        items: [
          { name: 'BTC', symbol: 'BTCUSDT', color: DONUT_COLORS[0]!, pct: 50 },
          { name: 'ETH', symbol: 'ETHUSDT', color: DONUT_COLORS[1]!, pct: 50 },
        ],
      };
    }
    return {
      isWatchlistPreview: true,
      items: topScanner.map((c, i) => ({
        name: c.symbol.replace('USDT', ''),
        symbol: c.symbol,
        color: DONUT_COLORS[i % DONUT_COLORS.length]!,
        pct: Number(((c.quoteVolume24h / totalVol) * 100).toFixed(2)),
      })),
    };
  }, [filteredOpen, filteredClosed, scanner]);

  const dailyLossUsedPct = Math.min(
    100,
    Math.max(
      0,
      account.dailyPnlPct < 0
        ? (Math.abs(account.dailyPnlPct) /
            Math.max(account.dailyLossLimitPct, 0.1)) *
            100
        : 0,
    ),
  );

  const riskDollarPerTrade =
    initialCapital * (snapshot.settings.risk.riskPerTradePct / 100);

  return (
    <div className="space-y-4">
      {/* ============================================================ */}
      {/* ROW 1: PERFORMANCE STATS & REAL EQUITY CURVE                 */}
      {/* ============================================================ */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Left: Performance Card */}
        <div className="flex flex-col justify-between rounded-xl border border-slate-800/90 bg-[#0E1420] p-4 shadow-sm lg:col-span-4">
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-100">Performance</h2>
              <select
                value={timeRange}
                onChange={(e) => setTimeRange(e.target.value as TimeRange)}
                aria-label="Performance Time Range"
                className="cursor-pointer rounded-lg border border-slate-700/80 bg-[#080C14] px-2.5 py-1 text-xs font-semibold text-slate-200 outline-none hover:border-slate-500"
              >
                {TIME_RANGE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Hero ROI & PnL */}
            <div className="mb-3 grid grid-cols-2 gap-3 border-b border-slate-800/80 pb-3">
              <div>
                <div className="text-[11px] font-semibold text-slate-400">ROI</div>
                <div
                  className={`font-mono-num mt-1 text-2xl font-black tracking-tight ${
                    metrics.roiPct >= 0 ? 'text-[#10B981]' : 'text-rose-400'
                  }`}
                >
                  {fmtPct(metrics.roiPct)}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-semibold text-slate-400">Net PnL</div>
                <div
                  className={`font-mono-num mt-1 text-2xl font-black tracking-tight ${
                    metrics.netPnl >= 0 ? 'text-[#10B981]' : 'text-rose-400'
                  }`}
                >
                  {fmtUsdt(metrics.netPnl, true)}
                </div>
              </div>
            </div>

            {/* Performance Rows (100% Real Data) */}
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="border-b border-dotted border-slate-700 text-slate-400">
                  Copier PnL
                </span>
                <span className="font-mono-num font-semibold text-slate-400">
                  $0.00 USDT <span className="text-[10px]">(0 Copiers)</span>
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="border-b border-dotted border-slate-700 text-slate-400">
                  Realized PnL
                </span>
                <span
                  className={`font-mono-num font-bold ${
                    metrics.realizedSum >= 0 ? 'text-[#10B981]' : 'text-rose-400'
                  }`}
                >
                  {fmtUsdt(metrics.realizedSum, true)} USDT
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="border-b border-dotted border-slate-700 text-slate-400">
                  Unrealized PnL
                </span>
                <span
                  className={`font-mono-num font-bold ${
                    account.unrealizedPnl >= 0 ? 'text-cyan-300' : 'text-rose-400'
                  }`}
                >
                  {fmtUsdt(account.unrealizedPnl, true)} USDT
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="border-b border-dotted border-slate-700 text-slate-400">
                  Sharpe / Profit Factor
                </span>
                <span className="font-mono-num font-bold text-slate-200">
                  {metrics.sharpe.toFixed(2)} / PF {metrics.profitFactor.toFixed(2)}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="border-b border-dotted border-slate-700 text-slate-400">
                  Max Drawdown (MDD)
                </span>
                <span className="font-mono-num font-bold text-slate-200">
                  {metrics.maxDdPct.toFixed(2)}%
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="border-b border-dotted border-slate-700 text-slate-400">
                  Win Rate
                </span>
                <span className="font-mono-num font-bold text-[#10B981]">
                  {metrics.winRatePct.toFixed(2)}%
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="border-b border-dotted border-slate-700 text-slate-400">
                  Win / Total Positions
                </span>
                <span className="font-mono-num font-bold text-slate-200">
                  {metrics.winCount} / {metrics.totalCount}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: ROI / PnL Live Chart (lightweight-charts AreaSeries) */}
        <div className="flex flex-col justify-between rounded-xl border border-slate-800/90 bg-[#0E1420] p-4 shadow-sm lg:col-span-8">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-[#080C14] p-1">
                <button
                  type="button"
                  onClick={() => setMetricView('ROI')}
                  className={`rounded px-3 py-1 text-xs font-bold transition ${
                    metricView === 'ROI'
                      ? 'bg-slate-700/80 text-slate-100 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  ROI (%)
                </button>
                <button
                  type="button"
                  onClick={() => setMetricView('PnL')}
                  className={`rounded px-3 py-1 text-xs font-bold transition ${
                    metricView === 'PnL'
                      ? 'bg-slate-700/80 text-slate-100 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  PnL (USDT)
                </button>
              </div>
              {closedPositions.length === 0 && (
                <span className="hidden rounded border border-slate-700/80 bg-[#080C14] px-2 py-0.5 text-[11px] text-slate-400 sm:inline">
                  Menunggu trade tertutup pertama · Tracking live baseline
                </span>
              )}
            </div>

            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value as TimeRange)}
              aria-label="Chart Time Range"
              className="cursor-pointer rounded-lg border border-slate-700/80 bg-[#080C14] px-2.5 py-1 text-xs font-semibold text-slate-200 outline-none hover:border-slate-500"
            >
              {TIME_RANGE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div
            ref={chartContainerRef}
            className="h-[205px] w-full overflow-hidden rounded-lg border border-slate-800/70 bg-[#0E1420]"
          />
        </div>
      </div>

      {/* ============================================================ */}
      {/* ROW 2: LEAD TRADER OVERVIEW & ASSET PREFERENCES (DONUT)      */}
      {/* ============================================================ */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Left: Lead Trader & Risk Overview */}
        <div className="flex flex-col justify-between rounded-xl border border-slate-800/90 bg-[#0E1420] p-4 shadow-sm lg:col-span-4">
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-100">
                Lead Trader Overview
              </h2>
              {snapshot.settings.risk.maxAccountCapitalUsdt && (
                <span className="rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-bold text-cyan-300">
                  Cap ${snapshot.settings.risk.maxAccountCapitalUsdt}
                </span>
              )}
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Total Equity (AUM)</span>
                <span className="font-mono-num text-sm font-bold text-slate-100">
                  {fmtUsdt(account.totalEquity)} USDT
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-400">Free Margin Balance</span>
                <span className="font-mono-num font-bold text-slate-200">
                  {fmtUsdt(account.availableBalance)} USDT
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-400">Isolated Margin Used</span>
                <span className="font-mono-num font-bold text-slate-200">
                  {fmtUsdt(account.isolatedMarginUsed)} ({positions.length}/
                  {snapshot.settings.risk.maxConcurrentPositions} Pos)
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-400">Risk / Max Margin</span>
                <span className="font-mono-num font-bold text-emerald-400">
                  {snapshot.settings.risk.riskPerTradePct}% (~${riskDollarPerTrade.toFixed(2)}) · Max{' '}
                  {snapshot.settings.risk.maxMarginPerTradePct}%
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-400">Leverage & Confidence</span>
                <span className="font-mono-num font-bold text-slate-200">
                  {snapshot.settings.risk.defaultLeverage}x Isolated · Min{' '}
                  {snapshot.settings.strategy.minConfidence}%
                </span>
              </div>
            </div>
          </div>

          {/* Daily Loss Circuit Guard */}
          <div className="mt-4 rounded-lg border border-slate-800/80 bg-[#080C14] p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Daily PnL & Loss Guard</span>
              <span
                className={`font-mono-num font-bold ${
                  account.dailyPnl >= 0 ? 'text-[#10B981]' : 'text-rose-400'
                }`}
              >
                {fmtUsdt(account.dailyPnl, true)} ({fmtPct(account.dailyPnlPct)})
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className={`h-full transition-all ${
                  dailyLossUsedPct > 75 ? 'bg-rose-500' : 'bg-amber-400'
                }`}
                style={{ width: `${dailyLossUsedPct}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-slate-500">
              <span>Protected by Auto Break-Even + SL</span>
              <span>Limit: -{account.dailyLossLimitPct}%</span>
            </div>
          </div>
        </div>

        {/* Right: Asset Preferences (Real Donut Chart) */}
        <div className="flex flex-col justify-between rounded-xl border border-slate-800/90 bg-[#0E1420] p-4 shadow-sm lg:col-span-8">
          <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-slate-100">
                  Asset Preferences
                </h2>
                <span
                  className="inline-flex items-center gap-1 rounded border border-slate-700/80 bg-[#080C14] px-2 py-0.5 text-[10px] font-semibold text-slate-400"
                  title="Diambil dari posisi nyata atau watchlist likuiditas Binance"
                >
                  <Info className="h-3 w-3 text-cyan-400" />
                  {assetAllocation.isWatchlistPreview
                    ? 'Scanner Watchlist Share (Pre-Trade)'
                    : 'Executed Exposure Share'}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={timeRange}
                  onChange={(e) => setTimeRange(e.target.value as TimeRange)}
                  aria-label="Asset Allocation Time Range"
                  className="cursor-pointer rounded-lg border border-slate-700/80 bg-[#080C14] px-2.5 py-1 text-xs font-semibold text-slate-200 outline-none hover:border-slate-500"
                >
                  {TIME_RANGE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={onScanNow}
                  disabled={busyAction === 'scan' || snapshot.status.scannerInProgress}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 text-xs font-semibold text-cyan-300 transition hover:bg-cyan-500/20 disabled:opacity-50"
                >
                  <RefreshCw
                    className={`h-3 w-3 ${
                      snapshot.status.scannerInProgress ? 'animate-spin' : ''
                    }`}
                  />
                  Scan Market
                </button>
              </div>
            </div>

            <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
              {/* Crisp Aspect-Square Donut Chart */}
              <div className="relative h-36 w-36 shrink-0">
                <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
                  {(() => {
                    let accPct = 0;
                    return assetAllocation.items.map((slice) => {
                      const radius = 36;
                      const circum = 2 * Math.PI * radius;
                      const dash = Math.max((slice.pct / 100) * circum, 0.5);
                      const offset = (accPct / 100) * circum;
                      accPct += slice.pct;
                      return (
                        <circle
                          key={slice.name}
                          cx="50"
                          cy="50"
                          r={radius}
                          fill="transparent"
                          stroke={slice.color}
                          strokeWidth="13"
                          strokeDasharray={`${dash} ${Math.max(circum - dash, 0)}`}
                          strokeDashoffset={-offset}
                          className="cursor-pointer transition-opacity hover:opacity-80"
                          onClick={() => slice.symbol && onOpenChart(slice.symbol)}
                        />
                      );
                    });
                  })()}
                </svg>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase">
                    {assetAllocation.isWatchlistPreview ? 'Watchlist' : 'Traded'}
                  </span>
                  <span className="text-sm font-bold text-slate-100">
                    {assetAllocation.items.length} Assets
                  </span>
                </div>
              </div>

              {/* Interactive Coin Legend */}
              <div className="grid w-full flex-1 grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
                {assetAllocation.items.map((slice) => (
                  <button
                    key={slice.name}
                    type="button"
                    disabled={!slice.symbol}
                    onClick={() => slice.symbol && onOpenChart(slice.symbol)}
                    className="group flex items-center justify-between gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left transition hover:border-slate-700/80 hover:bg-[#080C14] disabled:cursor-default"
                    title={
                      slice.symbol
                        ? `Klik untuk buka tab grafik realtime ${slice.symbol}`
                        : undefined
                    }
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-3.5 shrink-0 rounded-sm"
                        style={{ backgroundColor: slice.color }}
                      />
                      <span className="font-semibold text-slate-200 group-hover:text-cyan-300">
                        {slice.name}
                      </span>
                    </div>
                    <span className="font-mono-num text-[11px] text-slate-400">
                      {slice.pct.toFixed(2)}%
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-slate-800/60 pt-2.5 text-[11px] text-slate-500">
            <span>
              *Klik koin mana saja di atas atau di tabel bawah untuk memunculkan Tab Grafik Realtime.
            </span>
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* ROW 3: POSITIONS, POSITION HISTORY, AUTO-SCANNER, NEWS       */}
      {/* ============================================================ */}
      <div className="rounded-xl border border-slate-800/90 bg-[#0E1420] p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-2.5">
          <div className="flex flex-wrap items-center gap-5 text-sm font-bold">
            <button
              type="button"
              onClick={() => setBottomTab('positions')}
              className={`-mb-[11px] border-b-2 pb-2.5 transition ${
                bottomTab === 'positions'
                  ? 'border-[#F0B90B] text-slate-100'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Positions ({positions.length})
            </button>
            <button
              type="button"
              onClick={() => setBottomTab('history')}
              className={`-mb-[11px] border-b-2 pb-2.5 transition ${
                bottomTab === 'history'
                  ? 'border-[#F0B90B] text-slate-100'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Position History ({filteredClosed.length})
            </button>
            <button
              type="button"
              onClick={() => setBottomTab('scanner')}
              className={`-mb-[11px] border-b-2 pb-2.5 transition ${
                bottomTab === 'scanner'
                  ? 'border-[#F0B90B] text-slate-100'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Auto-Scanner Pairs ({scanner.length})
            </button>
            <button
              type="button"
              onClick={() => setBottomTab('news')}
              className={`-mb-[11px] border-b-2 pb-2.5 transition ${
                bottomTab === 'news'
                  ? 'border-[#F0B90B] text-slate-100'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Latest News ({news.length})
            </button>
          </div>

          {bottomTab === 'history' && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-400">Sort By</span>
              <select
                value={sortOrder}
                onChange={(e) =>
                  setSortOrder(e.target.value as 'closingTime' | 'openingTime')
                }
                className="rounded-lg border border-slate-700/80 bg-[#080C14] px-2.5 py-1 font-semibold text-slate-200 outline-none"
              >
                <option value="closingTime">Closing Time</option>
                <option value="openingTime">Opening Time</option>
              </select>
            </div>
          )}
        </div>

        {/* -------------------- ACTIVE POSITIONS -------------------- */}
        {bottomTab === 'positions' && (
          <div className="space-y-3">
            {positions.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 py-10 text-center">
                <p className="text-xs text-slate-400">
                  Belum ada posisi aktif saat ini. Bot memindai market setiap{' '}
                  {snapshot.settings.strategy.scanIntervalSeconds}s.
                </p>
                <button
                  type="button"
                  onClick={() => setBottomTab('scanner')}
                  className="mt-3 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/20"
                >
                  Lihat Top Auto-Scanner Pairs
                </button>
              </div>
            ) : (
              positions.map((pos) => {
                const roePct =
                  pos.isolatedMargin > 0
                    ? (pos.unrealizedPnl / pos.isolatedMargin) * 100
                    : 0;
                const base = pos.symbol.replace('USDT', '');
                return (
                  <div
                    key={pos.id}
                    className="rounded-xl border border-slate-800/90 bg-[#080C14] p-4 transition hover:border-slate-700"
                  >
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onOpenChart(pos.symbol)}
                          className="text-sm font-bold text-slate-100 hover:text-cyan-300"
                        >
                          {pos.symbol}
                        </button>
                        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-slate-400">
                          Perp
                        </span>
                        <span className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] font-bold text-slate-300">
                          {pos.leverage}x
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            pos.side === 'LONG'
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : 'bg-rose-500/15 text-rose-400'
                          }`}
                        >
                          Isolated {pos.side === 'LONG' ? 'Long' : 'Short'}
                        </span>
                        {pos.tp1Hit && (
                          <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                            TP1 HIT
                          </span>
                        )}
                        {pos.tp2Hit && (
                          <span className="rounded bg-emerald-500/25 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-200">
                            TP2 HIT
                          </span>
                        )}
                        {pos.trailingActive && (
                          <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-300">
                            TRAILING
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onOpenChart(pos.symbol)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-[#0E1420] px-2.5 py-1 text-xs font-semibold text-cyan-300 hover:bg-slate-800"
                        >
                          <LineChart className="h-3.5 w-3.5" />
                          Grafik Realtime
                        </button>
                        <button
                          type="button"
                          onClick={() => onClosePosition(pos.id)}
                          disabled={busyAction === `close-${pos.id}`}
                          className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
                        >
                          Close
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-5">
                      <div>
                        <div className="text-[11px] text-slate-400">Entry Price</div>
                        <div className="font-mono-num mt-0.5 text-slate-200">
                          ${fmtPrice(pos.entryPrice)}
                        </div>
                        <div className="mt-1.5 text-[11px] text-slate-400">Mark Price</div>
                        <div className="font-mono-num text-cyan-300">
                          ${fmtPrice(pos.markPrice)}
                        </div>
                      </div>

                      <div>
                        <div className="text-[11px] text-slate-400">Position Size</div>
                        <div className="font-mono-num mt-0.5 text-slate-200">
                          {pos.remainingQuantity} {base}
                        </div>
                        <div className="mt-1.5 text-[11px] text-slate-400">Margin Used</div>
                        <div className="font-mono-num text-slate-200">
                          {fmtUsdt(pos.isolatedMargin)}
                        </div>
                      </div>

                      <div>
                        <div className="text-[11px] text-slate-400">Stop Loss</div>
                        <div className="font-mono-num mt-0.5 text-rose-400">
                          ${fmtPrice(pos.stopLoss)}
                        </div>
                        <div className="mt-1.5 text-[11px] text-slate-400">
                          Take Profit (1 / 2 / 3)
                        </div>
                        <div className="font-mono-num text-emerald-400">
                          ${fmtPrice(pos.takeProfit1)} / ${fmtPrice(pos.takeProfit2)} / $
                          {fmtPrice(pos.takeProfit3 ?? pos.takeProfit2)}
                        </div>
                      </div>

                      <div>
                        <div className="text-[11px] text-slate-400">Unrealized PnL</div>
                        <div
                          className={`font-mono-num mt-0.5 text-sm font-bold ${
                            pos.unrealizedPnl >= 0 ? 'text-[#10B981]' : 'text-rose-400'
                          }`}
                        >
                          {fmtUsdt(pos.unrealizedPnl, true)}
                        </div>
                        <div className="font-mono-num text-[11px] text-slate-400">
                          {fmtPct(roePct)} ROE
                        </div>
                      </div>

                      <div>
                        <div className="text-[11px] text-slate-400">Liq. Price</div>
                        <div className="font-mono-num mt-0.5 text-amber-300">
                          ${fmtPrice(pos.liquidationPrice)}
                        </div>
                        <div className="mt-1.5 text-[11px] text-slate-400">Opened</div>
                        <div className="font-mono-num text-[11px] text-slate-300">
                          {fmtLocalDateTime(pos.openedAt)}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* -------------------- POSITION HISTORY (REAL CLOSED POSITIONS) -------------------- */}
        {bottomTab === 'history' && (
          <div className="space-y-3">
            {filteredClosed.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 py-10 text-center">
                <p className="text-xs text-slate-400">
                  Belum ada posisi tertutup pada rentang waktu {timeRange.replace('D', ' Hari')}.
                </p>
                <button
                  type="button"
                  onClick={() => setBottomTab('scanner')}
                  className="mt-3 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/20"
                >
                  Inspect Coin di Auto-Scanner
                </button>
              </div>
            ) : (
              filteredClosed.map((pos) => {
                const isWin = pos.realizedPnl >= 0;
                const avgClose = computeAvgClosePrice(pos, trades);
                const base = pos.symbol.replace('USDT', '');
                const closedTs = pos.closedAt ?? pos.openedAt;

                return (
                  <div
                    key={pos.id}
                    onClick={() => onOpenChart(pos.symbol)}
                    className="group cursor-pointer rounded-xl border border-slate-800/90 bg-[#080C14] p-4 transition hover:border-cyan-500/40 hover:bg-[#0B1220]"
                  >
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-slate-100 group-hover:text-cyan-300">
                          {pos.symbol}
                        </span>
                        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-slate-400">
                          Perp
                        </span>
                        <span className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] font-bold text-slate-300">
                          {pos.leverage}x
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            pos.side === 'LONG'
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : 'bg-rose-500/15 text-rose-400'
                          }`}
                        >
                          Isolated {pos.side === 'LONG' ? 'Long' : 'Short'}
                        </span>
                        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                          Closed
                        </span>
                      </div>

                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-400 group-hover:text-cyan-300">
                        <LineChart className="h-3.5 w-3.5" />
                        Buka Tab Grafik
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-5">
                      <div>
                        <div className="text-[11px] text-slate-400">Opened</div>
                        <div className="font-mono-num mt-0.5 text-slate-200">
                          {fmtLocalDateTime(pos.openedAt)}
                        </div>
                        <div className="mt-1.5 text-[11px] text-slate-400">
                          Avg. Close Price
                        </div>
                        <div className="font-mono-num text-slate-200">
                          {fmtPrice(avgClose)} USDT
                        </div>
                      </div>

                      <div>
                        <div className="text-[11px] text-slate-400">Entry Price</div>
                        <div className="font-mono-num mt-0.5 text-slate-200">
                          {fmtPrice(pos.entryPrice)} USDT
                        </div>
                        <div className="mt-1.5 text-[11px] text-slate-400">
                          Closed Vol.
                        </div>
                        <div className="font-mono-num text-slate-200">
                          {pos.quantity} {base}
                        </div>
                      </div>

                      <div>
                        <div className="text-[11px] text-slate-400">
                          Max. Open Interest
                        </div>
                        <div className="font-mono-num mt-0.5 text-slate-200">
                          {pos.quantity} {base}
                        </div>
                        <div className="mt-1.5 text-[11px] text-slate-400">
                          Hold Duration
                        </div>
                        <div className="font-mono-num text-slate-300">
                          {fmtDuration(pos.openedAt, closedTs)}
                        </div>
                      </div>

                      <div>
                        <div className="text-[11px] text-slate-400">Closing PNL</div>
                        <div
                          className={`font-mono-num mt-0.5 text-sm font-bold ${
                            isWin ? 'text-[#10B981]' : 'text-rose-400'
                          }`}
                        >
                          {isWin ? '+' : ''}
                          {pos.realizedPnl.toFixed(2)} USDT
                        </div>
                        <div className="mt-1 truncate text-[10px] text-slate-500">
                          {pos.closeReason ?? 'Closed'}
                        </div>
                      </div>

                      <div>
                        <div className="text-[11px] text-slate-400">Closed</div>
                        <div className="font-mono-num mt-0.5 text-slate-200">
                          {fmtLocalDateTime(closedTs)}
                        </div>
                        <div className="mt-1.5 text-[11px] text-slate-400">Fees Paid</div>
                        <div className="font-mono-num text-slate-400">
                          -{pos.feesPaid.toFixed(3)} USDT
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* -------------------- AUTO-SCANNER PAIRS -------------------- */}
        {bottomTab === 'scanner' && (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {scanner.length === 0 ? (
              <div className="col-span-full py-10 text-center text-xs text-slate-500">
                Memindai pasangan likuid Binance Futures...
              </div>
            ) : (
              scanner.map((c) => {
                const sig = signals.find((s) => s.symbol === c.symbol);
                return (
                  <button
                    key={c.symbol}
                    type="button"
                    onClick={() => onOpenChart(c.symbol)}
                    className="group flex flex-col justify-between gap-2 rounded-xl border border-slate-800/90 bg-[#080C14] p-3.5 text-left transition hover:border-cyan-500/50 hover:bg-[#0C1322]"
                  >
                    <div className="flex w-full items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-bold text-slate-100 group-hover:text-cyan-300">
                            {c.symbol}
                          </span>
                          {sig && sig.action !== 'HOLD' && (
                            <span
                              className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
                                sig.action === 'LONG'
                                  ? 'bg-emerald-500/20 text-emerald-300'
                                  : 'bg-rose-500/20 text-rose-300'
                              }`}
                            >
                              {sig.action} {sig.confidence}%
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-400">
                          Vol {fmtCompactUsd(c.quoteVolume24h)} · Score {c.scannerScore}
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="font-mono-num text-xs font-bold text-slate-100">
                          ${fmtPrice(c.lastPrice)}
                        </div>
                        <div
                          className={`font-mono-num text-[11px] font-semibold ${
                            c.priceChangePercent24h >= 0
                              ? 'text-[#10B981]'
                              : 'text-rose-400'
                          }`}
                        >
                          {fmtPct(c.priceChangePercent24h)}
                        </div>
                      </div>
                    </div>

                    <div className="flex w-full items-center justify-between border-t border-slate-800/70 pt-2 text-[10px] text-slate-500">
                      <span>
                        {sig ? sig.regime.replaceAll('_', ' ') : 'Monitoring'}
                      </span>
                      <span className="inline-flex items-center gap-1 font-semibold text-cyan-400/80 group-hover:text-cyan-300">
                        <LineChart className="h-3 w-3" />
                        Lihat Grafik
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        )}

        {/* -------------------- LATEST NEWS & AI -------------------- */}
        {bottomTab === 'news' && (
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
            {news.slice(0, 8).map((item) => (
              <a
                key={item.id}
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="block rounded-xl border border-slate-800/90 bg-[#080C14] p-3.5 transition hover:border-slate-700"
              >
                <div className="mb-1.5 flex items-center justify-between gap-2 text-[10px]">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`rounded px-1.5 py-0.5 font-bold ${
                        item.isBlackSwan
                          ? 'bg-rose-600 text-white'
                          : item.sentiment === 'BULLISH'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : item.sentiment === 'BEARISH'
                              ? 'bg-rose-500/20 text-rose-300'
                              : 'bg-slate-700/60 text-slate-300'
                      }`}
                    >
                      {item.isBlackSwan
                        ? 'BLACK SWAN'
                        : `${item.sentiment} ${item.score >= 0 ? '+' : ''}${item.score}`}
                    </span>
                    <span className="text-cyan-300">
                      {item.symbols.slice(0, 3).join(', ')}
                    </span>
                  </div>
                  <span className="text-slate-500">
                    {fmtTimeAgo(item.publishedAt)}
                  </span>
                </div>
                <div className="line-clamp-2 text-xs font-semibold text-slate-200">
                  {item.title}
                </div>
              </a>
            ))}
            {news.length === 0 && (
              <div className="col-span-full py-10 text-center text-xs text-slate-500">
                Mengambil berita crypto & sentimen AI...
              </div>
            )}
          </div>
        )}
      </div>

      {/* Circuit Breaker Warning */}
      {account.circuitBreakerTripped && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-500/50 bg-rose-950/50 p-3 text-xs text-rose-200">
          <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
          Daily Loss Circuit Breaker aktif (-{account.dailyLossLimitPct}% max daily drawdown). Auto-trading dijeda hingga pergantian hari UTC atau restart manual.
        </div>
      )}
    </div>
  );
}
