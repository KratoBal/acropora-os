"use client";

import {
  Avatar,
  Badge,
  Button,
  Icon,
  type ThemePreference,
} from "@acropora/ui";
import { isNavigationEntryVisible, personDisplayName } from "@acropora/types";
import { useState } from "react";

import { ProfileMonogram } from "../shell-profile";
import { useAuth } from "./auth-provider";

const themeOptions: { label: string; value: ThemePreference }[] = [
  { label: "Világos", value: "light" },
  { label: "Sötét", value: "dark" },
  { label: "Rendszer szerint", value: "system" },
];

export function UserMenu({
  onPreferenceChange,
  preference,
}: {
  onPreferenceChange: (preference: ThemePreference) => void;
  preference: ThemePreference;
}) {
  const { logout, session } = useAuth();
  const [open, setOpen] = useState(false);

  if (!session) return null;
  const { user } = session;
  const canOpenSettings = isNavigationEntryVisible(
    "settings-general",
    user.role,
  );

  return (
    <div className="relative">
      {/*
        ONE COMPACT LINE (Figma "Header user", 441:72): the name, 14px semi
        bold, with no avatar block beside it. Below `sm` the name has no room,
        so the monogram stands in as the trigger.
      */}
      <Button
        variant="ghost"
        className="h-8 gap-2 rounded-none px-2 text-left font-normal hover:bg-pilot-grey-100"
        aria-label="Felhasználói menü"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="sm:hidden">
          <ProfileMonogram
            name={personDisplayName(user)}
            src={user.avatarUrl}
          />
        </span>
        <span
          className="hidden max-w-[240px] truncate text-sm font-semibold leading-5 text-pilot-grey-900 sm:block"
          title={personDisplayName(user)}
        >
          {personDisplayName(user)}
        </span>
      </Button>

      {open ? (
        <div className="absolute right-0 top-10 z-50 w-72 rounded-2xl border border-pilot-grey-200 bg-white p-3 shadow-xl">
          <div className="flex items-start gap-3 border-b border-pilot-grey-200 px-1 pb-3">
            <Avatar
              name={personDisplayName(user)}
              src={user.avatarUrl ?? undefined}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-pilot-grey-900">
                {personDisplayName(user)}
              </p>
              <p className="truncate text-xs text-pilot-grey-500">
                {user.email}
              </p>
              <Badge className="mt-2" variant="info">
                {user.role}
              </Badge>
            </div>
          </div>

          {canOpenSettings ? (
            <a
              href="/beallitasok"
              className="mt-2 flex h-10 items-center gap-2 rounded-xl px-2 text-sm font-medium text-pilot-grey-700 hover:bg-pilot-grey-100"
              onClick={() => setOpen(false)}
            >
              <Icon name="settings" size={16} />
              Beállítások
            </a>
          ) : null}

          <fieldset className="mt-2 border-t border-pilot-grey-200 px-1 pt-3">
            <legend className="text-xs font-semibold text-pilot-grey-700">
              Megjelenés
            </legend>
            <div className="mt-2 space-y-1">
              {themeOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={preference === option.value}
                  className={[
                    "flex h-9 w-full items-center rounded-lg px-2 text-left text-sm transition-colors",
                    preference === option.value
                      ? "bg-pilot-aqua-50 font-medium text-pilot-aqua-800"
                      : "text-pilot-grey-600 hover:bg-pilot-grey-100",
                  ].join(" ")}
                  onClick={() => onPreferenceChange(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>

          <Button
            variant="ghost"
            className="mt-3 w-full justify-start rounded-xl text-rose-600 hover:bg-rose-50 hover:text-rose-700"
            onClick={() => void logout()}
          >
            Kijelentkezés
          </Button>
        </div>
      ) : null}
    </div>
  );
}
