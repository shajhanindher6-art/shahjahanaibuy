-- Smart Warranty & Receipt Vault (Option 8, Feature 3).
-- OWNER: run once in the Supabase SQL editor. Until this runs, the vault
-- page shows an explanatory note (never a crash, never fake records).
--
-- HONESTY: there is no Supabase Storage bucket configured for receipt
-- files, so receipt_file_* columns store FILE METADATA captured on the
-- client (name, type, size) plus an optional user-pasted receipt URL.
-- Automatic OCR text extraction is NOT an active capability: extracted_text
-- is user-entered/pasted text only. Warranty "expiring soon" surfacing is
-- computed on view; no background/email warranty alerts are wired.

CREATE TABLE IF NOT EXISTS vault_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  store text,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  purchase_date date NOT NULL,
  amount numeric(12, 2),
  currency text NOT NULL DEFAULT 'USD',
  warranty_months integer NOT NULL DEFAULT 12 CHECK (warranty_months >= 0),
  receipt_file_name text,
  receipt_file_type text,
  receipt_file_size integer,
  receipt_url text,
  extracted_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vault_items_user_idx ON vault_items (user_id, purchase_date DESC);

ALTER TABLE vault_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vault_items_select_own" ON vault_items;
CREATE POLICY "vault_items_select_own" ON vault_items FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "vault_items_insert_own" ON vault_items;
CREATE POLICY "vault_items_insert_own" ON vault_items FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "vault_items_delete_own" ON vault_items;
CREATE POLICY "vault_items_delete_own" ON vault_items FOR DELETE
  TO authenticated USING (auth.uid() = user_id);
