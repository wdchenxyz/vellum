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

const TW_TICKER_PATTERN = /^\d{4,6}[A-Z]?$/
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
  const currency =
    normalizeCurrency(quote?.currency ?? null) ?? holding.currency
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

type ResolvedHoldingIdentity = {
  account: string | null
  expectedCurrency: string
  key: string
  market: SupportedMarket
  quoteKey: string
  ticker: string
}

type HoldingAggregationIssue = {
  message: string
  recoverableSameDayOversell: boolean
}

function isHoldingAggregationIssue(
  value:
    | AggregatedHolding
    | HoldingAggregationIssue
    | ResolvedHoldingIdentity
    | ResolvedHoldingTrade
    | null
): value is HoldingAggregationIssue {
  return value !== null && "message" in value
}

function createUnsupportedHoldingIssue(
  message: string
): HoldingAggregationIssue {
  return {
    message,
    recoverableSameDayOversell: false,
  }
}

function createSameDayOversellIssue(ticker: string): HoldingAggregationIssue {
  return {
    message: `${ticker}: sell quantity exceeds open quantity, so this position is excluded from valuation.`,
    recoverableSameDayOversell: true,
  }
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

function resolveHoldingIdentity(
  trade: PortfolioTradeRow
): HoldingAggregationIssue | ResolvedHoldingIdentity {
  const ticker = normalizeTicker(trade.ticker)
  const market = inferSupportedMarket({
    ticker,
    currency: trade.currency,
  })

  if (!market) {
    return createUnsupportedHoldingIssue(
      `${ticker}: only US and Taiwan markets are supported in this MVP.`
    )
  }

  const expectedCurrency = getDefaultCurrency(market)
  const normalizedCurrency = normalizeCurrency(trade.currency)

  if (normalizedCurrency && normalizedCurrency !== expectedCurrency) {
    return createUnsupportedHoldingIssue(
      `${ticker}: ${normalizedCurrency} transactions are outside the supported US/TW scope.`
    )
  }

  const account = normalizeAccount(trade.account)
  const quoteKey = getQuoteLookupKey({ ticker, market })
  const key = getHoldingKey({ account, ticker, market })

  return {
    account,
    expectedCurrency,
    key,
    market,
    quoteKey,
    ticker,
  }
}

function resolveHoldingTrade(
  trade: PortfolioTradeRow,
  positions: Map<string, AggregatedHolding>
): HoldingAggregationIssue | ResolvedHoldingTrade {
  const identity = resolveHoldingIdentity(trade)

  if (isHoldingAggregationIssue(identity)) {
    return identity
  }

  return {
    current:
      positions.get(identity.key) ??
      createAggregatedHolding({
        account: identity.account,
        expectedCurrency: identity.expectedCurrency,
        key: identity.key,
        market: identity.market,
        quoteKey: identity.quoteKey,
        ticker: identity.ticker,
      }),
    key: identity.key,
    ticker: identity.ticker,
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
): AggregatedHolding | HoldingAggregationIssue | null {
  if (trade.quantity > current.quantityOpen + FLOAT_EPSILON) {
    return createSameDayOversellIssue(ticker)
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

function applyTradeToPositions(
  trade: PortfolioTradeRow,
  positions: Map<string, AggregatedHolding>
) {
  const resolvedTrade = resolveHoldingTrade(trade, positions)

  if (isHoldingAggregationIssue(resolvedTrade)) {
    return resolvedTrade
  }

  const { current, key, ticker } = resolvedTrade

  if (trade.side === "BUY") {
    positions.set(key, buildBoughtHolding(current, trade))
    return null
  }

  const nextHolding = buildSoldHolding(current, trade, ticker)

  if (isHoldingAggregationIssue(nextHolding)) {
    positions.delete(key)
    return nextHolding
  }

  if (nextHolding === null) {
    positions.delete(key)
    return null
  }

  positions.set(key, nextHolding)
  return null
}

function applyTradesToPositions(
  trades: PortfolioTradeRow[],
  initialPositions: Map<string, AggregatedHolding>
) {
  const positions = new Map(initialPositions)
  const issues: HoldingAggregationIssue[] = []

  for (const trade of trades) {
    const issue = applyTradeToPositions(trade, positions)

    if (issue) {
      issues.push(issue)
    }
  }

  return { issues, positions }
}

function countRecoverableSameDayOversells(issues: HoldingAggregationIssue[]) {
  return issues.filter((issue) => issue.recoverableSameDayOversell).length
}

function orderBuysBeforeSells(trades: PortfolioTradeRow[]) {
  return trades
    .map((trade, index) => ({ index, trade }))
    .sort((left, right) => {
      if (left.trade.side !== right.trade.side) {
        return left.trade.side === "BUY" ? -1 : 1
      }

      return left.index - right.index
    })
    .map(({ trade }) => trade)
}

function applySameDayHoldingTrades(
  trades: PortfolioTradeRow[],
  initialPositions: Map<string, AggregatedHolding>
) {
  const originalResult = applyTradesToPositions(trades, initialPositions)
  const originalOversellCount = countRecoverableSameDayOversells(
    originalResult.issues
  )

  if (originalOversellCount === 0) {
    return originalResult
  }

  const reorderedResult = applyTradesToPositions(
    orderBuysBeforeSells(trades),
    initialPositions
  )
  const reorderedOversellCount = countRecoverableSameDayOversells(
    reorderedResult.issues
  )

  return reorderedOversellCount < originalOversellCount
    ? reorderedResult
    : originalResult
}

function applySameDateTrades(
  trades: PortfolioTradeRow[],
  initialPositions: Map<string, AggregatedHolding>
) {
  const entries: Array<
    | { issue: HoldingAggregationIssue; type: "issue" }
    | { key: string; type: "group" }
  > = []
  const groupedTrades = new Map<string, PortfolioTradeRow[]>()

  for (const trade of trades) {
    const identity = resolveHoldingIdentity(trade)

    if (isHoldingAggregationIssue(identity)) {
      entries.push({ issue: identity, type: "issue" })
      continue
    }

    const group = groupedTrades.get(identity.key)

    if (group) {
      group.push(trade)
      continue
    }

    groupedTrades.set(identity.key, [trade])
    entries.push({ key: identity.key, type: "group" })
  }

  let positions = initialPositions
  const issues: HoldingAggregationIssue[] = []

  for (const entry of entries) {
    if (entry.type === "issue") {
      issues.push(entry.issue)
      continue
    }

    const result = applySameDayHoldingTrades(
      groupedTrades.get(entry.key) ?? [],
      positions
    )
    positions = result.positions
    issues.push(...result.issues)
  }

  return { issues, positions }
}

export function aggregateHoldings(trades: PortfolioTradeRow[]) {
  let positions = new Map<string, AggregatedHolding>()
  const issues: string[] = []
  const sortedTrades = sortTradesByDate(trades)

  for (let index = 0; index < sortedTrades.length; ) {
    const date = sortedTrades[index].trade.date
    const sameDateTrades: PortfolioTradeRow[] = []

    while (
      index < sortedTrades.length &&
      sortedTrades[index].trade.date === date
    ) {
      sameDateTrades.push(sortedTrades[index].trade)
      index += 1
    }

    const result = applySameDateTrades(sameDateTrades, positions)
    positions = result.positions
    issues.push(...result.issues.map((issue) => issue.message))
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
