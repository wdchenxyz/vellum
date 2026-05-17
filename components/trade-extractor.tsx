"use client"

import type { ChatStatus } from "ai"
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from "@/components/ai-elements/attachments"
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  type PromptInputMessage,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
} from "@/components/ai-elements/prompt-input"
import { PortfolioSnapshot } from "@/components/portfolio-snapshot"
import { TradesTable } from "@/components/trades-table"
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Spinner } from "@/components/ui/spinner"
import {
  MAX_BATCH_SIZE_LABEL,
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_LABEL,
  MAX_FILES,
  UPLOAD_ACCEPT,
} from "@/lib/trades/constants"
import {
  deleteTradesResponseSchema,
  extractTradesResponseSchema,
  tradeRowsResponseSchema,
  updateTradeResponseSchema,
  type ExtractTradesResponse,
  type TradeTableRow,
} from "@/lib/trades/schema"
import { cn } from "@/lib/utils"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Building2,
  CheckCircle2,
  CircleAlert,
  NotebookPen,
  Paperclip,
  Plus,
  TriangleAlert,
  UploadCloud,
  X,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"

type ExtractionNotice = {
  description: string
  id: string
  kind: "running" | "success" | "error"
  title: string
}

type CompletedExtractionNotice = Omit<ExtractionNotice, "id" | "kind"> & {
  kind: "success" | "error"
}

const RUNNING_EXTRACTION_NOTICE_ID = "running-extraction"
const SUCCESS_NOTICE_DISMISS_DELAY_MS = 5000
const EXTRACTION_NOTICE_STACK_SELECTOR = "[data-extraction-notice-stack]"

const DEFAULT_ACCOUNT_OPTIONS = [
  "Firstrade",
  "元大台股",
  "元大複委託",
  "群益複委託",
]

function pluralize(value: number, singular: string, plural = `${singular}s`) {
  return value === 1 ? singular : plural
}

function formatPromptInputError(
  code: "accept" | "max_file_size" | "max_files"
) {
  switch (code) {
    case "accept":
      return "Only images and PDF files are supported."
    case "max_file_size":
      return `Each file must stay under ${MAX_FILE_SIZE_LABEL}.`
    case "max_files":
      return `Please upload ${MAX_FILES} ${pluralize(MAX_FILES, "file")} or fewer per batch.`
    default:
      return "The selected files could not be added."
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return "The request failed."
}

function isExtractionNoticeInteraction(target: EventTarget | null) {
  return (
    target instanceof Element &&
    target.closest(EXTRACTION_NOTICE_STACK_SELECTOR) !== null
  )
}

function formatFileList(files: PromptInputMessage["files"]) {
  if (files.length === 0) {
    return "No files selected"
  }

  if (files.length === 1) {
    return files[0]?.filename ?? "1 file"
  }

  const firstFileName = files[0]?.filename ?? "first file"
  return `${firstFileName} and ${files.length - 1} more ${pluralize(
    files.length - 1,
    "file"
  )}`
}

function ExtractionNoticeCard({
  notice,
  onDismiss,
  onOpenDrawer,
}: {
  notice: ExtractionNotice
  onDismiss: () => void
  onOpenDrawer: () => void
}) {
  const isRunning = notice.kind === "running"
  const isSuccess = notice.kind === "success"
  const Icon = isSuccess ? CheckCircle2 : CircleAlert

  return (
    <Alert
      aria-live={isRunning || isSuccess ? "polite" : undefined}
      className={cn(
        "pointer-events-auto w-full animate-in rounded-xl border-border/70 bg-card/95 px-3 py-3 shadow-lg shadow-foreground/10 backdrop-blur-xl duration-200 fade-in-0 slide-in-from-right-3",
        notice.kind === "error"
          ? "border-destructive/30 text-destructive has-data-[slot=alert-action]:pr-28"
          : "text-card-foreground"
      )}
      role={isRunning || isSuccess ? "status" : "alert"}
      variant={notice.kind === "error" ? "destructive" : "default"}
    >
      {isRunning ? (
        <Spinner className="text-primary" />
      ) : (
        <Icon className={cn("size-4", isSuccess && "text-primary")} />
      )}
      <AlertTitle>{notice.title}</AlertTitle>
      <AlertDescription
        className={
          notice.kind === "error" ? undefined : "text-muted-foreground"
        }
      >
        {notice.description}
      </AlertDescription>
      {notice.kind === "error" ? (
        <AlertAction className="flex items-center gap-1">
          <Button
            onClick={onOpenDrawer}
            size="xs"
            type="button"
            variant="ghost"
          >
            Review
          </Button>
          <Button
            aria-label="Dismiss extraction failure"
            onClick={onDismiss}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <X className="size-3" />
          </Button>
        </AlertAction>
      ) : isSuccess ? (
        <AlertAction>
          <Button onClick={onDismiss} size="xs" type="button" variant="ghost">
            Dismiss
          </Button>
        </AlertAction>
      ) : null}
    </Alert>
  )
}

function ExtractionNoticeStack({
  notices,
  onDismiss,
  onOpenDrawer,
}: {
  notices: ExtractionNotice[]
  onDismiss: (id: string) => void
  onOpenDrawer: () => void
}) {
  if (notices.length === 0) {
    return null
  }

  return (
    <div
      className="pointer-events-none fixed top-4 right-4 left-4 z-[70] flex flex-col items-end gap-2 sm:top-5 sm:left-auto sm:w-88"
      data-extraction-notice-stack
    >
      {notices.map((notice) => (
        <ExtractionNoticeCard
          key={notice.id}
          notice={notice}
          onDismiss={() => onDismiss(notice.id)}
          onOpenDrawer={onOpenDrawer}
        />
      ))}
    </div>
  )
}

function BrowseFilesButton({
  size = "sm",
  label = "Choose files",
}: {
  size?: "sm" | "default"
  label?: string
}) {
  const attachments = usePromptInputAttachments()

  return (
    <Button
      className="border-primary/20 bg-primary/5 text-primary hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
      onClick={() => attachments.openFileDialog()}
      size={size}
      type="button"
      variant="outline"
    >
      <Paperclip className="size-4" />
      {label}
    </Button>
  )
}

function AttachmentList() {
  const attachments = usePromptInputAttachments()

  if (attachments.files.length === 0) {
    return null
  }

  return (
    <Attachments variant="inline">
      {attachments.files.map((attachment) => (
        <Attachment
          data={attachment}
          key={attachment.id}
          onRemove={() => attachments.remove(attachment.id)}
        >
          <AttachmentPreview />
          <AttachmentInfo />
          <AttachmentRemove />
        </Attachment>
      ))}
    </Attachments>
  )
}

function AttachmentTray() {
  const attachments = usePromptInputAttachments()
  const fileCount = attachments.files.length
  const hasFiles = fileCount > 0
  const filledLabel = `Ready to add ${fileCount} ${pluralize(fileCount, "file")}.`

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <UploadCloud className="size-4" />
          </span>
          <div className="flex flex-col">
            <p className="text-sm font-semibold text-foreground">
              {hasFiles ? filledLabel : "Drop screenshots or PDFs"}
            </p>
            <p className="text-xs text-muted-foreground">
              Drag, paste, or browse below.
            </p>
          </div>
        </div>
        <BrowseFilesButton />
      </div>
      <AttachmentList />
    </div>
  )
}

const NOTE_PLACEHOLDER =
  "Example: ignore account summary totals and use only filled transactions."

function OptionalNote() {
  return (
    <div className="w-full px-4 pb-3">
      <div className="flex flex-col gap-1.5 rounded-lg border border-border/70 bg-background/60 px-3 py-2 transition-colors focus-within:border-primary/40 focus-within:bg-background">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
            <NotebookPen className="size-3.5 text-muted-foreground" />
            Context note
          </div>
          <span className="text-[10px] tracking-wider text-muted-foreground uppercase">
            Optional
          </span>
        </div>
        <PromptInputTextarea
          className="[field-sizing:fixed] min-h-16 w-full resize-none border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
          placeholder={NOTE_PLACEHOLDER}
        />
      </div>
    </div>
  )
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

function toTableRows(response: ExtractTradesResponse) {
  return response.rows
}

function toIssues(response: ExtractTradesResponse) {
  return response.results.flatMap((result) => {
    if (result.error) {
      return [`${result.fileName}: ${result.error}`]
    }

    if (result.trades.length === 0) {
      return [
        `${result.fileName}: no visible BUY or SELL transactions were found.`,
      ]
    }

    return []
  })
}

function mergeTradeRows(
  existingRows: TradeTableRow[],
  nextRows: TradeTableRow[]
) {
  const rowsById = new Map(existingRows.map((row) => [row.id, row]))

  for (const row of nextRows) {
    rowsById.set(row.id, row)
  }

  return [...rowsById.values()]
}

function getCompletedNoticeId(kind: "success" | "error") {
  return `${kind}-${Date.now()}`
}

export function TradeExtractor() {
  const [rows, setRows] = useState<TradeTableRow[]>([])
  const [status, setStatus] = useState<ChatStatus>("ready")
  const [ingestOpen, setIngestOpen] = useState(false)
  const [uploadIssue, setUploadIssue] = useState<string | null>(null)
  const [issues, setIssues] = useState<string[]>([])
  const [restoreIssue, setRestoreIssue] = useState<string | null>(null)
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null)
  const [mutationIssue, setMutationIssue] = useState<string | null>(null)
  const [extractionNotices, setExtractionNotices] = useState<
    ExtractionNotice[]
  >([])
  const extractionRunning = extractionNotices.some(
    (notice) => notice.kind === "running"
  )

  const upsertExtractionNotice = useCallback((notice: ExtractionNotice) => {
    setExtractionNotices((currentNotices) => [
      notice,
      ...currentNotices.filter(
        (currentNotice) => currentNotice.id !== notice.id
      ),
    ])
  }, [])

  const addCompletedExtractionNotice = useCallback(
    (notice: CompletedExtractionNotice) => {
      setExtractionNotices((currentNotices) =>
        [
          {
            ...notice,
            id: getCompletedNoticeId(notice.kind),
          },
          ...currentNotices.filter(
            (currentNotice) => currentNotice.id !== RUNNING_EXTRACTION_NOTICE_ID
          ),
        ].slice(0, 3)
      )
    },
    []
  )

  const dismissExtractionNotice = useCallback((id: string) => {
    setExtractionNotices((currentNotices) =>
      currentNotices.filter((notice) => notice.id !== id)
    )
  }, [])

  useEffect(() => {
    const successNoticeIds = extractionNotices
      .filter((notice) => notice.kind === "success")
      .map((notice) => notice.id)

    if (successNoticeIds.length === 0) {
      return
    }

    const timeoutIds = successNoticeIds.map((id) =>
      window.setTimeout(() => {
        dismissExtractionNotice(id)
      }, SUCCESS_NOTICE_DISMISS_DELAY_MS)
    )

    return () => {
      for (const timeoutId of timeoutIds) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [dismissExtractionNotice, extractionNotices])

  const accountOptions = useMemo(() => {
    const rowAccounts = rows
      .map((row) => row.account)
      .filter((account): account is string => account !== null)

    return [
      ...DEFAULT_ACCOUNT_OPTIONS,
      ...rowAccounts.filter(
        (account) => !DEFAULT_ACCOUNT_OPTIONS.includes(account)
      ),
    ]
  }, [rows])

  useEffect(() => {
    let cancelled = false

    async function loadStoredTrades() {
      try {
        const response = await fetch("/api/trades/rows", {
          cache: "no-store",
        })

        if (!response.ok) {
          throw new Error(await readErrorMessage(response))
        }

        const payload = await response.json()
        const parsed = tradeRowsResponseSchema.safeParse(payload)

        if (!parsed.success) {
          throw new Error(
            "The server returned an unexpected transactions response."
          )
        }

        if (cancelled) {
          return
        }

        setRows((currentRows) => mergeTradeRows(currentRows, parsed.data.rows))
        setRestoreIssue(null)
      } catch (error) {
        if (cancelled) {
          return
        }

        setRestoreIssue(getErrorMessage(error))
      }
    }

    void loadStoredTrades()

    return () => {
      cancelled = true
    }
  }, [])

  const handleDeleteTrade = useCallback(async (id: string) => {
    setMutationIssue(null)

    const response = await fetch("/api/trades/rows", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [id] }),
    })

    if (!response.ok) {
      const message = await readErrorMessage(response)
      setMutationIssue(message)
      throw new Error(message)
    }

    const payload = await response.json()
    const parsed = deleteTradesResponseSchema.safeParse(payload)

    if (!parsed.success) {
      const message = "The server returned an unexpected response."
      setMutationIssue(message)
      throw new Error(message)
    }

    setRows(parsed.data.rows)
  }, [])

  const handleUpdateTrade = useCallback(async (row: TradeTableRow) => {
    setMutationIssue(null)

    const { id, ...editableRow } = row
    const response = await fetch("/api/trades/rows", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, row: editableRow }),
    })

    if (!response.ok) {
      const message = await readErrorMessage(response)
      setMutationIssue(message)
      throw new Error(message)
    }

    const payload = await response.json()
    const parsed = updateTradeResponseSchema.safeParse(payload)

    if (!parsed.success) {
      const message = "The server returned an unexpected response."
      setMutationIssue(message)
      throw new Error(message)
    }

    setRows(parsed.data.rows)
  }, [])

  async function handleSubmit(message: PromptInputMessage) {
    if (!selectedAccount) {
      const issue = "Select the account these confirmations belong to."
      setUploadIssue(issue)
      throw new Error(issue)
    }

    if (message.files.length === 0) {
      const issue = "Add at least one image or PDF before submitting."
      setUploadIssue(issue)
      throw new Error(issue)
    }

    const account = selectedAccount
    const fileDescription = formatFileList(message.files)

    setStatus("submitted")
    setUploadIssue(null)
    setIssues([])
    setIngestOpen(false)
    upsertExtractionNotice({
      description: `Reading ${fileDescription}. You can keep using the dashboard.`,
      id: RUNNING_EXTRACTION_NOTICE_ID,
      kind: "running",
      title: "Extracting confirmations",
    })

    try {
      const response = await fetch("/api/trades/extract", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          account,
          prompt: message.text,
          files: message.files,
        }),
      })

      if (!response.ok) {
        throw new Error(await readErrorMessage(response))
      }

      const payload = await response.json()
      const parsed = extractTradesResponseSchema.safeParse(payload)

      if (!parsed.success) {
        throw new Error("The server returned an unexpected response.")
      }

      const nextRows = toTableRows(parsed.data)
      const nextIssues = toIssues(parsed.data)

      if (nextRows.length === 0) {
        const issue =
          nextIssues[0] ??
          "No visible BUY or SELL transactions were found in the uploaded files."

        setUploadIssue(issue)
        setIssues(nextIssues)

        throw new Error(issue)
      }

      const successfulFiles = parsed.data.results.filter(
        (result) => result.trades.length > 0
      ).length

      setRows((currentRows) => mergeTradeRows(currentRows, nextRows))
      setIssues(nextIssues)
      addCompletedExtractionNotice({
        description: `Added ${nextRows.length} confirmation ${pluralize(
          nextRows.length,
          "record"
        )} from ${successfulFiles} ${pluralize(successfulFiles, "file")}.`,
        kind: "success",
        title: "Records added",
      })
    } catch (error) {
      const issue = getErrorMessage(error)

      setUploadIssue(issue)
      addCompletedExtractionNotice({
        description: issue,
        kind: "error",
        title: "Extraction failed",
      })
      setIngestOpen(true)

      throw error
    } finally {
      setStatus("ready")
    }
  }

  return (
    <div className="grid gap-8">
      <ExtractionNoticeStack
        notices={extractionNotices}
        onDismiss={dismissExtractionNotice}
        onOpenDrawer={() => setIngestOpen(true)}
      />

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/80 px-4 py-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-medium tracking-[0.16em] text-primary uppercase">
              Ingest
            </p>
            <span className="hidden min-w-0 flex-1 text-xs text-muted-foreground sm:inline">
              Upload screenshots or PDFs from the correct account.
            </span>
          </div>
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <Building2 className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate text-muted-foreground">
              {selectedAccount
                ? `${selectedAccount} selected`
                : "Choose an account in the drawer"}
            </span>
          </div>
        </div>

        <div className="flex w-full flex-wrap items-center justify-end gap-3 lg:w-auto">
          <PromptInputProvider>
            <Sheet onOpenChange={setIngestOpen} open={ingestOpen}>
              <SheetTrigger asChild>
                <Button disabled={extractionRunning}>
                  <Plus data-icon="inline-start" />
                  {extractionRunning
                    ? "Extraction running"
                    : "Add confirmations"}
                </Button>
              </SheetTrigger>
              <SheetContent
                className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-md"
                onInteractOutside={(event) => {
                  if (isExtractionNoticeInteraction(event.target)) {
                    event.preventDefault()
                  }
                }}
                onPointerDownOutside={(event) => {
                  if (isExtractionNoticeInteraction(event.target)) {
                    event.preventDefault()
                  }
                }}
                side="right"
              >
                <SheetHeader className="border-b">
                  <SheetTitle>Add confirmations</SheetTitle>
                  <SheetDescription>
                    Select the account, upload screenshots or PDFs, then add the
                    extracted records to history.
                  </SheetDescription>
                </SheetHeader>

                <div className="flex flex-col gap-5 px-4 pb-4">
                  <div className="flex flex-col gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      Account
                    </span>
                    <ToggleGroup
                      className="flex flex-wrap justify-start"
                      onValueChange={(value) =>
                        setSelectedAccount(value || null)
                      }
                      size="sm"
                      spacing={2}
                      type="single"
                      value={selectedAccount ?? ""}
                      variant="outline"
                    >
                      {accountOptions.map((account) => (
                        <ToggleGroupItem
                          className="rounded-full border-2 aria-pressed:border-[#007AFF] data-[state=on]:border-[#007AFF]"
                          key={account}
                          value={account}
                        >
                          {account}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </div>

                  {uploadIssue ? (
                    <Alert
                      className="border-destructive/30 bg-destructive/5"
                      variant="destructive"
                    >
                      <TriangleAlert className="size-4" />
                      <AlertTitle>
                        {issues.length > 0
                          ? "Review these files"
                          : "Upload blocked"}
                      </AlertTitle>
                      <AlertDescription>
                        {issues.length > 0 ? (
                          <div className="flex flex-col gap-1">
                            {issues.map((issue) => (
                              <p key={issue}>{issue}</p>
                            ))}
                          </div>
                        ) : (
                          uploadIssue
                        )}
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  <PromptInput
                    accept={UPLOAD_ACCEPT}
                    inputGroupClassName="surface-upload rounded-xl border-primary/20"
                    maxFiles={MAX_FILES}
                    maxFileSize={MAX_FILE_SIZE_BYTES}
                    multiple
                    onError={(error) => {
                      setUploadIssue(formatPromptInputError(error.code))
                      setIssues([])
                      setExtractionNotices((currentNotices) =>
                        currentNotices.filter(
                          (notice) => notice.id !== RUNNING_EXTRACTION_NOTICE_ID
                        )
                      )
                    }}
                    onSubmit={handleSubmit}
                  >
                    <PromptInputHeader className="px-4 py-4">
                      <AttachmentTray />
                    </PromptInputHeader>
                    <PromptInputBody>
                      <OptionalNote />
                    </PromptInputBody>
                    <PromptInputFooter className="border-t px-4 py-3">
                      <PromptInputTools>
                        <span className="text-xs text-muted-foreground">
                          {MAX_FILES} files max • {MAX_FILE_SIZE_LABEL} each •{" "}
                          {MAX_BATCH_SIZE_LABEL} total
                        </span>
                      </PromptInputTools>
                      <PromptInputSubmit
                        className="shadow-primary-soft"
                        disabled={status !== "ready" || !selectedAccount}
                        size="sm"
                        status={status}
                      >
                        {status === "ready" ? "Add" : "Adding..."}
                      </PromptInputSubmit>
                    </PromptInputFooter>
                  </PromptInput>

                  {!selectedAccount ? (
                    <p className="text-xs text-muted-foreground">
                      Select an account to enable adding confirmations.
                    </p>
                  ) : null}
                </div>
              </SheetContent>
            </Sheet>
          </PromptInputProvider>
        </div>
      </section>

      <PortfolioSnapshot rows={rows} />

      <TradesTable
        historyIssue={mutationIssue ?? restoreIssue}
        issues={issues}
        onDelete={handleDeleteTrade}
        onUpdate={handleUpdateTrade}
        rows={rows}
        successMessage={null}
      />
    </div>
  )
}
