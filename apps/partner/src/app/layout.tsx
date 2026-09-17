import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AuthProvider } from "@/components/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Acropora Szerviz", template: "%s · Acropora Szerviz" },
  description: "Partneri hibajegy-kezelő felület",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="hu">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
