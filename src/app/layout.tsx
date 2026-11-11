import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cafe-Vi — Your internet hangout",
  description: "A quirky shared café for focused work and friendly company.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
