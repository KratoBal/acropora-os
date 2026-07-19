import type { HTMLAttributes } from "react";

import { cn } from "./utils";

export interface AvatarProps extends HTMLAttributes<HTMLSpanElement> {
  name: string;
  src?: string;
  size?: "sm" | "md" | "lg";
}

const sizes = {
  sm: "size-7 text-[10px]",
  md: "size-9 text-xs",
  lg: "size-11 text-sm",
};

export function Avatar({
  className,
  name,
  src,
  size = "md",
  ...props
}: AvatarProps) {
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-teal-100 font-bold text-teal-800 ring-1 ring-white",
        sizes[size],
        className,
      )}
      aria-label={name}
      {...props}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- UI package is framework agnostic.
        <img className="size-full object-cover" src={src} alt={name} />
      ) : (
        initials
      )}
    </span>
  );
}
