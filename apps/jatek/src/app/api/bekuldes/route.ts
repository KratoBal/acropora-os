import { NextResponse } from "next/server";

import { jatekApiKornyezetbol } from "@/lib/jatek-api";
import { bekuldesKezeles } from "@/lib/kezelok";

export const dynamic = "force-dynamic";

/**
 * POST /api/bekuldes: a lap urlapjanak vegpontja. A logika a `lib/kezelok.ts`-ben van (tesztelt): a bemenet
 * ellenorzese, a latogato IP-jenek (a proxy altal fuzott UTOLSO ervenyes `X-Forwarded-For` bejegyzes) tovabbadasa,
 * es az api valaszanak a lap sajat mondataira forditasa.
 */
export async function POST(keres: Request) {
  let test: unknown;
  try {
    test = await keres.json();
  } catch {
    test = null;
  }
  const valasz = await bekuldesKezeles(
    test,
    keres.headers.get("x-forwarded-for"),
    jatekApiKornyezetbol(process.env),
  );
  return NextResponse.json(valasz.body, { status: valasz.status });
}
