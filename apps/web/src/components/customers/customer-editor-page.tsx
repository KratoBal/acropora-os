"use client";
import {
  Alert,
  Button,
  Card,
  FormField,
  Input,
  PageHeader,
  Select,
} from "@acropora/ui";
import { hasPermission, PERMISSIONS } from "@acropora/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { customersApi } from "@/lib/api/customers";
import { navTaxpayerApi } from "@/lib/api/nav-taxpayer";
import { postalCodeApi } from "@/lib/api/postal-code";
import { COUNTRY_OPTIONS } from "./country-options";

interface AddressState {
  country: string;
  postalCode: string;
  city: string;
  line1: string;
  line2: string;
}

const emptyAddress = (): AddressState => ({
  country: "HU",
  postalCode: "",
  city: "",
  line1: "",
  line2: "",
});

const addressHasData = (address: AddressState) =>
  Boolean(address.postalCode.trim() || address.city.trim() || address.line1.trim());

function AddressFields({
  idPrefix,
  address,
  onChange,
  token,
}: {
  idPrefix: string;
  address: AddressState;
  onChange: (next: AddressState) => void;
  token: string;
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
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label="Ország">
          <Select
            aria-label={`${idPrefix} ország`}
            value={address.country}
            onChange={(event) => onChange({ ...address, country: event.target.value })}
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
            value={address.postalCode}
            onChange={(event) => onChange({ ...address, postalCode: event.target.value })}
          />
        </FormField>
        <FormField label="Város">
          <Input
            aria-label={`${idPrefix} város`}
            value={address.city}
            onChange={(event) => onChange({ ...address, city: event.target.value })}
          />
        </FormField>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <FormField label="Utca, házszám">
          <Input
            aria-label={`${idPrefix} utca, házszám`}
            value={address.line1}
            onChange={(event) => onChange({ ...address, line1: event.target.value })}
          />
        </FormField>
        <FormField label="Cím kiegészítés">
          <Input
            aria-label={`${idPrefix} cím kiegészítés`}
            value={address.line2}
            onChange={(event) => onChange({ ...address, line2: event.target.value })}
          />
        </FormField>
      </div>
    </>
  );
}

export function CustomerEditorPage() {
  const { session } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<"PERSON" | "COMPANY">("PERSON");
  const [displayName, setDisplayName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [taxNumber, setTaxNumber] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [marketingEmailConsent, setMarketingEmailConsent] = useState(false);
  const [marketingSmsConsent, setMarketingSmsConsent] = useState(false);
  const [billing, setBilling] = useState<AddressState>(emptyAddress());
  const [shipSameAsBilling, setShipSameAsBilling] = useState(true);
  const [shipping, setShipping] = useState<AddressState>(emptyAddress());
  const [navLookupBusy, setNavLookupBusy] = useState(false);
  const [navLookupNotice, setNavLookupNotice] = useState<string | null>(null);
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.CUSTOMERS_MANAGE),
  );
  const token = session?.token ?? "";

  if (!canManage)
    return (
      <Alert
        variant="danger"
        title="Nincs jogosultságod vevő rögzítéséhez"
        description="A vevők kezeléséhez customers.manage szükséges."
      />
    );

  const navLookup = async () => {
    if (!taxNumber.trim() || navLookupBusy) return;
    setNavLookupBusy(true);
    setNavLookupNotice(null);
    try {
      const result = await navTaxpayerApi.lookup(token, taxNumber.trim());
      if (!result.valid || !result.data) {
        setNavLookupNotice("A NAV szerint ez az adószám nem érvényes.");
        return;
      }
      setCompanyName(result.data.name);
      setTaxNumber(result.data.taxNumber);
      if (result.data.address) {
        setBilling({
          country: result.data.address.country || "HU",
          postalCode: result.data.address.postalCode,
          city: result.data.address.city,
          line1: result.data.address.line1,
          line2: "",
        });
      }
      setNavLookupNotice("Cégadatok betöltve a NAV nyilvántartásából.");
    } catch (cause) {
      setNavLookupNotice(
        cause instanceof Error
          ? cause.message
          : "A cégadatok nem kérdezhetők le.",
      );
    } finally {
      setNavLookupBusy(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!displayName.trim()) {
      setError(
        type === "COMPANY"
          ? "A kapcsolattartó nevének megadása kötelező."
          : "A név megadása kötelező.",
      );
      return;
    }
    if (type === "COMPANY" && !companyName.trim()) {
      setError("Cég esetén a cégnév megadása kötelező.");
      return;
    }
    const billingFilled = addressHasData(billing);
    if (
      billingFilled &&
      (!billing.postalCode.trim() || !billing.city.trim() || !billing.line1.trim())
    ) {
      setError("A számlázási cím megadásához az irányítószám, a város és az utca is kötelező.");
      return;
    }
    const shippingFilled = !shipSameAsBilling && addressHasData(shipping);
    if (
      shippingFilled &&
      (!shipping.postalCode.trim() || !shipping.city.trim() || !shipping.line1.trim())
    ) {
      setError("A szállítási cím megadásához az irányítószám, a város és az utca is kötelező.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await customersApi.create(token, {
        type,
        displayName: displayName.trim(),
        companyName: companyName.trim() || undefined,
        taxNumber: taxNumber.trim() || undefined,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        marketingEmailConsent,
        marketingSmsConsent,
        addresses: [
          ...(billingFilled
            ? [
                {
                  type: "BILLING" as const,
                  country: billing.country,
                  postalCode: billing.postalCode.trim(),
                  city: billing.city.trim(),
                  line1: billing.line1.trim(),
                  line2: billing.line2.trim() || undefined,
                  isDefault: true,
                },
              ]
            : []),
          ...(shippingFilled
            ? [
                {
                  type: "SHIPPING" as const,
                  country: shipping.country,
                  postalCode: shipping.postalCode.trim(),
                  city: shipping.city.trim(),
                  line1: shipping.line1.trim(),
                  line2: shipping.line2.trim() || undefined,
                  isDefault: false,
                },
              ]
            : []),
        ],
      });
      router.push("/vevok");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A vevő nem menthető.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Új vevő"
        description="Kézzel rögzített partner felvétele. A UNAS webshopból érkező vevők automatikusan szinkronizálódnak."
        actions={
          <Link href="/vevok">
            <Button variant="secondary">Vissza a listához</Button>
          </Link>
        }
      />
      {error ? (
        <Alert variant="danger" title="A művelet nem sikerült" description={error} />
      ) : null}
      <form className="space-y-6" onSubmit={submit}>
        <Card className="p-6">
          <h2 className="font-semibold">Alapadatok</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <FormField label="Típus">
              <Select
                aria-label="Típus"
                value={type}
                onChange={(event) =>
                  setType(event.target.value as "PERSON" | "COMPANY")
                }
              >
                <option value="PERSON">Magánszemély</option>
                <option value="COMPANY">Cég</option>
              </Select>
            </FormField>
            {type === "COMPANY" ? (
              <FormField label="Adószám">
                <div className="flex gap-2">
                  <Input
                    aria-label="Adószám"
                    value={taxNumber}
                    onChange={(event) => setTaxNumber(event.target.value)}
                    placeholder="12345678-1-42"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!taxNumber.trim() || navLookupBusy}
                    onClick={() => void navLookup()}
                  >
                    {navLookupBusy ? "Lekérdezés…" : "NAV lekérdezés"}
                  </Button>
                </div>
                {navLookupNotice ? (
                  <p className="mt-1 text-xs text-slate-500">{navLookupNotice}</p>
                ) : null}
              </FormField>
            ) : (
              <FormField label="Név">
                <Input
                  aria-label="Név"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </FormField>
            )}
            {type === "COMPANY" ? (
              <FormField label="Cégnév">
                <Input
                  aria-label="Cégnév"
                  value={companyName}
                  onChange={(event) => setCompanyName(event.target.value)}
                />
              </FormField>
            ) : null}
            {type === "COMPANY" ? (
              <FormField label="Kapcsolattartó">
                <Input
                  aria-label="Kapcsolattartó"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </FormField>
            ) : null}
            <FormField label="E-mail cím">
              <Input
                type="email"
                aria-label="E-mail cím"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </FormField>
            <FormField label="Telefonszám">
              <Input
                aria-label="Telefonszám"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            </FormField>
          </div>
          <div className="mt-4 flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={marketingEmailConsent}
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
                onChange={(event) => setMarketingSmsConsent(event.target.checked)}
              />
              Hírlevél SMS-ben
            </label>
          </div>
        </Card>
        <Card className="p-6">
          <h2 className="font-semibold">Számlázási cím</h2>
          <p className="mt-1 text-sm text-slate-500">
            Opcionális; ha kitöltöd, az irányítószám, a város és az utca kötelező.
          </p>
          <div className="mt-4">
            <AddressFields
              idPrefix="Számlázási cím"
              address={billing}
              onChange={setBilling}
              token={token}
            />
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={shipSameAsBilling}
              onChange={(event) => setShipSameAsBilling(event.target.checked)}
            />
            Szállítási cím megegyezik a számlázási címmel
          </label>
        </Card>
        {shipSameAsBilling ? null : (
          <Card className="p-6">
            <h2 className="font-semibold">Szállítási cím</h2>
            <div className="mt-4">
              <AddressFields
                idPrefix="Szállítási cím"
                address={shipping}
                onChange={setShipping}
                token={token}
              />
            </div>
          </Card>
        )}
        <div className="flex justify-end">
          <Button type="submit" disabled={busy}>
            {busy ? "Mentés…" : "Vevő létrehozása"}
          </Button>
        </div>
      </form>
    </div>
  );
}
