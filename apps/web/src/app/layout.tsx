import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";

import "./globals.css";

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: {
    default: "Acropora OS",
    template: "%s · Acropora OS",
  },
  description: "Magyar nyelvű vállalatirányítási rendszer",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="hu">
      <body className={inter.variable}>{children}</body>
    </html>
  );
}
