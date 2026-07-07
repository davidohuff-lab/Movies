import { NextRequest, NextResponse } from "next/server";

import { readNearbyPlacesDataset } from "@/lib/nearby-places-server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const theaterId = searchParams.get("theaterId");

  if (!theaterId) {
    return NextResponse.json({ message: "Choose a theater to load nearby places." }, { status: 400 });
  }

  try {
    const dataset = await readNearbyPlacesDataset(theaterId);
    if (!dataset) {
      return NextResponse.json(
        { message: "No dataset found for this theater yet. Run the builder." },
        { status: 404 }
      );
    }

    return NextResponse.json(dataset);
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid theater id") {
      return NextResponse.json(
        { message: "Choose a valid theater to load nearby places." },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { message: "Unable to load nearby places right now." },
      { status: 500 }
    );
  }
}
