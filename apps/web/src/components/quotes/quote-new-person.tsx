"use client";

import { Alert, PilotButton, PilotFormField, PilotInput } from "@acropora/ui";
import { CUSTOMER_LIST_PAGE_SIZE, type CustomerSummary } from "@acropora/types";
import { useState } from "react";

import { customersApi } from "@/lib/api/customers";

import { errorText } from "./quote-format";

// the same loose shape the API's @IsEmail gate starts from: something@something.tld, no spaces
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const sameEmail = (a: string | undefined, b: string) =>
  Boolean(a) && a!.trim().toLowerCase() === b;

/**
 * ÚJ MAGÁNSZEMÉLY AZ AJÁNLATON (Luca kérése, kártya 7dd76d60). Csak a név kötelező: az e-mail és a telefon
 * opcionális, hogy az ajánlat elküldhető legyen, de a címet nem kérjük. Egy vevőtörzs van: ez a meglévő
 * `POST /customers` végpontot hívja PERSON típussal, nincs új tábla.
 *
 * A DUPLIKÁTUM-ELLENŐRZÉS: e-mail megadásakor előbb megkeresi, van-e már ilyen e-mail című vevő, és ha van, azt
 * ajánlja fel (nem hoz létre másodikat). Az ellenőrzés HIBÁJA megállítja a létrehozást: egy sikertelen keresés
 * nem "nincs duplikátum". A szerveroldali keresés az általános e-mailre illeszt (a számlázási e-mailre nem),
 * a kliens a kettőre is ellenőriz a visszakapott soron.
 */
export function QuoteNewPerson({
  token,
  onCreated,
  onCancel,
}: {
  token: string;
  /** the customer to quote for: the new one, or the existing one the e-mail matched */
  onCreated: (customer: CustomerSummary) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [existing, setExisting] = useState<CustomerSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedEmail = email.trim();
  const emailInvalid = trimmedEmail !== "" && !EMAIL_SHAPE.test(trimmedEmail);
  const ready = name.trim() !== "" && !emailInvalid;

  const edit = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    // an offered match belongs to the e-mail it was found for
    setExisting(null);
    setError(null);
  };

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      if (trimmedEmail) {
        const wanted = trimmedEmail.toLowerCase();
        let found: CustomerSummary | undefined;
        try {
          const response = await customersApi.list(
            token,
            new URLSearchParams({
              search: trimmedEmail,
              status: "ALL",
              page: "1",
              pageSize: String(CUSTOMER_LIST_PAGE_SIZE.min),
              includePartnerMirrors: "true",
            }),
          );
          found = response.items.find(
            (item) =>
              sameEmail(item.email, wanted) ||
              sameEmail(item.billingEmail, wanted),
          );
        } catch (cause) {
          // a failed check is not "no duplicate": nothing is created
          setError(
            errorText(
              cause,
              "Nem sikerült ellenőrizni, van-e már ilyen e-mail című vevő.",
            ),
          );
          return;
        }
        if (found) {
          setExisting(found);
          return;
        }
      }
      const created = await customersApi.create(token, {
        type: "PERSON",
        displayName: name.trim(),
        ...(trimmedEmail ? { email: trimmedEmail } : {}),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        addresses: [],
      });
      onCreated(created);
    } catch (cause) {
      setError(errorText(cause, "A magánszemély nem hozható létre."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="group"
      aria-label="Új magánszemély"
      className="space-y-3 rounded-lg border border-pilot-grey-200 p-3"
    >
      <p className="text-sm text-pilot-grey-600">
        Csak a név kötelező. Az e-mail nélkül létrejön a vevő, de az ajánlat nem
        küldhető el neki, amíg nincs e-mail címe.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <PilotFormField label="Név" required htmlFor="uj-magansz-nev">
          <PilotInput
            id="uj-magansz-nev"
            aria-label="Név"
            value={name}
            onChange={edit(setName)}
            autoFocus
          />
        </PilotFormField>
        <PilotFormField label="E-mail cím" htmlFor="uj-magansz-email">
          <PilotInput
            id="uj-magansz-email"
            aria-label="E-mail cím"
            type="email"
            value={email}
            aria-invalid={emailInvalid}
            onChange={edit(setEmail)}
          />
        </PilotFormField>
        <PilotFormField label="Telefonszám" htmlFor="uj-magansz-telefon">
          <PilotInput
            id="uj-magansz-telefon"
            aria-label="Telefonszám"
            value={phone}
            onChange={edit(setPhone)}
          />
        </PilotFormField>
      </div>
      {emailInvalid ? (
        <p role="alert" className="text-sm text-pilot-red-700">
          Az e-mail cím formátuma nem megfelelő.
        </p>
      ) : null}
      {error ? (
        <Alert variant="danger" title="Hiba történt" description={error} />
      ) : null}
      {existing ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-pilot-grey-200 bg-pilot-grey-50 px-3 py-2 text-sm"
        >
          <span>
            Már van ilyen e-mail című vevő:{" "}
            <span className="font-semibold">{existing.displayName}</span>
          </span>
          <PilotButton onClick={() => onCreated(existing)}>
            Ezt választom
          </PilotButton>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <PilotButton
          disabled={!ready || busy}
          title={ready ? undefined : "A név kötelező."}
          onClick={() => void submit()}
        >
          Magánszemély felvétele
        </PilotButton>
        <PilotButton variant="secondary" onClick={onCancel}>
          Mégse
        </PilotButton>
      </div>
    </div>
  );
}
