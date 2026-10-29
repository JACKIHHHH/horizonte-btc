-- Series diarias completas como JSON [[día, valor], ...]
CREATE TABLE IF NOT EXISTS series (
  key TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  first_day TEXT,
  last_day TEXT,
  source TEXT,
  updated_at INTEGER NOT NULL
);

-- Lecturas instantáneas por conector (último valor de cada métrica)
CREATE TABLE IF NOT EXISTS metrics (
  key TEXT PRIMARY KEY,
  value REAL,
  text TEXT,
  unit TEXT,
  source TEXT NOT NULL,
  observed_at INTEGER NOT NULL
);

-- Estado de cada conector
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,          -- ok | caido | sin_licencia | sin_clave | pendiente
  last_ok INTEGER,
  last_error TEXT,
  last_run INTEGER,
  items INTEGER DEFAULT 0
);

-- Noticias y publicaciones crudas (solo titular, medio, fecha y enlace)
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,           -- hash del enlace
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  lang TEXT,
  published_at INTEGER NOT NULL,
  fetched_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendiente',  -- pendiente | procesado | descartado
  category TEXT,
  tone REAL,
  countries TEXT,
  event_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_items_status ON items(status, fetched_at);
CREATE INDEX IF NOT EXISTS idx_items_pub ON items(published_at);

-- Acontecimientos: agrupaciones de noticias que cuentan lo mismo
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  countries TEXT,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  n_items INTEGER NOT NULL,
  n_sources INTEGER NOT NULL,
  credibility REAL NOT NULL,
  tone REAL NOT NULL,
  weight REAL NOT NULL,
  rumor INTEGER NOT NULL DEFAULT 0,
  sources TEXT NOT NULL,          -- JSON [{id, nombre, url, cred}]
  centroid TEXT                   -- embedding int8 en base64
);
CREATE INDEX IF NOT EXISTS idx_events_last ON events(last_seen);

-- Índices propios (histórico para re-estimar pesos cuando haya datos suficientes)
CREATE TABLE IF NOT EXISTS index_log (
  day TEXT NOT NULL,
  key TEXT NOT NULL,
  value REAL NOT NULL,
  PRIMARY KEY (day, key)
);

-- Previsiones oficiales publicadas y su verificación
CREATE TABLE IF NOT EXISTS forecasts (
  made_on TEXT NOT NULL,
  horizon INTEGER NOT NULL,
  price REAL NOT NULL,
  p05 REAL, p25 REAL, p50 REAL, p75 REAL, p95 REAL,
  prob_up REAL,
  model TEXT,
  due_on TEXT NOT NULL,
  realized REAL,
  PRIMARY KEY (made_on, horizon)
);

-- Documentos publicados por el calibrador (calibración diaria, backtest semanal)
CREATE TABLE IF NOT EXISTS published (
  key TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Usuarios asignados y escenarios guardados
CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  name TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin', 'analista', 'lector')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  last_seen INTEGER
);

CREATE TABLE IF NOT EXISTS saved_scenarios (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  config TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_saved_email ON saved_scenarios(email);

CREATE TABLE IF NOT EXISTS audit (
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
