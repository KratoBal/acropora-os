"use client";

import { useEffect, useRef, useState } from "react";

import { assetsApi, type AssetCategorySuggestionInput } from "@/lib/api/assets";

/**
 * A JEV KATEGORIA-JAVASLAT A LETREHOZO URLAPON (V1 pilot, #1199 P-012/P-013).
 *
 * KESLELTETVE KER: a vetulet mezoinek (nev, gyarto, tipus, teljesitmeny...)
 * minden valtozasa utan `delayMs`-sel, es a meg futo kerest megszakitja. Ures
 * nevnel nem ker.
 *
 * SOHA NEM AKASZTJA MEG AZ URLAPOT: minden hiba (halozat, idotullepes, szerver)
 * csendben `null` javaslat. Ha a szerver azt mondja, hogy a pilot ki van
 * kapcsolva (`enabled: false`), az urlap ezen a munkameneten tobbet nem kerdez.
 */
/**
 * A NEV LEGALABB 3 KARAKTER (acrobot staging-merese, 2026-09-28): a "BIO",
 * "Hom" alaku csonkok zajt adnak, es a javaslatuk ugysem ervenyes. A nev
 * nelkuli (csak elotagbol allo) esetet a SZERVER fogja meg, mert csak o ismeri
 * a levagas szabalyat.
 */
const MIN_NEV = 3;

export function useCategorySuggestion(input: {
  readonly token: string;
  readonly fields: Omit<AssetCategorySuggestionInput, "clientOperationId">;
  readonly clientOperationId: string;
  readonly delayMs?: number;
}): string | null {
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const kikapcsolva = useRef(false);
  const delayMs = input.delayMs ?? 400;
  /* A MEZOK ERTEKE A KULCS, nem az objektum azonossaga: minden render uj objektumot ad. */
  const kulcs = JSON.stringify(input.fields);

  useEffect(() => {
    const mezok = JSON.parse(kulcs) as AssetCategorySuggestionInput;
    if (kikapcsolva.current || (mezok.name?.trim().length ?? 0) < MIN_NEV) {
      setCategoryId(null);
      return;
    }
    const megszakito = new AbortController();
    const idozito = setTimeout(() => {
      assetsApi
        .categorySuggestion(
          input.token,
          { ...mezok, clientOperationId: input.clientOperationId },
          megszakito.signal,
        )
        .then((valasz) => {
          if (!valasz.enabled) kikapcsolva.current = true;
          setCategoryId(valasz.categoryId);
        })
        .catch(() => {
          /* CSENDES KIMARADAS: a megszakitott es a hibas keres is javaslat nelkul. */
          if (!megszakito.signal.aborted) setCategoryId(null);
        });
    }, delayMs);
    return () => {
      clearTimeout(idozito);
      megszakito.abort();
    };
  }, [kulcs, input.token, input.clientOperationId, delayMs]);

  return categoryId;
}

/**
 * AZ URLAP MUVELET-AZONOSITOJA: egy urlap, egy azonosito (P-013). A formatum
 * illeszkedik a letrehozo DTO mintajara (`^[A-Za-z0-9_.:-]{8,128}$`).
 */
export function newAssetCreateOperationId(): string {
  const veletlen =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `asset-create:web:${veletlen}`;
}

/**
 * AZ ELOTOLTES DONTESE, TISZTA FUGGVENYKENT.
 *
 *   az ember mar nyult a kategoriahoz   semmi nem valtozik
 *   uj javaslat jott                    a valaszto erteke a javaslat
 *   a javaslat elmaradt, es a valaszto  a valaszto kiurul -- kulonben a mentes
 *   meg a korabbi elotoltest mutatja    egy mar ervenytelen javaslatot
 *                                       rogzitene elfogadottkent
 *
 * A KATEGORIAT AZ EMBER MENTI: ez csak a valaszto kezdoerteke.
 */
export function applyCategorySuggestion(state: {
  readonly categoryId: string;
  readonly prefilled: string | null;
  readonly touched: boolean;
  readonly suggestion: string | null;
}): { categoryId: string; prefilled: string | null } {
  const { categoryId, prefilled, touched, suggestion } = state;
  if (touched) return { categoryId, prefilled };
  if (suggestion) return { categoryId: suggestion, prefilled: suggestion };
  if (prefilled && categoryId === prefilled)
    return { categoryId: "", prefilled: null };
  return { categoryId, prefilled };
}
