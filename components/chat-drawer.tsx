"use client"

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation"
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message"
import {
  PromptInput,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useChat } from "@ai-sdk/react"
import { Loader2, MessageCircle, X } from "lucide-react"
import { useCallback, useRef, useState, type ReactNode } from "react"

const SIDEBAR_WIDTH = "w-[480px]"

function ToolCallIndicator({ toolName }: { toolName: string }) {
  const labels: Record<string, string> = {
    getTradeHistory: "Fetching trade history",
    getHoldings: "Loading portfolio holdings",
    getDailyValues: "Computing portfolio values",
    getStockPerformance: "Analyzing stock performance",
    getFxRate: "Checking exchange rate",
  }

  return (
    <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
      <Loader2 className="size-3 animate-spin" />
      <span>{labels[toolName] ?? `Running ${toolName}`}</span>
    </div>
  )
}

function ChatPanel({ onClose }: { onClose: () => void }) {
  const [input, setInput] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const { messages, sendMessage, status, stop } = useChat({})

  const isStreaming = status === "streaming" || status === "submitted"

  const handleSubmit = useCallback(
    (message: PromptInputMessage) => {
      const text = message.text.trim()

      if (!text) {
        return
      }

      sendMessage({ text })
      setInput("")

      // Re-focus the textarea so the user can keep typing.
      requestAnimationFrame(() => {
        textareaRef.current?.focus()
      })
    },
    [sendMessage]
  )

  return (
    <aside
      className={cn(
        SIDEBAR_WIDTH,
        "flex shrink-0 flex-col border-l bg-background"
      )}
    >
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-medium">Portfolio Assistant</h2>
          <p className="text-xs text-muted-foreground">
            Ask about trades, holdings, and performance.
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose}>
          <X className="size-4" />
          <span className="sr-only">Close chat</span>
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <Conversation className="flex-1">
          <ConversationContent className="gap-6 px-4 py-4">
            {messages.length === 0 ? (
              <ConversationEmptyState
                icon={
                  <MessageCircle className="size-10 text-muted-foreground/50" />
                }
                title="Ask about your portfolio"
                description='Try: "Compare my portfolio to S&P 500 last quarter" or "What are my top holdings?"'
              />
            ) : (
              messages.map((message) => (
                <Message from={message.role} key={message.id}>
                  <MessageContent>
                    {message.parts.map((part, i) => {
                      if (part.type === "text") {
                        return (
                          <MessageResponse key={`${message.id}-text-${i}`}>
                            {part.text}
                          </MessageResponse>
                        )
                      }

                      if (part.type.startsWith("tool-") && "state" in part) {
                        const toolName = part.type.replace("tool-", "")

                        if (
                          part.state === "input-streaming" ||
                          part.state === "input-available"
                        ) {
                          return (
                            <ToolCallIndicator
                              key={`${message.id}-tool-${i}`}
                              toolName={toolName}
                            />
                          )
                        }

                        return null
                      }

                      return null
                    })}
                  </MessageContent>
                </Message>
              ))
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="border-t p-3">
          <PromptInput onSubmit={handleSubmit} className="w-full">
            <PromptInputTextarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.currentTarget.value)}
              placeholder="Ask about your portfolio..."
              className="min-h-[44px] pr-12"
            />
            <PromptInputSubmit
              status={status}
              onStop={stop}
              disabled={!input.trim() && !isStreaming}
              className="absolute right-1 bottom-1"
            />
          </PromptInput>
        </div>
      </div>
    </aside>
  )
}

export function ChatLayout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex h-svh overflow-hidden">
      <div className="flex-1 overflow-y-auto">{children}</div>

      {open && <ChatPanel onClose={() => setOpen(false)} />}

      {!open && (
        <Button
          variant="outline"
          size="icon"
          className="fixed right-6 bottom-6 z-40 size-12 rounded-full shadow-lg"
          onClick={() => setOpen(true)}
        >
          <MessageCircle className="size-5" />
          <span className="sr-only">Chat with your portfolio</span>
        </Button>
      )}
    </div>
  )
}
