import { TradeExtractor } from "@/components/trade-extractor"
import { Badge } from "@/components/ui/badge"

export default function Page() {
  return (
    <main className="min-h-svh bg-[radial-gradient(circle_at_top_left,rgba(180,137,88,0.18),transparent_26%),radial-gradient(circle_at_bottom_right,rgba(48,94,86,0.18),transparent_32%),linear-gradient(180deg,rgba(255,255,255,0.96),rgba(249,247,242,0.92))] dark:bg-[radial-gradient(circle_at_top_left,rgba(180,137,88,0.12),transparent_26%),radial-gradient(circle_at_bottom_right,rgba(48,94,86,0.12),transparent_32%),linear-gradient(180deg,rgba(14,18,24,0.96),rgba(12,14,18,0.98))]">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 lg:py-12">
        <section className="flex max-w-3xl flex-col gap-4">
          <Badge variant="secondary" className="w-fit">
            Trade Capture MVP
          </Badge>
          <div className="flex flex-col gap-3">
            <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              Turn trade screenshots into typed rows.
            </h1>
            <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
              Drop broker confirmations or PDFs, add an optional note, and let
              Claude pull out every visible BUY or SELL transaction into a
              growing table.
            </p>
          </div>
        </section>

        <TradeExtractor />
      </div>
    </main>
  )
}
