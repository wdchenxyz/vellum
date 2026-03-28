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
