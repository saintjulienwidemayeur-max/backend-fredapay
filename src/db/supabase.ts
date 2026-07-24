// ============================================================
// Supabase Client — Freda Pay
// Fix Node.js 18: ws passé comme transport Realtime
// ============================================================

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { logger } from "../utils/logger";

let _client: SupabaseClient | null = null;
export let dbReady = false;

export const getSupabase = (): SupabaseClient => {
  if (_client) return _client;

  const url    = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error("SUPABASE_URL ou SUPABASE_SECRET_KEY manquant dans .env");

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ws = require("ws");

  _client = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-client-info": "freda-pay-backend/2.0.0" } },
    realtime: { transport: ws },
  });

  logger.info("Supabase client initialisé (ws transport)");
  return _client;
};

// Test REST direct — sans WebSocket, timeout 8s
export const testSupabaseConnection = async (): Promise<boolean> => {
  try {
    const url    = process.env.SUPABASE_URL;
    const secret = process.env.SUPABASE_SECRET_KEY;
    if (!url || !secret) { logger.error("SUPABASE_URL ou SUPABASE_SECRET_KEY manquant"); return false; }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    const baseUrl = url.replace(/\/rest\/v1\/?$/, "");
    const res = await fetch(`${baseUrl}/rest/v1/users?select=id&limit=1`, {
      headers: { apikey: secret, Authorization: `Bearer ${secret}` },
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    // Initialiser le client après le test REST
    getSupabase();

    if (res.status === 200) {
      logger.info("✅ Supabase PostgreSQL connecté — tables OK");
      dbReady = true;
      return true;
    }

    const body = await res.text();
    if (body.includes("42P01") || body.includes("PGRST116")) {
      logger.warn("⚠ Supabase connecté MAIS migration SQL manquante");
      logger.warn("  → Dashboard → SQL Editor → exécutez migrations/001_initial_schema.sql");
      dbReady = false;
      return true;
    }

    if (res.status === 401) {
      logger.error("Supabase: clé invalide (401)");
      return false;
    }

    logger.error("Supabase connexion échouée", { status: res.status, body: body.slice(0, 200) });
    return false;

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("abort") || msg.includes("AbortError")) {
      logger.error("Supabase timeout — vérifiez SUPABASE_URL");
    } else if (msg.includes("ENOTFOUND") || msg.includes("fetch failed")) {
      logger.error("Supabase ENOTFOUND", { url: process.env.SUPABASE_URL });
    } else {
      logger.error("Supabase erreur", { error: msg.slice(0, 200) });
    }
    return false;
  }
};
