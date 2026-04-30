import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import postgres from "postgres";

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
console.log(`About to truncate Plaid-related tables on DB host: ${host}`);

const rl = createInterface({ input: stdin, output: stdout });
const answer = await rl.question(
  "Type 'clear' to proceed (anything else aborts): ",
);
rl.close();

if (answer !== "clear") {
  console.log("Aborted.");
  process.exit(1);
}

const tables = ["plaid_items", "bank_accounts", "transactions"];

const client = postgres(connectionString, { max: 1, prepare: false });
let exitCode = 0;
try {
  await client.unsafe(
    `TRUNCATE ${tables.join(", ")} RESTART IDENTITY CASCADE;`,
  );
  console.log(`Cleared: ${tables.join(", ")}`);
} catch (err) {
  console.error("Clear failed:", err instanceof Error ? err.message : err);
  exitCode = 1;
} finally {
  await client.end();
}
process.exit(exitCode);
