import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_RISK_CONFIG,
  DEFAULT_STRATEGY_CONFIG,
  type LogLevel,
  type NewsItem,
  type Position,
  type RiskConfig,
  type StrategyConfig,
  type SystemLog,
  type TradeAction,
  type TradeRecord,
  type TradeSignal,
  type TradingMode,
} from '@bot/shared';

export interface PaperAccountRow {
  balance: number;
  startingDayEquity: number;
  dayKey: string;
  updatedAt: number;
}

function utcDayKey(ts = Date.now()): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export class BotDatabase {
  private readonly db: DatabaseSync;

  constructor(dbPath = path.resolve(process.cwd(), '..', 'data', 'bot.sqlite')) {
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.initSchema();
    this.seedDefaults();
  }

  private initSchema(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS paper_account (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        balance REAL NOT NULL,
        starting_day_equity REAL NOT NULL,
        day_key TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS positions (
        id TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        status TEXT NOT NULL,
        entry_price REAL NOT NULL,
        mark_price REAL NOT NULL,
        quantity REAL NOT NULL,
        remaining_quantity REAL NOT NULL,
        leverage INTEGER NOT NULL,
        isolated_margin REAL NOT NULL,
        stop_loss REAL NOT NULL,
        take_profit_1 REAL NOT NULL,
        take_profit_2 REAL NOT NULL,
        tp1_hit INTEGER NOT NULL DEFAULT 0,
        trailing_active INTEGER NOT NULL DEFAULT 0,
        peak_price REAL NOT NULL,
        entry_atr REAL NOT NULL,
        liquidation_price REAL NOT NULL,
        unrealized_pnl REAL NOT NULL DEFAULT 0,
        realized_pnl REAL NOT NULL DEFAULT 0,
        fees_paid REAL NOT NULL DEFAULT 0,
        confidence REAL NOT NULL,
        entry_reasons_json TEXT NOT NULL,
        close_reason TEXT,
        sl_order_id TEXT,
        tp_order_id TEXT,
        opened_at INTEGER NOT NULL,
        closed_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_positions_mode_status ON positions (mode, status);

      CREATE TABLE IF NOT EXISTS trades (
        id TEXT PRIMARY KEY,
        position_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        action TEXT NOT NULL,
        price REAL NOT NULL,
        quantity REAL NOT NULL,
        notional REAL NOT NULL,
        fee REAL NOT NULL,
        realized_pnl REAL NOT NULL,
        reason TEXT NOT NULL,
        exchange_order_id TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_trades_mode_time ON trades (mode, created_at DESC);

      CREATE TABLE IF NOT EXISTS signals (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        action TEXT NOT NULL,
        regime TEXT NOT NULL,
        technical_score REAL NOT NULL,
        news_score REAL NOT NULL,
        composite_score REAL NOT NULL,
        confidence REAL NOT NULL,
        entry_price REAL NOT NULL,
        stop_loss REAL NOT NULL,
        take_profit_1 REAL NOT NULL,
        take_profit_2 REAL NOT NULL,
        risk_reward REAL NOT NULL,
        executed INTEGER NOT NULL DEFAULT 0,
        reasons_json TEXT NOT NULL,
        veto_reasons_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_signals_time ON signals (created_at DESC);

      CREATE TABLE IF NOT EXISTS news_items (
        id TEXT PRIMARY KEY,
        url_hash TEXT UNIQUE NOT NULL,
        source TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        published_at INTEGER NOT NULL,
        symbols_json TEXT NOT NULL,
        sentiment TEXT NOT NULL,
        score REAL NOT NULL,
        impact TEXT NOT NULL,
        is_black_swan INTEGER NOT NULL DEFAULT 0,
        summary TEXT NOT NULL,
        analysis_source TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_news_published ON news_items (published_at DESC);

      CREATE TABLE IF NOT EXISTS system_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        level TEXT NOT NULL,
        module TEXT NOT NULL,
        message TEXT NOT NULL,
        meta_json TEXT,
        created_at INTEGER NOT NULL
      );
    `);
  }

  private seedDefaults(): void {
    const now = Date.now();
    this.ensureSetting('risk_config', DEFAULT_RISK_CONFIG, now);
    this.ensureSetting('strategy_config', DEFAULT_STRATEGY_CONFIG, now);
    this.ensureSetting('trading_mode', 'PAPER' as TradingMode, now);

    // Auto-migrate legacy aggressive settings to conservative low-risk defaults
    const currentRisk = this.getSetting<Partial<RiskConfig>>('risk_config', {});
    if (
      currentRisk.maxMarginPerTradePct === undefined ||
      currentRisk.maxMarginPerTradePct > 12 ||
      !currentRisk.maxAccountCapitalUsdt
    ) {
      this.saveRiskConfig({
        ...DEFAULT_RISK_CONFIG,
        ...currentRisk,
        defaultLeverage: Math.min(currentRisk.defaultLeverage ?? 2, 3),
        riskPerTradePct: Math.min(currentRisk.riskPerTradePct ?? 0.75, 1.0),
        maxMarginPerTradePct: 10,
        maxConcurrentPositions: Math.min(currentRisk.maxConcurrentPositions ?? 2, 2),
        maxDailyLossPct: Math.min(currentRisk.maxDailyLossPct ?? 3, 3),
        maxAccountCapitalUsdt: currentRisk.maxAccountCapitalUsdt ?? 500,
      });
    }

    const currentStrat = this.getSetting<Partial<StrategyConfig>>('strategy_config', {});
    if (currentStrat.minConfidence === undefined || currentStrat.minConfidence < 70) {
      this.saveStrategyConfig({
        ...DEFAULT_STRATEGY_CONFIG,
        ...currentStrat,
        minConfidence: 72,
      });
    }

    const existingPaper = this.db
      .prepare('SELECT id, balance FROM paper_account WHERE id = 1')
      .get() as { id: number; balance: number } | undefined;
    if (!existingPaper) {
      this.db
        .prepare(
          'INSERT INTO paper_account (id, balance, starting_day_equity, day_key, updated_at) VALUES (1, ?, ?, ?, ?)',
        )
        .run(500, 500, utcDayKey(now), now);
    } else if (existingPaper.balance === 10_000) {
      this.db
        .prepare(
          'UPDATE paper_account SET balance = 500, starting_day_equity = 500 WHERE id = 1',
        )
        .run();
    }
  }

  private ensureSetting<T>(key: string, value: T, now: number): void {
    const row = this.db
      .prepare('SELECT key FROM settings WHERE key = ?')
      .get(key);
    if (!row) {
      this.db
        .prepare(
          'INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)',
        )
        .run(key, JSON.stringify(value), now);
    }
  }

  private getSetting<T>(key: string, fallback: T): T {
    const row = this.db
      .prepare('SELECT value_json FROM settings WHERE key = ?')
      .get(key) as { value_json: string } | undefined;
    return row ? safeJsonParse<T>(row.value_json, fallback) : fallback;
  }

  private setSetting<T>(key: string, value: T): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run(key, JSON.stringify(value), Date.now());
  }

  getRiskConfig(): RiskConfig {
    return {
      ...DEFAULT_RISK_CONFIG,
      ...this.getSetting<Partial<RiskConfig>>('risk_config', DEFAULT_RISK_CONFIG),
    };
  }

  saveRiskConfig(config: RiskConfig): void {
    this.setSetting('risk_config', config);
  }

  getStrategyConfig(): StrategyConfig {
    return {
      ...DEFAULT_STRATEGY_CONFIG,
      ...this.getSetting<Partial<StrategyConfig>>(
        'strategy_config',
        DEFAULT_STRATEGY_CONFIG,
      ),
    };
  }

  saveStrategyConfig(config: StrategyConfig): void {
    this.setSetting('strategy_config', config);
  }

  getTradingMode(): TradingMode {
    return this.getSetting<TradingMode>('trading_mode', 'PAPER');
  }

  saveTradingMode(mode: TradingMode): void {
    this.setSetting('trading_mode', mode);
  }

  getPaperAccount(): PaperAccountRow {
    const row = this.db
      .prepare(
        'SELECT balance, starting_day_equity, day_key, updated_at FROM paper_account WHERE id = 1',
      )
      .get() as {
      balance: number;
      starting_day_equity: number;
      day_key: string;
      updated_at: number;
    };
    return {
      balance: row.balance,
      startingDayEquity: row.starting_day_equity,
      dayKey: row.day_key,
      updatedAt: row.updated_at,
    };
  }

  updatePaperAccount(
    balance: number,
    startingDayEquity?: number,
    dayKey = utcDayKey(),
  ): void {
    const current = this.getPaperAccount();
    this.db
      .prepare(
        'UPDATE paper_account SET balance = ?, starting_day_equity = ?, day_key = ?, updated_at = ? WHERE id = 1',
      )
      .run(
        balance,
        startingDayEquity ?? current.startingDayEquity,
        dayKey,
        Date.now(),
      );
  }

  resetPaperAccount(initialBalance = 10_000): void {
    const now = Date.now();
    this.db
      .prepare(
        "UPDATE positions SET status = 'CLOSED', close_reason = 'Paper account reset', closed_at = ? WHERE mode = 'PAPER' AND status = 'OPEN'",
      )
      .run(now);
    this.db
      .prepare(
        'UPDATE paper_account SET balance = ?, starting_day_equity = ?, day_key = ?, updated_at = ? WHERE id = 1',
      )
      .run(initialBalance, initialBalance, utcDayKey(now), now);
  }

  private mapPositionRow(row: Record<string, unknown>): Position {
    return {
      id: String(row.id),
      mode: row.mode as TradingMode,
      symbol: String(row.symbol),
      side: row.side as 'LONG' | 'SHORT',
      status: row.status as 'OPEN' | 'CLOSED',
      entryPrice: Number(row.entry_price),
      markPrice: Number(row.mark_price),
      quantity: Number(row.quantity),
      remainingQuantity: Number(row.remaining_quantity),
      leverage: Number(row.leverage),
      isolatedMargin: Number(row.isolated_margin),
      stopLoss: Number(row.stop_loss),
      takeProfit1: Number(row.take_profit_1),
      takeProfit2: Number(row.take_profit_2),
      tp1Hit: Number(row.tp1_hit) === 1,
      trailingActive: Number(row.trailing_active) === 1,
      peakPrice: Number(row.peak_price),
      entryAtr: Number(row.entry_atr),
      liquidationPrice: Number(row.liquidation_price),
      unrealizedPnl: Number(row.unrealized_pnl),
      realizedPnl: Number(row.realized_pnl),
      feesPaid: Number(row.fees_paid),
      confidence: Number(row.confidence),
      entryReasons: safeJsonParse<string[]>(
        row.entry_reasons_json as string,
        [],
      ),
      closeReason: (row.close_reason as string | null) ?? null,
      slOrderId: (row.sl_order_id as string | null) ?? null,
      tpOrderId: (row.tp_order_id as string | null) ?? null,
      openedAt: Number(row.opened_at),
      closedAt: row.closed_at !== null ? Number(row.closed_at) : null,
    };
  }

  upsertPosition(pos: Position): void {
    this.db
      .prepare(
        `INSERT INTO positions (
          id, mode, symbol, side, status, entry_price, mark_price, quantity, remaining_quantity,
          leverage, isolated_margin, stop_loss, take_profit_1, take_profit_2, tp1_hit,
          trailing_active, peak_price, entry_atr, liquidation_price, unrealized_pnl,
          realized_pnl, fees_paid, confidence, entry_reasons_json, close_reason,
          sl_order_id, tp_order_id, opened_at, closed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          mark_price = excluded.mark_price,
          remaining_quantity = excluded.remaining_quantity,
          isolated_margin = excluded.isolated_margin,
          stop_loss = excluded.stop_loss,
          tp1_hit = excluded.tp1_hit,
          trailing_active = excluded.trailing_active,
          peak_price = excluded.peak_price,
          unrealized_pnl = excluded.unrealized_pnl,
          realized_pnl = excluded.realized_pnl,
          fees_paid = excluded.fees_paid,
          close_reason = excluded.close_reason,
          sl_order_id = excluded.sl_order_id,
          tp_order_id = excluded.tp_order_id,
          closed_at = excluded.closed_at`,
      )
      .run(
        pos.id,
        pos.mode,
        pos.symbol,
        pos.side,
        pos.status,
        pos.entryPrice,
        pos.markPrice,
        pos.quantity,
        pos.remainingQuantity,
        pos.leverage,
        pos.isolatedMargin,
        pos.stopLoss,
        pos.takeProfit1,
        pos.takeProfit2,
        pos.tp1Hit ? 1 : 0,
        pos.trailingActive ? 1 : 0,
        pos.peakPrice,
        pos.entryAtr,
        pos.liquidationPrice,
        pos.unrealizedPnl,
        pos.realizedPnl,
        pos.feesPaid,
        pos.confidence,
        JSON.stringify(pos.entryReasons ?? []),
        pos.closeReason ?? null,
        pos.slOrderId ?? null,
        pos.tpOrderId ?? null,
        pos.openedAt,
        pos.closedAt ?? null,
      );
  }

  getOpenPositions(mode: TradingMode): Position[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM positions WHERE mode = ? AND status = 'OPEN' ORDER BY opened_at DESC",
      )
      .all(mode) as Record<string, unknown>[];
    return rows.map((r) => this.mapPositionRow(r));
  }

  getPositionById(id: string): Position | null {
    const row = this.db
      .prepare('SELECT * FROM positions WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.mapPositionRow(row) : null;
  }

  getRecentClosedSymbolTimes(mode: TradingMode): Map<string, number> {
    const rows = this.db
      .prepare(
        "SELECT symbol, MAX(closed_at) as last_closed FROM positions WHERE mode = ? AND status = 'CLOSED' AND closed_at IS NOT NULL GROUP BY symbol",
      )
      .all(mode) as Array<{ symbol: string; last_closed: number }>;
    const map = new Map<string, number>();
    for (const r of rows) {
      map.set(r.symbol, Number(r.last_closed));
    }
    return map;
  }

  insertTrade(trade: TradeRecord): void {
    this.db
      .prepare(
        `INSERT INTO trades (
          id, position_id, mode, symbol, side, action, price, quantity, notional,
          fee, realized_pnl, reason, exchange_order_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        trade.id,
        trade.positionId,
        trade.mode,
        trade.symbol,
        trade.side,
        trade.action,
        trade.price,
        trade.quantity,
        trade.notional,
        trade.fee,
        trade.realizedPnl,
        trade.reason,
        trade.exchangeOrderId ?? null,
        trade.createdAt,
      );
  }

  getRecentTrades(mode: TradingMode, limit = 100): TradeRecord[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM trades WHERE mode = ? ORDER BY created_at DESC LIMIT ?',
      )
      .all(mode, limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      positionId: String(r.position_id),
      mode: r.mode as TradingMode,
      symbol: String(r.symbol),
      side: r.side as 'LONG' | 'SHORT',
      action: r.action as TradeAction,
      price: Number(r.price),
      quantity: Number(r.quantity),
      notional: Number(r.notional),
      fee: Number(r.fee),
      realizedPnl: Number(r.realized_pnl),
      reason: String(r.reason),
      exchangeOrderId: (r.exchange_order_id as string | null) ?? null,
      createdAt: Number(r.created_at),
    }));
  }

  getTradeStats(mode: TradingMode): {
    totalTrades: number;
    winRatePct: number;
    profitFactor: number;
  } {
    const rows = this.db
      .prepare(
        "SELECT realized_pnl FROM trades WHERE mode = ? AND action != 'OPEN'",
      )
      .all(mode) as Array<{ realized_pnl: number }>;
    if (rows.length === 0) {
      return { totalTrades: 0, winRatePct: 0, profitFactor: 0 };
    }
    let wins = 0;
    let grossWin = 0;
    let grossLoss = 0;
    for (const r of rows) {
      const pnl = Number(r.realized_pnl);
      if (pnl > 0) {
        wins++;
        grossWin += pnl;
      } else if (pnl < 0) {
        grossLoss += Math.abs(pnl);
      }
    }
    const winRatePct = (wins / rows.length) * 100;
    const profitFactor =
      grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : 0;
    return {
      totalTrades: rows.length,
      winRatePct,
      profitFactor,
    };
  }

  insertSignal(signal: TradeSignal): void {
    this.db
      .prepare(
        `INSERT INTO signals (
          id, symbol, action, regime, technical_score, news_score, composite_score,
          confidence, entry_price, stop_loss, take_profit_1, take_profit_2,
          risk_reward, executed, reasons_json, veto_reasons_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        signal.id,
        signal.symbol,
        signal.action,
        signal.regime,
        signal.technicalScore,
        signal.newsScore,
        signal.compositeScore,
        signal.confidence,
        signal.entryPrice,
        signal.stopLoss,
        signal.takeProfit1,
        signal.takeProfit2,
        signal.riskRewardRatio,
        signal.executed ? 1 : 0,
        JSON.stringify(signal.reasons ?? []),
        JSON.stringify(signal.vetoReasons ?? []),
        signal.createdAt,
      );
  }

  getRecentSignals(limit = 50): TradeSignal[] {
    const rows = this.db
      .prepare('SELECT * FROM signals ORDER BY created_at DESC LIMIT ?')
      .all(limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      symbol: String(r.symbol),
      action: r.action as TradeSignal['action'],
      regime: r.regime as TradeSignal['regime'],
      technicalScore: Number(r.technical_score),
      newsScore: Number(r.news_score),
      compositeScore: Number(r.composite_score),
      confidence: Number(r.confidence),
      entryPrice: Number(r.entry_price),
      stopLoss: Number(r.stop_loss),
      takeProfit1: Number(r.take_profit_1),
      takeProfit2: Number(r.take_profit_2),
      riskRewardRatio: Number(r.risk_reward),
      atr: 0,
      executed: Number(r.executed) === 1,
      emergencyCloseRequired: false,
      reasons: safeJsonParse<string[]>(r.reasons_json as string, []),
      vetoReasons: safeJsonParse<string[]>(r.veto_reasons_json as string, []),
      createdAt: Number(r.created_at),
    }));
  }

  hasNewsHash(urlHash: string): boolean {
    const row = this.db
      .prepare('SELECT id FROM news_items WHERE url_hash = ?')
      .get(urlHash);
    return Boolean(row);
  }

  insertNewsItems(items: NewsItem[]): number {
    if (items.length === 0) return 0;
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO news_items (
        id, url_hash, source, title, url, published_at, symbols_json,
        sentiment, score, impact, is_black_swan, summary, analysis_source, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    let inserted = 0;
    for (const item of items) {
      const res = stmt.run(
        item.id,
        item.urlHash,
        item.source,
        item.title,
        item.url,
        item.publishedAt,
        JSON.stringify(item.symbols ?? []),
        item.sentiment,
        item.score,
        item.impact,
        item.isBlackSwan ? 1 : 0,
        item.summary,
        item.analysisSource,
        item.createdAt,
      );
      inserted += Number(res.changes ?? 0);
    }
    return inserted;
  }

  getRecentNews(limit = 60, sinceMs?: number): NewsItem[] {
    const rows = sinceMs
      ? (this.db
          .prepare(
            'SELECT * FROM news_items WHERE published_at >= ? ORDER BY published_at DESC LIMIT ?',
          )
          .all(sinceMs, limit) as Record<string, unknown>[])
      : (this.db
          .prepare(
            'SELECT * FROM news_items ORDER BY published_at DESC LIMIT ?',
          )
          .all(limit) as Record<string, unknown>[]);

    return rows.map((r) => ({
      id: String(r.id),
      urlHash: String(r.url_hash),
      source: String(r.source),
      title: String(r.title),
      url: String(r.url),
      publishedAt: Number(r.published_at),
      symbols: safeJsonParse<string[]>(r.symbols_json as string, []),
      sentiment: r.sentiment as NewsItem['sentiment'],
      score: Number(r.score),
      impact: r.impact as NewsItem['impact'],
      isBlackSwan: Number(r.is_black_swan) === 1,
      summary: String(r.summary),
      analysisSource: r.analysis_source as NewsItem['analysisSource'],
      createdAt: Number(r.created_at),
    }));
  }

  addLog(
    level: LogLevel,
    module: string,
    message: string,
    meta: Record<string, unknown> | null = null,
  ): SystemLog {
    const createdAt = Date.now();
    const metaJson = meta ? JSON.stringify(meta) : null;
    const res = this.db
      .prepare(
        'INSERT INTO system_logs (level, module, message, meta_json, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(level, module, message, metaJson, createdAt);

    return {
      id: Number(res.lastInsertRowid),
      level,
      module,
      message,
      meta,
      createdAt,
    };
  }

  getRecentLogs(limit = 100): SystemLog[] {
    const rows = this.db
      .prepare('SELECT * FROM system_logs ORDER BY id DESC LIMIT ?')
      .all(limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: Number(r.id),
      level: r.level as LogLevel,
      module: String(r.module),
      message: String(r.message),
      meta: r.meta_json
        ? safeJsonParse<Record<string, unknown>>(r.meta_json as string, {})
        : null,
      createdAt: Number(r.created_at),
    }));
  }

  close(): void {
    this.db.close();
  }
}
