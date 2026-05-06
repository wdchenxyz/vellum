import { NextResponse } from "next/server"

import {
  readInstrumentExposureProfiles,
  upsertInstrumentExposureProfile,
} from "@/lib/portfolio/exposure-profile-storage"
import { upsertInstrumentExposureProfileSchema } from "@/lib/portfolio/exposure-profiles"

export const dynamic = "force-dynamic"
export const maxDuration = 30
export const runtime = "nodejs"

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

export async function GET() {
  try {
    const profiles = await readInstrumentExposureProfiles()

    return NextResponse.json(
      { profiles },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    )
  } catch (error) {
    return NextResponse.json(
      {
        error: getErrorMessage(error, "Unable to load exposure profiles."),
      },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  let payload: unknown

  try {
    payload = await request.json()
  } catch {
    return NextResponse.json(
      { error: "The exposure profile payload is invalid JSON." },
      { status: 400 }
    )
  }

  const parsed = upsertInstrumentExposureProfileSchema.safeParse({
    ...(payload && typeof payload === "object" ? payload : {}),
    source: "user",
  })

  if (!parsed.success) {
    return NextResponse.json(
      { error: "The exposure profile payload is invalid." },
      { status: 400 }
    )
  }

  try {
    const profile = await upsertInstrumentExposureProfile(parsed.data)

    return NextResponse.json(
      { profile },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    )
  } catch (error) {
    return NextResponse.json(
      {
        error: getErrorMessage(error, "Unable to save exposure profile."),
      },
      { status: 500 }
    )
  }
}
