import { billingPdfPath, type BillingDocumentKind } from "./paths";
import type {
  OpenAttachmentDeps,
  OpenAttachmentResult,
} from "../messages/open-attachment";

/**
 * A SZÁMLA PDF-JE A RENDSZER NÉZŐJÉBEN (iOS: Gyorsnézet, Android: alkalmazás-választó). Ugyanaz a varrat, mint az
 * Üzenetek csatolmányánál (`open-attachment.ts`, a natív oldal `native-files.ts`): a letöltés a bejelentkezési tokennel
 * megy, mert a PDF-végpont is `billing.view` jogot kér. A logika itt, natív modul nélkül, tehát tesztelhető.
 */
export function billingPdfFileName(kind: BillingDocumentKind, id: string) {
  return `szamla-${kind}-${id.replace(/[^A-Za-z0-9_-]/g, "")}.pdf`;
}

export async function openBillingPdf(
  input: { apiUrl: string | null; kind: BillingDocumentKind; id: string },
  deps: OpenAttachmentDeps,
): Promise<OpenAttachmentResult> {
  if (!input.apiUrl)
    return { ok: false, message: "A PDF címe nem állítható elő." };
  const token = await deps.token();
  if (!token)
    return { ok: false, message: "A PDF nem nyitható meg: lépj be újra." };
  let local: string;
  try {
    local = await deps.download({
      uri: `${input.apiUrl.replace(/\/+$/, "")}${billingPdfPath(input.kind, input.id)}`,
      headers: { Authorization: `Bearer ${token}` },
      fileName: billingPdfFileName(input.kind, input.id),
    });
  } catch {
    return {
      ok: false,
      message: "A PDF nem töltődött le. Próbáld újra térerővel.",
    };
  }
  try {
    await deps.open(local, "application/pdf");
    return { ok: true };
  } catch {
    return { ok: false, message: "A telefon nem tudta megnyitni a PDF-et." };
  }
}
