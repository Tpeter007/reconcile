import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const VERSION_PREFIX = "v1:";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;
const ENV_VAR = "TOKEN_ENCRYPTION_KEY";
const SELF_TEST_PLAINTEXT =
  "AES-GCM self-test; if you see this in logs, filter it";

export class TokenDecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenDecryptError";
  }
}

let cachedKey: Buffer | null = null;
let selfTestPassed = false;

function loadKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env[ENV_VAR];
  if (!raw) {
    throw new Error(
      `${ENV_VAR} is not set. Generate one with \`openssl rand -base64 32\` and add it to .env.local.`,
    );
  }
  let decoded: Buffer;
  try {
    decoded = Buffer.from(raw, "base64");
  } catch {
    throw new Error(
      `${ENV_VAR} is not valid base64. Generate one with \`openssl rand -base64 32\`.`,
    );
  }
  if (decoded.length !== KEY_BYTES) {
    throw new Error(
      `${ENV_VAR} must decode to exactly ${KEY_BYTES} bytes (got ${decoded.length}). Generate one with \`openssl rand -base64 32\`.`,
    );
  }
  cachedKey = decoded;
  return cachedKey;
}

function encryptWithKey(key: Buffer, plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, authTag, ciphertext]);
  return `${VERSION_PREFIX}${payload.toString("base64")}`;
}

function decryptWithKey(key: Buffer, value: string): string {
  if (!value.startsWith(VERSION_PREFIX)) {
    throw new TokenDecryptError("ciphertext version prefix missing or unknown");
  }
  const b64 = value.slice(VERSION_PREFIX.length);
  let payload: Buffer;
  try {
    payload = Buffer.from(b64, "base64");
  } catch {
    throw new TokenDecryptError("ciphertext payload is not valid base64");
  }
  if (payload.length < IV_BYTES + AUTH_TAG_BYTES + 1) {
    throw new TokenDecryptError("ciphertext payload is malformed");
  }
  const iv = payload.subarray(0, IV_BYTES);
  const authTag = payload.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const ciphertext = payload.subarray(IV_BYTES + AUTH_TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  try {
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch {
    throw new TokenDecryptError("auth tag verification failed");
  }
}

function ensureSelfTest(key: Buffer): void {
  if (selfTestPassed) return;
  const roundtrip = decryptWithKey(key, encryptWithKey(key, SELF_TEST_PLAINTEXT));
  if (roundtrip !== SELF_TEST_PLAINTEXT) {
    throw new Error(
      "Token crypto self-test failed: roundtrip produced a different value. Check TOKEN_ENCRYPTION_KEY and Node crypto availability.",
    );
  }
  selfTestPassed = true;
}

export function encryptToken(plaintext: string): string {
  const key = loadKey();
  ensureSelfTest(key);
  return encryptWithKey(key, plaintext);
}

export function decryptToken(ciphertext: string): string {
  const key = loadKey();
  ensureSelfTest(key);
  return decryptWithKey(key, ciphertext);
}
