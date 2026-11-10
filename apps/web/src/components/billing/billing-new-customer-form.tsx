"use client";

import { PilotButton, PilotInput } from "@acropora/ui";
import {
  CUSTOMER_LIST_PAGE_SIZE,
  normalizeEuTaxNumber,
  viesCountry,
  type CustomerDetail,
  type CustomerSummary,
  type ViesVatLookupResult,
} from "@acropora/types";
import { useState } from "react";

import { customersApi } from "@/lib/api/customers";
import { navTaxpayerApi } from "@/lib/api/nav-taxpayer";
import { viesVatApi } from "@/lib/api/vies-vat";
import { ViesMissingDetails } from "@/components/vies/vies-missing-details";

/**
 * Only the letters and digits, upper case, without a leading HU:
 * `HU12345678-2-42` is `12345678242`.
 */
const taxKey = (value: string) =>
  value
    .replace(/[^0-9A-Za-z]/g, "")
    .toUpperCase()
    .replace(/^HU(?=\d)/, "");

/**
 * ÚJ VEVŐ A SZÁMLA VEVŐ KÁRTYÁJÁN (Luca, 2026-10-08; acrobot 28105). A boltban
 * ismeretlen cégek is vásárolnak és ÁFA-s számlát kérnek; eddig a kerülőút a
 * Webshop vásárlók > Új vevő volt.
 *
 * Magyar adószámnál a NAV tölti a nevet és a címet. EU-s cégnél a VIES a
 * nevet (és ha a tagállam kiadja, a címet mutatja), de a közösségi adószám
 * NEM kerül a vevő adószám-mezőjébe: a kiállítás azt a Számlázz.hu magyar
 * adószám-mezőjébe küldené (acrobot 28145). Ezt a kártya ki is mondja.
 *
 * Az azonos adószámú, már meglévő vevőt felajánlja, mielőtt újat venne fel.
 */
export function BillingNewCustomerForm({
  token,
  initialSearch,
  existing = null,
  onSaved,
  onPickExisting,
  onClose,
}: {
  token: string;
  initialSearch: string;
  /**
   * A MEGLÉVŐ VEVŐ ADATAINAK MÓDOSÍTÁSA (Luca, 2026-11-10): ha meg van adva, az űrlap a vevő mostani adataival töltődik
   * ki, és a mentés a vevő sorát módosítja (nem vesz fel újat). Enélkül a „Módosítás” csak a partner-keresőt nyitotta, és
   * a beírt név, cím és e-mail eltűnt a képernyőről.
   */
  existing?: CustomerDetail | null;
  onSaved: (detail: CustomerDetail) => void;
  onPickExisting: (summary: CustomerSummary) => void;
  onClose: () => void;
}) {
  const editing = existing !== null;
  const typedTax = editing
    ? ""
    : /\d/.test(initialSearch)
      ? initialSearch.trim()
      : "";
  /** a vevő címe az űrlapon: a számlázási, ennek hiányában az alapértelmezett vagy az első */
  const savedAddress = existing
    ? (existing.addresses.find((a) => a.type === "BILLING") ??
      existing.addresses.find((a) => a.isDefault) ??
      existing.addresses[0] ??
      null)
    : null;
  /**
   * MAGÁNSZEMÉLY (Luca, 2026-11-10): az űrlap eddig mindig CÉGET vett fel („Cégnév” felirat), ezért egy magánszemély
   * soha nem lehetett magánszemélynek jelölt vevő, és a számla kapuja (`buyerTaxNumberProblem`: adószám kell, hacsak a
   * vevő nincs kifejezetten magánszemélynek jelölve) adószám nélkül nem engedte kiállítani.
   */
  const [person, setPerson] = useState(existing?.type === "PERSON");
  const [eu, setEu] = useState(
    existing
      ? Boolean(existing.euTaxNumber) && !existing.taxNumber
      : /^[A-Za-z]{2}/.test(typedTax) && !/^hu/i.test(typedTax),
  );
  const [taxNumber, setTaxNumber] = useState(
    existing ? (existing.taxNumber ?? existing.euTaxNumber ?? "") : typedTax,
  );
  const [companyName, setCompanyName] = useState(
    existing
      ? existing.companyName?.trim() || existing.displayName
      : typedTax
        ? ""
        : initialSearch.trim(),
  );
  const [postalCode, setPostalCode] = useState(savedAddress?.postalCode ?? "");
  const [city, setCity] = useState(savedAddress?.city ?? "");
  const [line1, setLine1] = useState(savedAddress?.line1 ?? "");
  /**
   * SZERKESZTESNEL ABBA A MEZOBE IRUNK, AMELYIKBOL OLVASTUNK (barracuda, #2355 review): a vevonek lehet altalanos
   * (`email`, rendeles-ertesitok) ES szamlazasi (`billingEmail`) cime is, es a kettő kulonbozhet. Az urlap a szamlazasit
   * mutatja, ha van; a mentes ugyanoda irja, egy valtoztatas nelkuli mentes tehat egyik cimet sem cserel ki.
   */
  const emailField: "billingEmail" | "email" = existing?.billingEmail?.trim()
    ? "billingEmail"
    : "email";
  const [email, setEmail] = useState(
    existing ? existing.billingEmail?.trim() || existing.email || "" : "",
  );
  const [vies, setVies] = useState<ViesVatLookupResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** the customers already on this tax number, offered before a new one */
  const [duplicates, setDuplicates] = useState<CustomerSummary[] | null>(null);

  const lookup = async () => {
    if (!taxNumber.trim()) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      if (eu) {
        const result = await viesVatApi.check(token, taxNumber.trim());
        setVies(result);
        if (result.valid === false) {
          setNotice("A VIES szerint ez a közösségi adószám nem érvényes.");
          return;
        }
        if (result.valid === undefined) {
          setNotice(result.message ?? "A VIES most nem válaszolt.");
          return;
        }
        if (result.name) setCompanyName(result.name);
        setNotice(
          result.address
            ? `A VIES szerinti cím: ${result.address}. Írd be a mezőkbe.`
            : "A VIES szerint érvényes.",
        );
        return;
      }
      // NAV knows the number without its country code
      const result = await navTaxpayerApi.lookup(
        token,
        taxNumber.trim().replace(/^HU\s*/i, ""),
      );
      if (!result.valid || !result.data) {
        setNotice("A NAV szerint ez az adószám nem érvényes.");
        return;
      }
      setCompanyName(result.data.name);
      setTaxNumber(result.data.taxNumber);
      if (result.data.address) {
        setPostalCode(result.data.address.postalCode);
        setCity(result.data.address.city);
        setLine1(result.data.address.line1);
      }
      setNotice("Cégadatok betöltve a NAV nyilvántartásából.");
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : "A cégadatok nem kérdezhetők le.",
      );
    } finally {
      setBusy(false);
    }
  };

  /** the customers whose tax number has the same first eight digits */
  const sameTaxNumber = async (): Promise<CustomerSummary[]> => {
    const base = taxKey(taxNumber).slice(0, 8);
    if (eu || base.length < 8) return [];
    const page = await customersApi.list(
      token,
      new URLSearchParams({
        search: base,
        page: "1",
        pageSize: String(CUSTOMER_LIST_PAGE_SIZE.min),
        // the partners' customer rows too: after the partner register merge a partner and its customer are ONE row
        // that carries the partner link, and the list leaves such rows out unless asked (a company already in the
        // register would be taken for a new one: card 40332480)
        includePartnerMirrors: "true",
      }),
    );
    // the search also hits the digits of a customer number or an e-mail; only
    // a customer whose OWN tax number has this base is the same company. The
    // list carries no tax number, so it is read from each detail.
    const details = await Promise.all(
      page.items.map((item) => customersApi.detail(token, item.id)),
    );
    return page.items.filter(
      (_item, index) =>
        // a partner's customer row can lack the tax number the partner has: the detail's partner hint carries it
        // (card aaf4f09d), and the search found the row through the partner's number (40332480)
        taxKey(
          details[index]?.taxNumber ||
            details[index]?.partnerTaxHint?.taxNumber ||
            "",
        ).slice(0, 8) === base,
    );
  };

  const save = async (confirmedNew: boolean) => {
    setBusy(true);
    setError(null);
    try {
      if (existing) {
        // a meglévő vevő módosítása: a sor frissül, nem jön létre új (és nincs azonos-adószám ajánlat)
        const name = companyName.trim();
        const country = eu ? euCountry! : (savedAddress?.country ?? "HU");
        const detail = await customersApi.update(token, existing.id, {
          type: person ? "PERSON" : "COMPANY",
          displayName: name,
          companyName: person ? null : name,
          // MAGÁNSZEMÉLYNÉL AZ ADÓSZÁM TÖRLŐDIK (barracuda, #2355 review): egy tévesen cégként felvett vevő átállításakor a
          // régi adószám nem maradhat a soron, mert a számla magánszemély vevővel is elvihetné
          ...(person
            ? { taxNumber: null, euTaxNumber: null }
            : {
                taxNumber: !eu && taxNumber.trim() ? taxNumber.trim() : null,
                euTaxNumber:
                  eu && taxNumber.trim()
                    ? (normalizeEuTaxNumber(taxNumber) ?? taxNumber.trim())
                    : null,
              }),
          [emailField]: email.trim() || null,
          addresses: [
            {
              ...(savedAddress ? { id: savedAddress.id } : {}),
              type: savedAddress?.type ?? "BILLING",
              country,
              postalCode: postalCode.trim(),
              city: city.trim(),
              line1: line1.trim(),
            },
          ],
          expectedUpdatedAt: existing.updatedAt,
        });
        onSaved(detail);
        return;
      }
      if (!confirmedNew && !person) {
        const found = await sameTaxNumber();
        if (found.length > 0) {
          setDuplicates(found);
          setBusy(false);
          return;
        }
      }
      const name = companyName.trim();
      const country = eu && !person ? euCountry! : "HU";
      const detail = await customersApi.create(token, {
        type: person ? "PERSON" : "COMPANY",
        displayName: name,
        // a magánszemélynek nincs cégneve: a neve a megjelenítési név
        ...(person ? {} : { companyName: name }),
        // an EU number has its own field: in <adoszam> it would be sent as a
        // Hungarian one (acrobot 28145); it goes in <adoszamEU>
        ...(!person && !eu && taxNumber.trim()
          ? { taxNumber: taxNumber.trim() }
          : {}),
        ...(!person && eu && taxNumber.trim()
          ? { euTaxNumber: normalizeEuTaxNumber(taxNumber) ?? taxNumber.trim() }
          : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
        addresses: [
          {
            type: "BILLING",
            country,
            postalCode: postalCode.trim(),
            city: city.trim(),
            line1: line1.trim(),
            isDefault: true,
          },
        ],
      });
      onSaved(detail);
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : "A vevő nem menthető.",
      );
      setBusy(false);
    }
  };

  // an EU number has to start with its country code, or the address would
  // be saved without a country (barracuda, acrobot 28184)
  const euCountry = (() => {
    const code = viesCountry(taxNumber);
    return code && code !== "HU" ? code : null;
  })();
  const complete =
    companyName.trim() &&
    postalCode.trim() &&
    city.trim() &&
    line1.trim() &&
    (person || !eu || euCountry !== null);

  return (
    <div className="space-y-3 rounded-xl bg-pilot-grey-50 px-5 py-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-pilot-grey-900">
          {editing ? "Vevő adatainak módosítása" : "Új vevő felvétele"}
        </p>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-pilot-grey-600">
            <input
              type="checkbox"
              checked={person}
              onChange={(event) => {
                setPerson(event.target.checked);
                if (event.target.checked) setEu(false);
                setVies(null);
                setNotice(null);
                setDuplicates(null);
              }}
            />
            Magánszemély
          </label>
          {person ? null : (
            <label className="flex items-center gap-2 text-xs text-pilot-grey-600">
              <input
                type="checkbox"
                checked={eu}
                onChange={(event) => {
                  setEu(event.target.checked);
                  setVies(null);
                  setNotice(null);
                }}
              />
              EU-s cég
            </label>
          )}
        </div>
      </div>
      {person ? (
        <p className="text-xs text-pilot-grey-600">
          {existing?.taxNumber || existing?.euTaxNumber
            ? `A vevő mostani adószáma (${existing.taxNumber ?? existing.euTaxNumber}) a mentéskor törlődik: magánszemélynek nem kell adószám.`
            : "Magánszemélynek nem kell adószám."}
        </p>
      ) : (
        <>
          <div className="flex gap-2">
            <div className="flex-1">
              <PilotInput
                aria-label={eu ? "Közösségi adószám" : "Adószám"}
                placeholder={eu ? "pl. SK2020123456" : "12345678-2-42"}
                value={taxNumber}
                onChange={(value) => {
                  setTaxNumber(value);
                  setDuplicates(null);
                }}
              />
            </div>
            <PilotButton
              variant="secondary"
              size="action"
              disabled={busy || !taxNumber.trim()}
              onClick={() => void lookup()}
            >
              {eu ? "Ellenőrzés a VIES-ben" : "Kitöltés a NAV-ból"}
            </PilotButton>
          </div>
          {eu ? (
            <>
              <ViesMissingDetails taxNumber={taxNumber} result={vies} />
              <p className="text-xs text-pilot-grey-600">
                A közösségi adószám a vevő saját mezőjébe kerül, és a számlán a
                közösségi adószám helyén szerepel.
              </p>
              {taxNumber.trim() && !euCountry ? (
                <p className="text-xs text-pilot-red-700">
                  A közösségi adószám az ország kódjával kezdődik (például
                  SK2020123456).
                </p>
              ) : null}
            </>
          ) : null}
        </>
      )}
      {notice ? <p className="text-xs text-pilot-grey-600">{notice}</p> : null}
      <PilotInput
        aria-label={person ? "Név" : "Cégnév"}
        placeholder={person ? "Név" : "Cégnév"}
        value={companyName}
        onChange={setCompanyName}
      />
      <div className="grid grid-cols-3 gap-2">
        <PilotInput
          aria-label="Irányítószám"
          placeholder="Irányítószám"
          value={postalCode}
          onChange={setPostalCode}
        />
        <div className="col-span-2">
          <PilotInput
            aria-label="Város"
            placeholder="Város"
            value={city}
            onChange={setCity}
          />
        </div>
      </div>
      <PilotInput
        aria-label="Cím"
        placeholder="Utca, házszám"
        value={line1}
        onChange={setLine1}
      />
      <PilotInput
        aria-label="E-mail"
        placeholder="E-mail (nem kötelező)"
        value={email}
        onChange={setEmail}
      />
      {error ? (
        <p role="alert" className="text-xs text-pilot-red-700">
          {error}
        </p>
      ) : null}
      {duplicates ? (
        <div className="space-y-2 rounded-lg bg-white px-4 py-3 ring-1 ring-pilot-amber-200">
          <p className="text-xs text-pilot-amber-700">
            Ezzel az adószámmal már van vevő:
          </p>
          <ul className="space-y-1">
            {duplicates.map((summary) => (
              <li key={summary.id}>
                <button
                  type="button"
                  onClick={() => onPickExisting(summary)}
                  className="cursor-pointer text-left text-sm font-medium text-pilot-aqua-700 hover:underline"
                >
                  {summary.companyName?.trim() || summary.displayName} (
                  {summary.customerNumber})
                </button>
              </li>
            ))}
          </ul>
          <PilotButton
            variant="ghost"
            size="action"
            disabled={busy || !complete}
            onClick={() => void save(true)}
          >
            Mégis új vevőt veszek fel
          </PilotButton>
        </div>
      ) : null}
      <div className="flex justify-end gap-2">
        <PilotButton variant="ghost" size="action" onClick={onClose}>
          Mégse
        </PilotButton>
        <PilotButton
          size="action"
          disabled={busy || !complete || duplicates !== null}
          onClick={() => void save(false)}
        >
          {editing ? "Módosítás mentése" : "Vevő mentése és kiválasztása"}
        </PilotButton>
      </div>
    </div>
  );
}
