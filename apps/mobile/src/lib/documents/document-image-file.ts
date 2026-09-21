/**
 * RELATIV UT, NEM `@/` ALIAS -- a `tsconfig.test.json` nem hordoz `paths`
 * bejegyzest (lasd a `list-scope.ts` fejlecet).
 */
import {
  documentImageSource,
  type DocumentImageVariant,
} from "./document-view";

/**
 * A KEP LEHIVASA A MI KERESUNKKEL, NEM A NATIV BETOLTOEVEL.
 *
 * === A MERT HIBA, ES AMIT A KESZULEK MONDOTT (2026-09-21) ===
 *
 * Balazs androidos keszuleke a sajat mero-mondatunkat mutatta:
 *
 *   Unexpected HTTP code Response{protocol=h2, code=401, ...}
 *
 * Vagyis a keres ELMENT a szerverig, es a szerver ELUTASITOTTA. Ezzel az ot
 * gyanubol negy kiesett: nem dekodolasi hiba, nem idotulles, nem a
 * diszpozicio, es nem a hianyzo forras.
 *
 * === MIERT NEM A TOKEN ELAVULASA VOLT, ES EZT MEGMERTEM ===
 *
 * A masodik lehetseges ok egy ELAVULT token lett volna (a korabbi horog 60
 * masodpercig gyorsitotarazta). Ez a repobol CAFOLHATO: a munkamenet tokenjet
 * kizarolag a bejelentkezes irja (`sign-in.ts` az EGYETLEN `saveSession` hivo),
 * es semmi nem forgatja kozben. Amit a gyorsitotar tartott, az betu szerint
 * ugyanaz volt, amit egy friss olvasas adott volna.
 *
 * Marad tehat az elso ok: az `Authorization` fejlec NEM jut el a natív
 * kepbetoltovel. Ezert a keres atkerul HOZZANK.
 *
 * === MIERT FAJLBA, ES NEM MEMORIABA ===
 *
 * A bajtokat lemezre irjuk, es a kep a helyi fajlt tolti be. Egy `fetch` +
 * base64 alak ugyanezt a fejlec-gondot megoldana, de a kepet a JS memoriajaba
 * emelne -- egy soktetelu galerianal (csempe + nagy kep) az a telefon
 * memoriajat viszi el. A letoltes viszont MIND A KET uton ugyanaz marad,
 * tehat nem kell ket kulon mechanizmus.
 *
 * ES A TOKEN A KERES PILLANATABAN kell. Nem azert, mert ma elavulhat (nem tud),
 * hanem mert egy kesobbi token-forgatas ezt a hibat CSENDBEN visszahozna.
 */

/** A helyi masolat neve. Valtozatonkent kulon, mert a ketto MAS kep. */
export function documentCacheFileName(input: {
  documentId: string;
  variant: DocumentImageVariant;
}): string {
  /*
    A DOKUMENTUM AZONOSITOJA UUID vagy cuid, tehat fajlnevben biztonsagos --
    de nem bizunk benne: ami nem betu, szam, kotojel vagy alahuzas, az
    kiesik. Egy `../` alaku azonosito kulonben a gyorsitotaron KIVULRE irna.
  */
  const tiszta = input.documentId.replace(/[^A-Za-z0-9_-]/g, "");
  return `dokumentum-${tiszta}-${input.variant}.img`;
}

export interface KepLetoltesFuggosegek {
  /** A token, a keres pillanataban olvasva. */
  token(): Promise<string | null>;
  /** A letoltes, fejlecekkel. A cel-fajl utjat adja vissza. */
  letolt(input: {
    uri: string;
    headers: Record<string, string>;
    fileName: string;
  }): Promise<string>;
}

export type KepLetoltesEredmeny =
  { allapot: "kesz"; uri: string } | { allapot: "hiba"; uzenet: string };

/**
 * A LEHIVAS, TISZTA VARRATTAL -- hogy merheto legyen keszulek nelkul.
 *
 * A HIBA SZOVEGE UGYANAZT A `MÉRÉS:` alakot hasznalja, mint a natív betolto
 * hibaja. Ez NEM stilus: ha a javitas utan megint elakad valami, a kepernyon
 * ugyanolyan alaku mondat all, es fel lehet olvasni. Egy javitas, ami a
 * hibauzenetet is elviszi, vakka tesz a kovetkezo alkalomra.
 */
export async function kepLetoltese(
  input: {
    apiUrl: string | null;
    ownerPath: string | null;
    documentId: string;
    variant: DocumentImageVariant;
  },
  deps: KepLetoltesFuggosegek,
): Promise<KepLetoltesEredmeny> {
  if (!input.apiUrl || !input.ownerPath)
    return {
      allapot: "hiba",
      uzenet:
        "MÉRÉS: nincs cím a letöltéshez (hiányzó API-cím vagy gazda-útvonal).",
    };

  const token = await deps.token();
  if (!token)
    return {
      allapot: "hiba",
      uzenet:
        "MÉRÉS: nincs forrás (a bejelentkezési token nem olvasható). Ez NEM hálózati hiba.",
    };

  const forras = documentImageSource({
    apiUrl: input.apiUrl,
    token,
    ownerPath: input.ownerPath,
    documentId: input.documentId,
    variant: input.variant,
  });

  try {
    const uri = await deps.letolt({
      uri: forras.uri,
      headers: forras.headers,
      fileName: documentCacheFileName({
        documentId: input.documentId,
        variant: input.variant,
      }),
    });
    return { allapot: "kesz", uri };
  } catch (cause) {
    /*
      A NYERS UZENET MEGY KI, SAJAT ATIRAT NELKUL -- ugyanaz a szabaly, mint a
      natív betoltonel: egy 401, egy idotulles es egy lemez-hiba harom
      kulonbozo szoveg, es mind a harom mas kovetkezo lepest ad.
    */
    const nyers = cause instanceof Error ? cause.message : String(cause ?? "");
    return {
      allapot: "hiba",
      uzenet: nyers.trim()
        ? `MÉRÉS: a kép letöltése elhasalt. A készülék üzenete: ${nyers}`
        : "MÉRÉS: a kép letöltése elhasalt, és a készülék NEM adott üzenetet.",
    };
  }
}
