"use client";

import {
  Alert,
  PilotBadge,
  PilotField,
  PilotFieldPair,
  PilotFormActions,
  PilotFormCard,
  PilotFormLayout,
  PilotInput,
  PilotPageHeader,
  PilotSelect,
} from "@acropora/ui";
import {
  hasPermission,
  isNavigationEntryVisible,
  PERMISSIONS,
} from "@acropora/types";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { allNavigationPages } from "@/components/navigation";
import { useReturnTo } from "@/components/navigation-history";
import {
  PilotBackLink,
  backLinkLabel,
} from "@/components/pilot/pilot-back-link";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import { PartnerPicker } from "@/components/service-jobs/partner-picker";
import { ApiError } from "@/lib/api/client";
import { usersApi } from "@/lib/api/users";

import { ROLE_LABELS, ROLE_OPTIONS } from "./role-labels";

/**
 * ÚJ FELHASZNÁLÓ A KÖZÖS ŰRLAP-VÁZON (Picasso 3.20, card f0b70dbd; acrobot 62858: 3.20-b in slices, this the first). The new
 * account has a page of its own on the pilot set; editing an existing account (its tabs) stays on `UserEditorPage` until the next
 * slices, because the pilot/dusk guard is per file.
 *
 * ONLY WHAT THE CREATE CALL STORES. `CreateUserInput` takes the names, the e-mail, the role, the password and the partner. The old
 * shared form also showed the nickname, the notification roles and the capabilities for a new account, and the create call dropped
 * them without a word. Here they are not asked; "what happens next" says where they are set: on the account's page after saving.
 *
 * THE PARTNER AND THE ROLE GO TOGETHER, as on the editor: picking a partner makes the role Partner szerviz and offers only that;
 * clearing it takes the role back to the narrowest (VIEWER), so no account is saved with a partner role and no partner (its scope
 * would be internal: every customer's rows).
 */
export function UserCreatePage() {
  const { session } = useAuth();
  const router = useRouter();
  const backToList = useReturnTo("/admin/users");
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] =
    useState<(typeof ROLE_OPTIONS)[number]["value"]>("VIEWER");
  const [customerId, setCustomerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.USERS_MANAGE),
  );
  if (!canManage)
    return (
      <Alert
        variant="danger"
        title="Nincs szerkesztési jogosultságod"
        description="A felhasználók kezeléséhez users.manage szükséges."
      />
    );

  const isPartnerAccount = Boolean(customerId);
  const roleOptions = isPartnerAccount
    ? ROLE_OPTIONS.filter((option) => option.value === "PARTNER_SERVICE")
    : ROLE_OPTIONS;
  const accessibleItems = allNavigationPages.filter((item) =>
    isNavigationEntryVisible(item.entryId, { role }),
  );
  const missing = [
    lastName.trim() ? null : "Vezetéknév",
    firstName.trim() ? null : "Keresztnév",
    email.trim() ? null : "E-mail cím",
    password.length >= 8 ? null : "Jelszó (legalább 8 karakter)",
  ].filter((part): part is string => part !== null);

  const submit = async () => {
    if (missing.length > 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await usersApi.create(session?.token ?? "", {
        firstName,
        lastName,
        email,
        role,
        password,
        customerId: customerId || null,
      });
      router.push(`/admin/users/${created.id}`);
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 409
          ? "Az e-mail cím már használatban van."
          : cause instanceof Error
            ? cause.message
            : "A mentés sikertelen.",
      );
      setBusy(false);
    }
  };

  return (
    <PilotThemeRoot className="space-y-6">
      <div>
        <PilotBackLink href={backToList.href}>
          {backLinkLabel(backToList, "Felhasználók")}
        </PilotBackLink>
        <PilotPageHeader
          title="Új felhasználó"
          description="Név, e-mail, jelszó és szerepkör alapú jogosultságok."
        />
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <PilotFormLayout
          top={
            error ? (
              <Alert
                variant="danger"
                title="A művelet nem sikerült"
                description={error}
              />
            ) : null
          }
          afterText="Mentés után megnyílik a felhasználó lapja: ott állítható a becenév, az értesítések, a képességek, a láthatóság és a személyes jogosultságok."
          actions={
            <PilotFormActions
              missing={missing}
              busy={busy}
              submitLabel="Felhasználó létrehozása"
              busyLabel="Létrehozás…"
              onCancel={() => router.push(backToList.href)}
              onSubmit={() => void submit()}
            />
          }
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
            <PilotField label="E-mail cím" requirement="required">
              <PilotInput
                type="email"
                aria-label="E-mail cím"
                value={email}
                onChange={setEmail}
              />
            </PilotField>
            <PilotField
              label="Jelszó"
              requirement="required"
              help="Legalább 8 karakter."
            >
              <PilotInput
                type="password"
                aria-label="Jelszó"
                value={password}
                onChange={setPassword}
              />
            </PilotField>
          </PilotFormCard>

          <PilotFormCard title="Szerepkör és hatókör">
            <PilotField
              label="Partnerhez kötött fiók"
              requirement="optional"
              help="Ettől függ, mit lát: egy vevőhöz kötött fiók csak annak a vevőnek a sorait látja. Partner nélkül a fiók saját kollégáé, és mindent lát. Egy fiók legfeljebb egy partnerhez tartozhat."
            >
              <PartnerPicker
                variant="pilot"
                id="uj-felhasznalo-vevo"
                value={customerId}
                emptyLabel="Nem partner: saját kolléga"
                onPick={(partner) => {
                  setCustomerId(partner.customerId);
                  setRole("PARTNER_SERVICE");
                }}
                onClear={() => {
                  setCustomerId("");
                  setRole("VIEWER");
                }}
              />
            </PilotField>
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
                {roleOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </PilotSelect>
            </PilotField>
          </PilotFormCard>

          <PilotFormCard title="Elérhető menüpontok">
            <p className="text-sm text-pilot-grey-600">
              A(z) {ROLE_LABELS[role]} szerepkör jelenleg ezekhez a
              menüpontokhoz biztosít hozzáférést.
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
        </PilotFormLayout>
      </form>
    </PilotThemeRoot>
  );
}
