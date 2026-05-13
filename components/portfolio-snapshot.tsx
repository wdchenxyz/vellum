"use client"

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { Cell, Pie, PieChart } from "recharts"
import { CircleAlert, Pencil, RefreshCcw } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import { ChartContainer, ChartTooltip } from "@/components/ui/chart"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  exposureProfileResponseSchema,
  exposureProfilesResponseSchema,
  getExposureProfileKey,
  type ExposureDirection,
  type InstrumentExposureProfile,
  type UpsertInstrumentExposureProfile,
} from "@/lib/portfolio/exposure-profiles"
import {
  aggregateHoldings,
  applyPreviousCloseQuotes,
} from "@/lib/portfolio/holdings"
import {
  buildCurrentPortfolioSnapshot,
  type CurrentPortfolioSnapshot,
  type SnapshotHolding,
} from "@/lib/portfolio/current-snapshot"
import {
  fxRateResponseSchema,
  previousCloseResponseSchema,
  type FxRateSnapshot,
  type PreviousCloseLookupTarget,
  type PreviousCloseQuote,
  type SupportedMarket,
} from "@/lib/portfolio/schema"
import type { TradeTableRow } from "@/lib/trades/schema"
import { cn } from "@/lib/utils"

type LoadStatus = "idle" | "loading" | "ready" | "error"
type BaseCurrency = "USD" | "TWD"

type AllocationDatum = {
  fill: string
  holdings: string[]
  key: string
  marketValue: number
  ticker: string
  value: number
  weight: number
}

type MergedHoldingAccount = {
  account: string
  marketValueUsd: number | null
  quantityOpen: number
}

type MergedSnapshotHolding = SnapshotHolding & {
  accountBreakdown: MergedHoldingAccount[]
}

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-2)",
  "var(--chart-5)",
  "oklch(0.58 0.12 205)",
  "oklch(0.62 0.16 15)",
]
const MARKET_DATA_TIMEOUT_MS = 15_000
const FORCE_MARKET_DATA_TIMEOUT_MS = 60_000
const MARKET_OPTIONS: SupportedMarket[] = ["US", "TW"]
const EXPOSURE_DIRECTION_OPTIONS: ExposureDirection[] = ["long", "inverse"]

const chartConfig = {
  value: {
    label: "Value",
    color: "var(--chart-1)",
  },
}

const usdFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 0,
  style: "currency",
})

const preciseUsdFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  style: "currency",
})

const twdFormatter = new Intl.NumberFormat("zh-TW", {
  currency: "TWD",
  maximumFractionDigits: 0,
  style: "currency",
})

const preciseTwdFormatter = new Intl.NumberFormat("zh-TW", {
  currency: "TWD",
  maximumFractionDigits: 2,
  style: "currency",
})

const percentFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
  style: "percent",
})

const quantityFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 8,
})

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return "The request failed."
}

async function readErrorMessage(response: Response) {
  const payload = await response.json().catch(() => null)

  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error
  }

  return `Request failed with status ${response.status}.`
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError"
}

function convertUsdToBase(
  usdValue: number | null,
  baseCurrency: BaseCurrency,
  fxRate: number | null
) {
  if (usdValue === null) {
    return null
  }

  if (baseCurrency === "USD") {
    return usdValue
  }

  if (fxRate === null) {
    return null
  }

  return usdValue * fxRate
}

function formatBase(
  usdValue: number | null,
  baseCurrency: BaseCurrency,
  fxRate: number | null
) {
  const value = convertUsdToBase(usdValue, baseCurrency, fxRate)

  if (value === null) {
    return "-"
  }

  return baseCurrency === "USD"
    ? usdFormatter.format(value)
    : twdFormatter.format(value)
}

function formatPreciseBase(
  usdValue: number | null,
  baseCurrency: BaseCurrency,
  fxRate: number | null
) {
  const value = convertUsdToBase(usdValue, baseCurrency, fxRate)

  if (value === null) {
    return "-"
  }

  return baseCurrency === "USD"
    ? preciseUsdFormatter.format(value)
    : preciseTwdFormatter.format(value)
}

function formatPercent(value: number | null) {
  if (value === null) {
    return "-"
  }

  return percentFormatter.format(value)
}

function formatQuantity(value: number) {
  return quantityFormatter.format(value)
}

function formatMultiplier(value: number) {
  const absoluteValue = Math.abs(value)

  if (Number.isInteger(absoluteValue)) {
    return absoluteValue.toString()
  }

  return absoluteValue.toFixed(2).replace(/\.?0+$/, "")
}

function getExposureProfileTicker(holding: SnapshotHolding) {
  return (holding.quoteTicker ?? holding.ticker).trim().toUpperCase()
}

function formatExposureLabel(holding: SnapshotHolding) {
  const prefix = holding.exposureDirection === "inverse" ? "-" : ""

  return `${prefix}${formatMultiplier(holding.effectiveMultiplier)}x ${
    holding.exposureUnderlyingTicker
  }`
}

function getExposureProfileSourceLabel(holding: SnapshotHolding) {
  if (!holding.exposureProfileSource) {
    return "Default"
  }

  if (holding.exposureProfileSource === "user") {
    return "Custom"
  }

  if (holding.exposureProfileSource === "seed") {
    return "Seed"
  }

  return holding.exposureProfileSource
}

function formatDate(value: string | null) {
  if (!value) {
    return null
  }

  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)

  if (!dateMatch) {
    return value
  }

  const [, year, month, day] = dateMatch
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date)
}

function formatDateRange(dates: string[]) {
  if (dates.length === 0) {
    return null
  }

  const first = formatDate(dates[0])
  const last = formatDate(dates[dates.length - 1])

  if (!first || first === last) {
    return first
  }

  return `${first} - ${last}`
}

function getColor(index: number) {
  return CHART_COLORS[index % CHART_COLORS.length]
}

function chunkTargets(targets: PreviousCloseLookupTarget[]) {
  const chunks: PreviousCloseLookupTarget[][] = []

  for (let index = 0; index < targets.length; index += 40) {
    chunks.push(targets.slice(index, index + 40))
  }

  return chunks
}

async function fetchQuoteMap({
  forceRefresh = false,
  signal,
  targets,
}: {
  forceRefresh?: boolean
  signal: AbortSignal
  targets: PreviousCloseLookupTarget[]
}) {
  const quotes: PreviousCloseQuote[] = []

  for (const batch of chunkTargets(targets)) {
    const response = await fetch("/api/quotes/previous-close", {
      body: JSON.stringify({
        forceRefresh,
        returnCachedImmediately: !forceRefresh,
        targets: batch,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal,
    })

    if (!response.ok) {
      throw new Error(await readErrorMessage(response))
    }

    const payload = await response.json()
    const parsed = previousCloseResponseSchema.safeParse(payload)

    if (!parsed.success) {
      throw new Error("The server returned an unexpected price response.")
    }

    quotes.push(...parsed.data.quotes)
  }

  return Object.fromEntries(
    quotes.map((quote) => [quote.key, quote])
  ) as Record<string, PreviousCloseQuote>
}

async function fetchFxSnapshot(signal: AbortSignal, forceRefresh = false) {
  const url = forceRefresh
    ? "/api/quotes/fx-rate?forceRefresh=true"
    : "/api/quotes/fx-rate"
  const response = await fetch(url, {
    cache: "no-store",
    signal,
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  const payload = await response.json()
  const parsed = fxRateResponseSchema.safeParse(payload)

  if (!parsed.success) {
    throw new Error("The server returned an unexpected FX response.")
  }

  return parsed.data.snapshot
}

async function fetchExposureProfiles(signal: AbortSignal) {
  const response = await fetch("/api/portfolio/exposure-profiles", {
    cache: "no-store",
    signal,
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  const payload = await response.json()
  const parsed = exposureProfilesResponseSchema.safeParse(payload)

  if (!parsed.success) {
    throw new Error("The server returned an unexpected exposure response.")
  }

  return parsed.data.profiles
}

async function saveExposureProfile(profile: UpsertInstrumentExposureProfile) {
  const response = await fetch("/api/portfolio/exposure-profiles", {
    body: JSON.stringify(profile),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  const payload = await response.json()
  const parsed = exposureProfileResponseSchema.safeParse(payload)

  if (!parsed.success) {
    throw new Error("The server returned an unexpected exposure response.")
  }

  return parsed.data.profile
}

function buildQuoteTargets(
  holdings: ReturnType<typeof aggregateHoldings>["holdings"]
) {
  const targetsByKey = new Map<string, PreviousCloseLookupTarget>()

  for (const holding of holdings) {
    targetsByKey.set(holding.quoteKey, {
      market: holding.market,
      ticker: holding.ticker,
    })
  }

  return [...targetsByKey.values()]
}

function getHoldingLabel(holding: SnapshotHolding) {
  if (holding.quoteTicker && holding.quoteTicker !== holding.ticker) {
    return {
      primary: holding.ticker,
      secondary: holding.quoteTicker,
    }
  }

  return {
    primary: holding.ticker,
    secondary: null,
  }
}

function roundDisplayNumber(value: number) {
  return Number(value.toFixed(10))
}

function sumNullableValues(values: Array<number | null>) {
  let total = 0

  for (const value of values) {
    if (value === null) {
      return null
    }

    total += value
  }

  return roundDisplayNumber(total)
}

function compareMergedHoldings(
  left: MergedSnapshotHolding,
  right: MergedSnapshotHolding
) {
  if (left.weight !== null && right.weight !== null) {
    return right.weight - left.weight
  }

  if (left.effectiveValueUsd !== null && right.effectiveValueUsd !== null) {
    return right.effectiveValueUsd - left.effectiveValueUsd
  }

  if (left.effectiveValueUsd !== null) {
    return -1
  }

  if (right.effectiveValueUsd !== null) {
    return 1
  }

  return getExposureProfileTicker(left).localeCompare(
    getExposureProfileTicker(right)
  )
}

function mergeHoldingAccounts(holdings: SnapshotHolding[]) {
  const accounts = new Map<string, MergedHoldingAccount>()

  for (const holding of holdings) {
    const account = holding.account ?? "Unassigned account"
    const existing = accounts.get(account)

    accounts.set(account, {
      account,
      marketValueUsd:
        existing === undefined
          ? holding.marketValueUsd
          : sumNullableValues([
              existing.marketValueUsd,
              holding.marketValueUsd,
            ]),
      quantityOpen: roundDisplayNumber(
        (existing?.quantityOpen ?? 0) + holding.quantityOpen
      ),
    })
  }

  return [...accounts.values()].sort((left, right) => {
    if (left.marketValueUsd !== null && right.marketValueUsd !== null) {
      return right.marketValueUsd - left.marketValueUsd
    }

    if (left.marketValueUsd !== null) {
      return -1
    }

    if (right.marketValueUsd !== null) {
      return 1
    }

    return left.account.localeCompare(right.account)
  })
}

function mergeSnapshotHoldings(holdings: SnapshotHolding[]) {
  const groups = new Map<string, SnapshotHolding[]>()

  for (const holding of holdings) {
    const key = `${holding.market}:${getExposureProfileTicker(holding)}`
    const existing = groups.get(key)

    if (existing) {
      existing.push(holding)
    } else {
      groups.set(key, [holding])
    }
  }

  return [...groups.values()]
    .map<MergedSnapshotHolding>((group) => {
      const [representative] = group
      const marketValueUsd = sumNullableValues(
        group.map((holding) => holding.marketValueUsd)
      )
      const effectiveValueUsd = sumNullableValues(
        group.map((holding) => holding.effectiveValueUsd)
      )

      return {
        ...representative,
        account: null,
        accountBreakdown: mergeHoldingAccounts(group),
        effectiveValueUsd,
        key: `${representative.market}:${getExposureProfileTicker(representative)}`,
        marketValue: sumNullableValues(
          group.map((holding) => holding.marketValue)
        ),
        marketValueUsd,
        quantityOpen: roundDisplayNumber(
          group.reduce((total, holding) => total + holding.quantityOpen, 0)
        ),
        weight: sumNullableValues(group.map((holding) => holding.weight)),
      }
    })
    .sort(compareMergedHoldings)
}

function AllocationTooltip({
  active,
  baseCurrency,
  fxRate,
  payload,
}: {
  active?: boolean
  baseCurrency: BaseCurrency
  fxRate: number | null
  payload?: Array<{ payload: AllocationDatum }>
}) {
  if (!active || !payload?.length) {
    return null
  }

  const datum = payload[0].payload

  return (
    <div className="grid min-w-40 gap-1 rounded-lg border border-border/70 bg-background px-3 py-2 text-xs shadow-lg">
      <div className="flex items-center gap-2 font-medium">
        <span
          className="size-2 rounded-full"
          style={{ backgroundColor: datum.fill }}
        />
        {datum.ticker}
      </div>
      <div className="flex justify-between gap-4 text-muted-foreground">
        <span>Effective</span>
        <span className="font-medium text-foreground tabular-nums">
          {formatPreciseBase(datum.value, baseCurrency, fxRate)}
        </span>
      </div>
      <div className="flex justify-between gap-4 text-muted-foreground">
        <span>Capital</span>
        <span className="font-medium text-foreground tabular-nums">
          {formatPreciseBase(datum.marketValue, baseCurrency, fxRate)}
        </span>
      </div>
      <div className="flex justify-between gap-4 text-muted-foreground">
        <span>Exposure</span>
        <span className="font-medium text-foreground tabular-nums">
          {formatPercent(datum.weight)}
        </span>
      </div>
      {datum.holdings.length > 1 ? (
        <div className="max-w-56 text-muted-foreground">
          From {datum.holdings.join(", ")}
        </div>
      ) : null}
    </div>
  )
}

function EmptySnapshot() {
  return (
    <div className="rounded-lg border border-dashed border-border/80 bg-card/60 px-4 py-6">
      <div className="grid gap-1">
        <h2
          className="text-base font-semibold tracking-tight"
          id="portfolio-snapshot-heading"
        >
          Current portfolio
        </h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Open holdings from confirmation history will appear here after records
          are added.
        </p>
      </div>
    </div>
  )
}

function SnapshotAlert({
  aggregateIssues,
  fxIssue,
  fxStatus,
  profileIssue,
  profileStatus,
  quoteIssue,
  quoteStatus,
  snapshot,
}: {
  aggregateIssues: string[]
  fxIssue: string | null
  fxStatus: LoadStatus
  profileIssue: string | null
  profileStatus: LoadStatus
  quoteIssue: string | null
  quoteStatus: LoadStatus
  snapshot: CurrentPortfolioSnapshot
}) {
  const quoteErrors = snapshot.holdings
    .filter((holding) => holding.quoteError)
    .map((holding) => `${holding.ticker}: ${holding.quoteError}`)
  const messages = [
    ...aggregateIssues,
    ...(quoteStatus === "error" && quoteIssue ? [`Prices: ${quoteIssue}`] : []),
    ...(fxStatus === "error" && fxIssue ? [`FX: ${fxIssue}`] : []),
    ...(profileStatus === "error" && profileIssue
      ? [`Exposure profiles: ${profileIssue}`]
      : []),
    ...quoteErrors,
    ...(snapshot.missingPriceCount > 0
      ? [
          `${snapshot.missingPriceCount} holding ${
            snapshot.missingPriceCount === 1 ? "is" : "are"
          } missing EOD price data.`,
        ]
      : []),
    ...(snapshot.missingFxCount > 0
      ? [
          `${snapshot.missingFxCount} holding ${
            snapshot.missingFxCount === 1 ? "needs" : "need"
          } USD/TWD FX conversion.`,
        ]
      : []),
    ...snapshot.exposureIssues.map((issue) => issue.message),
  ]

  if (messages.length === 0) {
    return null
  }

  return (
    <Alert className="border-chart-2/30 bg-chart-2/5">
      <CircleAlert className="size-4 text-chart-2" />
      <AlertTitle>Snapshot needs attention</AlertTitle>
      <AlertDescription>
        <div className="grid gap-1">
          {messages.slice(0, 4).map((message) => (
            <p key={message}>{message}</p>
          ))}
          {messages.length > 4 ? (
            <p>{messages.length - 4} more issues hidden.</p>
          ) : null}
        </div>
      </AlertDescription>
    </Alert>
  )
}

function AllocationPanel({
  baseCurrency,
  fxRate,
  snapshot,
}: {
  baseCurrency: BaseCurrency
  fxRate: number | null
  snapshot: CurrentPortfolioSnapshot
}) {
  const chartData = snapshot.exposureGroups
    .filter((group) => group.weight !== null)
    .map<AllocationDatum>((group, index) => ({
      fill: getColor(index),
      holdings: group.holdings,
      key: group.key,
      marketValue: group.marketValueUsd,
      ticker: group.ticker,
      value: group.effectiveValueUsd,
      weight:
        snapshot.totalUsd > 0 ? group.effectiveValueUsd / snapshot.totalUsd : 0,
    }))
  const dateLabel = formatDateRange(snapshot.quoteDates)
  const fxLabel = formatDate(snapshot.fxAsOf)
  const effectiveLongTotal = chartData.reduce(
    (total, datum) => total + datum.value,
    0
  )
  const grossExposure =
    snapshot.totalUsd > 0 ? effectiveLongTotal / snapshot.totalUsd : null

  return (
    <div className="rounded-lg border border-border/70 bg-card p-4 shadow-sm">
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <p className="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">
            Total portfolio value
          </p>
          <div className="flex flex-wrap justify-start gap-2 sm:justify-end">
            {dateLabel ? (
              <Badge variant="outline">Prices {dateLabel}</Badge>
            ) : null}
            {fxLabel ? <Badge variant="outline">FX {fxLabel}</Badge> : null}
          </div>
        </div>
        <div className="text-4xl font-semibold tracking-tight text-foreground tabular-nums sm:text-5xl">
          {formatBase(snapshot.totalUsd, baseCurrency, fxRate)}
        </div>
      </div>

      <div className="mt-5 grid items-center gap-5 lg:grid-cols-[minmax(15rem,1fr)_minmax(10rem,0.55fr)]">
        <div className="relative min-h-[17rem]">
          {chartData.length > 0 ? (
            <>
              <ChartContainer
                className="mx-auto aspect-square h-[17rem] max-h-[22rem] w-full"
                config={chartConfig}
              >
                <PieChart>
                  <ChartTooltip
                    allowEscapeViewBox={{ x: true, y: true }}
                    content={
                      <AllocationTooltip
                        baseCurrency={baseCurrency}
                        fxRate={fxRate}
                      />
                    }
                    cursor={false}
                    position={{ x: 12, y: 12 }}
                    wrapperStyle={{ zIndex: 30 }}
                  />
                  <Pie
                    data={chartData}
                    dataKey="value"
                    innerRadius="56%"
                    nameKey="ticker"
                    outerRadius="88%"
                    paddingAngle={1}
                    stroke="var(--card)"
                    strokeWidth={2}
                  >
                    {chartData.map((entry) => (
                      <Cell fill={entry.fill} key={entry.key} />
                    ))}
                  </Pie>
                </PieChart>
              </ChartContainer>
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="grid text-center">
                  <span className="text-2xl font-semibold tabular-nums">
                    {formatPercent(grossExposure)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Gross exposure
                  </span>
                </div>
              </div>
            </>
          ) : (
            <div className="flex min-h-[17rem] items-center justify-center rounded-lg border border-dashed border-border/80 text-sm text-muted-foreground">
              Waiting for EOD prices
            </div>
          )}
        </div>

        <div className="grid gap-2">
          {chartData.slice(0, 7).map((datum) => (
            <div
              className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 text-sm"
              key={datum.key}
            >
              <span
                className="size-2.5 rounded-full"
                style={{ backgroundColor: datum.fill }}
              />
              <span className="truncate font-medium">{datum.ticker}</span>
              <span className="text-muted-foreground tabular-nums">
                {formatPercent(datum.weight)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ExposureProfileEditor({
  holding,
  onSave,
}: {
  holding: SnapshotHolding
  onSave: (
    profile: UpsertInstrumentExposureProfile
  ) => Promise<InstrumentExposureProfile>
}) {
  const profileTicker = getExposureProfileTicker(holding)
  const [open, setOpen] = useState(false)
  const [underlyingTicker, setUnderlyingTicker] = useState(
    holding.exposureUnderlyingTicker
  )
  const [underlyingMarket, setUnderlyingMarket] = useState<SupportedMarket>(
    holding.exposureUnderlyingMarket
  )
  const [exposureMultiplier, setExposureMultiplier] = useState(
    formatMultiplier(holding.effectiveMultiplier)
  )
  const [exposureDirection, setExposureDirection] = useState<ExposureDirection>(
    holding.exposureDirection
  )
  const [saveStatus, setSaveStatus] = useState<LoadStatus>("idle")
  const [saveIssue, setSaveIssue] = useState<string | null>(null)

  function resetForm() {
    setUnderlyingTicker(holding.exposureUnderlyingTicker)
    setUnderlyingMarket(holding.exposureUnderlyingMarket)
    setExposureMultiplier(formatMultiplier(holding.effectiveMultiplier))
    setExposureDirection(holding.exposureDirection)
    setSaveIssue(null)
    setSaveStatus("idle")
  }

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      resetForm()
    } else {
      setSaveIssue(null)
      setSaveStatus("idle")
    }

    setOpen(nextOpen)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmedUnderlyingTicker = underlyingTicker.trim().toUpperCase()
    const parsedMultiplier = Number(exposureMultiplier)

    if (!trimmedUnderlyingTicker) {
      setSaveIssue("Enter an underlying ticker.")
      return
    }

    if (!Number.isFinite(parsedMultiplier) || parsedMultiplier <= 0) {
      setSaveIssue("Enter a positive exposure multiple.")
      return
    }

    setSaveStatus("loading")
    setSaveIssue(null)

    try {
      await onSave({
        exposureDirection,
        exposureMultiplier: parsedMultiplier,
        instrumentName: `${profileTicker} exposure profile`,
        market: holding.market,
        notes: "Set from holdings panel.",
        source: "user",
        ticker: profileTicker,
        underlyingMarket,
        underlyingTicker: trimmedUnderlyingTicker,
      })
      setSaveStatus("ready")
      setOpen(false)
    } catch (error) {
      setSaveIssue(getErrorMessage(error))
      setSaveStatus("error")
    }
  }

  return (
    <Sheet onOpenChange={handleOpenChange} open={open}>
      <SheetTrigger asChild>
        <Button
          aria-label={`Edit exposure profile for ${profileTicker}`}
          className="text-muted-foreground hover:text-foreground"
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          <Pencil className="size-3" />
        </Button>
      </SheetTrigger>
      <SheetContent
        className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-sm"
        side="right"
      >
        <SheetHeader className="border-b">
          <SheetTitle>{profileTicker} exposure</SheetTitle>
          <SheetDescription>
            Override the multiple and underlying used in gross exposure.
          </SheetDescription>
        </SheetHeader>

        <form
          className="flex flex-1 flex-col gap-5 px-4 pb-4"
          onSubmit={handleSubmit}
        >
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/30 px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">
              Profile type
            </span>
            <Badge
              variant={
                holding.exposureProfileSource === "user"
                  ? "secondary"
                  : "outline"
              }
            >
              {getExposureProfileSourceLabel(holding)}
            </Badge>
          </div>

          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <label
                className="text-xs font-medium text-muted-foreground"
                htmlFor={`${holding.key}-underlying-ticker`}
              >
                Underlying ticker
              </label>
              <Input
                autoComplete="off"
                id={`${holding.key}-underlying-ticker`}
                onChange={(event) => setUnderlyingTicker(event.target.value)}
                placeholder={profileTicker}
                value={underlyingTicker}
              />
            </div>

            <div className="grid gap-1.5">
              <label
                className="text-xs font-medium text-muted-foreground"
                htmlFor={`${holding.key}-underlying-market`}
              >
                Underlying market
              </label>
              <Select
                onValueChange={(value) =>
                  setUnderlyingMarket(value as SupportedMarket)
                }
                value={underlyingMarket}
              >
                <SelectTrigger
                  className="w-full"
                  id={`${holding.key}-underlying-market`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MARKET_OPTIONS.map((market) => (
                    <SelectItem key={market} value={market}>
                      {market}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
              <div className="grid gap-1.5">
                <label
                  className="text-xs font-medium text-muted-foreground"
                  htmlFor={`${holding.key}-exposure-multiple`}
                >
                  Multiple
                </label>
                <Input
                  id={`${holding.key}-exposure-multiple`}
                  inputMode="decimal"
                  min="0.01"
                  onChange={(event) =>
                    setExposureMultiplier(event.target.value)
                  }
                  step="0.01"
                  type="number"
                  value={exposureMultiplier}
                />
              </div>

              <div className="grid gap-1.5">
                <label
                  className="text-xs font-medium text-muted-foreground"
                  htmlFor={`${holding.key}-exposure-direction`}
                >
                  Direction
                </label>
                <Select
                  onValueChange={(value) =>
                    setExposureDirection(value as ExposureDirection)
                  }
                  value={exposureDirection}
                >
                  <SelectTrigger
                    className="w-full"
                    id={`${holding.key}-exposure-direction`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPOSURE_DIRECTION_OPTIONS.map((direction) => (
                      <SelectItem key={direction} value={direction}>
                        {direction === "long" ? "Long" : "Inverse"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {saveIssue ? (
            <Alert
              className="border-destructive/30 bg-destructive/5"
              variant="destructive"
            >
              <CircleAlert className="size-4" />
              <AlertTitle>Exposure not saved</AlertTitle>
              <AlertDescription>{saveIssue}</AlertDescription>
            </Alert>
          ) : null}

          <SheetFooter className="mt-auto border-t px-0 pb-0">
            <Button disabled={saveStatus === "loading"} type="submit">
              {saveStatus === "loading" ? "Saving..." : "Save profile"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

function HoldingsPanel({
  baseCurrency,
  fxRate,
  holdings,
  onSaveExposureProfile,
}: {
  baseCurrency: BaseCurrency
  fxRate: number | null
  holdings: SnapshotHolding[]
  onSaveExposureProfile: (
    profile: UpsertInstrumentExposureProfile
  ) => Promise<InstrumentExposureProfile>
}) {
  const [editingExposure, setEditingExposure] = useState(false)
  const [hoveredHoldingKey, setHoveredHoldingKey] = useState<string | null>(
    null
  )
  const [isHoldingsScrollbarVisible, setIsHoldingsScrollbarVisible] =
    useState(false)
  const scrollbarVisibilityTimeout = useRef<ReturnType<
    typeof setTimeout
  > | null>(null)
  const scrollbarVisibleRef = useRef(false)
  const handleHoldingsScroll = useCallback(() => {
    if (!scrollbarVisibleRef.current) {
      scrollbarVisibleRef.current = true
      setIsHoldingsScrollbarVisible(true)
    }

    if (scrollbarVisibilityTimeout.current) {
      clearTimeout(scrollbarVisibilityTimeout.current)
    }

    scrollbarVisibilityTimeout.current = setTimeout(() => {
      scrollbarVisibleRef.current = false
      setIsHoldingsScrollbarVisible(false)
    }, 700)
  }, [])

  useEffect(
    () => () => {
      if (scrollbarVisibilityTimeout.current) {
        clearTimeout(scrollbarVisibilityTimeout.current)
      }
    },
    []
  )
  const mergedHoldings = useMemo(
    () => mergeSnapshotHoldings(holdings),
    [holdings]
  )

  return (
    <div className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="grid gap-0.5">
          <h3 className="text-sm font-semibold">Holdings</h3>
          <span className="text-xs text-muted-foreground">
            Value ({baseCurrency}), weight, and exposure
          </span>
        </div>
        <ButtonGroup>
          <Button
            aria-label="Toggle exposure editing"
            aria-pressed={editingExposure}
            onClick={() => setEditingExposure((current) => !current)}
            size="icon-xs"
            type="button"
            variant={editingExposure ? "secondary" : "outline"}
          >
            <Pencil className="size-3" />
          </Button>
        </ButtonGroup>
      </div>
      <Table
        containerClassName={cn(
          "holdings-scrollbar max-h-[28rem] overflow-y-auto",
          isHoldingsScrollbarVisible && "holdings-scrollbar-visible"
        )}
        containerProps={{
          "aria-label": "Holdings list",
          onScroll: handleHoldingsScroll,
          tabIndex: 0,
        }}
      >
        <TableHeader className="sticky top-0 z-10 bg-card shadow-sm">
          <TableRow>
            <TableHead>Holding</TableHead>
            <TableHead className="text-right">Value</TableHead>
            <TableHead className="text-right">Weight</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {mergedHoldings.map((holding, index) => {
            const label = getHoldingLabel(holding)
            const showExposureBadge =
              Math.abs(holding.effectiveMultiplier) !== 1

            return (
              <TableRow
                className="group/holding-row"
                key={holding.key}
                onMouseEnter={() => setHoveredHoldingKey(holding.key)}
                onMouseLeave={() =>
                  setHoveredHoldingKey((current) =>
                    current === holding.key ? null : current
                  )
                }
              >
                <TableCell>
                  <HoverCard open={hoveredHoldingKey === holding.key}>
                    <HoverCardTrigger asChild>
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: getColor(index) }}
                        />
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="min-w-0 truncate font-medium">
                            {label.primary}
                          </span>
                          {showExposureBadge ? (
                            <Badge
                              className="max-w-[8rem] shrink-0 justify-start"
                              variant={
                                holding.exposureProfileSource === "user"
                                  ? "secondary"
                                  : "outline"
                              }
                            >
                              <span className="truncate">
                                {formatExposureLabel(holding)}
                              </span>
                            </Badge>
                          ) : null}
                          {editingExposure ? (
                            <ExposureProfileEditor
                              holding={holding}
                              onSave={onSaveExposureProfile}
                            />
                          ) : null}
                        </div>
                      </div>
                    </HoverCardTrigger>
                    <HoverCardContent
                      align="start"
                      className="w-72"
                      side="bottom"
                    >
                      <HoldingAccountBreakdown
                        baseCurrency={baseCurrency}
                        fxRate={fxRate}
                        holding={holding}
                      />
                    </HoverCardContent>
                  </HoverCard>
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatBase(holding.marketValueUsd, baseCurrency, fxRate)}
                </TableCell>
                <TableCell className="text-right text-muted-foreground tabular-nums">
                  {formatPercent(holding.weight)}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function SnapshotStatusBadge({
  fxStatus,
  hasTwdHoldings,
  quoteStatus,
}: {
  fxStatus: LoadStatus
  hasTwdHoldings: boolean
  quoteStatus: LoadStatus
}) {
  if (quoteStatus === "loading" || fxStatus === "loading") {
    return <Badge variant="outline">Loading market data</Badge>
  }

  if (quoteStatus === "error" || fxStatus === "error") {
    return <Badge variant="destructive">Market data issue</Badge>
  }

  if (quoteStatus === "ready" && (!hasTwdHoldings || fxStatus === "ready")) {
    return <Badge variant="secondary">EOD snapshot</Badge>
  }

  return <Badge variant="outline">Market data pending</Badge>
}

function HoldingAccountBreakdown({
  baseCurrency,
  fxRate,
  holding,
}: {
  baseCurrency: BaseCurrency
  fxRate: number | null
  holding: MergedSnapshotHolding
}) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <p className="truncate text-sm font-medium">
          {getExposureProfileTicker(holding)}
        </p>
        <span className="shrink-0 text-xs text-muted-foreground">
          {holding.accountBreakdown.length}{" "}
          {holding.accountBreakdown.length === 1 ? "account" : "accounts"}
        </span>
      </div>

      <div className="grid gap-1">
        {holding.accountBreakdown.map((account) => (
          <div
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md bg-muted/35 px-2 py-1.5 text-xs"
            key={account.account}
          >
            <span className="truncate text-muted-foreground">
              {account.account}
            </span>
            <span className="flex flex-col items-end gap-0.5">
              <span className="font-medium tabular-nums">
                {formatQuantity(account.quantityOpen)}
              </span>
              <span className="text-[0.7rem] leading-none text-muted-foreground tabular-nums">
                {formatBase(account.marketValueUsd, baseCurrency, fxRate)}
              </span>
            </span>
          </div>
        ))}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-border/70 px-2 pt-2 text-xs">
          <span className="truncate font-medium">Net quantity</span>
          <span className="font-semibold tabular-nums">
            {formatQuantity(holding.quantityOpen)}
          </span>
        </div>
      </div>
    </div>
  )
}

export function PortfolioSnapshot({ rows }: { rows: TradeTableRow[] }) {
  const [quotesByKey, setQuotesByKey] = useState<
    Record<string, PreviousCloseQuote>
  >({})
  const [quoteStatus, setQuoteStatus] = useState<LoadStatus>("idle")
  const [quoteIssue, setQuoteIssue] = useState<string | null>(null)
  const [fxSnapshot, setFxSnapshot] = useState<FxRateSnapshot | null>(null)
  const [fxStatus, setFxStatus] = useState<LoadStatus>("idle")
  const [fxIssue, setFxIssue] = useState<string | null>(null)
  const [exposureProfiles, setExposureProfiles] = useState<
    InstrumentExposureProfile[]
  >([])
  const [profileStatus, setProfileStatus] = useState<LoadStatus>("idle")
  const [profileIssue, setProfileIssue] = useState<string | null>(null)
  const [refreshRequest, setRefreshRequest] = useState({
    forceQuoteRefresh: false,
    index: 0,
  })
  const [baseCurrency, setBaseCurrency] = useState<BaseCurrency>("USD")
  const { forceQuoteRefresh, index: refreshIndex } = refreshRequest

  const aggregated = useMemo(() => aggregateHoldings(rows), [rows])
  const quoteTargets = useMemo(
    () => buildQuoteTargets(aggregated.holdings),
    [aggregated.holdings]
  )
  const hasTwdHoldings = useMemo(
    () => aggregated.holdings.some((holding) => holding.currency === "TWD"),
    [aggregated.holdings]
  )
  const valuedHoldings = useMemo(
    () => applyPreviousCloseQuotes(aggregated.holdings, quotesByKey).holdings,
    [aggregated.holdings, quotesByKey]
  )
  const effectiveFxSnapshot = hasTwdHoldings ? fxSnapshot : null
  const effectiveFxStatus = hasTwdHoldings ? fxStatus : "idle"
  const snapshot = useMemo(
    () =>
      buildCurrentPortfolioSnapshot({
        exposureProfiles,
        fxSnapshot: effectiveFxSnapshot,
        holdings: valuedHoldings,
      }),
    [effectiveFxSnapshot, exposureProfiles, valuedHoldings]
  )
  const isLoading =
    quoteStatus === "loading" ||
    effectiveFxStatus === "loading" ||
    profileStatus === "loading"

  const handleSaveExposureProfile = useCallback(
    async (profile: UpsertInstrumentExposureProfile) => {
      const savedProfile = await saveExposureProfile(profile)
      const savedKey = getExposureProfileKey({
        market: savedProfile.market,
        ticker: savedProfile.ticker,
      })

      setExposureProfiles((currentProfiles) => {
        const nextProfilesByKey = new Map(
          currentProfiles.map((currentProfile) => [
            getExposureProfileKey({
              market: currentProfile.market,
              ticker: currentProfile.ticker,
            }),
            currentProfile,
          ])
        )

        nextProfilesByKey.set(savedKey, savedProfile)

        return [...nextProfilesByKey.values()].sort((left, right) =>
          getExposureProfileKey({
            market: left.market,
            ticker: left.ticker,
          }).localeCompare(
            getExposureProfileKey({
              market: right.market,
              ticker: right.ticker,
            })
          )
        )
      })
      setProfileIssue(null)
      setProfileStatus("ready")

      return savedProfile
    },
    []
  )

  useEffect(() => {
    if (quoteTargets.length === 0) {
      return
    }

    const controller = new AbortController()
    let timedOut = false
    const timeoutMs = forceQuoteRefresh
      ? FORCE_MARKET_DATA_TIMEOUT_MS
      : MARKET_DATA_TIMEOUT_MS
    const timeoutId = window.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)

    async function loadQuotes() {
      setQuoteStatus("loading")
      setQuoteIssue(null)

      try {
        const nextQuotesByKey = await fetchQuoteMap({
          forceRefresh: forceQuoteRefresh,
          signal: controller.signal,
          targets: quoteTargets,
        })

        setQuotesByKey(nextQuotesByKey)
        setQuoteStatus("ready")
      } catch (error) {
        if (isAbortError(error) && !timedOut) {
          return
        }

        setQuoteIssue(
          timedOut
            ? `Previous close prices timed out after ${Math.round(timeoutMs / 1000)} seconds.`
            : getErrorMessage(error)
        )
        setQuoteStatus("error")
      } finally {
        window.clearTimeout(timeoutId)
      }
    }

    void loadQuotes()

    return () => {
      window.clearTimeout(timeoutId)
      controller.abort()
    }
  }, [forceQuoteRefresh, quoteTargets, refreshIndex])

  const needsFxRate = hasTwdHoldings || baseCurrency === "TWD"

  useEffect(() => {
    if (!needsFxRate) {
      return
    }

    const controller = new AbortController()
    let timedOut = false
    const timeoutId = window.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, MARKET_DATA_TIMEOUT_MS)

    async function loadFxRate() {
      setFxStatus("loading")
      setFxIssue(null)

      try {
        const nextFxSnapshot = await fetchFxSnapshot(
          controller.signal,
          forceQuoteRefresh
        )

        setFxSnapshot(nextFxSnapshot)
        setFxStatus("ready")
      } catch (error) {
        if (isAbortError(error) && !timedOut) {
          return
        }

        setFxIssue(
          timedOut
            ? "USD/TWD FX timed out after 15 seconds."
            : getErrorMessage(error)
        )
        setFxStatus("error")
      } finally {
        window.clearTimeout(timeoutId)
      }
    }

    void loadFxRate()

    return () => {
      window.clearTimeout(timeoutId)
      controller.abort()
    }
  }, [forceQuoteRefresh, needsFxRate, refreshIndex])

  useEffect(() => {
    if (aggregated.holdings.length === 0) {
      return
    }

    const controller = new AbortController()

    async function loadExposureProfiles() {
      setProfileStatus("loading")
      setProfileIssue(null)

      try {
        const profiles = await fetchExposureProfiles(controller.signal)

        setExposureProfiles(profiles)
        setProfileStatus("ready")
      } catch (error) {
        if (isAbortError(error)) {
          return
        }

        setProfileIssue(getErrorMessage(error))
        setProfileStatus("error")
      }
    }

    void loadExposureProfiles()

    return () => {
      controller.abort()
    }
  }, [aggregated.holdings.length, refreshIndex])

  if (rows.length === 0 || aggregated.holdings.length === 0) {
    return <EmptySnapshot />
  }

  return (
    <section
      aria-labelledby="portfolio-snapshot-heading"
      className="grid gap-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 flex-1 gap-1">
          <p className="text-xs font-medium tracking-[0.16em] text-primary uppercase">
            Portfolio
          </p>
          <h2
            className="text-xl font-semibold tracking-tight"
            id="portfolio-snapshot-heading"
          >
            Current portfolio
          </h2>
        </div>

        <div className="flex w-full flex-wrap items-center justify-start gap-2 sm:w-auto sm:justify-end">
          <SnapshotStatusBadge
            fxStatus={effectiveFxStatus}
            hasTwdHoldings={hasTwdHoldings}
            quoteStatus={quoteStatus}
          />
          <Button
            aria-label={`Switch base currency (currently ${baseCurrency})`}
            aria-pressed={baseCurrency === "TWD"}
            disabled={
              baseCurrency === "USD" &&
              (fxSnapshot === null || fxStatus === "error")
            }
            onClick={() =>
              setBaseCurrency((current) => (current === "USD" ? "TWD" : "USD"))
            }
            size="sm"
            type="button"
            variant="outline"
          >
            Base {baseCurrency}
          </Button>
          <Button
            disabled={isLoading || quoteTargets.length === 0}
            onClick={() =>
              setRefreshRequest((current) => ({
                forceQuoteRefresh: true,
                index: current.index + 1,
              }))
            }
            size="sm"
            type="button"
            variant="outline"
          >
            <RefreshCcw
              className={cn("size-3.5", isLoading && "animate-spin")}
              data-icon="inline-start"
            />
            <span className="sr-only">Refresh EOD</span>
            <span aria-hidden="true" className="hidden sm:inline">
              Refresh EOD
            </span>
          </Button>
        </div>
      </div>

      <SnapshotAlert
        aggregateIssues={aggregated.issues}
        fxIssue={hasTwdHoldings ? fxIssue : null}
        fxStatus={effectiveFxStatus}
        profileIssue={profileIssue}
        profileStatus={profileStatus}
        quoteIssue={quoteIssue}
        quoteStatus={quoteStatus}
        snapshot={snapshot}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(22rem,0.9fr)]">
        <AllocationPanel
          baseCurrency={baseCurrency}
          fxRate={fxSnapshot?.rate ?? null}
          snapshot={snapshot}
        />
        <div className="grid content-start gap-4">
          <HoldingsPanel
            baseCurrency={baseCurrency}
            fxRate={fxSnapshot?.rate ?? null}
            holdings={snapshot.holdings}
            onSaveExposureProfile={handleSaveExposureProfile}
          />
        </div>
      </div>
    </section>
  )
}
