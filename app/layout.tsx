import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LeaseLens — 감사인 관점 IFRS 16 리스 자동화·검증",
  description:
    "리스 계약서 AI 추출 → IFRS 16 독립 재계산 → 이상탐지·감사조서. K-IFRS 1116.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
