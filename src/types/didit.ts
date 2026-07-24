// ============================================================
// Types Didit KYC API v3
// Docs: https://docs.didit.me/integration/webhooks (schema ofisyèl konfime)
// Base URL: https://verification.didit.me
// Auth: x-api-key header
// ============================================================

// ── Session ───────────────────────────────────────────────────

export interface DiditCreateSessionRequest {
  workflow_id: string;          // ID du workflow configuré dans le dashboard
  vendor_data?: string;         // Votre ID utilisateur interne (pour lier la session)
  callback?: string;            // URL de redirection après vérification
  locale?: string;              // Langue (fr, en, es...)
}

export interface DiditSession {
  session_id: string;
  url: string;                  // URL hosted page à envoyer à l'utilisateur
  status: DiditSessionStatus;
  workflow_id: string;
  vendor_data?: string;
  created_at: string;
  updated_at: string;
  expires_at?: string;
}

// ✅ FIX: estati OFISYÈL yo (konfime pa dokiman) — "Resubmitted" ak
// "Kyc Expired" (yon SÈL "K" majiskil, espas ladan l) te manke anvan.
export type DiditSessionStatus =
  | "Not Started" | "In Progress" | "Approved" | "Declined"
  | "In Review" | "Abandoned" | "Resubmitted" | "Expired" | "Kyc Expired"
  | "Awaiting User";

// ── Warning (V3 — objè konplè, PA yon senp kòd tèks) ──────────
// ✅ FIX: mwen te sipoze `warnings[]` te yon lis kòd tèks senp
// (egzanp "NO_FACE_DETECTED"). An reyalite se yon lis OBJÈ ki gen
// deja yon deskripsyon LIZIB Didit bay dirèkteman (short/long_description) —
// pa bezwen nou tradwi kòd yo nou menm si nou pa vle.
export interface DiditWarning {
  feature:            string;   // egzanp: "LIVENESS", "FACEMATCH", "ID_VERIFICATION"
  risk:               string;   // kòd la, egzanp: "LOW_LIVENESS_SCORE"
  additional_data:    unknown;
  log_type:           "error" | "warning" | "info" | string;
  short_description:  string;   // egzanp: "Low face match similarity"
  long_description:   string;   // fraz konplè eksplikatif
  node_id:            string;
}

// ── Decision — chak "feature" se yon TAB (plural arrays V3) ───
export interface DiditLivenessCheck {
  node_id: string;
  status:  DiditSessionStatus;
  method?: "PASSIVE" | "ACTIVE_3D" | "FLASHING";
  score?:  number;
  warnings?: DiditWarning[];
}

export interface DiditIdVerification {
  node_id: string;
  status:  DiditSessionStatus;
  document_type?:     string;
  document_number?:   string;
  first_name?:         string;
  last_name?:          string;
  date_of_birth?:      string;
  issuing_state?:      string;
  expiration_date?:    string;
  nationality?:        string;
  warnings?: DiditWarning[];
}

export interface DiditFaceMatch {
  node_id: string;
  status:  DiditSessionStatus;
  score?:  number;
  warnings?: DiditWarning[];
}

export interface DiditAmlScreening {
  node_id: string;
  status:  DiditSessionStatus;
  entity_type?: "person" | "company";
  total_hits?:  number;
  hits?:        unknown[];
  warnings?: DiditWarning[];
}

// ✅ Objè "decision" konplè — se sa ki nan `payload.decision` sou WEBHOOK,
// e se MENM SCHEMA a GET /v3/session/{id}/decision/ retounen.
export interface DiditDecision {
  session_id:      string;
  session_number?: number;
  status:          DiditSessionStatus;
  workflow_id?:    string;
  vendor_data?:    string;
  features:        string[];  // egzanp: ["ID_VERIFICATION","LIVENESS","FACE_MATCH","AML"]
  id_verifications?: DiditIdVerification[];
  liveness_checks?:  DiditLivenessCheck[];
  face_matches?:      DiditFaceMatch[];
  aml_screenings?:    DiditAmlScreening[];
  reviews?:            unknown[];
  created_at?:          string;
}

// ── Résultat de vérification (GET /v3/sessions/{id}/) ──────────
export interface DiditVerificationResult {
  session_id: string;
  status: DiditSessionStatus;
  vendor_data?: string;
  decision?: DiditDecision;
  created_at: string;
  updated_at: string;
}

// ── Webhooks Didit ────────────────────────────────────────────
// ✅ FIX: dokiman ofisyèl la konfime lis KONPLÈ 10 evènman yo — mwen te
// manke plizyè (travel_rule.status.updated, elt.)
export type DiditWebhookEvent =
  | "status.updated"
  | "data.updated"
  | "user.status.updated"
  | "user.data.updated"
  | "business.status.updated"
  | "business.data.updated"
  | "activity.created"
  | "transaction.created"
  | "transaction.status.updated"
  | "travel_rule.status.updated";

export interface DiditWebhookPayload {
  event_id:         string;
  // ✅ FIX KRITIK: chan REYÈL la se `webhook_type`, PA `event`. Nou kenbe
  // `event` kòm alyas entèn (ranpli manyèlman nan wout la) pou pa kraze
  // rès kòd la ki deja itilize `payload.event`.
  webhook_type?:    DiditWebhookEvent;
  event?:           DiditWebhookEvent;
  session_id?:      string;
  business_session_id?: string;
  session_kind?:    "business";
  vendor_data?:     string;
  vendor_business_id?: string;
  status?:          DiditSessionStatus;
  workflow_id?:     string;
  workflow_version?: number;
  application_id?:  string;
  environment?:     "live" | "sandbox";
  metadata?:        Record<string, unknown>;
  trigger?:         "manual_review" | "manual_step_update" | "ongoing_monitoring";
  // ✅ FIX: done verifikasyon yo rive nan `decision`, PA `data`.
  decision?:        DiditDecision;
  resubmit_info?:   { nodes_to_resubmit: { node_id: string; feature: string }[]; reasons: Record<string,string> };
  timestamp: number | string;
  created_at?: number | string;
  [key: string]: unknown;
}

// ── Standalone APIs ───────────────────────────────────────────

export interface DiditIDVerificationRequest {
  document_front: string;       // Base64 image
  document_back?: string;       // Base64 image (optionnel)
  selfie?: string;              // Base64 image pour face match
}

export interface DiditLivenessRequest {
  selfie: string;               // Base64 image
}

export interface DiditFaceMatchRequest {
  face1: string;                // Base64
  face2: string;                // Base64
}

export interface DiditAMLRequest {
  first_name: string;
  last_name: string;
  date_of_birth?: string;
  country?: string;
}

// ── DB KYC interne ────────────────────────────────────────────

export interface DbKycSession {
  id: string;
  userId: string;
  email: string;
  sessionId: string;            // ID Didit
  sessionUrl: string;           // URL hosted page
  status: DiditSessionStatus;
  workflowId: string;
  verificationData?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}
