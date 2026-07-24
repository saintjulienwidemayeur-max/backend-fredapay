// ============================================================
// Service Didit KYC — Tous les appels API centralisés
// Docs: https://docs.didit.me
// Auth: x-api-key dans le header
// ============================================================

import fetch from "node-fetch";
import { logger } from "../utils/logger";
import type {
  DiditCreateSessionRequest,
  DiditSession,
  DiditVerificationResult,
  DiditIDVerificationRequest,
  DiditLivenessRequest,
  DiditFaceMatchRequest,
  DiditAMLRequest,
} from "../types/didit";

const BASE_URL = process.env.DIDIT_BASE_URL || "https://verification.didit.me";

// ── Header auth ───────────────────────────────────────────────
const authHeaders = () => {
  const apiKey = process.env.DIDIT_API_KEY;
  if (!apiKey) {
    throw new Error("DIDIT_API_KEY manquant dans .env");
  }
  return {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "accept": "application/json",
  };
};

// ── Wrapper POST ──────────────────────────────────────────────
async function diditPost<T>(endpoint: string, body: object): Promise<T> {
  const url = `${BASE_URL}${endpoint}`;
  logger.debug(`Didit POST ${endpoint}`);

  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });

  // ✅ FIX DYAGNOSTIK: lè estati a se yon bagay ki PA nòmal (egzanp "443" —
  // ki PA yon kòd HTTP valab, se pò HTTPS la!), sa vle di gen anpil chans
  // repons lan PA menm soti nan API Didit la vre (yon WAF, yon CDN, yon
  // erè rezo ki mal entèprete). Nou kaptire tèks brit la ANVAN nou eseye
  // fè JSON.parse — si sa echwe, nou wè EGZAKTEMAN sa sèvè a te voye.
  const rawText = await res.text();
  let data: any;
  try { data = rawText ? JSON.parse(rawText) : {}; }
  catch {
    logger.error(`Didit API — repons PA JSON (estati ${res.status})`, {
      endpoint, status: res.status, statusText: res.statusText,
      contentType: res.headers.get("content-type"),
      bodyPreview: rawText.slice(0, 300),
      urlAppele: url,
    });
    throw new Error(`Didit a retounen yon repons envalid (${res.status} ${res.statusText}) — verifye DIDIT_BASE_URL/DIDIT_API_KEY.`);
  }

  if (!res.ok) {
    const err = data as { detail?: string; message?: string };
    const msg = err.detail || err.message || `HTTP ${res.status}`;
    logger.error(`Didit API error ${res.status}`, {
      endpoint, error: msg, statusText: res.statusText,
      urlAppele: url, fullResponseBody: data,
    });
    throw new Error(msg);
  }

  logger.debug(`Didit OK ${endpoint}`, { status: res.status });
  return data as T;
}

// ── Wrapper GET ───────────────────────────────────────────────
async function diditGet<T>(endpoint: string): Promise<T> {
  const url = `${BASE_URL}${endpoint}`;
  logger.debug(`Didit GET ${endpoint}`);

  const res = await fetch(url, {
    method: "GET",
    headers: authHeaders(),
  });

  const rawText = await res.text();
  let data: any;
  try { data = rawText ? JSON.parse(rawText) : {}; }
  catch {
    logger.error(`Didit API — repons PA JSON (estati ${res.status})`, {
      endpoint, status: res.status, statusText: res.statusText,
      bodyPreview: rawText.slice(0, 300), urlAppele: url,
    });
    throw new Error(`Didit a retounen yon repons envalid (${res.status} ${res.statusText})`);
  }

  if (!res.ok) {
    const err = data as { detail?: string };
    logger.error(`Didit API error ${res.status}`, { endpoint, error: err.detail, urlAppele: url, fullResponseBody: data });
    throw new Error(err.detail || `HTTP ${res.status}`);
  }

  return data as T;
}

// ── Wrapper PATCH ─────────────────────────────────────────────
async function diditPatch<T>(endpoint: string, body: object): Promise<T> {
  const url = `${BASE_URL}${endpoint}`;

  const res = await fetch(url, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });

  const data = await res.json() as T;
  if (!res.ok) {
    const err = data as { detail?: string };
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return data;
}

// ── Wrapper DELETE ────────────────────────────────────────────
async function diditDelete(endpoint: string): Promise<void> {
  const url = `${BASE_URL}${endpoint}`;

  const res = await fetch(url, {
    method: "DELETE",
    headers: authHeaders(),
  });

  if (!res.ok) {
    const data = await res.json() as { detail?: string };
    throw new Error(data.detail || `HTTP ${res.status}`);
  }
}

// ============================================================
// DiditService — API complète
// ============================================================

export const DiditService = {

  // ── Sessions (flow KYC complet hosted) ─────────────────────

  sessions: {
    /**
     * Créer une session KYC — retourne une URL à envoyer à l'utilisateur
     * L'utilisateur complète la vérification sur la page Didit hébergée
     */
    async create(req: DiditCreateSessionRequest): Promise<DiditSession> {
      logger.info("Création session KYC Didit", {
        workflow: req.workflow_id,
        vendorData: req.vendor_data,
      });
      return diditPost<DiditSession>("/v3/session/", req);
    },

    /**
     * Récupérer les détails et résultats d'une session
     */
    async get(sessionId: string): Promise<DiditVerificationResult> {
      return diditGet<DiditVerificationResult>(`/v3/sessions/${sessionId}/`);
    },

    /**
     * Mettre à jour manuellement le statut d'une session
     * (ex: approuver ou rejeter manuellement)
     */
    async updateStatus(sessionId: string, status: string): Promise<unknown> {
      return diditPatch(`/v3/sessions/${sessionId}/status/`, { status });
    },

    /**
     * Générer un rapport PDF de la session
     */
    async generatePDF(sessionId: string): Promise<{ url: string }> {
      return diditPost(`/v3/sessions/${sessionId}/generate-pdf/`, {});
    },

    /**
     * Supprimer une session (RGPD)
     */
    async delete(sessionId: string): Promise<void> {
      return diditDelete(`/v3/sessions/${sessionId}/`);
    },
  },

  // ── APIs Standalone (sans session) ─────────────────────────

  standalone: {
    /**
     * Vérification de document d'identité (OCR + authenticité)
     * Retourne les données extraites + score d'authenticité
     */
    async idVerification(req: DiditIDVerificationRequest): Promise<unknown> {
      logger.info("Didit standalone ID verification");
      return diditPost("/v3/id-verification/", req);
    },

    /**
     * Détection de vivacité passive (anti-deepfake)
     */
    async passiveLiveness(req: DiditLivenessRequest): Promise<unknown> {
      return diditPost("/v3/passive-liveness/", req);
    },

    /**
     * Comparaison de deux visages (score de similarité 0-100)
     */
    async faceMatch(req: DiditFaceMatchRequest): Promise<unknown> {
      return diditPost("/v3/face-match/", req);
    },

    /**
     * Recherche faciale 1:N contre toutes les sessions approuvées
     */
    async faceSearch(selfie: string): Promise<unknown> {
      return diditPost("/v3/face-search/", { selfie });
    },

    /**
     * Estimation d'âge à partir d'un selfie
     */
    async ageEstimation(selfie: string): Promise<{ estimated_age: number }> {
      return diditPost("/v3/age-estimation/", { selfie });
    },

    /**
     * Screening AML contre 1300+ listes de sanctions / PEP
     */
    async amlScreening(req: DiditAMLRequest): Promise<unknown> {
      logger.info("Didit AML screening", { name: `${req.first_name} ${req.last_name}` });
      return diditPost("/v3/aml-screening/", req);
    },

    /**
     * Vérification de preuve d'adresse
     */
    async proofOfAddress(document: string): Promise<unknown> {
      return diditPost("/v3/proof-of-address/", { document });
    },

    /**
     * Validation base de données gouvernementale (18+ pays)
     */
    async databaseValidation(data: object): Promise<unknown> {
      return diditPost("/v3/database-validation/", data);
    },
  },

  // ── Webhook signature ─────────────────────────────────────

  /**
   * Récupérer la configuration webhook (pour obtenir le secret)
   */
  async getWebhookConfig(): Promise<unknown> {
    return diditGet("/v3/webhook/");
  },
};
