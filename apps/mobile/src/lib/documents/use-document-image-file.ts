import { useQuery } from "@tanstack/react-query";
import { Directory, File, Paths } from "expo-file-system";

import { environment } from "@/config/env";
import { authSessionStore } from "@/lib/auth/token-store";

import { kepLetoltese, type KepLetoltesEredmeny } from "./document-image-file";
import type { DocumentImageVariant } from "./document-view";

/**
 * A HITELESÍTETT KÉP LEHÍVÁSA -- a futásidőhöz kötött fele.
 *
 * A DÖNTÉS NEM ITT VAN, hanem a `document-image-file.ts`-ben, ahol egy teszt
 * eléri. Ez a horog csak a két varratot köti be: a tokent és a letöltést.
 *
 * === MIÉRT LEMEZRE, ÉS MIÉRT NEM A MEMÓRIÁBA ===
 *
 * A bájtok a gyorsítótár-könyvtárba kerülnek, és a kép a helyi fájlt tölti be.
 * Egy `fetch` + base64 alak ugyanezt a fejléc-gondot megoldaná, de a képet a JS
 * memóriájába emelné: egy soktételű galériánál (csempe ÉS nagy kép) az a telefon
 * memóriáját viszi el. Így viszont a csempe és a nagy kép UGYANAZON az úton jár,
 * tehát nem kell két külön mechanizmus, és egyik sem tart bájtokat a memóriában.
 *
 * A LETÖLTÉS IDEMPOTENS: ugyanarra a dokumentumra ugyanaz a fájl, felülírva. Egy
 * növekvő gyorsítótár a készülék helyét vinné el, és a szerviz-telefonokon az a
 * hely már ma is szűk.
 */
export function useDocumentImageFile(input: {
  ownerPath: string | null;
  documentId: string;
  variant: DocumentImageVariant;
  /** `false`, amíg a képre nincs szükség (be nem nyitott nagy nézet). */
  enabled?: boolean;
}) {
  const apiUrl = environment.ok ? environment.config.apiUrl : null;

  return useQuery<KepLetoltesEredmeny>({
    queryKey: [
      "document-image-file",
      input.ownerPath,
      input.documentId,
      input.variant,
    ],
    enabled: input.enabled !== false && Boolean(input.ownerPath),
    /*
      A GYORSITOTAR HOSSZU, mert a FAJL a lemezen all: a lekerdezes csak az
      UTVONALAT tartja. Egy rovid ido ujra letoltene ugyanazt a kepet.
    */
    staleTime: 10 * 60_000,
    queryFn: () =>
      kepLetoltese(
        {
          apiUrl,
          ownerPath: input.ownerPath,
          documentId: input.documentId,
          variant: input.variant,
        },
        {
          /* A TOKEN A KERES PILLANATABAN, nem egy gyorsitotarazott ertekbol. */
          token: () => authSessionStore.getToken(),
          letolt: async ({ uri, headers, fileName }) => {
            const konyvtar = new Directory(Paths.cache, "dokumentum-kepek");
            if (!konyvtar.exists) konyvtar.create({ intermediates: true });
            const cel = new File(konyvtar, fileName);
            const fajl = await File.downloadFileAsync(uri, cel, {
              headers,
              idempotent: true,
            });
            return fajl.uri;
          },
        },
      ),
  });
}
