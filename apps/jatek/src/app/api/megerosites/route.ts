import { NextResponse } from "next/server";

import { jatekApiKornyezetbol } from "@/lib/jatek-api";
import { megerositesKezeles } from "@/lib/kezelok";

export const dynamic = "force-dynamic";

/** POST /api/megerosites: a levelbeli link tokenje. Az ismetelt megerosites nem hiba (MAR megerositve). */
export async function POST(keres: Request) {
  let test: unknown;
  try {
    test = await keres.json();
  } catch {
    test = null;
  }
  const valasz = await megerositesKezeles(
    test,
    keres.headers.get("x-forwarded-for"),
    jatekApiKornyezetbol(process.env),
  );
  return NextResponse.json(valasz.body, { status: valasz.status });
}
