import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "findamine - GPS Treasure Hunting Adventures",
  description:
    "Location-based educational scavenger hunts for classrooms and families.",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
  },
};

// Mobile is the primary device (GPS field app). Next auto-injects
// width=device-width, initial-scale=1; we keep zoom ENABLED (no maximum-scale /
// user-scalable=no) so the viewport stays accessible, and add a theme color.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0EA5E9",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased" style={{ fontFamily: "'Inter', system-ui, sans-serif", fontSize: "16px" }}>
        {children}
      </body>
    </html>
  );
}
