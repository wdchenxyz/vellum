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
