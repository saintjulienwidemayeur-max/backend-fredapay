// ============================================================
// Routes KYC Freda Pay — Intégration Didit
// Base: /api/kyc
// ============================================================

import { Router, Request, Response } from "express";
import crypto from "crypto";
import { requireAuth as authenticateToken } from "../middleware/auth";
import { DiditService } from "../services/didit.service";
import { db } from "../db/store";
import { logger } from "../utils/logger";
import { NotificationService } from "../services/notification.service";
import type { DiditWebhookPayload, DbKycSession, DiditDecision, DiditWarning } from "../types/didit";

const router = Router();

// Workflow ID configuré dans dashboard Didit
// Workflow ID trouve nan business.didit.me → Workflows → votre workflow → copier ID
// ✅ FIX: pa itilize DIDIT_APP_ID kòm fallback — Application ID ak Workflow ID
// se 2 resous DIFERAN nan Didit (App ID idantifye aplikasyon an nan Console,
// Workflow ID idantifye yon workflow espesifik). Voye DIDIT_APP_ID bay Didit
// kòm si se te workflow_id toujou bay "Invalid workflow_id" (400).
// Vrè Workflow ID a (konfime dirèkteman nan business.didit.me → Workflows
// → paj workflow la) mete an dur kòm fallback pou kontinye fonksyone menm
// si DIDIT_WORKFLOW_ID pa konfigire (oswa mal konfigire) sou Render —
// varyab la toujou pran priyorite si li prezan.
const WORKFLOW_ID = process.env.DIDIT_WORKFLOW_ID || "fec5013a-aa29-46e8-a962-429cdc997dcc";

// ── POST /api/kyc/start ───────────────────────────────────────
// Démarrer une session KYC pour un utilisateur
router.post("/start", authenticateToken, async (req: Request, res: Response) => {
  const { userId, email, locale = "fr", platform } = req.body;

  if (!userId || !email) {
    res.status(400).json({ error: "userId et email requis" });
    return;
  }

  if (!WORKFLOW_ID) {
    res.status(500).json({ error: "DIDIT_WORKFLOW_ID non configuré dans .env — trouvez-le sur business.didit.me → Workflows" });
    return;
  }

  // Vérifier si une session KYC active existe déjà
  const existing = await db.kyc.findByUserId(userId);
  if (existing && existing.status === "Approved") {
    res.json({
      success: true,
      alreadyApproved: true,
      message: "Utilisateur déjà vérifié",
      data: existing,
    });
    return;
  }

  try {
    logger.info("Démarrage session KYC", { userId, email });

    // ✅ FIX: mobil la louvri sesyon Didit la nan yon navigatè ANNDAN app la
    // (`expo-web-browser`) — si "callback" a se yon URL WEB (fredapay.com),
    // navigatè a ta redirije sou SIT WEB la apre KYC fini, PA retounen sou
    // app mobil la otomatikman. `fredapay://kyc/callback` se yon "deep
    // link" — Expo (`WebBrowser.openAuthSessionAsync`) rekonèt redireksyon
    // sa a espesifikman e fèmen navigatè a otomatikman, retounen kontwòl
    // bay app la san itilizatè a pa bezwen fè anyen manyèlman.
    const callback = platform === "mobile"
      ? "fredapay://kyc/callback"
      : `${process.env.FRONTEND_URL || "http://localhost:5173"}/kyc/callback`;

    const session = await DiditService.sessions.create({
      workflow_id: WORKFLOW_ID,
      vendor_data: userId,       // Lier la session à notre userId interne
      callback,
      locale,
    });

    // Sauvegarder en DB
    const dbSession = await db.kyc.upsert({
      userId,
      email,
      sessionId: session.session_id,
      sessionUrl: session.url,
      status: "Not Started",
      workflowId: WORKFLOW_ID,
    });

    logger.info("Session KYC créée", { sessionId: session.session_id, userId });

    res.status(201).json({
      success: true,
      data: {
        sessionId: session.session_id,
        verificationUrl: session.url,   // URL à ouvrir dans l'app
        status: "Not Started",
        expiresAt: session.expires_at,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur Didit";
    logger.error("Échec création session KYC", { userId, error: message });
    res.status(502).json({ error: message });
  }
});

// ── GET /api/kyc/status/:userId ───────────────────────────────
// Statut KYC d'un utilisateur
router.get("/status/:userId", authenticateToken, async (req: Request, res: Response) => {
  const { userId } = req.params;
  const session = await db.kyc.findByUserId(userId);

  if (!session) {
    res.json({
      success: true,
      status: "not_started",
      verified: false,
    });
    return;
  }

  res.json({
    success: true,
    status: session.status,
    verified: session.status === "Approved",
    sessionId: session.sessionId,
    updatedAt: session.updatedAt,
    completedAt: session.completedAt,
    data: session.status === "Approved" ? session.verificationData : undefined,
  });
});

// ── GET /api/kyc/session/:sessionId ──────────────────────────
// Détails complets d'une session via Didit API
router.get("/session/:sessionId", async (req: Request, res: Response) => {
  const { sessionId } = req.params;

  try {
    const result = await DiditService.sessions.get(sessionId);

    // Mettre à jour DB si le statut a changé
    const local = await db.kyc.findBySessionId(sessionId);
    if (local && result.status !== local.status) {
      await db.kyc.updateStatus(sessionId, result.status as DbKycSession["status"]);
      if (result.status === "Approved" || result.status === "Declined") {
        await db.kyc.updateVerificationData(sessionId, result);
      }
    }

    res.json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur";
    res.status(502).json({ error: message });
  }
});

// ── POST /api/kyc/pdf/:sessionId ──────────────────────────────
// Générer un rapport PDF de la vérification
router.post("/pdf/:sessionId", async (req: Request, res: Response) => {
  const { sessionId } = req.params;

  try {
    const result = await DiditService.sessions.generatePDF(sessionId);
    res.json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur";
    res.status(502).json({ error: message });
  }
});

// ── DELETE /api/kyc/session/:sessionId ───────────────────────
// Supprimer une session (RGPD — droit à l'oubli)
router.delete("/session/:sessionId", async (req: Request, res: Response) => {
  const { sessionId } = req.params;

  try {
    await DiditService.sessions.delete(sessionId);
    await db.kyc.deleteBySessionId(sessionId);
    logger.info("Session KYC supprimée (RGPD)", { sessionId });
    res.json({ success: true, message: "Session supprimée" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur";
    res.status(502).json({ error: message });
  }
});

// ── POST /api/kyc/aml ─────────────────────────────────────────
// Screening AML direct (sans session complète)
router.post("/aml", async (req: Request, res: Response) => {
  const { first_name, last_name, date_of_birth, country } = req.body;

  if (!first_name || !last_name) {
    res.status(400).json({ error: "first_name et last_name requis" });
    return;
  }

  try {
    const result = await DiditService.standalone.amlScreening({
      first_name, last_name, date_of_birth, country,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur AML";
    res.status(502).json({ error: message });
  }
});

// ── GET /api/kyc/all ──────────────────────────────────────────
// Toutes les sessions KYC (admin)
router.get("/all", async (_req: Request, res: Response) => {
  const sessions = await db.kyc.list();
  const stats = {
    total: sessions.length,
    approved: sessions.filter(s => s.status === "Approved").length,
    pending: sessions.filter(s => s.status === "Not Started" || s.status === "In Progress").length,
    declined: sessions.filter(s => s.status === "Declined").length,
  };
  res.json({ success: true, stats, data: sessions });
});

// ── Verifikasyon siyati Didit — swiv kòd ofisyèl la mo pa mo ────
// Dokiman: docs.didit.me/integration/webhooks

/** Match Didit's float normalisation: whole-valued floats sérialize kòm int. */
function shortenFloats(data: unknown): unknown {
  if (Array.isArray(data)) return data.map(shortenFloats);
  if (data !== null && typeof data === "object") {
    return Object.fromEntries(
      Object.entries(data as Record<string, unknown>).map(([k, v]) => [k, shortenFloats(v)])
    );
  }
  if (typeof data === "number" && !Number.isInteger(data) && data % 1 === 0) {
    return Math.trunc(data);
  }
  return data;
}

/** Triye kle objè yo rekursivman anvan re-sérialize. */
function sortKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(sortKeys);
  if (obj !== null && typeof obj === "object") {
    return Object.keys(obj as Record<string, unknown>).sort().reduce((acc: Record<string, unknown>, key) => {
      acc[key] = sortKeys((obj as Record<string, unknown>)[key]);
      return acc;
    }, {});
  }
  return obj;
}

/**
 * X-Signature-V2 — METÒD REKÒMANDE. Siyen yon fòm JSON KANONIK (kle triye,
 * separatè kout, Unicode prezève) rekonstwi apati JSON DEJA ANALIZE a — sa
 * vle di li mache MENM SI middleware ou a re-ekri/re-fòmate rawBody a, ki
 * te egzakteman pwoblèm nou te genyen ak `express.json()`/`rawBody` avan.
 */
function verifyDiditSignatureV2(body: Record<string, unknown>, sigHeader: string, tsHeader: string, secret: string): boolean {
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(tsHeader, 10)) > 300) return false;

  const canonical = JSON.stringify(sortKeys(shortenFloats(body)));
  const expected  = crypto.createHmac("sha256", secret).update(canonical, "utf8").digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(sigHeader, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * X-Signature-Simple — fallback ki otantifye SÈLMAN anvlòp la
 * ("{timestamp}:{session_id}:{status}:{webhook_type}"), PA `decision` a.
 */
function verifyDiditSignatureSimple(body: Record<string, unknown>, sigHeader: string, tsHeader: string, secret: string): boolean {
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(tsHeader, 10)) > 300) return false;

  const canonical = [
    body.timestamp ?? "", body.session_id ?? "", body.status ?? "", body.webhook_type ?? "",
  ].join(":");
  const expected = crypto.createHmac("sha256", secret).update(canonical).digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(sigHeader, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── POST /api/kyc/webhook ─────────────────────────────────────
// Webhook Didit — reçoit les mises à jour de statut en temps réel
router.post("/webhook", async (req: Request & { rawBody?: Buffer }, res: Response) => {
  // ✅ REFÈ KONPLÈTMAN — swiv dokiman ofisyèl Didit egzakteman
  // (docs.didit.me/integration/webhooks). Chanjman kle yo:
  //  1. Chan evènman an se `webhook_type`, PA `event`.
  //  2. Metòd rekòmande a se X-Signature-V2 (siyen yon fòm JSON KANONIK —
  //     kle triye, separatè kout, Unicode prezève — PA bit brit yo). Sa
  //     rezoud/evite konplètman pwoblèm "rawBody" nou te goumen avè l la,
  //     paske li rekonstwi siyati a apati JSON deja analize a, yon fason
  //     ki idantik kèlkeswa ki middleware ki manipile stream lan.
  //  3. X-Signature-Simple se yon fallback ki siyen SÈLMAN "{timestamp}:
  //     {session_id}:{status}:{webhook_type}" — otantifye anvlòp la
  //     sèlman, PA `decision` a.
  //  4. X-Timestamp DWE valide (rejte si li gen plis pase 5 minit).
  const rawBody: Record<string, unknown> = req.body || {};
  const webhookType = (rawBody.webhook_type || rawBody.event) as string | undefined;

  const payload: DiditWebhookPayload = { ...rawBody, event: webhookType as any } as DiditWebhookPayload;

  if (!payload || !webhookType) {
    logger.warn("Webhook Didit: payload san 'webhook_type'", { keys: Object.keys(rawBody || {}) });
    res.status(400).json({ error: "Payload invalide" });
    return;
  }

  // ── Validation siyati (V2 → Simple, jan dokiman an rekòmande) ──
  const webhookSecret = process.env.DIDIT_WEBHOOK_SECRET;
  if (webhookSecret) {
    const sigV2     = req.headers["x-signature-v2"] as string | undefined;
    const sigSimple = req.headers["x-signature-simple"] as string | undefined;
    const timestamp = req.headers["x-timestamp"] as string | undefined;

    if (!timestamp) {
      logger.warn("Webhook Didit: X-Timestamp manke", { ip: req.ip });
      res.status(401).json({ error: "En-tête manquant" });
      return;
    }

    const verified = (sigV2 && verifyDiditSignatureV2(rawBody, sigV2, timestamp, webhookSecret))
      || (sigSimple && verifyDiditSignatureSimple(rawBody, sigSimple, timestamp, webhookSecret));

    if (!verified) {
      logger.warn("Signature webhook Didit invalide", { ip: req.ip, hasV2: !!sigV2, hasSimple: !!sigSimple });
      res.status(401).json({ error: "Signature invalide" });
      return;
    }
  }

  // ── Idempotence — Didit reesaye jiska 2 fwa si l pa jwenn yon 2xx
  // rapid; menm modèl ke webhook Maplerad la (kle sou event_id) ────
  const eventId = payload.event_id;
  if (eventId && await db.webhookEvents.isDuplicate(eventId).catch(() => false)) {
    logger.info(`Webhook Didit doublon ignoré: ${eventId}`);
    res.status(200).json({ received: true, duplicate: true });
    return;
  }
  const dbEvent = eventId
    ? await db.webhookEvents.insert({
        eventId, eventName: webhookType, cardId: payload.session_id || "",
        status: "pending", payload: rawBody, source: "didit",
      }).catch(() => null)
    : null;

  // ── Répondre immédiatement ────────────────────────────────
  res.status(200).json({ received: true, event: payload.event });

  // ── Traiter en async ──────────────────────────────────────
  logger.info(`Webhook Didit: ${payload.event}`, {
    sessionId: payload.session_id,
    status: payload.status,
  });

  try {
    await handleDiditWebhook(payload);
    if (dbEvent?.id) await db.webhookEvents.markProcessed(dbEvent.id).catch(() => null);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur";
    logger.error("Erreur traitement webhook Didit", { event: payload.event, error: message });
    if (dbEvent?.id) await db.webhookEvents.markFailed(dbEvent.id, message).catch(() => null);
  }
});

// ── Liveness Detection — rezon rejè klè bay kliyan an ───────────
// ✅ FIX: mwen te sipoze `warnings[]` te yon lis kòd tèks senp — an
// reyalite se yon lis OBJÈ (`DiditWarning`) ki DEJA gen yon deskripsyon
// lizib Didit bay dirèkteman (`short_description`). Nou tradwi kèk kòd
// kle an fransè pou itilizatè Ayisyen/frankofòn yo, ak yon fallback sou
// deskripsyon Didit a (angle) si kòd la pa nan lis nou an.
const WARNING_RISK_MESSAGES: Record<string, string> = {
  NO_FACE_DETECTED:
    "Aucun visage détecté. Assurez-vous d'être bien visible et dans un endroit bien éclairé, puis réessayez.",
  MULTIPLE_FACES_DETECTED:
    "Plusieurs visages détectés. Assurez-vous d'être seul(e) devant la caméra, puis réessayez.",
  LOW_LIVENESS_SCORE:
    "La qualité de la vérification était insuffisante. Réessayez dans un endroit bien éclairé, sans lunettes ni masque.",
  LIVENESS_FACE_ATTACK:
    "Une tentative de fraude a été détectée (photo, vidéo ou masque). Utilisez votre visage réel en direct.",
  FACE_IN_BLOCKLIST:
    "Ce profil ne peut pas être vérifié. Contactez le support pour plus d'informations.",
  POSSIBLE_FACE_IN_BLOCKLIST:
    "Une vérification manuelle supplémentaire est nécessaire. Contactez le support.",
  DUPLICATED_FACE:
    "Ce visage est déjà associé à un autre compte Freda Pay. Contactez le support si vous pensez qu'il s'agit d'une erreur.",
  POSSIBLE_DUPLICATED_FACE:
    "Une vérification manuelle supplémentaire est nécessaire. Contactez le support.",
  DOCUMENT_EXPIRED:
    "Votre pièce d'identité est expirée. Utilisez un document valide.",
  LOW_FACE_MATCH_SIMILARITY:
    "Le selfie ne correspond pas assez à la photo du document. Réessayez dans un endroit bien éclairé.",
};

/**
 * ✅ FIX: chèche nan TOUT tab "feature" yo (`liveness_checks`,
 * `id_verifications`, `face_matches`, `aml_screenings`) — pa sèlman
 * liveness — paske yon rejè ka soti nan nenpòt de yo.
 */
function extractDeclineReason(decision?: DiditDecision): string | undefined {
  if (!decision) return undefined;
  const allWarnings: DiditWarning[] = [
    ...(decision.liveness_checks   || []).flatMap(c => c.warnings || []),
    ...(decision.id_verifications  || []).flatMap(c => c.warnings || []),
    ...(decision.face_matches      || []).flatMap(c => c.warnings || []),
    ...(decision.aml_screenings    || []).flatMap(c => c.warnings || []),
  ];
  if (allWarnings.length === 0) return undefined;
  // Priyorite bay premye "error" (pa "warning"/"info") la — se sa ki
  // pi souvan REZON REYÈL rejè a.
  const primary = allWarnings.find(w => w.log_type === "error") || allWarnings[0];
  return WARNING_RISK_MESSAGES[primary.risk] || primary.short_description || undefined;
}

// ── Handler webhook Didit ─────────────────────────────────────
async function handleDiditWebhook(payload: DiditWebhookPayload): Promise<void> {
  const { event, session_id, status, vendor_data } = payload;

  switch (event) {
    case "status.updated": {
      if (!session_id || !status) return;

      const local = await db.kyc.findBySessionId(session_id);
      if (!local) { logger.warn("Session KYC inconnue", { session_id }); return; }

      await db.kyc.updateStatus(session_id, status as DbKycSession["status"]);

      const kycStatus =
        status === "Approved"  ? "approved" :
        status === "Declined"  ? "declined" :
        status === "In Review" ? "pending"  : "pending";

      await db.users.updateKycStatus(local.userId, kycStatus, session_id);

      if (status === "Approved") {
        NotificationService.kycStatusChanged(local.userId, "approved");
        logger.info("KYC APPROUVÉ", { sessionId: session_id, userId: local.userId });

        // ── Sove done KYC + upgrade Maplerad ────────────────
        void postKycApproved(local.userId, session_id, payload);

      } else if (status === "Declined") {
        // ✅ NOUVO: olye jis di "rejte" san detay, chèche si gen yon rezon
        // liveness espesifik (via `liveness_checks[]`) e bay yon mesaj klè,
        // aksyonab, jan katalòg avètisman Didit la rekòmande.
        const reason = extractDeclineReason(payload.decision);
        NotificationService.kycStatusChanged(local.userId, "declined", reason);
      } else if (status === "In Review") {
        NotificationService.kycStatusChanged(local.userId, "in_review");
      }
      break;
    }

    case "data.updated": {
      // ✅ FIX: chan reyèl la se `decision`, PA `data`.
      if (!session_id || !payload.decision) return;
      await db.kyc.updateVerificationData(session_id, payload.decision as any);

      // Tante extraie données ID si session connue
      const local2 = await db.kyc.findBySessionId(session_id);
      const doc = payload.decision.id_verifications?.[0];
      if (local2 && doc?.document_number) {
        await db.users.update(local2.userId, {
          kycIdNumber:  doc.document_number                   || undefined,
          kycIdType:    doc.document_type?.toUpperCase()      || undefined,
          kycIdCountry: doc.issuing_state?.toUpperCase()      || undefined,
          kycFirstName:   doc.first_name                       || undefined,
          kycLastName:    doc.last_name                        || undefined,
          kycNationality: doc.nationality?.toUpperCase()       || undefined,
        } as any).catch(() => null);
      }
      logger.info("Données KYC mises à jour", { session_id });
      break;
    }

    case "user.status.updated":
    case "user.data.updated":
      logger.info(`Événement Didit: ${event}`, { vendor_data });
      break;

    default:
      logger.debug(`Webhook Didit non géré: ${event}`);
  }
}

// ── Post-KYC: sove données + upgrade Maplerad automatiquement ─
async function postKycApproved(userId: string, sessionId: string, payload: DiditWebhookPayload): Promise<void> {
  try {
    const user = await db.users.findById(userId);
    if (!user) return;

    // ── 1. Extraire et sauvegarder données Didit ────────────
    // ✅ FIX: vrè chemen done yo se `payload.decision.id_verifications[0]`
    // (yon TAB, konfime pa dokiman ofisyèl la), PA `payload.data.document`
    // (ansyen estrikti nou te sipoze a pa t janm egziste vre).
    let decision: DiditDecision | undefined = payload.decision;

    if (!decision?.id_verifications?.length) {
      try {
        const { DiditService } = await import("../services/didit.service");
        const session = await DiditService.sessions.get(sessionId);
        decision = (session as any)?.decision || decision;
        if (decision) await db.kyc.updateVerificationData(sessionId, decision as any);
      } catch (e) {
        logger.warn("Impossible de fetch données Didit", { sessionId });
      }
    }

    const doc: Partial<import("../types/didit").DiditIdVerification> = decision?.id_verifications?.[0] || {};
    const docNo  = doc.document_number || "";
    const docTy  = (doc.document_type  || "PASSPORT").toUpperCase();
    const docCo  = (doc.issuing_state  || user.country || "HT").toUpperCase();
    const docDOB = doc.date_of_birth   || "";
    const docFirstName   = doc.first_name   || "";
    const docLastName    = doc.last_name    || "";
    const docNationality = (doc.nationality || "").toUpperCase();

    // Formatter DOB: Didit peut envoyer YYYY-MM-DD → garder tel quel pour DB
    const updates: Record<string, any> = {
      kycIdNumber:  docNo  || undefined,
      kycIdType:    docTy  || undefined,
      kycIdCountry: docCo  || undefined,
      kycFirstName:   docFirstName   || undefined,
      kycLastName:    docLastName    || undefined,
      kycNationality: docNationality || undefined,
    };

    // Mettre à jour dateOfBirth si pas encore défini
    if (docDOB && !(user as any).dateOfBirth) {
      updates.dateOfBirth = docDOB;
    }
    // Mettre à jour pays si pas encore défini
    if (docCo && !user.country) {
      updates.country = docCo;
    }

    await db.users.update(userId, updates as any).catch(() => null);
    logger.info("Données KYC Didit sauvegardées en DB", {
      userId, docNo: docNo.slice(0, 4) + "***", docTy, docCo,
    });

    // ── ✅ v69 — BLOKAJ OTOMATIK DOUB KONT (apre verifikasyon KYC) ──
    // Sizoka yon moun te kreye yon dezyèm kont ak yon FO non pou kontounen
    // kontwòl enskripsyon an, dokiman ofisyèl la revele vrè idantite l.
    // Lè sa a nou sispann kont ki PI NÈF la (nou kenbe pi ansyen an, ki
    // gen istorik tranzaksyon an), epi nou avèti moun nan.
    if (docFirstName && docLastName && docDOB) {
      try {
        const twins = await db.users.findIdentityTwins(userId, docFirstName, docLastName, docDOB);
        if (twins.length) {
          // Kont ki pi ansyen an = sèl kont lejitim nan.
          const all = [...twins, { ...user, id: userId, createdAt: user.createdAt }] as any[];
          all.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
          const legit = all[0];
          const dupes = all.slice(1);

          for (const dup of dupes) {
            await db.users.update(dup.id, { status: "suspended" } as any).catch(() => null);
            logger.warn("Doub kont sispann otomatikman apre KYC", {
              suspendedUserId: dup.id, legitUserId: legit.id, reason: "IDENTITY_DUPLICATE",
            });
            void NotificationService.system(dup.id,
              "Compte suspendu",
              "La vérification d'identité indique que vous possédez déjà un compte Freda Pay. " +
              "Ce compte a été suspendu. Contactez le support si vous pensez qu'il s'agit d'une erreur."
            ).catch(() => null);
          }
          if (dupes.some((d: any) => d.id === userId)) {
            logger.warn("Kont aktyèl la sispann — se yon doub", { userId });
          }
        }
      } catch (e: any) {
        // Yon echèk isit la pa dwe bloke validasyon KYC la.
        logger.warn("Tchèk doub kont apre KYC echwe", { userId, error: e.message });
      }
    }

    // ── 2. Upgrade Maplerad si customer existe ───────────────
    await autoUpgradeMaplerad(userId, user, { docNo, docTy, docCo, docDOB });

  } catch (e: any) {
    logger.error("Erreur post-KYC", { userId, error: e.message });
  }
}

// ── Auto-upgrade Maplerad après KYC ──────────────────────────
async function autoUpgradeMaplerad(
  userId: string,
  user: any,
  kyc: { docNo: string; docTy: string; docCo: string; docDOB: string }
): Promise<void> {
  try {
    const { MapleradCustomerService } = await import("../services/maplerad.service");

    let customerId = user.mapleradCustomerId;

    // Si pas encore de customer Maplerad → créer Tier 0 d'abord
    if (!customerId) {
      try {
        const res = await MapleradCustomerService.createCustomer({
          first_name: user.firstname,
          last_name:  user.lastname,
          email:      user.email,
          country:    user.country || "HT",
        });
        customerId = res.data.id;
        await db.users.update(userId, { mapleradCustomerId: customerId } as any).catch(() => null);
        logger.info("Tier 0 créé via post-KYC", { userId, customerId });
      } catch (e0: any) {
        // Déjà existant → récupérer ID
        if (e0.message?.includes("already")) {
          customerId = await MapleradCustomerService.findCustomerByEmail(user.email);
          if (customerId) {
            await db.users.update(userId, { mapleradCustomerId: customerId } as any).catch(() => null);
          }
        }
        if (!customerId) return;
      }
    }

    // Préparer données Tier 1
    const rawPhone  = (user.phone || "+50900000000").replace(/\s+/g, "");
    const phoneCode = rawPhone.match(/^\+\d{1,3}/)?.[0] || "+509";
    const phoneNum  = rawPhone.replace(/^\+\d{1,3}/, "") || rawPhone;

    // DOB formaté DD-MM-YYYY pour Maplerad
    const dobRaw = kyc.docDOB || user.dateOfBirth || "";
    let dobFmt = dobRaw;
    if (dobRaw && dobRaw.includes("-") && dobRaw.split("-")[0].length === 4) {
      const [y, m, d] = dobRaw.split("-");
      dobFmt = `${d}-${m}-${y}`;
    }

    // ── Upgrade Tier 1 ────────────────────────────────────────
    try {
      await MapleradCustomerService.upgradeTier1({
        customer_id:           customerId,
        dob:                   dobFmt || "01-01-1990",
        identification_number: kyc.docNo || user.email,
        phone: { phone_country_code: phoneCode, phone_number: phoneNum },
        address: {
          street:      user.address || "N/A",
          city:        user.city    || "Port-au-Prince",
          state:       user.city    || "Ouest",
          country:     user.country || "HT",
          postal_code: "HT6110",
        },
      });
      await db.users.update(userId, { mapleradTier: 1 } as any).catch(() => null);
      logger.info("✅ Maplerad Tier 1 upgrade après KYC", { userId, customerId });
    } catch (t1Err: any) {
      logger.info("Tier 1 déjà effectué ou erreur", { error: t1Err.message });
    }

    // ── Upgrade Tier 2 si numéro ID disponible ────────────────
    if (kyc.docNo) {
      try {
        await MapleradCustomerService.upgradeTier2({
          customer_id: customerId,
          identity: {
            type:    kyc.docTy,
            image:   "https://via.placeholder.com/400x300.jpg", // URL placeholder — Didit a déjà vérifié
            number:  kyc.docNo,
            country: kyc.docCo,
          },
        });
        await db.users.update(userId, { mapleradTier: 2 } as any).catch(() => null);
        logger.info("✅ Maplerad Tier 2 upgrade après KYC", { userId, customerId });
      } catch (t2Err: any) {
        logger.info("Tier 2 skip ou erreur", { error: t2Err.message });
      }
    }

    NotificationService.system(userId,
      "✅ Compte vérifié — Prêt à créer une carte !",
      "Votre identité a été vérifiée. Vous pouvez maintenant créer votre carte virtuelle USD sans formulaire supplémentaire."
    );

  } catch (e: any) {
    logger.error("Erreur auto-upgrade Maplerad post-KYC", { userId, error: e.message });
  }
}

export default router;
