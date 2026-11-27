import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  DashboardSnapshot,
  SettingsUpdatePayload,
  WsMessage,
} from '@bot/shared';
import { api } from '../lib/api.js';

export function useDashboard(authToken: string | null, onUnauthorized?: () => void) {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const reconnectTimer = useRef<number | null>(null);

  const reload = useCallback(async () => {
    if (!authToken) return;
    try {
      const data = await api.getDashboard();
      setSnapshot(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [authToken]);

  useEffect(() => {
    if (!authToken) {
      setSnapshot(null);
      setWsConnected(false);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    void reload();

    let closed = false;
    let ws: WebSocket | null = null;

    const connect = () => {
      if (closed) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${proto}//${window.location.host}/ws?token=${encodeURIComponent(authToken)}`;
      ws = new WebSocket(wsUrl);

      ws.onopen = () => setWsConnected(true);
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data) as WsMessage;
          setSnapshot((prev) => {
            if (msg.type === 'snapshot') {
              return msg.data;
            }
            if (!prev) return prev;
            if (msg.type === 'tick') {
              return {
                ...prev,
                status: msg.data.status,
                account: msg.data.account,
                positions: msg.data.positions,
              };
            }
            if (msg.type === 'scanner') {
              return {
                ...prev,
                scanner: msg.data.scanner,
                signals: msg.data.signals,
              };
            }
            if (msg.type === 'news') {
              return {
                ...prev,
                news: msg.data.news,
              };
            }
            if (msg.type === 'log') {
              return {
                ...prev,
                logs: [msg.data, ...prev.logs].slice(0, 100),
              };
            }
            return prev;
          });
        } catch {
          // Ignore invalid frame
        }
      };

      ws.onclose = (evt) => {
        setWsConnected(false);
        if (evt.code === 4401) {
          closed = true;
          onUnauthorized?.();
          return;
        }
        if (!closed) {
          reconnectTimer.current = window.setTimeout(connect, 2500);
        }
      };

      ws.onerror = () => {
        setWsConnected(false);
      };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      ws?.close();
    };
  }, [authToken, onUnauthorized, reload]);

  const runAction = useCallback(
    async (label: string, fn: () => Promise<void>) => {
      setBusyAction(label);
      setError(null);
      try {
        await fn();
      } catch (err) {
        setError(err instanceof Error ? err.message : `${label} failed`);
      } finally {
        setBusyAction(null);
      }
    },
    [],
  );

  const startBot = () =>
    runAction('start', async () => {
      const { status } = await api.startBot();
      setSnapshot((p) => (p ? { ...p, status } : p));
    });

  const pauseBot = () =>
    runAction('pause', async () => {
      const { status } = await api.pauseBot();
      setSnapshot((p) => (p ? { ...p, status } : p));
    });

  const killSwitch = () =>
    runAction('kill-switch', async () => {
      const next = await api.triggerKillSwitch();
      setSnapshot(next);
    });

  const scanNow = () =>
    runAction('scan', async () => {
      const res = await api.runScanner();
      setSnapshot((p) =>
        p ? { ...p, scanner: res.scanner, signals: res.signals } : p,
      );
      await reload();
    });

  const refreshNews = () =>
    runAction('news', async () => {
      const res = await api.refreshNews();
      setSnapshot((p) => (p ? { ...p, news: res.news } : p));
    });

  const closePosition = (id: string) =>
    runAction(`close-${id}`, async () => {
      await api.closePosition(id);
      await reload();
    });

  const resetPaper = (balance: number) =>
    runAction('reset-paper', async () => {
      await api.resetPaper(balance);
      await reload();
    });

  const saveSettings = (payload: SettingsUpdatePayload) =>
    runAction('save-settings', async () => {
      const settings = await api.updateSettings(payload);
      setSnapshot((p) => (p ? { ...p, settings } : p));
      await reload();
    });

  return {
    snapshot,
    wsConnected,
    loading,
    error,
    clearError: () => setError(null),
    busyAction,
    reload,
    startBot,
    pauseBot,
    killSwitch,
    scanNow,
    refreshNews,
    closePosition,
    resetPaper,
    saveSettings,
  };
}
