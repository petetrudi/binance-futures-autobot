import {
  Activity,
  ArrowLeft,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import type {
  CandleChartResponse,
  DashboardSnapshot,
  Timeframe,
} from '@bot/shared';
import { fmtPct, fmtPrice, fmtUsdt } from '../lib/format.js';
import { CandlestickChart } from './CandlestickChart.js';

interface RealtimeChartTabProps {
  symbol: string;
  snapshot: DashboardSnapshot;
  interval: Timeframe;
  chartData: CandleChartResponse | null;
  loading: boolean;
  busyAction: string | null;
  onSelectSymbol: (symbol: string) => void;
  onIntervalChange: (interval: Timeframe) => void;
  onClosePosition: (id: string) => void;
  onCloseTab: () => void;
}

const TIMEFRAMES: Timeframe[] = ['5m', '15m', '1h', '4h'];

export function RealtimeChartTab({
  symbol,
  snapshot,
  interval,
  chartData,
  loading,
  busyAction,
  onSelectSymbol,
  onIntervalChange,
  onClosePosition,
  onCloseTab,
}: RealtimeChartTabProps) {
  const { positions, scanner, signals } = snapshot;
  const activePosition = positions.find((p) => p.symbol === symbol) ?? null;
  const signal = signals.find((s) => s.symbol === symbol) ?? null;
  const scannerTicker = scanner.find((c) => c.symbol === symbol) ?? null;

  const matchedData =
    chartData && chartData.symbol === symbol && chartData.interval === interval
      ? chartData
      : null;
  const tech = matchedData?.technical ?? null;
  const newsCtx = matchedData?.newsContext ?? null;

  const livePrice =
    activePosition?.markPrice ??
    scannerTicker?.lastPrice ??
    matchedData?.candles.at(-1)?.close ??
    0;

  const change24h = scannerTicker?.priceChangePercent24h ?? null;

  // Quick switch coins list (open positions first, then top scanner coins)
  const quickSymbols = Array.from(
    new Set([
      symbol,
      ...positions.map((p) => p.symbol),
      ...scanner.slice(0, 8).map((c) => c.symbol),
    ]),
  );

  return (
    <div className="space-y-4">
      {/* Main Chart Card */}
      <div className="rounded-xl border border-slate-800/90 bg-[#0E1420] p-4 shadow-sm">
        {/* Unified Single Header */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onCloseTab}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700/80 bg-[#080C14] px-2.5 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-slate-800 hover:text-slate-100"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Kembali
            </button>

            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-500/30 bg-cyan-500/10 text-cyan-400">
                <Activity className="h-4 w-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold tracking-wide text-slate-100">
                    {symbol}
                  </h2>
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-slate-400">
                    PERP
                  </span>
                  {activePosition && (
                    <span
                      className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                        activePosition.side === 'LONG'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-rose-500/20 text-rose-300'
                      }`}
                    >
                      OPEN {activePosition.side} {activePosition.leverage}x
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-mono-num font-bold text-slate-100">
                    {livePrice > 0 ? `$${fmtPrice(livePrice)}` : 'Loading price...'}
                  </span>
                  {change24h !== null && (
                    <span
                      className={`font-mono-num inline-flex items-center text-[11px] font-semibold ${
                        change24h >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {change24h >= 0 ? (
                        <TrendingUp className="mr-0.5 h-3 w-3" />
                      ) : (
                        <TrendingDown className="mr-0.5 h-3 w-3" />
                      )}
                      {fmtPct(change24h)} (24h)
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="hidden items-center gap-2.5 pl-2 text-[11px] text-slate-400 lg:flex">
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-cyan-400" /> EMA9
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-amber-400" /> EMA21
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-purple-400" /> EMA50
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Timeframe Selector */}
            <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-[#080C14] p-1">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf}
                  type="button"
                  onClick={() => onIntervalChange(tf)}
                  className={`rounded px-2.5 py-1 text-xs font-bold transition ${
                    interval === tf
                      ? 'bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-500/40'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={onCloseTab}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-700/80 bg-[#080C14] px-2.5 py-1.5 text-xs font-semibold text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
              title="Tutup Tab Grafik"
            >
              <X className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Tutup Tab</span>
            </button>
          </div>
        </div>

        {/* Quick Pair Switcher Strip */}
        <div className="mb-3 flex items-center gap-1.5 overflow-x-auto pb-1">
          <span className="shrink-0 text-[11px] font-semibold text-slate-500">
            Quick Switch:
          </span>
          {quickSymbols.map((sym) => {
            const isOpen = positions.some((p) => p.symbol === sym);
            const active = sym === symbol;
            return (
              <button
                key={sym}
                type="button"
                onClick={() => onSelectSymbol(sym)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-semibold transition ${
                  active
                    ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-300'
                    : 'border-slate-800 bg-[#080C14] text-slate-400 hover:border-slate-700 hover:text-slate-200'
                }`}
              >
                {isOpen && (
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                )}
                {sym}
              </button>
            );
          })}
        </div>

        {/* Realtime Candlestick Chart Canvas */}
        <CandlestickChart
          symbol={symbol}
          interval={interval}
          chartData={chartData}
          loading={loading}
          activePosition={activePosition}
          onIntervalChange={onIntervalChange}
          hideHeader
          height={440}
        />
      </div>

      {/* Active Position Box (if open) */}
      {activePosition && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan-500/30 bg-[#0E1826] p-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-bold text-slate-100">
                Posisi Aktif: {activePosition.side} {activePosition.remainingQuantity}{' '}
                {symbol} ({activePosition.leverage}x Isolated)
              </span>
              <span className="font-mono-num text-cyan-300">
                Entry ${fmtPrice(activePosition.entryPrice)}
              </span>
              <span className="font-mono-num text-slate-300">
                Margin {fmtUsdt(activePosition.isolatedMargin)}
              </span>
            </div>
            <div className="font-mono-num flex flex-wrap items-center gap-3 text-xs text-slate-400">
              <span className="text-rose-400">
                SL ${fmtPrice(activePosition.stopLoss)}
              </span>
              <span className="text-emerald-400">
                TP1 ${fmtPrice(activePosition.takeProfit1)} · TP2 $
                {fmtPrice(activePosition.takeProfit2)}
              </span>
              <span className="text-amber-300">
                Liq ${fmtPrice(activePosition.liquidationPrice)}
              </span>
              <span
                className={`font-bold ${
                  activePosition.unrealizedPnl >= 0
                    ? 'text-emerald-400'
                    : 'text-rose-400'
                }`}
              >
                Unrealized {fmtUsdt(activePosition.unrealizedPnl, true)}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onClosePosition(activePosition.id)}
            disabled={busyAction === `close-${activePosition.id}`}
            className="rounded-lg border border-rose-500/50 bg-rose-600/20 px-4 py-2 text-xs font-bold text-rose-300 transition hover:bg-rose-600/30 disabled:opacity-50"
          >
            Close Position
          </button>
        </div>
      )}

      {/* Technical & AI Decision Fusion Details */}
      <div className="rounded-xl border border-slate-800/90 bg-[#0E1420] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-cyan-400" />
            <h3 className="text-sm font-bold text-slate-100">
              {symbol} Live Decision & Multi-Timeframe Analysis
            </h3>
          </div>
          {signal && (
            <span
              className={`rounded px-2.5 py-0.5 text-xs font-bold ${
                signal.action === 'LONG'
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : signal.action === 'SHORT'
                    ? 'bg-rose-500/20 text-rose-300'
                    : 'bg-slate-700/60 text-slate-300'
              }`}
            >
              {signal.action} · {signal.confidence}% Confidence
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-slate-800/80 bg-[#080C14] p-3">
            <div className="text-[11px] text-slate-400">Technical Score</div>
            <div
              className={`font-mono-num mt-0.5 text-xl font-bold ${
                (tech?.technicalScore ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {(tech?.technicalScore ?? 0) >= 0 ? '+' : ''}
              {tech?.technicalScore ?? 0}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">
              4H {tech?.trend4h ?? '—'} · 1H {tech?.trend1h ?? '—'} · 15m {tech?.trend15m ?? '—'}
            </div>
          </div>

          <div className="rounded-lg border border-slate-800/80 bg-[#080C14] p-3">
            <div className="text-[11px] text-slate-400">AI News Sentiment</div>
            <div
              className={`font-mono-num mt-0.5 text-xl font-bold ${
                (newsCtx?.newsScore ?? 0) >= 0 ? 'text-cyan-300' : 'text-rose-400'
              }`}
            >
              {(newsCtx?.newsScore ?? 0) >= 0 ? '+' : ''}
              {newsCtx?.newsScore ?? 0}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">
              {newsCtx?.articleCount ?? 0} relevant articles (12h)
            </div>
          </div>

          <div className="rounded-lg border border-slate-800/80 bg-[#080C14] p-3">
            <div className="text-[11px] text-slate-400">Market Regime & ADX</div>
            <div className="mt-0.5 truncate text-sm font-bold text-slate-100">
              {tech ? tech.regime.replaceAll('_', ' ') : 'Analyzing...'}
            </div>
            <div className="font-mono-num mt-0.5 text-[11px] text-slate-500">
              ADX {tech ? tech.indicators15m.adx14.toFixed(1) : '—'} · RSI{' '}
              {tech ? tech.indicators15m.rsi14.toFixed(1) : '—'}
            </div>
          </div>

          <div className="rounded-lg border border-slate-800/80 bg-[#080C14] p-3">
            <div className="text-[11px] text-slate-400">Swing S/R & ATR</div>
            <div className="font-mono-num mt-0.5 text-xs font-semibold text-emerald-400">
              Res:{' '}
              {tech?.indicators15m.nearestResistance
                ? `$${fmtPrice(tech.indicators15m.nearestResistance)}`
                : '—'}
            </div>
            <div className="font-mono-num text-xs font-semibold text-rose-400">
              Sup:{' '}
              {tech?.indicators15m.nearestSupport
                ? `$${fmtPrice(tech.indicators15m.nearestSupport)}`
                : '—'}
            </div>
            <div className="font-mono-num mt-0.5 text-[10px] text-slate-500">
              ATR% {tech ? `${tech.indicators15m.atrPct.toFixed(2)}%` : '—'}
            </div>
          </div>
        </div>

        {/* Signal Reasons & Trade Plan */}
        {signal && (signal.reasons.length > 0 || signal.vetoReasons.length > 0) && (
          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-800/70 pt-3">
            {signal.reasons.map((r, i) => (
              <span
                key={`r-${i}`}
                className="rounded border border-slate-700/80 bg-[#080C14] px-2 py-0.5 text-[11px] text-slate-300"
              >
                {r}
              </span>
            ))}
            {signal.vetoReasons.map((v, i) => (
              <span
                key={`v-${i}`}
                className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-300"
              >
                Filter: {v}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
