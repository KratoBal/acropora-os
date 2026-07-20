import type { SVGProps } from "react";

import { cn } from "./utils";

export type IconName =
  | "activity"
  | "aquarium"
  | "bell"
  | "box"
  | "briefcase"
  | "cart"
  | "chevron-down"
  | "clipboard"
  | "credit-card"
  | "dashboard"
  | "finance"
  | "key"
  | "menu"
  | "package"
  | "search"
  | "service"
  | "settings"
  | "store"
  | "users"
  | "warehouse";

export interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

export function Icon({ className, name, size = 18, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn("shrink-0", className)}
      {...props}
    >
      {name === "dashboard" && (
        <>
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </>
      )}
      {name === "clipboard" && (
        <>
          <rect x="5" y="4" width="14" height="17" rx="2" />
          <path d="M9 4.5V3h6v1.5M9 10h6M9 15h6" />
        </>
      )}
      {name === "store" && (
        <>
          <path d="M4 10v10h16V10M3 10l2-6h14l2 6" />
          <path d="M3 10c0 2 3 2 4.5 0 1.5 2 4.5 2 6 0 1.5 2 4.5 2 7.5 0M9 20v-6h6v6" />
        </>
      )}
      {name === "credit-card" && (
        <>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 10h18M7 15h3" />
        </>
      )}
      {(name === "package" || name === "box") && (
        <>
          <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
          <path d="m4 7.5 8 4.5 8-4.5M12 12v9" />
        </>
      )}
      {name === "users" && (
        <>
          <circle cx="9" cy="8" r="3" />
          <path d="M3.5 20v-2a5.5 5.5 0 0 1 11 0v2M16 5.5a3 3 0 0 1 0 5.8M17 14a5 5 0 0 1 3.5 4.8V20" />
        </>
      )}
      {name === "warehouse" && (
        <>
          <path d="m3 10 9-6 9 6v10H3V10Z" />
          <path d="M7 20v-7h10v7M7 16h10" />
        </>
      )}
      {name === "cart" && (
        <>
          <path d="M3 4h2l2 11h11l2-7H6" />
          <circle cx="9" cy="19" r="1.5" />
          <circle cx="17" cy="19" r="1.5" />
        </>
      )}
      {name === "finance" && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M15.5 8.5c-.8-1.1-5-.9-5 1.2 0 2.8 5.5 1.2 5.5 4.2 0 2.4-4.5 2.5-6 1M12.5 6v2M12.5 16v2" />
        </>
      )}
      {name === "service" && (
        <path d="M14 6a4 4 0 0 0-5.3 5.3L3 17l4 4 5.7-5.7A4 4 0 0 0 18 10l-2.5 2.5-4-4L14 6Z" />
      )}
      {name === "aquarium" && (
        <>
          <path d="M3 7h18v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7ZM3 11h18" />
          <path d="M8 15c2-2 4-2 6 0-2 2-4 2-6 0Zm6 0 2-2v4l-2-2Z" />
        </>
      )}
      {name === "briefcase" && (
        <>
          <rect x="3" y="7" width="18" height="13" rx="2" />
          <path d="M9 7V4h6v3M3 12h18M10 12v2h4v-2" />
        </>
      )}
      {name === "settings" && (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
        </>
      )}
      {name === "key" && (
        <>
          <circle cx="8" cy="15.5" r="3.5" />
          <path d="m10.5 13 8-8M15 8l2.5 2.5M12.5 10.5 15 13" />
        </>
      )}
      {name === "search" && (
        <>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-4-4" />
        </>
      )}
      {name === "bell" && (
        <>
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
        </>
      )}
      {name === "chevron-down" && <path d="m7 9 5 5 5-5" />}
      {name === "menu" && <path d="M4 7h16M4 12h16M4 17h16" />}
      {name === "activity" && <path d="M3 12h4l2-7 4 14 2-7h6" />}
    </svg>
  );
}
