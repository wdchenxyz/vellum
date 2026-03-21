# Context

## Project

- Vellum is a trade-capture MVP that turns broker screenshots and PDFs into structured BUY and SELL rows.
- The app derives open holdings from saved trades and can enrich holdings with previous-close and FX data.
- Stack: Next.js 16, React 19, TypeScript, Tailwind CSS v4, shadcn/ui, Recharts, Vitest.

## Current Focus

- Keep the primary flow centered on upload, extraction, and row review.
- Treat holdings and charting as secondary analysis revealed only when needed.
- Preserve clear, trustworthy presentation over decorative UI chrome.
- Use a restrained teal-and-bronze palette so color supports hierarchy without adding clutter.

## Design Context

- Source of truth lives in `.impeccable.md`.
- Direction: calm, utilitarian, trustworthy; light-first; Bloomberg-lite without glossy marketing patterns.

## Recent Change

- Simplified the page shell, upload surface, and review flow.
- Moved portfolio analysis behind progressive disclosure to reduce default cognitive load.
- Added a warm teal-and-bronze color system across tokens, tables, disclosures, and charts.
