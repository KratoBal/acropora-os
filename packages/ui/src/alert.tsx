import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "./utils";

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: string;
  action?: ReactNode;
  variant?: "info" | "danger";
}

export function Alert({
  action,
  className,
  description,
  title,
  variant = "info",
  ...props
}: AlertProps) {
  return (
    <div
      role={variant === "danger" ? "alert" : "status"}
      className={cn(
        "flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
        variant === "danger"
          ? "border-rose-200 bg-rose-50 text-rose-900"
          : "border-sky-200 bg-sky-50 text-sky-900",
        className,
      )}
      {...props}
    >
      <div>
        <p className="text-sm font-semibold">{title}</p>
        {description ? (
          <p className="mt-0.5 text-sm opacity-75">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
