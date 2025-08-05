import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import { MantineProvider, ColorSchemeScript } from '@mantine/core';
import { theme } from '../theme';
import { Notifications } from '@mantine/notifications';
import { FileTrackingProvider } from '../hooks/useFileTracking';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
  fallback: ["system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
  fallback: ["ui-monospace", "SFMono-Regular", "Monaco", "Consolas", "Liberation Mono", "Courier New", "monospace"],
});

export const metadata: Metadata = {
  title: "BaseBase Editor",
  description: "Browser-based AI coding assistant",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ColorSchemeScript />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <MantineProvider theme={theme} defaultColorScheme="auto">
          <FileTrackingProvider>
            <Notifications />
            {children}
          </FileTrackingProvider>
        </MantineProvider>
      </body>
    </html>
  );
}
