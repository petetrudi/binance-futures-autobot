import { describe, expect, it, vi } from 'vitest';
import type { NewsItem } from '@bot/shared';
import { detectAffectedSymbols, parseRssFeedXml } from '../news/newsFetcher.js';
import {
  analyzeArticleLexicon,
  analyzeArticlesBatch,
  getCoinNewsContext,
} from '../news/sentimentAnalyzer.js';

describe('News fetcher and sentiment intelligence', () => {
  it('parses RSS XML with CDATA and strips HTML cleanly', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0"><channel>
      <item>
        <title><![CDATA[Solana ETF inflows surge to record high]]></title>
        <link>https://example.com/sol-etf</link>
        <pubDate>Tue, 24 Nov 2026 05:30:00 GMT</pubDate>
        <description><![CDATA[<p>Institutional demand for <b>SOL</b> accelerates.</p>]]></description>
      </item>
    </channel></rss>`;

    const parsed = parseRssFeedXml(xml, 'CoinTelegraph');
    expect(parsed).toHaveLength(1);
    expect(parsed[0].title).toBe('Solana ETF inflows surge to record high');
    expect(parsed[0].summarySourceText).toContain('Institutional demand for SOL accelerates.');
    expect(parsed[0].url).toBe('https://example.com/sol-etf');
  });

  it('detects coin symbols and macro MARKET keywords accurately', () => {
    expect(detectAffectedSymbols('Bitcoin and Ethereum rally as Fed hints rate cut')).toEqual(
      expect.arrayContaining(['BTCUSDT', 'ETHUSDT', 'MARKET']),
    );
    expect(detectAffectedSymbols('Pepe memecoin breaks out on Binance')).toContain('1000PEPEUSDT');
    expect(detectAffectedSymbols('Solana DeFi TVL surges')).toContain('SOLUSDT');
  });

  it('classifies bullish, bearish, negated, and Black Swan headlines in lexicon analyzer', () => {
    const bull = analyzeArticleLexicon(
      'Bitcoin ETF approval sparks massive institutional inflows and rally',
      '',
    );
    expect(bull.sentiment).toBe('BULLISH');
    expect(bull.score).toBeGreaterThan(35);
    expect(bull.isBlackSwan).toBe(false);

    const blackSwan = analyzeArticleLexicon(
      'Major protocol suffers $120M exploit and hack; Binance announces delisting',
      '',
    );
    expect(blackSwan.sentiment).toBe('BEARISH');
    expect(blackSwan.isBlackSwan).toBe(true);
    expect(blackSwan.impact).toBe('CRITICAL');

    const negated = analyzeArticleLexicon(
      'Binance denies rumors: exchange was not hacked and funds remain safe',
      '',
    );
    expect(negated.isBlackSwan).toBe(false);
  });

  it('aggregates coin-specific and macro news with exponential time decay', () => {
    const now = Date.now();
    const items: NewsItem[] = [
      {
        id: '1',
        urlHash: 'h1',
        source: 'CoinDesk',
        title: 'SOL institutional adoption grows',
        url: 'https://example.com/1',
        publishedAt: now - 30 * 60_000,
        symbols: ['SOLUSDT'],
        sentiment: 'BULLISH',
        score: 70,
        impact: 'HIGH',
        isBlackSwan: false,
        summary: 'Strong SOL adoption',
        analysisSource: 'LEXICON',
        createdAt: now,
      },
      {
        id: '2',
        urlHash: 'h2',
        source: 'Decrypt',
        title: 'Fed CPI cooling boosts risk assets',
        url: 'https://example.com/2',
        publishedAt: now - 60 * 60_000,
        symbols: ['MARKET'],
        sentiment: 'BULLISH',
        score: 40,
        impact: 'MEDIUM',
        isBlackSwan: false,
        summary: 'Macro tailwind',
        analysisSource: 'LEXICON',
        createdAt: now,
      },
    ];

    const ctx = getCoinNewsContext('SOLUSDT', items, 12, now);
    expect(ctx.newsScore).toBeGreaterThan(40);
    expect(ctx.coinSpecificCount).toBe(1);
    expect(ctx.hasRecentHighImpact).toBe(true);
    expect(ctx.dominantSentiment).toBe('BULLISH');
  });

  it('does not let stale macro Black Swan news block unrelated coins', () => {
    const now = Date.now();
    const base: NewsItem = {
      id: 'bs',
      urlHash: 'bs',
      source: 'CoinTelegraph',
      title: 'Exchange hack funds moved through mixers',
      url: 'https://example.com/bs',
      publishedAt: now - 3 * 3_600_000,
      symbols: ['MARKET'],
      sentiment: 'BEARISH',
      score: -85,
      impact: 'CRITICAL',
      isBlackSwan: true,
      summary: 'Old hack follow-up',
      analysisSource: 'LEXICON',
      createdAt: now,
    };
    expect(getCoinNewsContext('SOLUSDT', [base], 12, now).hasBlackSwanAlert).toBe(false);
    expect(
      getCoinNewsContext('SOLUSDT', [{ ...base, publishedAt: now - 20 * 60_000 }], 12, now)
        .hasBlackSwanAlert,
    ).toBe(true);
    expect(
      getCoinNewsContext('SOLUSDT', [{ ...base, symbols: ['SOLUSDT'] }], 12, now)
        .hasBlackSwanAlert,
    ).toBe(true);
  });

  it('uses Gemini Interactions API when available and gracefully falls back on failure', async () => {
    const now = Date.now();
    const rawArticles = [
      {
        urlHash: 'u1',
        source: 'CoinDesk',
        title: 'Ethereum L2 blobs hit record throughput after upgrade',
        url: 'https://example.com/eth-l2',
        publishedAt: now,
        summarySourceText: 'Network fees drop sharply while adoption increases.',
      },
    ];

    const mockClient = {
      interactions: {
        create: vi.fn().mockResolvedValue({
          output_text: JSON.stringify({
            items: [
              {
                index: 0,
                symbols: ['ETHUSDT'],
                sentiment: 'BULLISH',
                score: 72,
                impact: 'HIGH',
                isBlackSwan: false,
                summary: 'Upgrade lowers L2 fees and increases ETH network utility.',
              },
            ],
          }),
        }),
      },
    };

    const analyzed = await analyzeArticlesBatch(rawArticles, {
      geminiClient: mockClient as never,
      model: 'gemini-3.8-flash',
    });

    expect(mockClient.interactions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-3.8-flash',
        store: false,
      }),
    );
    expect(analyzed[0].analysisSource).toBe('GEMINI_AI');
    expect(analyzed[0].score).toBe(72);
    expect(analyzed[0].symbols).toContain('ETHUSDT');

    const failingClient = {
      interactions: {
        create: vi.fn().mockRejectedValue(new Error('Quota exceeded')),
      },
    };
    const fallback = await analyzeArticlesBatch(rawArticles, {
      geminiClient: failingClient as never,
      model: 'gemini-3.8-flash',
    });
    expect(fallback[0].analysisSource).toBe('LEXICON');
    expect(fallback[0].symbols).toContain('ETHUSDT');
  });
});
