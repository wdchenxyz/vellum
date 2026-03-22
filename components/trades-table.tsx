import { memo, useCallback, useState } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { TradeTableRow } from "@/lib/trades/schema"
import { Trash2, TriangleAlert } from "lucide-react"

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 8,
})

function formatNumber(value: number | null) {
  if (value === null) {
    return "-"
  }

  return numberFormatter.format(value)
}

function DeleteTradeDialog({
  onConfirm,
  onOpenChange,
  open,
  row,
}: {
  onConfirm: () => Promise<void>
  onOpenChange: (open: boolean) => void
  open: boolean
  row: TradeTableRow | null
}) {
  const [isDeleting, setIsDeleting] = useState(false)

  async function handleDelete() {
    setIsDeleting(true)

    try {
      await onConfirm()
      onOpenChange(false)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Delete trade?</DialogTitle>
          {row ? (
            <DialogDescription>
              <span className="font-medium text-foreground">
                {row.side} {formatNumber(row.quantity)} {row.ticker}
              </span>{" "}
              on {row.date}. This cannot be undone.
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button disabled={isDeleting} variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button
            disabled={isDeleting}
            onClick={handleDelete}
            variant="destructive"
          >
            {isDeleting ? <Spinner className="size-3.5" /> : null}
            {isDeleting ? "Deleting..." : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type TradesTableProps = {
  issues: string[]
  onDelete: (id: string) => Promise<void>
  restoreIssue: string | null
  rows: TradeTableRow[]
  successMessage: string | null
}

function TradeSummaryCard({
  onDeleteClick,
  row,
}: {
  onDeleteClick: () => void
  row: TradeTableRow
}) {
  return (
    <article className="rounded-lg border border-border/70 bg-background/80 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <p className="font-medium text-foreground">{row.ticker}</p>
          <p className="truncate text-xs text-muted-foreground">
            {row.sourceFile}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant={row.side === "BUY" ? "default" : "secondary"}>
            {row.side}
          </Badge>
          <Button
            aria-label={`Delete ${row.ticker} trade`}
            className="text-muted-foreground hover:text-destructive"
            onClick={onDeleteClick}
            size="icon-xs"
            variant="ghost"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
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
  onDelete,
  restoreIssue,
  rows,
  successMessage,
}: TradesTableProps) {
  const [deleteTarget, setDeleteTarget] = useState<TradeTableRow | null>(null)

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setDeleteTarget(null)
    }
  }, [])

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) {
      return
    }

    await onDelete(deleteTarget.id)
  }, [deleteTarget, onDelete])

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
            No trades yet.
          </div>
        ) : (
          <>
            <div className="space-y-3 p-3 md:hidden">
              {rows.map((row) => (
                <TradeSummaryCard
                  key={row.id}
                  onDeleteClick={() => setDeleteTarget(row)}
                  row={row}
                />
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
                    <TableHead className="w-10">
                      <span className="sr-only">Actions</span>
                    </TableHead>
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
                      <TableCell>
                        <Button
                          aria-label={`Delete ${row.ticker} trade`}
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteTarget(row)}
                          size="icon-xs"
                          variant="ghost"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </div>

      <DeleteTradeDialog
        onConfirm={handleConfirmDelete}
        onOpenChange={handleOpenChange}
        open={deleteTarget !== null}
        row={deleteTarget}
      />
    </section>
  )
})

TradesTable.displayName = "TradesTable"
