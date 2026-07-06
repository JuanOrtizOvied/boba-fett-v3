import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SABBI Portfolio Builder",
  description:
    "Conversational portfolio builder — chat with the SABBI assistant to classify your investments and build your portfolio.",
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
