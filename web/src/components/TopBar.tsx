import { useState } from 'react';
import {
  Activity,
  Bot,
  Pause,
  Play,
  ShieldAlert,
  Sparkles,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { BotStatus } from '@bot/shared';
import { fmtTimeAgo } from '../lib/format.js';

interface TopBarProps {
  status: BotStatus;
  wsConnected: boolean;
  busyAction: string | null;
  onStart: () => void;
  onPause: () => void;
  onKillSwitch: () => void;
}

export function TopBar({
  status,
  wsConnected,
  busyAction,
  onStart,
  onPause,
  onKillSwitch,
}: TopBarProps) {
  const [confirmKill, setConfirmKill] = useState(false);

  const modeStyles =
    status.mode === 'LIVE'
      ? 'bg-rose-500/15 text-rose-300 border-rose-500/40'
      : status.mode === 'TESTNET'
        ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40'
        : 'bg-amber-500/15 text-amber-300 border-amber-500/40';

  return (
    <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-[#090D16]/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-500/30 bg-cyan-500/10 text-cyan-400">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold tracking-wider text-slate-100">
                APEX-QUANT FUTURES
              </h1>
              <span
                className={`rounded border px-2 py-0.5 text-[11px] font-semibold tracking-wide ${modeStyles}`}
              >
                {status.mode}
              </span>
              {status.killSwitchActive && (
                <span className="rounded border border-rose-500/50 bg-rose-500/20 px-2 py-0.5 text-[11px] font-bold text-rose-300">
                  KILL SWITCH ON
                </span>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
              <span className="inline-flex items-center gap-1">
                {wsConnected ? (
                  <Wifi className="h-3 w-3 text-emerald-400" />
                ) : (
                  <WifiOff className="h-3 w-3 text-rose-400" />
                )}
                UI {wsConnected ? 'Live' : 'Reconnecting'}
              </span>
              <span className="inline-flex items-center gap-1">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    status.marketStreamConnected ? 'bg-emerald-400' : 'bg-amber-400'
                  }`}
                />
                Binance WS {status.marketStreamConnected ? 'Connected' : 'Fallback'}
              </span>
              <span className="inline-flex items-center gap-1">
                <Sparkles className="h-3 w-3 text-cyan-400" />
                Sentiment: {status.geminiEnabled ? 'Gemini AI' : 'Lexicon Engine'}
              </span>
              <span className="hidden items-center gap-1 sm:inline-flex">
                <Activity className="h-3 w-3 text-slate-500" />
                Last Scan: {fmtTimeAgo(status.lastScanAt)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {status.running ? (
            <button
              type="button"
              onClick={onPause}
              disabled={busyAction === 'pause'}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300 transition hover:bg-amber-500/20 disabled:opacity-50"
            >
              <Pause className="h-3.5 w-3.5" />
              Pause Auto-Trade
            </button>
          ) : (
            <button
              type="button"
              onClick={onStart}
              disabled={busyAction === 'start'}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/25 disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" />
              Start Auto-Trade
            </button>
          )}

          {!confirmKill ? (
            <button
              type="button"
              onClick={() => setConfirmKill(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/50 bg-rose-600/20 px-3 py-1.5 text-xs font-bold text-rose-300 transition hover:bg-rose-600/35"
            >
              <ShieldAlert className="h-3.5 w-3.5" />
              Kill Switch
            </button>
          ) : (
            <div className="flex items-center gap-1.5 rounded-lg border border-rose-500/70 bg-rose-950/90 px-2.5 py-1">
              <span className="text-[11px] font-semibold text-rose-200">
                Close ALL positions?
              </span>
              <button
                type="button"
                onClick={() => {
                  setConfirmKill(false);
                  onKillSwitch();
                }}
                disabled={busyAction === 'kill-switch'}
                className="rounded bg-rose-600 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-rose-500"
              >
                CONFIRM
              </button>
              <button
                type="button"
                onClick={() => setConfirmKill(false)}
                className="rounded px-1.5 py-0.5 text-[11px] text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
