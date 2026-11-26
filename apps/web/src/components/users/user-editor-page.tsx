"use client";
import {
  PilotBackLink,
  backLinkLabel,
} from "@/components/pilot/pilot-back-link";
import {
  Alert,
  PilotBadge,
  PilotButton,
  PilotCard,
  PilotField,
  PilotFieldPair,
  PilotFormCard,
  PilotInput,
  PilotPageHeader,
  PilotSelect,
  ServiceListTabs,
  Skeleton,
} from "@acropora/ui";
import {
  hasPermission,
  isAttendanceEmployeeRole,
  isNavigationEntryVisible,
  PERMISSIONS,
  type UserDetail,
  NOTIFICATION_ROLES,
  type NotificationRoleValue,
  SERVICE_CAPABILITIES,
  type ServiceCapabilityValue,
} from "@acropora/types";
import { type FormEvent, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { useReturnTo } from "@/components/navigation-history";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import { allNavigationPages } from "@/components/navigation";
import { ApiError } from "@/lib/api/client";
import { usersApi } from "@/lib/api/users";
import { PartnerPicker } from "@/components/service-jobs/partner-picker";
import { ROLE_LABELS, ROLE_OPTIONS } from "./role-labels";
import { UserPermissionTable } from "./user-permission-table";
import { UserAttendanceSchedule } from "./user-attendance-schedule";
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

/**
 * A KÖTELEZŐ ÉS A NEM KÖTELEZŐ MEZŐ JELÖLÉSE (Picasso 3.20): ugyanaz a két jel, mint a Bérlés, az új hibajegy és a munkalap űrlapján: a kötelező mező címkéje után piros csillag (a felolvasónak
 * "kötelező"), a nem kötelezőé után szürkén "(nem kötelező)". A név és az e-mail kötelezősége a szerver szabálya (CreateUserDto); az új fiók jelszava a kliens saját szabálya (legalább 8 karakter, lásd a mentést), a szerver DTO-ban a jelszó nem kötelező. Ez a felirat csak kimondja őket.
 */
type UserTab = "adatok" | "jogok" | "munkarend" | "biztonsag";

/**
 * A MEGLÉVŐ FELHASZNÁLÓ SZERKESZTŐJE, A PILOT KÉSZLETEN (Picasso 3.20, card f0b70dbd; acrobot 62858, 3.20-b slice 2). The new account
 * has its own page since slice 1 (`UserCreatePage`, `/admin/users/new`): this one always edits a loaded account, so its new-account
 * branch (the create call, the password field among the basics, the "Felhasználó létrehozása" button) is gone. The four tabs, their one
 * save each, the notification and capability rules and the partner-role coupling are unchanged; the sections other files draw (the
 * visible units, the permission table, the schedule) keep their own look.
 */
export function UserEditorPage({ userId }: { userId: string }) {
  const { session } = useAuth();
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
  /**
   * GÉPI / FLOTTA FIÓK JELÖLŐ (card b2e74712, acrobot 2026-11-25). A jelölt fiók nem osztható felelősnek (munkalap, hibajegy, üzemeltetési
   * napló), és nem kap ticket@ levélfogadást. Eddig csak adatbázis-úton volt állítható; az admin itt állítja, a mentés auditnaplóba megy.
   */
  const [isServiceAccount, setIsServiceAccount] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<UserTab>("adatok");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [nickname, setNickname] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] =
    useState<(typeof ROLE_OPTIONS)[number]["value"]>("VIEWER");
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
      setIsServiceAccount(next.isServiceAccount);
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
    if (!user) return;
    if (!firstName.trim() || !lastName.trim()) {
      setError("A vezetéknév és a keresztnév kötelező.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
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
          // a partner-fiók nem lehet gépi fiók: a jelölő csak a saját kollégánál kapcsolható, partnernél hamis marad
          isServiceAccount: customerId === "" ? isServiceAccount : false,
          expectedUpdatedAt: user.updatedAt,
        }),
      );
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 409
          ? "Az e-mail cím már használatban van, vagy az adat időközben megváltozott."
          : cause instanceof Error
            ? cause.message
            : "A mentés sikertelen.",
      );
      if (cause instanceof ApiError && cause.status === 409) await load();
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
  // a kiválasztott SZEREP sablonja (az előnézet); a személyes eltérések a
  // felhasználónkénti táblázattal kerülnek ide
  const accessibleItems = allNavigationItems.filter((item) =>
    isNavigationEntryVisible(item.entryId, { role }),
  );
  const isPartnerAccount = Boolean(customerId);
  const availableRoleOptions = isPartnerAccount
    ? ROLE_OPTIONS.filter((option) => option.value === "PARTNER_SERVICE")
    : ROLE_OPTIONS;
  // a Munkarend fül ott áll, ahol a szakasz meg is jelenne (UserAttendanceSchedule: jelenléti jog és saját kolléga szerepe)
  const showScheduleTab = Boolean(
    user &&
    session &&
    hasPermission(session.user, PERMISSIONS.ATTENDANCE_MANAGE) &&
    isAttendanceEmployeeRole(user.role),
  );
  const tabs: { key: UserTab; label: string }[] = [
    { key: "adatok", label: "Adatok" },
    { key: "jogok", label: "Jogosultságok" },
    ...(showScheduleTab
      ? [{ key: "munkarend" as const, label: "Munkarend" }]
      : []),
    { key: "biztonsag", label: "Biztonság" },
  ];
  /** Egy fül tartalma: csak az aktív látszik. */
  const panel = (key: UserTab) => ({
    role: "tabpanel" as const,
    "aria-label": tabs.find((t) => t.key === key)?.label,
    hidden: tab !== key,
  });
  // a load failed: no form to fill, only the reason
  if (!user)
    return (
      <PilotThemeRoot className="space-y-6">
        <PilotBackLink href={backToList.href}>
          {backLinkLabel(backToList, "Felhasználók")}
        </PilotBackLink>
        <Alert
          variant="danger"
          title="A felhasználó nem tölthető be"
          description={error ?? "A felhasználó nem található."}
        />
      </PilotThemeRoot>
    );
  return (
    <PilotThemeRoot className="space-y-6">
      <div>
        <PilotBackLink href={backToList.href}>
          {backLinkLabel(backToList, "Felhasználók")}
        </PilotBackLink>
        <PilotPageHeader
          // név nélküli (gépi, smoke) fióknál a cím üres h1 volt: a megjelenő név, végül az e-mail áll a helyén (a 3.23 utáni stage-kép)
          title={
            `${user.lastName} ${user.firstName}`.trim() ||
            user.displayName ||
            user.email
          }
          description="Név, e-mail, jelszó és szerepkör alapú jogosultságok."
        />
      </div>
      {error ? (
        <Alert
          variant="danger"
          title="A művelet nem sikerült"
          description={error}
        />
      ) : null}
      <ServiceListTabs
        variant="pill"
        label="A felhasználó lapjai"
        tabs={tabs}
        active={tab}
        onSelect={(key) => setTab(key as UserTab)}
      />
      <form
        className="max-w-[760px] space-y-6"
        onSubmit={submit}
        {...panel("adatok")}
      >
        <PilotFormCard title="Alapadatok">
          <PilotFieldPair>
            <PilotField label="Vezetéknév" requirement="required">
              <PilotInput
                aria-label="Vezetéknév"
                value={lastName}
                onChange={setLastName}
              />
            </PilotField>
            <PilotField label="Keresztnév" requirement="required">
              <PilotInput
                aria-label="Keresztnév"
                value={firstName}
                onChange={setFirstName}
              />
            </PilotField>
          </PilotFieldPair>
          <PilotFieldPair>
            <PilotField label="Becenév" requirement="optional">
              <PilotInput
                aria-label="Becenév"
                value={nickname}
                placeholder="Ahogy a csapatban szólítjuk"
                onChange={setNickname}
              />
            </PilotField>
            <PilotField label="E-mail cím" requirement="required">
              <PilotInput
                type="email"
                aria-label="E-mail cím"
                value={email}
                onChange={setEmail}
              />
            </PilotField>
          </PilotFieldPair>
          <PilotField
            label="Szerepkör"
            requirement="optional"
            help={
              isPartnerAccount
                ? "A partnerhez kötött fiók szerepe szándékosan csak Partner szerviz lehet: a saját hatókörében hibajegyeket, munkalapokat és eszközöket kezelhet, de nem kap belső irányítópult-, feladat-, partner- vagy akvárium-hozzáférést."
                : undefined
            }
          >
            <PilotSelect
              aria-label="Szerepkör"
              value={role}
              onChange={(value) => setRole(value as typeof role)}
              chevron
            >
              {availableRoleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </PilotSelect>
          </PilotField>
          {/*
            A PARTNER-KOTES: ez a mezo nem a felhasznalo egy tulajdonsaga, mint a beceneve: ez HATOKORT AD. Aki kap egy vevot, az annak a
            vevonek a sorait latja, es CSAK azokat; aki elveszti, az BELSOSSE valik es MINDENT lat. A magyarazo mondat ezert all mellette.
          */}
          <PilotField
            label="Partnerhez kötött fiók"
            requirement="optional"
            help="Ha itt egy partnert választasz, a fiók csak annak a partnernek az adatait látja. Üresen a fiók saját kolléga. Egy fiók legfeljebb egy partnerhez tartozhat."
          >
            <PartnerPicker
              variant="pilot"
              id="felhasznalo-vevo"
              value={customerId}
              emptyLabel="Nem partner: saját kolléga"
              onPick={(partner) => {
                setCustomerId(partner.customerId);
                setRole("PARTNER_SERVICE");
              }}
              /**
               * A TORLES A SZEREPET IS VISSZAVESZI -- KULONBEN A FIOK KOTES NELKULI PARTNER-SZEREPET KAPNA (2026-09-17): egy
               * `PARTNER_SERVICE` szerepu, kotes nelkuli fiok hatokore belsos lenne (a `partnerScopeOf` kotes hianyaban `internal`-t ad),
               * vagyis MINDEN vevo szerviz-sorat latna. A `VIEWER` a legszukebb szerep; a valaszto ilyenkor ujra a TELJES listat kinalja.
               */
              onClear={() => {
                setCustomerId("");
                setRole("VIEWER");
              }}
            />
          </PilotField>
          {/*
            AZ ERTESITESI SZEREPEK -- CSAK SAJAT KOLLEGANAL (Balazs, 2026-09-22): a hibajegy-felelos a MI oldalunk szerepe; egy partner-fioknal
            bejelolve a vevo ertesitest kapna MINDEN masik vevo bejelenteserol. A lista a kozos csomagbol jon (`NOTIFICATION_ROLES`).
          */}
          {customerId === "" ? (
            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold text-pilot-grey-800">
                Értesítések
              </legend>
              {NOTIFICATION_ROLES.map((szerep) => (
                <label key={szerep.value} className="flex items-start gap-3">
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
                    <span className="block text-sm font-medium text-pilot-grey-900">
                      {szerep.label}
                    </span>
                    <span className="block text-xs text-pilot-grey-600">
                      {szerep.description}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          ) : null}
          {/*
            A KEPESSEGEK -- KULON SZAKASZ, a fiok-fajtahoz illo kepessegekkel (Balazs 2026-09-22: ket fuggetlen jelolo; 2026-09-25-tol a
            partner-fiokra valo kepesseg is itt all, lasd `service-capabilities.ts` `audience` mezojet).
          */}
          {(() => {
            const kepessegek = SERVICE_CAPABILITIES.filter(
              (kepesseg) =>
                kepesseg.audience ===
                (customerId === "" ? "internal" : "partner"),
            );
            if (kepessegek.length === 0) return null;
            return (
              <fieldset className="space-y-3">
                <legend className="text-sm font-semibold text-pilot-grey-800">
                  Képességek
                </legend>
                {kepessegek.map((kepesseg) => (
                  <label
                    key={kepesseg.value}
                    className="flex items-start gap-3"
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
                      <span className="block text-sm font-medium text-pilot-grey-900">
                        {kepesseg.label}
                      </span>
                      <span className="block text-xs text-pilot-grey-600">
                        {kepesseg.description}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
            );
          })()}
          {/* the marker is only for an internal account (a partner account is never a machine) */}
          {customerId === "" ? (
            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold text-pilot-grey-800">
                Gépi fiók
              </legend>
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={isServiceAccount}
                  onChange={(event) =>
                    setIsServiceAccount(event.target.checked)
                  }
                />
                <span>
                  <span className="block text-sm font-medium text-pilot-grey-900">
                    Gépi / flotta fiók, nem ember
                  </span>
                  <span className="block text-xs text-pilot-grey-600">
                    Nem osztható ki felelősnek (munkalap, hibajegy, üzemeltetési
                    napló), és nem kap ticket@ levélfogadást. A már rá kiosztott
                    munka megmarad.
                  </span>
                </span>
              </label>
            </fieldset>
          ) : null}
          <div className="flex items-center gap-2">
            <PilotBadge variant={user.isActive ? "success" : "grey"}>
              {user.isActive ? "Aktív" : "Inaktív"}
            </PilotBadge>
            <span className="text-xs text-pilot-grey-600">
              {user.hasPassword
                ? "Jelszó beállítva"
                : "Nincs beállított jelszó"}
            </span>
          </div>
        </PilotFormCard>
        <PilotFormCard title="Elérhető menüpontok">
          <p className="text-sm text-pilot-grey-600">
            A(z) {ROLE_LABELS[role]} szerepkör jelenleg ezekhez a menüpontokhoz
            biztosít hozzáférést.
          </p>
          <div className="flex flex-wrap gap-2">
            {accessibleItems.length ? (
              accessibleItems.map((item) => (
                <PilotBadge key={item.href}>{item.label}</PilotBadge>
              ))
            ) : (
              <span className="text-sm text-pilot-grey-600">
                Ehhez a szerepkörhöz nincs elérhető menüpont.
              </span>
            )}
          </div>
        </PilotFormCard>
        <div className="flex justify-end">
          <PilotButton type="submit" disabled={busy}>
            {busy ? "Mentés…" : "Változások mentése"}
          </PilotButton>
        </div>
      </form>
      <div className="space-y-6" {...panel("jogok")}>
        <UserVisibleUnits
          userId={user.id}
          role={user.role}
          /* A KET KOTES KIZARJA EGYMAST (`User_at_most_one_partner_check`), tehat ez harom allapot, nem negy. */
          binding={
            user.customerId
              ? "customer"
              : user.supplierId
                ? "supplier"
                : "internal"
          }
        />
        {/*
          A FELHASZNÁLÓNKÉNTI JOGOK: a táblázat saját mentéssel megy, a fenti űrlaptól függetlenül: a szerepkör változtatása után a táblázat
          az ÚJ sablonhoz méri az eltéréseket, ezért előbb azt kell menteni.
        */}
        <UserPermissionTable
          key={`${user.id}:${user.role}`}
          userId={user.id}
          customerId={user.customerId}
          supplierId={user.supplierId ?? null}
        />
      </div>
      {showScheduleTab ? (
        <div className="space-y-6" {...panel("munkarend")}>
          {/* THE WEEKLY SCHEDULE (os-jelenleti-iv, S1b): the section hides itself without attendance.manage or for a partner or machine account. */}
          <UserAttendanceSchedule userId={user.id} role={user.role} />
        </div>
      ) : null}
      <div className="max-w-[760px] space-y-6" {...panel("biztonsag")}>
        <PilotFormCard title="Jelszó módosítása">
          <p className="text-sm text-pilot-grey-600">
            A jelenlegi jelszó nem jeleníthető meg. Az admin új jelszót állíthat
            be a felhasználónak.
          </p>
          <div className="flex gap-2">
            <PilotInput
              type="password"
              aria-label="Új jelszó"
              value={newPassword}
              onChange={setNewPassword}
              placeholder="Legalább 8 karakter"
            />
            <PilotButton
              disabled={passwordBusy || newPassword.length < 8}
              onClick={() => void submitPassword()}
            >
              {passwordBusy ? "Mentés…" : "Jelszó mentése"}
            </PilotButton>
          </div>
          {passwordNotice ? (
            <p className="text-sm text-pilot-grey-600">{passwordNotice}</p>
          ) : null}
        </PilotFormCard>
        <PilotFormCard title="Audit">
          <p className="text-sm text-pilot-grey-600">
            Létrehozva: {new Date(user.createdAt).toLocaleString("hu-HU")} ·
            Frissítve: {new Date(user.updatedAt).toLocaleString("hu-HU")}
            {user.passwordUpdatedAt
              ? ` · Jelszó frissítve: ${new Date(user.passwordUpdatedAt).toLocaleString("hu-HU")}`
              : ""}
          </p>
          <div>
            <PilotButton
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
            </PilotButton>
          </div>
        </PilotFormCard>
      </div>
      {confirmDeactivate ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="deactivate-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-pilot-grey-900/40 p-4"
        >
          <PilotCard className="max-w-lg p-6">
            <h2
              id="deactivate-title"
              className="font-semibold text-pilot-grey-900"
            >
              Felhasználó inaktiválása
            </h2>
            <p className="mt-2 text-sm text-pilot-grey-800">
              Az inaktivált felhasználó nem tud bejelentkezni, de a korábbi
              tevékenységei (audit, rendelések, mozgások) megmaradnak.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <PilotButton
                variant="secondary"
                onClick={() => setConfirmDeactivate(false)}
              >
                Mégse
              </PilotButton>
              <PilotButton
                variant="danger"
                disabled={busy}
                onClick={() => void toggleActive()}
              >
                Inaktiválás megerősítése
              </PilotButton>
            </div>
          </PilotCard>
        </div>
      ) : null}
    </PilotThemeRoot>
  );
}
