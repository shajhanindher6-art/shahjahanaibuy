-- Migration 020: Option 17 Support (Hardware Endurance, Sustainability & Modularity)
--
-- All six columns are NULL by default: a product with no recorded
-- hardware/endurance data shows an honest "Not recorded yet" state,
-- never a fake score. Labels (Low/Moderate/High, etc.) are derived in
-- TypeScript from these raw numbers/booleans — never stored as strings.
-- thermal_efficiency_factor is a 0–1 factor (CHECK enforced).
--
-- Owner step: run this file in Supabase (SQL Editor) after 019.

ALTER TABLE products 
ADD COLUMN IF NOT EXISTS thermal_efficiency_factor NUMERIC(3,2) DEFAULT NULL CHECK (thermal_efficiency_factor >= 0 AND thermal_efficiency_factor <= 1),
ADD COLUMN IF NOT EXISTS ssd_tbw_rating INT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS battery_cycle_capacity INT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS carbon_footprint_kg NUMERIC(6,2) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS is_ram_modular BOOLEAN DEFAULT NULL,
ADD COLUMN IF NOT EXISTS is_storage_modular BOOLEAN DEFAULT NULL;
