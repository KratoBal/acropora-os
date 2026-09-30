"use client";

import {
  Icon,
  PilotButton,
  PilotCallout,
  PilotInput,
  PilotSection,
} from "@acropora/ui";
import type { ProductListItem } from "@acropora/types";
import { useEffect, useState } from "react";

import { productApi } from "@/lib/api/products";
import {
  emptyLine,
  formatMoney,
  trimDecimal,
  type BillingPreview,
  type EditorLine,
} from "./billing-editor-state";

type LineField =
  | "description"
  | "quantity"
  | "unit"
  | "unitNet"
  | "vatRatePercent"
  | "discountPercent"
  | "comment";

/**
 * A TÉTELEK (brief 13-14. pont): termék és egyedi tétel ugyanabban a
 * szerkesztőben, minden tétel alatt saját megjegyzéssel.
 *
 * A KEDVEZMÉNY A TÉTEL "Kedv." MEZŐJE, de a bizonylaton KÜLÖN NEGATÍV SOR lesz,
 * közvetlenül a tétel alatt (Balázs döntése, 2026-09-30). A szerkesztő ezt a
 * sort meg is mutatja, ugyanazzal az összeggel, amit a szerver tárolni fog.
 *
 * A TERMÉK-SOR EGYSÉGÁRA ÜRESEN INDUL: a termék-lista csak bruttó bolti árat
 * ad, és abból a nettó egységár egy ÁFA-kulcs kitalálása lenne.
 */
export function BillingDocumentLineEditor({
  token,
  lines,
  amounts,
  currency,
  onChange,
  disabled,
}: {
  token: string;
  lines: EditorLine[];
  /**
   * Az élő számítás soronként, a `lines` sorrendjében, a Számlázz.hu
   * szabályával (`billingPreview`); `null`: hibás bemenet.
   */
  amounts: BillingPreview["lines"] | null;
  currency: string;
  onChange: (lines: EditorLine[]) => void;
  disabled?: boolean;
}) {
  const [productSearch, setProductSearch] = useState<string | null>(null);

  const update = (key: string, field: LineField, value: string) =>
    onChange(
      lines.map((line) =>
        line.key === key ? { ...line, [field]: value } : line,
      ),
    );
  const remove = (key: string) =>
    onChange(lines.filter((line) => line.key !== key));
  const addCustom = () => onChange([...lines, emptyLine()]);
  const addProduct = (product: ProductListItem) => {
    onChange([
      ...lines,
      emptyLine({
        productId: product.id,
        productLabel: product.primarySku
          ? `${product.primarySku} · termék`
          : "termék",
        description: product.name,
      }),
    ]);
    setProductSearch(null);
  };

  return (
    <PilotSection
      title="Tételek"
      subtitle="Termék és egyedi tétel is hozzáadható."
      action={
        <div className="flex flex-wrap gap-2">
          <PilotButton
            variant="secondary"
            size="action"
            disabled={disabled}
            onClick={() => setProductSearch("")}
          >
            <Icon name="plus" size={12} />
            Termék hozzáadása
          </PilotButton>
          <PilotButton
            variant="secondary"
            size="action"
            disabled={disabled}
            onClick={addCustom}
          >
            <Icon name="plus" size={12} />
            Egyedi tétel
          </PilotButton>
        </div>
      }
    >
      {productSearch !== null ? (
        <ProductSearch
          token={token}
          search={productSearch}
          onSearch={setProductSearch}
          onPick={addProduct}
          onCancel={() => setProductSearch(null)}
        />
      ) : null}

      {lines.length === 0 ? (
        <p className="py-6 text-center text-sm text-pilot-grey-500">
          Még nincs tétel. Adj hozzá terméket vagy egyedi tételt.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="bg-pilot-grey-50 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-pilot-grey-500">
                <th className="px-3 py-2">Tétel</th>
                <th className="w-20 px-2 py-2">Menny.</th>
                <th className="w-20 px-2 py-2">Egység</th>
                <th className="w-32 px-2 py-2">Nettó egységár</th>
                <th className="w-20 px-2 py-2">ÁFA</th>
                <th className="w-20 px-2 py-2">Kedv.</th>
                <th className="w-32 px-3 py-2 text-right">Bruttó</th>
                <th className="w-10 px-2 py-2">
                  <span className="sr-only">Művelet</span>
                </th>
              </tr>
            </thead>
            {lines.map((line, index) => {
              const computed = amounts?.[index] ?? null;
              const label = line.description || `${index + 1}. tétel`;
              return (
                <tbody
                  key={line.key}
                  className="border-b border-pilot-grey-100"
                >
                  <tr className="align-top">
                    <td className="px-3 py-2">
                      <PilotInput
                        aria-label={`${index + 1}. tétel megnevezése`}
                        placeholder="Megnevezés"
                        value={line.description}
                        onChange={(value) =>
                          update(line.key, "description", value)
                        }
                        disabled={disabled}
                      />
                      <p className="mt-1 text-xs text-pilot-grey-500">
                        {line.productLabel ??
                          (line.productId ? "termék" : "Egyedi tétel")}
                      </p>
                    </td>
                    {(
                      [
                        ["quantity", "mennyisége", "decimal"],
                        ["unit", "egysége", "text"],
                        ["unitNet", "nettó egységára", "decimal"],
                        ["vatRatePercent", "ÁFA-kulcsa", "decimal"],
                        ["discountPercent", "kedvezménye (%)", "decimal"],
                      ] as const
                    ).map(([field, noun, mode]) => (
                      <td key={field} className="px-2 py-2">
                        <PilotInput
                          aria-label={`${label} ${noun}`}
                          inputMode={mode === "decimal" ? "decimal" : "text"}
                          placeholder={field === "discountPercent" ? "—" : ""}
                          value={line[field]}
                          onChange={(value) => update(line.key, field, value)}
                          disabled={disabled}
                        />
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-pilot-grey-900">
                      {computed
                        ? formatMoney(computed.item.grossAmount, currency)
                        : "—"}
                    </td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        aria-label={`${label} törlése`}
                        disabled={disabled}
                        onClick={() => remove(line.key)}
                        className="cursor-pointer rounded-md p-2 text-pilot-grey-400 hover:bg-pilot-grey-100 hover:text-pilot-grey-700 disabled:cursor-not-allowed"
                      >
                        <Icon name="x" size={14} />
                      </button>
                    </td>
                  </tr>
                  {computed?.discount ? (
                    <tr className="text-pilot-grey-600">
                      <td className="px-3 pb-2 pl-6 text-xs" colSpan={6}>
                        Kedvezmény (
                        {trimDecimal(
                          line.discountPercent.trim().replace(",", "."),
                        )}
                        %), külön negatív sorként a bizonylaton
                      </td>
                      <td className="px-3 pb-2 text-right text-xs font-semibold tabular-nums">
                        {formatMoney(computed.discount.grossAmount, currency)}
                      </td>
                      <td />
                    </tr>
                  ) : null}
                  <tr className="bg-pilot-grey-50">
                    <td className="px-3 py-2" colSpan={8}>
                      <div className="flex items-center gap-3">
                        <span className="shrink-0 text-xs text-pilot-grey-500">
                          Megjegyzés
                        </span>
                        <PilotInput
                          aria-label={`${label} megjegyzése`}
                          placeholder="Megjegyzés a tételhez…"
                          value={line.comment}
                          onChange={(value) =>
                            update(line.key, "comment", value)
                          }
                          disabled={disabled}
                        />
                      </div>
                    </td>
                  </tr>
                </tbody>
              );
            })}
          </table>
        </div>
      )}

      <div className="mt-4">
        <PilotCallout
          tone="warm"
          title="A sorösszegek automatikusan számolódnak"
          description="A Számlázz.hu a végleges, a szerveren újraszámolt összegeket és tételadatokat kapja meg."
        />
      </div>
      <div className="mt-4">
        <PilotButton
          variant="secondary"
          size="regular"
          disabled={disabled}
          onClick={addCustom}
        >
          <Icon name="plus" size={12} />
          Új sor
        </PilotButton>
      </div>
    </PilotSection>
  );
}

function ProductSearch({
  token,
  search,
  onSearch,
  onPick,
  onCancel,
}: {
  token: string;
  search: string;
  onSearch: (value: string) => void;
  onPick: (product: ProductListItem) => void;
  onCancel: () => void;
}) {
  const [results, setResults] = useState<ProductListItem[]>([]);
  useEffect(() => {
    if (search.trim().length < 2) {
      setResults([]);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      productApi
        .list(token, { search, page: 1, pageSize: 8, active: true })
        .then((response) => {
          if (active) setResults(response.items);
        })
        .catch(() => {
          if (active) setResults([]);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [search, token]);

  return (
    <div className="mb-4 space-y-2 rounded-xl bg-pilot-aqua-50 p-4">
      <div className="flex gap-2">
        <PilotInput
          aria-label="Termék keresése"
          placeholder="Terméknév vagy cikkszám"
          value={search}
          onChange={onSearch}
        />
        <PilotButton variant="ghost" size="regular" onClick={onCancel}>
          Mégse
        </PilotButton>
      </div>
      {results.length > 0 ? (
        <ul className="divide-y divide-pilot-grey-100 rounded-lg bg-white ring-1 ring-pilot-grey-200">
          {results.map((product) => (
            <li key={product.id}>
              <button
                type="button"
                onClick={() => onPick(product)}
                className="flex w-full cursor-pointer flex-col items-start px-4 py-2 text-left hover:bg-pilot-aqua-50"
              >
                <span className="text-sm font-medium text-pilot-grey-900">
                  {product.name}
                </span>
                {product.primarySku ? (
                  <span className="text-xs text-pilot-grey-500">
                    {product.primarySku}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : search.trim().length >= 2 ? (
        <p className="text-xs text-pilot-grey-500">Nincs találat.</p>
      ) : null}
    </div>
  );
}
