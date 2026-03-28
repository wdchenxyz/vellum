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
