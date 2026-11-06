/**
 * A JATEK API-JA (az OS api `/jatek` alatti, bejelentkezes nelkuli harom vegpontja). A SZERZODES A MERVADO:
 * `exchange/jatek/` mellett nautilus fajlja (`agents/nautilus/atadas/jatek-api-szerzodes.md`, 2026-11-05); ha az
 * valtozik, ITT, EGY FAJLBAN kell atirni: az utvonalak, a mezonevek es a hibakodok mind ebben a modulban allnak.
 *
 * A JATEK SZERVERE HIVJA, NEM A BONGESZO: igy nem kell CORS, es az api cime nem kerul a lapra. A latogato IP-jet
 * `X-Forwarded-For`-ban adjuk tovabb (az api sebessegkorlatja erre megy).
 *
 * HAMIS ADAT: ha a `JATEK_API_URL` nincs beallitva, az oldal a `hamisJatekApi`-t hasznalja (a szerzodes peldai szo
 * szerint), hogy az api kint letele elott is kiprobalhato legyen. A hamis api SOHA nem megy eles kornyezetben: a
 * valasztas a `jatekApiKornyezetbol`-ben all, es a hamis nev szerint hangosan jelzi magat (`hamis` mezo).
 */
export const UTVONALAK = {
  aktualis: "/jatek/aktualis",
  bekuldes: "/jatek/bekuldes",
  megerosites: "/jatek/megerosites",
  nyertesek: "/jatek/nyertesek",
  kep: "/jatek/nyeremeny-kep",
  lezart: "/jatek/lezart",
} as const;

export type KerdesTipus = "TEXT" | "CHOICE";

/** A hét nyereménye: neve, rövid leírása, és hogy van-e képe (a kép a lap saját `/api/nyeremeny-kep/<kérdés>` útján jön). */
export type Nyeremeny = {
  name: string;
  description: string | null;
  hasImage: boolean;
};

/** A következő kérdés előre látva: mikor nyílik, és mi a nyereménye. A szövege nincs benne: nyitás előtt nem nyilvános. */
export type Kovetkezo = {
  id: string;
  week: string;
  opensAt: string;
  prize: Nyeremeny | null;
};

/** Egy lezárt hét helyes válasszal (a szabályzat 6. pontja: a zárás után tesszük közzé; a szerver dönti el, mikor). */
export type LezartHet = {
  week: string;
  prompt: string;
  answer: string;
  closesAt: string;
};

/** Egy korábbi sorsolás nyertese: CSAK a rövidített név (például "Kovács P."), cím soha. */
export type Nyertes = {
  kind: "WEEKLY" | "CHRISTMAS";
  week: string | null;
  name: string;
  /** a nyertes e-mail-címe részben kitakarva ("ko•••@gmail.com"): a két azonos rövid nevű játékos megkülönböztetéséhez (tájékoztató 4. pont) */
  emailMasked: string;
  prizeName: string | null;
  drawnAt: string;
};

export type Kerdes = {
  id: string;
  week: string;
  type: KerdesTipus;
  prompt: string;
  options: { id: string; label: string }[];
  opensAt: string;
  closesAt: string;
  prize: Nyeremeny | null;
};

export type Hiba = { ok: false; status: number; code: string; message: string };

export type BekuldesBemenet = {
  questionId: string;
  email: string;
  name: string;
  rulesAccepted: true;
  consentGiven: true;
  rulesVersion: string;
  privacyVersion: string;
  answer: string;
  website: string;
};

export type BekuldesEredmeny = { ok: true } | Hiba;
export type MegerositesEredmeny =
  { ok: true; status: "CONFIRMED" | "ALREADY_CONFIRMED"; week: string } | Hiba;
export type AktualisEredmeny =
  { ok: true; question: Kerdes | null; next: Kovetkezo | null } | Hiba;
export type LezartEredmeny = { ok: true; weeks: LezartHet[] } | Hiba;
export type NyertesekEredmeny = { ok: true; winners: Nyertes[] } | Hiba;
export type KepEredmeny =
  { ok: true; bytes: ArrayBuffer; contentType: string } | Hiba;

export interface JatekApi {
  /** `true`, ha ez a hamis api (az oldal kiirja, hogy proba). */
  readonly hamis: boolean;
  aktualis(latogatoIp?: string | null): Promise<AktualisEredmeny>;
  bekuldes(
    bemenet: BekuldesBemenet,
    latogatoIp: string | null,
  ): Promise<BekuldesEredmeny>;
  megerosites(
    token: string,
    latogatoIp: string | null,
  ): Promise<MegerositesEredmeny>;
  nyertesek(latogatoIp?: string | null): Promise<NyertesekEredmeny>;
  lezart(latogatoIp?: string | null): Promise<LezartEredmeny>;
  /** Egy kérdés nyereményképe (csak a nyilvános kérdésé; az api dönti el). */
  kep(kerdesId: string, latogatoIp?: string | null): Promise<KepEredmeny>;
}

const ELERHETETLEN: Hiba = {
  ok: false,
  status: 503,
  code: "UNAVAILABLE",
  message: "",
};

type Fetch = typeof fetch;

const jsonTest = async (valasz: Response): Promise<unknown> => {
  try {
    return await valasz.json();
  } catch {
    return null;
  }
};

/** Az api hibajanak alakja `{ statusCode, code, message }`; ami nem ilyen, az "elerhetetlen". */
const hibaBol = (status: number, test: unknown): Hiba => {
  const t = test as { code?: unknown; message?: unknown } | null;
  if (t && typeof t.code === "string" && /^[A-Z_]{3,40}$/.test(t.code))
    return {
      ok: false,
      status,
      code: t.code,
      message: typeof t.message === "string" ? t.message : "",
    };
  return { ...ELERHETETLEN, status };
};

const IDOKORLAT_MS = 8000;

/**
 * A latogato IP-jet az api HITELESITETT fejlecben kapja (nautilus, 2026-11-05 22:58): `X-Jatek-Client-IP` a latogato
 * cime, `X-Jatek-Proxy-Secret` a `JATEK_PROXY_SECRET` ertek. MINDKETTOT MINDEN hivas viszi, ahol van, az `aktualis` is
 * (nautilus, 23:06): az api a kulcsot csak akkor veszi a latogatonak, ha a titok ES a cim egyutt ott van; cim nelkul a
 * GET az utolso hopra esik, es a lap mogott minden latogato egy 60/perc keretben osztozik. Titok nelkul a titok-fejlec
 * elmarad, es az api az utolso proxy-hopra kulcsol (kozos keret): ez nem hiba, hanem a titok nelkuli uzem. Az
 * `X-Forwarded-For` marad, de az api mar nem erre tamaszkodik. A titok csak a szerveren el: komponensben nem
 * szerepelhet (lasd `felulet-forras.spec.ts`).
 */
export const FEJLEC_IP = "X-Jatek-Client-IP";
export const FEJLEC_TITOK = "X-Jatek-Proxy-Secret";

export function httpJatekApi(
  alap: string,
  fetchImpl: Fetch = fetch,
  proxyTitok?: string,
): JatekApi {
  const titok = proxyTitok?.trim() || undefined;
  const cim = (utvonal: string) => `${alap.replace(/\/+$/, "")}${utvonal}`;
  const hivas = async (
    utvonal: string,
    init: { method: "GET" | "POST"; body?: unknown; ip?: string | null },
  ): Promise<{ status: number; test: unknown } | null> => {
    try {
      const valasz = await fetchImpl(cim(utvonal), {
        method: init.method,
        headers: {
          Accept: "application/json",
          ...(init.body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
          ...(init.ip
            ? { "X-Forwarded-For": init.ip, [FEJLEC_IP]: init.ip }
            : {}),
          ...(titok ? { [FEJLEC_TITOK]: titok } : {}),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        cache: "no-store",
        signal: AbortSignal.timeout(IDOKORLAT_MS),
      });
      return { status: valasz.status, test: await jsonTest(valasz) };
    } catch {
      return null;
    }
  };
  return {
    hamis: false,
    async aktualis(ip) {
      const r = await hivas(UTVONALAK.aktualis, { method: "GET", ip });
      if (!r) return { ...ELERHETETLEN };
      if (r.status !== 200) return hibaBol(r.status, r.test);
      const t = r.test as { question?: unknown; next?: unknown } | null;
      // a következő kérdés nélkül is él az oldal (az api régebbi alakja, vagy nincs több kérdés)
      const next = kovetkezoEllenorzott(t?.next) ? t!.next : null;
      if (t?.question === null) return { ok: true, question: null, next };
      if (!kerdesEllenorzott(t?.question))
        return { ...ELERHETETLEN, status: 502 };
      const question = t!.question as Kerdes;
      return {
        ok: true,
        question: { ...question, prize: nyeremenyEllenorzott(question.prize) },
        next,
      };
    },
    async nyertesek(ip) {
      const r = await hivas(UTVONALAK.nyertesek, { method: "GET", ip });
      if (!r) return { ...ELERHETETLEN };
      if (r.status !== 200) return hibaBol(r.status, r.test);
      const lista = (r.test as { winners?: unknown } | null)?.winners;
      return Array.isArray(lista)
        ? { ok: true, winners: lista.filter(nyertesEllenorzott) }
        : { ...ELERHETETLEN, status: 502 };
    },
    async lezart(ip) {
      const r = await hivas(UTVONALAK.lezart, { method: "GET", ip });
      if (!r) return { ...ELERHETETLEN };
      if (r.status !== 200) return hibaBol(r.status, r.test);
      const lista = (r.test as { weeks?: unknown } | null)?.weeks;
      return Array.isArray(lista)
        ? { ok: true, weeks: lista.filter(lezartHetEllenorzott) }
        : { ...ELERHETETLEN, status: 502 };
    },
    async kep(kerdesId, ip) {
      try {
        const valasz = await fetchImpl(
          cim(`${UTVONALAK.kep}/${encodeURIComponent(kerdesId)}`),
          {
            method: "GET",
            headers: {
              Accept: "image/*",
              ...(ip ? { "X-Forwarded-For": ip, [FEJLEC_IP]: ip } : {}),
              ...(titok ? { [FEJLEC_TITOK]: titok } : {}),
            },
            cache: "no-store",
            signal: AbortSignal.timeout(IDOKORLAT_MS),
          },
        );
        const tipus = valasz.headers.get("content-type") ?? "";
        // csak kép megy tovább: egy hibaoldal vagy JSON nem lehet a kép
        if (valasz.status === 200 && /^image\/(png|jpeg|gif|webp)$/.test(tipus))
          return {
            ok: true,
            bytes: await valasz.arrayBuffer(),
            contentType: tipus,
          };
        return hibaBol(valasz.status, await jsonTest(valasz));
      } catch {
        return { ...ELERHETETLEN };
      }
    },
    async bekuldes(bemenet, ip) {
      const r = await hivas(UTVONALAK.bekuldes, {
        method: "POST",
        body: bemenet,
        ip,
      });
      if (!r) return { ...ELERHETETLEN };
      // minden elfogadott eset (uj, ismetles, botcsapda) 202 CHECK_EMAIL
      if (r.status === 202) return { ok: true };
      return hibaBol(r.status, r.test);
    },
    async megerosites(token, ip) {
      const r = await hivas(UTVONALAK.megerosites, {
        method: "POST",
        body: { token },
        ip,
      });
      if (!r) return { ...ELERHETETLEN };
      const t = r.test as { status?: unknown; week?: unknown } | null;
      if (
        r.status === 200 &&
        (t?.status === "CONFIRMED" || t?.status === "ALREADY_CONFIRMED") &&
        typeof t.week === "string"
      )
        return { ok: true, status: t.status, week: t.week };
      return hibaBol(r.status, r.test);
    },
  };
}

/** A nyeremeny alakja az api valaszabol; ami nem illik, az nincs nyeremeny. */
export function nyeremenyEllenorzott(p: unknown): Nyeremeny | null {
  const n = p as Partial<Nyeremeny> | null;
  return !!n &&
    typeof n.name === "string" &&
    n.name !== "" &&
    (n.description === null || typeof n.description === "string") &&
    typeof n.hasImage === "boolean"
    ? { name: n.name, description: n.description ?? null, hasImage: n.hasImage }
    : null;
}

function kovetkezoEllenorzott(k: unknown): k is Kovetkezo {
  const q = k as Partial<Kovetkezo> | null;
  return (
    !!q &&
    typeof q.id === "string" &&
    typeof q.week === "string" &&
    typeof q.opensAt === "string" &&
    !Number.isNaN(Date.parse(q.opensAt))
  );
}

function lezartHetEllenorzott(w: unknown): w is LezartHet {
  const n = w as Partial<LezartHet> | null;
  return (
    !!n &&
    typeof n.week === "string" &&
    typeof n.prompt === "string" &&
    typeof n.answer === "string" &&
    n.answer.trim() !== "" &&
    typeof n.closesAt === "string"
  );
}

function nyertesEllenorzott(w: unknown): w is Nyertes {
  const n = w as Partial<Nyertes> | null;
  return (
    !!n &&
    (n.kind === "WEEKLY" || n.kind === "CHRISTMAS") &&
    typeof n.name === "string" &&
    n.name !== "" &&
    typeof n.emailMasked === "string" &&
    // csak a részben kitakart alak megy a lapra: a "•••" jel nélküli cím (egy teljes cím) kiesik, mielőtt kirajzolódna
    n.emailMasked.includes("•••") &&
    typeof n.drawnAt === "string"
  );
}

/** Az api valaszabol jovo kerdes alakja; ami nem illik, azt nem rajzoljuk ki. */
export function kerdesEllenorzott(k: unknown): k is Kerdes {
  const q = k as Partial<Kerdes> | null;
  return (
    !!q &&
    typeof q.id === "string" &&
    typeof q.week === "string" &&
    (q.type === "TEXT" || q.type === "CHOICE") &&
    typeof q.prompt === "string" &&
    Array.isArray(q.options) &&
    q.options.every(
      (o) => !!o && typeof o.id === "string" && typeof o.label === "string",
    ) &&
    (q.type === "TEXT" || q.options.length >= 2) &&
    typeof q.opensAt === "string" &&
    typeof q.closesAt === "string"
  );
}

/** A szerzodes peldai szo szerint. */
export const HAMIS_KERDES: Kerdes = {
  id: "proba-kerdes",
  week: "2026-W46",
  type: "CHOICE",
  prompt:
    "Melyik korall nemzetség neve szerepel a lehetőségek között? (próba kérdés)",
  options: [
    { id: "a", label: "Acropora" },
    { id: "b", label: "Montipora" },
  ],
  opensAt: "2026-11-06T06:00:00.000Z",
  closesAt: "2026-11-13T22:59:59.000Z",
  prize: null,
};

/** A hamis api: a szerzodes hibaival, memoria nelkul. Az ervenyes proba-token: `proba-token-ervenyes`. */
export function hamisJatekApi(): JatekApi {
  return {
    hamis: true,
    async aktualis() {
      return { ok: true, question: HAMIS_KERDES, next: null };
    },
    async nyertesek() {
      return { ok: true, winners: [] };
    },
    async lezart() {
      return { ok: true, weeks: [] };
    },
    async kep() {
      return { ok: false, status: 404, code: "NO_IMAGE", message: "" };
    },
    async bekuldes(bemenet) {
      if (bemenet.questionId !== HAMIS_KERDES.id)
        return { ok: false, status: 404, code: "NO_QUESTION", message: "" };
      return { ok: true };
    },
    async megerosites(token) {
      if (token === "proba-token-ervenyes")
        return { ok: true, status: "CONFIRMED", week: HAMIS_KERDES.week };
      if (token === "proba-token-mar")
        return {
          ok: true,
          status: "ALREADY_CONFIRMED",
          week: HAMIS_KERDES.week,
        };
      if (token === "proba-token-lezart")
        return { ok: false, status: 409, code: "CLOSED", message: "" };
      return { ok: false, status: 400, code: "INVALID_TOKEN", message: "" };
    },
  };
}

/**
 * A KORNYEZET DONT: `JATEK_API_URL` (https vagy http) -> az igazi api; nincs -> a hamis, KIVEVE ELES KORNYEZETBEN
 * (`NODE_ENV=production` es nincs `JATEK_ALLOW_FAKE=true`): ott az api cim nelkuli indulas hiba, nem hamis jatek.
 * Igy egy elrontott telepites nem indit "proba" jatekot a valodi cimen.
 */
export function jatekApiKornyezetbol(
  env: Record<string, string | undefined>,
  fetchImpl: Fetch = fetch,
): JatekApi {
  const alap = env.JATEK_API_URL?.trim();
  if (alap) {
    try {
      const url = new URL(alap);
      if (url.protocol === "https:" || url.protocol === "http:")
        return httpJatekApi(
          url.origin + url.pathname,
          fetchImpl,
          env.JATEK_PROXY_SECRET,
        );
    } catch {
      // a hibas cim nem esik vissza hamisra: lent dobunk
    }
    throw new Error("JATEK_API_URL nem ervenyes cim.");
  }
  if (env.NODE_ENV === "production" && env.JATEK_ALLOW_FAKE !== "true")
    throw new Error(
      "JATEK_API_URL nincs beallitva (a hamis api elesben nem indul).",
    );
  return hamisJatekApi();
}
