-- Suscripciones: prueba gratuita, periodo pagado y registro de pagos
ALTER TABLE users ADD COLUMN trial_until INTEGER;
ALTER TABLE users ADD COLUMN paid_until INTEGER;
ALTER TABLE users ADD COLUMN notes TEXT;

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  amount REAL NOT NULL,
  method TEXT NOT NULL,
  reference TEXT,
  period_from INTEGER NOT NULL,
  period_to INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_email ON payments(email);

-- Aviso de pago enviado por el usuario (pendiente de que el administrador lo compruebe en PayPal)
ALTER TABLE users ADD COLUMN pay_claim TEXT;
ALTER TABLE users ADD COLUMN pay_claim_at INTEGER;
