import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Newspaper,
  Radar,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import type {
  CandleChartResponse,
  DashboardSnapshot,
  Timeframe,
} from '@bot/shared';
import {
  fmtCompactUsd,
  fmtPct,
  fmtPrice,
  fmtTimeAgo,
  fmtUsdt,
} from '../lib/format.js';
import { CandlestickChart } from './CandlestickChart.js';

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
}

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
}: OverviewTabProps) {
  const { account, positions, scanner, signals, news } = snapshot;
  const activePosition = positions.find((p) => p.symbol === selectedSymbol) ?? null;
  const selectedSignal = signals.find((s) => s.symbol === selectedSymbol) ?? null;
  const tech = chartData?.technical ?? null;
  const newsCtx = chartData?.newsContext ?? null;

  const dailyLossUsedPct = Math.min(
    100,
    Math.max(
      0,
      account.dailyPnlPct < 0
        ? (Math.abs(account.dailyPnlPct) / Math.max(account.dailyLossLimitPct, 0.1)) *
            100
        : 0,
    ),
  );

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-800 bg-[#111827] p-4">
          <div className="flex items-center justify-between text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
            <span>Total Equity</span>
            {snapshot.settings.risk.maxAccountCapitalUsdt && (
              <span className="rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-normal text-cyan-300 normal-case">
                Cap ${snapshot.settings.risk.maxAccountCapitalUsdt}
              </span>
            )}
          </div>
          <div className="font-mono-num mt-1 text-2xl font-bold text-slate-100">
            {fmtUsdt(account.totalEquity)}
          </div>
          <div className="mt-1.5 flex items-center justify-between text-xs text-slate-400">
            <span>Free Margin</span>
            <span className="font-mono-num text-slate-200">
              {fmtUsdt(account.availableBalance)}
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#111827] p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
              Daily PnL & Guard
            </span>
            {account.circuitBreakerTripped && (
              <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-bold text-rose-300">
                TRIPPED
              </span>
            )}
          </div>
          <div
            className={`font-mono-num mt-1 text-2xl font-bold ${
              account.dailyPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {fmtUsdt(account.dailyPnl, true)}{' '}
            <span className="text-sm font-medium">
              ({fmtPct(account.dailyPnlPct)})
            </span>
          </div>
          <div className="mt-2">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className={`h-full transition-all ${
                  dailyLossUsedPct > 75 ? 'bg-rose-500' : 'bg-amber-400'
                }`}
                style={{ width: `${dailyLossUsedPct}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-slate-500">
              <span>Unrealized: {fmtUsdt(account.unrealizedPnl, true)}</span>
              <span>Limit: -{account.dailyLossLimitPct}%</span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#111827] p-4">
          <div className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
            Win Rate & Profit Factor
          </div>
          <div className="font-mono-num mt-1 text-2xl font-bold text-slate-100">
            {account.winRatePct.toFixed(1)}%
            <span className="ml-2 text-sm font-semibold text-cyan-300">
              PF {account.profitFactor.toFixed(2)}
            </span>
          </div>
          <div className="mt-1.5 flex items-center justify-between text-xs text-slate-400">
            <span>Closed Executions</span>
            <span className="font-mono-num text-slate-200">{account.totalTrades}</span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#111827] p-4">
          <div className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
            Active Margin Exposure
          </div>
          <div className="font-mono-num mt-1 text-2xl font-bold text-slate-100">
            {positions.length} / {snapshot.settings.risk.maxConcurrentPositions}{' '}
            <span className="text-sm font-medium text-slate-400">Pos</span>
          </div>
          <div className="mt-1.5 flex items-center justify-between text-xs text-slate-400">
            <span>Isolated Margin Used</span>
            <span className="font-mono-num text-slate-200">
              {fmtUsdt(account.isolatedMarginUsed)}
            </span>
          </div>
        </div>
      </div>

      {/* Main Chart + Scanner/Intelligence Grid */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-8">
          <CandlestickChart
            symbol={selectedSymbol}
            interval={interval}
            chartData={chartData}
            loading={chartLoading}
            activePosition={activePosition}
            onIntervalChange={onIntervalChange}
          />

          {/* Decision Fusion & Technical Inspector */}
          <div className="rounded-xl border border-slate-800 bg-[#111827] p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-cyan-400" />
                <h3 className="text-sm font-bold text-slate-100">
                  {selectedSymbol} Live Decision & Indicator Fusion
                </h3>
              </div>
              {selectedSignal && (
                <span
                  className={`rounded px-2 py-0.5 text-xs font-bold ${
                    selectedSignal.action === 'LONG'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : selectedSignal.action === 'SHORT'
                        ? 'bg-rose-500/20 text-rose-300'
                        : 'bg-slate-700/60 text-slate-300'
                  }`}
                >
                  {selectedSignal.action} · {selectedSignal.confidence}% Confidence
                </span>
              )}
            </div>

            {tech ? (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div className="rounded-lg border border-slate-800/80 bg-[#0B111E] p-2.5">
                  <div className="text-[11px] text-slate-400">Technical Score</div>
                  <div
                    className={`font-mono-num text-lg font-bold ${
                      tech.technicalScore >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {tech.technicalScore >= 0 ? '+' : ''}
                    {tech.technicalScore}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    4H {tech.trend4h} · 1H {tech.trend1h}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-800/80 bg-[#0B111E] p-2.5">
                  <div className="text-[11px] text-slate-400">News Sentiment</div>
                  <div
                    className={`font-mono-num text-lg font-bold ${
                      (newsCtx?.newsScore ?? 0) >= 0 ? 'text-cyan-300' : 'text-rose-400'
                    }`}
                  >
                    {(newsCtx?.newsScore ?? 0) >= 0 ? '+' : ''}
                    {newsCtx?.newsScore ?? 0}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {newsCtx?.articleCount ?? 0} relevant articles
                  </div>
                </div>

                <div className="rounded-lg border border-slate-800/80 bg-[#0B111E] p-2.5">
                  <div className="text-[11px] text-slate-400">Regime & ADX</div>
                  <div className="font-mono-num text-sm font-bold text-slate-100">
                    {tech.regime.replaceAll('_', ' ')}
                  </div>
                  <div className="font-mono-num text-[11px] text-slate-500">
                    ADX {tech.indicators15m.adx14.toFixed(1)} · RSI{' '}
                    {tech.indicators15m.rsi14.toFixed(1)}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-800/80 bg-[#0B111E] p-2.5">
                  <div className="text-[11px] text-slate-400">ATR & Volume</div>
                  <div className="font-mono-num text-sm font-bold text-slate-100">
                    {tech.indicators15m.atrPct.toFixed(2)}% ATR
                  </div>
                  <div className="font-mono-num text-[11px] text-slate-500">
                    Vol {tech.indicators15m.volumeRatio.toFixed(2)}x avg
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-xs text-slate-500">
                Waiting for multi-timeframe technical calculation...
              </div>
            )}

            {(selectedSignal?.vetoReasons.length || tech?.reasons.length) && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {tech?.reasons.map((r, i) => (
                  <span
                    key={`r-${i}`}
                    className="rounded border border-slate-700/80 bg-slate-800/60 px-2 py-0.5 text-[11px] text-slate-300"
                  >
                    {r}
                  </span>
                ))}
                {selectedSignal?.vetoReasons.map((v, i) => (
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

        {/* Right Column: Auto-Scanner Watchlist + Breaking News Ticker */}
        <div className="space-y-4 xl:col-span-4">
          <div className="rounded-xl border border-slate-800 bg-[#111827] p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Radar className="h-4 w-4 text-cyan-400" />
                <h3 className="text-sm font-bold text-slate-100">
                  Top Auto-Scanner Pairs
                </h3>
              </div>
              <button
                type="button"
                onClick={onScanNow}
                disabled={busyAction === 'scan' || snapshot.status.scannerInProgress}
                className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800/80 px-2 py-1 text-[11px] font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-3 w-3 ${
                    snapshot.status.scannerInProgress ? 'animate-spin' : ''
                  }`}
                />
                Scan Now
              </button>
            </div>

            <div className="space-y-1.5">
              {scanner.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-500">
                  Scanning Binance USD-M Futures market...
                </div>
              ) : (
                scanner.map((c) => {
                  const sig = signals.find((s) => s.symbol === c.symbol);
                  const active = c.symbol === selectedSymbol;
                  return (
                    <button
                      key={c.symbol}
                      type="button"
                      onClick={() => onSelectSymbol(c.symbol)}
                      className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition ${
                        active
                          ? 'border-cyan-500/60 bg-cyan-500/10'
                          : 'border-slate-800/80 bg-[#0B111E] hover:border-slate-700'
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-slate-100">
                            {c.symbol}
                          </span>
                          {c.hasHighImpactNews && (
                            <span className="rounded bg-amber-500/20 px-1 py-0.5 text-[9px] font-bold text-amber-300">
                              NEWS
                            </span>
                          )}
                          {sig && sig.action !== 'HOLD' && (
                            <span
                              className={`rounded px-1 py-0.5 text-[9px] font-bold ${
                                sig.action === 'LONG'
                                  ? 'bg-emerald-500/20 text-emerald-300'
                                  : 'bg-rose-500/20 text-rose-300'
                              }`}
                            >
                              {sig.action}
                            </span>
                          )}
                        </div>
                        <div className="font-mono-num text-[11px] text-slate-400">
                          Vol {fmtCompactUsd(c.quoteVolume24h)} · Score {c.scannerScore}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono-num text-xs font-semibold text-slate-100">
                          ${fmtPrice(c.lastPrice)}
                        </div>
                        <div
                          className={`font-mono-num text-[11px] font-medium ${
                            c.priceChangePercent24h >= 0
                              ? 'text-emerald-400'
                              : 'text-rose-400'
                          }`}
                        >
                          {fmtPct(c.priceChangePercent24h)}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#111827] p-4">
            <div className="mb-3 flex items-center gap-2">
              <Newspaper className="h-4 w-4 text-amber-400" />
              <h3 className="text-sm font-bold text-slate-100">
                Latest News & AI Sentiment
              </h3>
            </div>
            <div className="space-y-2">
              {news.slice(0, 5).map((item) => (
                <a
                  key={item.id}
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-lg border border-slate-800/80 bg-[#0B111E] p-2.5 transition hover:border-slate-700"
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
                      <span className="text-cyan-300">{item.symbols.slice(0, 2).join(', ')}</span>
                    </div>
                    <span className="text-slate-500">{fmtTimeAgo(item.publishedAt)}</span>
                  </div>
                  <div className="line-clamp-2 text-xs font-medium text-slate-200">
                    {item.title}
                  </div>
                </a>
              ))}
              {news.length === 0 && (
                <div className="py-4 text-center text-xs text-slate-500">
                  Fetching crypto news feeds...
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Active Positions Table */}
      <div className="rounded-xl border border-slate-800 bg-[#111827] p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-100">
            Active Futures Positions ({positions.length})
          </h3>
          <span className="text-xs text-slate-400">
            Auto-managed: TP1 50% + Break-Even + ATR Trailing Stop
          </span>
        </div>

        {positions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-800 py-8 text-center text-xs text-slate-500">
            No open positions right now. Bot monitors Auto-Scanner candidates every{' '}
            {snapshot.settings.strategy.scanIntervalSeconds}s and enters when Technical + News + Risk align.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] text-slate-400">
                  <th className="py-2 pr-3">Symbol</th>
                  <th className="py-2 pr-3">Side / Lev</th>
                  <th className="py-2 pr-3">Qty</th>
                  <th className="py-2 pr-3">Entry / Mark</th>
                  <th className="py-2 pr-3">SL / TP1 / TP2</th>
                  <th className="py-2 pr-3">Liq. Price</th>
                  <th className="py-2 pr-3">Unrealized PnL</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {positions.map((pos) => {
                  const roePct =
                    pos.isolatedMargin > 0
                      ? (pos.unrealizedPnl / pos.isolatedMargin) * 100
                      : 0;
                  return (
                    <tr key={pos.id} className="hover:bg-slate-800/30">
                      <td className="py-2.5 pr-3 font-bold text-slate-100">
                        <button
                          type="button"
                          onClick={() => onSelectSymbol(pos.symbol)}
                          className="hover:text-cyan-300"
                        >
                          {pos.symbol}
                        </button>
                      </td>
                      <td className="py-2.5 pr-3">
                        <span
                          className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-bold ${
                            pos.side === 'LONG'
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : 'bg-rose-500/15 text-rose-300'
                          }`}
                        >
                          {pos.side === 'LONG' ? (
                            <ArrowUpRight className="h-3 w-3" />
                          ) : (
                            <ArrowDownRight className="h-3 w-3" />
                          )}
                          {pos.side} {pos.leverage}x
                        </span>
                      </td>
                      <td className="font-mono-num py-2.5 pr-3 text-slate-200">
                        {pos.remainingQuantity}
                      </td>
                      <td className="font-mono-num py-2.5 pr-3">
                        <div className="text-slate-200">${fmtPrice(pos.entryPrice)}</div>
                        <div className="text-[11px] text-cyan-300">
                          ${fmtPrice(pos.markPrice)}
                        </div>
                      </td>
                      <td className="font-mono-num py-2.5 pr-3 text-[11px]">
                        <div className="text-rose-400">SL ${fmtPrice(pos.stopLoss)}</div>
                        <div className="text-emerald-400">
                          TP1 ${fmtPrice(pos.takeProfit1)} / TP2 ${fmtPrice(pos.takeProfit2)}
                        </div>
                      </td>
                      <td className="font-mono-num py-2.5 pr-3 text-amber-300">
                        ${fmtPrice(pos.liquidationPrice)}
                      </td>
                      <td
                        className={`font-mono-num py-2.5 pr-3 font-semibold ${
                          pos.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        <div>{fmtUsdt(pos.unrealizedPnl, true)}</div>
                        <div className="text-[11px]">{fmtPct(roePct)} ROE</div>
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="flex flex-wrap gap-1">
                          {pos.tp1Hit && (
                            <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                              TP1 HIT
                            </span>
                          )}
                          {pos.trailingActive ? (
                            <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-300">
                              TRAILING
                            </span>
                          ) : (
                            <span className="rounded bg-slate-700/60 px-1.5 py-0.5 text-[10px] text-slate-300">
                              PROTECTED
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => onClosePosition(pos.id)}
                          disabled={busyAction === `close-${pos.id}`}
                          className="inline-flex items-center gap-1 rounded border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-[11px] font-semibold text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
                        >
                          <X className="h-3 w-3" />
                          Close
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {account.circuitBreakerTripped && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-500/50 bg-rose-950/50 p-3 text-xs text-rose-200">
          <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
          Daily Loss Circuit Breaker triggered (-{account.dailyLossLimitPct}% max daily drawdown). Auto-trading is paused until UTC midnight or manual restart.
        </div>
      )}
    </div>
  );
}
