import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Macroscope PR Creator",
  description: "Recreate commits as PRs for Macroscope code reviews",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased bg-gray-50 min-h-screen">
        {children}
      </body>
    </html>
  );
}
