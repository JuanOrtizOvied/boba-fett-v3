import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Boba Fett Assistant",
  description: "LangGraph-powered assistant chat, bootstrapped from the boilerplate template.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
