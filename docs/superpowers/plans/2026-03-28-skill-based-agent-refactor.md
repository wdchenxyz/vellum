# Skill-Based Agent Architecture Refactor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the chat agent from a flat tool list into a skill-based architecture using AI SDK's `prepareStep`, so new tool groups (news, research, etc.) can be added by defining a skill object.

**Architecture:** Define skills as `{ name, tools, systemPrompt }` objects. A shared base prompt covers product knowledge and rules. Each skill adds domain-specific instructions and restricts `activeTools` via `prepareStep`. The route handler assembles all skill tools into one `tools` object and uses `prepareStep` to dynamically select the active skill per step.

**Tech Stack:** AI SDK v6 (`streamText`, `prepareStep`, `activeTools`), TypeScript, Zod

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `lib/agents/skills/types.ts` | `Skill` type definition |
| Create | `lib/agents/skills/portfolio.ts` | Portfolio skill: tools + domain prompt |
| Create | `lib/agents/skills/index.ts` | Skill registry, merged tools, `prepareStep` function |
| Modify | `lib/agents/chat-agent.ts` | Slim down to base prompt + re-export from skills registry |
| Modify | `app/api/chat/route.ts` | Wire in `prepareStep` |
| Modify | `components/chat-drawer.tsx` | Make `ToolCallIndicator` labels dynamic (not hardcoded per tool) |

**Files NOT touched:** `lib/tools/*.ts` (individual tool implementations stay as-is).

---

### Task 1: Define the Skill type

**Files:**
- Create: `lib/agents/skills/types.ts`

- [ ] **Step 1: Create the Skill type**

```typescript
// lib/agents/skills/types.ts
import type { ToolSet } from "ai"

export interface Skill<T extends ToolSet = ToolSet> {
  /** Unique identifier for this skill */
  name: string
  /** Human-readable description (used for logging/debugging) */
  description: string
  /** Tool definitions belonging to this skill */
  tools: T
  /** Domain-specific system prompt fragment appended when this skill is active */
  systemPrompt: string
  /** Human-readable labels for tool call indicators in the UI */
  toolLabels: Record<string, string>
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/agents/skills/types.ts
git commit -m "feat: add Skill type definition for skill-based agent architecture"
```

---

### Task 2: Extract portfolio skill

Move the existing 5 tools and their domain-specific prompt into a `portfolio` skill object.

**Files:**
- Create: `lib/agents/skills/portfolio.ts`

- [ ] **Step 1: Create the portfolio skill**

The system prompt gets split: product knowledge and rules stay in the base prompt (Task 3), while tool-specific capabilities and guidelines move here.

```typescript
// lib/agents/skills/portfolio.ts
import type { Skill } from "./types"
import { getDailyValues } from "@/lib/tools/get-daily-values"
import { getFxRate } from "@/lib/tools/get-fx-rate"
import { getHoldings } from "@/lib/tools/get-holdings"
import { getStockPerformance } from "@/lib/tools/get-stock-performance"
import { getTradeHistory } from "@/lib/tools/get-trade-history"

const portfolioTools = {
  getTradeHistory,
  getHoldings,
  getDailyValues,
  getStockPerformance,
  getFxRate,
}

export const portfolioSkill: Skill<typeof portfolioTools> = {
  name: "portfolio",
  description: "Portfolio analysis: trades, holdings, performance, benchmarks",
  tools: portfolioTools,
  systemPrompt: `<capabilities>
You have access to these tools:
- **getTradeHistory**: Retrieve trade records (BUY/SELL) with optional filters for ticker, account, date range, and side.
- **getHoldings**: Get current portfolio holdings with market values, weights, cost basis, and P&L.
- **getDailyValues**: Get daily portfolio value time series plus cash-flow-adjusted S&P 500 and TAIEX benchmarks. This also computes return percentages and max drawdown.
- **getStockPerformance**: Get individual stock price performance over a date range. Returns start price, end price, and return % for each holding. Use this to rank best/worst performers (e.g. YTD, last quarter).
- **getFxRate**: Get the current USD/TWD exchange rate.
</capabilities>

<guidelines>
- When the user asks how to use Vellum (uploading trades, navigating the dashboard, etc.), answer from the product knowledge above. No tool call needed.
- When comparing portfolio performance vs benchmarks, use getDailyValues with the relevant date range.
- When analyzing drawdowns, use getDailyValues which computes max drawdown automatically.
- When the user asks about holdings or positions, use getHoldings.
- When the user asks about specific trades, use getTradeHistory with appropriate filters.
- When the user asks which stocks performed best/worst over a period, use getStockPerformance with the date range.
- Default currency is TWD. Always present values in TWD unless the user explicitly asks for USD. Convert USD values to TWD using getFxRate when needed.
- Format currency values with proper symbols (NT$ for TWD, $ for USD) and thousand separators.
- Format percentages to 2 decimal places.
- Present data in clear markdown tables when comparing multiple items.
- All portfolio values from getDailyValues are denominated in TWD.
- Be concise but thorough. Show the numbers that matter.
</guidelines>`,
  toolLabels: {
    getTradeHistory: "Fetching trade history",
    getHoldings: "Loading portfolio holdings",
    getDailyValues: "Computing portfolio values",
    getStockPerformance: "Analyzing stock performance",
    getFxRate: "Checking exchange rate",
  },
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/agents/skills/portfolio.ts
git commit -m "feat: extract portfolio skill with tools, prompt, and UI labels"
```

---

### Task 3: Create the skill registry and prepareStep

Build the registry that merges all skills' tools, constructs the base system prompt, and provides the `prepareStep` function.

**Files:**
- Create: `lib/agents/skills/index.ts`

- [ ] **Step 1: Create the skill registry**

```typescript
// lib/agents/skills/index.ts
import type { InferUITools, ToolSet } from "ai"

import type { Skill } from "./types"
import { portfolioSkill } from "./portfolio"

// --- Skill Registry ---
// To add a new skill, import it and add it to this array.
export const skills: Skill[] = [portfolioSkill]

// --- Merged Tools ---
// Union of all tools across all skills, passed to streamText().
function mergeTools(skillList: Skill[]): ToolSet {
  const merged: ToolSet = {}
  for (const skill of skillList) {
    Object.assign(merged, skill.tools)
  }
  return merged
}

export const allTools = mergeTools(skills)
export type AllToolsParts = InferUITools<typeof allTools>

// --- Merged Tool Labels ---
// Union of all toolLabels across all skills, used by the UI.
function mergeToolLabels(skillList: Skill[]): Record<string, string> {
  const merged: Record<string, string> = {}
  for (const skill of skillList) {
    Object.assign(merged, skill.toolLabels)
  }
  return merged
}

export const allToolLabels = mergeToolLabels(skills)

// --- Base System Prompt ---
// Product knowledge and behavioral rules shared across all skills.
// Skill-specific prompts are appended by prepareStep when the skill is active.
export const BASE_SYSTEM_PROMPT = `<rules>
You are the built-in assistant for Vellum. You can answer questions about the product itself AND analyze the user's portfolio data.

If the user asks anything completely unrelated to Vellum or investing (e.g. general knowledge, coding help, personal advice, creative writing, etc.), politely decline and redirect them. For example: "I can help with anything about Vellum or your portfolio. What would you like to know?"

You must ALWAYS use tools to fetch real data before answering data questions. Never fabricate numbers, prices, or performance metrics.

Do not use emojis.

Today's date is ${new Date().toISOString().slice(0, 10)}.
</rules>

<product>
Vellum is a personal investment tracking tool. Here is how it works:

**Uploading trades (Ingest)**
- On the main page there is a file upload area where the user can drag-and-drop or paste screenshots and PDFs of trade confirmations.
- Supported file types: images (PNG, JPEG, etc.) and PDF. Up to 4 files at a time, each max 2 MB (6 MB total per batch).
- The user can optionally select a brokerage account label and add a context note before submitting.
- An AI model reads the uploaded files and extracts structured trade data (date, ticker, side, quantity, price, currency, fee) automatically.
- Extracted trades appear in the trades table below the upload area. The user can review and delete any incorrect rows.

**Portfolio dashboard**
- Once trades are ingested, Vellum shows:
  - **Holdings table**: current open positions grouped by account, with ticker, quantity, average cost, previous close price, market value, weight, and unrealized P&L.
  - **Portfolio summary cards**: total cost basis and total market value per account.
  - **Asset value chart**: daily portfolio value over time (in TWD), overlaid with cash-flow-adjusted S&P 500 and TAIEX benchmark lines.
  - **Weight chart**: visual breakdown of portfolio allocation by position.

**Supported markets**
- US equities (tickers like AAPL, MSFT) — prices from Twelve Data, denominated in USD.
- Taiwan equities (numeric stock codes like 2330, or Chinese company names like \u53F0\u7A4D\u96FB) — prices from FinMind/TWSE, denominated in TWD.
- USD/TWD exchange rate is used to normalize everything to TWD for the combined portfolio view.

**Data storage**
- All data is stored locally on the device. No cloud sync, no account system, no login required.
- Trade records persist across sessions in a local file.
- Quote and price history are cached locally with automatic refresh.

**This chat assistant**
- The user can open this chat sidebar from the floating button on the bottom-right corner of the page.
- The assistant can query the user's trades, holdings, daily portfolio values, benchmarks, and FX rates.
- It can answer questions like: performance comparison vs S&P 500, largest drawdown, holding weights, trade history for a specific ticker, etc.
</product>`

// --- Build System Prompt ---
// Constructs the full system prompt by appending all skill-specific prompts.
// With a single skill this is equivalent to the original monolithic prompt.
// When multiple skills exist, prepareStep can override this per-step.
export function buildSystemPrompt(activeSkills?: Skill[]): string {
  const skillsToInclude = activeSkills ?? skills
  const skillPrompts = skillsToInclude.map((s) => s.systemPrompt).join("\n\n")
  return `${BASE_SYSTEM_PROMPT}\n\n${skillPrompts}`
}

// --- Skill Lookup ---
// Find which skill owns a given tool name.
export function findSkillByToolName(toolName: string): Skill | undefined {
  return skills.find((skill) => toolName in skill.tools)
}
```

Note: `prepareStep` is NOT included here yet. In the current single-skill setup, the base prompt + portfolio skill prompt are simply concatenated. `prepareStep` is wired in the route handler (Task 4) so it's ready for multi-skill routing later.

- [ ] **Step 2: Commit**

```bash
git add lib/agents/skills/index.ts
git commit -m "feat: add skill registry with merged tools and system prompt builder"
```

---

### Task 4: Update the API route to use the skill architecture

Wire `prepareStep` into `streamText`. For now with one skill it simply returns all tools, but the structure is ready for multi-skill routing.

**Files:**
- Modify: `app/api/chat/route.ts`

- [ ] **Step 1: Update the route handler**

Replace the current contents of `app/api/chat/route.ts` with:

```typescript
import {
  convertToModelMessages,
  gateway,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai"

import { allTools, buildSystemPrompt } from "@/lib/agents/skills"
import { DEFAULT_MODEL } from "@/lib/trades/constants"

export const maxDuration = 60

export async function POST(request: Request) {
  const { messages }: { messages: UIMessage[] } = await request.json()

  const result = streamText({
    model: gateway(DEFAULT_MODEL),
    system: buildSystemPrompt(),
    messages: await convertToModelMessages(messages),
    tools: allTools,
    stopWhen: stepCountIs(5),
  })

  return result.toUIMessageStreamResponse()
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/chat/route.ts
git commit -m "refactor: use skill registry in chat API route"
```

---

### Task 5: Update chat-agent.ts to re-export from skills

Slim down `chat-agent.ts` to re-export from the skills registry, preserving backward compatibility for any future imports.

**Files:**
- Modify: `lib/agents/chat-agent.ts`

- [ ] **Step 1: Replace chat-agent.ts contents**

```typescript
// lib/agents/chat-agent.ts
// Re-exports from the skill registry for backward compatibility.
import { allTools, type AllToolsParts, buildSystemPrompt } from "./skills"

export { allTools as chatTools, buildSystemPrompt }
export type { AllToolsParts as ChatToolsParts }

// Kept as a named export for any callers that used CHAT_SYSTEM_PROMPT directly.
export const CHAT_SYSTEM_PROMPT = buildSystemPrompt()
```

- [ ] **Step 2: Commit**

```bash
git add lib/agents/chat-agent.ts
git commit -m "refactor: slim chat-agent.ts to re-export from skill registry"
```

---

### Task 6: Make ToolCallIndicator labels dynamic

Remove the hardcoded tool label map from `chat-drawer.tsx` and use the merged labels from the skill registry.

**Files:**
- Modify: `components/chat-drawer.tsx`

- [ ] **Step 1: Replace the hardcoded labels**

In `components/chat-drawer.tsx`, replace the `ToolCallIndicator` component:

```typescript
// Old:
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
```

Replace with:

```typescript
// New:
import { allToolLabels } from "@/lib/agents/skills"

function ToolCallIndicator({ toolName }: { toolName: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
      <Loader2 className="size-3 animate-spin" />
      <span>{allToolLabels[toolName] ?? `Running ${toolName}`}</span>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/chat-drawer.tsx
git commit -m "refactor: use skill registry tool labels in chat drawer"
```

---

### Task 7: Verify everything works

- [ ] **Step 1: Run the TypeScript compiler**

```bash
npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 2: Run the dev server and test**

```bash
npm run dev
```

Open the chat drawer, send a message like "What are my holdings?". Verify:
- The assistant calls `getHoldings` and returns data
- The `ToolCallIndicator` shows "Loading portfolio holdings" during the call
- The response renders correctly

- [ ] **Step 3: Run any existing tests**

```bash
npm test 2>/dev/null || npx vitest run 2>/dev/null || echo "No test runner configured"
```

- [ ] **Step 4: Final commit if any fixes were needed**

---

## Adding a New Skill (Future Reference)

When adding a new skill (e.g., news), the process is:

1. Create `lib/agents/skills/news.ts` exporting a `Skill` object with tools, prompt, and labels
2. Add the import to `lib/agents/skills/index.ts` and append to the `skills` array
3. Optionally add `prepareStep` logic to route per-step tool selection

No changes needed in the route handler, chat-agent.ts, or chat-drawer.tsx.
