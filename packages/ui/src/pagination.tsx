import type { HTMLAttributes } from "react";

import { Button } from "./button";
import { cn } from "./utils";

export interface PaginationProps extends HTMLAttributes<HTMLElement> {
  page: number;
  totalPages: number;
  onPageChange(page: number): void;
}

export function Pagination({
  className,
  onPageChange,
  page,
  totalPages,
  ...props
}: PaginationProps) {
  const safeTotal = Math.max(1, totalPages);
  return (
    <nav
      aria-label="Lapozás"
      className={cn("flex items-center gap-3", className)}
      {...props}
    >
      <Button
        variant="secondary"
        size="sm"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        Előző
      </Button>
      <span className="min-w-24 text-center text-sm text-slate-600">
        {page}. / {safeTotal} oldal
      </span>
      <Button
        variant="secondary"
        size="sm"
        disabled={page >= safeTotal}
        onClick={() => onPageChange(page + 1)}
      >
        Következő
      </Button>
    </nav>
  );
}
