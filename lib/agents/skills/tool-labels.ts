// Client-safe tool labels registry.
// Separated from index.ts to avoid pulling server-only tool imports into client components.
// When adding a new skill, add its tool labels here too.

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
