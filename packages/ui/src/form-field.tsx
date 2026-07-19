import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "./utils";

export interface FormFieldProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  htmlFor?: string;
  description?: string;
  error?: string;
  children: ReactNode;
}

export function FormField({
  children,
  className,
  description,
  error,
  htmlFor,
  label,
  ...props
}: FormFieldProps) {
  return (
    <div className={cn("space-y-1.5", className)} {...props}>
      <label
        htmlFor={htmlFor}
        className="block text-sm font-semibold text-slate-800"
      >
        {label}
      </label>
      {description ? (
        <p className="text-xs text-slate-500">{description}</p>
      ) : null}
      {children}
      {error ? (
        <p className="text-xs font-medium text-rose-600">{error}</p>
      ) : null}
    </div>
  );
}
