import { bekuldesKeres, megerositesKeres } from "./ervenyesites.js";
import { latogatoIp } from "./ip.js";
import type { JatekApi } from "./jatek-api.js";
import {
  BEKULDES_RENDBEN,
  MAR_MEGEROSITVE,
  MEGEROSITVE,
  bekuldesHiba,
  megerositesHiba,
} from "./uzenetek.js";

/**
 * A KET VEGPONT LOGIKAJA, a Next-fuggoseg nelkul (a route handler csak becsomagolja): igy egy rogzito hamis api-val
 * tesztelheto, hogy mi megy tovabb az api-nak (a latogato IP-je), melyik statuszt kapja a bongeszo, es hogy a
 * valaszban SEMMI nem arulja el a valasz helyesseget vagy azt, hogy egy cim jatszott-e mar.
 */
export type Valasz = { status: number; body: Record<string, unknown> };

/** Az api hibastatuszai kozul csak ezeket adjuk tovabb a bongeszonek; minden mas "nem elerheto" (503). */
const BEKULDES_STATUSZOK = new Set([400, 404, 409, 429]);
const MEGEROSITES_STATUSZOK = new Set([400, 409, 429]);

export async function bekuldesKezeles(
  test: unknown,
  forwardedFor: string | null,
  api: JatekApi,
): Promise<Valasz> {
  const ellenorzott = bekuldesKeres(test);
  if (!ellenorzott.ok)
    return {
      status: 400,
      body: {
        ok: false,
        code: ellenorzott.code,
        message: bekuldesHiba(ellenorzott.code),
      },
    };
  const eredmeny = await api.bekuldes(
    ellenorzott.value,
    latogatoIp(forwardedFor),
  );
  if (eredmeny.ok)
    return { status: 200, body: { ok: true, message: BEKULDES_RENDBEN } };
  return {
    status: BEKULDES_STATUSZOK.has(eredmeny.status) ? eredmeny.status : 503,
    body: {
      ok: false,
      code: eredmeny.code,
      message: bekuldesHiba(eredmeny.code, eredmeny.message),
    },
  };
}

export async function megerositesKezeles(
  test: unknown,
  forwardedFor: string | null,
  api: JatekApi,
): Promise<Valasz> {
  const ellenorzott = megerositesKeres(test);
  if (!ellenorzott.ok)
    return {
      status: 400,
      body: {
        ok: false,
        code: ellenorzott.code,
        message: megerositesHiba("INVALID_TOKEN"),
      },
    };
  const eredmeny = await api.megerosites(
    ellenorzott.value.token,
    latogatoIp(forwardedFor),
  );
  if (eredmeny.ok)
    return {
      status: 200,
      body: {
        ok: true,
        status: eredmeny.status,
        message:
          eredmeny.status === "CONFIRMED" ? MEGEROSITVE : MAR_MEGEROSITVE,
      },
    };
  return {
    status: MEGEROSITES_STATUSZOK.has(eredmeny.status) ? eredmeny.status : 503,
    body: {
      ok: false,
      code: eredmeny.code,
      message: megerositesHiba(eredmeny.code, eredmeny.message),
    },
  };
}
