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
