import { FormEvent, memo, useCallback, useEffect, useState } from "react"

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
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  computeTradeTotalAmount,
  type TradeTableRow,
} from "@/lib/trades/schema"
import { Pencil, Trash2, TriangleAlert } from "lucide-react"

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 8,
})

const tradeDatePattern = /^\d{4}-\d{2}-\d{2}$/

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

type EditTradeFormState = {
  account: string
  currency: string
  date: string
  price: string
  quantity: string
  side: TradeTableRow["side"]
  ticker: string
}

function getEditTradeFormState(row: TradeTableRow | null): EditTradeFormState {
  return {
    account: row?.account ?? "",
    currency: row?.currency ?? "",
    date: row?.date ?? "",
    price: row ? String(row.price) : "",
    quantity: row ? String(row.quantity) : "",
    side: row?.side ?? "BUY",
    ticker: row?.ticker ?? "",
  }
}

function parsePositiveField(value: string, label: string) {
  const parsed = Number(value)

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return `${label} must be a positive number.`
  }

  return parsed
}

function nullableTrimmed(value: string) {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function deriveTradeFee(row: TradeTableRow) {
  const base = row.quantity * row.price
  const delta = row.side === "BUY" ? row.totalAmount - base : base - row.totalAmount
  return Math.max(0, Number(delta.toFixed(8)))
}

function buildEditedTradeRow(
  source: TradeTableRow,
  form: EditTradeFormState
): TradeTableRow | string {
  const date = form.date.trim()
  const ticker = form.ticker.trim().toUpperCase()

  if (!date) {
    return "Enter a trade date."
  }

  if (!tradeDatePattern.test(date)) {
    return "Use YYYY-MM-DD for the trade date."
  }

  if (!ticker) {
    return "Enter a ticker."
  }

  const quantity = parsePositiveField(form.quantity, "Quantity")

  if (typeof quantity === "string") {
    return quantity
  }

  const price = parsePositiveField(form.price, "Price")

  if (typeof price === "string") {
    return price
  }

  return {
    account: nullableTrimmed(form.account),
    currency: nullableTrimmed(form.currency)?.toUpperCase() ?? null,
    date,
    id: source.id,
    price,
    quantity,
    side: form.side,
    sourceFile: source.sourceFile,
    ticker,
    totalAmount: computeTradeTotalAmount({
      fee: deriveTradeFee(source),
      price,
      quantity,
      side: form.side,
    }),
  }
}

function EditTradeDialog({
  onOpenChange,
  onSave,
  open,
  row,
}: {
  onOpenChange: (open: boolean) => void
  onSave: (row: TradeTableRow) => Promise<void>
  open: boolean
  row: TradeTableRow | null
}) {
  const [form, setForm] = useState<EditTradeFormState>(() =>
    getEditTradeFormState(row)
  )
  const [issue, setIssue] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const parsedQuantity = Number(form.quantity)
  const parsedPrice = Number(form.price)
  const preservedFee = row ? deriveTradeFee(row) : 0
  const derivedTotalAmount =
    Number.isFinite(parsedQuantity) &&
    parsedQuantity > 0 &&
    Number.isFinite(parsedPrice) &&
    parsedPrice > 0
      ? computeTradeTotalAmount({
          fee: preservedFee,
          price: parsedPrice,
          quantity: parsedQuantity,
          side: form.side,
        })
      : null

  useEffect(() => {
    if (open) {
      setForm(getEditTradeFormState(row))
      setIssue(null)
      setIsSaving(false)
    }
  }, [open, row])

  function updateForm<Key extends keyof EditTradeFormState>(
    key: Key,
    value: EditTradeFormState[Key]
  ) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!row) {
      return
    }

    const nextRow = buildEditedTradeRow(row, form)

    if (typeof nextRow === "string") {
      setIssue(nextRow)
      return
    }

    setIsSaving(true)
    setIssue(null)

    try {
      await onSave(nextRow)
      onOpenChange(false)
    } catch (error) {
      setIssue(error instanceof Error ? error.message : "Unable to save trade.")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-lg">
        <form className="grid gap-5" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit trade</DialogTitle>
            {row ? (
              <DialogDescription>
                Correct the saved trade details used by holdings and portfolio
                calculations.
              </DialogDescription>
            ) : null}
          </DialogHeader>

          {issue ? (
            <Alert
              className="border-destructive/30 bg-destructive/5"
              variant="destructive"
            >
              <TriangleAlert className="size-4" />
              <AlertTitle>Trade not saved</AlertTitle>
              <AlertDescription>{issue}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium">
              Date
              <Input
                onChange={(event) => updateForm("date", event.target.value)}
                type="date"
                value={form.date}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Ticker
              <Input
                autoCapitalize="characters"
                onChange={(event) =>
                  updateForm("ticker", event.target.value.toUpperCase())
                }
                value={form.ticker}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Account
              <Input
                onChange={(event) => updateForm("account", event.target.value)}
                placeholder="Unassigned"
                value={form.account}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Side
              <Select
                onValueChange={(value) =>
                  updateForm("side", value as TradeTableRow["side"])
                }
                value={form.side}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BUY">BUY</SelectItem>
                  <SelectItem value="SELL">SELL</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Quantity
              <Input
                inputMode="decimal"
                min="0"
                onChange={(event) => updateForm("quantity", event.target.value)}
                step="any"
                type="number"
                value={form.quantity}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Price
              <Input
                inputMode="decimal"
                min="0"
                onChange={(event) => updateForm("price", event.target.value)}
                step="any"
                type="number"
                value={form.price}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Currency
              <Input
                autoCapitalize="characters"
                onChange={(event) =>
                  updateForm("currency", event.target.value.toUpperCase())
                }
                placeholder="Unknown"
                value={form.currency}
              />
            </label>
            <div className="grid gap-1.5 text-sm font-medium">
              <span>Total amount</span>
              <span className="text-muted-foreground text-sm font-normal tabular-nums">
                {formatNumber(derivedTotalAmount)}
              </span>
              <span className="text-muted-foreground text-xs font-normal">
                {preservedFee > 0
                  ? `Computed from quantity × price ${
                      form.side === "BUY" ? "+" : "−"
                    } ${formatNumber(preservedFee)} fee.`
                  : "Computed from quantity × price."}
              </span>
            </div>
            <div className="grid gap-1.5 text-sm font-medium sm:col-span-2">
              <span>Source file</span>
              <span className="text-muted-foreground text-sm font-normal break-all">
                {row?.sourceFile ?? "—"}
              </span>
            </div>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button disabled={isSaving} type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button disabled={isSaving} type="submit">
              {isSaving ? <Spinner className="size-3.5" /> : null}
              {isSaving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

type TradesTableProps = {
  historyIssue: string | null
  issues: string[]
  onDelete: (id: string) => Promise<void>
  onUpdate: (row: TradeTableRow) => Promise<void>
  rows: TradeTableRow[]
  successMessage: string | null
}

function TradeSummaryCard({
  onDeleteClick,
  onEditClick,
  row,
}: {
  onDeleteClick: () => void
  onEditClick: () => void
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
            aria-label={`Edit ${row.ticker} trade`}
            className="text-muted-foreground hover:text-foreground"
            onClick={onEditClick}
            size="icon-xs"
            variant="ghost"
          >
            <Pencil className="size-3.5" />
          </Button>
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
  historyIssue,
  issues,
  onDelete,
  onUpdate,
  rows,
  successMessage,
}: TradesTableProps) {
  const [deleteTarget, setDeleteTarget] = useState<TradeTableRow | null>(null)
  const [editTarget, setEditTarget] = useState<TradeTableRow | null>(null)

  const handleDeleteOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setDeleteTarget(null)
    }
  }, [])

  const handleEditOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setEditTarget(null)
    }
  }, [])

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) {
      return
    }

    await onDelete(deleteTarget.id)
  }, [deleteTarget, onDelete])

  const handleSaveEdit = useCallback(
    async (row: TradeTableRow) => {
      await onUpdate(row)
    },
    [onUpdate]
  )

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs font-medium tracking-[0.16em] text-secondary-foreground uppercase">
            Review
          </p>
          <h2 className="text-lg font-medium tracking-tight">
            History confirmation records
          </h2>
        </div>
        <p className="text-sm text-secondary-foreground/80">
          {rows.length} {rows.length === 1 ? "record" : "records"} saved
        </p>
      </div>

      {successMessage ? (
        <Alert className="border-primary/20 bg-primary/10">
          <AlertTitle className="text-primary">Records added</AlertTitle>
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

      {historyIssue ? (
        <Alert
          className="border-destructive/30 bg-destructive/5"
          variant="destructive"
        >
          <TriangleAlert className="size-4" />
          <AlertTitle>Trade history issue</AlertTitle>
          <AlertDescription>{historyIssue}</AlertDescription>
        </Alert>
      ) : null}

      <div className="surface-review overflow-hidden rounded-xl border border-secondary/35 bg-background/95">
        {rows.length === 0 ? (
          <div className="px-4 py-12 text-center text-muted-foreground">
            No confirmation records yet.
          </div>
        ) : (
          <>
            <div className="space-y-3 p-3 md:hidden">
              {rows.map((row) => (
                <TradeSummaryCard
                  key={row.id}
                  onDeleteClick={() => setDeleteTarget(row)}
                  onEditClick={() => setEditTarget(row)}
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
                    <TableHead className="w-20">
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
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            aria-label={`Edit ${row.ticker} trade`}
                            className="text-muted-foreground hover:text-foreground"
                            onClick={() => setEditTarget(row)}
                            size="icon-xs"
                            variant="ghost"
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            aria-label={`Delete ${row.ticker} trade`}
                            className="text-muted-foreground hover:text-destructive"
                            onClick={() => setDeleteTarget(row)}
                            size="icon-xs"
                            variant="ghost"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
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
        onOpenChange={handleDeleteOpenChange}
        open={deleteTarget !== null}
        row={deleteTarget}
      />
      <EditTradeDialog
        onOpenChange={handleEditOpenChange}
        onSave={handleSaveEdit}
        open={editTarget !== null}
        row={editTarget}
      />
    </section>
  )
})

TradesTable.displayName = "TradesTable"
