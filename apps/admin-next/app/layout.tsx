import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Programmatic SEO Admin",
  description: "Next.js admin UI for NestJS SEO backend",
  icons: {
    icon: "/icon.svg",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <div className="shell">
          <aside className="sidebar">
            <Link href="/" className="brand">
              <span className="brand-mark">P</span>
              <span><b>SEO Admin</b><small>NestJS + Next</small></span>
            </Link>
            <nav className="nav">
              <Link href="/">대시보드</Link>
              <Link href="/jobs">작업 큐</Link>
            </nav>
            <div className="side-note">
              <b>백엔드</b>
              <code>{process.env.SEO_API_BASE_URL ?? "http://127.0.0.1:8765"}</code>
            </div>
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
