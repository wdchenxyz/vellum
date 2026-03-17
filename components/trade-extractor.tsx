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
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
} from "@/components/ai-elements/prompt-input"
import { TradesTable, type TradeTableRow } from "@/components/trades-table"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  DEFAULT_MODEL,
  MAX_BATCH_SIZE_LABEL,
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_LABEL,
  MAX_FILES,
  UPLOAD_ACCEPT,
} from "@/lib/trades/constants"
import {
  extractTradesResponseSchema,
  type ExtractTradesResponse,
} from "@/lib/trades/schema"
import { Bot, FileImage, FileText, Sparkles, TriangleAlert } from "lucide-react"
import { useState } from "react"

function pluralize(value: number, singular: string, plural = `${singular}s`) {
  return value === 1 ? singular : plural
}

function formatPromptInputError(
  code: "accept" | "max_file_size" | "max_files"
) {
  switch (code) {
    case "accept":
      return "Only images and PDF files are supported in this MVP."
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

  return "The extraction request failed."
}

function AttachmentChips() {
  const attachments = usePromptInputAttachments()

  if (attachments.files.length === 0) {
    return (
      <p className="px-1 text-xs text-muted-foreground">
        Drop screenshots, confirmations, or statement PDFs directly into this
        box.
      </p>
    )
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <p className="px-1 text-xs text-muted-foreground">
        Ready to parse {attachments.files.length}{" "}
        {pluralize(attachments.files.length, "file")}
      </p>
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
  return response.results.flatMap((result) =>
    result.trades.map<TradeTableRow>((trade) => ({
      ...trade,
      id: crypto.randomUUID(),
      sourceFile: result.fileName,
    }))
  )
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

export function TradeExtractor() {
  const [rows, setRows] = useState<TradeTableRow[]>([])
  const [status, setStatus] = useState<ChatStatus>("ready")
  const [uploadIssue, setUploadIssue] = useState<string | null>(null)
  const [issues, setIssues] = useState<string[]>([])
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  async function handleSubmit(message: PromptInputMessage) {
    if (message.files.length === 0) {
      const issue = "Add at least one image or PDF before submitting."
      setUploadIssue(issue)
      setSuccessMessage(null)
      throw new Error(issue)
    }

    setStatus("submitted")
    setUploadIssue(null)
    setIssues([])
    setSuccessMessage(null)

    try {
      const response = await fetch("/api/trades/extract", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
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

      setRows((currentRows) => [...currentRows, ...nextRows])
      setIssues(nextIssues)
      setSuccessMessage(
        `Added ${nextRows.length} ${pluralize(nextRows.length, "trade")} from ${successfulFiles} ${pluralize(successfulFiles, "file")}.`
      )
    } catch (error) {
      setSuccessMessage(null)
      setUploadIssue(getErrorMessage(error))

      throw error
    } finally {
      setStatus("ready")
    }
  }

  return (
    <div className="grid gap-6">
      <Card className="border-border/70 bg-card/85 shadow-sm backdrop-blur-sm">
        <CardHeader className="gap-3">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">MVP</Badge>
            <Badge variant="outline">AI Gateway</Badge>
            <Badge variant="outline">{DEFAULT_MODEL}</Badge>
            <Badge variant="outline">Multi-trade per file</Badge>
          </div>
          <CardTitle>Upload confirmations</CardTitle>
          <CardDescription className="max-w-2xl leading-6">
            Add an optional note if the document needs context, then drop images
            or PDFs into the prompt box. Each file can yield multiple typed
            trade rows.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {successMessage ? (
            <Alert>
              <Sparkles className="size-4" />
              <AlertTitle>Batch imported</AlertTitle>
              <AlertDescription>{successMessage}</AlertDescription>
            </Alert>
          ) : null}

          {uploadIssue && issues.length === 0 ? (
            <Alert variant="destructive">
              <TriangleAlert className="size-4" />
              <AlertTitle>Upload blocked</AlertTitle>
              <AlertDescription>{uploadIssue}</AlertDescription>
            </Alert>
          ) : null}

          {issues.length > 0 ? (
            <Alert variant="destructive">
              <TriangleAlert className="size-4" />
              <AlertTitle>Some files need review</AlertTitle>
              <AlertDescription>
                <div className="flex flex-col gap-1">
                  {issues.map((issue) => (
                    <p key={issue}>{issue}</p>
                  ))}
                </div>
              </AlertDescription>
            </Alert>
          ) : null}

          <PromptInput
            accept={UPLOAD_ACCEPT}
            className="[&>[data-slot=input-group]]:rounded-2xl [&>[data-slot=input-group]]:border-dashed [&>[data-slot=input-group]]:border-border/80 [&>[data-slot=input-group]]:bg-background/95 [&>[data-slot=input-group]]:shadow-[0_1px_0_rgba(255,255,255,0.45)_inset]"
            maxFiles={MAX_FILES}
            maxFileSize={MAX_FILE_SIZE_BYTES}
            multiple
            onError={(error) => {
              setUploadIssue(formatPromptInputError(error.code))
              setIssues([])
              setSuccessMessage(null)
            }}
            onSubmit={handleSubmit}
          >
            <PromptInputHeader>
              <AttachmentChips />
            </PromptInputHeader>
            <PromptInputBody>
              <PromptInputTextarea placeholder="Optional note: for example, 'extract the filled trades and ignore the account summary totals'." />
            </PromptInputBody>
            <PromptInputFooter>
              <PromptInputTools className="flex-wrap">
                <PromptInputActionMenu>
                  <PromptInputActionMenuTrigger tooltip="Add images or PDFs" />
                  <PromptInputActionMenuContent>
                    <PromptInputActionAddAttachments />
                  </PromptInputActionMenuContent>
                </PromptInputActionMenu>
                <span className="px-1 text-xs text-muted-foreground">
                  Shift+Enter adds a new line.
                </span>
              </PromptInputTools>
              <PromptInputSubmit
                disabled={status !== "ready"}
                status={status}
              />
            </PromptInputFooter>
          </PromptInput>
        </CardContent>
        <CardFooter className="flex-wrap justify-between gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <FileImage className="size-4" />
            <span>
              Up to {MAX_FILES} files per batch, {MAX_FILE_SIZE_LABEL} each
            </span>
          </div>
          <div className="flex items-center gap-2">
            <FileText className="size-4" />
            <span>{MAX_BATCH_SIZE_LABEL} total payload per request</span>
          </div>
          <div className="flex items-center gap-2">
            <Bot className="size-4" />
            <span>{rows.length} rows captured this session</span>
          </div>
        </CardFooter>
      </Card>

      <TradesTable rows={rows} />
    </div>
  )
}
