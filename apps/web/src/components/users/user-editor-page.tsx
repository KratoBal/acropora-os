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
  isNavigationEntryVisible,
  PERMISSIONS,
  type UserDetail,
  NOTIFICATION_ROLES,
  type NotificationRoleValue,
  SERVICE_CAPABILITIES,
  type ServiceCapabilityValue,
} from "@acropora/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { useReturnTo } from "@/components/navigation-history";
import { allNavigationPages } from "@/components/navigation";
import { ApiError } from "@/lib/api/client";
import { usersApi } from "@/lib/api/users";
import { PartnerPicker } from "@/components/service-jobs/partner-picker";
import { ROLE_LABELS, ROLE_OPTIONS } from "./role-labels";
import { UserVisibleUnits } from "./user-visible-units";

/**
 * UGYANAZ A HAT LISTA, AMIT AZ APP-SHELL OSSZEFUZ, ES UGYANABBAN A SORRENDBEN.
 *
 * KORABBAN MAS OT LISTA ALLT ITT, ES EL IS CSUSZOTT (merve 2026-09-02): a
 * `serviceNavigation` kulon is szerepelt, holott a `businessNavigation` mar
 * tartalmazza a Szerviz csoport gyermekeikent -- tehat a Munkalapok es az
 * Eszkoznyilvantartas KETSZER jelent meg --, a `contentNavigation` viszont
 * kimaradt, tehat a Tartalom oldal SEHOL nem latszott ebben az elonezetben.
 * Az elonezet, ami arra valaszol, hogy "mely oldalakat eri el ez a szerep",
 * harom ponton mondott mast, mint a valodi menu.
 *
 * A csoport-fejlec nem oldal, ezert a lista ki van bontva.
 */
const allNavigationItems = allNavigationPages;

export function UserEditorPage({ userId }: { userId?: string }) {
  const { session } = useAuth();
  const router = useRouter();
  const backToList = useReturnTo("/admin/users");
  const [user, setUser] = useState<UserDetail | null>(null);
  /**
   * AZ ERTESITESI SZEREPEK, HALMAZKENT.
   *
   * A szerver TELJES halmazt var (aki nincs rajta, lekerul), tehat a lap is
   * azt tartja: a jelolonegyzet be- es kikapcsolasa ugyanazt a tombot mozgatja.
   */
  const [notificationRoles, setNotificationRoles] = useState<
    NotificationRoleValue[]
  >([]);
  /**
   * A PARJA, KULON ALLAPOTBAN -- ugyanaz az alak, mint az ertesitesi
   * szerepeknel, de SZANDEKOSAN KULON tomb: a szerver ket kulon
   * kapcsolotablat visel (`ki ertesul` kontra `ki vegezheti el`), es Balazs
   * kifejezetten fuggetlennek kerte oket (2026-09-22 20:28:56 UTC).
   */
  const [serviceCapabilities, setServiceCapabilities] = useState<
    ServiceCapabilityValue[]
  >([]);
  const [loading, setLoading] = useState(Boolean(userId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [nickname, setNickname] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] =
    useState<(typeof ROLE_OPTIONS)[number]["value"]>("VIEWER");
  const [password, setPassword] = useState("");
  /**
   * MELYIK VEVO NEVEBEN LEP BE EZ A FIOK. Ures sztring = sajat kollega.
   *
   * A `null` es az ures sztring kozotti kulonbseget a MENTES forditja le: a
   * szerver `null` erteket var a kotes megszuntetesehez, az urlap viszont
   * sztringgel dolgozik, mint a tobbi mezo.
   */
  const [customerId, setCustomerId] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordNotice, setPasswordNotice] = useState<string | null>(null);
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.USERS_MANAGE),
  );
  const token = session?.token ?? "";
  const isSelf = session?.user.id === user?.id;
  const load = async () => {
    if (!userId || !session) return;
    setLoading(true);
    try {
      const next = await usersApi.detail(token, userId);
      setUser(next);
      setNotificationRoles(next.notificationRoles);
      setServiceCapabilities(next.serviceCapabilities);
      setFirstName(next.firstName);
      setLastName(next.lastName);
      setNickname(next.nickname ?? "");
      setEmail(next.email);
      // Egy korábbi, tág szereppel létrehozott partner-fiók sem kaphatja meg
      // újra azt a szerepet a szerkesztőből. A mentés továbbra is tudatos
      // művelet; itt csak azt akadályozzuk meg, hogy az érvénytelen érték
      // néma, üres választóként jelenjen meg.
      setRole(next.customerId ? "PARTNER_SERVICE" : next.role);
      setCustomerId(next.customerId ?? "");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A felhasználó nem tölthető be.",
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [userId, token]);
  if (!canManage)
    return (
      <Alert
        variant="danger"
        title="Nincs szerkesztési jogosultságod"
        description="A felhasználók kezeléséhez users.manage szükséges."
      />
    );
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!firstName.trim() || !lastName.trim()) {
      setError("A vezetéknév és a keresztnév kötelező.");
      return;
    }
    if (!user && (!password || password.length < 8)) {
      setError("A jelszónak legalább 8 karakter hosszúnak kell lennie.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (user)
        setUser(
          await usersApi.update(token, user.id, {
            firstName,
            lastName,
            nickname,
            email,
            role,
            /**
             * AZ URES MEZO `null`-KENT MEGY, NEM URES SZTRINGKENT. A szerver a
             * `null` erteket olvassa a kotes megszunteteselnek; egy ures
             * sztring egy nem letezo vevo azonositoja lenne, es a mentes
             * "a megadott vevo nem talalhato" hibaval allna meg -- olyan
             * hibaval, amit a felhasznalo nem tud ertelmezni, mert nem is
             * valasztott vevot.
             */
            customerId: customerId || null,
            notificationRoles,
            serviceCapabilities,
            expectedUpdatedAt: user.updatedAt,
          }),
        );
      else {
        const created = await usersApi.create(token, {
          firstName,
          lastName,
          email,
          role,
          password: password || undefined,
          customerId: customerId || null,
        });
        router.push(`/admin/users/${created.id}`);
      }
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 409
          ? "Az e-mail cím már használatban van, vagy az adat időközben megváltozott."
          : cause instanceof Error
            ? cause.message
            : "A mentés sikertelen.",
      );
      if (cause instanceof ApiError && cause.status === 409 && userId)
        await load();
    } finally {
      setBusy(false);
    }
  };
  const submitPassword = async () => {
    if (!user || newPassword.length < 8) {
      setPasswordNotice(
        "A jelszónak legalább 8 karakter hosszúnak kell lennie.",
      );
      return;
    }
    setPasswordBusy(true);
    setPasswordNotice(null);
    try {
      setUser(
        await usersApi.setPassword(token, user.id, { password: newPassword }),
      );
      setNewPassword("");
      setPasswordNotice("A jelszó frissítve.");
    } catch (cause) {
      setPasswordNotice(
        cause instanceof Error ? cause.message : "A jelszó nem menthető.",
      );
    } finally {
      setPasswordBusy(false);
    }
  };
  const toggleActive = async () => {
    if (!user) return;
    setBusy(true);
    try {
      setUser(
        user.isActive
          ? await usersApi.deactivate(token, user.id)
          : await usersApi.activate(token, user.id),
      );
      setConfirmDeactivate(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Az állapot nem módosítható.",
      );
    } finally {
      setBusy(false);
    }
  };
  if (loading)
    return (
      <div aria-label="Felhasználó betöltése">
        <Skeleton className="h-96" />
      </div>
    );
  const accessibleItems = allNavigationItems.filter((item) =>
    isNavigationEntryVisible(item.entryId, role),
  );
  const isPartnerAccount = Boolean(customerId);
  const availableRoleOptions = isPartnerAccount
    ? ROLE_OPTIONS.filter((option) => option.value === "PARTNER_SERVICE")
    : ROLE_OPTIONS;
  return (
    <div className="space-y-6">
      <PageHeader
        title={user ? `${user.lastName} ${user.firstName}` : "Új felhasználó"}
        description="Név, e-mail, jelszó és szerepkör alapú jogosultságok."
        actions={
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
      <form className="space-y-6" onSubmit={submit}>
        <Card className="p-6">
          <h2 className="font-semibold">Alapadatok</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <FormField label="Vezetéknév">
              <Input
                aria-label="Vezetéknév"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
              />
            </FormField>
            <FormField label="Keresztnév">
              <Input
                aria-label="Keresztnév"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
              />
            </FormField>
            <FormField label="Becenév">
              <Input
                aria-label="Becenév"
                value={nickname}
                placeholder="Ahogy a csapatban szólítjuk"
                onChange={(event) => setNickname(event.target.value)}
              />
            </FormField>
            <FormField label="E-mail cím">
              <Input
                type="email"
                aria-label="E-mail cím"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </FormField>
            <FormField label="Szerepkör">
              <Select
                aria-label="Szerepkör"
                value={role}
                onChange={(event) => setRole(event.target.value as typeof role)}
              >
                {availableRoleOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </FormField>
            {isPartnerAccount ? (
              <p className="text-xs text-dusk-500 sm:col-span-2">
                A partnerhez kötött fiók szerepe szándékosan csak Partner
                szerviz lehet: a saját hatókörében hibajegyeket, munkalapokat és
                eszközöket kezelhet, de nem kap belső irányítópult-, feladat-,
                partner- vagy akvárium-hozzáférést.
              </p>
            ) : null}
          </div>
          {/*
            A PARTNER-KOTES KULON SORBAN, A TOBBI MEZO ALATT -- ES EZ NEM
            ELRENDEZES.

            Ez a mezo nem a felhasznalo egy tulajdonsaga, mint a beceneve: ez
            HATOKORT AD. Aki kap egy vevot, az annak a vevonek a sorait latja,
            es CSAK azokat; aki elveszti, az BELSOSSE valik es MINDENT lat. A
            magyarazo mondat ezert all mellette, nem a sugoban.
          */}
          <div className="mt-4">
            <FormField label="Vevő nevében lép be">
              <PartnerPicker
                id="felhasznalo-vevo"
                value={customerId}
                emptyLabel="Nem partner: saját kolléga"
                onPick={(partner) => {
                  setCustomerId(partner.customerId);
                  setRole("PARTNER_SERVICE");
                }}
                /**
                 * A TORLES A SZEREPET IS VISSZAVESZI -- KULONBEN A FIOK
                 * KOTES NELKULI PARTNER-SZEREPET KAPNA.
                 *
                 * Az `onPick` beallitja a szerepet; a `onClear` 2026-09-17-ig
                 * CSAK a vevot vette vissza. Aki valasztott egy partnert,
                 * aztan meggondolta magat, `PARTNER_SERVICE` szerepu, kotes
                 * nelkuli fiokot mentett -- annak pedig a HATOKORE belsos
                 * lenne (a `partnerScopeOf` kotes hianyaban `internal`-t ad),
                 * vagyis MINDEN vevo szerviz-sorat latna.
                 *
                 * A `VIEWER` ugyanaz, amivel egy UJ fiok indul: a legszukebb
                 * szerep. Nem talalgatunk helyette, es nem hagyunk ott egy
                 * olyan szerepet, amihez mar nincs partner -- a valaszto
                 * ilyenkor ujra a TELJES listat kinalja, tehat a szerep
                 * tudatos valasztas marad.
                 */
                onClear={() => {
                  setCustomerId("");
                  setRole("VIEWER");
                }}
              />
            </FormField>
            <p className="pt-1 text-xs text-dusk-500">
              Ettől függ, mit lát: egy vevőhöz kötött fiók csak annak a vevőnek
              a sorait látja. Partner nélkül a fiók saját kollégáé, és mindent
              lát. Egy fiók legfeljebb egy partnerhez tartozhat.
            </p>
          </div>
          {/*
            AZ ERTESITESI SZEREPEK -- CSAK SAJAT KOLLEGANAL.

            Balazs kerese, 2026-09-22: „a sajat felhasznaloinkhoz kell egy
            checkbox ezzel a szereppel".

            A VEVOHOZ KOTOTT FIOKNAL EL SEM JELENIK MEG, es ez nem dísz: a
            hibajegy-felelos a MI oldalunk szerepe. Egy partner-fioknal
            bejelolve azt jelentene, hogy a vevo ertesitest kap MINDEN masik
            vevo bejelenteserol.

            A LISTA A KOZOS CSOMAGBOL JON (`NOTIFICATION_ROLES`), a felirattal
            egyutt: ugyanaz a nev kell a jelolonegyzet melle es barmely kesobbi
            olvasohoz.
          */}
          {customerId === "" ? (
            <>
              <div className="mt-6">
                <h2 className="text-sm font-semibold text-dusk-800">
                  Értesítések
                </h2>
                {NOTIFICATION_ROLES.map((szerep) => (
                  <label
                    key={szerep.value}
                    className="mt-3 flex items-start gap-3"
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={notificationRoles.includes(szerep.value)}
                      onChange={(event) =>
                        setNotificationRoles((mostani) =>
                          event.target.checked
                            ? [...new Set([...mostani, szerep.value])]
                            : mostani.filter((elem) => elem !== szerep.value),
                        )
                      }
                    />
                    <span>
                      <span className="block text-sm font-medium text-dusk-800">
                        {szerep.label}
                      </span>
                      <span className="block text-xs text-dusk-500">
                        {szerep.description}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              {/*
                A KEPESSEGEK -- KULON SZAKASZ, NEM AZ ERTESITESEK BOVITESE.

                Balazs kifejezetten KET FUGGETLEN jelolot kert (2026-09-22
                20:28:56 UTC, "Nem. Ket kulon jelolo legyen"): ugyanaz az
                ember lehet mindkettő, csak egyik sem, vagy barmelyik egyedul.
                Egy kozos lista ezt a fuggetlenseget nem tudna kifejezni.

                UGYANAZ A HATAR, MINT AZ ERTESITESEKNEL: csak sajat
                kollеganal, ugyanazert az okert (a `customerId === ""` ag).
              */}
              <div className="mt-6">
                <h2 className="text-sm font-semibold text-dusk-800">
                  Képességek
                </h2>
                {SERVICE_CAPABILITIES.map((kepesseg) => (
                  <label
                    key={kepesseg.value}
                    className="mt-3 flex items-start gap-3"
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={serviceCapabilities.includes(kepesseg.value)}
                      onChange={(event) =>
                        setServiceCapabilities((mostani) =>
                          event.target.checked
                            ? [...new Set([...mostani, kepesseg.value])]
                            : mostani.filter((elem) => elem !== kepesseg.value),
                        )
                      }
                    />
                    <span>
                      <span className="block text-sm font-medium text-dusk-800">
                        {kepesseg.label}
                      </span>
                      <span className="block text-xs text-dusk-500">
                        {kepesseg.description}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </>
          ) : null}
          {!user ? (
            <div className="mt-4">
              <FormField label="Jelszó">
                <Input
                  type="password"
                  aria-label="Jelszó"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Legalább 8 karakter"
                />
              </FormField>
            </div>
          ) : null}
          {user ? (
            <div className="mt-4 flex items-center gap-2">
              <Badge variant={user.isActive ? "success" : "neutral"}>
                {user.isActive ? "Aktív" : "Inaktív"}
              </Badge>
              <span className="text-xs text-dusk-500">
                {user.hasPassword
                  ? "Jelszó beállítva"
                  : "Nincs beállított jelszó"}
              </span>
            </div>
          ) : null}
        </Card>
        <Card className="p-6">
          <h2 className="font-semibold">Elérhető menüpontok</h2>
          <p className="mt-1 text-sm text-dusk-500">
            A(z) {ROLE_LABELS[role]} szerepkör jelenleg ezekhez a menüpontokhoz
            biztosít hozzáférést.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {accessibleItems.length ? (
              accessibleItems.map((item) => (
                <Badge key={item.href}>{item.label}</Badge>
              ))
            ) : (
              <span className="text-sm text-dusk-500">
                Ehhez a szerepkörhöz nincs elérhető menüpont.
              </span>
            )}
          </div>
        </Card>
        <div className="flex justify-end">
          <Button type="submit" disabled={busy}>
            {busy ? "Mentés…" : "Változások mentése"}
          </Button>
        </div>
      </form>
      {/*
        A LATHATOSAGI SZAKASZ CSAK MEGLEVO FELHASZNALONAL ALL, es ez nem
        szepseghiba: a hozzarendeles a fiok AZONOSITOJAHOZ kotodik, ami a
        felvitel elott meg nem letezik.
      */}
      {user ? (
        <UserVisibleUnits
          userId={user.id}
          role={user.role}
          /* A KET KOTES KIZARJA EGYMAST (`User_at_most_one_partner_check`),
             tehat ez harom allapot, nem negy. */
          binding={
            user.customerId
              ? "customer"
              : user.supplierId
                ? "supplier"
                : "internal"
          }
        />
      ) : null}
      {user ? (
        <>
          <Card className="p-6">
            <h2 className="font-semibold">Jelszó módosítása</h2>
            <p className="mt-1 text-sm text-dusk-500">
              A jelenlegi jelszó nem jeleníthető meg. Az admin új jelszót
              állíthat be a felhasználónak.
            </p>
            <div className="mt-4 flex gap-2">
              <Input
                type="password"
                aria-label="Új jelszó"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder="Legalább 8 karakter"
              />
              <Button
                type="button"
                disabled={passwordBusy || newPassword.length < 8}
                onClick={() => void submitPassword()}
              >
                {passwordBusy ? "Mentés…" : "Jelszó mentése"}
              </Button>
            </div>
            {passwordNotice ? (
              <p className="mt-2 text-sm text-dusk-500">{passwordNotice}</p>
            ) : null}
          </Card>
          <Card className="p-6">
            <h2 className="font-semibold">Audit</h2>
            <p className="mt-2 text-sm text-dusk-500">
              Létrehozva: {new Date(user.createdAt).toLocaleString("hu-HU")} ·
              Frissítve: {new Date(user.updatedAt).toLocaleString("hu-HU")}
              {user.passwordUpdatedAt
                ? ` · Jelszó frissítve: ${new Date(user.passwordUpdatedAt).toLocaleString("hu-HU")}`
                : ""}
            </p>
            <Button
              className="mt-4"
              variant={user.isActive ? "danger" : "secondary"}
              disabled={isSelf}
              title={
                isSelf ? "Saját magadat nem tudod inaktiválni." : undefined
              }
              onClick={() =>
                user.isActive ? setConfirmDeactivate(true) : void toggleActive()
              }
            >
              {user.isActive ? "Inaktiválás" : "Aktiválás"}
            </Button>
          </Card>
        </>
      ) : null}
      {confirmDeactivate ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="deactivate-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-dusk-950/40 p-4"
        >
          <Card className="max-w-lg p-6">
            <h2 id="deactivate-title" className="font-semibold">
              Felhasználó inaktiválása
            </h2>
            <p className="mt-2 text-sm">
              Az inaktivált felhasználó nem tud bejelentkezni, de a korábbi
              tevékenységei (audit, rendelések, mozgások) megmaradnak.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setConfirmDeactivate(false)}
              >
                Mégse
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => void toggleActive()}
              >
                Inaktiválás megerősítése
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
