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
      .array(z.enum(SOURCE_IDS))
      .max(5)
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
