"use client"

import dynamic from "next/dynamic"

const CommandPaletteInner = dynamic(
  () => import("@/components/command-palette-inner"),
  { ssr: false },
)

export function CommandPalette() {
  return <CommandPaletteInner />
}
