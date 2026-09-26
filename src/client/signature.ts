function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const normalized = hex.trim().toLowerCase();
  if (normalized.length === 0 || normalized.length % 2 !== 0 || /[^0-9a-f]/.test(normalized)) {
    throw new Error("Signature key must be a hex string");
  }
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqualHex(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i++) {
    mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Authorize.net signs the raw webhook body with HMAC-SHA512.
 * The signature key from the Merchant Interface is hex; the HMAC key is those decoded bytes.
 * Header shape: `sha512=<hex>`.
 */
export async function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  signatureKeyHex: string,
): Promise<boolean> {
  const received = signatureHeader.replace(/^sha512=/i, "").trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(received)) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    hexToBytes(signatureKeyHex),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(rawBody),
  );
  const computed = bytesToHex(new Uint8Array(signature));
  return timingSafeEqualHex(computed, received);
}
