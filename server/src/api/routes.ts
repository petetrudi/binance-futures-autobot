import { Router, type Request, type Response } from 'express';
import type {
  BacktestRequest,
  SettingsUpdatePayload,
  Timeframe,
} from '@bot/shared';
import type { BotDatabase } from '../db/database.js';
import type { BotOrchestrator } from '../engine/botOrchestrator.js';

export function createApiRouter(
  orchestrator: BotOrchestrator,
  db: BotDatabase,
): Router {
  const router = Router();

  router.get('/health', (_req: Request, res: Response) => {
    const status = orchestrator.getBotStatus();
    res.json({
      ok: true,
      db: 'connected',
      ...status,
    });
  });

  router.get('/dashboard', async (_req: Request, res: Response) => {
    try {
      const snapshot = await orchestrator.getDashboardSnapshot();
      res.json(snapshot);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to build dashboard snapshot',
      });
    }
  });

  router.get('/candles/:symbol', async (req: Request, res: Response) => {
    try {
      const symbol = String(req.params.symbol || 'BTCUSDT');
      const rawInterval = String(req.query.interval || '15m');
      const interval: Timeframe = (
        ['5m', '15m', '1h', '4h'].includes(rawInterval) ? rawInterval : '15m'
      ) as Timeframe;
      const limit = Math.min(Math.max(Number(req.query.limit) || 200, 50), 500);
      const data = await orchestrator.getChartData(symbol, interval, limit);
      res.json(data);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to fetch candles',
      });
    }
  });

  router.post('/bot/start', (_req: Request, res: Response) => {
    res.json({ status: orchestrator.startAutoTrading() });
  });

  router.post('/bot/pause', (_req: Request, res: Response) => {
    res.json({ status: orchestrator.pauseAutoTrading() });
  });

  router.post('/bot/kill-switch', async (_req: Request, res: Response) => {
    try {
      const snapshot = await orchestrator.activateKillSwitch();
      res.json(snapshot);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Kill switch failed',
      });
    }
  });

  router.post('/scanner/run', async (_req: Request, res: Response) => {
    try {
      const result = await orchestrator.runScannerCycle();
      res.json(result);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Scanner cycle failed',
      });
    }
  });

  router.post('/news/refresh', async (_req: Request, res: Response) => {
    try {
      const news = await orchestrator.refreshNews();
      res.json({ news });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'News refresh failed',
      });
    }
  });

  router.post('/positions/:id/close', async (req: Request, res: Response) => {
    try {
      const closed = await orchestrator.manualClosePosition(String(req.params.id));
      res.json({ position: closed });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to close position',
      });
    }
  });

  router.post('/paper/reset', (req: Request, res: Response) => {
    try {
      const balance = Number(req.body?.balance ?? 10_000);
      const account = orchestrator.resetPaperAccount(balance);
      res.json({ account });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Paper reset failed',
      });
    }
  });

  router.post('/backtest/run', async (req: Request, res: Response) => {
    try {
      const payload: BacktestRequest = {
        symbol: String(req.body?.symbol || 'BTCUSDT').toUpperCase(),
        interval: req.body?.interval === '1h' ? '1h' : '15m',
        bars: Number(req.body?.bars || 350),
        initialCapital: Number(req.body?.initialCapital || 10_000),
        leverage: Number(req.body?.leverage || 3),
        riskPerTradePct: Number(req.body?.riskPerTradePct || 1.5),
        minConfidence: Number(req.body?.minConfidence || 62),
      };
      const result = await orchestrator.runBacktest(payload);
      res.json(result);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Backtest failed',
      });
    }
  });

  router.get('/trades', (req: Request, res: Response) => {
    const mode = orchestrator.getBotStatus().mode;
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    res.json({ trades: db.getRecentTrades(mode, limit) });
  });

  router.get('/signals', (req: Request, res: Response) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 300);
    res.json({ signals: db.getRecentSignals(limit) });
  });

  router.get('/news', (req: Request, res: Response) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 60, 1), 200);
    res.json({ news: db.getRecentNews(limit) });
  });

  router.get('/logs', (req: Request, res: Response) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 300);
    res.json({ logs: db.getRecentLogs(limit) });
  });

  router.get('/settings', (_req: Request, res: Response) => {
    res.json(orchestrator.getSettingsView());
  });

  router.put('/settings', async (req: Request, res: Response) => {
    try {
      const payload = (req.body ?? {}) as SettingsUpdatePayload;
      const updated = await orchestrator.updateSettings(payload);
      res.json(updated);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to update settings',
      });
    }
  });

  return router;
}
