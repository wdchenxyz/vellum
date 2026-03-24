"use client"

import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import {
  MessageCircle,
  Moon,
  Paintbrush,
  Sun,
  Monitor,
  Keyboard,
} from "lucide-react"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command"
import { useChatDrawer } from "@/components/chat-drawer"

const PALETTES = [
  { value: "default", label: "Clean Slate" },
  { value: "layered", label: "Layered Gray" },
  { value: "ink", label: "Ink & Paper" },
  { value: "warm", label: "Warm Neutral" },
  { value: "cool", label: "Cool Steel" },
  { value: "midnight", label: "Midnight Blue" },
  { value: "sepia", label: "Paper & Sepia" },
  { value: "contrast", label: "High Contrast" },
  { value: "rose", label: "Rosé" },
  { value: "forest", label: "Forest" },
] as const

type PaletteValue = (typeof PALETTES)[number]["value"]

function applyPalette(value: PaletteValue) {
  if (value === "default") {
    document.documentElement.removeAttribute("data-palette")
  } else {
    document.documentElement.setAttribute("data-palette", value)
  }
  localStorage.setItem("palette", value)
}

export default function CommandPaletteInner() {
  const [open, setOpen] = useState(false)
  const { setTheme, resolvedTheme } = useTheme()
  const { open: chatOpen, setOpen: setChatOpen } = useChatDrawer()

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [])

  function run(fn: () => void) {
    fn()
    setOpen(false)
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => run(() => setChatOpen(!chatOpen))}>
            <MessageCircle className="size-4" />
            {chatOpen ? "Close chat" : "Open chat"}
            <CommandShortcut>Chat</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Appearance">
          <CommandItem onSelect={() => run(() => setTheme("light"))}>
            <Sun className="size-4" />
            Light mode
            {resolvedTheme === "light" && (
              <CommandShortcut>Active</CommandShortcut>
            )}
          </CommandItem>
          <CommandItem onSelect={() => run(() => setTheme("dark"))}>
            <Moon className="size-4" />
            Dark mode
            {resolvedTheme === "dark" && (
              <CommandShortcut>Active</CommandShortcut>
            )}
          </CommandItem>
          <CommandItem onSelect={() => run(() => setTheme("system"))}>
            <Monitor className="size-4" />
            System theme
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Palettes">
          {PALETTES.map((p) => (
            <CommandItem
              key={p.value}
              onSelect={() => run(() => applyPalette(p.value))}
            >
              <Paintbrush className="size-4" />
              {p.label}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandGroup heading="Help">
          <CommandItem disabled>
            <Keyboard className="size-4" />
            Press ⌘K anytime to open this palette
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
