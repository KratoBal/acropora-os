import { NextResponse } from "next/server";

import { applicationHealth } from "@/lib/application-health";

// The runtime commit is deployment-provided. A static GET route would capture
// it during `next build`, which would turn a real runtime disagreement into a
// misleadingly stable answer.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Public self-description; missing evidence is explicit, never a mismatch. */
export async function GET() {
  return NextResponse.json({
    application: applicationHealth(),
    timestamp: new Date().toISOString(),
  });
}
