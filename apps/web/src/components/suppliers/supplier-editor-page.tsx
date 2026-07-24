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
  PERMISSIONS,
  type SupplierSummary,
  type ViesVatLookupResult,
} from "@acropora/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import {
  COUNTRY_OPTIONS,
  inferCountryFromTaxNumber,
} from "@/components/customers/country-options";
import { ApiError } from "@/lib/api/client";
import { postalCodeApi } from "@/lib/api/postal-code";
import { suppliersApi } from "@/lib/api/suppliers";
import { viesVatApi } from "@/lib/api/vies-vat";

export function SupplierEditorPage({ supplierId }: { supplierId?: string }) {
  const { session } = useAuth();
  const router = useRouter();
  const [supplier, setSupplier] = useState<SupplierSummary | null>(null);
  const [loading, setLoading] = useState(Boolean(supplierId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [taxNumber, setTaxNumber] = useState("");
  const [country, setCountry] = useState("HU");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [iban, setIban] = useState("");
  const [swiftCode, setSwiftCode] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [contactPersonName, setContactPersonName] = useState("");
  const [contactPersonPhone, setContactPersonPhone] = useState("");
  const [contactPersonEmail, setContactPersonEmail] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [city, setCity] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [viesBusy, setViesBusy] = useState(false);
  const [viesResult, setViesResult] = useState<ViesVatLookupResult | null>(
    null,
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PURCHASING_MANAGE),
  );
  const token = session?.token ?? "";
  const isEu = country.trim().toUpperCase() !== "HU";

  useEffect(() => {
    if (!supplierId || !session) return;
    setLoading(true);
    suppliersApi
      .detail(token, supplierId)
      .then((next) => {
        setSupplier(next);
        setName(next.name);
        setTaxNumber(next.taxNumber ?? "");
        setCountry(next.country);
        setEmail(next.email ?? "");
        setPhone(next.phone ?? "");
        setIban(next.iban ?? "");
        setSwiftCode(next.swiftCode ?? "");
        setBankAccountNumber(next.bankAccountNumber ?? "");
        setContactPersonName(next.contactPersonName ?? "");
        setContactPersonPhone(next.contactPersonPhone ?? "");
        setContactPersonEmail(next.contactPersonEmail ?? "");
        setPostalCode(next.postalCode ?? "");
        setCity(next.city ?? "");
        setAddressLine1(next.addressLine1 ?? "");
        setAddressLine2(next.addressLine2 ?? "");
      })
      .catch((cause) => {
        setError(
          cause instanceof Error
            ? cause.message
            : "A beszállító nem tölthető be.",
        );
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId, token]);

  useEffect(() => {
    // Az irányítószám → város lookup egy magyar irányítószám-adatbázisra épül
    // (lásd postal-code.ts), EU-s beszállítónál a négyjegyű szám nem magyar
    // irányítószám, ne írjon ki tévesen magyar településnevet.
    if (isEu) return;
    const zip = postalCode.trim();
    if (!/^\d{4}$/.test(zip)) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      postalCodeApi
        .lookup(token, zip, controller.signal)
        .then((result) => {
          // Legjobb-erőfeszítés kényelmi funkció, mint a Vevő űrlapon - nem
          // ír felül egy már kitöltött várost.
          if (result.city && !city.trim()) setCity(result.city);
        })
        .catch(() => {
          // Hiba esetén a Város mező kézzel kitöltendő marad.
        });
    }, 500);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postalCode, isEu, token]);

  if (!canManage)
    return (
      <Alert
        variant="danger"
        title="Nincs jogosultságod beszállító rögzítéséhez"
        description="A beszállítók kezeléséhez purchasing.manage szükséges."
      />
    );
  if (loading)
    return (
      <div aria-label="Beszállító betöltése">
        <Skeleton className="h-96" />
      </div>
    );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError("A név megadása kötelező.");
      return;
    }
    setBusy(true);
    setError(null);
    const payload = {
      name: name.trim(),
      taxNumber: taxNumber.trim() || undefined,
      country: country.trim().toUpperCase(),
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      iban: isEu ? iban.trim() || undefined : undefined,
      swiftCode: isEu ? swiftCode.trim() || undefined : undefined,
      bankAccountNumber: isEu
        ? undefined
        : bankAccountNumber.trim() || undefined,
      contactPersonName: contactPersonName.trim() || undefined,
      contactPersonPhone: contactPersonPhone.trim() || undefined,
      contactPersonEmail: contactPersonEmail.trim() || undefined,
      postalCode: postalCode.trim() || undefined,
      city: city.trim() || undefined,
      addressLine1: addressLine1.trim() || undefined,
      addressLine2: addressLine2.trim() || undefined,
    };
    try {
      if (supplier) {
        setSupplier(
          await suppliersApi.update(token, supplier.id, {
            ...payload,
            taxNumber: payload.taxNumber ?? null,
            email: payload.email ?? null,
            phone: payload.phone ?? null,
            iban: payload.iban ?? null,
            swiftCode: payload.swiftCode ?? null,
            bankAccountNumber: payload.bankAccountNumber ?? null,
            contactPersonName: payload.contactPersonName ?? null,
            contactPersonPhone: payload.contactPersonPhone ?? null,
            contactPersonEmail: payload.contactPersonEmail ?? null,
            postalCode: payload.postalCode ?? null,
            city: payload.city ?? null,
            addressLine1: payload.addressLine1 ?? null,
            addressLine2: payload.addressLine2 ?? null,
            expectedUpdatedAt: supplier.updatedAt,
          }),
        );
      } else {
        const created = await suppliersApi.create(token, payload);
        router.push(`/partnerek/${created.id}`);
      }
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 409
          ? "A beszállítót időközben módosították, vagy a kód már foglalt. Frissítsd az oldalt."
          : cause instanceof Error
            ? cause.message
            : "A beszállító nem menthető.",
      );
      if (cause instanceof ApiError && cause.status === 409 && supplierId) {
        const fresh = await suppliersApi.detail(token, supplierId);
        setSupplier(fresh);
      }
    } finally {
      setBusy(false);
    }
  };

  const checkVies = async () => {
    if (!taxNumber.trim() || viesBusy) return;
    setViesBusy(true);
    setViesResult(null);
    try {
      setViesResult(await viesVatApi.check(token, taxNumber.trim()));
    } catch (cause) {
      setViesResult({
        message:
          cause instanceof Error
            ? cause.message
            : "A VIES ellenőrzés nem sikerült.",
      });
    } finally {
      setViesBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={supplier ? supplier.name : "Új beszállító"}
        description="Törzsadatok, bankszámla és kapcsolattartó a beszerzési számlák rögzítéséhez."
        actions={
          <Link href="/partnerek">
            <Button variant="secondary">Vissza a listához</Button>
          </Link>
        }
      />
      {error ? (
        <Alert
          variant="danger"
          title="A művelet nem sikerült"
          description={error}
        />
      ) : null}
      <form className="space-y-6" onSubmit={submit}>
        <Card className="p-6">
          <h2 className="font-semibold">Alapadatok</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <FormField label="Név">
              <Input
                aria-label="Név"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </FormField>
            <FormField label="Ország">
              <Select
                aria-label="Ország"
                value={country}
                onChange={(event) => setCountry(event.target.value)}
              >
                {COUNTRY_OPTIONS.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Adószám">
              <div className="flex gap-2">
                <Input
                  aria-label="Adószám"
                  value={taxNumber}
                  onChange={(event) => {
                    const value = event.target.value;
                    setTaxNumber(value);
                    setViesResult(null);
                    const inferred = inferCountryFromTaxNumber(value);
                    if (inferred) setCountry(inferred);
                  }}
                  placeholder={isEu ? "pl. DE123456789" : "12345678-1-42"}
                />
                {isEu ? (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!taxNumber.trim() || viesBusy}
                    onClick={() => void checkVies()}
                  >
                    {viesBusy ? "Ellenőrzés…" : "VIES ellenőrzés"}
                  </Button>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Az Ország mezőt az adószám alapján automatikusan kitöltjük;
                szükség esetén felülírható.
              </p>
              {viesResult ? (
                viesResult.valid === undefined ? (
                  <p className="mt-1 text-xs text-amber-600">
                    {viesResult.message}
                  </p>
                ) : (
                  <div className="mt-1 flex items-center gap-2">
                    <Badge variant={viesResult.valid ? "success" : "danger"}>
                      {viesResult.valid
                        ? "Érvényes EU-s adószám"
                        : "Érvénytelen EU-s adószám"}
                    </Badge>
                    {viesResult.valid &&
                    (viesResult.name || viesResult.address) ? (
                      <span className="text-xs text-slate-500">
                        {[viesResult.name, viesResult.address]
                          .filter(Boolean)
                          .join(" - ")}
                      </span>
                    ) : null}
                  </div>
                )
              ) : null}
            </FormField>
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
          {supplier ? (
            <div className="mt-4">
              <Badge variant={supplier.isActive ? "success" : "neutral"}>
                {supplier.isActive ? "Aktív" : "Inaktív"}
              </Badge>
            </div>
          ) : null}
        </Card>
        <Card className="p-6">
          <h2 className="font-semibold">Bankszámla</h2>
          <p className="mt-1 text-sm text-slate-500">
            {isEu
              ? "EU-n belüli beszállítónál nemzetközi átutaláshoz IBAN és SWIFT/BIC szükséges."
              : "Belföldi beszállítónál a hazai formátumú bankszámlaszám."}
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {isEu ? (
              <>
                <FormField label="IBAN">
                  <Input
                    aria-label="IBAN"
                    value={iban}
                    onChange={(event) => setIban(event.target.value)}
                    placeholder="DE89 3704 0044 0532 0130 00"
                  />
                </FormField>
                <FormField label="SWIFT / BIC kód">
                  <Input
                    aria-label="SWIFT / BIC kód"
                    value={swiftCode}
                    onChange={(event) => setSwiftCode(event.target.value)}
                    placeholder="pl. COBADEFFXXX"
                  />
                </FormField>
              </>
            ) : (
              <FormField label="Bankszámlaszám">
                <Input
                  aria-label="Bankszámlaszám"
                  value={bankAccountNumber}
                  onChange={(event) => setBankAccountNumber(event.target.value)}
                  placeholder="12345678-12345678-12345678"
                />
              </FormField>
            )}
          </div>
        </Card>
        <Card className="p-6">
          <h2 className="font-semibold">Cím</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <FormField label="Irányítószám">
              <Input
                aria-label="Irányítószám"
                value={postalCode}
                onChange={(event) => setPostalCode(event.target.value)}
              />
            </FormField>
            <FormField label="Város">
              <Input
                aria-label="Város"
                value={city}
                onChange={(event) => setCity(event.target.value)}
              />
            </FormField>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <FormField label="Utca, házszám">
              <Input
                aria-label="Utca, házszám"
                value={addressLine1}
                onChange={(event) => setAddressLine1(event.target.value)}
              />
            </FormField>
            <FormField label="Cím kiegészítés">
              <Input
                aria-label="Cím kiegészítés"
                value={addressLine2}
                onChange={(event) => setAddressLine2(event.target.value)}
              />
            </FormField>
          </div>
        </Card>
        <Card className="p-6">
          <h2 className="font-semibold">Ügyintéző</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <FormField label="Ügyintéző neve">
              <Input
                aria-label="Ügyintéző neve"
                value={contactPersonName}
                onChange={(event) => setContactPersonName(event.target.value)}
              />
            </FormField>
            <FormField label="Ügyintéző telefonszáma">
              <Input
                aria-label="Ügyintéző telefonszáma"
                value={contactPersonPhone}
                onChange={(event) => setContactPersonPhone(event.target.value)}
              />
            </FormField>
            <FormField label="Ügyintéző e-mail címe">
              <Input
                type="email"
                aria-label="Ügyintéző e-mail címe"
                value={contactPersonEmail}
                onChange={(event) => setContactPersonEmail(event.target.value)}
              />
            </FormField>
          </div>
        </Card>
        <div className="flex justify-end">
          <Button type="submit" disabled={busy}>
            {busy
              ? "Mentés…"
              : supplier
                ? "Változások mentése"
                : "Beszállító létrehozása"}
          </Button>
        </div>
      </form>
    </div>
  );
}
