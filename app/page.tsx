import { TradeExtractor } from "@/components/trade-extractor"

export default function Page() {
  return (
    <main className="surface-page min-h-svh bg-background">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-8 sm:px-6 lg:py-12">
        <section className="max-w-2xl">
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Vellum
          </h1>
        </section>

        <TradeExtractor />
      </div>
    </main>
  )
}
