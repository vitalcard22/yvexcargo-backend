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

  const existingShipments = await pool.query("SELECT count(*)::int AS n FROM shipments");
  if (existingShipments.rows[0].n === 0) {
    const demo = [
      {
        trackingId: "YVC-2024-001847",
        senderName: "Schneider Logistics GmbH", receiverName: "James Carter",
        origin: "Hamburg, Germany", destination: "New York, USA",
        service: "Sea Freight", weight: "250kg", description: "Electronics",
        estimatedDelivery: "2024-01-15", status: "Delivered", currentLocation: "New York, USA",
        logs: [
          { status: "Order Placed", location: "Hamburg, Germany", note: "Order confirmed. Shipment booked.", time: "2024-01-01T08:00:00Z" },
          { status: "In Process", location: "Hamburg, Germany", note: "Received at origin warehouse. Packaging complete.", time: "2024-01-01T10:00:00Z" },
          { status: "In Transit", location: "Hamburg Port, Germany", note: "Export customs cleared. Loaded on MV Atlantic Star.", time: "2024-01-03T08:00:00Z" },
          { status: "Customs Check", location: "Port Newark, NJ, USA", note: "Presented to US Customs and Border Protection.", time: "2024-01-10T07:00:00Z", customsLocation: "Port Newark CBP Office, NJ", customsNote: "Standard inspection. No issues flagged." },
          { status: "Out for Delivery", location: "YvexCargo Warehouse, New York", note: "US customs cleared. Assigned to delivery agent.", time: "2024-01-14T09:00:00Z" },
          { status: "Delivered", location: "New York, USA", note: "Delivered. Signed by James Carter.", time: "2024-01-15T14:30:00Z" },
        ],
        notes: [{ text: "Cleared by US customs without issues", visibleToCustomer: true, adminName: "Admin", createdAt: "2024-01-10T09:00:00Z" }],
      },
      {
        trackingId: "YVC-2024-003291",
        senderName: "Dubois and Fils Trading", receiverName: "Michael Thompson",
        origin: "Lyon, France", destination: "Chicago, USA",
        service: "Express Courier", weight: "5kg", description: "Documents and Parcels",
        estimatedDelivery: "2024-02-20", status: "Out for Delivery", currentLocation: "Chicago, IL",
        logs: [
          { status: "Order Placed", location: "Lyon, France", note: "Order received and confirmed.", time: "2024-02-17T14:00:00Z" },
          { status: "In Process", location: "Lyon, France", note: "Package collected and documented.", time: "2024-02-18T09:00:00Z" },
          { status: "In Transit", location: "CDG Airport, Paris", note: "Departed CDG on flight AF068 to Chicago.", time: "2024-02-18T18:00:00Z" },
          { status: "Out for Delivery", location: "Chicago, IL", note: "Cleared US customs. With local delivery agent.", time: "2024-02-19T16:00:00Z" },
        ],
        notes: [],
      },
      {
        trackingId: "YVC-2024-005512",
        senderName: "BioMed Solutions Ltd", receiverName: "Sophia Mueller",
        origin: "London, UK", destination: "Berlin, Germany",
        service: "Air Freight", weight: "18kg", description: "Medical Equipment",
        estimatedDelivery: "2024-02-28", status: "Customs Check", currentLocation: "Berlin Customs Office",
        logs: [
          { status: "Order Placed", location: "London, UK", note: "Order placed by BioMed Solutions Ltd.", time: "2024-02-19T10:00:00Z" },
          { status: "In Process", location: "London, UK", note: "Picked up. Export paperwork processed.", time: "2024-02-20T07:00:00Z" },
          { status: "In Transit", location: "Heathrow Airport, London", note: "Departed on flight BA902 to Berlin.", time: "2024-02-20T22:00:00Z" },
          { status: "Customs Check", location: "Berlin Customs, Germany", note: "Presented to German Federal Customs Office.", time: "2024-02-22T11:00:00Z", customsLocation: "Zollamt Berlin, Wolfener Str. 32", customsNote: "CE certification documents required. Shipment held." },
        ],
        notes: [
          { text: "Held — additional CE certification documents required", visibleToCustomer: false, adminName: "Admin", createdAt: "2024-02-22T11:00:00Z" },
          { text: "Documents submitted. Awaiting officer review.", visibleToCustomer: true, adminName: "Admin", createdAt: "2024-02-23T14:00:00Z" },
        ],
      },
    ];

    for (const s of demo) {
      const res = await pool.query(
        `INSERT INTO shipments (tracking_id, sender_name, receiver_name, origin, destination, service, weight, description, estimated_delivery, status, current_location)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [s.trackingId, s.senderName, s.receiverName, s.origin, s.destination, s.service, s.weight, s.description, s.estimatedDelivery, s.status, s.currentLocation]
      );
      const shipmentId = res.rows[0].id;
      for (const log of s.logs) {
        await pool.query(
          `INSERT INTO shipment_logs (shipment_id, status, location, note, customs_location, customs_note, time)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [shipmentId, log.status, log.location, log.note, (log as any).customsLocation || null, (log as any).customsNote || null, log.time]
        );
      }
      for (const note of s.notes) {
        await pool.query(
          `INSERT INTO shipment_notes (shipment_id, text, visible_to_customer, admin_name, created_at)
           VALUES ($1,$2,$3,$4,$5)`,
          [shipmentId, note.text, note.visibleToCustomer, note.adminName, note.createdAt]
        );
      }
    }
    console.log("Seeded", demo.length, "demo shipments.");
  } else {
    console.log("Shipments already exist, skipping seed.");
  }

  await pool.end();
  console.log("Migration complete.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
