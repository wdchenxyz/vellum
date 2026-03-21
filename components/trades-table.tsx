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

export function TradesTable({
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

      <div className="overflow-hidden rounded-xl border border-secondary/35 bg-[linear-gradient(180deg,rgba(255,253,249,0.96),rgba(249,244,236,0.92))] dark:bg-[linear-gradient(180deg,rgba(42,37,32,0.22),rgba(29,32,35,0.7))]">
        <Table className="min-w-[720px]">
          <TableHeader className="bg-secondary/30">
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Ticker</TableHead>
              <TableHead>Side</TableHead>
              <TableHead className="text-right">Quantity</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Currency</TableHead>
              <TableHead className="hidden text-right lg:table-cell">
                Fee
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  className="py-12 text-center text-muted-foreground"
                  colSpan={7}
                >
                  Upload a confirmation above. Extracted rows land here.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
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
                  <TableCell className="hidden text-right tabular-nums lg:table-cell">
                    {formatNumber(row.fee)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {rows.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Rows persist locally between refreshes.
        </p>
      ) : null}
    </section>
  )
}
