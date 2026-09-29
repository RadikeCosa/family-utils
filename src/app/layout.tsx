import type { Metadata, Viewport } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Family Utils — aplicaciones para tu familia",
  description: "Aplicaciones útiles para organizar la vida familiar.",
  applicationName: "Family Utils",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/icon-180.png" },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Family Utils",
  },
};

export const viewport: Viewport = {
  themeColor: "#f6f5f0",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-AR">
      <body>{children}</body>
    </html>
  );
}
