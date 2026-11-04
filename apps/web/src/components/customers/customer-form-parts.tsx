"use client";
import { FormField, Input, Select } from "@acropora/ui";
import { useEffect } from "react";

import { postalCodeApi } from "@/lib/api/postal-code";

import { COUNTRY_OPTIONS } from "./country-options";

export interface AddressState {
  country: string;
  postalCode: string;
  city: string;
  line1: string;
  line2: string;
}

export const emptyAddress = (): AddressState => ({
  country: "HU",
  postalCode: "",
  city: "",
  line1: "",
  line2: "",
});

export const addressHasData = (address: AddressState) =>
  Boolean(
    address.postalCode.trim() || address.city.trim() || address.line1.trim(),
  );

export function AddressFields({
  idPrefix,
  address,
  onChange,
  token,
  disabled = false,
}: {
  idPrefix: string;
  address: AddressState;
  onChange: (next: AddressState) => void;
  token: string;
  /** Read-only view (no customers.manage, or a partner mirror). */
  disabled?: boolean;
}) {
  useEffect(() => {
    const zip = address.postalCode.trim();
    if (!/^\d{4}$/.test(zip)) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      postalCodeApi
        .lookup(token, zip, controller.signal)
        .then((result) => {
          // Ne írjon felül egy már ismert (pl. NAV-lekérdezésből származó
          // vagy kézzel beírt) várost egy nem hivatalos, legjobb-erőfeszítés
          // forrás találatával.
          if (result.city && !address.city.trim())
            onChange({ ...address, city: result.city });
        })
        .catch(() => {
          // Legjobb-erőfeszítés kényelmi funkció - hiba esetén a Város mező
          // egyszerűen kézzel kitöltendő marad.
        });
    }, 500);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address.postalCode, token]);

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <FormField label="Ország">
          <Select
            aria-label={`${idPrefix} ország`}
            disabled={disabled}
            value={address.country}
            onChange={(event) =>
              onChange({ ...address, country: event.target.value })
            }
          >
            {COUNTRY_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Irányítószám">
          <Input
            aria-label={`${idPrefix} irányítószám`}
            disabled={disabled}
            value={address.postalCode}
            onChange={(event) =>
              onChange({ ...address, postalCode: event.target.value })
            }
          />
        </FormField>
        <FormField label="Város">
          <Input
            aria-label={`${idPrefix} város`}
            disabled={disabled}
            value={address.city}
            onChange={(event) =>
              onChange({ ...address, city: event.target.value })
            }
          />
        </FormField>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Utca, házszám">
          <Input
            aria-label={`${idPrefix} utca, házszám`}
            disabled={disabled}
            value={address.line1}
            onChange={(event) =>
              onChange({ ...address, line1: event.target.value })
            }
          />
        </FormField>
        <FormField label="Cím kiegészítés">
          <Input
            aria-label={`${idPrefix} cím kiegészítés`}
            disabled={disabled}
            value={address.line2}
            onChange={(event) =>
              onChange({ ...address, line2: event.target.value })
            }
          />
        </FormField>
      </div>
    </>
  );
}
