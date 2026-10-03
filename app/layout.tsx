import type { Metadata, Viewport } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";

import { Footer } from "@/components/layout/Footer";
import { FloatingWhatsAppButton } from "@/components/layout/FloatingWhatsAppButton";
import { Navbar } from "@/components/layout/Navbar";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/constants";

import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — Premium Dental Clinic`,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "dental clinic",
    "dentist",
    "dental care",
    "teeth cleaning",
    "root canal",
    "dental implants",
    "teeth whitening",
    "braces and aligners",
  ],
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: SITE_NAME,
    title: `${SITE_NAME} — Premium Dental Clinic`,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
  },
  twitter: {
    card: "summary",
    title: `${SITE_NAME} — Premium Dental Clinic`,
    description: SITE_DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#0F766E",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${jakarta.variable} ${inter.variable} h-full scroll-smooth`}
    >
      <body className="flex min-h-full flex-col bg-surface text-ink antialiased">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
        >
          Skip to main content
        </a>

        <Navbar />

        <main id="main-content" className="flex-1">
          {children}
        </main>

        <Footer />
        <FloatingWhatsAppButton />

        <noscript>
          <style>{`.reveal { opacity: 1 !important; transform: none !important; }`}</style>
        </noscript>
      </body>
    </html>
  );
}
