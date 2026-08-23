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
  type WorksheetDepartmentSummary,
  type ViesVatLookupResult,
} from "@acropora/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { useReturnTo } from "@/components/navigation-history";
import { PartnerDeleteButton } from "./partner-delete-button";
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
  /** A new record starts as a supplier, the same way the column defaults, so
   * that recording a supplier stays a matter of typing the name. */
  const [isSupplier, setIsSupplier] = useState(true);
  const [isService, setIsService] = useState(false);
  const [worksheetPartnerCode, setWorksheetPartnerCode] = useState("");
  const [units, setUnits] = useState<WorksheetDepartmentSummary[]>([]);
  const [newUnit, setNewUnit] = useState({ code: "", name: "" });
  const [unitError, setUnitError] = useState<string | null>(null);
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
  const backToList = useReturnTo("/partnerek");
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PARTNERS_MANAGE),
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
        setIsSupplier(next.isSupplier);
        setIsService(next.isService);
        setWorksheetPartnerCode(next.worksheetPartnerCode ?? "");
        void suppliersApi
          .units(token, next.id)
          .then((response) => setUnits(response.items))
          .catch(() => setUnitError("Az alegységek nem tölthetők be."));
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
        title="Nincs jogosultságod partner rögzítéséhez"
        description="A partnerek kezeléséhez partners.manage szükséges."
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
      isSupplier,
      isService,
      // Empty stays empty rather than becoming "": the column is unique, so
      // two partners "without a code" would collide on the empty string.
      worksheetPartnerCode: worksheetPartnerCode.trim() || undefined,
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
            worksheetPartnerCode: payload.worksheetPartnerCode ?? null,
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

  /** A unit is added on its own, not with the partner's other fields: it is a
   * separate record, and folding it into the save would mean a half-typed unit
   * could block a name change that has nothing to do with it. */
  const addUnit = async () => {
    if (!supplier) return;
    setUnitError(null);
    try {
      const created = await suppliersApi.createUnit(token, supplier.id, {
        code: newUnit.code.trim().toUpperCase(),
        name: newUnit.name.trim(),
      });
      setUnits((current) => [...current, created]);
      setNewUnit({ code: "", name: "" });
    } catch (cause) {
      setUnitError(
        cause instanceof Error
          ? cause.message
          : "Az alegység felvitele nem sikerült.",
      );
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
        title={supplier ? supplier.name : "Új felvitele"}
        description="Törzsadatok, bankszámla és kapcsolattartó a beszerzési számlák rögzítéséhez."
        actions={
          /*
            Oda vissza, ahonnan a kolléga jött - egy partner adatlapjára a
            munkalap felől is be lehet lépni, és onnan a partner-lista nem
            "vissza", hanem egy harmadik hely. Ha nincs honnan jönni
            (közvetlen cím, újratöltés), a lista a tartalék, ahogy eddig.
          */
          <Link href={backToList.href}>
            <Button variant="secondary">
              {backToList.fromWithinApp ? "Vissza" : "Vissza a listához"}
            </Button>
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
      {supplier && canManage ? (
        <PartnerDeleteButton
          token={token}
          partnerId={supplier.id}
          partnerName={supplier.name}
          onDeleted={backToList.goBack}
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
          <div className="mt-4 flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isSupplier}
                onChange={(event) => setIsSupplier(event.target.checked)}
              />
              Beszállító
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isService}
                onChange={(event) => setIsService(event.target.checked)}
              />
              Szerviz
            </label>
          </div>
          {/* Only shown for a service partner: it is the worksheet number's
              first segment, and a partner we only buy from never gets a
              worksheet. Not required, on purpose -- ticking "Szerviz" should
              not turn into "invent an abbreviation right now". The worksheet
              picker leaves partners without a code out instead, so the gap
              costs nothing until somebody wants a sheet. */}
          {isService ? (
            <div className="mt-4 sm:w-1/2">
              <FormField
                label="Partnerkód"
                description="A munkalapszám első tagja, pontosan négy karakter (például FANK). Munkalap csak akkor írható a partnernek, ha ez ki van töltve."
              >
                <Input
                  aria-label="Partnerkód"
                  value={worksheetPartnerCode}
                  maxLength={4}
                  onChange={(event) =>
                    setWorksheetPartnerCode(event.target.value.toUpperCase())
                  }
                  placeholder="FANK"
                />
              </FormField>
            </div>
          ) : null}
          {supplier ? (
            <div className="mt-4">
              <Badge variant={supplier.isActive ? "success" : "neutral"}>
                {supplier.isActive ? "Aktív" : "Inaktív"}
              </Badge>
            </div>
          ) : null}
        </Card>
        {/* Bank details are what we need in order to PAY a partner, so they
            belong to the supplier side. A service partner has none of this,
            and showing the block anyway would read as data somebody forgot to
            fill in. Nothing here was ever required, so hiding it takes no
            validation away. */}
        {/* Only for a partner that already exists: a unit hangs off the
            partner, and until the partner is saved there is nothing to hang it
            on. Only for a service partner, because a unit gives the worksheet
            number its middle segment, and a partner we only buy from never
            gets a worksheet. */}
        {supplier && isService ? (
          <Card className="p-6">
            <h2 className="font-semibold">Alegységek</h2>
            <p className="mt-1 text-sm text-slate-500">
              Az alegység kódja a munkalapszám középső tagja (például a BIO a
              FANK-BIO-2026-001 számban).
            </p>
            {unitError ? (
              <Alert variant="danger" title="Hiba" description={unitError} />
            ) : null}
            {units.length ? (
              <ul className="mt-4 space-y-1 text-sm">
                {units.map((unit) => (
                  <li key={unit.id} className="flex items-center gap-2">
                    <span className="font-mono text-xs text-slate-600">
                      {unit.code}
                    </span>
                    {/* The name keeps an element of its own: beside the code a
                        bare text node merges with it, and a search for the
                        name alone stops matching. */}
                    <span>{unit.name}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-slate-500">
                Ehhez a partnerhez még nincs alegység.
              </p>
            )}
            <div className="mt-4 grid gap-4 sm:grid-cols-[8rem_1fr_auto]">
              <FormField label="Kód">
                <Input
                  aria-label="Alegység kódja"
                  value={newUnit.code}
                  maxLength={3}
                  onChange={(event) =>
                    setNewUnit((current) => ({
                      ...current,
                      code: event.target.value.toUpperCase(),
                    }))
                  }
                  placeholder="BIO"
                />
              </FormField>
              <FormField label="Megnevezés">
                <Input
                  aria-label="Alegység neve"
                  value={newUnit.name}
                  onChange={(event) =>
                    setNewUnit((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="Biológiai labor"
                />
              </FormField>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!newUnit.code.trim() || !newUnit.name.trim()}
                  onClick={() => void addUnit()}
                >
                  Hozzáadás
                </Button>
              </div>
            </div>
          </Card>
        ) : null}
        {isSupplier ? (
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
                    onChange={(event) =>
                      setBankAccountNumber(event.target.value)
                    }
                    placeholder="12345678-12345678-12345678"
                  />
                </FormField>
              )}
            </div>
          </Card>
        ) : null}
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
                : // Not "Beszállító létrehozása": the checkboxes above decide
                  // what is being created, and the button must not contradict
                  // them when someone records a service partner.
                  "Partner létrehozása"}
          </Button>
        </div>
      </form>
    </div>
  );
}
