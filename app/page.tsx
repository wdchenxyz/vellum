import { TradeExtractor } from "@/components/trade-extractor"

export default function Page() {
  return (
    <main className="min-h-svh bg-[radial-gradient(circle_at_top_left,rgba(74,122,114,0.18),transparent_31%),radial-gradient(circle_at_bottom_right,rgba(175,133,84,0.16),transparent_34%),linear-gradient(180deg,rgba(250,248,243,0.98),rgba(244,239,230,1))] dark:bg-[radial-gradient(circle_at_top_left,rgba(92,161,151,0.16),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(181,138,86,0.14),transparent_34%),linear-gradient(180deg,rgba(22,28,31,1),rgba(18,21,25,1))]">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-8 sm:px-6 lg:py-12">
        <section className="max-w-2xl space-y-3">
          <p className="text-sm font-medium tracking-[0.14em] text-primary uppercase">
            Trade capture
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Turn confirmations into rows.
          </h1>
          <p className="text-base leading-7 text-muted-foreground sm:text-lg">
            Upload broker screenshots or PDFs, extract the trades, then{" "}
            <span className="text-primary">review the saved ledger</span> before
            you move on to portfolio analysis.
          </p>
        </section>

        <TradeExtractor />
      </div>
    </main>
  )
}
