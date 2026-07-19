import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "./utils";

export interface StatCardProps extends HTMLAttributes<HTMLElement> {
  label: string;
  value: string;
  change?: string;
  changeLabel?: string;
  icon?: ReactNode;
  trend?: "up" | "down" | "neutral";
}

export function StatCard({
  change,
  changeLabel,
  className,
  icon,
  label,
  trend = "neutral",
  value,
  ...props
}: StatCardProps) {
  return (
    <article
      className={cn(
        "rounded-xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]",
        className,
      )}
      {...props}
    >
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        {icon ? (
          <span className="flex size-8 items-center justify-center rounded-lg bg-slate-50 text-slate-500">
            {icon}
          </span>
        ) : null}
      </div>
      <p className="mt-3 text-2xl font-bold tracking-tight text-slate-950">
        {value}
      </p>
      {change ? (
        <p className="mt-2 text-xs text-slate-400">
          <span
            className={cn(
              "font-semibold",
              trend === "up" && "text-emerald-600",
              trend === "down" && "text-rose-600",
              trend === "neutral" && "text-slate-600",
            )}
          >
            {change}
          </span>{" "}
          {changeLabel}
        </p>
      ) : null}
    </article>
  );
}
