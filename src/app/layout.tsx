import type { Metadata } from "next";
import Link from "next/link";
import { Inter, PT_Serif } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin", "cyrillic"] });
const serif = PT_Serif({ variable: "--font-display-serif", subsets: ["latin", "cyrillic"], weight: ["400", "700"] });

export const metadata: Metadata = {
  title: "Verdict",
  description: "ИИ-суд над маркетинговыми проектами",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru" className={`${inter.variable} ${serif.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        <header className="border-b border-wood-700 bg-wood-900/80 print:hidden">
          <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
            <Link href="/" aria-label="Verdict — на главную">
              {/* eslint-disable-next-line @next/next/no-img-element -- статичный логотип, оптимизация не нужна */}
              <img src="/assets/brand/logo.webp" alt="Verdict" className="h-9 w-auto" />
            </Link>
            <div className="ml-auto flex gap-4 text-sm text-parchment/70">
              <Link href="/" className="hover:text-brass-300">
                Зал суда
              </Link>
              <Link href="/cases" className="hover:text-brass-300">
                Архив
              </Link>
              <Link href="/settings" className="hover:text-brass-300">
                Настройки
              </Link>
            </div>
          </nav>
        </header>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
