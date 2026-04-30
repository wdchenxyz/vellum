"use client"

import { useEffect, useMemo, useState } from "react"
import { Cell, Pie, PieChart } from "recharts"
import { CircleAlert, Pencil, RefreshCcw } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ChartContainer, ChartTooltip } from "@/components/ui/chart"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import {
  exposureProfilesResponseSchema,
  getExposureProfileKey,
  upsertExposureProfileResponseSchema,
  type ExposureDirection,
  type ExposureReviewStatus,
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
  type SupportedMarket,
  type FxRateSnapshot,
  type PreviousCloseLookupTarget,
  type PreviousCloseQuote,
} from "@/lib/portfolio/schema"
import type { TradeTableRow } from "@/lib/trades/schema"
import { cn } from "@/lib/utils"

type LoadStatus = "idle" | "loading" | "ready" | "error"

type AllocationDatum = {
  fill: string
  holdings: string[]
  key: string
  marketValue: number
  ticker: string
  value: number
  weight: number
}

type ExposureProfileFormState = {
  exposureDirection: ExposureDirection
  exposureMultiplier: string
  instrumentName: string
  market: SupportedMarket
  notes: string
  reviewStatus: ExposureReviewStatus
  source: string
  ticker: string
  underlyingMarket: SupportedMarket
  underlyingTicker: string
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

const percentFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
  style: "percent",
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

function formatUsd(value: number | null) {
  if (value === null) {
    return "-"
  }

  return usdFormatter.format(value)
}

function formatPreciseUsd(value: number | null) {
  if (value === null) {
    return "-"
  }

  return preciseUsdFormatter.format(value)
}

function formatPercent(value: number | null) {
  if (value === null) {
    return "-"
  }

  return percentFormatter.format(value)
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
  const date = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day))
  )

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
  signal,
  targets,
}: {
  signal: AbortSignal
  targets: PreviousCloseLookupTarget[]
}) {
  const quotes: PreviousCloseQuote[] = []

  for (const batch of chunkTargets(targets)) {
    const response = await fetch("/api/quotes/previous-close", {
      body: JSON.stringify({ targets: batch }),
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

async function fetchFxSnapshot(signal: AbortSignal) {
  const response = await fetch("/api/quotes/fx-rate", {
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

async function saveExposureProfile(
  profile: UpsertInstrumentExposureProfile
) {
  const response = await fetch("/api/portfolio/exposure-profiles", {
    body: JSON.stringify({ profile }),
    headers: { "Content-Type": "application/json" },
    method: "PUT",
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  const payload = await response.json()
  const parsed = upsertExposureProfileResponseSchema.safeParse(payload)

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

function getHoldingSubtitle(holding: SnapshotHolding) {
  return [holding.account, holding.market].filter(Boolean).join(" - ")
}

function getProfileForHolding(
  holding: SnapshotHolding,
  profilesByKey: Map<string, InstrumentExposureProfile>
) {
  return profilesByKey.get(
    getExposureProfileKey({
      market: holding.market,
      ticker: holding.quoteTicker ?? holding.ticker,
    })
  )
}

function buildProfileFormState({
  holding,
  profile,
}: {
  holding: SnapshotHolding
  profile: InstrumentExposureProfile | undefined
}): ExposureProfileFormState {
  const ticker = (holding.quoteTicker ?? holding.ticker).trim().toUpperCase()

  return {
    exposureDirection: profile?.exposureDirection ?? "long",
    exposureMultiplier: String(profile?.exposureMultiplier ?? 1),
    instrumentName: profile?.instrumentName ?? "",
    market: profile?.market ?? holding.market,
    notes: profile?.notes ?? "",
    reviewStatus: profile?.reviewStatus ?? "reviewed",
    source: profile?.source ?? "user",
    ticker: profile?.ticker ?? ticker,
    underlyingMarket: profile?.underlyingMarket ?? holding.market,
    underlyingTicker: profile?.underlyingTicker ?? ticker,
  }
}

function formStateToProfile(
  formState: ExposureProfileFormState
): UpsertInstrumentExposureProfile | string {
  const multiplier = Number(formState.exposureMultiplier)
  const ticker = formState.ticker.trim().toUpperCase()
  const underlyingTicker = formState.underlyingTicker.trim().toUpperCase()

  if (!ticker) {
    return "Ticker is required."
  }

  if (!underlyingTicker) {
    return "Underlying ticker is required."
  }

  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    return "Multiplier must be a positive number."
  }

  return {
    exposureDirection: formState.exposureDirection,
    exposureMultiplier: multiplier,
    instrumentName: formState.instrumentName.trim() || null,
    market: formState.market,
    notes: formState.notes.trim() || null,
    reviewStatus: formState.reviewStatus,
    source: formState.source.trim() || "user",
    ticker,
    underlyingMarket: formState.underlyingMarket,
    underlyingTicker,
  }
}

function AllocationTooltip({
  active,
  payload,
}: {
  active?: boolean
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
          {formatPreciseUsd(datum.value)}
        </span>
      </div>
      <div className="flex justify-between gap-4 text-muted-foreground">
        <span>Capital</span>
        <span className="font-medium text-foreground tabular-nums">
          {formatPreciseUsd(datum.marketValue)}
        </span>
      </div>
      <div className="flex justify-between gap-4 text-muted-foreground">
        <span>Weight</span>
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
          Open holdings from confirmation history will appear here after
          records are added.
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
    ...(quoteStatus === "error" && quoteIssue
      ? [`Prices: ${quoteIssue}`]
      : []),
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
  snapshot,
}: {
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
      weight: group.weight ?? 0,
    }))
  const dateLabel = formatDateRange(snapshot.quoteDates)
  const fxLabel = formatDate(snapshot.fxAsOf)
  const effectiveLongTotal = chartData.reduce(
    (total, datum) => total + datum.value,
    0
  )

  return (
    <div className="rounded-lg border border-border/70 bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 flex-1 gap-2">
          <p className="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">
            Total portfolio value
          </p>
          <div className="text-4xl font-semibold tracking-tight text-foreground tabular-nums sm:text-5xl">
            {formatUsd(snapshot.totalUsd)}
          </div>
          <p className="hidden text-xs text-muted-foreground sm:block">
            {snapshot.isComplete
              ? `Long effective exposure ${formatUsd(effectiveLongTotal)}.`
              : "Partial USD value from available market data."}
          </p>
        </div>

        <div className="flex w-full flex-wrap justify-start gap-2 sm:w-auto sm:justify-end">
          {dateLabel ? <Badge variant="outline">Prices {dateLabel}</Badge> : null}
          {fxLabel ? <Badge variant="outline">FX {fxLabel}</Badge> : null}
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
                    content={<AllocationTooltip />}
                    cursor={false}
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
                    100%
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Long exposure
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

function HoldingsPanel({
  holdings,
  onEditExposure,
}: {
  holdings: SnapshotHolding[]
  onEditExposure: (holding: SnapshotHolding) => void
}) {
  const visibleHoldings = holdings.slice(0, 8)
  const hiddenCount = holdings.length - visibleHoldings.length

  return (
    <div className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <h3 className="text-sm font-semibold">Holdings</h3>
        <span className="text-xs text-muted-foreground">
          Value (USD) and weight
        </span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Holding</TableHead>
            <TableHead className="text-right">Value</TableHead>
            <TableHead className="text-right">Weight</TableHead>
            <TableHead className="w-10">
              <span className="sr-only">Exposure profile</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleHoldings.map((holding, index) => {
            const label = getHoldingLabel(holding)

            return (
              <TableRow key={holding.key}>
                <TableCell>
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: getColor(index) }}
                    />
                    <div className="grid min-w-0 gap-0.5">
                      <span className="truncate font-medium">
                        {label.primary}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {[label.secondary, getHoldingSubtitle(holding)]
                          .filter(Boolean)
                          .join(" - ")}
                      </span>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatUsd(holding.marketValueUsd)}
                </TableCell>
                <TableCell className="text-right text-muted-foreground tabular-nums">
                  {formatPercent(holding.weight)}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    onClick={() => onEditExposure(holding)}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <Pencil className="size-3.5" />
                    <span className="sr-only">
                      Edit exposure profile for {holding.ticker}
                    </span>
                  </Button>
                </TableCell>
              </TableRow>
            )
          })}
          {hiddenCount > 0 ? (
            <TableRow>
              <TableCell
                className="text-xs text-muted-foreground"
                colSpan={4}
              >
                {hiddenCount} more holdings in confirmation history.
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </div>
  )
}

function ExposureProfileDialog({
  issue,
  onOpenChange,
  onSave,
  open,
  saving,
  state,
  setState,
}: {
  issue: string | null
  onOpenChange: (open: boolean) => void
  onSave: () => void
  open: boolean
  saving: boolean
  state: ExposureProfileFormState | null
  setState: (state: ExposureProfileFormState) => void
}) {
  if (!state) {
    return null
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Exposure profile</DialogTitle>
          <DialogDescription>
            Edit how this holding contributes to effective exposure.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {issue ? (
            <Alert variant="destructive">
              <CircleAlert className="size-4" />
              <AlertTitle>Unable to save profile</AlertTitle>
              <AlertDescription>{issue}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium">
              Held ticker
              <Input readOnly value={state.ticker} />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Underlying ticker
              <Input
                onChange={(event) =>
                  setState({
                    ...state,
                    underlyingTicker: event.currentTarget.value,
                  })
                }
                value={state.underlyingTicker}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Multiplier
              <Input
                min="0.01"
                onChange={(event) =>
                  setState({
                    ...state,
                    exposureMultiplier: event.currentTarget.value,
                  })
                }
                step="0.01"
                type="number"
                value={state.exposureMultiplier}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Direction
              <Select
                onValueChange={(value) =>
                  setState({
                    ...state,
                    exposureDirection: value as ExposureDirection,
                  })
                }
                value={state.exposureDirection}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="long">Long</SelectItem>
                  <SelectItem value="inverse">Inverse</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Review status
              <Select
                onValueChange={(value) =>
                  setState({
                    ...state,
                    reviewStatus: value as ExposureReviewStatus,
                  })
                }
                value={state.reviewStatus}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="reviewed">Reviewed</SelectItem>
                  <SelectItem value="unreviewed">Unreviewed</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Source
              <Input
                onChange={(event) =>
                  setState({
                    ...state,
                    source: event.currentTarget.value,
                  })
                }
                value={state.source}
              />
            </label>
          </div>

          <label className="grid gap-1.5 text-sm font-medium">
            Instrument name
            <Input
              onChange={(event) =>
                setState({
                  ...state,
                  instrumentName: event.currentTarget.value,
                })
              }
              value={state.instrumentName}
            />
          </label>

          <label className="grid gap-1.5 text-sm font-medium">
            Notes
            <Textarea
              onChange={(event) =>
                setState({
                  ...state,
                  notes: event.currentTarget.value,
                })
              }
              value={state.notes}
            />
          </label>
        </div>

        <DialogFooter>
          <Button
            disabled={saving}
            onClick={onSave}
            type="button"
          >
            Save profile
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const [profileFormState, setProfileFormState] =
    useState<ExposureProfileFormState | null>(null)
  const [profileDialogOpen, setProfileDialogOpen] = useState(false)
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileSaveIssue, setProfileSaveIssue] = useState<string | null>(null)
  const [refreshIndex, setRefreshIndex] = useState(0)

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
  const exposureProfilesByKey = useMemo(
    () =>
      new Map(
        exposureProfiles.map((profile) => [
          getExposureProfileKey({
            market: profile.market,
            ticker: profile.ticker,
          }),
          profile,
        ])
      ),
    [exposureProfiles]
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

  function handleEditExposure(holding: SnapshotHolding) {
    setProfileSaveIssue(null)
    setProfileFormState(
      buildProfileFormState({
        holding,
        profile: getProfileForHolding(holding, exposureProfilesByKey),
      })
    )
    setProfileDialogOpen(true)
  }

  async function handleSaveExposureProfile() {
    if (!profileFormState) {
      return
    }

    const nextProfile = formStateToProfile(profileFormState)

    if (typeof nextProfile === "string") {
      setProfileSaveIssue(nextProfile)
      return
    }

    setProfileSaving(true)
    setProfileSaveIssue(null)

    try {
      const savedProfile = await saveExposureProfile(nextProfile)
      const savedKey = getExposureProfileKey({
        market: savedProfile.market,
        ticker: savedProfile.ticker,
      })

      setExposureProfiles((current) => {
        const nextByKey = new Map(
          current.map((profile) => [
            getExposureProfileKey({
              market: profile.market,
              ticker: profile.ticker,
            }),
            profile,
          ])
        )

        nextByKey.set(savedKey, savedProfile)

        return [...nextByKey.values()].sort((left, right) =>
          `${left.market}:${left.ticker}`.localeCompare(
            `${right.market}:${right.ticker}`
          )
        )
      })
      setProfileDialogOpen(false)
      setProfileFormState(null)
    } catch (error) {
      setProfileSaveIssue(getErrorMessage(error))
    } finally {
      setProfileSaving(false)
    }
  }

  useEffect(() => {
    if (quoteTargets.length === 0) {
      return
    }

    const controller = new AbortController()
    let timedOut = false
    const timeoutId = window.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, MARKET_DATA_TIMEOUT_MS)

    async function loadQuotes() {
      setQuoteStatus("loading")
      setQuoteIssue(null)

      try {
        const nextQuotesByKey = await fetchQuoteMap({
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
            ? "Previous close prices timed out after 15 seconds."
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
  }, [quoteTargets, refreshIndex])

  useEffect(() => {
    if (!hasTwdHoldings) {
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
        const nextFxSnapshot = await fetchFxSnapshot(controller.signal)

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
  }, [hasTwdHoldings, refreshIndex])

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
          <p className="hidden max-w-2xl text-sm text-muted-foreground sm:block">
            Latest EOD prices with USD/TWD conversion when needed.
          </p>
        </div>

        <div className="flex w-full flex-wrap items-center justify-start gap-2 sm:w-auto sm:justify-end">
          <SnapshotStatusBadge
            fxStatus={effectiveFxStatus}
            hasTwdHoldings={hasTwdHoldings}
            quoteStatus={quoteStatus}
          />
          <Badge variant="outline">Base USD</Badge>
          <Button
            disabled={isLoading || quoteTargets.length === 0}
            onClick={() => setRefreshIndex((current) => current + 1)}
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
        <AllocationPanel snapshot={snapshot} />
        <div className="grid content-start gap-4">
          <HoldingsPanel
            holdings={snapshot.holdings}
            onEditExposure={handleEditExposure}
          />
        </div>
      </div>
      <ExposureProfileDialog
        issue={profileSaveIssue}
        onOpenChange={(open) => {
          setProfileDialogOpen(open)

          if (!open) {
            setProfileFormState(null)
            setProfileSaveIssue(null)
          }
        }}
        onSave={handleSaveExposureProfile}
        open={profileDialogOpen}
        saving={profileSaving}
        state={profileFormState}
        setState={setProfileFormState}
      />
    </section>
  )
}
