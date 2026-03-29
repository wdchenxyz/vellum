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
import { allToolLabels } from "@/lib/agents/skills/tool-labels"
import { cn } from "@/lib/utils"
import { useChat } from "@ai-sdk/react"
import { Loader2, Maximize2, MessageCircle, Minimize2, X } from "lucide-react"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"

const SIDEBAR_WIDTH = "w-[480px]"

const ChatDrawerContext = createContext<{
  open: boolean
  setOpen: (open: boolean) => void
  expanded: boolean
  setExpanded: (expanded: boolean) => void
}>({ open: false, setOpen: () => {}, expanded: false, setExpanded: () => {} })

export function useChatDrawer() {
  return useContext(ChatDrawerContext)
}

const ChatStateContext = createContext<ReturnType<typeof useChat> | null>(null)

function useChatState() {
  const ctx = useContext(ChatStateContext)
  if (!ctx) throw new Error("useChatState must be used within ChatStateProvider")
  return ctx
}

function ChatStateProvider({ children }: { children: ReactNode }) {
  const chat = useChat({})
  return (
    <ChatStateContext.Provider value={chat}>
      {children}
    </ChatStateContext.Provider>
  )
}

export function ChatTrigger() {
  const { open, setOpen } = useChatDrawer()

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(
        "size-8",
        open ? "text-foreground" : "text-muted-foreground"
      )}
      onClick={() => setOpen(!open)}
    >
      <MessageCircle className="size-4" />
      <span className="sr-only">
        {open ? "Close chat" : "Chat with your portfolio"}
      </span>
    </Button>
  )
}

function ToolCallIndicator({ toolName }: { toolName: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
      <Loader2 className="size-3 animate-spin" />
      <span>{allToolLabels[toolName] ?? `Running ${toolName}`}</span>
    </div>
  )
}

function ChatMessages() {
  const { messages } = useChatState()

  return (
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
  )
}

function ChatInput() {
  const [input, setInput] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { sendMessage, status, stop } = useChatState()
  const isStreaming = status === "streaming" || status === "submitted"

  const handleSubmit = useCallback(
    (message: PromptInputMessage) => {
      const text = message.text.trim()
      if (!text) return

      sendMessage({ text })
      setInput("")

      requestAnimationFrame(() => {
        textareaRef.current?.focus()
      })
    },
    [sendMessage]
  )

  return (
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
  )
}

function ChatPanelHeader() {
  const { expanded, setExpanded, setOpen } = useChatDrawer()

  return (
    <div className="flex items-center justify-between border-b px-4 py-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-medium">Portfolio Assistant</h2>
        <p className="text-xs text-muted-foreground">
          Ask about trades, holdings, and performance.
        </p>
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <Minimize2 className="size-4" />
          ) : (
            <Maximize2 className="size-4" />
          )}
          <span className="sr-only">
            {expanded ? "Collapse to sidebar" : "Expand chat to fullscreen"}
          </span>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => {
            setExpanded(false)
            setOpen(false)
          }}
        >
          <X className="size-4" />
          <span className="sr-only">Close chat</span>
        </Button>
      </div>
    </div>
  )
}

function ChatPanel() {
  const { expanded, setExpanded } = useChatDrawer()

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && expanded) {
        setExpanded(false)
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [expanded, setExpanded])

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/50 transition-opacity duration-300",
          expanded ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={() => setExpanded(false)}
      />

      {/* Chat panel — animates between sidebar and centered fullscreen */}
      <div
        className={cn(
          "fixed top-0 right-0 z-50 flex h-full flex-col border-l bg-background transition-all duration-300 ease-in-out",
          expanded
            ? "w-full border-l-0 shadow-2xl"
            : "w-[480px]"
        )}
      >
        <ChatPanelHeader />
        <div className="flex min-h-0 flex-1 flex-col">
          <ChatMessages />
          <ChatInput />
        </div>
      </div>
    </>
  )
}

export function ChatLayout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "j" && e.metaKey && !e.shiftKey) {
        e.preventDefault()
        setOpen((o) => !o)
      }
      if (e.key === "." && e.metaKey) {
        e.preventDefault()
        setOpen(true)
        setExpanded((ex) => !ex)
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [])

  return (
    <ChatDrawerContext.Provider value={{ open, setOpen, expanded, setExpanded }}>
      <ChatStateProvider>
        <div className="flex h-svh overflow-hidden">
          <div className="flex-1 overflow-y-auto">{children}</div>
          {/* Spacer to push content when sidebar is open */}
          {open && !expanded && (
            <div className="w-[480px] shrink-0" />
          )}
        </div>
        {open && <ChatPanel />}
      </ChatStateProvider>
    </ChatDrawerContext.Provider>
  )
}
