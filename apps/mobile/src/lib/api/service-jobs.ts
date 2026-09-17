import { apiRequest } from "./client";
import { buildDocumentUpload, type PickedFile } from "./document-upload";
import type {
  CreateServiceJobInput,
  ServiceJobDetail,
  ServiceJobDocumentSummary,
  ServiceJobListResponse,
  ServiceJobStatusValue,
} from "../service-jobs/types";

export type {
  CreateServiceJobInput,
  ServiceJobAssetLink,
  ServiceJobDetail,
  ServiceJobDocumentSummary,
  ServiceJobListItem,
  ServiceJobListResponse,
  ServiceJobStatusValue,
  ServiceJobTimelineEntry,
  ServiceJobWorksheetLink,
} from "../service-jobs/types";

/**
 * A HIBAJEGYEK KLIENSE -- ÉS SZŰKEBB, MINT A WEBÉ, SZÁNDÉKOSAN.
 *
 * A telefon a HELYSZÍNEN van. Ami itt számít: megtalálni a jegyet, elolvasni,
 * léptetni az állapotát, fényképet tenni rá, és megnyitni alóla a munkalapot.
 *
 * AMI A WEBEN VAN, ÉS ITT SZÁNDÉKOSAN NINCS: a partner átállítása, a delegálás,
 * a csatolmány törlése és a munkalap leválasztása -- mind iroda-művelet vagy
 * visszafordíthatatlan. A jegy LÉTREHOZÁSA külön kérdés, Balázs dönti el.
 *
 * A KIHAGYÁSOKAT A KÉPERNYŐ KIMONDJA, nem csak ez a megjegyzés: egy hiányzó
 * gomb ugyanúgy néz ki, mint egy elromlott.
 */
/**
 * AZ UTVONALAK HELYBEN ALLNAK, NEM EGY SEGEDFUGGVENYBEN -- ES EZT KET DOLOG
 * DONTOTTE EL, NEM AZ IZLES.
 *
 * Eloszor a WEBES kliens alakjat masoltam ide (`jobPath(id, suffix)`). Ket
 * orzo utasitotta el, egymastol fuggetlenul:
 *
 *   - a `apiRequest` a `/${string}` tipust koveteli meg, es egy segedfuggveny
 *     visszatereset ANNOTALNI kell hozza (a template literalt a fordito
 *     kulonben `string`-re szelesiti);
 *   - a `mobile-api-routes.spec.ts` viszont EGY-`return`-os, ANNOTACIO NELKULI
 *     `function` deklaraciobol olvassa ki az utvonalakat. Az annotalt alakot
 *     nem tudja megfejteni, es NEM hagyja ki nemán: kimondja, hogy "egy
 *     hivasbol nem olvashato ki az utvonal".
 *
 * A ketto egyszerre nem teljesitheto ebben az alakban. A mobil sajat klienseinek
 * (`assets.ts`, `worksheets.ts`) MINTAJA amugy is a helyben kiirt template
 * literal -- ott az argumentum-pozicio adja a tipust, es az orzo is latja.
 * A segedfuggveny az en rovidítésem volt egy kitaposott ut mellett.
 *
 * ES UGYANEZ AZ ORZO FOGTA MEG A MASODIK HIBAMAT IS: az utvonalat
 * `/service-jobs`-nak irtam, a szerveren viszont `service/jobs` all
 * (`@Controller("service/jobs")`). Ot hivas ment volna olyan cimre, ami nem
 * letezik -- es a telefonon ez CSAK futasidoben latszott volna, egy ures
 * listakent vagy egy meg nem nevezett hibakent a helyszinen.
 */
const BASE = "/service/jobs";

/**
 * A NYITOTT JEGYEK, VAGY MIND.
 *
 * A LÁTHATÓSÁGOT A SZERVER SZŰKÍTI, nem ez a hívás: a szervizes a saját
 * helyszíneit látja. Egy kliens-oldali szűrő itt azt ÍGÉRNÉ, hogy tudja, ki mit
 * láthat -- és a következő szabály-változásnál csendben hazudna.
 */
export function listServiceJobs(scope: "open" | "all" = "open") {
  return apiRequest<ServiceJobListResponse>(
    `${BASE}?${new URLSearchParams({ scope })}`,
  );
}

/**
 * UJ HIBAJEGY A HELYSZINROL.
 *
 * A torzs harom mezot visz: cim, leiras, es az ESZKOZ, aminel nyitottak. A
 * partnert es a helyszint a szerver vezeti le -- lasd a `CreateServiceJobInput`
 * fejlecet.
 */
export function createServiceJob(input: CreateServiceJobInput) {
  return apiRequest<ServiceJobDetail>(BASE, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getServiceJob(id: string) {
  return apiRequest<ServiceJobDetail>(`${BASE}/${encodeURIComponent(id)}`);
}

/**
 * ÁLLAPOT-LÉPTETÉS.
 *
 * A `note` ELHAGYHATÓ (a szerver döntése), és üresen EL SEM MEGY: a szerver a
 * csupa szóközt is semminek veszi, de két alak egy jelentésre már itt sem kell.
 *
 * A SZERVER A LÁTOTT ÁLLAPOTRA ÍR: ha közben más lépett, 409-et ad, nem írja
 * felül csendben. Ezért nem is tesszük sorba offline: egy sorba tett lépés a
 * kiürítéskor bukna el, órákkal később, amikor a szerelő már nincs a gépnél.
 *
 * A VÁLASZ A TELJES RÉSZLETLAP, ÉS EZ A SOR ÉLES HIBÁBÓL ÁLL ITT.
 *
 * 2026-09-17-ig itt is `ServiceJobDetail` állt, a szerver viszont `{ ok: true }`
 * nyugtát küldött. A fordító ezt nem láthatta: ez a csomag MÁSOLJA a válasz
 * típusait (az Expo app nem húzhatja be a munkatér csomagjait), és a másolat
 * önmagával konzisztens. A képernyő a nyugtát tette a gyorsítótárba, és a
 * következő kirajzolás `detail.assets.length` értéken állt meg -- ami itt nem
 * hibaüzenet, hanem KILÉPÉS. A szerver azóta a friss lapot adja, tehát ez a
 * deklaráció mostantól IGAZ. Ha valaki a szervert nyugtára állítaná vissza, az
 * `apps/api/src/service-jobs/service-jobs.move.spec.ts` pirosodik ki -- a
 * TELEFON oldalán ma nincs képernyő-renderelő, ami elkapná.
 */
export function moveServiceJob(
  id: string,
  to: ServiceJobStatusValue,
  note?: string,
) {
  const trimmed = note?.trim();
  return apiRequest<ServiceJobDetail>(
    `${BASE}/${encodeURIComponent(id)}/move`,
    {
      method: "POST",
      body: JSON.stringify(trimmed ? { to, note: trimmed } : { to }),
    },
  );
}

export function listServiceJobDocuments(id: string) {
  return apiRequest<{ items: ServiceJobDocumentSummary[] }>(
    `${BASE}/${encodeURIComponent(id)}/documents`,
  );
}

/**
 * FÉNYKÉP A JEGYRE. LISTÁT AD VISSZA, EGY FÁJLNÁL IS.
 *
 * A `type` itt mindig `PHOTO`: a telefonról az megy fel, amit a szerelő a
 * gépnél lát. Az `OTHER` az irodából érkező csatolmányoké, és ezen az úton nem
 * keletkezik -- ha valaha kell, a hívó adja meg, nem ez a függvény tippeli.
 */
export async function uploadServiceJobPhotos(
  id: string,
  files: readonly PickedFile[],
): Promise<ServiceJobDocumentSummary[]> {
  const built = buildDocumentUpload({ type: "PHOTO", files });
  if (!built.ok) throw new Error(built.reason);

  return apiRequest<ServiceJobDocumentSummary[]>(
    `${BASE}/${encodeURIComponent(id)}/documents`,
    { method: "POST", body: built.body },
  );
}
