import type { TextareaHTMLAttributes } from "react";

import { cn } from "./utils";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

/**
 * Multi-line counterpart of `Input`, sharing its border, focus ring and
 * disabled treatment. The web app grew several hand-rolled `<textarea>`
 * elements with three different sets of utility classes; new call sites
 * use this so the drift stops here.
 */
export function Textarea({ className, rows = 4, ...props }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      className={cn(
        "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500",
        className,
      )}
      {...props}
    />
  );
}
