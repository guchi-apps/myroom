import type { Metadata, Viewport } from "next";
import { Noto_Sans_JP } from "next/font/google";
import "./globals.css";
import { AppUpdateChecker } from "@/components/app-update-checker";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
import { ThemeProvider } from "@/components/theme-provider";

const notoSansJP = Noto_Sans_JP({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "kurashio",
  description: "暮らしを、ひとつに整える。",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/kurashio-favicon.png", sizes: "32x32", type: "image/png" },
      { url: "/kurashio-icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/kurashio-apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "kurashio",
    // PWAでは上端までアプリ側で描画し、安全領域をヘッダー色で明示的に覆う。
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#2ecc71",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body className={`${notoSansJP.className} min-h-screen`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <ServiceWorkerRegister />
          {/* 新しいビルドを自分で見つけて取り込む。全画面に効かせたいのでここに置く（#277） */}
          <AppUpdateChecker />
          {/*
            iOS PWAではステータスバー直下に半透明の効果が重なるため、上端まで
            ヘッダー色で塗り、安全領域の下から画面を始める。env()が0の環境では
            従来と同じ配置になる。画面ごとの最大幅は各画面が決める。
          */}
          <div className="min-h-screen w-full bg-header-band pt-[env(safe-area-inset-top)]">
            <div className="min-h-[calc(100vh-env(safe-area-inset-top))] w-full bg-background">
              {children}
            </div>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
