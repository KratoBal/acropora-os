"use client";

import { personDisplayName, type AuthenticatedUser } from "@acropora/types";
import type { ReactNode } from "react";

import { ROLE_LABELS } from "./users/role-labels";

/**
 * THE COMPACT PROFILE OF THE SHELL, FROM THE LATEST "Messaging / Üzenetek"
 * FRAME (Figma 441:2): the sidebar's "Profile" (441:58) and the header's
 * "Header actions" (441:66). Display only: the user menu, logout and the
 * navigation keep their own components and behaviour.
 */

/** The same two letters `Avatar` draws, so the two never disagree. */
export function profileInitials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/**
 * 32px SQUARE MONOGRAM ("Messaging/Avatar", 441:59): soft aqua ground, aqua
 * text, 12px medium. `Avatar` from the kit is round and only comes in 28,
 * 36 and 44px, and its classes cannot be overridden reliably (`cn` joins,
 * it does not merge), so the frame is drawn here from the same tokens.
 */
export function ProfileMonogram({
  name,
  src,
}: {
  name: string;
  src?: string | null;
}) {
  return (
    <span
      aria-hidden="true"
      data-testid="profile-monogram"
      className="flex size-8 shrink-0 items-center justify-center overflow-hidden bg-pilot-aqua-50 text-xs font-medium leading-4 text-pilot-aqua-700"
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- user avatar URL
        <img className="size-full object-cover" src={src} alt="" />
      ) : (
        profileInitials(name)
      )}
    </span>
  );
}

/** The sidebar's foot: monogram, name, and the role on a quieter line. */
export function SidebarProfile({ user }: { user: AuthenticatedUser }) {
  const name = personDisplayName(user);
  return (
    <section
      aria-label="Bejelentkezett felhasználó"
      className="mt-4 border-t border-pilot-grey-200 pt-4"
    >
      <div className="flex items-center gap-2.5 px-2">
        <ProfileMonogram name={name} src={user.avatarUrl} />
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-sm font-semibold leading-5 text-pilot-grey-900"
            title={name}
          >
            {name}
          </p>
          <p className="truncate text-xs leading-4 text-pilot-grey-500">
            {ROLE_LABELS[user.role]}
          </p>
        </div>
      </div>
    </section>
  );
}

export interface HeaderMessagesProps {
  /** Where the icon leads: the Üzenetek module's page. */
  href: string;
  /**
   * The 16px glyph. Passed in rather than drawn here: the kit has no message
   * icon yet, and the frame's own asset (441:68) arrives with the module.
   */
  icon: ReactNode;
  unreadCount: number;
}

/**
 * THE PLACE OF THE ÜZENETEK ICON ("Notification icon", 441:67): a 32px
 * bordered square with a 14px warm badge over its top-right corner. The shell
 * renders it only when given `messages`, and nothing gives it yet: the module
 * does not exist, and an icon that leads nowhere is worse than none.
 */
export function HeaderMessages({
  href,
  icon,
  unreadCount,
}: HeaderMessagesProps) {
  const unread = unreadCount > 0;
  return (
    <a
      href={href}
      aria-label={unread ? `Üzenetek, ${unreadCount} olvasatlan` : "Üzenetek"}
      className="relative flex size-8 shrink-0 items-center justify-center border border-pilot-grey-200 bg-white text-pilot-grey-700 transition-colors hover:bg-pilot-grey-100"
    >
      {icon}
      {unread ? (
        <span
          aria-hidden="true"
          className="absolute -right-1.5 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center bg-pilot-accent-warm px-0.5 text-[8px] leading-none text-white"
        >
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      ) : null}
    </a>
  );
}
