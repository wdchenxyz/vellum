import "server-only"

import { z } from "zod"

const FINMIND_DATA_URL = "https://api.finmindtrade.com/api/v4/data"
const TAIWAN_LISTED_COMPANIES_URL =
  "https://openapi.twse.com.tw/v1/opendata/t187ap03_L"
const TAIWAN_LISTED_ISIN_URL =
  "https://isin.twse.com.tw/isin/C_public.jsp?strMode=2"
const TAIWAN_OTC_ISIN_URL =
  "https://isin.twse.com.tw/isin/C_public.jsp?strMode=4"

const listedCompanySchema = z.array(
  z.object({
    公司代號: z.string(),
    公司名稱: z.string(),
    公司簡稱: z.string(),
  })
)

const finMindTaiwanStockInfoResponseSchema = z.object({
  data: z
    .array(
      z.object({
        stock_id: z.string(),
        stock_name: z.string(),
        type: z.string(),
      })
    )
    .default([]),
  msg: z.string().optional(),
  status: z.union([z.number(), z.string()]).optional(),
})

type TaiwanListing = {
  exchange: string
  matchedName: string
  micCode: string
  source: string
  symbol: string
}

type TaiwanListingMap = Map<string, TaiwanListing>

let cachedTaiwanListingsPromise: Promise<TaiwanListingMap> | null = null
let cachedFinMindTaiwanListingsPromise: Promise<TaiwanListingMap> | null = null

function isDefaultFetch(fetcher: typeof fetch) {
  return fetcher === fetch
}

function normalizeTaiwanTerm(value: string) {
  return value.replace(/\s+/g, "").replaceAll("臺", "台").trim().toUpperCase()
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
}

function cleanHtmlText(value: string) {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, "")).trim()
}

function addAlias(
  listings: TaiwanListingMap,
  alias: string,
  entry: Omit<TaiwanListing, "matchedName">
) {
  const normalizedAlias = normalizeTaiwanTerm(alias)

  if (!normalizedAlias || listings.has(normalizedAlias)) {
    return
  }

  listings.set(normalizedAlias, {
    ...entry,
    matchedName: alias.trim(),
  })
}

function getTaiwanExchangeInfo(type: string) {
  const normalizedType = type.trim().toLowerCase()

  if (normalizedType === "twse") {
    return { exchange: "TWSE", micCode: "XTAI" }
  }

  if (normalizedType === "tpex" || normalizedType === "otc") {
    return { exchange: "TPEX", micCode: "ROCO" }
  }

  if (normalizedType === "rotc" || normalizedType === "esb") {
    return { exchange: "ROTC", micCode: "ROCO" }
  }

  return { exchange: type.trim().toUpperCase(), micCode: "ROCO" }
}

function addChineseAliases(
  listings: TaiwanListingMap,
  name: string,
  entry: Omit<TaiwanListing, "matchedName">
) {
  const aliases = new Set<string>([name])

  aliases.add(name.replace(/股份有限公司/g, ""))
  aliases.add(name.replace(/控股股份有限公司/g, "控股"))
  aliases.add(name.replace(/股份有限公司/g, "").replace(/有限公司/g, ""))
  aliases.add(`${entry.symbol}${name}`)
  aliases.add(`${name}${entry.symbol}`)

  for (const alias of aliases) {
    if (alias.trim()) {
      addAlias(listings, alias, entry)
    }
  }

  addAlias(listings, entry.symbol, entry)
}

async function fetchTaiwanListedCompanies(fetcher: typeof fetch) {
  const response = await fetcher(TAIWAN_LISTED_COMPANIES_URL, {
    cache: "no-store",
  })

  if (!response.ok) {
    throw new Error("Unable to load Taiwan listed company metadata.")
  }

  const payload = await response.json().catch(() => null)
  const parsed = listedCompanySchema.safeParse(payload)

  if (!parsed.success) {
    throw new Error("Taiwan listed company metadata is invalid.")
  }

  return parsed.data
}

async function fetchTaiwanIsinPage(url: string, fetcher: typeof fetch) {
  const response = await fetcher(url, {
    cache: "no-store",
  })

  if (!response.ok) {
    throw new Error(`Unable to load Taiwan ISIN metadata from ${url}.`)
  }

  const buffer = await response.arrayBuffer()
  return new TextDecoder("big5").decode(buffer)
}

function parseTaiwanIsinShortNames(
  html: string,
  exchange: string,
  micCode: string,
  source: string
) {
  const listings: TaiwanListingMap = new Map()

  for (const rowMatch of html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = [...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(
      (cellMatch) => cleanHtmlText(cellMatch[1])
    )

    if (cells.length < 4) {
      continue
    }

    const [codeAndName, isin, , listingStatus] = cells

    if (
      !isin.startsWith("TW000") ||
      !["上市", "上櫃"].includes(listingStatus)
    ) {
      continue
    }

    const codeAndNameMatch = codeAndName.match(/^([0-9A-Z]{4,6})[\s　]+(.+)$/)

    if (!codeAndNameMatch) {
      continue
    }

    const [, symbol, shortName] = codeAndNameMatch

    addChineseAliases(listings, shortName, {
      exchange,
      micCode,
      source,
      symbol,
    })
  }

  return listings
}

async function loadTaiwanListings(fetcher: typeof fetch) {
  const [listedCompanies, listedIsinHtml, otcIsinHtml] = await Promise.all([
    fetchTaiwanListedCompanies(fetcher),
    fetchTaiwanIsinPage(TAIWAN_LISTED_ISIN_URL, fetcher),
    fetchTaiwanIsinPage(TAIWAN_OTC_ISIN_URL, fetcher),
  ])

  const listings: TaiwanListingMap = new Map()

  for (const company of listedCompanies) {
    const entry = {
      exchange: "TWSE",
      micCode: "XTAI",
      source: "twse-listed-companies",
      symbol: company.公司代號.trim(),
    }

    addChineseAliases(listings, company.公司簡稱, entry)
    addChineseAliases(listings, company.公司名稱, entry)
  }

  for (const entry of parseTaiwanIsinShortNames(
    listedIsinHtml,
    "TWSE",
    "XTAI",
    "twse-isin-listed"
  ).values()) {
    addAlias(listings, entry.matchedName, entry)
  }

  for (const entry of parseTaiwanIsinShortNames(
    otcIsinHtml,
    "TPEX",
    "ROCO",
    "twse-isin-otc"
  ).values()) {
    addAlias(listings, entry.matchedName, entry)
  }

  return listings
}

async function loadFinMindTaiwanListings(fetcher: typeof fetch) {
  const url = new URL(FINMIND_DATA_URL)
  url.searchParams.set("dataset", "TaiwanStockInfo")

  const response = await fetcher(url, {
    cache: "no-store",
  })

  if (!response.ok) {
    throw new Error("Unable to load FinMind Taiwan stock metadata.")
  }

  const payload = await response.json().catch(() => null)
  const parsed = finMindTaiwanStockInfoResponseSchema.safeParse(payload)

  if (!parsed.success) {
    throw new Error("FinMind Taiwan stock metadata is invalid.")
  }

  const listings: TaiwanListingMap = new Map()

  for (const item of parsed.data.data) {
    const entry = {
      ...getTaiwanExchangeInfo(item.type),
      source: "finmind-taiwan-stock-info",
      symbol: item.stock_id.trim(),
    }

    addChineseAliases(listings, item.stock_name, entry)
  }

  return listings
}

async function getTaiwanListings(fetcher: typeof fetch) {
  if (!isDefaultFetch(fetcher)) {
    return loadTaiwanListings(fetcher)
  }

  if (!cachedTaiwanListingsPromise) {
    cachedTaiwanListingsPromise = loadTaiwanListings(fetcher).catch((error) => {
      cachedTaiwanListingsPromise = null
      throw error
    })
  }

  return cachedTaiwanListingsPromise
}

async function getFinMindTaiwanListings(fetcher: typeof fetch) {
  if (!isDefaultFetch(fetcher)) {
    return loadFinMindTaiwanListings(fetcher)
  }

  if (!cachedFinMindTaiwanListingsPromise) {
    cachedFinMindTaiwanListingsPromise = loadFinMindTaiwanListings(
      fetcher
    ).catch((error) => {
      cachedFinMindTaiwanListingsPromise = null
      throw error
    })
  }

  return cachedFinMindTaiwanListingsPromise
}

export async function resolveTaiwanTickerByName(
  name: string,
  fetcher: typeof fetch = fetch
) {
  const normalizedName = normalizeTaiwanTerm(name)
  let lastError: Error | null = null

  try {
    const listings = await getTaiwanListings(fetcher)
    const exactMatch = listings.get(normalizedName)

    if (exactMatch) {
      return exactMatch
    }
  } catch (error) {
    if (error instanceof Error) {
      lastError = error
    }
  }

  try {
    const finMindListings = await getFinMindTaiwanListings(fetcher)
    return finMindListings.get(normalizedName) ?? null
  } catch (error) {
    if (error instanceof Error) {
      lastError = error
    }
  }

  if (lastError) {
    throw lastError
  }

  return null
}
