export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  AI?: Ai;
  ASSETS: Fetcher;
  ACCESS_MODE: 'publico' | 'privado' | 'suscripcion';
  TRIAL_DAYS?: string;
  PRICE_EUR?: string;
  PAYPAL_USER?: string;
  PAYPAL_LINK?: string;
  PAYPAL_NOTE?: string;
  ADMIN_EMAILS: string;
  ACCESS_TEAM: string;
  ACCESS_AUD: string;
  NONCOMMERCIAL_SOURCES: string;
  ADS_ENABLED: string;
  CONTACT_UA: string;
  DEV_USER?: string; // solo en desarrollo local (.dev.vars)
  FRED_API_KEY?: string;
  COINGECKO_API_KEY?: string;
  CF_RADAR_TOKEN?: string;
  CONGRESS_API_KEY?: string;
  GUARDIAN_API_KEY?: string;
  PUBLISH_TOKEN?: string;
  REDDIT_CLIENT_ID?: string;
  REDDIT_CLIENT_SECRET?: string;
}
