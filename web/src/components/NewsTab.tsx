import { useMemo, useState } from 'react';
import { ExternalLink, Newspaper, RefreshCw, ShieldAlert } from 'lucide-react';
import type { DashboardSnapshot, NewsImpact } from '@bot/shared';
import { fmtTimeAgo } from '../lib/format.js';

interface NewsTabProps {
  snapshot: DashboardSnapshot;
  busyAction: string | null;
  onRefreshNews: () => void;
}

export function NewsTab({ snapshot, busyAction, onRefreshNews }: NewsTabProps) {
  const [symbolFilter, setSymbolFilter] = useState<string>('ALL');
  const [impactFilter, setImpactFilter] = useState<NewsImpact | 'ALL'>('ALL');

  const availableSymbols = useMemo(() => {
    const set = new Set<string>();
    for (const item of snapshot.news) {
      for (const s of item.symbols) set.add(s);
    }
    return ['ALL', ...Array.from(set).sort()];
  }, [snapshot.news]);

  const filteredNews = useMemo(
    () =>
      snapshot.news.filter((n) => {
        if (symbolFilter !== 'ALL' && !n.symbols.includes(symbolFilter)) return false;
        if (impactFilter !== 'ALL' && n.impact !== impactFilter) return false;
        return true;
      }),
    [snapshot.news, symbolFilter, impactFilter],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800/90 bg-[#0E1420] p-4">
        <div>
          <div className="flex items-center gap-2">
            <Newspaper className="h-4 w-4 text-amber-400" />
            <h2 className="text-sm font-bold text-slate-100">
              Crypto News & Sentiment Intelligence (
              {snapshot.status.geminiEnabled
                ? snapshot.settings.strategy.geminiModel
                : 'Lexicon Engine'}
              )
            </h2>
          </div>
          <p className="mt-0.5 text-xs text-slate-400">
            Ingests CoinTelegraph, CoinDesk, and Decrypt feeds, classifies coin impact & sentiment (-100..+100), and guards open positions against Black Swan events.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={symbolFilter}
            onChange={(e) => setSymbolFilter(e.target.value)}
            className="rounded-lg border border-slate-700 bg-[#080C14] px-2.5 py-1.5 text-xs text-slate-200"
          >
            {availableSymbols.map((s) => (
              <option key={s} value={s}>
                {s === 'ALL' ? 'All Coins & Macro' : s}
              </option>
            ))}
          </select>

          <select
            value={impactFilter}
            onChange={(e) => setImpactFilter(e.target.value as NewsImpact | 'ALL')}
            className="rounded-lg border border-slate-700 bg-[#080C14] px-2.5 py-1.5 text-xs text-slate-200"
          >
            <option value="ALL">All Impact Levels</option>
            <option value="CRITICAL">CRITICAL</option>
            <option value="HIGH">HIGH</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="LOW">LOW</option>
          </select>

          <button
            type="button"
            onClick={onRefreshNews}
            disabled={busyAction === 'news' || snapshot.status.newsRefreshInProgress}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/25 disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${
                snapshot.status.newsRefreshInProgress ? 'animate-spin' : ''
              }`}
            />
            Refresh News
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {filteredNews.map((item) => (
          <article
            key={item.id}
            className={`rounded-xl border p-4 transition ${
              item.isBlackSwan
                ? 'border-rose-500/60 bg-rose-950/30'
                : 'border-slate-800/90 bg-[#0E1420] hover:border-slate-700'
            }`}
          >
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-1.5">
                {item.isBlackSwan && (
                  <span className="inline-flex items-center gap-1 rounded bg-rose-600 px-1.5 py-0.5 font-bold text-white">
                    <ShieldAlert className="h-3 w-3" /> BLACK SWAN
                  </span>
                )}
                <span
                  className={`rounded px-1.5 py-0.5 font-bold ${
                    item.sentiment === 'BULLISH'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : item.sentiment === 'BEARISH'
                        ? 'bg-rose-500/20 text-rose-300'
                        : 'bg-slate-700/70 text-slate-300'
                  }`}
                >
                  {item.sentiment} ({item.score >= 0 ? '+' : ''}
                  {item.score})
                </span>
                <span className="rounded border border-slate-700 bg-slate-800/80 px-1.5 py-0.5 font-semibold text-slate-300">
                  {item.impact}
                </span>
                <span className="rounded bg-cyan-500/15 px-1.5 py-0.5 font-mono text-[10px] text-cyan-300">
                  {item.analysisSource}
                </span>
              </div>
              <span className="text-slate-400">
                {item.source} · {fmtTimeAgo(item.publishedAt)}
              </span>
            </div>

            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="group inline-flex items-start gap-1.5 text-sm font-semibold text-slate-100 hover:text-cyan-300"
            >
              <span>{item.title}</span>
              <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-60 group-hover:opacity-100" />
            </a>

            <p className="mt-1.5 text-xs text-slate-400">{item.summary}</p>

            <div className="mt-2.5 flex flex-wrap gap-1">
              {item.symbols.map((sym) => (
                <span
                  key={sym}
                  className="rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-300"
                >
                  {sym}
                </span>
              ))}
            </div>
          </article>
        ))}

        {filteredNews.length === 0 && (
          <div className="col-span-full rounded-xl border border-dashed border-slate-800 py-10 text-center text-xs text-slate-500">
            No news articles match the current filter.
          </div>
        )}
      </div>
    </div>
  );
}
