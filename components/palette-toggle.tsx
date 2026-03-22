"use client"

import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import { Monitor, Moon, Paintbrush, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

// Swatches: [background, card, primary accent]
const PALETTES = [
  {
    value: "default",
    label: "Clean Slate",
    swatch: {
      light: ["#fafafa", "#fff", "#007AFF"],
      dark: ["#252525", "#303030", "#4A9EFF"],
    },
  },
  {
    value: "layered",
    label: "Layered Gray",
    swatch: {
      light: ["#f5f5f5", "#fff", "#007AFF"],
      dark: ["#181818", "#333", "#4A9EFF"],
    },
  },
  {
    value: "ink",
    label: "Ink & Paper",
    swatch: {
      light: ["#fcfcfc", "#fcfcfc", "#3a3a3a"],
      dark: ["#0d0d0d", "#0d0d0d", "#e5e5e5"],
    },
  },
  {
    value: "warm",
    label: "Warm Neutral",
    swatch: {
      light: ["#f8f5ef", "#fdfbf7", "#9a6830"],
      dark: ["#262218", "#302c22", "#c8986a"],
    },
  },
  {
    value: "cool",
    label: "Cool Steel",
    swatch: {
      light: ["#f3f5f9", "#f8f9fb", "#4a6fa5"],
      dark: ["#202328", "#282c32", "#7a9ec8"],
    },
  },
  {
    value: "midnight",
    label: "Midnight Blue",
    swatch: {
      light: ["#f5f6fb", "#fafbfd", "#5040b0"],
      dark: ["#141628", "#1e2038", "#8a7ae0"],
    },
  },
  {
    value: "sepia",
    label: "Paper & Sepia",
    swatch: {
      light: ["#ede5d0", "#f3ebda", "#8a5a28"],
      dark: ["#231e14", "#2e2820", "#c89060"],
    },
  },
  {
    value: "contrast",
    label: "High Contrast",
    swatch: {
      light: ["#fff", "#fff", "#262626"],
      dark: ["#000", "#000", "#ededed"],
    },
  },
  {
    value: "rose",
    label: "Ros\u00e9",
    swatch: {
      light: ["#faf4f6", "#fdf8fa", "#c0507a"],
      dark: ["#281c22", "#342630", "#e08aaa"],
    },
  },
  {
    value: "forest",
    label: "Forest",
    swatch: {
      light: ["#f0f7f2", "#f7fbf8", "#357a50"],
      dark: ["#182018", "#222e24", "#68b080"],
    },
  },
] as const

type PaletteValue = (typeof PALETTES)[number]["value"]

function Swatch({ colors }: { colors: readonly [string, string, string] }) {
  return (
    <span className="flex h-4 w-7 shrink-0 overflow-hidden rounded-sm border border-foreground/10">
      {colors.map((color, i) => (
        <span key={i} className="flex-1" style={{ backgroundColor: color }} />
      ))}
    </span>
  )
}

function applyPalette(value: PaletteValue) {
  if (value === "default") {
    document.documentElement.removeAttribute("data-palette")
    localStorage.setItem("palette", "default")
  } else {
    document.documentElement.setAttribute("data-palette", value)
    localStorage.setItem("palette", value)
  }
}

function PaletteToggle() {
  const [palette, setPalette] = useState<PaletteValue>("ink")
  const [mounted, setMounted] = useState(false)
  const { resolvedTheme, theme, setTheme } = useTheme()

  useEffect(() => {
    setMounted(true)
    const stored = (localStorage.getItem("palette") || "ink") as PaletteValue
    setPalette(stored)
    applyPalette(stored)
  }, [])

  function selectPalette(value: string) {
    const v = value as PaletteValue
    setPalette(v)
    applyPalette(v)
  }

  if (!mounted) return null

  const isDark = resolvedTheme === "dark"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground"
        >
          <Paintbrush className="size-4" />
          <span className="sr-only">Theme settings</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Mode</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={theme ?? "system"}
          onValueChange={setTheme}
        >
          {(
            [
              { value: "light", icon: Sun, label: "Light" },
              { value: "dark", icon: Moon, label: "Dark" },
              { value: "system", icon: Monitor, label: "System" },
            ] as const
          ).map(({ value, icon: Icon, label }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon className="size-3.5" />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />

        <DropdownMenuLabel>Palette</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={palette} onValueChange={selectPalette}>
          {PALETTES.map((p) => (
            <DropdownMenuRadioItem key={p.value} value={p.value}>
              <Swatch colors={isDark ? p.swatch.dark : p.swatch.light} />
              {p.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { PaletteToggle }
