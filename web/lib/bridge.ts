const BRIDGE_URL = process.env.NEXT_PUBLIC_BRIDGE_URL ?? 'http://localhost:4000';

export async function scanCard(): Promise<void> {
  const res = await fetch(`${BRIDGE_URL}/reader/scan`, {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error ?? `Scan failed (${res.status})`);
  }
  // Result arrives via WebSocket → BridgeProvider → CardToast
}
