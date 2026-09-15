import type { HTMLAttributes } from "react";

import { cn } from "./utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        // A PROTOTIPUS PANELJE LAPOS: keret tartja, nem arnyek. A korabbi 3%-os
        // arnyek egy MASIK semleges szinbol keszult (a Tailwind hideg
        // dusk-950-ebol, kezzel beirva), tehat a rampa atallitasat nem is
        // kovette volna -- egy arnyek, ami mashonnan szarmazik, mint a keret.
        "rounded-xl border border-line bg-white",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 border-b border-line px-5 py-4",
        className,
      )}
      {...props}
    />
  );
}

export function CardContent({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5", className)} {...props} />;
}
