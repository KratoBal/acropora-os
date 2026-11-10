/**
 * THE FILE TYPES AN UPLOAD MAY CARRY, IN ONE PLACE (card b68357b7). The API's check (`detectUploadedFileKind`, which also reads
 * the first bytes) and the pickers' `accept` lists on the web and the partner portal read this table, so a picker can no
 * longer offer a type the server refuses, or hide one it takes, without a test turning red.
 *
 * Why the list is short, and what is left out on purpose (HEIC, WebP, AVIF, SVG), is written at the API's signature table
 * (`apps/api/src/service-assets/uploaded-file-type.ts`).
 */
export const UPLOADED_FILE_TYPES = {
  pdf: { mimetypes: ["application/pdf"], canonicalMimetype: "application/pdf" },
  jpeg: {
    // `image/jpg` is not standard, but older clients send it; the byte check guards it separately
    mimetypes: ["image/jpeg", "image/jpg"],
    canonicalMimetype: "image/jpeg",
  },
  png: { mimetypes: ["image/png"], canonicalMimetype: "image/png" },
} as const satisfies Record<
  string,
  { mimetypes: readonly string[]; canonicalMimetype: string }
>;

export type UploadedFileKind = keyof typeof UPLOADED_FILE_TYPES;

/** Every declared type the server takes, the non-standard spellings included. */
export const ACCEPTED_UPLOAD_MIMETYPES: readonly string[] = Object.values(
  UPLOADED_FILE_TYPES,
).flatMap((type) => type.mimetypes);

/**
 * A picker's `accept` value for the given kinds, in the order given: the standard type of each, so the browser's file dialog
 * shows what it knows (the non-standard `image/jpg` is only for what clients send, not for the dialog).
 */
export function uploadAccept(kinds: readonly UploadedFileKind[]): string {
  return kinds
    .map((kind) => UPLOADED_FILE_TYPES[kind].canonicalMimetype)
    .join(",");
}
