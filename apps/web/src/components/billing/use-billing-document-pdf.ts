"use client";

import { useState } from "react";

import { billingDocumentsApi } from "@/lib/api/billing-documents";

/**
 * A HIVATALOS PDF MŰVELETEI: megnézés, nyomtatás, letöltés (brief 12-13. pont).
 * A részletek lapja és a szerkesztő „Kiállítva” sávja (hétfői lista M2, Luca
 * kérése) ugyanezt használja, hogy a kettő ne térjen el: mindig a tárolt,
 * Számlázz.hu által adott PDF nyílik, soha nem a lap DOM-ja.
 */
export function useBillingDocumentPdf(token: string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const withPdf = async (id: string, use: (url: string) => void) => {
    setBusy(true);
    setError(null);
    try {
      const blob = await billingDocumentsApi.pdf(token, id);
      use(URL.createObjectURL(blob));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A PDF nem tölthető le.",
      );
    } finally {
      setBusy(false);
    }
  };

  return {
    busy,
    error,
    /** A számlakép új lapon. */
    view: (id: string) =>
      void withPdf(id, (url) => {
        window.open(url, "_blank");
      }),
    /** A böngésző nyomtatási előnézete a hivatalos PDF-en. */
    print: (id: string) =>
      void withPdf(id, (url) => {
        const opened = window.open(url, "_blank");
        opened?.addEventListener("load", () => opened.print());
      }),
    download: (id: string, fileTitle: string) =>
      void withPdf(id, (url) => {
        const link = document.createElement("a");
        link.href = url;
        link.download = `${fileTitle}.pdf`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }),
  };
}
