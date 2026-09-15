import "dotenv/config";
import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import { pool } from "../src/db";

async function main() {
  console.log("Running schema migration...");
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(schema);
  console.log("Schema ready.");

  const adminEmail = "admin@yvexcargo.com";
  const existingAdmin = await pool.query("SELECT id FROM users WHERE email = $1", [adminEmail]);
  if (existingAdmin.rows.length === 0) {
    const hash = await bcrypt.hash("qwertyuiop22", 10);
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role, active) VALUES ($1,$2,$3,'admin',true)`,
      ["Admin", adminEmail, hash]
    );
    console.log("Seeded admin user:", adminEmail);
  } else {
    console.log("Admin user already exists, skipping seed.");
  }

  await pool.end();
  console.log("Migration complete.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
