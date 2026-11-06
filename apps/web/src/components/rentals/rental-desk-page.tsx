"use client";

import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  Input,
  PageHeader,
  Select,
  Textarea,
} from "@acropora/ui";
import {
  formatMoney,
  hasPermission,
  PERMISSIONS,
  RENTAL_LIMITS,
  type Rental,
  type RentalCustomerSummary,
  type RentalEquipment,
} from "@acropora/types";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { rentalsApi } from "@/lib/api/rentals";
import { formatDateTimeHu } from "@/lib/format/date";

import {
  emptyRentalForm,
  rentalPreview,
  rentalRequest,
  type RentalForm,
} from "./rental-form";

/**
 * THE RENTAL DESK (task eszkozberles, S2; Balázs, 2026-11-06): the devices out now, and a new rental. The renter goes into the
 * existing customer register; while the desk types the name, phone or e-mail, matching customers are offered, so a returning
 * renter is not written twice.
 */
export function RentalDeskPage({
  now = () => new Date(),
}: {
  now?: () => Date;
}) {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canRecord = Boolean(
    session && hasPermission(session.user, PERMISSIONS.RENTALS_MANAGE),
  );

  const [open, setOpen] = useState<Rental[]>([]);
  const [equipment, setEquipment] = useState<RentalEquipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState<RentalForm>(() => emptyRentalForm(now()));
  const [customer, setCustomer] = useState<RentalCustomerSummary | null>(null);
  const [matches, setMatches] = useState<RentalCustomerSummary[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      try {
        const [rentals, available] = await Promise.all([
          rentalsApi.list(token, "OPEN", signal),
          canRecord
            ? rentalsApi.availableEquipment(token, signal)
            : Promise.resolve({ items: [] }),
        ]);
        setOpen(rentals.items);
        setEquipment(available.items);
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setError(
          cause instanceof Error
            ? cause.message
            : "A bérlések nem tölthetők be.",
        );
      } finally {
        setLoading(false);
      }
    },
    [token, canRecord],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // the matching customers, a moment after the desk stops typing
  useEffect(() => {
    if (!canRecord || customer) return;
    const query = { name: form.name, phone: form.phone, email: form.email };
    if (Object.values(query).every((value) => value.trim().length < 3)) {
      setMatches([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      rentalsApi
        .customerMatches(token, query, controller.signal)
        .then((response) => setMatches(response.items))
        .catch(() => setMatches([]));
    }, 300);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [canRecord, customer, form.name, form.phone, form.email, token]);

  const chosen = equipment.find((item) => item.id === form.equipmentId);
  const preview = useMemo(() => rentalPreview(form, chosen), [form, chosen]);

  const set = (key: keyof RentalForm) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const chooseEquipment = (id: string) => {
    const item = equipment.find((candidate) => candidate.id === id);
    setForm((current) => ({
      ...current,
      equipmentId: id,
      depositHuf: item ? String(item.depositHuf) : "",
    }));
  };

  const save = async () => {
    const request = rentalRequest(form, customer);
    if (!request.ok) {
      setError(request.error);
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const rental = await rentalsApi.create(token, request.input);
      setNotice(
        `Bérlés rögzítve: ${rental.rentalNumber} (${rental.equipment.name}, ${rental.customer.displayName}).`,
      );
      setForm(emptyRentalForm(now()));
      setCustomer(null);
      setMatches([]);
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A bérlés nem rögzíthető.",
      );
    } finally {
      setSaving(false);
    }
  };

  const field = (
    key: keyof RentalForm,
    label: string,
    options: { type?: string; inputMode?: "numeric" | "tel" | "email" } = {},
  ) => (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-dusk-700">{label}</span>
      <Input
        aria-label={label}
        type={options.type}
        inputMode={options.inputMode}
        value={form[key]}
        onChange={(event) => set(key)(event.target.value)}
      />
    </label>
  );

  const overdue = (rental: Rental) =>
    new Date(rental.plannedReturnAt).getTime() < now().getTime();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bérlés"
        description="A kint lévő eszközök és az új bérlés rögzítése. A bérlő a vevőtörzsbe kerül; ha már szerepel, a rendszer felajánlja."
      />

      {error ? (
        <Alert variant="danger" title="Hiba" description={error} />
      ) : null}
      {notice ? (
        <Alert variant="info" title="Kész" description={notice} />
      ) : null}

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-dusk-900">
            Kint lévő eszközök
          </h2>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-dusk-500">Betöltés…</p>
          ) : open.length === 0 ? (
            <p className="text-sm text-dusk-500">Most nincs kiadott eszköz.</p>
          ) : (
            <ul className="divide-y">
              {open.map((rental) => (
                <li key={rental.id} className="space-y-1 py-3 text-sm">
                  <p className="font-medium text-dusk-900">
                    {rental.rentalNumber} · {rental.equipment.name}
                    {rental.equipment.serialNumber
                      ? ` (${rental.equipment.serialNumber})`
                      : ""}
                  </p>
                  <p className="text-dusk-700">
                    {rental.customer.displayName}
                    {rental.customer.phone ? ` · ${rental.customer.phone}` : ""}
                  </p>
                  <p
                    className={
                      overdue(rental)
                        ? "font-medium text-red-700"
                        : "text-dusk-500"
                    }
                  >
                    Kint: {formatDateTimeHu(rental.startsAt)} · vissza:{" "}
                    {formatDateTimeHu(rental.plannedReturnAt)}
                    {overdue(rental) ? " · lejárt" : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {canRecord ? (
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-dusk-900">Új bérlés</h2>
          </CardHeader>
          <CardContent className="space-y-5">
            <label className="block space-y-1">
              <span className="text-sm font-medium text-dusk-700">Eszköz</span>
              <Select
                aria-label="Eszköz"
                value={form.equipmentId}
                onChange={(event) => chooseEquipment(event.target.value)}
              >
                <option value="">Válassz…</option>
                {equipment.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {item.serialNumber ? ` (${item.serialNumber})` : ""} ·{" "}
                    {formatMoney(item.dailyFeeHuf, "HUF")}/nap
                  </option>
                ))}
              </Select>
              {!loading && equipment.length === 0 ? (
                <span className="text-sm text-dusk-500">
                  Nincs kiadható eszköz: mind kint van, vagy még nincs felvéve a
                  Beállításokban.
                </span>
              ) : null}
            </label>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-dusk-900">Bérlő</h3>
              {customer ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dusk-200 p-3 text-sm">
                  <div>
                    <p className="font-medium text-dusk-900">
                      {customer.displayName} ({customer.customerNumber})
                    </p>
                    <p className="text-dusk-600">
                      {[customer.phone, customer.email, customer.address]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <Button variant="secondary" onClick={() => setCustomer(null)}>
                    Másik bérlő
                  </Button>
                </div>
              ) : (
                <>
                  <label className="block space-y-1">
                    <span className="text-sm font-medium text-dusk-700">
                      Típus
                    </span>
                    <Select
                      aria-label="Bérlő típusa"
                      value={form.customerType}
                      onChange={(event) =>
                        set("customerType")(event.target.value)
                      }
                    >
                      <option value="PERSON">Magánszemély</option>
                      <option value="COMPANY">Cég</option>
                    </Select>
                  </label>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    {field("name", "Név")}
                    {field("phone", "Telefon", {
                      type: "tel",
                      inputMode: "tel",
                    })}
                    {field("email", "E-mail", {
                      type: "email",
                      inputMode: "email",
                    })}
                    {field("postalCode", "Irányítószám", {
                      inputMode: "numeric",
                    })}
                    {field("city", "Város")}
                    {field("line1", "Utca, házszám")}
                  </div>
                  {matches.length > 0 ? (
                    <div className="space-y-2 rounded-lg border border-dusk-200 p-3">
                      <p className="text-sm font-medium text-dusk-800">
                        Már szerepel a vevőtörzsben?
                      </p>
                      <ul className="space-y-2">
                        {matches.map((match) => (
                          <li
                            key={match.id}
                            className="flex flex-wrap items-center justify-between gap-3 text-sm"
                          >
                            <span className="text-dusk-700">
                              {match.displayName} ·{" "}
                              {[match.phone, match.email, match.address]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                            <Button
                              variant="secondary"
                              onClick={() => {
                                setCustomer(match);
                                setMatches([]);
                              }}
                            >
                              Ezt választom
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {field("startsAt", "Kezdés", { type: "datetime-local" })}
              {field("plannedReturnAt", "Tervezett visszahozás", {
                type: "datetime-local",
              })}
              {field("depositHuf", "Kaució (Ft)", { inputMode: "numeric" })}
            </div>
            <p className="text-sm text-dusk-700">
              Várható díj:{" "}
              {preview && chosen
                ? `${preview.periods} × ${formatMoney(chosen.dailyFeeHuf, "HUF")} = ${formatMoney(preview.feeHuf, "HUF")}`
                : "válassz eszközt és érvényes időszakot"}
            </p>
            <label className="block space-y-1">
              <span className="text-sm font-medium text-dusk-700">
                Megjegyzés
              </span>
              <Textarea
                aria-label="Megjegyzés"
                value={form.note}
                maxLength={RENTAL_LIMITS.note.max}
                onChange={(event) => set("note")(event.target.value)}
              />
            </label>
            <Button disabled={saving} onClick={() => void save()}>
              {saving ? "Rögzítés…" : "Bérlés rögzítése"}
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
