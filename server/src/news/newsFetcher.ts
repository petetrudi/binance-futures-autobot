import { createHash } from 'node:crypto';

export interface RawNewsArticle {
  urlHash: string;
  source: string;
  title: string;
  url: string;
  publishedAt: number;
  summarySourceText: string;
}

const RSS_FEEDS: Array<{ source: string; url: string }> = [
  { source: 'CoinTelegraph', url: 'https://cointelegraph.com/rss' },
  { source: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { source: 'Decrypt', url: 'https://decrypt.co/feed' },
];

const COIN_KEYWORD_MAP: Array<[RegExp, string]> = [
  [/\b(bitcoin|btc)\b/i, 'BTCUSDT'],
  [/\b(ethereum|ether|eth)\b/i, 'ETHUSDT'],
  [/\b(solana|sol)\b/i, 'SOLUSDT'],
  [/\b(binance\s*coin|bnb)\b/i, 'BNBUSDT'],
  [/\b(ripple|xrp)\b/i, 'XRPUSDT'],
  [/\b(cardano|ada)\b/i, 'ADAUSDT'],
  [/\b(dogecoin|doge)\b/i, 'DOGEUSDT'],
  [/\b(avalanche|avax)\b/i, 'AVAXUSDT'],
  [/\b(chainlink|link)\b/i, 'LINKUSDT'],
  [/\b(polkadot|dot)\b/i, 'DOTUSDT'],
  [/\b(sui)\b/i, 'SUIUSDT'],
  [/\b(toncoin|ton)\b/i, 'TONUSDT'],
  [/\b(near\s*protocol|near)\b/i, 'NEARUSDT'],
  [/\b(aptos|apt)\b/i, 'APTUSDT'],
  [/\b(arbitrum|arb)\b/i, 'ARBUSDT'],
  [/\b(optimism|\bop\b)\b/i, 'OPUSDT'],
  [/\b(pepe)\b/i, '1000PEPEUSDT'],
  [/\b(shiba\s*inu|shib)\b/i, '1000SHIBUSDT'],
  [/\b(bonk)\b/i, '1000BONKUSDT'],
  [/\b(litecoin|ltc)\b/i, 'LTCUSDT'],
  [/\b(uniswap|uni)\b/i, 'UNIUSDT'],
  [/\b(aave)\b/i, 'AAVEUSDT'],
  [/\b(injective|inj)\b/i, 'INJUSDT'],
  [/\b(render|rndr)\b/i, 'RENDERUSDT'],
  [/\b(bittensor|tao)\b/i, 'TAOUSDT'],
  [/\b(hyperliquid|hype)\b/i, 'HYPEUSDT'],
  [/\b(trx|tron)\b/i, 'TRXUSDT'],
  [/\b(xlm|stellar)\b/i, 'XLMUSDT'],
];

const MACRO_REGEX =
  /\b(fed|fomc|cpi|inflation|powell|interest\s*rate|sec|etf|treasury|tariff|trump|recession|binance|crypto\s*market|stablecoin|tether|usdt)\b/i;

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTag(block: string, tag: string): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = block.match(re);
  return m ? decodeHtmlEntities(m[1]) : '';
}

export function hashUrl(url: string): string {
  return createHash('sha256').update(url.trim()).digest('hex').slice(0, 32);
}

/**
 * Parses an RSS 2.0 or Atom XML string into normalized RawNewsArticle items.
 */
export function parseRssFeedXml(xml: string, source: string): RawNewsArticle[] {
  const items: RawNewsArticle[] = [];
  const itemMatches = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];

  for (const block of itemMatches.slice(0, 20)) {
    const title = extractTag(block, 'title');
    let url = extractTag(block, 'link');
    if (!url) {
      const guid = extractTag(block, 'guid');
      if (guid.startsWith('http')) url = guid;
    }
    if (!title || !url) continue;

    const pubRaw = extractTag(block, 'pubDate') || extractTag(block, 'dc:date');
    const parsedTime = pubRaw ? Date.parse(pubRaw) : NaN;
    const publishedAt = Number.isFinite(parsedTime) ? parsedTime : Date.now();
    const desc = extractTag(block, 'description');

    items.push({
      urlHash: hashUrl(url),
      source,
      title,
      url,
      publishedAt,
      summarySourceText: desc.slice(0, 320),
    });
  }

  return items;
}

/**
 * Maps news headline/summary text to affected Binance USDT-M symbols and macro MARKET tag.
 */
export function detectAffectedSymbols(text: string): string[] {
  const found = new Set<string>();
  for (const [pattern, symbol] of COIN_KEYWORD_MAP) {
    if (pattern.test(text)) {
      found.add(symbol);
    }
  }
  if (MACRO_REGEX.test(text) || found.size === 0) {
    found.add('MARKET');
  }
  return Array.from(found);
}

/**
 * Fetches fresh crypto news concurrently from verified RSS sources and optional CryptoPanic API.
 */
export async function fetchCryptoNews(
  cryptoPanicApiKey?: string,
): Promise<RawNewsArticle[]> {
  const tasks = RSS_FEEDS.map(async ({ source, url }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'BinanceFuturesAutobot/1.0' },
        signal: controller.signal,
      });
      if (!res.ok) return [] as RawNewsArticle[];
      const xml = await res.text();
      return parseRssFeedXml(xml, source);
    } catch {
      return [] as RawNewsArticle[];
    } finally {
      clearTimeout(timer);
    }
  });

  if (cryptoPanicApiKey?.trim()) {
    tasks.push(
      (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        try {
          const url = `https://cryptopanic.com/api/developer/v2/posts/?auth_token=${encodeURIComponent(
            cryptoPanicApiKey.trim(),
          )}&public=true`;
          const res = await fetch(url, { signal: controller.signal });
          if (!res.ok) return [] as RawNewsArticle[];
          const data = (await res.json()) as {
            results?: Array<{
              title?: string;
              url?: string;
              published_at?: string;
              source?: { title?: string };
            }>;
          };
          return (data.results ?? [])
            .filter((p) => p.title && p.url)
            .slice(0, 20)
            .map((p) => ({
              urlHash: hashUrl(p.url!),
              source: p.source?.title || 'CryptoPanic',
              title: p.title!,
              url: p.url!,
              publishedAt: p.published_at ? Date.parse(p.published_at) || Date.now() : Date.now(),
              summarySourceText: p.title!,
            }));
        } catch {
          return [] as RawNewsArticle[];
        } finally {
          clearTimeout(timer);
        }
      })(),
    );
  }

  const settled = await Promise.all(tasks);
  const deduped = new Map<string, RawNewsArticle>();
  for (const list of settled) {
    for (const article of list) {
      if (!deduped.has(article.urlHash)) {
        deduped.set(article.urlHash, article);
      }
    }
  }
  return Array.from(deduped.values()).sort((a, b) => b.publishedAt - a.publishedAt);
}
