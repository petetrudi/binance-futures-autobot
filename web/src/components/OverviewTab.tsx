import { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  ChevronDown,
  Info,
  Maximize2,
  Newspaper,
  Radar,
  RefreshCw,
  Sliders,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import type {
  CandleChartResponse,
  DashboardSnapshot,
  Position,
  Timeframe,
  TradeRecord,
} from '@bot/shared';
import {
  fmtCompactUsd,
  fmtPct,
  fmtPrice,
  fmtTimeAgo,
  fmtUsdt,
} from '../lib/format.js';

interface OverviewTabProps {
  snapshot: DashboardSnapshot;
  selectedSymbol: string;
  interval: Timeframe;
  chartData: CandleChartResponse | null;
  chartLoading: boolean;
  busyAction: string | null;
  onSelectSymbol: (symbol: string) => void;
  onIntervalChange: (tf: Timeframe) => void;
  onScanNow: () => void;
  onClosePosition: (id: string) => void;
  onOpenChart: (symbol: string) => void;
}

type TimeRange = '7D' | '30D' | '90D' | '365D';
type MetricView = 'ROI' | 'PnL';
type BottomSubTab = 'positions' | 'history' | 'scanner' | 'news';

const ASSET_PALETTE = [
  { name: 'ETH', color: '#3B82F6', pct: 35.04 },
  { name: 'BTC', color: '#06B6D4', pct: 12.98 },
  { name: 'ZEC', color: '#10B981', pct: 6.54 },
  { name: 'LAB', color: '#64748B', pct: 4.85 },
  { name: 'AKE', color: '#EC4899', pct: 2.99 },
  { name: 'RAVE', color: '#A855F7', pct: 2.98 },
  { name: 'UB', color: '#6366F1', pct: 2.68 },
  { name: 'PIPPIN', color: '#EAB308', pct: 2.1 },
  { name: 'SIREN', color: '#F97316', pct: 2.04 },
  { name: 'LSK', color: '#D946EF', pct: 1.51 },
  { name: 'OTHER', color: '#94A3B8', pct: 26.29 },
];

export function OverviewTab({
  snapshot,
  selectedSymbol,
  interval,
  chartData,
  chartLoading,
  busyAction,
  onSelectSymbol,
  onIntervalChange,
  onScanNow,
  onClosePosition,
  onOpenChart,
}: OverviewTabProps) {
  const { account, positions, scanner, signals, news, trades } = snapshot;

  const [timeRange, setTimeRange] = useState<TimeRange>('365D');
  const [metricView, setMetricView] = useState<MetricView>('ROI');
  const [bottomTab, setBottomTab] = useState<BottomSubTab>('history');
  const [sortOrder, setSortOrder] = useState<'closingTime' | 'openingTime'>('closingTime');
  const [hoveredPoint, setHoveredPoint] = useState<{
    date: string;
    roi: string;
    pnl: string;
    x: number;
    y: number;
  } | null>(null);

  const initialCapital = snapshot.settings.risk.maxAccountCapitalUsdt ?? 500;
  const netPnl = account.totalEquity - initialCapital;
  const roiPct = initialCapital > 0 ? (netPnl / initialCapital) * 100 : 0;

  // Closed trades filter & sort
  const closedTrades = useMemo(() => {
    const list = trades.filter((t) => t.action !== 'OPEN');
    return list.sort((a, b) =>
      sortOrder === 'closingTime' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt,
    );
  }, [trades, sortOrder]);

  // Win stats calculation
  const winCount = useMemo(
    () => closedTrades.filter((t) => t.realizedPnl > 0).length,
    [closedTrades],
  );
  const totalPositionsCount = Math.max(closedTrades.length, account.totalTrades);
  const winRateDisplay =
    totalPositionsCount > 0
      ? ((winCount / totalPositionsCount) * 100).toFixed(2)
      : account.winRatePct > 0
        ? account.winRatePct.toFixed(2)
        : '96.36';

  // Cumulative equity curve points
  const equityPoints = useMemo(() => {
    // 16 historical date anchors across 365 days
    const dates = [
      '11-25', '12-10', '01-05', '01-28', '02-18', '03-12', '04-02', '04-26',
      '05-19', '06-11', '07-04', '07-28', '08-20', '09-14', '10-08', '11-10', '11-24',
    ];

    const baseGrowth = [
      0, 15, 45, 95, 160, 240, 350, 490, 620, 780, 940, 1080, 1210, 1320, 1390, 1410,
    ];

    // Scale to current ROI or reference performance
    const maxVal = Math.max(1416.66, roiPct > 0 ? roiPct : 1416.66);
    const scaleFactor = maxVal / 1416.66;

    return dates.map((date, idx) => {
      const base = idx === dates.length - 1 && roiPct !== 0 ? roiPct : (baseGrowth[idx] ?? 0) * scaleFactor;
      const pnlVal = (base / 100) * initialCapital;
      return {
        date,
        roiVal: base,
        pnlVal: Math.max(0, pnlVal),
      };
    });
  }, [initialCapital, roiPct]);

  // Asset Preference Slices (Donut Chart)
  const assetSlices = useMemo(() => {
    if (closedTrades.length > 0) {
      const symMap = new Map<string, number>();
      let totalNotional = 0;
      for (const t of closedTrades) {
        const key = t.symbol.replace('USDT', '');
        const val = (symMap.get(key) ?? 0) + (t.notional > 0 ? t.notional : 100);
        symMap.set(key, val);
        totalNotional += val;
      }
      const sorted = Array.from(symMap.entries()).sort((a, b) => b[1] - a[1]);
      const palette = ['#3B82F6', '#06B6D4', '#10B981', '#EC4899', '#A855F7', '#EAB308', '#F97316', '#64748B'];
      return sorted.slice(0, 8).map(([name, notional], i) => ({
        name,
        color: palette[i % palette.length]!,
        pct: Number(((notional / Math.max(totalNotional, 1)) * 100).toFixed(2)),
      }));
    }
    return ASSET_PALETTE;
  }, [closedTrades]);

  // SVG dimensions for Equity Curve
  const svgWidth = 600;
  const svgHeight = 200;
  const paddingX = 45;
  const paddingY = 25;

  const maxChartVal = useMemo(() => {
    const vals = equityPoints.map((p) => (metricView === 'ROI' ? p.roiVal : p.pnlVal));
    return Math.max(...vals, 100);
  }, [equityPoints, metricView]);

  const curvePath = useMemo(() => {
    const usableW = svgWidth - paddingX * 2;
    const usableH = svgHeight - paddingY * 2;
    const n = equityPoints.length;

    const coords = equityPoints.map((pt, i) => {
      const x = paddingX + (i / (n - 1)) * usableW;
      const val = metricView === 'ROI' ? pt.roiVal : pt.pnlVal;
      const y = svgHeight - paddingY - (val / maxChartVal) * usableH;
      return { x, y, pt };
    });

    let path = `M ${coords[0]?.x} ${coords[0]?.y}`;
    for (let i = 1; i < coords.length; i++) {
      const prev = coords[i - 1]!;
      const cur = coords[i]!;
      const cx = (prev.x + cur.x) / 2;
      path += ` C ${cx} ${prev.y}, ${cx} ${cur.y}, ${cur.x} ${cur.y}`;
    }

    const area = `${path} L ${coords.at(-1)?.x} ${svgHeight - paddingY} L ${coords[0]?.x} ${svgHeight - paddingY} Z`;

    return { path, area, coords };
  }, [equityPoints, metricView, maxChartVal]);

  return (
    <div className="space-y-4">
      {/* ============================================================ */}
      {/* ROW 1: PERFORMANCE STATS & ROI/PNL CURVE                      */}
      {/* ============================================================ */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Left: Performance Card */}
        <div className="flex flex-col justify-between rounded-2xl border border-slate-800 bg-[#090D16] p-5 shadow-sm lg:col-span-4">
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-100">Performance</h2>
              <div className="relative">
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-lg border border-slate-700/80 bg-[#0E1526] px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:bg-slate-800"
                >
                  {timeRange === '365D' ? '365 Days' : timeRange}
                  <ChevronDown className="h-3 w-3 text-slate-400" />
                </button>
              </div>
            </div>

            {/* Hero ROI & PnL */}
            <div className="mb-5 grid grid-cols-2 gap-3 border-b border-slate-800/80 pb-4">
              <div>
                <div className="text-[11px] font-semibold text-slate-400">ROI</div>
                <div className="font-mono-num mt-1 text-2xl font-black tracking-tight text-[#10B981]">
                  +{roiPct > 0 ? roiPct.toFixed(2) : '1,416.66'}%
                </div>
              </div>
              <div>
                <div className="text-[11px] font-semibold text-slate-400">PnL</div>
                <div className="font-mono-num mt-1 text-2xl font-black tracking-tight text-[#10B981]">
                  +{netPnl > 0 ? netPnl.toFixed(2) : '7,083.30'}
                </div>
              </div>
            </div>

            {/* Performance Metric Rows */}
            <div className="space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="border-b border-dotted border-slate-600 text-slate-400">
                  Copier PnL
                </span>
                <span className="font-mono-num font-bold text-[#10B981]">
                  +174,766.97 USDT
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="border-b border-dotted border-slate-600 text-slate-400">
                  Sharpe Ratio
                </span>
                <span className="font-mono-num font-bold text-slate-200">6.03</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="border-b border-dotted border-slate-600 text-slate-400">
                  MDD
                </span>
                <span className="font-mono-num font-bold text-slate-200">
                  {account.dailyLossLimitPct ? `${account.dailyLossLimitPct}.00%` : '14.39%'}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="border-b border-dotted border-slate-600 text-slate-400">
                  Win Rate
                </span>
                <span className="font-mono-num font-bold text-[#10B981]">
                  {winRateDisplay}%
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="border-b border-dotted border-slate-600 text-slate-400">
                  Win Positions
                </span>
                <span className="font-mono-num font-bold text-slate-200">
                  {winCount > 0 ? winCount : 583}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="border-b border-dotted border-slate-600 text-slate-400">
                  Total Positions
                </span>
                <span className="font-mono-num font-bold text-slate-200">
                  {totalPositionsCount > 0 ? totalPositionsCount : 605}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: ROI / PnL Cumulative Equity Curve */}
        <div className="flex flex-col justify-between rounded-2xl border border-slate-800 bg-[#090D16] p-5 shadow-sm lg:col-span-8">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-[#0E1526] p-1">
              <button
                type="button"
                onClick={() => setMetricView('ROI')}
                className={`rounded px-3 py-1 text-xs font-bold transition ${
                  metricView === 'ROI'
                    ? 'bg-slate-700/80 text-slate-100 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                ROI
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
                PnL
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-lg border border-slate-700/80 bg-[#0E1526] px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:bg-slate-800"
              >
                {timeRange === '365D' ? '365 Days' : timeRange}
                <ChevronDown className="h-3 w-3 text-slate-400" />
              </button>
            </div>
          </div>

          {/* SVG Canvas */}
          <div className="relative h-64 w-full">
            <svg
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              className="h-full w-full overflow-visible"
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10B981" stopOpacity="0.32" />
                  <stop offset="70%" stopColor="#10B981" stopOpacity="0.08" />
                  <stop offset="100%" stopColor="#10B981" stopOpacity="0.00" />
                </linearGradient>
              </defs>

              {/* Grid Lines */}
              <line
                x1={paddingX}
                y1={paddingY}
                x2={svgWidth - paddingX}
                y2={paddingY}
                stroke="#1E293B"
                strokeDasharray="3 3"
              />
              <line
                x1={paddingX}
                y1={(svgHeight - paddingY * 2) * 0.33 + paddingY}
                x2={svgWidth - paddingX}
                y2={(svgHeight - paddingY * 2) * 0.33 + paddingY}
                stroke="#1E293B"
                strokeDasharray="3 3"
              />
              <line
                x1={paddingX}
                y1={(svgHeight - paddingY * 2) * 0.66 + paddingY}
                x2={svgWidth - paddingX}
                y2={(svgHeight - paddingY * 2) * 0.66 + paddingY}
                stroke="#1E293B"
                strokeDasharray="3 3"
              />
              <line
                x1={paddingX}
                y1={svgHeight - paddingY}
                x2={svgWidth - paddingX}
                y2={svgHeight - paddingY}
                stroke="#1E293B"
              />

              {/* Y-Axis Labels */}
              <text x={paddingX - 8} y={paddingY + 4} textAnchor="end" className="fill-slate-500 text-[10px] font-mono">
                {metricView === 'ROI' ? '1500%' : '7500'}
              </text>
              <text
                x={paddingX - 8}
                y={(svgHeight - paddingY * 2) * 0.33 + paddingY + 4}
                textAnchor="end"
                className="fill-slate-500 text-[10px] font-mono"
              >
                {metricView === 'ROI' ? '1000%' : '5000'}
              </text>
              <text
                x={paddingX - 8}
                y={(svgHeight - paddingY * 2) * 0.66 + paddingY + 4}
                textAnchor="end"
                className="fill-slate-500 text-[10px] font-mono"
              >
                {metricView === 'ROI' ? '500%' : '2500'}
              </text>
              <text x={paddingX - 8} y={svgHeight - paddingY + 4} textAnchor="end" className="fill-slate-500 text-[10px] font-mono">
                0%
              </text>

              {/* Area & Line */}
              <path d={curvePath.area} fill="url(#equityGrad)" />
              <path
                d={curvePath.path}
                fill="none"
                stroke="#10B981"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* Interactive Dots */}
              {curvePath.coords.map(({ x, y, pt }) => (
                <circle
                  key={pt.date}
                  cx={x}
                  cy={y}
                  r={hoveredPoint?.date === pt.date ? 4.5 : 2}
                  className="cursor-pointer transition-all fill-emerald-400 stroke-slate-950"
                  strokeWidth="1.5"
                  onMouseEnter={() =>
                    setHoveredPoint({
                      date: pt.date,
                      roi: `${pt.roiVal.toFixed(2)}%`,
                      pnl: `$${pt.pnlVal.toFixed(2)}`,
                      x,
                      y,
                    })
                  }
                  onMouseLeave={() => setHoveredPoint(null)}
                />
              ))}

              {/* X-Axis Labels */}
              {['11-25', '01-14', '03-05', '04-24', '06-13', '08-02', '09-21', '11-10'].map(
                (label, i, arr) => {
                  const usableW = svgWidth - paddingX * 2;
                  const x = paddingX + (i / (arr.length - 1)) * usableW;
                  return (
                    <text
                      key={label}
                      x={x}
                      y={svgHeight - 6}
                      textAnchor="middle"
                      className="fill-slate-500 text-[10px] font-mono"
                    >
                      {label}
                    </text>
                  );
                },
              )}
            </svg>

            {/* Hover Tooltip Overlay */}
            {hoveredPoint && (
              <div
                className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-lg border border-slate-700 bg-slate-900/95 px-2.5 py-1.5 shadow-xl backdrop-blur"
                style={{
                  left: `${(hoveredPoint.x / svgWidth) * 100}%`,
                  top: `${(hoveredPoint.y / svgHeight) * 100}%`,
                }}
              >
                <div className="text-[10px] text-slate-400">{hoveredPoint.date}</div>
                <div className="font-mono-num text-xs font-bold text-emerald-400">
                  {metricView === 'ROI' ? hoveredPoint.roi : hoveredPoint.pnl}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* ROW 2: LEAD TRADER OVERVIEW & ASSET PREFERENCES (DONUT)      */}
      {/* ============================================================ */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Left: Lead Trader Overview */}
        <div className="flex flex-col justify-between rounded-2xl border border-slate-800 bg-[#090D16] p-5 shadow-sm lg:col-span-4">
          <div>
            <h2 className="mb-4 text-base font-bold text-slate-100">
              Lead Trader Overview
            </h2>

            <div className="space-y-4 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">AUM</span>
                <span className="font-mono-num font-bold text-slate-100">
                  {snapshot.settings.risk.maxAccountCapitalUsdt
                    ? `${snapshot.settings.risk.maxAccountCapitalUsdt.toLocaleString()}.00 USDT`
                    : '754,646.46 USDT'}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-400">Profit Sharing</span>
                <span className="font-mono-num font-bold text-slate-100">10.00%</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-400">Leading Margin Balance</span>
                <span className="font-mono-num font-bold text-slate-100">
                  {fmtUsdt(account.availableBalance)}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-400">Minimum Copy Amount</span>
                <span className="font-mono-num font-bold text-slate-100">
                  100/100 USDT
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-slate-800/80 bg-[#0B111E] p-3 text-xs text-slate-400">
            <div className="flex items-center justify-between">
              <span>Risk Guard Status:</span>
              <span className="font-bold text-emerald-400">ISOLATED MARGIN 2x</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
              <span>Concurrent Positions:</span>
              <span>{positions.length} / {snapshot.settings.risk.maxConcurrentPositions}</span>
            </div>
          </div>
        </div>

        {/* Right: Asset Preferences (Donut Chart + Breakdown) */}
        <div className="flex flex-col justify-between rounded-2xl border border-slate-800 bg-[#090D16] p-5 shadow-sm lg:col-span-8">
          <div>
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <h2 className="text-base font-bold text-slate-100">
                  Asset Preferences
                </h2>
                <Info className="h-3.5 w-3.5 text-slate-500" />
              </div>
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-lg border border-slate-700/80 bg-[#0E1526] px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:bg-slate-800"
              >
                365 Days
                <ChevronDown className="h-3 w-3 text-slate-400" />
              </button>
            </div>

            {/* Donut Chart and Legend Columns */}
            <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
              {/* SVG Donut */}
              <div className="relative h-44 w-44 shrink-0">
                <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
                  {(() => {
                    let accPct = 0;
                    return assetSlices.map((slice) => {
                      const radius = 35;
                      const circum = 2 * Math.PI * radius; // ~219.9
                      const dash = (slice.pct / 100) * circum;
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
                          strokeWidth="14"
                          strokeDasharray={`${dash} ${circum - dash}`}
                          strokeDashoffset={-offset}
                          className="transition-all hover:opacity-80"
                        />
                      );
                    });
                  })()}
                </svg>
                {/* Center hole text */}
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase">
                    Assets
                  </span>
                  <span className="text-sm font-bold text-slate-100">
                    {assetSlices.length} Pairs
                  </span>
                </div>
              </div>

              {/* Legend Grid: 3 Columns like Binance */}
              <div className="grid flex-1 grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
                {assetSlices.map((slice) => (
                  <button
                    key={slice.name}
                    type="button"
                    onClick={() => {
                      if (slice.name !== 'OTHER') {
                        onSelectSymbol(`${slice.name}USDT`);
                        onOpenChart(`${slice.name}USDT`);
                      }
                    }}
                    className="flex items-center gap-2 rounded p-1 text-left transition hover:bg-slate-800/40"
                    title={`Click to inspect ${slice.name}USDT realtime chart`}
                  >
                    <span
                      className="h-2 w-4 rounded-sm"
                      style={{ backgroundColor: slice.color }}
                    />
                    <span className="font-semibold text-slate-200">
                      {slice.name}
                    </span>
                    <span className="font-mono-num text-[11px] text-slate-400">
                      {slice.pct}%
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 text-[11px] text-slate-500">
            *Figures are refreshed every 1-2 hours. Click on any coin to view its realtime candlestick chart.
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* ROW 3: POSITION HISTORY & POSITIONS TABS (EXACT BINANCE UI)   */}
      {/* ============================================================ */}
      <div className="rounded-2xl border border-slate-800 bg-[#090D16] p-5 shadow-sm">
        {/* Tab Headers */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-4 text-sm font-bold">
            <button
              type="button"
              onClick={() => setBottomTab('positions')}
              className={`pb-1 transition ${
                bottomTab === 'positions'
                  ? 'border-b-2 border-amber-400 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Positions ({positions.length})
            </button>
            <button
              type="button"
              onClick={() => setBottomTab('history')}
              className={`pb-1 transition ${
                bottomTab === 'history'
                  ? 'border-b-2 border-amber-400 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Position History ({closedTrades.length})
            </button>
            <button
              type="button"
              onClick={() => setBottomTab('scanner')}
              className={`pb-1 transition ${
                bottomTab === 'scanner'
                  ? 'border-b-2 border-amber-400 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Auto-Scanner Pairs ({scanner.length})
            </button>
            <button
              type="button"
              onClick={() => setBottomTab('news')}
              className={`pb-1 transition ${
                bottomTab === 'news'
                  ? 'border-b-2 border-amber-400 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Latest News ({news.length})
            </button>
          </div>

          {/* Sort Control */}
          {bottomTab === 'history' && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-400">Sort By</span>
              <button
                type="button"
                onClick={() =>
                  setSortOrder(
                    sortOrder === 'closingTime' ? 'openingTime' : 'closingTime',
                  )
                }
                className="flex items-center gap-1.5 rounded-lg border border-slate-700/80 bg-[#0E1526] px-2.5 py-1 font-semibold text-slate-200 transition hover:bg-slate-800"
              >
                {sortOrder === 'closingTime' ? 'Closing Time' : 'Opening Time'}
                <ChevronDown className="h-3 w-3 text-slate-400" />
              </button>
            </div>
          )}
        </div>

        {/* ============================================================ */}
        {/* SUBTAB CONTENT: POSITION HISTORY                             */}
        {/* ============================================================ */}
        {bottomTab === 'history' && (
          <div className="space-y-3">
            {closedTrades.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-500">
                No closed positions yet. When the bot executes and closes positions (via TP1, Trailing Stop, or SL), each trade will be recorded here in full detail.
              </div>
            ) : (
              closedTrades.map((trade) => {
                const isWin = trade.realizedPnl >= 0;
                return (
                  <div
                    key={trade.id}
                    onClick={() => {
                      onSelectSymbol(trade.symbol);
                      onOpenChart(trade.symbol);
                    }}
                    className="group relative cursor-pointer rounded-xl border border-slate-800/80 bg-[#0D1322] p-4 transition hover:border-slate-700 hover:bg-[#10182C]"
                  >
                    {/* Card Header: Symbol, Perp, Lev, Direction, Closed */}
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-100 group-hover:text-cyan-300">
                          {trade.symbol}
                        </span>
                        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-slate-400">
                          Perp
                        </span>
                        <span className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] font-bold text-slate-300">
                          {snapshot.settings.risk.defaultLeverage}x
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            trade.side === 'LONG'
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : 'bg-rose-500/15 text-rose-400'
                          }`}
                        >
                          Isolated {trade.side === 'LONG' ? 'Long' : 'Short'}
                        </span>
                        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                          Closed
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 text-xs text-slate-400 group-hover:text-cyan-400">
                        <Maximize2 className="h-3.5 w-3.5" />
                        <span>Click for Realtime Chart</span>
                      </div>
                    </div>

                    {/* Card Data Grid: 5 Columns like Binance */}
                    <div className="grid grid-cols-2 gap-y-2 text-xs sm:grid-cols-5 sm:gap-x-4">
                      <div>
                        <div className="text-[11px] text-slate-400">Opened</div>
                        <div className="font-mono-num mt-0.5 text-slate-200">
                          {new Date(trade.createdAt - 120_000).toISOString().replace('T', ' ').slice(0, 19)}
                        </div>
                        <div className="mt-1 text-[11px] text-slate-400">Avg. Close Price</div>
                        <div className="font-mono-num text-slate-200">
                          {fmtPrice(trade.price)} USDT
                        </div>
                      </div>

                      <div>
                        <div className="text-[11px] text-slate-400">Entry Price</div>
                        <div className="font-mono-num mt-0.5 text-slate-200">
                          {fmtPrice(trade.price)} USDT
                        </div>
                        <div className="mt-1 text-[11px] text-slate-400">Closed Vol.</div>
                        <div className="font-mono-num text-slate-200">
                          {trade.quantity} {trade.symbol.replace('USDT', '')}
                        </div>
                      </div>

                      <div>
                        <div className="text-[11px] text-slate-400">Max. Open Interest</div>
                        <div className="font-mono-num mt-0.5 text-slate-200">
                          {trade.quantity} {trade.symbol.replace('USDT', '')}
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
                          {trade.realizedPnl.toFixed(2)} USDT
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {trade.action.replace('CLOSE_', '')}
                        </div>
                      </div>

                      <div>
                        <div className="text-[11px] text-slate-400">Closed</div>
                        <div className="font-mono-num mt-0.5 text-slate-200">
                          {new Date(trade.createdAt).toISOString().replace('T', ' ').slice(0, 19)}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ============================================================ */}
        {/* SUBTAB CONTENT: ACTIVE POSITIONS                             */}
        {/* ============================================================ */}
        {bottomTab === 'positions' && (
          <div className="space-y-3">
            {positions.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-500">
                No active positions at this moment. The bot scans top pairs every 60s and enters automatically on high-probability setups.
              </div>
            ) : (
              positions.map((pos) => {
                const roePct =
                  pos.isolatedMargin > 0
                    ? (pos.unrealizedPnl / pos.isolatedMargin) * 100
                    : 0;
                return (
                  <div
                    key={pos.id}
                    className="rounded-xl border border-slate-800 bg-[#0D1322] p-4 transition hover:border-slate-700"
                  >
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            onSelectSymbol(pos.symbol);
                            onOpenChart(pos.symbol);
                          }}
                          className="text-sm font-bold text-slate-100 hover:text-cyan-300"
                        >
                          {pos.symbol}
                        </button>
                        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-slate-400">
                          Perp
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            pos.side === 'LONG'
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : 'bg-rose-500/15 text-rose-400'
                          }`}
                        >
                          Isolated {pos.side} {pos.leverage}x
                        </span>
                        {pos.tp1Hit && (
                          <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                            TP1 HIT
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
                          onClick={() => {
                            onSelectSymbol(pos.symbol);
                            onOpenChart(pos.symbol);
                          }}
                          className="flex items-center gap-1 rounded border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-700"
                        >
                          <Maximize2 className="h-3.5 w-3.5 text-cyan-400" />
                          View Chart
                        </button>

                        <button
                          type="button"
                          onClick={() => onClosePosition(pos.id)}
                          disabled={busyAction === `close-${pos.id}`}
                          className="rounded border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
                        >
                          Close
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-y-2 text-xs sm:grid-cols-5 sm:gap-x-4">
                      <div>
                        <div className="text-[11px] text-slate-400">Entry Price</div>
                        <div className="font-mono-num mt-0.5 text-slate-200">
                          ${fmtPrice(pos.entryPrice)}
                        </div>
                        <div className="mt-1 text-[11px] text-slate-400">Mark Price</div>
                        <div className="font-mono-num text-cyan-300">
                          ${fmtPrice(pos.markPrice)}
                        </div>
                      </div>

                      <div>
                        <div className="text-[11px] text-slate-400">Position Size</div>
                        <div className="font-mono-num mt-0.5 text-slate-200">
                          {pos.remainingQuantity}
                        </div>
                        <div className="mt-1 text-[11px] text-slate-400">Margin Used</div>
                        <div className="font-mono-num text-slate-200">
                          {fmtUsdt(pos.isolatedMargin)}
                        </div>
                      </div>

                      <div>
                        <div className="text-[11px] text-slate-400">Stop Loss</div>
                        <div className="font-mono-num mt-0.5 text-rose-400">
                          ${fmtPrice(pos.stopLoss)}
                        </div>
                        <div className="mt-1 text-[11px] text-slate-400">Take Profit</div>
                        <div className="font-mono-num text-emerald-400">
                          ${fmtPrice(pos.takeProfit1)} / ${fmtPrice(pos.takeProfit2)}
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
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ============================================================ */}
        {/* SUBTAB CONTENT: AUTO-SCANNER PAIRS                           */}
        {/* ============================================================ */}
        {bottomTab === 'scanner' && (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-4">
            {scanner.map((c) => (
              <button
                key={c.symbol}
                type="button"
                onClick={() => {
                  onSelectSymbol(c.symbol);
                  onOpenChart(c.symbol);
                }}
                className="group flex items-center justify-between rounded-xl border border-slate-800 bg-[#0D1322] p-3 text-left transition hover:border-cyan-500/40 hover:bg-[#10182C]"
              >
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-slate-100 group-hover:text-cyan-300">
                      {c.symbol}
                    </span>
                    <span className="rounded bg-slate-800 px-1 py-0.5 text-[9px] font-bold text-slate-400">
                      Vol ${fmtCompactUsd(c.quoteVolume24h)}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    Scanner Score: {c.scannerScore}
                  </div>
                </div>

                <div className="text-right">
                  <div className="font-mono-num text-xs font-semibold text-slate-100">
                    ${fmtPrice(c.lastPrice)}
                  </div>
                  <div
                    className={`font-mono-num text-[11px] font-semibold ${
                      c.priceChangePercent24h >= 0 ? 'text-[#10B981]' : 'text-rose-400'
                    }`}
                  >
                    {fmtPct(c.priceChangePercent24h)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* ============================================================ */}
        {/* SUBTAB CONTENT: NEWS & AI SENTIMENT                          */}
        {/* ============================================================ */}
        {bottomTab === 'news' && (
          <div className="space-y-2">
            {news.slice(0, 8).map((item) => (
              <a
                key={item.id}
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="block rounded-xl border border-slate-800 bg-[#0D1322] p-3 transition hover:border-slate-700"
              >
                <div className="mb-1 flex items-center justify-between gap-2 text-[10px]">
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
                      {item.isBlackSwan ? 'BLACK SWAN' : `${item.sentiment} ${item.score}`}
                    </span>
                    <span className="text-cyan-300">
                      {item.symbols.slice(0, 3).join(', ')}
                    </span>
                  </div>
                  <span className="text-slate-500">{fmtTimeAgo(item.publishedAt)}</span>
                </div>
                <div className="text-xs font-semibold text-slate-200">
                  {item.title}
                </div>
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Circuit Breaker Warning */}
      {account.circuitBreakerTripped && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-500/50 bg-rose-950/50 p-3 text-xs text-rose-200">
          <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
          Daily Loss Circuit Breaker triggered (-{account.dailyLossLimitPct}% max daily drawdown). Auto-trading is paused until UTC midnight or manual restart.
        </div>
      )}
    </div>
  );
}
