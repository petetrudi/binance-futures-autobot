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
    expect(strategy.minConfidence).toBe(65);
    expect(paper.balance).toBe(10_000);
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
      takeProfit1: 61500,
      takeProfit2: 62800,
      tp1Hit: false,
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
      closeReason: 'TP2 reached',
      closedAt: now + 5000,
    });
    expect(db.getOpenPositions('PAPER')).toHaveLength(0);

    const trade: TradeRecord = {
      id: 't-1',
      positionId: 'p-1',
      mode: 'PAPER',
      symbol: 'BTCUSDT',
      side: 'LONG',
      action: 'CLOSE_TP2',
      price: 62800,
      quantity: 0.05,
      notional: 3140,
      fee: 1.57,
      realizedPnl: 140,
      reason: 'TP2 reached',
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
      takeProfit1: 2275,
      takeProfit2: 2340,
      riskRewardRatio: 2.8,
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
});
