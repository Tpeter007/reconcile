import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

const client = postgres(connectionString, { max: 1, prepare: false });
const db = drizzle(client);

await migrate(db, { migrationsFolder: "./drizzle" });
await client.end();
console.log("Migrations applied.");
