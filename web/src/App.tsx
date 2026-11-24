import { useEffect, useState } from 'react';
import {
  FlaskConical,
  LayoutDashboard,
  Newspaper,
  Radar,
  Sliders,
  X,
} from 'lucide-react';
import type { CandleChartResponse, Timeframe } from '@bot/shared';
import { BacktestTab } from './components/BacktestTab.js';
import { NewsTab } from './components/NewsTab.js';
import { OverviewTab } from './components/OverviewTab.js';
import { ScannerTab } from './components/ScannerTab.js';
import { SettingsAndHistoryTab } from './components/SettingsAndHistoryTab.js';
import { TopBar } from './components/TopBar.js';
import { useDashboard } from './hooks/useDashboard.js';
import { api } from './lib/api.js';

type TabId = 'overview' | 'scanner' | 'news' | 'backtest' | 'settings';

const TABS: Array<{ id: TabId; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: 'Command Center', icon: LayoutDashboard },
  { id: 'scanner', label: 'Auto-Scanner', icon: Radar },
  { id: 'news', label: 'News & AI', icon: Newspaper },
  { id: 'backtest', label: 'Backtest Lab', icon: FlaskConical },
  { id: 'settings', label: 'History & Settings', icon: Sliders },
];

export function App() {
  const {
    snapshot,
    wsConnected,
    loading,
    error,
    clearError,
    busyAction,
    startBot,
    pauseBot,
    killSwitch,
    scanNow,
    refreshNews,
    closePosition,
    resetPaper,
    saveSettings,
  } = useDashboard();

  const [tab, setTab] = useState<TabId>('overview');
  const [selectedSymbol, setSelectedSymbol] = useState('BTCUSDT');
  const [interval, setIntervalState] = useState<Timeframe>('15m');
  const [chartData, setChartData] = useState<CandleChartResponse | null>(null);
  const [chartLoading, setChartLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setChartLoading(true);
    void api
      .getCandles(selectedSymbol, interval, 200)
      .then((res) => {
        if (!cancelled) setChartData(res);
      })
      .catch(() => {
        // Handled cleanly via empty fallback
      })
      .finally(() => {
        if (!cancelled) setChartLoading(false);
      });

    const timer = window.setInterval(() => {
      void api
        .getCandles(selectedSymbol, interval, 200)
        .then((res) => {
          if (!cancelled) setChartData(res);
        })
        .catch(() => undefined);
    }, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedSymbol, interval]);

  if (loading || !snapshot) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#090D16] text-sm text-slate-300">
        {error ? `Connection error: ${error}` : 'Booting APEX-QUANT Futures Terminal...'}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#090D16] text-slate-100">
      <TopBar
        status={snapshot.status}
        wsConnected={wsConnected}
        busyAction={busyAction}
        onStart={startBot}
        onPause={pauseBot}
        onKillSwitch={killSwitch}
      />

      <nav className="border-b border-slate-800/80 bg-[#0D1320]">
        <div className="mx-auto flex max-w-[1600px] gap-1 overflow-x-auto px-4 py-2">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  active
                    ? 'bg-cyan-500/15 text-cyan-300 ring-1 ring-cyan-500/40'
                    : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>
      </nav>

      <main className="mx-auto max-w-[1600px] px-4 py-4">
        {error && (
          <div className="mb-4 flex items-center justify-between rounded-xl border border-rose-500/40 bg-rose-950/60 px-4 py-2.5 text-xs text-rose-200">
            <span>{error}</span>
            <button
              type="button"
              onClick={clearError}
              className="rounded p-0.5 hover:bg-rose-800/50"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {tab === 'overview' && (
          <OverviewTab
            snapshot={snapshot}
            selectedSymbol={selectedSymbol}
            interval={interval}
            chartData={chartData}
            chartLoading={chartLoading}
            busyAction={busyAction}
            onSelectSymbol={setSelectedSymbol}
            onIntervalChange={setIntervalState}
            onScanNow={scanNow}
            onClosePosition={closePosition}
          />
        )}

        {tab === 'scanner' && (
          <ScannerTab
            snapshot={snapshot}
            busyAction={busyAction}
            onScanNow={scanNow}
            onInspectChart={(sym) => {
              setSelectedSymbol(sym);
              setTab('overview');
            }}
          />
        )}

        {tab === 'news' && (
          <NewsTab
            snapshot={snapshot}
            busyAction={busyAction}
            onRefreshNews={refreshNews}
          />
        )}

        {tab === 'backtest' && <BacktestTab defaultSymbol={selectedSymbol} />}

        {tab === 'settings' && (
          <SettingsAndHistoryTab
            snapshot={snapshot}
            busyAction={busyAction}
            onSaveSettings={saveSettings}
            onResetPaper={resetPaper}
          />
        )}
      </main>
    </div>
  );
}
