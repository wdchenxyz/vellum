import { TradeExtractor } from "@/components/trade-extractor"

export default function Page() {
  return (
    <main className="surface-page min-h-svh bg-background">
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
