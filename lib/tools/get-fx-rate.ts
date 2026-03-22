import { tool } from "ai"
import { z } from "zod"

import { fetchUsdTwdFxSnapshot } from "@/lib/quotes/twelve-data"

export const getFxRate = tool({
  description:
    "Get the current USD/TWD exchange rate. Returns the latest end-of-day rate and the date it was recorded.",
  inputSchema: z.object({}),
  execute: async () => {
    const snapshot = await fetchUsdTwdFxSnapshot()

    return {
      pair: snapshot.pair,
      rate: snapshot.rate,
      asOf: snapshot.asOf,
    }
  },
})
