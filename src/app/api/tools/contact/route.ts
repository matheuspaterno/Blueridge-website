import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({ error: "deprecated: use /src/app/api/leads or /src/app/api/contacts" }, { status: 410 });
}
