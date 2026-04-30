import { NextResponse, type NextRequest } from "next/server"

import {
  upsertExposureProfileRequestSchema,
  type UpsertInstrumentExposureProfile,
} from "@/lib/portfolio/exposure-profiles"
import {
  readInstrumentExposureProfiles,
  upsertInstrumentExposureProfile,
} from "@/lib/portfolio/exposure-profile-storage"

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
        error: getErrorMessage(
          error,
          "Unable to load exposure profiles."
        ),
      },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const parsed = upsertExposureProfileRequestSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: "A valid exposure profile is required." },
        { status: 400 }
      )
    }

    const profileInput: UpsertInstrumentExposureProfile = {
      ...parsed.data.profile,
      source: parsed.data.profile.source ?? "user",
    }
    const profile = await upsertInstrumentExposureProfile(profileInput)

    return NextResponse.json({ profile })
  } catch (error) {
    return NextResponse.json(
      {
        error: getErrorMessage(
          error,
          "Unable to save the exposure profile."
        ),
      },
      { status: 500 }
    )
  }
}
