import { config } from "dotenv";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import { createDatabase } from "./client.js";

config({ path: "../../.env" });

const { db, close } = createDatabase();

try {
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Database migrations applied.");
} finally {
  await close();
}

