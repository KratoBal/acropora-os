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
import { hasPermission, PERMISSIONS, type UserDetail } from "@acropora/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import {
  businessNavigation,
  primaryNavigation,
  settingsNavigation,
} from "@/components/navigation";
import { ApiError } from "@/lib/api/client";
import { usersApi } from "@/lib/api/users";
import { ROLE_LABELS, ROLE_OPTIONS } from "./role-labels";

const allNavigationItems = [
  ...primaryNavigation,
  ...businessNavigation,
  ...settingsNavigation,
];

export function UserEditorPage({ userId }: { userId?: string }) {
  const { session } = useAuth();
  const router = useRouter();
  const [user, setUser] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(Boolean(userId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof ROLE_OPTIONS)[number]["value"]>(
    "VIEWER",
  );
  const [password, setPassword] = useState("");
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
      setFirstName(next.firstName);
      setLastName(next.lastName);
      setEmail(next.email);
      setRole(next.role);
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
            email,
            role,
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
      setPasswordNotice("A jelszónak legalább 8 karakter hosszúnak kell lennie.");
      return;
    }
    setPasswordBusy(true);
    setPasswordNotice(null);
    try {
      setUser(await usersApi.setPassword(token, user.id, { password: newPassword }));
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
    hasPermission(role, item.permission),
  );
  return (
    <div className="space-y-6">
      <PageHeader
        title={user ? `${user.lastName} ${user.firstName}` : "Új felhasználó"}
        description="Név, e-mail, jelszó és szerepkör alapú jogosultságok."
        actions={
          <Link href="/admin/users">
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
                onChange={(event) =>
                  setRole(event.target.value as typeof role)
                }
              >
                {ROLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
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
              <span className="text-xs text-slate-500">
                {user.hasPassword
                  ? "Jelszó beállítva"
                  : "Nincs beállított jelszó"}
              </span>
            </div>
          ) : null}
        </Card>
        <Card className="p-6">
          <h2 className="font-semibold">Elérhető menüpontok</h2>
          <p className="mt-1 text-sm text-slate-500">
            A(z) {ROLE_LABELS[role]} szerepkör jelenleg ezekhez a
            menüpontokhoz biztosít hozzáférést.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {accessibleItems.length ? (
              accessibleItems.map((item) => (
                <Badge key={item.href}>{item.label}</Badge>
              ))
            ) : (
              <span className="text-sm text-slate-500">
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
      {user ? (
        <>
          <Card className="p-6">
            <h2 className="font-semibold">Jelszó módosítása</h2>
            <p className="mt-1 text-sm text-slate-500">
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
              <p className="mt-2 text-sm text-slate-500">{passwordNotice}</p>
            ) : null}
          </Card>
          <Card className="p-6">
            <h2 className="font-semibold">Audit</h2>
            <p className="mt-2 text-sm text-slate-500">
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
                isSelf
                  ? "Saját magadat nem tudod inaktiválni."
                  : undefined
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
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
