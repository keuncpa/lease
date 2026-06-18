import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // 감사·핀테크 프로 팔레트: 딥 네이비 베이스 + 틸 액센트
        brand: {
          navy: "#0b2545",
          navy2: "#13315c",
          ink: "#0f172a",
          teal: "#0d9488",
          tealLight: "#14b8a6",
          gold: "#c79a3a",
        },
      },
      fontFamily: {
        sans: [
          "Pretendard",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Apple SD Gothic Neo",
          "Malgun Gothic",
          "sans-serif",
        ],
      },
      boxShadow: {
        card: "0 1px 2px rgba(15,23,42,0.04), 0 8px 24px -12px rgba(15,23,42,0.12)",
      },
    },
  },
  plugins: [],
};
export default config;
