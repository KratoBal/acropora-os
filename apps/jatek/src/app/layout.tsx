import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./theme.css";
import "./jatek.css";

export const metadata: Metadata = {
  title: {
    default: "Acropora nyereményjáték",
    template: "%s · Acropora nyereményjáték",
  },
  description: "Heti kérdés, heti sorsolás, karácsonyi fődíj.",
  // A teszten nem kell a keresobe; elesben a JATEK_INDEXABLE=true kapcsolja be.
  robots: { index: process.env.JATEK_INDEXABLE === "true" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="hu">
      <body>{children}</body>
    </html>
  );
}
