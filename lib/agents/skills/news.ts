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
