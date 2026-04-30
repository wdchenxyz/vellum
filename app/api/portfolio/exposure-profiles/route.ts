import { NextResponse } from "next/server"

import { readInstrumentExposureProfiles } from "@/lib/portfolio/exposure-profile-storage"

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
