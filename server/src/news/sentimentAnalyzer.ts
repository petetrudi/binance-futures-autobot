import { randomUUID } from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import type {
  CoinNewsContext,
  NewsImpact,
  NewsItem,
  SentimentLabel,
} from '@bot/shared';
import { detectAffectedSymbols, type RawNewsArticle } from './newsFetcher.js';

const BLACK_SWAN_PATTERNS = [
  /\bhack(?:ed|ing)?\b/i,
  /\bexploit(?:ed)?\b/i,
  /\bdelist(?:ed|ing)?\b/i,
  /\bbankrupt(?:cy)?\b/i,
  /\binsolven(?:t|cy)\b/i,
  /\brug\s*pull\b/i,
  /\bsec\s+sues\b/i,
  /\bfunds\s+frozen\b/i,
  /\bemergency\s+halt\b/i,
];

const NEGATION_PATTERN = /\b(not|no|never|denies|denied|dismisses|false|rumor|debunked)\b/i;

const BULLISH_WEIGHTS: Array<[RegExp, number]> = [
  [/\betf\s+approv(?:ed|al)\b/i, 35],
  [/\bapproval|approved\b/i, 22],
  [/\binstitutional\s+(?:demand|inflow|adoption|buying)\b/i, 26],
  [/\binflows?\b/i, 18],
  [/\brate\s+cut|dovish\b/i, 24],
  [/\bsurge[sd]?|rally|breakout|record\s+high|all-time\s+high\b/i, 20],
  [/\bpartnership|integration|upgrade|mainnet\s+launch|listing\b/i, 18],
  [/\baccumulation|whale\s+buying|bullish\b/i, 16],
];

const BEARISH_WEIGHTS: Array<[RegExp, number]> = [
  [/\blawsuit|sued|crackdown|ban(?:ned)?\b/i, 28],
  [/\boutflows?|sell-?off|dump|crash|plunge[sd]?\b/i, 22],
  [/\brate\s+hike|hawkish|hotter\s+cpi\b/i, 24],
  [/\bliquidation(?:s)?\b/i, 16],
  [/\bwarning|delay(?:ed)?|reject(?:ed|ion)?\b/i, 18],
  [/\bbearish|downtrend|breach\b/i, 18],
];

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export interface LexiconResult {
  sentiment: SentimentLabel;
  score: number;
  impact: NewsImpact;
  isBlackSwan: boolean;
  summary: string;
}

/**
 * Deterministic lexicon analyzer used when GEMINI_API_KEY is unset or unavailable.
 */
export function analyzeArticleLexicon(title: string, body: string): LexiconResult {
  const text = `${title}. ${body}`.trim();
  const negated = NEGATION_PATTERN.test(text);

  let rawBlackSwan = false;
  for (const pat of BLACK_SWAN_PATTERNS) {
    if (pat.test(text)) {
      rawBlackSwan = true;
      break;
    }
  }
  const isBlackSwan = rawBlackSwan && !negated;

  let score = 0;
  for (const [pat, w] of BULLISH_WEIGHTS) {
    if (pat.test(text)) score += negated ? -w * 0.3 : w;
  }
  for (const [pat, w] of BEARISH_WEIGHTS) {
    if (pat.test(text)) score -= negated ? -w * 0.4 : w;
  }

  if (isBlackSwan) {
    score = Math.min(score - 70, -80);
  }

  score = clamp(Math.round(score), -100, 100);
  const sentiment: SentimentLabel =
    score >= 15 ? 'BULLISH' : score <= -15 ? 'BEARISH' : 'NEUTRAL';

  let impact: NewsImpact = 'LOW';
  if (isBlackSwan) impact = 'CRITICAL';
  else if (Math.abs(score) >= 45) impact = 'HIGH';
  else if (Math.abs(score) >= 20) impact = 'MEDIUM';

  const summary =
    isBlackSwan
      ? `CRITICAL RISK: ${title}`
      : `${sentiment} (${score >= 0 ? '+' : ''}${score}): ${title}`;

  return { sentiment, score, impact, isBlackSwan, summary };
}

export interface GeminiInteractionsLike {
  interactions: {
    create(params: Record<string, unknown>): Promise<{ output_text?: string | null }>;
  };
}

export interface SentimentBatchOptions {
  apiKey?: string;
  model?: string;
  geminiClient?: GeminiInteractionsLike;
}

interface GeminiNewsAssessment {
  index: number;
  symbols: string[];
  sentiment: SentimentLabel;
  score: number;
  impact: NewsImpact;
  isBlackSwan: boolean;
  summary: string;
}

const GEMINI_NEWS_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          symbols: { type: 'array', items: { type: 'string' } },
          sentiment: { type: 'string', enum: ['BULLISH', 'BEARISH', 'NEUTRAL'] },
          score: { type: 'number' },
          impact: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
          isBlackSwan: { type: 'boolean' },
          summary: { type: 'string' },
        },
        required: [
          'index',
          'symbols',
          'sentiment',
          'score',
          'impact',
          'isBlackSwan',
          'summary',
        ],
      },
    },
  },
  required: ['items'],
};

function buildLexiconNewsItem(raw: RawNewsArticle, nowMs: number): NewsItem {
  const symbols = detectAffectedSymbols(`${raw.title} ${raw.summarySourceText}`);
  const res = analyzeArticleLexicon(raw.title, raw.summarySourceText);
  return {
    id: randomUUID(),
    urlHash: raw.urlHash,
    source: raw.source,
    title: raw.title,
    url: raw.url,
    publishedAt: raw.publishedAt,
    symbols,
    sentiment: res.sentiment,
    score: res.score,
    impact: res.impact,
    isBlackSwan: res.isBlackSwan,
    summary: res.summary,
    analysisSource: 'LEXICON',
    createdAt: nowMs,
  };
}

/**
 * Analyzes a batch of raw articles via Gemini Interactions API (gemini-3.8-flash),
 * automatically falling back to deterministic Lexicon scoring on missing key or API error.
 */
export async function analyzeArticlesBatch(
  articles: RawNewsArticle[],
  options: SentimentBatchOptions = {},
): Promise<NewsItem[]> {
  if (articles.length === 0) return [];
  const nowMs = Date.now();
  const client: GeminiInteractionsLike | null =
    options.geminiClient ??
    (options.apiKey?.trim()
      ? (new GoogleGenAI({ apiKey: options.apiKey.trim() }) as unknown as GeminiInteractionsLike)
      : null);

  if (!client) {
    return articles.map((a) => buildLexiconNewsItem(a, nowMs));
  }

  const results: NewsItem[] = [];
  const batchSize = 8;

  for (let offset = 0; offset < articles.length; offset += batchSize) {
    const chunk = articles.slice(offset, offset + batchSize);
    try {
      const payload = chunk.map((a, idx) => ({
        index: idx,
        source: a.source,
        title: a.title,
        excerpt: a.summarySourceText,
      }));

      const response = await client.interactions.create({
        model: options.model || 'gemini-3.8-flash',
        store: false,
        system_instruction:
          'You are an institutional crypto futures quantitative analyst. Score each news item for short-to-intraday Binance USD-M Futures impact (-100 extreme bearish to +100 extreme bullish). Map coins to Binance perpetual symbols like BTCUSDT, ETHUSDT, SOLUSDT, 1000PEPEUSDT, or MARKET for macro/Fed/SEC/market-wide news. Flag isBlackSwan=true only for verified exchange hacks, exploits, delistings, insolvency, or sudden severe trading halts.',
        input: JSON.stringify(payload),
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema: GEMINI_NEWS_SCHEMA,
        },
      });

      const rawText = response.output_text ?? '';
      const parsed = JSON.parse(rawText) as { items?: GeminiNewsAssessment[] };
      const byIndex = new Map<number, GeminiNewsAssessment>();
      for (const item of parsed.items ?? []) {
        byIndex.set(item.index, item);
      }

      for (let idx = 0; idx < chunk.length; idx++) {
        const raw = chunk[idx];
        const ai = byIndex.get(idx);
        if (!ai) {
          results.push(buildLexiconNewsItem(raw, nowMs));
          continue;
        }
        const fallbackSymbols = detectAffectedSymbols(
          `${raw.title} ${raw.summarySourceText}`,
        );
        const normalizedSymbols = Array.from(
          new Set(
            (ai.symbols?.length ? ai.symbols : fallbackSymbols).map((s) =>
              s.toUpperCase(),
            ),
          ),
        );
        results.push({
          id: randomUUID(),
          urlHash: raw.urlHash,
          source: raw.source,
          title: raw.title,
          url: raw.url,
          publishedAt: raw.publishedAt,
          symbols: normalizedSymbols,
          sentiment: ai.sentiment,
          score: clamp(Math.round(ai.score), -100, 100),
          impact: ai.impact,
          isBlackSwan: Boolean(ai.isBlackSwan),
          summary: ai.summary || raw.title,
          analysisSource: 'GEMINI_AI',
          createdAt: nowMs,
        });
      }
    } catch {
      for (const raw of chunk) {
        results.push(buildLexiconNewsItem(raw, nowMs));
      }
    }
  }

  return results;
}

/**
 * Aggregates coin-specific and macro news with exponential time-decay (4h half-life).
 */
export function getCoinNewsContext(
  symbol: string,
  newsItems: NewsItem[],
  lookbackHours = 12,
  nowMs = Date.now(),
): CoinNewsContext {
  const cutoff = nowMs - lookbackHours * 3_600_000;
  const halfLifeMs = 4 * 3_600_000;
  const impactWeight: Record<NewsImpact, number> = {
    LOW: 0.6,
    MEDIUM: 1.0,
    HIGH: 1.6,
    CRITICAL: 2.5,
  };

  let weightedSum = 0;
  let totalWeight = 0;
  let articleCount = 0;
  let coinSpecificCount = 0;
  let hasRecentHighImpact = false;
  let hasBlackSwanAlert = false;
  const headlineSummaries: string[] = [];

  for (const item of newsItems) {
    if (item.publishedAt < cutoff) continue;
    const isCoinSpecific = item.symbols.includes(symbol);
    const isMacro = item.symbols.includes('MARKET');
    if (!isCoinSpecific && !isMacro) continue;

    const ageMs = Math.max(0, nowMs - item.publishedAt);
    const decay = Math.pow(0.5, ageMs / halfLifeMs);
    const specificity = isCoinSpecific ? 1.0 : 0.4;
    const w = decay * specificity * impactWeight[item.impact];

    weightedSum += item.score * w;
    totalWeight += w;
    articleCount += 1;
    if (isCoinSpecific) coinSpecificCount += 1;

    if (
      ageMs <= 2 * 3_600_000 &&
      (item.impact === 'HIGH' || item.impact === 'CRITICAL')
    ) {
      hasRecentHighImpact = true;
    }
    // Coin-specific Black Swan blocks that coin; macro Black Swan only blocks while very fresh (<=1h)
    if (item.isBlackSwan && (isCoinSpecific || ageMs <= 3_600_000)) {
      hasBlackSwanAlert = true;
    }
    if (headlineSummaries.length < 4 && (isCoinSpecific || item.impact !== 'LOW')) {
      headlineSummaries.push(`[${item.impact}] ${item.summary}`);
    }
  }

  const newsScore = totalWeight > 0 ? clamp(Math.round(weightedSum / totalWeight), -100, 100) : 0;
  const dominantSentiment: SentimentLabel =
    newsScore >= 15 ? 'BULLISH' : newsScore <= -15 ? 'BEARISH' : 'NEUTRAL';

  return {
    symbol,
    newsScore,
    articleCount,
    coinSpecificCount,
    hasRecentHighImpact,
    hasBlackSwanAlert,
    dominantSentiment,
    headlineSummaries,
  };
}
