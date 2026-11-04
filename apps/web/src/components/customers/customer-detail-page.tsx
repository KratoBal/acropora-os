"use client";
import {
  Alert,
  Badge,
  Button,
  Card,
  FormField,
  Input,
  PageHeader,
  Select,
  Skeleton,
} from "@acropora/ui";
import {
  hasPermission,
  huTaxNumberProblem,
  normalizeEuTaxNumber,
  PERMISSIONS,
  type CustomerAddress,
  type CustomerDetail,
  type UpdateCustomerAddressInput,
} from "@acropora/types";
import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useReturnTo } from "@/components/navigation-history";
import { customersApi } from "@/lib/api/customers";
import { navTaxpayerApi } from "@/lib/api/nav-taxpayer";

import {
  type AddressState,
  AddressFields,
  addressHasData,
  emptyAddress,
} from "./customer-form-parts";

const ADDRESS_TITLE: Record<CustomerAddress["type"], string> = {
  BILLING: "Számlázási cím",
  SHIPPING: "Szállítási cím",
  OTHER: "Egyéb cím",
};

/** One address of the customer as the form edits it; `id` empty for a new one. */
interface EditableAddress {
  id: string | null;
  type: CustomerAddress["type"];
  state: AddressState;
}

const toEditable = (address: CustomerAddress): EditableAddress => ({
  id: address.id,
  type: address.type,
  state: {
    country: address.country,
    postalCode: address.postalCode,
    city: address.city,
    line1: address.line1,
    line2: address.line2 ?? "",
  },
});

const sameAddress = (a: AddressState, b: AddressState) =>
  a.country === b.country &&
  a.postalCode === b.postalCode &&
  a.city === b.city &&
  a.line1 === b.line1 &&
  a.line2 === b.line2;

const addressComplete = (address: AddressState) =>
  Boolean(
    address.postalCode.trim() && address.city.trim() && address.line1.trim(),
  );

/**
 * EGY MEGLÉVŐ VEVŐ ADATLAPJA ÉS SZERKESZTÉSE (acrobot 42510; Luca 2026-11-04 14:23 UTC: az állatkert vevő-során az
 * adószámot nem tudta beírni, mert meglévő vevőhöz nem volt szerkesztő oldal).
 *
 * EZ AZ A CUSTOMER-ADATLAP, amire a partnertörzs-terv szerint később a szerep-jelvények kerülnek (egy lista, egy
 * adatlap): a fejléc jelvénysora ezért külön áll, és ma a forrást, a partner-tükör és az inaktív állapotot mutatja.
 *
 * AMIT A SZERKESZTÉS NEM TUD: címet törölni (egy címre eszköz vagy dokumentum hivatkozhat), és a partner vevő-tükrét
 * szerkeszteni (azt a Partnerek képernyő írja át minden mentésnél; az API is elutasítja).
 */
export function CustomerDetailPage({ customerId }: { customerId: string }) {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const backToList = useReturnTo("/vevok");
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.CUSTOMERS_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.CUSTOMERS_MANAGE),
  );

  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);

  const [type, setType] = useState<"PERSON" | "COMPANY">("PERSON");
  const [displayName, setDisplayName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [taxNumber, setTaxNumber] = useState("");
  const [euTaxNumber, setEuTaxNumber] = useState("");
  const [email, setEmail] = useState("");
  const [billingEmail, setBillingEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [marketingEmailConsent, setMarketingEmailConsent] = useState(false);
  const [marketingSmsConsent, setMarketingSmsConsent] = useState(false);
  const [addresses, setAddresses] = useState<EditableAddress[]>([]);
  const [touched, setTouched] = useState(false);
  const [navBusy, setNavBusy] = useState(false);
  const [navNotice, setNavNotice] = useState<string | null>(null);

  const fill = useCallback((detail: CustomerDetail) => {
    setCustomer(detail);
    setType(detail.type);
    setDisplayName(detail.displayName);
    setCompanyName(detail.companyName ?? "");
    setTaxNumber(detail.taxNumber ?? "");
    setEuTaxNumber(detail.euTaxNumber ?? "");
    setEmail(detail.email ?? "");
    setBillingEmail(detail.billingEmail ?? "");
    setPhone(detail.phone ?? "");
    setMarketingEmailConsent(detail.marketingEmailConsent);
    setMarketingSmsConsent(detail.marketingSmsConsent);
    setAddresses(detail.addresses.map(toEditable));
    setTouched(false);
  }, []);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setLoadError(null);
      try {
        fill(await customersApi.detail(token, customerId, signal));
        setStale(false);
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setLoadError(
          cause instanceof Error ? cause.message : "A vevő nem tölthető be.",
        );
      }
    },
    [canView, customerId, fill, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs jogosultságod a vevők megtekintéséhez"
        description="A vevők megtekintéséhez customers.view szükséges."
      />
    );
  if (loadError)
    return (
      <Alert
        variant="danger"
        title="A vevő nem tölthető be"
        description={loadError}
        action={
          <Button variant="secondary" onClick={() => void load()}>
            Újrapróbálás
          </Button>
        }
      />
    );
  if (!customer)
    return (
      <div aria-label="Vevő betöltése" className="space-y-3">
        <Skeleton className="h-16" />
        <Skeleton className="h-64" />
      </div>
    );

  const mirror = customer.partnerMirror;
  const readOnly = !canManage || mirror;
  const fromUnas = customer.source === "UNAS";
  const taxProblem = touched ? huTaxNumberProblem(taxNumber) : null;
  const euProblem =
    touched && euTaxNumber.trim() && !normalizeEuTaxNumber(euTaxNumber)
      ? "A közösségi adószám országkóddal kezdődik, utána a szám (pl. SK2020123456)."
      : null;
  const showTax = type === "COMPANY" || Boolean(customer.taxNumber);

  const setAddress = (index: number, state: AddressState) =>
    setAddresses((all) =>
      all.map((item, i) => (i === index ? { ...item, state } : item)),
    );

  const navLookup = async () => {
    if (!taxNumber.trim() || navBusy) return;
    setNavBusy(true);
    setNavNotice(null);
    try {
      const result = await navTaxpayerApi.lookup(token, taxNumber.trim());
      if (!result.valid || !result.data) {
        setNavNotice("A NAV szerint ez az adószám nem érvényes.");
        return;
      }
      setCompanyName(result.data.name);
      setTaxNumber(result.data.taxNumber);
      setNavNotice(
        "Cégadatok betöltve a NAV nyilvántartásából (a cím nem módosult).",
      );
    } catch (cause) {
      setNavNotice(
        cause instanceof Error
          ? cause.message
          : "A cégadatok nem kérdezhetők le.",
      );
    } finally {
      setNavBusy(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    setSaved(false);
    setSaveError(null);
    if (!displayName.trim()) {
      setSaveError(
        type === "COMPANY"
          ? "A kapcsolattartó nevének megadása kötelező."
          : "A név megadása kötelező.",
      );
      return;
    }
    if (huTaxNumberProblem(taxNumber)) return;
    if (euTaxNumber.trim() && !normalizeEuTaxNumber(euTaxNumber)) return;
    for (const item of addresses) {
      if (addressHasData(item.state) && !addressComplete(item.state)) {
        setSaveError(
          `A(z) ${ADDRESS_TITLE[item.type].toLowerCase()}hez az irányítószám, a város és az utca is kötelező.`,
        );
        return;
      }
    }
    // only the addresses that changed (or are new) are sent: the others stay untouched
    const loaded = new Map(
      customer.addresses.map((a) => [a.id, toEditable(a)]),
    );
    const changed: UpdateCustomerAddressInput[] = addresses
      .filter((item) => {
        if (!addressHasData(item.state)) return false;
        if (!item.id) return true;
        const before = loaded.get(item.id);
        return !before || !sameAddress(before.state, item.state);
      })
      .map((item) => ({
        ...(item.id ? { id: item.id } : {}),
        type: item.type,
        country: item.state.country,
        postalCode: item.state.postalCode.trim(),
        city: item.state.city.trim(),
        line1: item.state.line1.trim(),
        line2: item.state.line2.trim() || null,
      }));
    setBusy(true);
    try {
      const updated = await customersApi.update(token, customer.id, {
        type,
        displayName: displayName.trim(),
        companyName: companyName.trim() || null,
        taxNumber: taxNumber.trim() || null,
        euTaxNumber: type === "COMPANY" ? euTaxNumber.trim() || null : null,
        email: email.trim() || null,
        billingEmail: billingEmail.trim() || null,
        phone: phone.trim() || null,
        marketingEmailConsent,
        marketingSmsConsent,
        ...(changed.length ? { addresses: changed } : {}),
        expectedUpdatedAt: customer.updatedAt,
      });
      fill(updated);
      setSaved(true);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "A vevő nem menthető.";
      setSaveError(message);
      // another colleague saved first: the page offers a reload instead of overwriting their change
      if (/másik felhasználó módosította/.test(message)) setStale(true);
    } finally {
      setBusy(false);
    }
  };

  const hasBilling = addresses.some((a) => a.type === "BILLING");

  return (
    <div className="space-y-6">
      <PageHeader
        title={customer.companyName || customer.displayName}
        description={`${customer.customerNumber} · ${
          customer.type === "COMPANY" ? "Cég" : "Magánszemély"
        }`}
        actions={
          <Link href={backToList.href}>
            <Button variant="secondary">
              {backToList.fromWithinApp ? "Vissza" : "Vissza a listához"}
            </Button>
          </Link>
        }
      />
      {/* the badge row: the place of the roles later (customer, supplier, service partner) */}
      <div className="flex flex-wrap gap-2" data-testid="customer-badges">
        <Badge variant={fromUnas ? "info" : "neutral"}>
          {fromUnas ? "UNAS webshop" : "Általunk rögzített"}
        </Badge>
        {mirror ? <Badge variant="warning">Partner vevő-tükör</Badge> : null}
        {customer.isActive ? null : <Badge variant="danger">Inaktív</Badge>}
      </div>

      {mirror ? (
        <Alert
          variant="info"
          title="Ez a vevő egy partner vevő-tükre"
          description="A Partnerek képernyőn szerkeszthető, onnan másolódik ide minden mentésnél. Itt csak megtekinthető."
        />
      ) : null}
      {!canManage && !mirror ? (
        <Alert
          variant="info"
          title="Csak megtekintés"
          description="A vevők szerkesztéséhez customers.manage szükséges."
        />
      ) : null}
      {fromUnas && !readOnly ? (
        <Alert
          variant="info"
          title="UNAS-ból érkezett vevő"
          description="Az adószám, a közösségi adószám, a cégnév, a számlázási e-mail és a hozzájárulások megmaradnak a UNAS-szinkronnál. A típus, a név, a rendelési e-mail, a telefon és a számlázási/szállítási cím viszont felülíródhat, ha a UNAS-beli rekord megváltozik (a szinkron most alapból ki van kapcsolva)."
        />
      ) : null}
      {saved ? <Alert variant="info" title="A vevő adatai mentve" /> : null}
      {saveError ? (
        <Alert
          variant="danger"
          title="A mentés nem sikerült"
          description={saveError}
          action={
            stale ? (
              <Button variant="secondary" onClick={() => void load()}>
                Adatok frissítése
              </Button>
            ) : undefined
          }
        />
      ) : null}

      <form className="space-y-6" onSubmit={submit}>
        <Card className="p-6">
          <h2 className="font-semibold">Alapadatok</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Típus">
              <Select
                aria-label="Típus"
                value={type}
                disabled={readOnly}
                onChange={(event) =>
                  setType(event.target.value as "PERSON" | "COMPANY")
                }
              >
                <option value="PERSON">Magánszemély</option>
                <option value="COMPANY">Cég</option>
              </Select>
            </FormField>
            {type === "COMPANY" ? (
              <FormField label="Cégnév">
                <Input
                  aria-label="Cégnév"
                  value={companyName}
                  disabled={readOnly}
                  onChange={(event) => setCompanyName(event.target.value)}
                />
              </FormField>
            ) : null}
            <FormField label={type === "COMPANY" ? "Kapcsolattartó" : "Név"}>
              <Input
                aria-label={type === "COMPANY" ? "Kapcsolattartó" : "Név"}
                value={displayName}
                disabled={readOnly}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </FormField>
            {showTax ? (
              <FormField label="Adószám" error={taxProblem ?? undefined}>
                <div className="flex gap-2">
                  <Input
                    aria-label="Adószám"
                    value={taxNumber}
                    disabled={readOnly}
                    onChange={(event) => setTaxNumber(event.target.value)}
                    onBlur={() => setTouched(true)}
                    placeholder="12345678-1-42"
                  />
                  {readOnly ? null : (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={!taxNumber.trim() || navBusy}
                      onClick={() => void navLookup()}
                    >
                      {navBusy ? "Lekérdezés…" : "NAV lekérdezés"}
                    </Button>
                  )}
                </div>
                {navNotice ? (
                  <p className="mt-1 text-xs text-dusk-500">{navNotice}</p>
                ) : null}
                {/* the same-named partner's tax number (#2161): a hint where to copy it from, never copied by itself */}
                {!readOnly && !taxNumber.trim() && customer.partnerTaxHint ? (
                  <p
                    className="mt-1 text-xs text-dusk-600"
                    data-testid="partner-tax-hint"
                  >
                    A Partnerek között {customer.partnerTaxHint.partnerName}{" "}
                    a(z) {customer.partnerTaxHint.taxNumber} adószámmal
                    szerepel.{" "}
                    <button
                      type="button"
                      className="font-semibold underline"
                      onClick={() =>
                        setTaxNumber(customer.partnerTaxHint!.taxNumber)
                      }
                    >
                      Beírom
                    </button>
                  </p>
                ) : null}
              </FormField>
            ) : null}
            {type === "COMPANY" ? (
              <FormField
                label="Közösségi adószám"
                error={euProblem ?? undefined}
              >
                <Input
                  aria-label="Közösségi adószám"
                  value={euTaxNumber}
                  disabled={readOnly}
                  onChange={(event) => setEuTaxNumber(event.target.value)}
                  onBlur={() => setTouched(true)}
                  placeholder="pl. SK2020123456"
                />
              </FormField>
            ) : null}
            <FormField label="Rendelési e-mail">
              <Input
                type="email"
                aria-label="Rendelési e-mail"
                value={email}
                disabled={readOnly}
                onChange={(event) => setEmail(event.target.value)}
              />
            </FormField>
            <FormField label="Számlázási e-mail">
              <Input
                type="email"
                aria-label="Számlázási e-mail"
                value={billingEmail}
                disabled={readOnly}
                onChange={(event) => setBillingEmail(event.target.value)}
              />
            </FormField>
            <FormField label="Telefonszám">
              <Input
                aria-label="Telefonszám"
                value={phone}
                disabled={readOnly}
                onChange={(event) => setPhone(event.target.value)}
              />
            </FormField>
          </div>
          <div className="mt-4 flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={marketingEmailConsent}
                disabled={readOnly}
                onChange={(event) =>
                  setMarketingEmailConsent(event.target.checked)
                }
              />
              Hírlevél e-mailben
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={marketingSmsConsent}
                disabled={readOnly}
                onChange={(event) =>
                  setMarketingSmsConsent(event.target.checked)
                }
              />
              Hírlevél SMS-ben
            </label>
          </div>
        </Card>

        {addresses.map((item, index) => (
          <Card className="p-6" key={item.id ?? `new-${index}`}>
            <h2 className="font-semibold">{ADDRESS_TITLE[item.type]}</h2>
            <div className="mt-4">
              <AddressFields
                idPrefix={ADDRESS_TITLE[item.type]}
                address={item.state}
                onChange={(state) => setAddress(index, state)}
                token={token}
                disabled={readOnly}
              />
            </div>
          </Card>
        ))}
        {!readOnly && !hasBilling ? (
          <Card className="p-6">
            <p className="text-sm text-dusk-500">
              Ennek a vevőnek nincs számlázási címe.
            </p>
            <Button
              type="button"
              variant="secondary"
              className="mt-3"
              onClick={() =>
                setAddresses((all) => [
                  ...all,
                  { id: null, type: "BILLING", state: emptyAddress() },
                ])
              }
            >
              Számlázási cím felvétele
            </Button>
          </Card>
        ) : null}

        {readOnly ? null : (
          <div className="flex justify-end">
            <Button type="submit" disabled={busy}>
              {busy ? "Mentés…" : "Mentés"}
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}
