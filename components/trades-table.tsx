"use client"

import { memo, useCallback, useMemo, useState } from "react"

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
import type { TradeTableRow } from "@/lib/trades/schema"
import {
  Check,
  Filter,
  Pencil,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react"

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 8,
})

function formatNumber(value: number | null) {
  if (value === null) {
    return "-"
  }

  return numberFormatter.format(value)
}

/* ------------------------------------------------------------------ */
/*  Delete-trade dialog (single + bulk)                                */
/* ------------------------------------------------------------------ */

function DeleteTradeDialog({
  count,
  onConfirm,
  onOpenChange,
  open,
  row,
}: {
  count?: number
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

  const isBulk = count !== undefined && count > 1

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>
            {isBulk ? `Delete ${count} trades?` : "Delete trade?"}
          </DialogTitle>
          {isBulk ? (
            <DialogDescription>
              This will permanently delete{" "}
              <span className="font-medium text-foreground">
                {count} trades
              </span>
              . This cannot be undone.
            </DialogDescription>
          ) : row ? (
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

/* ------------------------------------------------------------------ */
/*  Inline edit row                                                    */
/* ------------------------------------------------------------------ */

type EditFields = {
  date: string
  ticker: string
  side: "BUY" | "SELL"
  quantity: string
  price: string
  currency: string
  account: string
}

function toEditFields(row: TradeTableRow): EditFields {
  return {
    date: row.date,
    ticker: row.ticker,
    side: row.side,
    quantity: String(row.quantity),
    price: String(row.price),
    currency: row.currency ?? "",
    account: row.account ?? "",
  }
}

function InlineEditRow({
  onCancel,
  onSave,
  row,
}: {
  onCancel: () => void
  onSave: (
    id: string,
    fields: Record<string, string | number | null>
  ) => Promise<void>
  row: TradeTableRow
}) {
  const [fields, setFields] = useState<EditFields>(() => toEditFields(row))
  const [isSaving, setIsSaving] = useState(false)

  function update(key: keyof EditFields, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSave() {
    const qty = Number(fields.quantity)
    const prc = Number(fields.price)

    if (!fields.date || !fields.ticker || isNaN(qty) || qty <= 0 || isNaN(prc) || prc <= 0) {
      return
    }

    setIsSaving(true)

    try {
      await onSave(row.id, {
        date: fields.date,
        ticker: fields.ticker,
        side: fields.side,
        quantity: qty,
        price: prc,
        currency: fields.currency || null,
        account: fields.account || null,
      })
    } finally {
      setIsSaving(false)
    }
  }

  const inputClass = "h-7 px-1.5 text-sm tabular-nums"

  return (
    <TableRow className="bg-primary/5">
      <TableCell>
        <Input
          className={inputClass}
          onChange={(e) => update("date", e.target.value)}
          placeholder="YYYY-MM-DD"
          type="date"
          value={fields.date}
        />
      </TableCell>
      <TableCell>
        <Input
          className={inputClass}
          onChange={(e) => update("ticker", e.target.value)}
          value={fields.ticker}
        />
      </TableCell>
      <TableCell>
        <Input
          className={inputClass}
          onChange={(e) => update("account", e.target.value)}
          placeholder="–"
          value={fields.account}
        />
      </TableCell>
      <TableCell>
        <Select
          onValueChange={(v) => update("side", v)}
          value={fields.side}
        >
          <SelectTrigger className="h-7 w-20 text-xs" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="BUY">BUY</SelectItem>
            <SelectItem value="SELL">SELL</SelectItem>
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Input
          className={`${inputClass} text-right`}
          min={0}
          onChange={(e) => update("quantity", e.target.value)}
          step="any"
          type="number"
          value={fields.quantity}
        />
      </TableCell>
      <TableCell>
        <Input
          className={`${inputClass} text-right`}
          min={0}
          onChange={(e) => update("price", e.target.value)}
          step="any"
          type="number"
          value={fields.price}
        />
      </TableCell>
      <TableCell>
        <Input
          className={`${inputClass} w-16 text-right`}
          onChange={(e) => update("currency", e.target.value)}
          placeholder="–"
          value={fields.currency}
        />
      </TableCell>
      <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
        –
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-0.5">
          {/* checkbox spacer */}
          <span className="w-5" />
          <Button
            aria-label="Save edit"
            className="text-primary hover:text-primary"
            disabled={isSaving}
            onClick={handleSave}
            size="icon-xs"
            variant="ghost"
          >
            {isSaving ? (
              <Spinner className="size-3.5" />
            ) : (
              <Check className="size-3.5" />
            )}
          </Button>
          <Button
            aria-label="Cancel edit"
            className="text-muted-foreground hover:text-foreground"
            disabled={isSaving}
            onClick={onCancel}
            size="icon-xs"
            variant="ghost"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}

/* ------------------------------------------------------------------ */
/*  Inline edit card (mobile)                                          */
/* ------------------------------------------------------------------ */

function InlineEditCard({
  onCancel,
  onSave,
  row,
}: {
  onCancel: () => void
  onSave: (
    id: string,
    fields: Record<string, string | number | null>
  ) => Promise<void>
  row: TradeTableRow
}) {
  const [fields, setFields] = useState<EditFields>(() => toEditFields(row))
  const [isSaving, setIsSaving] = useState(false)

  function update(key: keyof EditFields, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSave() {
    const qty = Number(fields.quantity)
    const prc = Number(fields.price)

    if (!fields.date || !fields.ticker || isNaN(qty) || qty <= 0 || isNaN(prc) || prc <= 0) {
      return
    }

    setIsSaving(true)

    try {
      await onSave(row.id, {
        date: fields.date,
        ticker: fields.ticker,
        side: fields.side,
        quantity: qty,
        price: prc,
        currency: fields.currency || null,
        account: fields.account || null,
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <article className="rounded-lg border-2 border-primary/30 bg-primary/5 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium text-primary">Editing trade</p>
        <div className="flex items-center gap-1">
          <Button
            aria-label="Save edit"
            className="text-primary hover:text-primary"
            disabled={isSaving}
            onClick={handleSave}
            size="icon-xs"
            variant="ghost"
          >
            {isSaving ? (
              <Spinner className="size-3.5" />
            ) : (
              <Check className="size-3.5" />
            )}
          </Button>
          <Button
            aria-label="Cancel edit"
            className="text-muted-foreground hover:text-foreground"
            disabled={isSaving}
            onClick={onCancel}
            size="icon-xs"
            variant="ghost"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <label className="text-xs text-muted-foreground">Ticker</label>
          <Input
            className="mt-0.5 h-7 text-sm"
            onChange={(e) => update("ticker", e.target.value)}
            value={fields.ticker}
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Side</label>
          <Select
            onValueChange={(v) => update("side", v)}
            value={fields.side}
          >
            <SelectTrigger className="mt-0.5 h-7 text-xs" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="BUY">BUY</SelectItem>
              <SelectItem value="SELL">SELL</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Date</label>
          <Input
            className="mt-0.5 h-7 text-sm"
            onChange={(e) => update("date", e.target.value)}
            type="date"
            value={fields.date}
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Account</label>
          <Input
            className="mt-0.5 h-7 text-sm"
            onChange={(e) => update("account", e.target.value)}
            placeholder="–"
            value={fields.account}
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Quantity</label>
          <Input
            className="mt-0.5 h-7 text-sm"
            min={0}
            onChange={(e) => update("quantity", e.target.value)}
            step="any"
            type="number"
            value={fields.quantity}
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Price</label>
          <Input
            className="mt-0.5 h-7 text-sm"
            min={0}
            onChange={(e) => update("price", e.target.value)}
            step="any"
            type="number"
            value={fields.price}
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Currency</label>
          <Input
            className="mt-0.5 h-7 text-sm"
            onChange={(e) => update("currency", e.target.value)}
            placeholder="–"
            value={fields.currency}
          />
        </div>
      </div>
    </article>
  )
}

/* ------------------------------------------------------------------ */
/*  Filter bar                                                         */
/* ------------------------------------------------------------------ */

type Filters = {
  ticker: string
  account: string | null
  side: "BUY" | "SELL" | null
}

const EMPTY_FILTERS: Filters = { ticker: "", account: null, side: null }

function hasActiveFilters(filters: Filters) {
  return filters.ticker !== "" || filters.account !== null || filters.side !== null
}

function FilterBar({
  accountOptions,
  filters,
  onFiltersChange,
}: {
  accountOptions: string[]
  filters: Filters
  onFiltersChange: (filters: Filters) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Filter className="size-3.5 text-muted-foreground" />
      <Input
        className="h-7 w-40 text-sm"
        onChange={(e) =>
          onFiltersChange({ ...filters, ticker: e.target.value })
        }
        placeholder="Search ticker…"
        type="search"
        value={filters.ticker}
      />
      {accountOptions.length > 0 ? (
        <Select
          onValueChange={(v) =>
            onFiltersChange({
              ...filters,
              account: v === "__all__" ? null : v,
            })
          }
          value={filters.account ?? "__all__"}
        >
          <SelectTrigger className="h-7 w-32 text-xs" size="sm">
            <SelectValue placeholder="Account" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All accounts</SelectItem>
            {accountOptions.map((account) => (
              <SelectItem key={account} value={account}>
                {account}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      <Select
        onValueChange={(v) =>
          onFiltersChange({
            ...filters,
            side: v === "__all__" ? null : (v as "BUY" | "SELL"),
          })
        }
        value={filters.side ?? "__all__"}
      >
        <SelectTrigger className="h-7 w-24 text-xs" size="sm">
          <SelectValue placeholder="Side" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All sides</SelectItem>
          <SelectItem value="BUY">BUY</SelectItem>
          <SelectItem value="SELL">SELL</SelectItem>
        </SelectContent>
      </Select>
      {hasActiveFilters(filters) ? (
        <Button
          className="h-7 text-xs text-muted-foreground"
          onClick={() => onFiltersChange(EMPTY_FILTERS)}
          size="sm"
          variant="ghost"
        >
          Clear
        </Button>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Mobile card                                                        */
/* ------------------------------------------------------------------ */

function TradeSummaryCard({
  isSelected,
  onDeleteClick,
  onEditClick,
  onToggleSelect,
  row,
}: {
  isSelected: boolean
  onDeleteClick: () => void
  onEditClick: () => void
  onToggleSelect: () => void
  row: TradeTableRow
}) {
  return (
    <article
      className={`rounded-lg border bg-background/80 px-4 py-3 ${
        isSelected
          ? "border-primary/40 bg-primary/5"
          : "border-border/70"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <input
            aria-label={`Select ${row.ticker} trade`}
            checked={isSelected}
            className="size-3.5 accent-current"
            onChange={onToggleSelect}
            type="checkbox"
          />
          <div className="min-w-0 space-y-0.5">
            <p className="font-medium text-foreground">{row.ticker}</p>
            <p className="truncate text-xs text-muted-foreground">
              {row.sourceFile}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant={row.side === "BUY" ? "default" : "secondary"}>
            {row.side}
          </Badge>
          <Button
            aria-label={`Edit ${row.ticker} trade`}
            className="text-muted-foreground hover:text-primary"
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

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

type TradesTableProps = {
  issues: string[]
  onDelete: (ids: string[]) => Promise<void>
  onUpdate: (
    id: string,
    fields: Record<string, string | number | null>
  ) => Promise<void>
  restoreIssue: string | null
  rows: TradeTableRow[]
  successMessage: string | null
}

export const TradesTable = memo(function TradesTable({
  issues,
  onDelete,
  onUpdate,
  restoreIssue,
  rows,
  successMessage,
}: TradesTableProps) {
  const [deleteTarget, setDeleteTarget] = useState<TradeTableRow | null>(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)

  /* Derive account options from rows */
  const accountOptions = useMemo(
    () =>
      [
        ...new Set(
          rows
            .map((row) => row.account)
            .filter((account): account is string => account !== null)
        ),
      ].sort((a, b) => a.localeCompare(b)),
    [rows]
  )

  /* Apply filters */
  const filteredRows = useMemo(() => {
    let result = rows

    if (filters.ticker) {
      const query = filters.ticker.toLowerCase()
      result = result.filter((row) =>
        row.ticker.toLowerCase().includes(query)
      )
    }

    if (filters.account !== null) {
      result = result.filter((row) => row.account === filters.account)
    }

    if (filters.side !== null) {
      result = result.filter((row) => row.side === filters.side)
    }

    return result
  }, [rows, filters])

  /* Checkbox helpers */
  const allFilteredSelected =
    filteredRows.length > 0 &&
    filteredRows.every((row) => selectedIds.has(row.id))

  const someFilteredSelected =
    filteredRows.some((row) => selectedIds.has(row.id)) && !allFilteredSelected

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function toggleSelectAll() {
    if (allFilteredSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        for (const row of filteredRows) {
          next.delete(row.id)
        }
        return next
      })
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        for (const row of filteredRows) {
          next.add(row.id)
        }
        return next
      })
    }
  }

  /* Delete handlers */
  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setDeleteTarget(null)
    }
  }, [])

  const handleConfirmSingleDelete = useCallback(async () => {
    if (!deleteTarget) {
      return
    }

    await onDelete([deleteTarget.id])
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.delete(deleteTarget.id)
      return next
    })
  }, [deleteTarget, onDelete])

  const handleBulkDelete = useCallback(async () => {
    const ids = [...selectedIds]
    if (ids.length === 0) {
      return
    }

    await onDelete(ids)
    setSelectedIds(new Set())
  }, [selectedIds, onDelete])

  /* Edit handlers */
  const handleSaveEdit = useCallback(
    async (id: string, fields: Record<string, string | number | null>) => {
      await onUpdate(id, fields)
      setEditingId(null)
    },
    [onUpdate]
  )

  const selectedCount = selectedIds.size

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
        <div className="flex items-center gap-3">
          {selectedCount > 0 ? (
            <Button
              className="h-7 text-xs"
              onClick={() => setBulkDeleteOpen(true)}
              size="sm"
              variant="destructive"
            >
              <Trash2 className="size-3" />
              Delete {selectedCount} selected
            </Button>
          ) : null}
          <p className="text-sm text-secondary-foreground/80">
            {filteredRows.length !== rows.length
              ? `${filteredRows.length} of ${rows.length}`
              : rows.length}{" "}
            {rows.length === 1 ? "row" : "rows"} saved
          </p>
        </div>
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

      {/* Filter bar */}
      {rows.length > 0 ? (
        <FilterBar
          accountOptions={accountOptions}
          filters={filters}
          onFiltersChange={setFilters}
        />
      ) : null}

      <div className="surface-review overflow-hidden rounded-xl border border-secondary/35 bg-background/95">
        {filteredRows.length === 0 ? (
          <div className="px-4 py-12 text-center text-muted-foreground">
            {rows.length === 0
              ? "No trades yet."
              : "No trades match the current filters."}
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="space-y-3 p-3 md:hidden">
              {filteredRows.map((row) =>
                editingId === row.id ? (
                  <InlineEditCard
                    key={row.id}
                    onCancel={() => setEditingId(null)}
                    onSave={handleSaveEdit}
                    row={row}
                  />
                ) : (
                  <TradeSummaryCard
                    isSelected={selectedIds.has(row.id)}
                    key={row.id}
                    onDeleteClick={() => setDeleteTarget(row)}
                    onEditClick={() => setEditingId(row.id)}
                    onToggleSelect={() => toggleSelect(row.id)}
                    row={row}
                  />
                )
              )}
            </div>

            {/* Desktop table */}
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
                    <TableHead className="w-28">
                      <div className="flex items-center gap-1.5">
                        <input
                          aria-label="Select all trades"
                          checked={allFilteredSelected}
                          className="size-3.5 accent-current"
                          onChange={toggleSelectAll}
                          ref={(el) => {
                            if (el) {
                              el.indeterminate = someFilteredSelected
                            }
                          }}
                          type="checkbox"
                        />
                        <span className="sr-only">Actions</span>
                      </div>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.map((row) =>
                    editingId === row.id ? (
                      <InlineEditRow
                        key={row.id}
                        onCancel={() => setEditingId(null)}
                        onSave={handleSaveEdit}
                        row={row}
                      />
                    ) : (
                      <TableRow
                        key={row.id}
                        className={
                          selectedIds.has(row.id) ? "bg-primary/5" : undefined
                        }
                      >
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
                            variant={
                              row.side === "BUY" ? "default" : "secondary"
                            }
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
                          <div className="flex items-center gap-0.5">
                            <input
                              aria-label={`Select ${row.ticker} trade`}
                              checked={selectedIds.has(row.id)}
                              className="size-3.5 accent-current"
                              onChange={() => toggleSelect(row.id)}
                              type="checkbox"
                            />
                            <Button
                              aria-label={`Edit ${row.ticker} trade`}
                              className="text-muted-foreground hover:text-primary"
                              onClick={() => setEditingId(row.id)}
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
                    )
                  )}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </div>

      {/* Single delete dialog */}
      <DeleteTradeDialog
        onConfirm={handleConfirmSingleDelete}
        onOpenChange={handleOpenChange}
        open={deleteTarget !== null}
        row={deleteTarget}
      />

      {/* Bulk delete dialog */}
      <DeleteTradeDialog
        count={selectedCount}
        onConfirm={handleBulkDelete}
        onOpenChange={setBulkDeleteOpen}
        open={bulkDeleteOpen}
        row={null}
      />
    </section>
  )
})

TradesTable.displayName = "TradesTable"
