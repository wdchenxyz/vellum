# News Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "news" skill to the chat agent that lets users fetch real-time finance news, unified
trend reports, and Polymarket prediction data — translated from the alphaear-news Claude Code skill
into AI SDK tools.

**Architecture:** Three new AI SDK tools (`fetchHotNews`, `getUnifiedTrends`, `getMarketSummary`) in
`lib/tools/`, a `NewsNow` client module for API calls with in-memory caching, and a new skill
definition registered in the skill registry. No database — uses 5-minute in-memory cache matching
the source skill's caching pattern.

**Tech Stack:** AI SDK v6 (`tool`, Zod schemas), native `fetch`, TypeScript

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `lib/news/newsnow-client.ts` | NewsNow API client with in-memory cache |
| Create | `lib/news/polymarket-client.ts` | Polymarket API client |
| Create | `lib/news/sources.ts` | News source registry (IDs, names, categories) |
| Create | `lib/tools/fetch-hot-news.ts` | AI SDK tool: fetch hot news from a source |
| Create | `lib/tools/get-unified-trends.ts` | AI SDK tool: aggregate trends from multiple sources |
| Create | `lib/tools/get-market-summary.ts` | AI SDK tool: Polymarket prediction markets |
| Create | `lib/agents/skills/news.ts` | News skill definition |
| Modify | `lib/agents/skills/index.ts` | Register news skill |
| Modify | `lib/agents/skills/tool-labels.ts` | Add news tool labels |
| Create | `tests/newsnow-client.test.ts` | Tests for NewsNow client |
| Create | `tests/polymarket-client.test.ts` | Tests for Polymarket client |

**Files NOT touched:** Any existing tool files, portfolio skill, route handler, chat-drawer.

---

### Task 1: News source registry

**Files:**
- Create: `lib/news/sources.ts`

- [ ] **Step 1: Create the sources module**

```typescript
// lib/news/sources.ts

export interface NewsSource {
  id: string
  name: string
  category: "finance" | "general" | "tech"
}

export const NEWS_SOURCES: NewsSource[] = [
  // Finance
  { id: "cls", name: "财联社", category: "finance" },
  { id: "wallstreetcn", name: "华尔街见闻", category: "finance" },
  { id: "xueqiu", name: "雪球热榜", category: "finance" },
  // General
  { id: "weibo", name: "微博热搜", category: "general" },
  { id: "zhihu", name: "知乎热榜", category: "general" },
  { id: "baidu", name: "百度热搜", category: "general" },
  { id: "toutiao", name: "今日头条", category: "general" },
  { id: "douyin", name: "抖音热榜", category: "general" },
  { id: "thepaper", name: "澎湃新闻", category: "general" },
  // Tech
  { id: "36kr", name: "36氪", category: "tech" },
  { id: "ithome", name: "IT之家", category: "tech" },
  { id: "v2ex", name: "V2EX", category: "tech" },
  { id: "juejin", name: "掘金", category: "tech" },
  { id: "hackernews", name: "Hacker News", category: "tech" },
]

export const SOURCE_IDS = NEWS_SOURCES.map((s) => s.id)

export function getSourceName(id: string): string {
  return NEWS_SOURCES.find((s) => s.id === id)?.name ?? id
}

export function getSourcesByCategory(
  category: NewsSource["category"]
): NewsSource[] {
  return NEWS_SOURCES.filter((s) => s.category === category)
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/news/sources.ts
git commit -m "feat: add news source registry with 14 sources"
```

---

### Task 2: NewsNow API client with caching

**Files:**
- Create: `lib/news/newsnow-client.ts`
- Test: `tests/newsnow-client.test.ts`

- [ ] **Step 1: Write the tests**

```typescript
// tests/newsnow-client.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  fetchHotNewsFromSource,
  type NewsItem,
} from "@/lib/news/newsnow-client"

function createMockResponse(items: Record<string, unknown>[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ items }),
  } as unknown as Response
}

describe("fetchHotNewsFromSource", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("fetches and returns processed news items", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      createMockResponse([
        {
          id: "1",
          title: "Test headline",
          url: "https://example.com/1",
          extra: { hot: 1000 },
        },
        {
          id: "2",
          title: "Another headline",
          url: "https://example.com/2",
          extra: {},
        },
      ])
    )

    const result = await fetchHotNewsFromSource("cls", 2, mockFetch)

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      id: "1",
      source: "cls",
      rank: 1,
      title: "Test headline",
      url: "https://example.com/1",
    })
    expect(result[1].rank).toBe(2)
    expect(mockFetch).toHaveBeenCalledOnce()
  })

  it("limits results to the requested count", async () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      title: `Headline ${i}`,
      url: `https://example.com/${i}`,
    }))
    const mockFetch = vi
      .fn()
      .mockResolvedValue(createMockResponse(items))

    const result = await fetchHotNewsFromSource("weibo", 5, mockFetch)

    expect(result).toHaveLength(5)
  })

  it("uses cache for repeated calls within 5 minutes", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      createMockResponse([
        { id: "1", title: "Cached", url: "https://example.com" },
      ])
    )

    await fetchHotNewsFromSource("cls", 10, mockFetch)
    await fetchHotNewsFromSource("cls", 10, mockFetch)

    expect(mockFetch).toHaveBeenCalledOnce()
  })

  it("re-fetches after cache expires (5 minutes)", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      createMockResponse([
        { id: "1", title: "Fresh", url: "https://example.com" },
      ])
    )

    await fetchHotNewsFromSource("cls", 10, mockFetch)

    // Advance past 5-minute cache window
    vi.advanceTimersByTime(5 * 60 * 1000 + 1)

    await fetchHotNewsFromSource("cls", 10, mockFetch)

    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it("returns empty array on fetch failure", async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValue(new Error("Network error"))

    const result = await fetchHotNewsFromSource("cls", 10, mockFetch)

    expect(result).toEqual([])
  })

  it("returns stale cache on fetch failure if available", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockResponse([
          { id: "1", title: "Stale", url: "https://example.com" },
        ])
      )
      .mockRejectedValueOnce(new Error("Network error"))

    await fetchHotNewsFromSource("cls", 10, mockFetch)

    // Expire cache
    vi.advanceTimersByTime(5 * 60 * 1000 + 1)

    const result = await fetchHotNewsFromSource("cls", 10, mockFetch)

    expect(result).toHaveLength(1)
    expect(result[0].title).toBe("Stale")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/newsnow-client.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the NewsNow client**

```typescript
// lib/news/newsnow-client.ts
import "server-only"

const BASE_URL = "https://newsnow.busiyi.world"
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

export interface NewsItem {
  id: string
  source: string
  rank: number
  title: string
  url: string
  publishTime?: string
  metadata: Record<string, unknown>
}

interface CacheEntry {
  time: number
  data: NewsItem[]
}

const cache = new Map<string, CacheEntry>()

export async function fetchHotNewsFromSource(
  sourceId: string,
  count: number = 15,
  fetcher: typeof fetch = fetch
): Promise<NewsItem[]> {
  const cacheKey = `${sourceId}_${count}`
  const cached = cache.get(cacheKey)
  const now = Date.now()

  if (cached && now - cached.time < CACHE_TTL_MS) {
    return cached.data
  }

  try {
    const response = await fetcher(
      `${BASE_URL}/api/s?id=${encodeURIComponent(sourceId)}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(30_000),
      }
    )

    if (!response.ok) {
      if (cached) return cached.data
      return []
    }

    const data = (await response.json()) as {
      items?: Array<{
        id?: string
        title?: string
        url?: string
        publish_time?: string
        extra?: Record<string, unknown>
      }>
    }

    const items = (data.items ?? []).slice(0, count)
    const processed: NewsItem[] = items.map((item, i) => ({
      id: item.id ?? `${sourceId}_${now}_${i + 1}`,
      source: sourceId,
      rank: i + 1,
      title: item.title ?? "",
      url: item.url ?? "",
      publishTime: item.publish_time,
      metadata: item.extra ?? {},
    }))

    cache.set(cacheKey, { time: now, data: processed })
    return processed
  } catch {
    if (cached) return cached.data
    return []
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/newsnow-client.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/news/newsnow-client.ts tests/newsnow-client.test.ts
git commit -m "feat: add NewsNow API client with 5-minute cache"
```

---

### Task 3: Polymarket API client

**Files:**
- Create: `lib/news/polymarket-client.ts`
- Test: `tests/polymarket-client.test.ts`

- [ ] **Step 1: Write the tests**

```typescript
// tests/polymarket-client.test.ts
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  fetchActiveMarkets,
  type PredictionMarket,
} from "@/lib/news/polymarket-client"

function createMockResponse(markets: Record<string, unknown>[]) {
  return {
    ok: true,
    status: 200,
    json: async () => markets,
  } as unknown as Response
}

describe("fetchActiveMarkets", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("fetches and returns processed market data", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      createMockResponse([
        {
          id: "m1",
          question: "Will Fed cut rates?",
          slug: "fed-cut-rates",
          outcomes: ["Yes", "No"],
          outcomePrices: ["0.65", "0.35"],
          volume: "1500000",
          liquidity: "500000",
        },
      ])
    )

    const result = await fetchActiveMarkets(10, mockFetch)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: "m1",
      question: "Will Fed cut rates?",
      outcomes: ["Yes", "No"],
      outcomePrices: ["0.65", "0.35"],
      volume: "1500000",
    })
  })

  it("limits to requested count", async () => {
    const markets = Array.from({ length: 30 }, (_, i) => ({
      id: `m${i}`,
      question: `Question ${i}?`,
      outcomes: ["Yes", "No"],
      outcomePrices: ["0.5", "0.5"],
      volume: "1000",
    }))
    const mockFetch = vi
      .fn()
      .mockResolvedValue(createMockResponse(markets))

    const result = await fetchActiveMarkets(5, mockFetch)

    // API handles limit via query param; we pass through
    expect(mockFetch).toHaveBeenCalledOnce()
    expect(
      new URL(mockFetch.mock.calls[0][0] as string).searchParams.get("limit")
    ).toBe("5")
  })

  it("returns empty array on fetch failure", async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValue(new Error("Network error"))

    const result = await fetchActiveMarkets(10, mockFetch)

    expect(result).toEqual([])
  })

  it("returns empty array on non-ok response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    } as Response)

    const result = await fetchActiveMarkets(10, mockFetch)

    expect(result).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/polymarket-client.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the Polymarket client**

```typescript
// lib/news/polymarket-client.ts
import "server-only"

const BASE_URL = "https://gamma-api.polymarket.com"

export interface PredictionMarket {
  id: string
  question: string
  slug: string
  outcomes: string[]
  outcomePrices: string[]
  volume: string
  liquidity: string
}

export async function fetchActiveMarkets(
  limit: number = 20,
  fetcher: typeof fetch = fetch
): Promise<PredictionMarket[]> {
  try {
    const url = new URL(`${BASE_URL}/markets`)
    url.searchParams.set("active", "true")
    url.searchParams.set("closed", "false")
    url.searchParams.set("limit", String(limit))

    const response = await fetcher(url.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(30_000),
    })

    if (!response.ok) return []

    const markets = (await response.json()) as Array<
      Record<string, unknown>
    >

    return markets.map((m) => ({
      id: (m.id as string) ?? "",
      question: (m.question as string) ?? "",
      slug: (m.slug as string) ?? "",
      outcomes: (m.outcomes as string[]) ?? [],
      outcomePrices: (m.outcomePrices as string[]) ?? [],
      volume: (m.volume as string) ?? "0",
      liquidity: (m.liquidity as string) ?? "0",
    }))
  } catch {
    return []
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/polymarket-client.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/news/polymarket-client.ts tests/polymarket-client.test.ts
git commit -m "feat: add Polymarket API client"
```

---

### Task 4: AI SDK tool — fetchHotNews

**Files:**
- Create: `lib/tools/fetch-hot-news.ts`

- [ ] **Step 1: Create the tool**

```typescript
// lib/tools/fetch-hot-news.ts
import { tool } from "ai"
import { z } from "zod"

import { fetchHotNewsFromSource } from "@/lib/news/newsnow-client"
import { getSourceName, SOURCE_IDS } from "@/lib/news/sources"

export const fetchHotNews = tool({
  description:
    "Fetch trending hot news from a specific source. Returns ranked headlines with links. Use this when the user asks about current news, trending topics, or what's happening on a specific platform. Available sources include Chinese finance (cls, wallstreetcn, xueqiu), social media (weibo, zhihu, baidu, toutiao, douyin), news (thepaper), and tech (36kr, ithome, v2ex, juejin, hackernews).",
  inputSchema: z.object({
    sourceId: z
      .enum(SOURCE_IDS as [string, ...string[]])
      .describe(
        "News source ID. Finance: cls (财联社), wallstreetcn (华尔街见闻), xueqiu (雪球). General: weibo (微博), zhihu (知乎), baidu (百度), toutiao (今日头条), douyin (抖音), thepaper (澎湃). Tech: 36kr, ithome, v2ex, juejin, hackernews."
      ),
    count: z
      .number()
      .int()
      .min(1)
      .max(30)
      .optional()
      .default(15)
      .describe("Number of items to fetch (1-30, default 15)"),
  }),
  execute: async ({ sourceId, count }) => {
    const items = await fetchHotNewsFromSource(sourceId, count)

    return {
      source: sourceId,
      sourceName: getSourceName(sourceId),
      count: items.length,
      items: items.map((item) => ({
        rank: item.rank,
        title: item.title,
        url: item.url,
      })),
    }
  },
})
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -10`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add lib/tools/fetch-hot-news.ts
git commit -m "feat: add fetchHotNews AI SDK tool"
```

---

### Task 5: AI SDK tool — getUnifiedTrends

**Files:**
- Create: `lib/tools/get-unified-trends.ts`

- [ ] **Step 1: Create the tool**

```typescript
// lib/tools/get-unified-trends.ts
import { tool } from "ai"
import { z } from "zod"

import { fetchHotNewsFromSource } from "@/lib/news/newsnow-client"
import { getSourceName, SOURCE_IDS } from "@/lib/news/sources"

export const getUnifiedTrends = tool({
  description:
    "Get a unified trending topics report aggregated from multiple news sources. Returns top headlines from each source combined into one report. Use this when the user wants a broad overview of what's trending across platforms. Defaults to weibo, zhihu, and wallstreetcn if no sources specified.",
  inputSchema: z.object({
    sources: z
      .array(z.enum(SOURCE_IDS as [string, ...string[]]))
      .optional()
      .default(["weibo", "zhihu", "wallstreetcn"])
      .describe(
        "List of source IDs to aggregate. Defaults to weibo, zhihu, wallstreetcn."
      ),
    countPerSource: z
      .number()
      .int()
      .min(1)
      .max(15)
      .optional()
      .default(10)
      .describe("Number of items per source (1-15, default 10)"),
  }),
  execute: async ({ sources, countPerSource }) => {
    const results = await Promise.all(
      sources.map(async (sourceId) => {
        const items = await fetchHotNewsFromSource(sourceId, countPerSource)
        return {
          sourceId,
          sourceName: getSourceName(sourceId),
          items: items.map((item) => ({
            rank: item.rank,
            title: item.title,
            url: item.url,
          })),
        }
      })
    )

    return {
      sourcesQueried: sources.length,
      totalItems: results.reduce((sum, r) => sum + r.items.length, 0),
      results,
    }
  },
})
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -10`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add lib/tools/get-unified-trends.ts
git commit -m "feat: add getUnifiedTrends AI SDK tool"
```

---

### Task 6: AI SDK tool — getMarketSummary

**Files:**
- Create: `lib/tools/get-market-summary.ts`

- [ ] **Step 1: Create the tool**

```typescript
// lib/tools/get-market-summary.ts
import { tool } from "ai"
import { z } from "zod"

import { fetchActiveMarkets } from "@/lib/news/polymarket-client"

export const getMarketSummary = tool({
  description:
    "Get a summary of active prediction markets from Polymarket. Returns questions, outcome probabilities, and trading volume. Use this when the user asks about prediction markets, public sentiment, or probability of events.",
  inputSchema: z.object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .default(10)
      .describe("Number of markets to return (1-50, default 10)"),
  }),
  execute: async ({ limit }) => {
    const markets = await fetchActiveMarkets(limit)

    return {
      count: markets.length,
      markets: markets.map((m, i) => ({
        rank: i + 1,
        question: m.question,
        outcomes: m.outcomes,
        outcomePrices: m.outcomePrices,
        volume: m.volume,
      })),
    }
  },
})
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -10`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add lib/tools/get-market-summary.ts
git commit -m "feat: add getMarketSummary AI SDK tool"
```

---

### Task 7: News skill definition and registration

**Files:**
- Create: `lib/agents/skills/news.ts`
- Modify: `lib/agents/skills/index.ts`
- Modify: `lib/agents/skills/tool-labels.ts`

- [ ] **Step 1: Create the news skill**

```typescript
// lib/agents/skills/news.ts
import type { Skill } from "./types"
import { fetchHotNews } from "@/lib/tools/fetch-hot-news"
import { getMarketSummary } from "@/lib/tools/get-market-summary"
import { getUnifiedTrends } from "@/lib/tools/get-unified-trends"

const newsTools = {
  fetchHotNews,
  getUnifiedTrends,
  getMarketSummary,
}

export const newsSkill: Skill<typeof newsTools> = {
  name: "news",
  description:
    "Real-time news, trends, and prediction markets",
  tools: newsTools,
  systemPrompt: `<capabilities>
You also have access to news and market intelligence tools:
- **fetchHotNews**: Fetch trending headlines from a specific source (finance, social, tech platforms).
- **getUnifiedTrends**: Aggregate trending topics from multiple sources into one report.
- **getMarketSummary**: Get active Polymarket prediction markets with outcome probabilities and volume.
</capabilities>

<guidelines>
- When the user asks about news, trending topics, or "what's happening", use fetchHotNews or getUnifiedTrends.
- For a broad overview, use getUnifiedTrends with the default sources (weibo, zhihu, wallstreetcn).
- For specific platform news, use fetchHotNews with the appropriate sourceId.
- When the user asks about prediction markets, public sentiment on events, or probabilities, use getMarketSummary.
- Present news items in numbered lists with titles and links.
- Present prediction markets in a table with question, probability, and volume.
- Format probabilities as percentages (e.g. 65% not 0.65).
- Format volume with dollar signs and thousand separators.
</guidelines>`,
}
```

- [ ] **Step 2: Register the news skill in the registry**

In `lib/agents/skills/index.ts`, add the import and append to the skills array:

```typescript
// Add import after the portfolioSkill import:
import { newsSkill } from "./news"

// Change the skills array to include newsSkill:
export const skills: Skill[] = [portfolioSkill, newsSkill]
```

- [ ] **Step 3: Add news tool labels**

In `lib/agents/skills/tool-labels.ts`, add the news tool labels after the portfolio labels:

```typescript
export const allToolLabels: Record<string, string> = {
  // Portfolio skill
  getTradeHistory: "Fetching trade history",
  getHoldings: "Loading portfolio holdings",
  getDailyValues: "Computing portfolio values",
  getStockPerformance: "Analyzing stock performance",
  getFxRate: "Checking exchange rate",
  // News skill
  fetchHotNews: "Fetching news headlines",
  getUnifiedTrends: "Aggregating trending topics",
  getMarketSummary: "Loading prediction markets",
}
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -10`
Expected: No errors

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: All tests pass (including new ones from Tasks 2-3)

- [ ] **Step 6: Commit**

```bash
git add lib/agents/skills/news.ts lib/agents/skills/index.ts lib/agents/skills/tool-labels.ts
git commit -m "feat: register news skill with tools, prompt, and labels"
```

---

### Task 8: Build verification and smoke test

- [ ] **Step 1: Run TypeScript compiler**

Run: `npx tsc --noEmit --pretty 2>&1 | head -10`
Expected: No errors

- [ ] **Step 2: Run all tests**

Run: `npm test`
Expected: All tests pass (39 existing + 10 new = 49 tests)

- [ ] **Step 3: Run Next.js build**

Run: `npx next build 2>&1 | tail -10`
Expected: Build succeeds, no errors

- [ ] **Step 4: Verify the system prompt includes news capabilities**

Run:
```bash
npx tsx -e "
import { SOURCE_IDS } from './lib/news/sources.js';
console.log('Sources:', SOURCE_IDS.length);
console.log('IDs:', SOURCE_IDS.join(', '));
"
```
Expected: 14 sources listed

- [ ] **Step 5: Final commit if any fixes were needed**
