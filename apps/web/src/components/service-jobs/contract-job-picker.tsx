"use client";

import { useEffect, useState } from "react";

import { contractsApi, type ContractSummary } from "@/lib/api/contracts";
import type { SiteOption } from "@/lib/partners/site-tree";

export interface ContractJobChoice {
  contract: ContractSummary;
  itemIds: string[];
}

/**
 * THE CONTRACT OF A MAINTENANCE JOB, AND WHICH OF ITS ITEMS IT COVERS
 * (karbantartási felmérés S7, B út: a job from the contract without an order
 * sheet).
 *
 * Only the partner's active maintenance contracts are offered: the server
 * refuses every other kind (`createJobFromContract`), and a choice that can
 * only fail does not belong on the list. Every item with a site is ticked by
 * default, the same rule as issuing an order sheet (Balázs, 2026-09-24); an
 * item without a site cannot become a worksheet, so it cannot be ticked.
 *
 * The site and the assets are shown, not chosen: they come from the contract,
 * and the server rejects a client override.
 *
 * `locked`: an earlier request with the same idempotency key has an unknown
 * outcome, so the job may exist with THIS choice. A changed choice would be
 * sent under the old key and silently answered with the old job; a new key
 * would open a second one. So nothing here changes until the retry resolves.
 */
export function ContractJobPicker({
  token,
  customerId,
  siteOptions,
  value,
  onChange,
  locked = false,
}: {
  token: string;
  customerId: string;
  siteOptions: SiteOption[];
  value: ContractJobChoice | null;
  onChange: (choice: ContractJobChoice | null) => void;
  locked?: boolean;
}) {
  const [contracts, setContracts] = useState<ContractSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    contractsApi
      .list(token)
      .then((all) => {
        if (current)
          setContracts(
            all.filter(
              (contract) =>
                contract.customerId === customerId &&
                contract.status === "ACTIVE" &&
                contract.kind === "MAINTENANCE",
            ),
          );
      })
      .catch((cause: unknown) => {
        if (current)
          setError(
            cause instanceof Error
              ? cause.message
              : "A partner szerződései nem tölthetők be.",
          );
      });
    return () => {
      current = false;
    };
  }, [token, customerId]);

  const siteLabel = (departmentId: string) =>
    siteOptions.find((option) => option.id === departmentId)?.label ??
    "a szerződésen megadott helyszín";

  const pick = (contractId: string) => {
    const contract = contracts?.find((row) => row.id === contractId);
    onChange(
      contract
        ? {
            contract,
            itemIds: contract.items
              .filter((item) => item.departmentId)
              .map((item) => item.id),
          }
        : null,
    );
  };

  const toggle = (itemId: string) => {
    if (!value) return;
    onChange({
      ...value,
      itemIds: value.itemIds.includes(itemId)
        ? value.itemIds.filter((id) => id !== itemId)
        : [...value.itemIds, itemId],
    });
  };

  return (
    <div className="space-y-2">
      <label
        className="block text-sm font-semibold"
        htmlFor="karbantartas-szerzodes"
      >
        Szerződés
      </label>
      {error ? (
        <p className="text-sm text-rose-600">{error}</p>
      ) : contracts === null ? (
        <p className="text-sm text-dusk-500">Szerződések betöltése...</p>
      ) : (
        <select
          id="karbantartas-szerzodes"
          className="w-full rounded border px-2 py-1 text-sm"
          value={value?.contract.id ?? ""}
          disabled={locked}
          onChange={(event) => pick(event.target.value)}
        >
          <option value="">Szerződés nélkül</option>
          {contracts.map((contract) => (
            <option key={contract.id} value={contract.id}>
              {contract.number} · {contract.title}
            </option>
          ))}
        </select>
      )}
      {contracts !== null && contracts.length === 0 ? (
        <p className="text-xs text-dusk-500">
          A partnernek nincs aktív karbantartási szerződése.
        </p>
      ) : null}
      {value ? (
        <div className="space-y-2">
          <p className="text-xs text-dusk-500">
            A helyszín és az eszközök a kijelölt szerződéstételekből jönnek, itt
            nem írhatók felül. A lapon nincs ár.
          </p>
          <ul className="space-y-1 text-sm">
            {value.contract.items.map((item) => (
              <li key={item.id}>
                <label className="flex cursor-pointer items-start gap-2 py-1">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4"
                    checked={value.itemIds.includes(item.id)}
                    disabled={locked || !item.departmentId}
                    onChange={() => toggle(item.id)}
                  />
                  <span>
                    <span className="font-medium">
                      {item.position}. {item.description}
                    </span>
                    <span className="block text-xs text-dusk-500">
                      {item.departmentId
                        ? `Helyszín: ${siteLabel(item.departmentId)} · ${item.assets.length} eszköz`
                        : "Nincs helyszín megadva a szerződésen, ezért nem választható."}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
