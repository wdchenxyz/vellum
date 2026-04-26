# Jina Reader Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `fetchNewsContent` tool that extracts full article text from a URL using Jina Reader, enabling the two-step flow: browse headlines → read full article.

**Architecture:** A Jina Reader client module with rate limiting (3s minimum interval between requests, no API key required) and an AI SDK tool that wraps it. The tool is added to the existing news skill.

**Tech Stack:** AI SDK v6 (`tool`, Zod), native `fetch`, TypeScript

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `lib/news/jina-reader.ts` | Jina Reader API client with rate limiting |
| Create | `lib/tools/fetch-news-content.ts` | AI SDK tool wrapping the Jina client |
| Create | `tests/jina-reader.test.ts` | Tests for the Jina Reader client |
| Modify | `lib/agents/skills/news.ts` | Add fetchNewsContent to news skill tools + prompt |
| Modify | `lib/agents/skills/tool-labels.ts` | Add fetchNewsContent label |

**Files NOT touched:** `lib/agents/skills/index.ts` (news skill is already registered), `app/api/chat/route.ts`, `components/chat-drawer.tsx`.

---

### Task 1: Jina Reader client with rate limiting

**Files:**
- Create: `lib/news/jina-reader.ts`
- Test: `tests/jina-reader.test.ts`

- [ ] **Step 1: Write the tests**

```typescript
// tests/jina-reader.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { extractContent } from "@/lib/news/jina-reader"

describe("extractContent", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("extracts content from a valid URL", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: { content: "# Article Title\n\nArticle body text." },
      }),
    } as unknown as Response)

    const result = await extractContent(
      "https://example.com/article",
      mockFetch
    )

    expect(result).toBe("# Article Title\n\nArticle body text.")
    expect(mockFetch).toHaveBeenCalledOnce()
    const calledUrl = mockFetch.mock.calls[0][0] as string
    expect(calledUrl).toBe("https://r.jina.ai/https://example.com/article")
  })

  it("returns null on non-ok response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    } as unknown as Response)

    const result = await extractContent("https://example.com/fail", mockFetch)

    expect(result).toBeNull()
  })

  it("returns null on fetch error", async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValue(new Error("Network error"))

    const result = await extractContent("https://example.com/err", mockFetch)

    expect(result).toBeNull()
  })

  it("returns null for invalid URLs", async () => {
    const mockFetch = vi.fn()

    const result = await extractContent("not-a-url", mockFetch)

    expect(result).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("enforces minimum interval between requests", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { content: "content" } }),
    } as unknown as Response)

    // First call — should go through immediately
    const p1 = extractContent("https://example.com/1", mockFetch)

    // Second call immediately after — should be delayed
    const p2 = extractContent("https://example.com/2", mockFetch)

    // Resolve first call
    await p1

    // Second call should not have fired yet (within 3s interval)
    expect(mockFetch).toHaveBeenCalledTimes(1)

    // Advance past the 3s interval
    await vi.advanceTimersByTimeAsync(3000)
    await p2

    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it("includes authorization header when JINA_API_KEY is set", async () => {
    vi.stubEnv("JINA_API_KEY", "test-key-123")

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { content: "content" } }),
    } as unknown as Response)

    await extractContent("https://example.com/auth", mockFetch)

    const headers = mockFetch.mock.calls[0][1]?.headers as Record<
      string,
      string
    >
    expect(headers.Authorization).toBe("Bearer test-key-123")

    vi.unstubAllEnvs()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/jina-reader.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the Jina Reader client**

```typescript
// lib/news/jina-reader.ts
import "server-only"

const JINA_BASE_URL = "https://r.jina.ai/"
const MIN_INTERVAL_MS = 3000 // 3 seconds between requests

let lastRequestTime = 0

async function waitForRateLimit(): Promise<void> {
  const now = Date.now()
  const elapsed = now - lastRequestTime
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((resolve) =>
      setTimeout(resolve, MIN_INTERVAL_MS - elapsed)
    )
  }
  lastRequestTime = Date.now()
}

export async function extractContent(
  url: string,
  fetcher: typeof fetch = fetch
): Promise<string | null> {
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return null
  }

  await waitForRateLimit()

  try {
    const headers: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept: "application/json",
    }

    const apiKey = process.env.JINA_API_KEY
    if (apiKey?.trim()) {
      headers.Authorization = `Bearer ${apiKey}`
    }

    const response = await fetcher(`${JINA_BASE_URL}${url}`, {
      headers,
      signal: AbortSignal.timeout(30_000),
    })

    if (!response.ok) return null

    const data = (await response.json()) as {
      data?: { content?: string }
    }

    return data.data?.content ?? null
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/jina-reader.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/news/jina-reader.ts tests/jina-reader.test.ts
git commit -m "feat: add Jina Reader client with rate limiting"
```

---

### Task 2: fetchNewsContent AI SDK tool

**Files:**
- Create: `lib/tools/fetch-news-content.ts`

- [ ] **Step 1: Create the tool**

```typescript
// lib/tools/fetch-news-content.ts
import { tool } from "ai"
import { z } from "zod"

import { extractContent } from "@/lib/news/jina-reader"

export const fetchNewsContent = tool({
  description:
    "Extract the full article content from a news URL. Returns the article text in markdown format. Use this when the user wants to read a specific article from the news headlines. The URL should come from a previous fetchHotNews or getUnifiedTrends result.",
  inputSchema: z.object({
    url: z
      .string()
      .url()
      .describe("The full URL of the article to extract content from"),
  }),
  execute: async ({ url }) => {
    const content = await extractContent(url)

    if (!content) {
      return {
        success: false,
        error: "Failed to extract content from this URL.",
      }
    }

    // Truncate very long articles to avoid overwhelming the context
    const maxLength = 8000
    const truncated = content.length > maxLength
    const text = truncated ? content.slice(0, maxLength) + "\n\n[Truncated]" : content

    return {
      success: true,
      url,
      contentLength: content.length,
      truncated,
      content: text,
    }
  },
})
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -10`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add lib/tools/fetch-news-content.ts
git commit -m "feat: add fetchNewsContent AI SDK tool"
```

---

### Task 3: Register in news skill

**Files:**
- Modify: `lib/agents/skills/news.ts`
- Modify: `lib/agents/skills/tool-labels.ts`

- [ ] **Step 1: Update the news skill**

In `lib/agents/skills/news.ts`, add the import and tool:

Add import at the top with the other tool imports:
```typescript
import { fetchNewsContent } from "@/lib/tools/fetch-news-content"
```

Add to the `newsTools` object:
```typescript
const newsTools = {
  fetchHotNews,
  getUnifiedTrends,
  getMarketSummary,
  fetchNewsContent,
}
```

Add to the system prompt's `<capabilities>` section, after the getMarketSummary line:
```
- **fetchNewsContent**: Extract full article text from a URL. Use after fetchHotNews when the user wants to read a specific article.
```

Add to the `<guidelines>` section:
```
- When the user wants to read a specific article from the headlines, use fetchNewsContent with the URL from the news results.
- Present extracted article content clearly, preserving the original structure.
```

- [ ] **Step 2: Add tool label**

In `lib/agents/skills/tool-labels.ts`, add after the `getMarketSummary` line:
```typescript
  fetchNewsContent: "Reading article content",
```

- [ ] **Step 3: Verify it compiles and all tests pass**

Run: `npx tsc --noEmit --pretty 2>&1 | head -10`
Expected: No errors

Run: `npm test`
Expected: All tests pass

- [ ] **Step 4: Run Next.js build**

Run: `npx next build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add lib/agents/skills/news.ts lib/agents/skills/tool-labels.ts
git commit -m "feat: add fetchNewsContent to news skill"
```
