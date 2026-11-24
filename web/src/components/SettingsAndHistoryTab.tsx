import { useEffect, useState } from 'react';
import { History, KeyRound, RotateCcw, Save, Sliders, Terminal } from 'lucide-react';
import type {
  DashboardSnapshot,
  SettingsUpdatePayload,
  TradingMode,
} from '@bot/shared';
import { fmtClock, fmtPrice, fmtUsdt } from '../lib/format.js';

interface SettingsAndHistoryTabProps {
  snapshot: DashboardSnapshot;
  busyAction: string | null;
  onSaveSettings: (payload: SettingsUpdatePayload) => void;
  onResetPaper: (balance: number) => void;
}

export function SettingsAndHistoryTab({
  snapshot,
  busyAction,
  onSaveSettings,
  onResetPaper,
}: SettingsAndHistoryTabProps) {
  const { settings, trades, logs } = snapshot;

  const [mode, setMode] = useState<TradingMode>(settings.mode);
  const [liveConfirmed, setLiveConfirmed] = useState(settings.liveConfirmed);
  const [leverage, setLeverage] = useState(settings.risk.defaultLeverage);
  const [riskPerTradePct, setRiskPerTradePct] = useState(settings.risk.riskPerTradePct);
  const [maxMarginPerTradePct, setMaxMarginPerTradePct] = useState(
    settings.risk.maxMarginPerTradePct ?? 10,
  );
  const [maxConcurrentPositions, setMaxConcurrentPositions] = useState(
    settings.risk.maxConcurrentPositions,
  );
  const [maxDailyLossPct, setMaxDailyLossPct] = useState(settings.risk.maxDailyLossPct);
  const [minConfidence, setMinConfidence] = useState(settings.strategy.minConfidence);
  const [minVolumeM, setMinVolumeM] = useState(
    Math.round(settings.strategy.minVolume24hUsdt / 1_000_000),
  );
  const [scanIntervalSec, setScanIntervalSec] = useState(
    settings.strategy.scanIntervalSeconds,
  );
  const [enableAutoTrading, setEnableAutoTrading] = useState(
    settings.strategy.enableAutoTrading,
  );

  const [binanceApiKey, setBinanceApiKey] = useState('');
  const [binanceApiSecret, setBinanceApiSecret] = useState('');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [paperResetAmount, setPaperResetAmount] = useState(10_000);

  useEffect(() => {
    setMode(settings.mode);
    setLiveConfirmed(settings.liveConfirmed);
    setLeverage(settings.risk.defaultLeverage);
    setRiskPerTradePct(settings.risk.riskPerTradePct);
    setMaxMarginPerTradePct(settings.risk.maxMarginPerTradePct ?? 10);
    setMaxConcurrentPositions(settings.risk.maxConcurrentPositions);
    setMaxDailyLossPct(settings.risk.maxDailyLossPct);
    setMinConfidence(settings.strategy.minConfidence);
    setMinVolumeM(Math.round(settings.strategy.minVolume24hUsdt / 1_000_000));
    setScanIntervalSec(settings.strategy.scanIntervalSeconds);
    setEnableAutoTrading(settings.strategy.enableAutoTrading);
  }, [settings]);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const creds: SettingsUpdatePayload['credentials'] = {};
    if (binanceApiKey.trim()) creds.binanceApiKey = binanceApiKey.trim();
    if (binanceApiSecret.trim()) creds.binanceApiSecret = binanceApiSecret.trim();
    if (geminiApiKey.trim()) creds.geminiApiKey = geminiApiKey.trim();
    if (telegramBotToken.trim()) creds.telegramBotToken = telegramBotToken.trim();
    if (telegramChatId.trim()) creds.telegramChatId = telegramChatId.trim();

    onSaveSettings({
      mode,
      liveConfirmed,
      risk: {
        defaultLeverage: leverage,
        riskPerTradePct,
        maxMarginPerTradePct,
        maxConcurrentPositions,
        maxDailyLossPct,
      },
      strategy: {
        minConfidence,
        minVolume24hUsdt: minVolumeM * 1_000_000,
        scanIntervalSeconds: scanIntervalSec,
        enableAutoTrading,
      },
      credentials: Object.keys(creds).length > 0 ? creds : undefined,
    });

    setBinanceApiKey('');
    setBinanceApiSecret('');
    setGeminiApiKey('');
    setTelegramBotToken('');
    setTelegramChatId('');
  }

  return (
    <div className="space-y-4">
      {/* Settings Editor */}
      <form
        onSubmit={handleSave}
        className="rounded-xl border border-slate-800 bg-[#111827] p-4"
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sliders className="h-4 w-4 text-cyan-400" />
            <h2 className="text-sm font-bold text-slate-100">
              Risk, Strategy & Exchange Configuration
            </h2>
          </div>
          <button
            type="submit"
            disabled={busyAction === 'save-settings'}
            className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3.5 py-1.5 text-xs font-bold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            Save Configuration
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="space-y-3 rounded-lg border border-slate-800/80 bg-[#0B111E] p-3.5">
            <div className="text-xs font-bold text-slate-200">
              Risk & Auto-Scanner Parameters
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <label className="text-[11px] text-slate-400">
                Trading Mode
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as TradingMode)}
                  className="mt-1 w-full rounded border border-slate-700 bg-[#090D16] px-2 py-1.5 text-xs font-semibold text-slate-100"
                >
                  <option value="PAPER">PAPER (Simulated)</option>
                  <option value="TESTNET">TESTNET (Binance Demo)</option>
                  <option value="LIVE">LIVE (Real Funds)</option>
                </select>
              </label>

              <label className="text-[11px] text-slate-400">
                Default Leverage (x)
                <input
                  type="number"
                  min={1}
                  max={25}
                  value={leverage}
                  onChange={(e) => setLeverage(Number(e.target.value))}
                  className="font-mono-num mt-1 w-full rounded border border-slate-700 bg-[#090D16] px-2 py-1.5 text-xs text-slate-100"
                />
              </label>

              <label className="text-[11px] text-slate-400">
                Risk Per Trade (%)
                <input
                  type="number"
                  min={0.2}
                  max={5}
                  step={0.1}
                  value={riskPerTradePct}
                  onChange={(e) => setRiskPerTradePct(Number(e.target.value))}
                  className="font-mono-num mt-1 w-full rounded border border-slate-700 bg-[#090D16] px-2 py-1.5 text-xs text-slate-100"
                />
              </label>

              <label className="text-[11px] text-slate-400">
                Max Margin / Trade (%)
                <input
                  type="number"
                  min={2}
                  max={50}
                  step={1}
                  value={maxMarginPerTradePct}
                  onChange={(e) => setMaxMarginPerTradePct(Number(e.target.value))}
                  className="font-mono-num mt-1 w-full rounded border border-slate-700 bg-[#090D16] px-2 py-1.5 text-xs text-slate-100"
                />
              </label>

              <label className="text-[11px] text-slate-400">
                Max Open Positions
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={maxConcurrentPositions}
                  onChange={(e) => setMaxConcurrentPositions(Number(e.target.value))}
                  className="font-mono-num mt-1 w-full rounded border border-slate-700 bg-[#090D16] px-2 py-1.5 text-xs text-slate-100"
                />
              </label>

              <label className="text-[11px] text-slate-400">
                Daily Loss Guard (%)
                <input
                  type="number"
                  min={1}
                  max={20}
                  step={0.5}
                  value={maxDailyLossPct}
                  onChange={(e) => setMaxDailyLossPct(Number(e.target.value))}
                  className="font-mono-num mt-1 w-full rounded border border-slate-700 bg-[#090D16] px-2 py-1.5 text-xs text-slate-100"
                />
              </label>

              <label className="text-[11px] text-slate-400">
                Min Confidence (%)
                <input
                  type="number"
                  min={40}
                  max={95}
                  value={minConfidence}
                  onChange={(e) => setMinConfidence(Number(e.target.value))}
                  className="font-mono-num mt-1 w-full rounded border border-slate-700 bg-[#090D16] px-2 py-1.5 text-xs text-slate-100"
                />
              </label>

              <label className="text-[11px] text-slate-400">
                Min 24h Vol ($M)
                <input
                  type="number"
                  min={5}
                  max={1000}
                  value={minVolumeM}
                  onChange={(e) => setMinVolumeM(Number(e.target.value))}
                  className="font-mono-num mt-1 w-full rounded border border-slate-700 bg-[#090D16] px-2 py-1.5 text-xs text-slate-100"
                />
              </label>

              <label className="text-[11px] text-slate-400">
                Scan Cadence (sec)
                <input
                  type="number"
                  min={15}
                  max={300}
                  value={scanIntervalSec}
                  onChange={(e) => setScanIntervalSec(Number(e.target.value))}
                  className="font-mono-num mt-1 w-full rounded border border-slate-700 bg-[#090D16] px-2 py-1.5 text-xs text-slate-100"
                />
              </label>

              <div className="flex items-end">
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={enableAutoTrading}
                    onChange={(e) => setEnableAutoTrading(e.target.checked)}
                    className="rounded border-slate-600 bg-slate-900"
                  />
                  Auto-Open Enabled
                </label>
              </div>
            </div>

            {mode === 'LIVE' && (
              <label className="flex items-center gap-2 rounded border border-rose-500/40 bg-rose-950/40 p-2 text-xs text-rose-200">
                <input
                  type="checkbox"
                  checked={liveConfirmed}
                  onChange={(e) => setLiveConfirmed(e.target.checked)}
                />
                I confirm LIVE real-money trading on Binance Futures with isolated margin risk.
              </label>
            )}
          </div>

          <div className="space-y-3 rounded-lg border border-slate-800/80 bg-[#0B111E] p-3.5">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
              <KeyRound className="h-3.5 w-3.5 text-amber-400" />
              API Credentials (write-only; never echoed back)
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <label className="text-[11px] text-slate-400">
                Binance API Key{' '}
                <span className="text-emerald-400">
                  ({settings.credentials.hasBinanceKey ? 'Configured' : 'Not set'})
                </span>
                <input
                  type="password"
                  placeholder="Enter to update..."
                  value={binanceApiKey}
                  onChange={(e) => setBinanceApiKey(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-700 bg-[#090D16] px-2.5 py-1.5 text-xs text-slate-100"
                />
              </label>

              <label className="text-[11px] text-slate-400">
                Binance API Secret{' '}
                <span className="text-emerald-400">
                  ({settings.credentials.hasBinanceSecret ? 'Configured' : 'Not set'})
                </span>
                <input
                  type="password"
                  placeholder="Enter to update..."
                  value={binanceApiSecret}
                  onChange={(e) => setBinanceApiSecret(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-700 bg-[#090D16] px-2.5 py-1.5 text-xs text-slate-100"
                />
              </label>

              <label className="text-[11px] text-slate-400">
                Gemini API Key{' '}
                <span className="text-cyan-300">
                  ({settings.credentials.hasGeminiKey ? 'Active' : 'Lexicon Fallback'})
                </span>
                <input
                  type="password"
                  placeholder="Optional for Gemini 3.8 Flash..."
                  value={geminiApiKey}
                  onChange={(e) => setGeminiApiKey(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-700 bg-[#090D16] px-2.5 py-1.5 text-xs text-slate-100"
                />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="text-[11px] text-slate-400">
                  Telegram Token
                  <input
                    type="password"
                    placeholder={settings.credentials.hasTelegramConfig ? 'Active' : 'Optional'}
                    value={telegramBotToken}
                    onChange={(e) => setTelegramBotToken(e.target.value)}
                    className="mt-1 w-full rounded border border-slate-700 bg-[#090D16] px-2 py-1.5 text-xs text-slate-100"
                  />
                </label>
                <label className="text-[11px] text-slate-400">
                  Chat ID
                  <input
                    type="text"
                    placeholder="Optional"
                    value={telegramChatId}
                    onChange={(e) => setTelegramChatId(e.target.value)}
                    className="mt-1 w-full rounded border border-slate-700 bg-[#090D16] px-2 py-1.5 text-xs text-slate-100"
                  />
                </label>
              </div>
            </div>

            {settings.mode === 'PAPER' && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-2.5">
                <span className="text-[11px] text-slate-400">
                  Paper Simulation Balance Reset:
                </span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={100}
                    value={paperResetAmount}
                    onChange={(e) => setPaperResetAmount(Number(e.target.value))}
                    className="font-mono-num w-28 rounded border border-slate-700 bg-[#090D16] px-2 py-1 text-xs text-slate-100"
                  />
                  <button
                    type="button"
                    onClick={() => onResetPaper(paperResetAmount)}
                    disabled={busyAction === 'reset-paper'}
                    className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-300 hover:bg-amber-500/25"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Reset Paper
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </form>

      {/* Trade Ledger + System Logs */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="rounded-xl border border-slate-800 bg-[#111827] p-4 lg:col-span-7">
          <div className="mb-3 flex items-center gap-2">
            <History className="h-4 w-4 text-emerald-400" />
            <h3 className="text-sm font-bold text-slate-100">
              Execution & Trade Ledger ({trades.length})
            </h3>
          </div>
          <div className="max-h-[340px] overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] text-slate-400">
                  <th className="py-2 pr-2">Time</th>
                  <th className="py-2 pr-2">Pair</th>
                  <th className="py-2 pr-2">Action</th>
                  <th className="py-2 pr-2">Price / Qty</th>
                  <th className="py-2 pr-2">PnL</th>
                  <th className="py-2">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {trades.map((t) => (
                  <tr key={t.id}>
                    <td className="font-mono-num py-2 pr-2 text-slate-400">
                      {fmtClock(t.createdAt)}
                    </td>
                    <td className="py-2 pr-2 font-semibold text-slate-100">
                      {t.symbol} ({t.side})
                    </td>
                    <td className="py-2 pr-2 text-[11px] font-semibold text-cyan-300">
                      {t.action}
                    </td>
                    <td className="font-mono-num py-2 pr-2 text-slate-300">
                      ${fmtPrice(t.price)} × {t.quantity}
                    </td>
                    <td
                      className={`font-mono-num py-2 pr-2 font-semibold ${
                        t.realizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {fmtUsdt(t.realizedPnl, true)}
                    </td>
                    <td className="max-w-xs truncate py-2 text-slate-400">
                      {t.reason}
                    </td>
                  </tr>
                ))}
                {trades.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500">
                      No executed trades recorded yet in {settings.mode} mode.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#111827] p-4 lg:col-span-5">
          <div className="mb-3 flex items-center gap-2">
            <Terminal className="h-4 w-4 text-cyan-400" />
            <h3 className="text-sm font-bold text-slate-100">System Audit Logs</h3>
          </div>
          <div className="max-h-[340px] space-y-1.5 overflow-y-auto font-mono text-[11px]">
            {logs.map((log) => (
              <div
                key={log.id}
                className="rounded border border-slate-800/70 bg-[#0B111E] px-2.5 py-1.5"
              >
                <div className="flex items-center justify-between text-[10px]">
                  <span
                    className={`font-bold ${
                      log.level === 'ERROR'
                        ? 'text-rose-400'
                        : log.level === 'WARN'
                          ? 'text-amber-300'
                          : log.level === 'SUCCESS'
                            ? 'text-emerald-400'
                            : 'text-cyan-300'
                    }`}
                  >
                    [{log.level}] {log.module}
                  </span>
                  <span className="text-slate-500">{fmtClock(log.createdAt)}</span>
                </div>
                <div className="mt-0.5 text-slate-300">{log.message}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
