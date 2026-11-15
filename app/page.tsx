export default function Page() {
  return (
    <main>
      <h1>Mint Check</h1>
      <p>Pre-mint check for NFT contracts on Base. Pay per call with x402 (USDC).</p>
      <pre style={{ background: "#f4f4f4", padding: 12, overflowX: "auto" }}>GET /api/mint-check?address=0x...</pre>
      <p>
        Returns on-chain facts: who controls the contract, proxy and source status, supply, and which owner
        functions exist. Lists what could not be measured. Not an audit, not financial advice.
      </p>
    </main>
  );
}
