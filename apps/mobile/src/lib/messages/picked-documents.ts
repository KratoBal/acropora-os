import type { PickedFile } from "../api/picked-image";

/**
 * A FÁJLVÁLASZTÓ EREDMÉNYE FELTÖLTHETŐ ALAKBAN (Üzenetek 2d, kártya 34753075).
 *
 * A szerver ma PDF-et, JPEG-et és PNG-t fogad el, tartalom-ellenőrzéssel
 * (`detectUploadedFileKind`). Amit itt sem ismerünk fel, azt nem küldjük el
 * vakon: egy biztos elutasítás egy hálózati kör után a szerelőnél jelenne meg,
 * itt pedig a nevével megmondjuk, mi maradt ki.
 */
export interface DocumentPickerAsset {
  uri: string;
  name?: string | null;
  mimeType?: string | null;
  size?: number | null;
}

export interface PickedDocument extends PickedFile {
  sizeBytes: number;
}

const EXTENSION_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};
const ACCEPTED = new Set(Object.values(EXTENSION_TYPES));

/** A választónak átadott típusok: amit a szerver elfogad. */
export const PICKABLE_DOCUMENT_TYPES = [...ACCEPTED];

function extensionOf(value: string): string {
  const withoutQuery = value.split("?")[0] ?? value;
  const lastDot = withoutQuery.lastIndexOf(".");
  return lastDot < 0 ? "" : withoutQuery.slice(lastDot + 1).toLowerCase();
}

export function toPickedDocuments(assets: readonly DocumentPickerAsset[]): {
  files: PickedDocument[];
  skipped: string[];
} {
  const files: PickedDocument[] = [];
  const skipped: string[] = [];
  assets.forEach((asset, index) => {
    const declared = asset.mimeType?.trim().toLowerCase();
    const type =
      declared && ACCEPTED.has(declared)
        ? declared
        : EXTENSION_TYPES[extensionOf(asset.name ?? asset.uri)];
    if (!type) {
      skipped.push(asset.name?.trim() || asset.uri);
      return;
    }
    const extension =
      type === "application/pdf" ? "pdf" : type === "image/png" ? "png" : "jpg";
    files.push({
      uri: asset.uri,
      name: asset.name?.trim() || `fajl-${index + 1}.${extension}`,
      type,
      sizeBytes: asset.size ?? 0,
    });
  });
  return { files, skipped };
}
