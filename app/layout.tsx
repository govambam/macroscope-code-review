import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import "./globals.css";
import { Providers } from "./providers";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Macroscope PR Creator",
  description: "Recreate commits as PRs for Macroscope code reviews",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getServerSession(authOptions);

  return (
    <html lang="en">
      <body className={`${geist.variable} font-sans antialiased bg-white min-h-screen text-black`}>
        <Providers session={session}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
