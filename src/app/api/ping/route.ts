import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ ok: true, from: "App Router /api/ping" });
}
