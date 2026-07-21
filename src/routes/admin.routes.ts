import { Router } from "express";
import { pool } from "../db";
import { requireAuth, requireAdmin } from "../middleware";

const router = Router();
router.use(requireAuth, requireAdmin);

// List all users
router.get("/users", async (_req, res) => {
  const result = await pool.query("SELECT id, name, email, role, active, created_at FROM users ORDER BY created_at DESC");
  res.json({ users: result.rows });
});

// Toggle a user's active status (suspend/reinstate)
router.patch("/users/:id", async (req, res) => {
  const { active } = req.body;
  if (typeof active !== "boolean") return res.status(400).json({ error: "'active' must be true or false." });
  const result = await pool.query(
    "UPDATE users SET active = $1 WHERE id = $2 RETURNING id, name, email, role, active",
    [active, req.params.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: "User not found." });
  res.json({ user: result.rows[0] });
});

// Delete a user (clears FK references on their shipments first)
router.delete("/users/:id", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE shipments SET user_id = NULL WHERE user_id = $1", [req.params.id]);
    const result = await client.query("DELETE FROM users WHERE id = $1 RETURNING id", [req.params.id]);
    await client.query("COMMIT");
    if (result.rows.length === 0) return res.status(404).json({ error: "User not found." });
    res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Delete user error:", err);
    res.status(500).json({ error: "Could not delete user." });
  } finally {
    client.release();
  }
});

export default router;
