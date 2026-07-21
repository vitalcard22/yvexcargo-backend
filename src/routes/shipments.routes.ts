import { Router } from "express";
import { pool } from "../db";
import { requireAuth, requireAdmin } from "../middleware";

const router = Router();

const STATUS_FLOW = ["Order Placed", "In Process", "In Transit", "Customs Check", "Out for Delivery", "Delivered"];

function genTrackingId() {
  const year = new Date().getFullYear();
  const num = Math.floor(Math.random() * 900000 + 100000);
  return `YVC-${year}-${num}`;
}

async function serializeShipment(row: any) {
  const [logsRes, notesRes] = await Promise.all([
    pool.query("SELECT * FROM shipment_logs WHERE shipment_id = $1 ORDER BY time ASC", [row.id]),
    pool.query("SELECT * FROM shipment_notes WHERE shipment_id = $1 ORDER BY created_at ASC", [row.id]),
  ]);
  return {
    id: row.id,
    trackingId: row.tracking_id,
    userId: row.user_id,
    senderName: row.sender_name,
    receiverName: row.receiver_name,
    origin: row.origin,
    destination: row.destination,
    service: row.service,
    weight: row.weight,
    description: row.description,
    estimatedDelivery: row.estimated_delivery,
    status: row.status,
    currentLocation: row.current_location,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    logs: logsRes.rows.map((l) => ({
      id: l.id, status: l.status, location: l.location, note: l.note,
      customsLocation: l.customs_location, customsNote: l.customs_note, time: l.time,
    })),
    adminNotes: notesRes.rows.map((n) => ({
      id: n.id, text: n.text, visibleToCustomer: n.visible_to_customer, adminName: n.admin_name, createdAt: n.created_at,
    })),
  };
}

// Public: track by tracking ID (no auth required)
router.get("/track/:trackingId", async (req, res) => {
  const trackingId = req.params.trackingId.trim().toUpperCase();
  const result = await pool.query("SELECT * FROM shipments WHERE upper(tracking_id) = $1", [trackingId]);
  if (result.rows.length === 0) return res.status(404).json({ error: "No shipment found. Double-check the tracking ID and try again." });
  res.json({ shipment: await serializeShipment(result.rows[0]) });
});

// Authenticated user: shipments linked to their account
router.get("/mine", requireAuth, async (req, res) => {
  const result = await pool.query("SELECT * FROM shipments WHERE user_id = $1 ORDER BY created_at DESC", [req.user!.userId]);
  const shipments = await Promise.all(result.rows.map(serializeShipment));
  res.json({ shipments });
});

// Admin: list all shipments
router.get("/", requireAuth, requireAdmin, async (_req, res) => {
  const result = await pool.query("SELECT * FROM shipments ORDER BY created_at DESC");
  const shipments = await Promise.all(result.rows.map(serializeShipment));
  res.json({ shipments });
});

// Admin: create a new shipment
router.post("/", requireAuth, requireAdmin, async (req, res) => {
  try {
    const b = req.body;
    if (!b.senderName || !b.receiverName || !b.origin || !b.destination || !b.service) {
      return res.status(400).json({ error: "Missing required shipment fields." });
    }
    const trackingId = genTrackingId();
    const initialStatus = b.status || "Order Placed";
    const result = await pool.query(
      `INSERT INTO shipments (tracking_id, sender_name, receiver_name, origin, destination, service, weight, description, estimated_delivery, status, current_location)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [trackingId, b.senderName, b.receiverName, b.origin, b.destination, b.service, b.weight || null, b.description || null, b.estimatedDelivery || null, initialStatus, b.origin]
    );
    const shipment = result.rows[0];
    await pool.query(
      `INSERT INTO shipment_logs (shipment_id, status, location, note) VALUES ($1,$2,$3,$4)`,
      [shipment.id, initialStatus, b.origin, "Order received and confirmed."]
    );
    res.status(201).json({ shipment: await serializeShipment(shipment) });
  } catch (err) {
    console.error("Create shipment error:", err);
    res.status(500).json({ error: "Could not create shipment." });
  }
});

// Admin: get one shipment by id
router.get("/:id", requireAuth, requireAdmin, async (req, res) => {
  const result = await pool.query("SELECT * FROM shipments WHERE id = $1", [req.params.id]);
  if (result.rows.length === 0) return res.status(404).json({ error: "Shipment not found." });
  res.json({ shipment: await serializeShipment(result.rows[0]) });
});

// Admin: update shipment status (appends a log entry)
router.patch("/:id/status", requireAuth, requireAdmin, async (req, res) => {
  const { status, location, note, customsLocation, customsNote } = req.body;
  if (!status || !STATUS_FLOW.includes(status)) return res.status(400).json({ error: "Invalid status." });
  if (!location) return res.status(400).json({ error: "Location is required." });

  const shipmentRes = await pool.query("SELECT * FROM shipments WHERE id = $1", [req.params.id]);
  if (shipmentRes.rows.length === 0) return res.status(404).json({ error: "Shipment not found." });

  await pool.query(
    `UPDATE shipments SET status = $1, current_location = $2, updated_at = now() WHERE id = $3`,
    [status, location, req.params.id]
  );
  await pool.query(
    `INSERT INTO shipment_logs (shipment_id, status, location, note, customs_location, customs_note)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [req.params.id, status, location, note || null, customsLocation || null, customsNote || null]
  );
  const updated = await pool.query("SELECT * FROM shipments WHERE id = $1", [req.params.id]);
  res.json({ shipment: await serializeShipment(updated.rows[0]) });
});

// Admin: edit shipment core fields
router.patch("/:id", requireAuth, requireAdmin, async (req, res) => {
  const b = req.body;
  const fields = ["senderName","receiverName","origin","destination","service","weight","description","estimatedDelivery"];
  const columns: Record<string,string> = {
    senderName:"sender_name", receiverName:"receiver_name", origin:"origin", destination:"destination",
    service:"service", weight:"weight", description:"description", estimatedDelivery:"estimated_delivery",
  };
  const sets: string[] = [];
  const values: any[] = [];
  let i = 1;
  for (const f of fields) {
    if (b[f] !== undefined) { sets.push(`${columns[f]} = $${i}`); values.push(b[f]); i++; }
  }
  if (sets.length === 0) return res.status(400).json({ error: "No fields to update." });
  values.push(req.params.id);
  const result = await pool.query(`UPDATE shipments SET ${sets.join(", ")}, updated_at = now() WHERE id = $${i} RETURNING *`, values);
  if (result.rows.length === 0) return res.status(404).json({ error: "Shipment not found." });
  res.json({ shipment: await serializeShipment(result.rows[0]) });
});

// Admin: delete shipment
router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  const result = await pool.query("DELETE FROM shipments WHERE id = $1 RETURNING id", [req.params.id]);
  if (result.rows.length === 0) return res.status(404).json({ error: "Shipment not found." });
  res.json({ success: true });
});

// Admin: add a note
router.post("/:id/notes", requireAuth, requireAdmin, async (req, res) => {
  const { text, visibleToCustomer, adminName } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: "Note text is required." });
  await pool.query(
    `INSERT INTO shipment_notes (shipment_id, text, visible_to_customer, admin_name) VALUES ($1,$2,$3,$4)`,
    [req.params.id, text.trim(), !!visibleToCustomer, adminName || req.user!.name]
  );
  const shipmentRes = await pool.query("SELECT * FROM shipments WHERE id = $1", [req.params.id]);
  if (shipmentRes.rows.length === 0) return res.status(404).json({ error: "Shipment not found." });
  res.json({ shipment: await serializeShipment(shipmentRes.rows[0]) });
});

// Admin: update a note (e.g. toggle visibility)
router.patch("/:id/notes/:noteId", requireAuth, requireAdmin, async (req, res) => {
  const { text, visibleToCustomer } = req.body;
  const sets: string[] = [];
  const values: any[] = [];
  let i = 1;
  if (text !== undefined) { sets.push(`text = $${i}`); values.push(text); i++; }
  if (visibleToCustomer !== undefined) { sets.push(`visible_to_customer = $${i}`); values.push(visibleToCustomer); i++; }
  if (sets.length === 0) return res.status(400).json({ error: "No fields to update." });
  values.push(req.params.noteId);
  await pool.query(`UPDATE shipment_notes SET ${sets.join(", ")} WHERE id = $${i}`, values);
  const shipmentRes = await pool.query("SELECT * FROM shipments WHERE id = $1", [req.params.id]);
  if (shipmentRes.rows.length === 0) return res.status(404).json({ error: "Shipment not found." });
  res.json({ shipment: await serializeShipment(shipmentRes.rows[0]) });
});

// Admin: delete a note
router.delete("/:id/notes/:noteId", requireAuth, requireAdmin, async (req, res) => {
  await pool.query("DELETE FROM shipment_notes WHERE id = $1", [req.params.noteId]);
  const shipmentRes = await pool.query("SELECT * FROM shipments WHERE id = $1", [req.params.id]);
  if (shipmentRes.rows.length === 0) return res.status(404).json({ error: "Shipment not found." });
  res.json({ shipment: await serializeShipment(shipmentRes.rows[0]) });
});

export default router;
