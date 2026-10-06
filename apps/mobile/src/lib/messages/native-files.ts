import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import { authSessionStore } from "@/lib/auth/token-store";

import type { OpenAttachmentDeps } from "./open-attachment";
import {
  PICKABLE_DOCUMENT_TYPES,
  type DocumentPickerAsset,
} from "./picked-documents";

/**
 * AZ ÜZENETEK 2d NATÍV VARRATAI, EGY HELYEN (kártya 34753075): fájlválasztó,
 * vágólap, és a csatolmány átadása a rendszer nézőjének. Mind a három natív
 * modul, tehát csak az új buildben él; a logika a tiszta függvényekben áll
 * (`picked-documents.ts`, `open-attachment.ts`), itt csak a hívások.
 */
export async function pickDocuments(): Promise<
  { kind: "cancelled" } | { kind: "picked"; assets: DocumentPickerAsset[] }
> {
  const result = await DocumentPicker.getDocumentAsync({
    type: PICKABLE_DOCUMENT_TYPES,
    multiple: true,
    copyToCacheDirectory: true,
  });
  if (result.canceled) return { kind: "cancelled" };
  return {
    kind: "picked",
    assets: result.assets.map((asset) => ({
      uri: asset.uri,
      name: asset.name,
      mimeType: asset.mimeType ?? null,
      size: asset.size ?? null,
    })),
  };
}

export function copyText(text: string): Promise<boolean> {
  return Clipboard.setStringAsync(text);
}

const DIRECTORY = "uzenet-csatolmanyok";

export const openAttachmentDeps: OpenAttachmentDeps = {
  token: () => authSessionStore.getToken(),
  download: async ({ uri, headers, fileName }) => {
    const directory = new Directory(Paths.cache, DIRECTORY);
    if (!directory.exists) directory.create({ intermediates: true });
    const file = await File.downloadFileAsync(
      uri,
      new File(directory, fileName),
      { headers, idempotent: true },
    );
    return file.uri;
  },
  open: async (uri, mimeType) => {
    if (!(await Sharing.isAvailableAsync()))
      throw new Error("A megosztás ezen a készüléken nem érhető el.");
    await Sharing.shareAsync(uri, {
      mimeType,
      ...(mimeType === "application/pdf" ? { UTI: "com.adobe.pdf" } : {}),
    });
  },
};
