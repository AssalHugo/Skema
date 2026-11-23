import type { Metadata, Viewport } from "next";
import { PwaProvider } from "./pwa-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Skema",
  description: "Révise tes cours en capsules verticales de 60 secondes.",
  applicationName: "Skema",
  appleWebApp: { capable: true, title: "Skema", statusBarStyle: "black-translucent" },
  icons: { apple: "/icons/apple-touch-icon.png" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <PwaProvider>{children}</PwaProvider>
      </body>
    </html>
  );
}
