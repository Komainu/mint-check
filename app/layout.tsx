export const metadata = { title: "Mint Check", description: "Pre-mint check for NFT contracts on Base (x402)" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", maxWidth: 640, margin: "48px auto", padding: "0 16px", lineHeight: 1.6 }}>
        {children}
      </body>
    </html>
  );
}
