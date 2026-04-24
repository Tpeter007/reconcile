import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import postgres from "postgres";
import { encryptToken } from "../src/lib/crypto/tokens.ts";

// Warmup: forces TOKEN_ENCRYPTION_KEY validation + self-test before any
// destructive SQL. If the env var is missing or wrong, this throws here.
encryptToken("warmup");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

let host = "(unknown)";
try {
  host = new URL(connectionString).host;
} catch {
  // fall through
}
console.log(`About to truncate tables on DB host: ${host}`);

const rl = createInterface({ input: stdin, output: stdout });
const answer = await rl.question(
  "Type 'clear' to proceed (anything else aborts): ",
);
rl.close();

if (answer !== "clear") {
  console.log("Aborted.");
  process.exit(1);
}

const tables = [
  "matches",
  "transactions",
  "bank_accounts",
  "qbo_entries",
  "plaid_items",
  "qbo_connections",
];

const client = postgres(connectionString, { max: 1, prepare: false });
try {
  await client.unsafe(
    `TRUNCATE ${tables.join(", ")} RESTART IDENTITY CASCADE;`,
  );
  console.log(`Cleared: ${tables.join(", ")}`);
  await client.end();
  process.exit(0);
} catch (err) {
  console.error("Clear failed:", err instanceof Error ? err.message : err);
  await client.end();
  process.exit(1);
}
