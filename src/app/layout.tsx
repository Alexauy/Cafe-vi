import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Common Ground — Virtual Café",
  description: "A quiet shared café for focused work.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
