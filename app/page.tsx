import { ChatLayout, ChatTrigger } from "@/components/chat-drawer"
import { CommandPalette } from "@/components/command-palette"
import { PaletteToggle } from "@/components/palette-toggle"
import { TradeExtractor } from "@/components/trade-extractor"

export default function Page() {
  return (
    <ChatLayout>
      <main className="surface-page min-h-svh bg-background">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-8 sm:px-6 lg:py-12">
          <header className="flex items-center justify-between">
            <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              Vellum
            </h1>
            <div className="flex items-center gap-0.5">
              <ChatTrigger />
              <PaletteToggle />
            </div>
          </header>

          <TradeExtractor />
        </div>
      </main>
      <CommandPalette />
    </ChatLayout>
  )
}
