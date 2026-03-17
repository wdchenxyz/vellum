import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { TradeTableRow } from "@/lib/trades/schema"

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 8,
})

function formatNumber(value: number | null) {
  if (value === null) {
    return "-"
  }

  return numberFormatter.format(value)
}

export function TradesTable({ rows }: { rows: TradeTableRow[] }) {
  return (
    <Card className="border-border/70 bg-card/85 shadow-sm backdrop-blur-sm">
      <CardHeader>
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex-1">
            <CardTitle>Extracted transactions</CardTitle>
            <CardDescription>
              Every successful upload appends new rows to a local file-backed
              transaction log.
            </CardDescription>
          </div>
          <CardAction>
            <Badge variant="secondary">
              {rows.length} {rows.length === 1 ? "row" : "rows"}
            </Badge>
          </CardAction>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Ticker</TableHead>
              <TableHead>Side</TableHead>
              <TableHead className="text-right">Quantity</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Currency</TableHead>
              <TableHead className="text-right">Fee</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  className="py-12 text-center text-muted-foreground"
                  colSpan={7}
                >
                  Drop a trade confirmation or PDF above to start building the
                  table.
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
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(row.fee)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
          <TableCaption>
            Transactions are mirrored to a local JSON file so they survive page
            refreshes in this MVP.
          </TableCaption>
        </Table>
      </CardContent>
    </Card>
  )
}
