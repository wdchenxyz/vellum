import { memo } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { TradeTableRow } from "@/lib/trades/schema"
import { TriangleAlert } from "lucide-react"

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 8,
})

function formatNumber(value: number | null) {
  if (value === null) {
    return "-"
  }

  return numberFormatter.format(value)
}

type TradesTableProps = {
  issues: string[]
  restoreIssue: string | null
  rows: TradeTableRow[]
  successMessage: string | null
}

function TradeSummaryCard({ row }: { row: TradeTableRow }) {
  return (
    <article className="rounded-lg border border-border/70 bg-background/80 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <p className="font-medium text-foreground">{row.ticker}</p>
          <p className="truncate text-xs text-muted-foreground">
            {row.sourceFile}
          </p>
        </div>
        <Badge variant={row.side === "BUY" ? "default" : "secondary"}>
          {row.side}
        </Badge>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Date</dt>
          <dd className="font-medium tabular-nums">{row.date}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Account</dt>
          <dd className="truncate font-medium">{row.account ?? "-"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Currency</dt>
          <dd className="font-medium tabular-nums">{row.currency ?? "-"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Quantity</dt>
          <dd className="tabular-nums">{formatNumber(row.quantity)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Price</dt>
          <dd className="tabular-nums">{formatNumber(row.price)}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-xs text-muted-foreground">Total</dt>
          <dd className="tabular-nums">{formatNumber(row.totalAmount)}</dd>
        </div>
      </dl>
    </article>
  )
}

export const TradesTable = memo(function TradesTable({
  issues,
  restoreIssue,
  rows,
  successMessage,
}: TradesTableProps) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs font-medium tracking-[0.16em] text-secondary-foreground uppercase">
            Review
          </p>
          <h2 className="text-lg font-medium tracking-tight">
            Review extracted trades
          </h2>
          <p className="text-sm text-muted-foreground">
            Confirm the typed rows before you move on to portfolio analysis.
          </p>
        </div>
        <p className="text-sm text-secondary-foreground/80">
          {rows.length} {rows.length === 1 ? "row" : "rows"} saved
        </p>
      </div>

      {successMessage ? (
        <Alert className="border-primary/20 bg-primary/10">
          <AlertTitle className="text-primary">Rows added</AlertTitle>
          <AlertDescription className="text-primary">
            {successMessage}
          </AlertDescription>
        </Alert>
      ) : null}

      {issues.length > 0 ? (
        <Alert
          className="border-destructive/30 bg-destructive/5"
          variant="destructive"
        >
          <TriangleAlert className="size-4" />
          <AlertTitle>Review these files</AlertTitle>
          <AlertDescription>
            <div className="flex flex-col gap-1">
              {issues.map((issue) => (
                <p key={issue}>{issue}</p>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {restoreIssue ? (
        <Alert
          className="border-destructive/30 bg-destructive/5"
          variant="destructive"
        >
          <TriangleAlert className="size-4" />
          <AlertTitle>Saved rows unavailable</AlertTitle>
          <AlertDescription>{restoreIssue}</AlertDescription>
        </Alert>
      ) : null}

      <div className="surface-review overflow-hidden rounded-xl border border-secondary/35 bg-background/95">
        {rows.length === 0 ? (
          <div className="px-4 py-12 text-center text-muted-foreground">
            Upload a confirmation above. Extracted rows land here.
          </div>
        ) : (
          <>
            <div className="space-y-3 p-3 md:hidden">
              {rows.map((row) => (
                <TradeSummaryCard key={row.id} row={row} />
              ))}
            </div>

            <div className="hidden md:block">
              <Table className="min-w-[840px]">
                <TableHeader className="bg-secondary/30">
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Ticker</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Side</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Currency</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium tabular-nums">
                        {row.date}
                      </TableCell>
                      <TableCell>
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="font-medium">{row.ticker}</span>
                          <span className="truncate text-xs text-muted-foreground">
                            {row.sourceFile}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="min-w-28">
                          <span className="text-sm text-foreground">
                            {row.account ?? "-"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={row.side === "BUY" ? "default" : "secondary"}
                        >
                          {row.side}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(row.quantity)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(row.price)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {row.currency ?? "-"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(row.totalAmount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </div>

      {rows.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Rows persist locally between refreshes.
        </p>
      ) : null}
    </section>
  )
})

TradesTable.displayName = "TradesTable"
