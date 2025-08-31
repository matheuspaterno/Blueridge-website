import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({ error: "deprecated: use /src/app/api/ai/chat" }, { status: 410 });
}
