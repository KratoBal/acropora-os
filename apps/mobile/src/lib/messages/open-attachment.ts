import { documentImageSource } from "../documents/document-view";

/**
 * EGY CSATOLMÁNY MEGNYITÁSA A RENDSZER NÉZŐJÉBEN (Üzenetek 2d, kártya
 * 34753075): eddig a fájl-csatolmány alatt az állt, hogy „a webes felületen
 * nyitható meg”.
 *
 * A letöltés a bejelentkezési tokennel megy (a natív néző Authorization
 * fejlécet nem küld), egy helyi fájlba, és a megnyitás azt a fájlt adja át.
 * A fájl KITERJESZTÉSE számít: a rendszer néző abból (és a típusból) dönti el,
 * mivel nyitja meg, ezért nem a képek `.img` gyorsítótár-neve.
 */
export interface OpenAttachmentDeps {
  /** A token, a kérés pillanatában olvasva. */
  token(): Promise<string | null>;
  /** A letöltés fejlécekkel; a helyi fájl útját adja. */
  download(input: {
    uri: string;
    headers: Record<string, string>;
    fileName: string;
  }): Promise<string>;
  /** A helyi fájl átadása a rendszernek (iOS: Gyorsnézet, Android: alkalmazás-választó). */
  open(uri: string, mimeType: string): Promise<void>;
}

export interface OpenableAttachment {
  id: string;
  fileName: string;
  contentType: string;
}

const EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};

/** A helyi fájl neve: a csatolmány azonosítója, csak biztonságos jelekkel, és a valódi kiterjesztés. */
export function attachmentFileName(attachment: OpenableAttachment): string {
  const id = attachment.id.replace(/[^A-Za-z0-9_-]/g, "");
  const fromName = /\.([A-Za-z0-9]{1,5})$/.exec(attachment.fileName)?.[1];
  const extension =
    EXTENSIONS[attachment.contentType.toLowerCase()] ??
    fromName?.toLowerCase() ??
    "bin";
  return `uzenet-csatolmany-${id}.${extension}`;
}

export type OpenAttachmentResult =
  { ok: true } | { ok: false; message: string };

export async function openAttachment(
  input: { apiUrl: string | null; attachment: OpenableAttachment },
  deps: OpenAttachmentDeps,
): Promise<OpenAttachmentResult> {
  if (!input.apiUrl)
    return { ok: false, message: "A csatolmány címe nem állítható elő." };
  const token = await deps.token();
  if (!token)
    return {
      ok: false,
      message: "A csatolmány nem nyitható meg: lépj be újra.",
    };
  const source = documentImageSource({
    apiUrl: input.apiUrl,
    token,
    ownerPath: "/messages",
    collection: "attachments",
    documentId: input.attachment.id,
    variant: "original",
  });
  let local: string;
  try {
    local = await deps.download({
      uri: source.uri,
      headers: source.headers,
      fileName: attachmentFileName(input.attachment),
    });
  } catch {
    return {
      ok: false,
      message: "A csatolmány nem töltődött le. Próbáld újra térerővel.",
    };
  }
  try {
    await deps.open(local, input.attachment.contentType);
    return { ok: true };
  } catch {
    return {
      ok: false,
      message: "A telefon nem tudta megnyitni a csatolmányt.",
    };
  }
}
