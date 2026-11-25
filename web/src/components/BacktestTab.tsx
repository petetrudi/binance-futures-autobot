import { useEffect, useRef, useState } from 'react';
import { AreaSeries, ColorType, createChart, type UTCTimestamp } from 'lightweight-charts';
import { FlaskConical, Play } from 'lucide-react';
import type { BacktestResult } from '@bot/shared';
import { api } from '../lib/api.js';
import { fmtClock, fmtPct, fmtPrice, fmtUsdt } from '../lib/format.js';

interface BacktestTabProps {
  defaultSymbol: string;
}

export function BacktestTab({ defaultSymbol }: BacktestTabProps) {
  const [symbol, setSymbol] = useState(defaultSymbol || 'BTCUSDT');
  const [interval, setInterval] = useState<'15m' | '1h'>('15m');
  const [bars, setBars] = useState(400);
  const [initialCapital, setInitialCapital] = useState(500);
  const [leverage, setLeverage] = useState(2);
  const [riskPerTradePct, setRiskPerTradePct] = useState(0.75);
  const [minConfidence, setMinConfidence] = useState(72);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);

  const chartRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = chartRef.current;
    if (!el || !result || result.equityCurve.length === 0) return;

    const chart = createChart(el, {
      width: el.clientWidth,
      height: 260,
      layout: {
        background: { type: ColorType.Solid, color: '#0B111E' },
        textColor: '#94A3B8',
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#151E30' },
        horzLines: { color: '#151E30' },
      },
      rightPriceScale: { borderColor: '#1E293B' },
      timeScale: { borderColor: '#1E293B', timeVisible: true },
    });

    const isPositive = result.netPnlUsdt >= 0;
    const area = chart.addSeries(AreaSeries, {
      lineColor: isPositive ? '#10B981' : '#F43F5E',
      topColor: isPositive ? 'rgba(16, 185, 129, 0.35)' : 'rgba(244, 63, 94, 0.35)',
      bottomColor: 'rgba(11, 17, 30, 0.0)',
      lineWidth: 2,
    });

    const seen = new Set<number>();
    const deduped = result.equityCurve
      .filter((p) => {
        if (seen.has(p.time)) return false;
        seen.add(p.time);
        return true;
      })
      .sort((a, b) => a.time - b.time);

    area.setData(
      deduped.map((p) => ({ time: p.time as UTCTimestamp, value: p.equity })),
    );
    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0) chart.applyOptions({ width: el.clientWidth });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [result]);

  async function handleRun(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await api.runBacktest({
        symbol: symbol.trim().toUpperCase(),
        interval,
        bars,
        initialCapital,
        leverage,
        riskPerTradePct,
        minConfidence,
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backtest execution failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={handleRun}
        className="rounded-xl border border-slate-800/90 bg-[#0E1420] p-4"
      >
        <div className="mb-3 flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-cyan-400" />
          <h2 className="text-sm font-bold text-slate-100">
            Intraday Futures Backtest Simulator
          </h2>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          <label className="text-[11px] text-slate-400">
            Symbol
            <input
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="font-mono-num mt-1 w-full rounded-lg border border-slate-700 bg-[#090D16] px-2.5 py-1.5 text-xs text-slate-100 uppercase"
            />
          </label>
          <label className="text-[11px] text-slate-400">
            Timeframe
            <select
              value={interval}
              onChange={(e) => setInterval(e.target.value as '15m' | '1h')}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-[#090D16] px-2.5 py-1.5 text-xs text-slate-100"
            >
              <option value="15m">15m Intraday</option>
              <option value="1h">1h Intraday</option>
            </select>
          </label>
          <label className="text-[11px] text-slate-400">
            History Bars
            <input
              type="number"
              min={150}
              max={1000}
              value={bars}
              onChange={(e) => setBars(Number(e.target.value))}
              className="font-mono-num mt-1 w-full rounded-lg border border-slate-700 bg-[#090D16] px-2.5 py-1.5 text-xs text-slate-100"
            />
          </label>
          <label className="text-[11px] text-slate-400">
            Capital (USDT)
            <input
              type="number"
              min={100}
              value={initialCapital}
              onChange={(e) => setInitialCapital(Number(e.target.value))}
              className="font-mono-num mt-1 w-full rounded-lg border border-slate-700 bg-[#090D16] px-2.5 py-1.5 text-xs text-slate-100"
            />
          </label>
          <label className="text-[11px] text-slate-400">
            Leverage
            <input
              type="number"
              min={1}
              max={20}
              value={leverage}
              onChange={(e) => setLeverage(Number(e.target.value))}
              className="font-mono-num mt-1 w-full rounded-lg border border-slate-700 bg-[#090D16] px-2.5 py-1.5 text-xs text-slate-100"
            />
          </label>
          <label className="text-[11px] text-slate-400">
            Risk/Trade %
            <input
              type="number"
              min={0.2}
              max={5}
              step={0.1}
              value={riskPerTradePct}
              onChange={(e) => setRiskPerTradePct(Number(e.target.value))}
              className="font-mono-num mt-1 w-full rounded-lg border border-slate-700 bg-[#090D16] px-2.5 py-1.5 text-xs text-slate-100"
            />
          </label>
          <label className="text-[11px] text-slate-400">
            Min Confidence
            <input
              type="number"
              min={40}
              max={95}
              value={minConfidence}
              onChange={(e) => setMinConfidence(Number(e.target.value))}
              className="font-mono-num mt-1 w-full rounded-lg border border-slate-700 bg-[#090D16] px-2.5 py-1.5 text-xs text-slate-100"
            />
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={loading}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-bold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" />
              {loading ? 'Running...' : 'Run Backtest'}
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-2.5 text-xs text-rose-300">
            {error}
          </div>
        )}
      </form>

      {result && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-xl border border-slate-800/90 bg-[#0E1420] p-3">
              <div className="text-[11px] text-slate-400">Final Equity</div>
              <div className="font-mono-num mt-1 text-base font-bold text-slate-100">
                {fmtUsdt(result.finalEquity)}
              </div>
            </div>
            <div className="rounded-xl border border-slate-800/90 bg-[#0E1420] p-3">
              <div className="text-[11px] text-slate-400">Net PnL</div>
              <div
                className={`font-mono-num mt-1 text-base font-bold ${
                  result.netPnlUsdt >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {fmtUsdt(result.netPnlUsdt, true)} ({fmtPct(result.netPnlPct)})
              </div>
            </div>
            <div className="rounded-xl border border-slate-800/90 bg-[#0E1420] p-3">
              <div className="text-[11px] text-slate-400">Win Rate</div>
              <div className="font-mono-num mt-1 text-base font-bold text-slate-100">
                {result.winRatePct.toFixed(1)}% ({result.totalTrades} trades)
              </div>
            </div>
            <div className="rounded-xl border border-slate-800/90 bg-[#0E1420] p-3">
              <div className="text-[11px] text-slate-400">Profit Factor</div>
              <div className="font-mono-num mt-1 text-base font-bold text-cyan-300">
                {result.profitFactor.toFixed(2)}
              </div>
            </div>
            <div className="rounded-xl border border-slate-800/90 bg-[#0E1420] p-3">
              <div className="text-[11px] text-slate-400">Max Drawdown</div>
              <div className="font-mono-num mt-1 text-base font-bold text-amber-300">
                -{result.maxDrawdownPct.toFixed(2)}%
              </div>
            </div>
            <div className="rounded-xl border border-slate-800/90 bg-[#0E1420] p-3">
              <div className="text-[11px] text-slate-400">Sharpe Ratio</div>
              <div className="font-mono-num mt-1 text-base font-bold text-slate-100">
                {result.sharpeRatio.toFixed(2)}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800/90 bg-[#0E1420] p-4">
            <h3 className="mb-2 text-xs font-bold tracking-wider text-slate-300 uppercase">
              Equity Curve ({result.symbol} · {result.barsTested} bars)
            </h3>
            <div ref={chartRef} className="h-[260px] w-full overflow-hidden rounded-lg" />
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-800/90 bg-[#0E1420] p-4">
            <h3 className="mb-2 text-xs font-bold tracking-wider text-slate-300 uppercase">
              Simulated Executions ({result.trades.length})
            </h3>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] text-slate-400">
                  <th className="py-2 pr-3">Side</th>
                  <th className="py-2 pr-3">Entry / Exit</th>
                  <th className="py-2 pr-3">Qty</th>
                  <th className="py-2 pr-3">Realized PnL</th>
                  <th className="py-2 pr-3">Exit Time</th>
                  <th className="py-2">Exit Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {result.trades.map((t, i) => (
                  <tr key={i}>
                    <td className="py-2 pr-3">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                          t.side === 'LONG'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-rose-500/20 text-rose-300'
                        }`}
                      >
                        {t.side}
                      </span>
                    </td>
                    <td className="font-mono-num py-2 pr-3 text-slate-200">
                      ${fmtPrice(t.entryPrice)} → ${fmtPrice(t.exitPrice)}
                    </td>
                    <td className="font-mono-num py-2 pr-3 text-slate-300">
                      {t.quantity}
                    </td>
                    <td
                      className={`font-mono-num py-2 pr-3 font-semibold ${
                        t.realizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {fmtUsdt(t.realizedPnl, true)}
                    </td>
                    <td className="font-mono-num py-2 pr-3 text-slate-400">
                      {fmtClock(t.exitTime)}
                    </td>
                    <td className="py-2 text-slate-300">{t.exitReason}</td>
                  </tr>
                ))}
                {result.trades.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-slate-500">
                      No setups passed filters during this historical window. Try lowering Min Confidence.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
