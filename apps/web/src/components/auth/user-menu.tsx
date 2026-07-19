"use client";

import { Avatar, Badge, Button, Card, Icon } from "@acropora/ui";
import { useState } from "react";

import { useAuth } from "./auth-provider";

export function UserMenu() {
  const { logout, session } = useAuth();
  const [open, setOpen] = useState(false);

  if (!session) return null;
  const { user } = session;

  return (
    <div className="relative">
      <Button
        variant="ghost"
        className="ml-1 h-auto gap-2 p-1.5 text-left font-normal"
        aria-label="Felhasználói menü"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Avatar
          name={user.displayName}
          src={user.avatarUrl ?? undefined}
          size="sm"
        />
        <span className="hidden sm:block">
          <span className="block text-xs font-semibold text-slate-800">
            {user.displayName}
          </span>
          <span className="block text-[10px] text-slate-400">{user.role}</span>
        </span>
        <Icon
          name="chevron-down"
          size={14}
          className="hidden text-slate-400 sm:block"
        />
      </Button>

      {open ? (
        <Card className="absolute right-0 top-12 z-50 w-72 p-3 shadow-xl">
          <div className="flex items-start gap-3 border-b border-slate-100 px-1 pb-3">
            <Avatar name={user.displayName} src={user.avatarUrl ?? undefined} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900">
                {user.displayName}
              </p>
              <p className="truncate text-xs text-slate-500">{user.email}</p>
              <Badge className="mt-2" variant="info">
                {user.role}
              </Badge>
            </div>
          </div>
          <Button
            variant="ghost"
            className="mt-2 w-full justify-start text-rose-600 hover:bg-rose-50 hover:text-rose-700"
            onClick={() => void logout()}
          >
            Kijelentkezés
          </Button>
        </Card>
      ) : null}
    </div>
  );
}
