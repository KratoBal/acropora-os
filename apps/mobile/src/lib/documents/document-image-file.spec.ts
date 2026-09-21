import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  documentCacheFileName,
  kepLetoltese,
  type KepLetoltesFuggosegek,
} from "./document-image-file";

const ALAP = {
  apiUrl: "https://api.acropora.hu",
  ownerPath: "/service/jobs/job-1",
  documentId: "doc-1",
  variant: "thumbnail" as const,
};

function fuggosegek(
  reszlet: Partial<KepLetoltesFuggosegek> & { hivasok?: unknown[] } = {},
): KepLetoltesFuggosegek & { hivasok: unknown[] } {
  const hivasok: unknown[] = reszlet.hivasok ?? [];
  return {
    hivasok,
    token: reszlet.token ?? (async () => "token-123"),
    letolt:
      reszlet.letolt ??
      (async (input) => {
        hivasok.push(input);
        return `file:///cache/${input.fileName}`;
      }),
  };
}

describe("a kép lehívása a mi kérésünkkel", () => {
  /**
   * A FEJLÉC A MI KEZÜNKBEN VAN. A mért 401 azt mondta, hogy a natív betöltő
   * kérése elment a szerverig ÉS elutasították -- a fejléc tehát nem jutott
   * el. Ez az állítás azt méri, hogy a mi kérésünk viszi.
   */
  it("a letöltés viszi az Authorization fejlécet", async () => {
    const deps = fuggosegek();

    const eredmeny = await kepLetoltese(ALAP, deps);

    assert.equal(eredmeny.allapot, "kesz");
    assert.deepEqual((deps.hivasok[0] as { headers: unknown }).headers, {
      Authorization: "Bearer token-123",
    });
  });

  /**
   * A TOKEN A KÉRÉS PILLANATÁBAN OLVASÓDIK. A korábbi horog 60 másodpercig
   * gyorsítótárazta. Ma ez nem okoz hibát (a munkamenet tokenjét kizárólag a
   * bejelentkezés írja), de egy későbbi token-forgatás CSENDBEN hozná vissza
   * ugyanezt a 401-et.
   */
  it("minden hívás ÚJRA olvassa a tokent", async () => {
    let olvasasok = 0;
    const deps = fuggosegek({
      token: async () => {
        olvasasok += 1;
        return `token-${olvasasok}`;
      },
    });

    await kepLetoltese(ALAP, deps);
    await kepLetoltese(ALAP, deps);

    assert.equal(olvasasok, 2);
    assert.deepEqual((deps.hivasok[1] as { headers: unknown }).headers, {
      Authorization: "Bearer token-2",
    });
  });

  it("a csempe és a nagy kép KÜLÖN fájlba kerül", () => {
    const csempe = documentCacheFileName({
      documentId: "doc-1",
      variant: "thumbnail",
    });
    const nagy = documentCacheFileName({
      documentId: "doc-1",
      variant: "original",
    });

    assert.notEqual(csempe, nagy);
    assert.ok(csempe.includes("doc-1"));
  });

  /**
   * A FÁJLNÉV NEM VIHET ÚTVONALAT. Egy `../` alakú azonosító különben a
   * gyorsítótáron KÍVÜLRE írna -- és az a fajta hiba, ami sosem a saját
   * képernyőjén jelentkezik.
   */
  it("az azonosítóból kiesik minden, ami útvonal lehetne", () => {
    const nev = documentCacheFileName({
      documentId: "../../etc/passwd",
      variant: "original",
    });

    assert.ok(!nev.includes("/"));
    assert.ok(!nev.includes(".."));
  });

  /**
   * A HIBA TOVÁBBRA IS LÁTSZIK, ÉS SZÓ SZERINT. Egy javítás, ami a
   * hibaüzenetet is elviszi, vakká tesz a következő alkalomra.
   */
  it("a letöltés hibáját szó szerint viszi tovább", async () => {
    const eredmeny = await kepLetoltese(
      ALAP,
      fuggosegek({
        letolt: async () => {
          throw new Error("Unexpected HTTP code Response{code=401}");
        },
      }),
    );

    assert.equal(eredmeny.allapot, "hiba");
    if (eredmeny.allapot !== "hiba") return;
    assert.ok(eredmeny.uzenet.includes("code=401"));
    assert.ok(eredmeny.uzenet.startsWith("MÉRÉS:"));
  });

  it("üres hibánál KIMONDJA, hogy nem jött üzenet", async () => {
    const eredmeny = await kepLetoltese(
      ALAP,
      fuggosegek({
        letolt: async () => {
          throw new Error("   ");
        },
      }),
    );

    assert.equal(
      eredmeny.allapot === "hiba" &&
        eredmeny.uzenet.includes("NEM adott üzenetet"),
      true,
    );
  });

  /**
   * A HIÁNYZÓ TOKEN KÜLÖN MONDAT, és kimondja, hogy nem hálózati hiba: ott
   * kérés EL SEM INDUL. A letöltő varratot ilyenkor MEG SEM hívjuk.
   */
  it("token nélkül el sem indul a letöltés", async () => {
    const deps = fuggosegek({ token: async () => null });

    const eredmeny = await kepLetoltese(ALAP, deps);

    assert.equal(eredmeny.allapot, "hiba");
    if (eredmeny.allapot !== "hiba") return;
    assert.ok(eredmeny.uzenet.includes("NEM hálózati hiba"));
    assert.equal(deps.hivasok.length, 0);
  });

  it("cím nélkül sem indul el, és ezt MÁS mondat mondja", async () => {
    const deps = fuggosegek();

    const eredmeny = await kepLetoltese({ ...ALAP, apiUrl: null }, deps);

    assert.equal(eredmeny.allapot, "hiba");
    if (eredmeny.allapot !== "hiba") return;
    assert.ok(eredmeny.uzenet.includes("nincs cím"));
    assert.equal(deps.hivasok.length, 0);
  });
});
