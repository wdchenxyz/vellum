import type {
  PreviousCloseQuote,
  SupportedMarket,
} from "@/lib/portfolio/schema"

export type PortfolioTradeRow = {
  id: string
  account: string | null
  date: string
  ticker: string
  quantity: number
  price: number
  currency: string | null
  totalAmount: number
  side: "BUY" | "SELL"
}

export type AggregatedHolding = {
  key: string
  quoteKey: string
  account: string | null
  ticker: string
  market: SupportedMarket
  currency: string
  quantityOpen: number
  totalCostOpen: number
  averageCost: number
}

export type ValuedHolding = AggregatedHolding & {
  exchange: string | null
  micCode: string | null
  previousClose: number | null
  previousCloseDate: string | null
  marketValue: number | null
  quoteTicker: string | null
  weight: number | null
  quoteError: string | null
}

export type PortfolioHoldingGroup = {
  account: string | null
  label: string
  currencies: string[]
  holdings: ValuedHolding[]
  totalCostOpen: number | null
  totalMarketValue: number | null
  missingPriceCount: number
}

export type PortfolioSummary = {
  account: string | null
  label: string
  currencies: string[]
  holdingCount: number
  totalCostOpen: number | null
  totalMarketValue: number | null
  missingPriceCount: number
}

const TW_TICKER_PATTERN = /^\d{4,6}$/
const US_TICKER_PATTERN = /^[A-Z][A-Z0-9.-]*$/
const CJK_PATTERN = /\p{Script=Han}/u
const MARKET_DEFAULT_CURRENCY: Record<SupportedMarket, string> = {
  TW: "TWD",
  US: "USD",
}
const FLOAT_EPSILON = 1e-8

function roundNumber(value: number, decimals = 10) {
  if (Math.abs(value) < FLOAT_EPSILON) {
    return 0
  }

  return Number(value.toFixed(decimals))
}

function normalizeTicker(ticker: string) {
  return ticker.trim().toUpperCase()
}

function normalizeCurrency(currency: string | null) {
  return currency?.trim().toUpperCase() ?? null
}

function normalizeAccount(account: string | null | undefined) {
  const normalized = account?.trim()
  return normalized ? normalized : null
}

function getAccountLabel(account: string | null) {
  return account ?? "Unassigned account"
}

function getDefaultCurrency(market: SupportedMarket) {
  return MARKET_DEFAULT_CURRENCY[market]
}

function compareCurrency(a: string, b: string) {
  const order = ["TWD", "USD"]
  const aIndex = order.indexOf(a)
  const bIndex = order.indexOf(b)

  if (aIndex === -1 || bIndex === -1) {
    return a.localeCompare(b)
  }

  return aIndex - bIndex
}

function prefersDescriptiveTaiwanLabel(
  currentTicker: string,
  nextTicker: string
) {
  return TW_TICKER_PATTERN.test(currentTicker) && CJK_PATTERN.test(nextTicker)
}

function mergeCanonicalHoldings(holdings: ValuedHolding[]) {
  const merged = new Map<string, ValuedHolding>()

  for (const holding of holdings) {
    const canonicalKey =
      holding.market === "TW" && holding.quoteTicker
        ? getHoldingKey({
            account: holding.account,
            market: holding.market,
            ticker: holding.quoteTicker,
          })
        : holding.key
    const existing = merged.get(canonicalKey)

    if (!existing) {
      merged.set(canonicalKey, {
        ...holding,
        key: canonicalKey,
      })
      continue
    }

    const quantityOpen = roundNumber(
      existing.quantityOpen + holding.quantityOpen
    )
    const totalCostOpen = roundNumber(
      existing.totalCostOpen + holding.totalCostOpen
    )
    const marketValue =
      existing.marketValue === null || holding.marketValue === null
        ? null
        : roundNumber(existing.marketValue + holding.marketValue)

    merged.set(canonicalKey, {
      ...existing,
      account: existing.account,
      averageCost:
        quantityOpen > 0 ? roundNumber(totalCostOpen / quantityOpen) : 0,
      currency: existing.currency,
      exchange: existing.exchange ?? holding.exchange,
      marketValue,
      micCode: existing.micCode ?? holding.micCode,
      previousClose: existing.previousClose ?? holding.previousClose,
      previousCloseDate:
        existing.previousCloseDate ?? holding.previousCloseDate,
      quantityOpen,
      quoteError: existing.quoteError ?? holding.quoteError,
      quoteKey: existing.quoteKey,
      quoteTicker: existing.quoteTicker ?? holding.quoteTicker,
      ticker: prefersDescriptiveTaiwanLabel(existing.ticker, holding.ticker)
        ? holding.ticker
        : existing.ticker,
      totalCostOpen,
      weight: null,
    })
  }

  return [...merged.values()]
}

function compareAccountNames(a: string | null, b: string | null) {
  return (a ?? "").localeCompare(b ?? "")
}

function compareAggregatedHoldings(
  left: AggregatedHolding,
  right: AggregatedHolding
) {
  const byCurrency = compareCurrency(left.currency, right.currency)

  if (byCurrency !== 0) {
    return byCurrency
  }

  if (left.market !== right.market) {
    return left.market.localeCompare(right.market)
  }

  const byAccount = compareAccountNames(left.account, right.account)

  if (byAccount !== 0) {
    return byAccount
  }

  return left.ticker.localeCompare(right.ticker)
}

function compareGroupedHoldings(left: ValuedHolding, right: ValuedHolding) {
  if (left.weight !== null && right.weight !== null) {
    return right.weight - left.weight
  }

  if (left.weight !== null) {
    return -1
  }

  if (right.weight !== null) {
    return 1
  }

  if (left.marketValue !== null && right.marketValue !== null) {
    return right.marketValue - left.marketValue
  }

  if (left.market !== right.market) {
    return left.market.localeCompare(right.market)
  }

  const byAccount = compareAccountNames(left.account, right.account)

  if (byAccount !== 0) {
    return byAccount
  }

  return left.ticker.localeCompare(right.ticker)
}

function buildValuedHolding(
  holding: AggregatedHolding,
  quote: PreviousCloseQuote | undefined
): ValuedHolding {
  const currency = normalizeCurrency(quote?.currency) ?? holding.currency
  const previousClose = quote?.previousClose ?? null
  const marketValue =
    previousClose === null
      ? null
      : roundNumber(holding.quantityOpen * previousClose)

  return {
    ...holding,
    currency,
    exchange: quote?.exchange ?? null,
    micCode: quote?.micCode ?? null,
    previousClose,
    previousCloseDate: quote?.asOf ?? null,
    marketValue,
    quoteTicker: quote?.ticker ?? null,
    weight: null,
    quoteError: quote?.error ?? null,
  }
}

function applyGroupWeights(
  holdings: ValuedHolding[],
  totalMarketValue: number
): ValuedHolding[] {
  return holdings.map((holding) => ({
    ...holding,
    weight:
      totalMarketValue > 0 && holding.marketValue !== null
        ? roundNumber(holding.marketValue / totalMarketValue, 6)
        : null,
  }))
}

function buildAccountGroup(
  label: string,
  accountHoldings: ValuedHolding[]
): {
  group: PortfolioHoldingGroup
  summary: PortfolioSummary
} {
  const currencies = [
    ...new Set(accountHoldings.map((holding) => holding.currency)),
  ].sort(compareCurrency)
  const singleCurrency = currencies.length === 1 ? currencies[0] : null
  const totalCostOpen = singleCurrency
    ? roundNumber(
        accountHoldings.reduce((sum, holding) => sum + holding.totalCostOpen, 0)
      )
    : null
  const missingPriceCount = accountHoldings.filter(
    (holding) => holding.marketValue === null
  ).length
  const pricedMarketValueTotal = roundNumber(
    accountHoldings.reduce(
      (sum, holding) => sum + (holding.marketValue ?? 0),
      0
    )
  )
  const totalMarketValue =
    singleCurrency && missingPriceCount === 0 ? pricedMarketValueTotal : null
  const holdingsWithWeight = (
    singleCurrency
      ? applyGroupWeights(accountHoldings, pricedMarketValueTotal)
      : accountHoldings.map((holding) => ({ ...holding, weight: null }))
  ).sort(compareGroupedHoldings)
  const account = holdingsWithWeight[0]?.account ?? null

  return {
    group: {
      account,
      currencies,
      holdings: holdingsWithWeight,
      label,
      totalCostOpen,
      totalMarketValue,
      missingPriceCount,
    },
    summary: {
      account,
      currencies,
      holdingCount: holdingsWithWeight.length,
      label,
      totalCostOpen,
      totalMarketValue,
      missingPriceCount,
    },
  }
}

export function getHoldingKey({
  account,
  ticker,
  market,
}: {
  account?: string | null
  ticker: string
  market: SupportedMarket
}) {
  const quoteKey = getQuoteLookupKey({ ticker, market })
  const normalizedAccount = normalizeAccount(account)

  return normalizedAccount
    ? `${quoteKey}:${normalizedAccount.toUpperCase()}`
    : quoteKey
}

export function getQuoteLookupKey({
  ticker,
  market,
}: {
  ticker: string
  market: SupportedMarket
}) {
  return `${market}:${normalizeTicker(ticker)}`
}

export function inferSupportedMarket({
  ticker,
  currency,
}: {
  ticker: string
  currency: string | null
}): SupportedMarket | null {
  const normalizedTicker = normalizeTicker(ticker)
  const normalizedCurrency = normalizeCurrency(currency)

  if (TW_TICKER_PATTERN.test(normalizedTicker)) {
    return "TW"
  }

  if (US_TICKER_PATTERN.test(normalizedTicker)) {
    return "US"
  }

  if (CJK_PATTERN.test(normalizedTicker)) {
    return "TW"
  }

  if (normalizedCurrency === "TWD") {
    return "TW"
  }

  if (normalizedCurrency === "USD") {
    return "US"
  }

  return null
}

function sortTradesByDate(trades: PortfolioTradeRow[]) {
  return trades
    .map((trade, index) => ({ trade, index }))
    .sort((left, right) => {
      const byDate = left.trade.date.localeCompare(right.trade.date)

      if (byDate !== 0) {
        return byDate
      }

      return left.index - right.index
    })
}

type ResolvedHoldingTrade = {
  current: AggregatedHolding
  key: string
  ticker: string
}

function createAggregatedHolding({
  account,
  expectedCurrency,
  key,
  market,
  quoteKey,
  ticker,
}: {
  account: string | null
  expectedCurrency: string
  key: string
  market: SupportedMarket
  quoteKey: string
  ticker: string
}): AggregatedHolding {
  return {
    account,
    averageCost: 0,
    currency: expectedCurrency,
    key,
    market,
    quantityOpen: 0,
    quoteKey,
    ticker,
    totalCostOpen: 0,
  }
}

function resolveHoldingTrade(
  trade: PortfolioTradeRow,
  positions: Map<string, AggregatedHolding>
): ResolvedHoldingTrade | string {
  const ticker = normalizeTicker(trade.ticker)
  const market = inferSupportedMarket({
    ticker,
    currency: trade.currency,
  })

  if (!market) {
    return `${ticker}: only US and Taiwan markets are supported in this MVP.`
  }

  const expectedCurrency = getDefaultCurrency(market)
  const normalizedCurrency = normalizeCurrency(trade.currency)

  if (normalizedCurrency && normalizedCurrency !== expectedCurrency) {
    return `${ticker}: ${normalizedCurrency} transactions are outside the supported US/TW scope.`
  }

  const account = normalizeAccount(trade.account)
  const quoteKey = getQuoteLookupKey({ ticker, market })
  const key = getHoldingKey({ account, ticker, market })

  return {
    current:
      positions.get(key) ??
      createAggregatedHolding({
        account,
        expectedCurrency,
        key,
        market,
        quoteKey,
        ticker,
      }),
    key,
    ticker,
  }
}

function buildBoughtHolding(
  current: AggregatedHolding,
  trade: PortfolioTradeRow
): AggregatedHolding {
  const nextQuantity = current.quantityOpen + trade.quantity
  const nextCost = current.totalCostOpen + trade.totalAmount

  return {
    ...current,
    quantityOpen: roundNumber(nextQuantity),
    totalCostOpen: roundNumber(nextCost),
    averageCost: roundNumber(nextCost / nextQuantity),
  }
}

function buildSoldHolding(
  current: AggregatedHolding,
  trade: PortfolioTradeRow,
  ticker: string
): AggregatedHolding | null | string {
  if (trade.quantity > current.quantityOpen + FLOAT_EPSILON) {
    return `${ticker}: sell quantity exceeds open quantity, so this position is excluded from valuation.`
  }

  const currentAverageCost =
    current.quantityOpen > 0 ? current.totalCostOpen / current.quantityOpen : 0
  const nextQuantity = roundNumber(current.quantityOpen - trade.quantity)
  const nextCost = roundNumber(
    current.totalCostOpen - trade.quantity * currentAverageCost
  )

  if (nextQuantity <= FLOAT_EPSILON) {
    return null
  }

  return {
    ...current,
    quantityOpen: nextQuantity,
    totalCostOpen: nextCost,
    averageCost: roundNumber(nextCost / nextQuantity),
  }
}

export function aggregateHoldings(trades: PortfolioTradeRow[]) {
  const positions = new Map<string, AggregatedHolding>()
  const issues: string[] = []

  for (const { trade } of sortTradesByDate(trades)) {
    const resolvedTrade = resolveHoldingTrade(trade, positions)

    if (typeof resolvedTrade === "string") {
      issues.push(resolvedTrade)
      continue
    }

    const { current, key, ticker } = resolvedTrade

    if (trade.side === "BUY") {
      positions.set(key, buildBoughtHolding(current, trade))
      continue
    }

    const nextHolding = buildSoldHolding(current, trade, ticker)

    if (typeof nextHolding === "string") {
      issues.push(nextHolding)
      positions.delete(key)
      continue
    }

    if (nextHolding === null) {
      positions.delete(key)
      continue
    }

    positions.set(key, nextHolding)
  }

  const holdings = [...positions.values()].sort(compareAggregatedHoldings)

  return { holdings, issues }
}

export function applyPreviousCloseQuotes(
  holdings: AggregatedHolding[],
  quotesByKey: Record<string, PreviousCloseQuote>
) {
  const enriched = holdings.map((holding) =>
    buildValuedHolding(holding, quotesByKey[holding.quoteKey])
  )
  const canonicalHoldings = mergeCanonicalHoldings(enriched)

  const groupsByAccount = new Map<string, ValuedHolding[]>()

  for (const holding of canonicalHoldings) {
    const groupKey = getAccountLabel(holding.account)
    const group = groupsByAccount.get(groupKey) ?? []
    group.push(holding)
    groupsByAccount.set(groupKey, group)
  }

  const groups: PortfolioHoldingGroup[] = []
  const summaries: PortfolioSummary[] = []

  for (const [label, accountHoldings] of groupsByAccount.entries()) {
    const { group, summary } = buildAccountGroup(label, accountHoldings)
    groups.push(group)
    summaries.push(summary)
  }

  groups.sort((left, right) => left.label.localeCompare(right.label))
  summaries.sort((left, right) => left.label.localeCompare(right.label))

  return { groups, holdings: canonicalHoldings, summaries }
}
