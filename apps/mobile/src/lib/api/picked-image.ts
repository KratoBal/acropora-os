/**
 * A KÉPVÁLASZTÓ EREDMÉNYÉBŐL FELTÖLTHETŐ FÁJL.
 *
 * Külön áll, `expo-image-picker` nélkül, hogy `tsc` + `node --test` alatt
 * forduljon és mérhető legyen - ugyanaz a megfontolás, mint a
 * `request-auth.ts` és a `json-content-type.ts` esetében. A választó
 * eredményének CSAK azt a három mezőjét ismeri, amire szükség van.
 *
 * MIÉRT NEM TALÁLGATUNK TÍPUST. A szerver a bejelentett típust ÉS a fájl első
 * bájtjait EGYÜTT nézi, és ha a kettő nem egyezik, elutasít. Egy „hát legyen
 * image/jpeg" alapértelmezés tehát nem engedékenység, hanem BIZTOS elutasítás
 * minden PNG-re - és a szerelő azt látná, hogy a telefon nem tudja feltölteni
 * a saját fényképét.
 *
 * Amit a választó nem mond meg, azt a KITERJESZTÉSBŐL vezetjük le, és csak
 * abból a kettőből, amit a szerver elfogad. Ha az sem dönt, a kép kimarad, és
 * megnevezzük - egy kihagyott fájl, amiről szólunk, jobb, mint egy elutasítás,
 * aminek az oka a szerveren dől el.
 */

export interface PickerAsset {
  uri: string;
  /** A választó által adott név; iOS-en gyakran hiányzik. */
  fileName?: string | null;
  /** A választó által felismert típus; nem minden forrásnál áll rendelkezésre. */
  mimeType?: string | null;
}

export interface PickedFile {
  uri: string;
  name: string;
  type: string;
}

export interface PickedImages {
  files: PickedFile[];
  /** Amit nem tudtunk feltölthető alakra hozni, névvel vagy URI-val. */
  skipped: string[];
}

/** Amit a szerver elfogad, kiterjesztésről a bejelentendő típusra. */
const EXTENSION_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

function extensionOf(value: string): string {
  const withoutQuery = value.split("?")[0] ?? value;
  const lastDot = withoutQuery.lastIndexOf(".");
  if (lastDot < 0) return "";
  return withoutQuery.slice(lastDot + 1).toLowerCase();
}

function nameFrom(asset: PickerAsset, index: number, type: string): string {
  const given = asset.fileName?.trim();
  if (given) return given;
  // A NÉV A LETÖLTÉSNÉL LÁTSZIK, tehát nem mindegy. Ha a választó nem ad
  // nevet, a sorszám legalább megkülönbözteti egymástól a képeket.
  const extension = type === "image/png" ? "png" : "jpg";
  return `fenykep-${index + 1}.${extension}`;
}

export function toPickedImages(assets: readonly PickerAsset[]): PickedImages {
  const files: PickedFile[] = [];
  const skipped: string[] = [];

  assets.forEach((asset, index) => {
    const declared = asset.mimeType?.trim().toLowerCase();
    const type =
      declared && Object.values(EXTENSION_TYPES).includes(declared)
        ? declared
        : EXTENSION_TYPES[extensionOf(asset.fileName ?? asset.uri)];

    if (!type) {
      skipped.push(asset.fileName?.trim() || asset.uri);
      return;
    }
    files.push({ uri: asset.uri, name: nameFrom(asset, index, type), type });
  });

  return { files, skipped };
}
