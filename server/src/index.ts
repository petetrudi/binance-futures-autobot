import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import type { TradingMode, WsMessage } from '@bot/shared';
import { createApiRouter } from './api/routes.js';
import { BotDatabase } from './db/database.js';
import { BotOrchestrator } from './engine/botOrchestrator.js';
import { BinanceFuturesClient } from './market/binanceClient.js';
import { MarketStream } from './market/marketStream.js';
import { TelegramNotifier } from './notifications/telegramNotifier.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../..');

dotenv.config({ path: path.join(rootDir, '.env') });
dotenv.config();

const PORT = Number(process.env.PORT || 4000);
const envModeRaw = (process.env.TRADING_MODE || '').toUpperCase();
const envModeOverride: TradingMode | undefined =
  envModeRaw === 'PAPER' || envModeRaw === 'TESTNET' || envModeRaw === 'LIVE'
    ? (envModeRaw as TradingMode)
    : undefined;

const dbPath = path.join(rootDir, 'data', 'bot.sqlite');
const db = new BotDatabase(dbPath);

const initialMode = envModeOverride ?? db.getTradingMode();
const fapiBaseUrl = process.env.BINANCE_FAPI_BASE_URL ?? '';
const fwsBaseUrl = process.env.BINANCE_FWS_BASE_URL ?? '';

const binanceClient = new BinanceFuturesClient({
  mode: initialMode,
  apiKey: process.env.BINANCE_API_KEY ?? '',
  apiSecret: process.env.BINANCE_API_SECRET ?? '',
  fapiBaseUrl,
});

const marketStream = new MarketStream(initialMode, fwsBaseUrl, binanceClient);
const telegram = new TelegramNotifier(
  process.env.TELEGRAM_BOT_TOKEN ?? '',
  process.env.TELEGRAM_CHAT_ID ?? '',
);

const orchestrator = new BotOrchestrator(
  db,
  binanceClient,
  marketStream,
  telegram,
  {
    binanceApiKey: process.env.BINANCE_API_KEY ?? '',
    binanceApiSecret: process.env.BINANCE_API_SECRET ?? '',
    binanceFapiBaseUrl: fapiBaseUrl,
    binanceFwsBaseUrl: fwsBaseUrl,
    geminiApiKey: process.env.GEMINI_API_KEY ?? '',
    cryptoPanicApiKey: process.env.CRYPTOPANIC_API_KEY ?? '',
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
    telegramChatId: process.env.TELEGRAM_CHAT_ID ?? '',
  },
  envModeOverride,
  process.env.LIVE_TRADING_CONFIRMED === 'true',
);

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use('/api', createApiRouter(orchestrator, db));

// Serve built web frontend in production if present
const webDistDir = path.join(rootDir, 'web', 'dist');
if (fs.existsSync(webDistDir)) {
  app.use(express.static(webDistDir));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/ws')) {
      next();
      return;
    }
    res.sendFile(path.join(webDistDir, 'index.html'));
  });
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(msg: WsMessage): void {
  const payload = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

wss.on('connection', (ws) => {
  void (async () => {
    try {
      const snapshot = await orchestrator.getDashboardSnapshot();
      if (ws.readyState === WebSocket.OPEN) {
        const msg: WsMessage = { type: 'snapshot', data: snapshot };
        ws.send(JSON.stringify(msg));
      }
    } catch {
      // Ignore transient snapshot error on immediate disconnect
    }
  })();
});

orchestrator.on('tick', (data) => broadcast({ type: 'tick', data }));
orchestrator.on('scanner', (data) => broadcast({ type: 'scanner', data }));
orchestrator.on('news', (data) => broadcast({ type: 'news', data }));
orchestrator.on('log', (data) => broadcast({ type: 'log', data }));

server.listen(PORT, () => {
  console.log(`[Server] Binance Futures AutoBot listening on http://localhost:${PORT}`);
  void orchestrator.startEngine();
});

async function gracefulShutdown(): Promise<void> {
  console.log('\n[Server] Shutting down...');
  wss.close();
  server.close();
  await orchestrator.shutdown();
  process.exit(0);
}

process.on('SIGINT', () => void gracefulShutdown());
process.on('SIGTERM', () => void gracefulShutdown());
