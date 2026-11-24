import {
  DEFAULT_STRATEGY_CONFIG,
  STABLECOIN_SYMBOLS,
  type MarketTicker,
  type NewsItem,
  type ScannerCandidate,
  type StrategyConfig,
} from '@bot/shared';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Ranks eligible Binance USD-M Futures pairs by liquidity, intraday volatility sweet-spot,
 * funding skew, and fresh news catalyst intensity. Always ensures BTCUSDT is retained as benchmark.
 */
export function scanMarketCandidates(
  tickers: MarketTicker[],
  recentNews: NewsItem[],
  perpetualAllowlist: Set<string>,
  config: StrategyConfig = DEFAULT_STRATEGY_CONFIG,
  nowMs = Date.now(),
  realVolumeMap?: Map<string, { quoteVolume: number; priceChangePercent: number }>,
): ScannerCandidate[] {
  const freshCutoff = nowMs - 12 * 3_600_000;
  const newsBySymbol = new Map<string, { count: number; highImpact: boolean; maxAbsScore: number }>();

  for (const item of recentNews) {
    if (item.publishedAt < freshCutoff) continue;
    for (const sym of item.symbols) {
      if (sym === 'MARKET') continue;
      const prev = newsBySymbol.get(sym) ?? { count: 0, highImpact: false, maxAbsScore: 0 };
      prev.count += 1;
      if (item.impact === 'HIGH' || item.impact === 'CRITICAL') {
        prev.highImpact = true;
      }
      prev.maxAbsScore = Math.max(prev.maxAbsScore, Math.abs(item.score));
      newsBySymbol.set(sym, prev);
    }
  }

  const scored: ScannerCandidate[] = [];

  for (const t of tickers) {
    if (!t.symbol.endsWith('USDT')) continue;
    if (STABLECOIN_SYMBOLS.has(t.symbol)) continue;
    if (perpetualAllowlist.size > 0 && !perpetualAllowlist.has(t.symbol)) continue;
    if (t.lastPrice <= 0) continue;

    // Overlay real spot market volume when available (e.g. filtering out inflated testnet dummy pairs)
    const realMetric =
      realVolumeMap?.get(t.symbol) ??
      realVolumeMap?.get(t.symbol.replace(/^1000/, ''));
    const quoteVolume =
      realVolumeMap && realVolumeMap.size > 0
        ? (realMetric?.quoteVolume ?? 0)
        : t.quoteVolume24h;
    const priceChange = realMetric ? realMetric.priceChangePercent : t.priceChangePercent24h;

    const isBtc = t.symbol === 'BTCUSDT';
    if (!isBtc && quoteVolume < config.minVolume24hUsdt) continue;

    const intradayRangePct =
      t.low24h > 0 ? ((t.high24h - t.low24h) / t.low24h) * 100 : 0;

    // 1. Liquidity score (0..35): log10 scale from $20M to $5B
    const logVol = Math.log10(Math.max(quoteVolume, 1));
    const liquidityScore = clamp(((logVol - 7.0) / 2.7) * 35, 5, 35);

    // 2. Intraday volatility sweet-spot (0..35): 3%-14% ideal intraday movement
    let volatilityScore = 0;
    const absMove = Math.abs(priceChange);
    if (intradayRangePct >= 2.5 && intradayRangePct <= 16) {
      volatilityScore = 22 + Math.min(13, absMove * 1.4);
    } else if (intradayRangePct > 16) {
      // Penalize extreme blow-off spikes slightly to avoid liquidation wicks
      volatilityScore = 20;
    } else {
      volatilityScore = clamp(intradayRangePct * 7, 2, 18);
    }

    // 3. News catalyst boost (0..25)
    const newsStats = newsBySymbol.get(t.symbol);
    let catalystScore = 0;
    if (newsStats) {
      catalystScore = Math.min(
        25,
        newsStats.count * 5 + (newsStats.highImpact ? 10 : 0) + newsStats.maxAbsScore * 0.1,
      );
    }

    // 4. Funding opportunity skew (0..5)
    const fundingSkew = Math.min(5, Math.abs(t.fundingRate) * 5000);

    const scannerScore = Math.round(
      clamp(liquidityScore + volatilityScore + catalystScore + fundingSkew, 0, 100),
    );

    const reasons: string[] = [];
    reasons.push(`24h Vol $${(quoteVolume / 1_000_000).toFixed(1)}M`);
    reasons.push(`Range ${intradayRangePct.toFixed(1)}%`);
    if (newsStats?.count) {
      reasons.push(
        `${newsStats.count} active news${newsStats.highImpact ? ' (HIGH impact)' : ''}`,
      );
    }

    scored.push({
      symbol: t.symbol,
      lastPrice: t.lastPrice,
      markPrice: t.markPrice || t.lastPrice,
      priceChangePercent24h: priceChange,
      intradayRangePct,
      quoteVolume24h: quoteVolume,
      fundingRate: t.fundingRate,
      liquidityScore: Math.round(liquidityScore),
      volatilityScore: Math.round(volatilityScore),
      catalystScore: Math.round(catalystScore),
      scannerScore,
      activeNewsCount: newsStats?.count ?? 0,
      hasHighImpactNews: newsStats?.highImpact ?? false,
      reasons,
      updatedAt: t.updatedAt,
    });
  }

  scored.sort((a, b) => b.scannerScore - a.scannerScore);

  const top = scored.slice(0, config.scannerTopN);
  const btc = scored.find((c) => c.symbol === 'BTCUSDT');
  if (btc && !top.some((c) => c.symbol === 'BTCUSDT')) {
    if (top.length >= config.scannerTopN && top.length > 1) {
      top[top.length - 1] = btc;
    } else {
      top.push(btc);
    }
  }

  return top;
}
