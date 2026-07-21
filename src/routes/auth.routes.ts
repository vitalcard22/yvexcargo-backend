import { Router } from "express";
import { pool } from "../db";
import { hashPassword, comparePassword, signToken } from "../auth";
import { requireAuth } from "../middleware";

const router = Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post("/register", async (req, res) => {
  try {
    const name = (req.body.name || "").trim();
    const email = (req.body.email || "").trim().toLowerCase();
    const password = req.body.password || "";

    if (!name || !email || !password) return res.status(400).json({ error: "All fields are required." });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
    if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });

    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) return res.status(409).json({ error: "Email already registered." });

    const hash = await hashPassword(password);
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, active)
       VALUES ($1,$2,$3,'user',true)
       RETURNING id, name, email, role`,
      [name, email, hash]
    );
    const user = result.rows[0];
    const token = signToken({ userId: user.id, role: user.role, name: user.name, email: user.email });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.post("/login", async (req, res) => {
  try {
    const email = (req.body.email || "").trim().toLowerCase();
    const password = req.body.password || "";
    if (!email || !password) return res.status(400).json({ error: "Email and password are required." });

    const result = await pool.query(
      "SELECT id, name, email, password_hash, role, active FROM users WHERE email = $1",
      [email]
    );
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: "Invalid email or password." });

    const ok = await comparePassword(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid email or password." });
    if (!user.active) return res.status(403).json({ error: "Account suspended. Contact support." });

    const token = signToken({ userId: user.id, role: user.role, name: user.name, email: user.email });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.get("/me", requireAuth, async (req, res) => {
  const result = await pool.query(
    "SELECT id, name, email, role, active FROM users WHERE id = $1",
    [req.user!.userId]
  );
  const user = result.rows[0];
  if (!user || !user.active) return res.status(401).json({ error: "Session no longer valid." });
  res.json({ user });
});

export default router;
