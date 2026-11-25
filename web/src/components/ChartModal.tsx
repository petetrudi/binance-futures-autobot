import { useEffect } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Maximize2,
  Newspaper,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import type {
  CandleChartResponse,
  Position,
  Timeframe,
  TradeSignal,
} from '@bot/shared';
import { fmtPct, fmtPrice, fmtUsdt } from '../lib/format.js';
import { CandlestickChart } from './CandlestickChart.js';

interface ChartModalProps {
  isOpen: boolean;
  onClose: () => void;
  symbol: string;
  interval: Timeframe;
  chartData: CandleChartResponse | null;
  loading: boolean;
  activePosition: Position | null;
  selectedSignal: TradeSignal | null;
  onIntervalChange: (interval: Timeframe) => void;
  onClosePosition: (id: string) => void;
}

export function ChartModal({
  isOpen,
  onClose,
  symbol,
  interval,
  chartData,
  loading,
  activePosition,
  selectedSignal,
  onIntervalChange,
  onClosePosition,
}: ChartModalProps) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const tech = chartData?.technical ?? null;
  const newsCtx = chartData?.newsContext ?? null;
  const lastPrice = chartData?.candles.at(-1)?.close ?? 0;
  const firstPrice = chartData?.candles[0]?.open ?? lastPrice;
  const priceChangePct =
    firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 md:p-6">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-md transition-opacity"
        onClick={onClose}
      />

      {/* Modal Dialog */}
      <div className="relative z-10 flex max-h-[95vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-700/80 bg-[#0B111E] shadow-2xl ring-1 ring-white/10">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-[#0E1526] px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-500/30 bg-cyan-500/10 text-cyan-400">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-extrabold tracking-wide text-slate-100">
                  {symbol}
                </h2>
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-slate-400">
                  PERPETUAL
                </span>
                {activePosition && (
                  <span
                    className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                      activePosition.side === 'LONG'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-rose-500/20 text-rose-300'
                    }`}
                  >
                    ACTIVE {activePosition.side} {activePosition.leverage}x
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-xs">
                <span className="font-mono-num font-bold text-slate-100">
                  ${fmtPrice(lastPrice)}
                </span>
                <span
                  className={`font-mono-num flex items-center text-[11px] font-semibold ${
                    priceChangePct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {priceChangePct >= 0 ? (
                    <TrendingUp className="mr-0.5 h-3 w-3" />
                  ) : (
                    <TrendingDown className="mr-0.5 h-3 w-3" />
                  )}
                  {fmtPct(priceChangePct)}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Timeframe Selector */}
            <div className="flex items-center gap-1 rounded-lg border border-slate-700/80 bg-[#070B13] p-1">
              {(['5m', '15m', '1h', '4h'] as Timeframe[]).map((tf) => (
                <button
                  key={tf}
                  type="button"
                  onClick={() => onIntervalChange(tf)}
                  className={`rounded px-2.5 py-1 text-xs font-bold transition ${
                    interval === tf
                      ? 'bg-cyan-500 text-slate-950 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-700/70 p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
              title="Close (Esc)"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Modal Body: Scrollable */}
        <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
          {/* Realtime Candlestick Chart Container */}
          <div className="overflow-hidden rounded-xl border border-slate-800 bg-[#090D16]">
            <CandlestickChart
              symbol={symbol}
              interval={interval}
              chartData={chartData}
              loading={loading}
              activePosition={activePosition}
              onIntervalChange={onIntervalChange}
            />
          </div>

          {/* Indicators & AI Decision Fusion Grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-slate-800/80 bg-[#0F172A]/70 p-3">
              <div className="text-[11px] font-semibold text-slate-400">
                Technical Score
              </div>
              <div
                className={`font-mono-num text-xl font-bold ${
                  (tech?.technicalScore ?? 0) >= 0
                    ? 'text-emerald-400'
                    : 'text-rose-400'
                }`}
              >
                {(tech?.technicalScore ?? 0) >= 0 ? '+' : ''}
                {tech?.technicalScore ?? 0}
              </div>
              <div className="text-[11px] text-slate-500">
                4H {tech?.trend4h ?? '-'} · 1H {tech?.trend1h ?? '-'}
              </div>
            </div>

            <div className="rounded-xl border border-slate-800/80 bg-[#0F172A]/70 p-3">
              <div className="text-[11px] font-semibold text-slate-400">
                AI News Sentiment
              </div>
              <div
                className={`font-mono-num text-xl font-bold ${
                  (newsCtx?.newsScore ?? 0) >= 0 ? 'text-cyan-400' : 'text-rose-400'
                }`}
              >
                {(newsCtx?.newsScore ?? 0) >= 0 ? '+' : ''}
                {newsCtx?.newsScore ?? 0}
              </div>
              <div className="text-[11px] text-slate-500">
                {newsCtx?.articleCount ?? 0} Articles Scanned
              </div>
            </div>

            <div className="rounded-xl border border-slate-800/80 bg-[#0F172A]/70 p-3">
              <div className="text-[11px] font-semibold text-slate-400">
                Regime & Momentum
              </div>
              <div className="font-mono-num truncate text-sm font-bold text-slate-100">
                {tech?.regime.replaceAll('_', ' ') ?? 'ANALYZING'}
              </div>
              <div className="font-mono-num text-[11px] text-slate-500">
                RSI {tech?.indicators15m.rsi14.toFixed(1) ?? '-'} · ADX{' '}
                {tech?.indicators15m.adx14.toFixed(1) ?? '-'}
              </div>
            </div>

            <div className="rounded-xl border border-slate-800/80 bg-[#0F172A]/70 p-3">
              <div className="text-[11px] font-semibold text-slate-400">
                Swing S/R Pivots
              </div>
              <div className="font-mono-num text-xs font-semibold text-emerald-400">
                Res: ${fmtPrice(tech?.indicators15m.nearestResistance ?? 0)}
              </div>
              <div className="font-mono-num text-xs font-semibold text-rose-400">
                Sup: ${fmtPrice(tech?.indicators15m.nearestSupport ?? 0)}
              </div>
            </div>
          </div>

          {/* Active Position / Signal Bar if available */}
          {activePosition && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan-500/30 bg-cyan-950/20 p-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-100">
                    Open Position: {activePosition.side} {activePosition.quantity} {symbol}
                  </span>
                  <span className="font-mono-num font-bold text-cyan-300">
                    Entry: ${fmtPrice(activePosition.entryPrice)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                  <span className="text-rose-400">
                    SL: ${fmtPrice(activePosition.stopLoss)}
                  </span>
                  <span className="text-emerald-400">
                    TP1: ${fmtPrice(activePosition.takeProfit1)} / TP2: ${fmtPrice(activePosition.takeProfit2)}
                  </span>
                  <span className="text-amber-400">
                    Liq: ${fmtPrice(activePosition.liquidationPrice)}
                  </span>
                  <span
                    className={`font-mono-num font-bold ${
                      activePosition.unrealizedPnl >= 0
                        ? 'text-emerald-400'
                        : 'text-rose-400'
                    }`}
                  >
                    Unrealized PnL: {fmtUsdt(activePosition.unrealizedPnl, true)}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => onClosePosition(activePosition.id)}
                className="rounded-lg border border-rose-500/50 bg-rose-600/20 px-4 py-2 text-xs font-bold text-rose-300 transition hover:bg-rose-600/30"
              >
                Close Position Immediately
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
