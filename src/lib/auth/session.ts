/**
 * Signed session token — portable between the Node.js runtime (server actions)
 * and the Edge runtime (middleware), so it uses ONLY the Web Crypto API and
 * base64url helpers, never `node:crypto` or `Buffer`.
 *
 * Token shape: `<payloadB64url>.<signatureB64url>` where the signature is
 * HMAC-SHA256 of the payload. The payload is `{ u: username, exp: epochSecs }`.
 */

export const SESSION_COOKIE = "dash_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBuffer(b64url: string): ArrayBuffer {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const buffer = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return buffer;
}

const encoder = new TextEncoder();

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function createSessionToken(username: string, secret: string): Promise<string> {
  const payload = { u: username, exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE };
  const payloadB64 = bytesToB64url(encoder.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payloadB64));
  return `${payloadB64}.${bytesToB64url(new Uint8Array(sig))}`;
}

/** Returns the username if the token is valid and unexpired, else null. */
export async function verifySessionToken(token: string, secret: string): Promise<string | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  try {
    const key = await hmacKey(secret);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      b64urlToBuffer(sigB64),
      encoder.encode(payloadB64),
    );
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBuffer(payloadB64))) as {
      u?: string;
      exp?: number;
    };
    if (!payload.u || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload.u;
  } catch {
    return null;
  }
}
