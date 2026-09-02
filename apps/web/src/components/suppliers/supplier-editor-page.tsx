"use client";
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
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
import { type FormEvent, useEffect, useMemo, useState } from "react";
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
import { buildSiteTree } from "@/lib/partners/site-tree";
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
  const [newUnit, setNewUnit] = useState({
    parentId: "",
    code: "",
    name: "",
  });
  const [unitError, setUnitError] = useState<string | null>(null);
  /**
   * MELYIK SORT SZERKESZTJUK, es mi all a mezoben.
   *
   * Soronkenti allapot, nem egy kozos "szerkesztes" jelolo: ket sort egyszerre
   * atnevezni ugyis nem lehet, es egy kozos piszkozat-nev a MASIK sorra is
   * ratapadna, amikor a felhasznalo atkattint.
   */
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);
  const [unitDraftName, setUnitDraftName] = useState("");
  /** Amelyik sor ARCHIVALASARA a megerosito kerdes vonatkozik. */
  const [pendingArchive, setPendingArchive] =
    useState<WorksheetDepartmentSummary | null>(null);
  const [unitBusy, setUnitBusy] = useState(false);
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

  // A fa felepitese a lapos listabol. Memoizalva, mert minden ujrarajzolasnal
  // ket helyen kell (a lista es a szulo-valaszto), es ugyanazt a sorrendet kell
  // adnia mindkettonek.
  //
  // ES AMIERT ITT ALL, NEM LEJJEBB A HASZNALATA MELLETT: alatta ket korai
  // visszateres van (jogosultsag, toltes). Egy hook azok ALATT feltetelesen
  // futna, es a React a kovetkezo rajzolasnal mas hook-sorrendet latna --
  // ezt a hibat a komponens-teszt ures kepernyokent mutatta, nem uzenetkent.
  const unitRows = useMemo(() => buildSiteTree(units), [units]);

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
    // A KÓD CSAK AKKOR MEGY EL, HA VÁLTOZOTT, és ez nem takarékosság.
    //
    // Egy változatlan mező visszaküldése azt jelenti, hogy MINDEN jövőbeli
    // szigorítás a mező szabályán egyszerre kiterjed a partner ÖSSZES TÖBBI
    // mezőjének szerkesztésére is: a kérés a validáción bukik el, mielőtt
    // bármit elérne, és a szerkesztő nem érti, mert ő a kódhoz nem is nyúlt.
    // Ez nem elméleti: a négy karakteres szabály bevezetésekor (#183) pontosan
    // ez fenyegetett, és csak azért nem történt meg, mert élesben nulla ilyen
    // sor volt. A következő szigorítás nem biztos, hogy ilyen szerencsés.
    //
    // A kihagyott mező a szervernek "változatlan" jelentésű (a DTO-ban
    // opcionális), az üresre törölt viszont `null`, tehát a törlés továbbra is
    // működik.
    const storedCode = supplier?.worksheetPartnerCode ?? null;
    const nextCode = worksheetPartnerCode.trim() || null;
    const codeChanged = nextCode !== storedCode;

    try {
      if (supplier) {
        setSupplier(
          await suppliersApi.update(token, supplier.id, {
            ...payload,
            worksheetPartnerCode: codeChanged ? nextCode : undefined,
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

  /**
   * A KET MUVELET EGY HELYEN, mert ugyanaz a vegpont es ugyanaz a
   * hiba-kezeles. A kulonbseg csak a torzsben van, es a hivo mondja meg.
   */
  const applyUnitChange = async (
    unitId: string,
    input: { name?: string; isActive?: boolean },
  ) => {
    if (!supplier) return;
    setUnitError(null);
    setUnitBusy(true);
    try {
      const updated = await suppliersApi.updateUnit(
        token,
        supplier.id,
        unitId,
        input,
      );
      setUnits((current) =>
        current.map((unit) => (unit.id === updated.id ? updated : unit)),
      );
      setEditingUnitId(null);
    } catch (cause) {
      setUnitError(
        cause instanceof Error
          ? cause.message
          : "Az alegység módosítása nem sikerült.",
      );
    } finally {
      setUnitBusy(false);
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
        // Ures ertek = a fa legfelso szintje. A mezot NEM kuldjuk ki uresen:
        // a szerver a hianyt jelenti gyokernek, egy ures szoveg viszont
        // ismeretlen szulonek latszana.
        ...(newUnit.parentId ? { parentId: newUnit.parentId } : {}),
        code: newUnit.code.trim().toUpperCase(),
        name: newUnit.name.trim(),
      });
      setUnits((current) => [...current, created]);
      // A SZULO BENT MARAD, a kod es a nev urul: egy fat rendszerint egymas
      // utan tolt fel valaki ugyanazon a szinten, es a legyakoribb muvelet ne
      // keryen ujra ugyanazt a valasztast.
      setNewUnit((current) => ({
        parentId: current.parentId,
        code: "",
        name: "",
      }));
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
          {/* Only shown for a service partner: closing a worksheet requires the
              abbreviation, and a partner we only buy from never gets a
              worksheet. Not required, on purpose -- ticking "Szerviz" should
              not turn into "invent an abbreviation right now". The worksheet
              picker leaves partners without a code out instead, so the gap
              costs nothing until somebody wants a sheet. */}
          {isService ? (
            <div className="mt-4 sm:w-1/2">
              <FormField
                label="Partnerkód"
                description="A partner rövidítése, pontosan négy karakter, betűvel kezdve (például FANK). Munkalap csak akkor írható a partnernek, ha ez ki van töltve."
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
            number its first segment, and a partner we only buy from never
            gets a worksheet. */}
        {supplier && isService ? (
          <Card className="p-6">
            <h2 className="font-semibold">Alegységek</h2>
            <p className="mt-1 text-sm text-slate-500">
              Az alegység kódja a munkalapszám első tagja (például a BIO a
              BIO-2026-001 számban).
            </p>
            {unitError ? (
              <Alert variant="danger" title="Hiba" description={unitError} />
            ) : null}
            {unitRows.length ? (
              <ul className="mt-4 space-y-1 text-sm">
                {unitRows.map(({ unit, depth }) => (
                  <li
                    key={unit.id}
                    className="flex items-center gap-2"
                    // A behuzas a MELYSEGET mutatja. Stilus helyett szamolt
                    // ertek, mert a fa tetszoleges melysegu lehet, es egy
                    // elore megirt osztalylista a negyedik szinten elfogyna.
                    style={{ paddingLeft: `${depth * 1.25}rem` }}
                  >
                    <span className="font-mono text-xs text-slate-600">
                      {unit.code}
                    </span>
                    {editingUnitId === unit.id ? (
                      <>
                        <Input
                          aria-label="Alegység új neve"
                          value={unitDraftName}
                          onChange={(event) =>
                            setUnitDraftName(event.target.value)
                          }
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={unitBusy || !unitDraftName.trim()}
                          onClick={() =>
                            void applyUnitChange(unit.id, {
                              name: unitDraftName.trim(),
                            })
                          }
                        >
                          Mentés
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setEditingUnitId(null)}
                        >
                          Mégsem
                        </Button>
                      </>
                    ) : (
                      <>
                        {/* The name keeps an element of its own: beside the code a
                            bare text node merges with it, and a search for the
                            name alone stops matching. */}
                        <span>{unit.name}</span>
                        {/* AZ ARCHIVALT SOR NEM TUNIK EL A LISTABOL. A partner
                            adatlapja a TELJES fat mutatja: ha eltunne, a
                            gyerekei szulo nelkul maradnanak a kepernyon, es a
                            felhasznalo nem tudna visszaallitani sem. */}
                        {unit.isActive ? null : (
                          <span className="text-xs text-slate-500">
                            · archivált
                          </span>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          aria-label={`${unit.name} átnevezése`}
                          onClick={() => {
                            setEditingUnitId(unit.id);
                            setUnitDraftName(unit.name);
                          }}
                        >
                          Átnevezés
                        </Button>
                        {unit.isActive ? (
                          <Button
                            type="button"
                            variant="ghost"
                            aria-label={`${unit.name} archiválása`}
                            onClick={() => setPendingArchive(unit)}
                          >
                            Archiválás
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            aria-label={`${unit.name} visszaállítása`}
                            disabled={unitBusy}
                            onClick={() =>
                              void applyUnitChange(unit.id, { isActive: true })
                            }
                          >
                            Visszaállítás
                          </Button>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-slate-500">
                Ehhez a partnerhez még nincs alegység.
              </p>
            )}
            <div className="mt-4 grid gap-4 sm:grid-cols-[12rem_8rem_1fr_auto]">
              <FormField label="Hova kerül">
                {/* A gyoker az ELSO es alapertelmezett valasztas: a mai
                    helyszinek mind ilyenek, es egy uj partnernel is ez a
                    gyakori eset. */}
                <select
                  aria-label="Szülő helyszín"
                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                  value={newUnit.parentId}
                  onChange={(event) =>
                    setNewUnit((current) => ({
                      ...current,
                      parentId: event.target.value,
                    }))
                  }
                >
                  <option value="">Legfelső szint</option>
                  {unitRows.map(({ unit, depth }) => (
                    <option key={unit.id} value={unit.id}>
                      {`${"\u00a0".repeat(depth * 2)}${unit.code} - ${unit.name}`}
                    </option>
                  ))}
                </select>
              </FormField>
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
        {/*
          AZ ARCHIVALAS MEGERositO KERDEST KAP, ES EZT KIMONDOTTAN IRJUK MEG.
          A repo halója (`confirm-usage.component.test.ts`) a torlo-jellegu
          hivasokat a `method: "DELETE"` alapjan ismeri fel; ez PATCH, tehat a
          halo NEM kerdezne szamon, ha kimaradna. Az egyetlen, ami orzi, a
          hozza tartozo allitas ebben a mappaban.

          A kovetkezmeny nem "biztos vagy benne", hanem az, ami tenylegesen
          megszunik: uj munkalapot nem lehet ra nyitni. A visszaut pedig
          LETEZIK, es ki is van irva -- ez az a mezo, ami a fejlesztovel
          feltéteti a kerdest, hogy van-e egyaltalan.
        */}
        <ConfirmDialog
          open={pendingArchive !== null}
          title={
            pendingArchive
              ? `Archiválod ezt az alegységet: ${pendingArchive.name}?`
              : "Archiválod ezt az alegységet?"
          }
          consequence="Új munkalapot nem lehet rá nyitni, és a választókban nem jelenik meg. A már meglévő munkalapokon ott marad, ahol eddig is volt."
          recovery="Ugyanitt visszaállítható: az archivált sor a listában marad, Visszaállítás gombbal."
          confirmLabel="Alegység archiválása"
          busy={unitBusy}
          onConfirm={() => {
            const unit = pendingArchive;
            setPendingArchive(null);
            if (unit) void applyUnitChange(unit.id, { isActive: false });
          }}
          onCancel={() => setPendingArchive(null)}
        />
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
