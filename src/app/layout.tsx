import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { activeBrand } from "@/lib/active-brand";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Dashboard de Campanha",
  description:
    "Central de análise das contas: Instagram orgânico, tráfego pago, criativos e funil de leads até o agendamento de reunião.",
};

// O tema é definido pela MARCA ativa (não por preferência do usuário): consórcio
// = escuro/âmbar, krone = claro/verde. Como o cookie da marca já é conhecido no
// servidor, estampamos data-theme + data-brand no <html> aqui, no SSR — a página
// já pinta no tema certo, sem flash e sem script inline de localStorage.
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const brand = await activeBrand();

  return (
    <html
      lang="pt-BR"
      data-theme={brand.theme}
      data-brand={brand.slug}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
