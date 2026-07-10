import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MOP — Mimirhead Operations Platform",
  description: "Внутренняя операционная платформа студии",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">
        {children}
      </body>
    </html>
  );
}
