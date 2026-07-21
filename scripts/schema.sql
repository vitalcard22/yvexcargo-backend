CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shipments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_id         TEXT UNIQUE NOT NULL,
  user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
  sender_name         TEXT NOT NULL,
  receiver_name       TEXT NOT NULL,
  origin              TEXT NOT NULL,
  destination         TEXT NOT NULL,
  service             TEXT NOT NULL,
  weight              TEXT,
  description         TEXT,
  estimated_delivery  DATE,
  status              TEXT NOT NULL DEFAULT 'Order Placed'
                        CHECK (status IN ('Order Placed','In Process','In Transit','Customs Check','Out for Delivery','Delivered')),
  current_location    TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shipment_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id       UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  status            TEXT NOT NULL
                      CHECK (status IN ('Order Placed','In Process','In Transit','Customs Check','Out for Delivery','Delivered')),
  location          TEXT NOT NULL,
  note              TEXT,
  customs_location  TEXT,
  customs_note      TEXT,
  time              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shipment_notes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id           UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  text                  TEXT NOT NULL,
  visible_to_customer   BOOLEAN NOT NULL DEFAULT false,
  admin_name            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shipments_tracking_id ON shipments (tracking_id);
CREATE INDEX IF NOT EXISTS idx_shipments_user_id ON shipments (user_id);
CREATE INDEX IF NOT EXISTS idx_shipment_logs_shipment_id ON shipment_logs (shipment_id);
CREATE INDEX IF NOT EXISTS idx_shipment_notes_shipment_id ON shipment_notes (shipment_id);
