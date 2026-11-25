import { RefreshCw, Radar } from 'lucide-react';
import type { DashboardSnapshot } from '@bot/shared';
import { fmtCompactUsd, fmtPct, fmtPrice } from '../lib/format.js';

interface ScannerTabProps {
  snapshot: DashboardSnapshot;
  busyAction: string | null;
  onScanNow: () => void;
  onInspectChart: (symbol: string) => void;
}

export function ScannerTab({
  snapshot,
  busyAction,
  onScanNow,
  onInspectChart,
}: ScannerTabProps) {
  const { scanner, signals } = snapshot;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800/90 bg-[#0E1420] p-4">
        <div>
          <div className="flex items-center gap-2">
            <Radar className="h-4 w-4 text-cyan-400" />
            <h2 className="text-sm font-bold text-slate-100">
              Auto-Scanner & Multi-Timeframe Decision Inspector
            </h2>
          </div>
          <p className="mt-0.5 text-xs text-slate-400">
            Automatically ranks USD-M Perpetual pairs by 24h liquidity, intraday volatility, funding skew, and live news catalysts, then evaluates 15m/1h/4h technicals + AI sentiment.
          </p>
        </div>

        <button
          type="button"
          onClick={onScanNow}
          disabled={busyAction === 'scan' || snapshot.status.scannerInProgress}
          className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3 py-1.5 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/25 disabled:opacity-50"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${
              snapshot.status.scannerInProgress ? 'animate-spin' : ''
            }`}
          />
          Run Full Scan
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-800/90 bg-[#0E1420] p-4">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-[11px] text-slate-400">
              <th className="py-2 pr-3">Pair</th>
              <th className="py-2 pr-3">Price / 24h</th>
              <th className="py-2 pr-3">24h Vol / Range</th>
              <th className="py-2 pr-3">Funding</th>
              <th className="py-2 pr-3">Regime</th>
              <th className="py-2 pr-3">Tech / News / Comp</th>
              <th className="py-2 pr-3">Decision</th>
              <th className="py-2">Reasons / Filters</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {scanner.map((c) => {
              const sig = signals.find((s) => s.symbol === c.symbol);
              return (
                <tr key={c.symbol} className="hover:bg-slate-800/30">
                  <td className="py-3 pr-3">
                    <button
                      type="button"
                      onClick={() => onInspectChart(c.symbol)}
                      className="font-bold text-cyan-300 hover:underline"
                    >
                      {c.symbol}
                    </button>
                    <div className="font-mono-num text-[11px] text-slate-500">
                      Scan {c.scannerScore}/100
                    </div>
                  </td>
                  <td className="font-mono-num py-3 pr-3">
                    <div className="text-slate-100">${fmtPrice(c.lastPrice)}</div>
                    <div
                      className={
                        c.priceChangePercent24h >= 0
                          ? 'text-emerald-400'
                          : 'text-rose-400'
                      }
                    >
                      {fmtPct(c.priceChangePercent24h)}
                    </div>
                  </td>
                  <td className="font-mono-num py-3 pr-3">
                    <div className="text-slate-200">{fmtCompactUsd(c.quoteVolume24h)}</div>
                    <div className="text-[11px] text-slate-400">
                      {c.intradayRangePct.toFixed(1)}% span
                    </div>
                  </td>
                  <td className="font-mono-num py-3 pr-3 text-slate-300">
                    {(c.fundingRate * 100).toFixed(4)}%
                  </td>
                  <td className="py-3 pr-3 text-[11px] text-slate-300">
                    {sig ? sig.regime.replaceAll('_', ' ') : 'Pending'}
                  </td>
                  <td className="font-mono-num py-3 pr-3">
                    {sig ? (
                      <div className="flex items-center gap-1.5">
                        <span
                          className={
                            sig.technicalScore >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }
                        >
                          T:{sig.technicalScore}
                        </span>
                        <span className="text-cyan-300">N:{sig.newsScore}</span>
                        <span className="font-bold text-slate-100">
                          C:{sig.compositeScore}
                        </span>
                      </div>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                  <td className="py-3 pr-3">
                    {sig ? (
                      <div>
                        <span
                          className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                            sig.action === 'LONG'
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : sig.action === 'SHORT'
                                ? 'bg-rose-500/20 text-rose-300'
                                : 'bg-slate-700/70 text-slate-300'
                          }`}
                        >
                          {sig.action} ({sig.confidence}%)
                        </span>
                        {sig.executed && (
                          <div className="mt-1 text-[10px] font-semibold text-emerald-400">
                            EXECUTED
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                  <td className="max-w-md py-3">
                    <div className="flex flex-wrap gap-1">
                      {sig?.reasons.slice(0, 3).map((r, i) => (
                        <span
                          key={`sr-${i}`}
                          className="rounded border border-slate-700 bg-slate-800/60 px-1.5 py-0.5 text-[10px] text-slate-300"
                        >
                          {r}
                        </span>
                      ))}
                      {sig?.vetoReasons.slice(0, 2).map((v, i) => (
                        <span
                          key={`sv-${i}`}
                          className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300"
                        >
                          {v}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
