CREATE TABLE IF NOT EXISTS samples (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  x_deodor DECIMAL(6,2) NOT NULL DEFAULT 0,
  y_absorb DECIMAL(6,2) NOT NULL DEFAULT 0,
  z_crush DECIMAL(6,2) NOT NULL DEFAULT 0,
  tags JSON NULL,
  status ENUM('draft','tested','archived') NOT NULL DEFAULT 'draft',
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_samples_name (name)
);

CREATE TABLE IF NOT EXISTS materials (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  category VARCHAR(50) NULL,
  function_tags JSON NULL,
  function_notes TEXT NULL,
  min_ratio DECIMAL(6,2) NULL,
  max_ratio DECIMAL(6,2) NULL,
  cost_per_kg DECIMAL(10,2) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_materials_name (name)
);

CREATE TABLE IF NOT EXISTS boms (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sample_id INT NOT NULL,
  version VARCHAR(20) NOT NULL DEFAULT 'v1',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  process_params JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sample_id) REFERENCES samples(id) ON DELETE CASCADE,
  KEY idx_boms_sample (sample_id),
  KEY idx_boms_active (sample_id, is_active)
);

CREATE TABLE IF NOT EXISTS bom_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  bom_id INT NOT NULL,
  material_id INT NOT NULL,
  ratio DECIMAL(6,2) NOT NULL DEFAULT 0,
  note VARCHAR(255) NULL,
  FOREIGN KEY (bom_id) REFERENCES boms(id) ON DELETE CASCADE,
  FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE RESTRICT,
  KEY idx_bom_items_bom (bom_id)
);

-- Ensure only one active BOM per sample in app logic (MVP)
