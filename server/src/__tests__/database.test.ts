import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RISK_CONFIG,
  type NewsItem,
  type Position,
  type TradeRecord,
  type TradeSignal,
} from '@bot/shared';
import { BotDatabase } from '../db/database.js';

describe('BotDatabase (node:sqlite)', () => {
  it('seeds default configs and paper account on initialization', () => {
    const db = new BotDatabase(':memory:');
    const risk = db.getRiskConfig();
    const strategy = db.getStrategyConfig();
    const paper = db.getPaperAccount();

    expect(risk.defaultLeverage).toBe(DEFAULT_RISK_CONFIG.defaultLeverage);
    expect(strategy.minConfidence).toBe(72);
    expect(paper.balance).toBe(500);
    db.close();
  });

  it('persists and updates positions, trades, and daily metrics cleanly', () => {
    const db = new BotDatabase(':memory:');
    const now = Date.now();
    const pos: Position = {
      id: 'p-1',
      mode: 'PAPER',
      symbol: 'BTCUSDT',
      side: 'LONG',
      status: 'OPEN',
      entryPrice: 60000,
      markPrice: 60000,
      quantity: 0.05,
      remainingQuantity: 0.05,
      leverage: 3,
      isolatedMargin: 1000,
      stopLoss: 59000,
      takeProfit1: 61000,
      takeProfit2: 61800,
      takeProfit3: 63000,
      tp1Hit: false,
      tp2Hit: false,
      trailingActive: false,
      peakPrice: 60000,
      entryAtr: 400,
      liquidationPrice: 40300,
      unrealizedPnl: 0,
      realizedPnl: 0,
      feesPaid: 1.5,
      confidence: 82,
      entryReasons: ['4H & 1H uptrend'],
      closeReason: null,
      slOrderId: null,
      tpOrderId: null,
      openedAt: now,
      closedAt: null,
    };

    db.upsertPosition(pos);
    expect(db.getOpenPositions('PAPER')).toHaveLength(1);

    db.upsertPosition({
      ...pos,
      status: 'CLOSED',
      remainingQuantity: 0,
      realizedPnl: 140,
      tp1Hit: true,
      tp2Hit: true,
      closeReason: 'TP3 reached',
      closedAt: now + 5000,
    });
    expect(db.getOpenPositions('PAPER')).toHaveLength(0);
    expect(db.getClosedPositions('PAPER')[0]?.takeProfit3).toBe(63000);
    expect(db.getClosedPositions('PAPER')[0]?.tp2Hit).toBe(true);

    const trade: TradeRecord = {
      id: 't-1',
      positionId: 'p-1',
      mode: 'PAPER',
      symbol: 'BTCUSDT',
      side: 'LONG',
      action: 'CLOSE_TP3',
      price: 63000,
      quantity: 0.05,
      notional: 3150,
      fee: 1.57,
      realizedPnl: 140,
      reason: 'TP3 reached',
      exchangeOrderId: null,
      createdAt: now + 5000,
    };
    db.insertTrade(trade);

    const stats = db.getTradeStats('PAPER');
    expect(stats.totalTrades).toBe(1);
    expect(stats.winRatePct).toBe(100);
    db.close();
  });

  it('deduplicates news items by urlHash and persists signals & logs', () => {
    const db = new BotDatabase(':memory:');
    const now = Date.now();
    const item: NewsItem = {
      id: 'n-1',
      urlHash: 'abc123',
      source: 'CoinDesk',
      title: 'Ethereum upgrade hits testnet milestone',
      url: 'https://example.com/eth',
      publishedAt: now,
      symbols: ['ETHUSDT'],
      sentiment: 'BULLISH',
      score: 65,
      impact: 'HIGH',
      isBlackSwan: false,
      summary: 'Strong bullish catalyst for ETH.',
      analysisSource: 'LEXICON',
      createdAt: now,
    };

    expect(db.hasNewsHash('abc123')).toBe(false);
    db.insertNewsItems([item, item]);
    expect(db.hasNewsHash('abc123')).toBe(true);
    expect(db.getRecentNews(10)).toHaveLength(1);

    const sig: TradeSignal = {
      id: 's-1',
      symbol: 'ETHUSDT',
      action: 'LONG',
      regime: 'STRONG_TREND_UP',
      technicalScore: 70,
      newsScore: 65,
      compositeScore: 68,
      confidence: 80,
      entryPrice: 2200,
      stopLoss: 2150,
      takeProfit1: 2250,
      takeProfit2: 2290,
      takeProfit3: 2350,
      riskRewardRatio: 3.0,
      atr: 25,
      executed: true,
      emergencyCloseRequired: false,
      reasons: ['Aligned uptrend'],
      vetoReasons: [],
      createdAt: now,
    };
    db.insertSignal(sig);
    expect(db.getRecentSignals(10)).toHaveLength(1);

    db.addLog('INFO', 'Test', 'Booted ok', { ok: true });
    expect(db.getRecentLogs(10)[0]?.message).toBe('Booted ok');
    db.close();
  });

  it('migrates legacy 2-TP sqlite database schema and strategy_config to 3-TP Option B safely', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-db-mig-'));
    const dbPath = path.join(tmpDir, 'legacy.sqlite');
    const raw = new DatabaseSync(dbPath);
    const now = Date.now();
    raw.exec(`
      CREATE TABLE settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE paper_account (id INTEGER PRIMARY KEY CHECK (id = 1), balance REAL NOT NULL, starting_day_equity REAL NOT NULL, day_key TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE positions (
        id TEXT PRIMARY KEY, mode TEXT NOT NULL, symbol TEXT NOT NULL, side TEXT NOT NULL, status TEXT NOT NULL,
        entry_price REAL NOT NULL, mark_price REAL NOT NULL, quantity REAL NOT NULL, remaining_quantity REAL NOT NULL,
        leverage INTEGER NOT NULL, isolated_margin REAL NOT NULL, stop_loss REAL NOT NULL,
        take_profit_1 REAL NOT NULL, take_profit_2 REAL NOT NULL, tp1_hit INTEGER NOT NULL DEFAULT 0,
        trailing_active INTEGER NOT NULL DEFAULT 0, peak_price REAL NOT NULL, entry_atr REAL NOT NULL,
        liquidation_price REAL NOT NULL, unrealized_pnl REAL NOT NULL DEFAULT 0, realized_pnl REAL NOT NULL DEFAULT 0,
        fees_paid REAL NOT NULL DEFAULT 0, confidence REAL NOT NULL, entry_reasons_json TEXT NOT NULL,
        close_reason TEXT, sl_order_id TEXT, tp_order_id TEXT, opened_at INTEGER NOT NULL, closed_at INTEGER
      );
      CREATE TABLE signals (
        id TEXT PRIMARY KEY, symbol TEXT NOT NULL, action TEXT NOT NULL, regime TEXT NOT NULL,
        technical_score REAL NOT NULL, news_score REAL NOT NULL, composite_score REAL NOT NULL,
        confidence REAL NOT NULL, entry_price REAL NOT NULL, stop_loss REAL NOT NULL,
        take_profit_1 REAL NOT NULL, take_profit_2 REAL NOT NULL, risk_reward REAL NOT NULL,
        executed INTEGER NOT NULL DEFAULT 0, reasons_json TEXT NOT NULL, veto_reasons_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    raw
      .prepare('INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)')
      .run(
        'strategy_config',
        JSON.stringify({ tp1RiskReward: 1.5, tp2RiskReward: 2.8, minConfidence: 72 }),
        now,
      );
    raw
      .prepare(
        `INSERT INTO positions (
          id, mode, symbol, side, status, entry_price, mark_price, quantity, remaining_quantity,
          leverage, isolated_margin, stop_loss, take_profit_1, take_profit_2, tp1_hit,
          trailing_active, peak_price, entry_atr, liquidation_price, unrealized_pnl, realized_pnl,
          fees_paid, confidence, entry_reasons_json, close_reason, sl_order_id, tp_order_id, opened_at, closed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'legacy-1', 'TESTNET', 'SOLUSDT', 'SHORT', 'CLOSED', 75, 70, 2, 0,
        3, 0, 77, 72, 69.4, 1, 0, 70, 1.2, 99, 0, 3.5, 0.2, 80, '["legacy"]', 'Closed',
        null, null, now - 5000, now,
      );
    raw.close();

    let migrated: BotDatabase | null = null;
    try {
      migrated = new BotDatabase(dbPath);
      const strat = migrated.getStrategyConfig();
      expect(strat.tp1RiskReward).toBe(1.0);
      expect(strat.tp2RiskReward).toBe(1.8);
      expect(strat.tp3RiskReward).toBe(3.0);
      expect(strat.tp1ClosePct).toBe(50);
      expect(strat.tp2ClosePct).toBe(30);

      const closed = migrated.getClosedPositions('TESTNET');
      expect(closed).toHaveLength(1);
      expect(closed[0]?.takeProfit3).toBe(69.4);
      expect(closed[0]?.tp2Hit).toBe(false);
    } finally {
      migrated?.close();
      fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  });
});
