// ============================================================
// morningGreeting.cron — bonjou chak maten + rapèl biometrik
// ============================================================
// ✅ NOUVO v105.
//
// 1. BONJOU: chak maten nou di bonjou moun nan e nou di l mèsi pou konfyans
//    li. Mesaj la varye (7 vèsyon) pou l pa vin yon bagay repetitif moun nan
//    fèmen.
//
// 2. RAPÈL BIOMETRIK: "de tanzantan" yon push envite moun nan aktive Face ID
//    /anprent. App la (mobil) louvri yon modal lè li resevwa l. Nou voye l
//    SÈLMAN 1 fwa chak 7 jou pou nou pa anmède moun nan — e nou sispann nèt
//    depi li aktive l (app la di nou atravè `PATCH /api/users/biometric`).
//
// ⚠️ LIMIT RENDER — LI SA A:
// Sou plan gratis/estanda Render, sèvis la DÒMI apre inaktivite. Yon
// `setTimeout` ki t ap tann jouk 12:00 UTC PA GEN GARANTI li kouri: si
// sèvis la dòmi a 11:00, minitè a mouri avè l. Se MENM limit ki deja
// afekte `subscription.cron.ts` la — pa yon bagay nouvo.
// Pou yon garanti reyèl, fò w gen youn nan:
//   • Yon Render Cron Job (sèvis apa) ki rele `POST /api/cron/morning`
//   • Oswa yon sèvis deyò (cron-job.org, GitHub Actions) ki rele l
// Se poutèt sa nou EXPÒTE `runMorningGreeting()` epi nou bay yon wout
// pwoteje — konsa toude apwòch yo mache.
import { db } from "../db/store";
import { getSupabase } from "../db/supabase";
import { PushNotificationService } from "../services/pushNotification.service";
import { logger } from "../utils/logger";

/** Konbyen jou ant 2 rapèl biometrik. */
const BIOMETRIC_REMINDER_DAYS = 7;

/** Mesaj bonjou yo — youn pa jou nan semèn nan, konsa yo pa repete. */
const GREETINGS = [
  { title: "Bonjou ☀️", body: "Bon dimanche ! Merci de faire confiance à Freda Pay." },
  { title: "Bonjou ☀️", body: "Bonne semaine ! Merci pour votre confiance." },
  { title: "Bonjou ☀️", body: "Bonne journée ! Merci de nous faire confiance." },
  { title: "Bonjou ☀️", body: "Bon mercredi ! Merci pour votre confiance." },
  { title: "Bonjou ☀️", body: "Bonne journée ! On est là si vous avez besoin." },
  { title: "Bonjou ☀️", body: "Bon vendredi ! Merci de faire confiance à Freda Pay." },
  { title: "Bonjou ☀️", body: "Bon samedi ! Merci pour votre confiance." },
];

/**
 * Voye bonjou a + rapèl biometrik la.
 * Idempotan: si l kouri 2 fwa nan menm jounen an, `last_greeted_on` anpeche
 * yon dezyèm push (kolòn nan se yon DATE, pa yon timestamp).
 */
export async function runMorningGreeting(): Promise<{ greeted: number; bioReminders: number }> {
  const sb = getSupabase();
  const today = new Date().toISOString().slice(0, 10);   // YYYY-MM-DD
  const greeting = GREETINGS[new Date().getUTCDay()];

  let greeted = 0;
  let bioReminders = 0;

  // Sèlman moun ki gen yon token push — pa gen sans travèse tout baz la.
  const { data: tokens } = await sb.from("push_tokens").select("user_id");
  const userIds: string[] = Array.from(new Set(((tokens || []) as any[]).map((t) => String(t.user_id)).filter(Boolean)));

  for (const userId of userIds) {
    try {
      const user = await db.users.findById(userId);
      if (!user) continue;

      const u = user as any;

      // ── 1. Bonjou (yon sèl fwa pa jou) ──────────────────
      if (u.lastGreetedOn !== today && u.last_greeted_on !== today) {
        await PushNotificationService.sendToUser(userId, greeting.title, greeting.body, { kind: "morning_greeting" });
        await sb.from("users").update({ last_greeted_on: today }).eq("id", userId);
        greeted++;
      }

      // ── 2. Rapèl biometrik (si l poko aktive) ───────────
      // `biometric_enabled` mete a `true` pa app la lè moun nan aktive l.
      if (!u.biometricEnabled && !u.biometric_enabled) {
        const last = u.biometricPromptedAt || u.biometric_prompted_at;
        const daysSince = last ? (Date.now() - new Date(last).getTime()) / 86_400_000 : 999;
        if (daysSince >= BIOMETRIC_REMINDER_DAYS) {
          await PushNotificationService.sendToUser(
            userId,
            "🔐 Sécurisez votre compte",
            "Activez Face ID ou votre empreinte pour protéger votre argent et confirmer vos transactions plus vite.",
            // `kind` la se sa app la li pou l louvri modal la.
            { kind: "biometric_prompt" }
          );
          await sb.from("users").update({ biometric_prompted_at: new Date().toISOString() }).eq("id", userId);
          bioReminders++;
        }
      }
    } catch (e: any) {
      // Yon moun ki echwe PA DWE kanpe tout rès la.
      logger.warn("[MORNING] echèk pou yon itilizatè", { userId, error: e?.message });
    }
  }

  logger.info("[MORNING] Fini", { greeted, bioReminders, total: userIds.length });
  return { greeted, bioReminders };
}

// ── Scheduler (best-effort — wè limit Render anwo a) ─────────
export function scheduleMorningGreeting(): void {
  // 12:00 UTC ≈ 7h00 nan Ayiti (EST) / 8h00 (EDT).
  const now  = new Date();
  const next = new Date(now);
  next.setUTCHours(12, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  const delay = next.getTime() - now.getTime();

  setTimeout(() => {
    runMorningGreeting().catch((e) => logger.error("[MORNING] Fatal", { e }));
    setInterval(() => {
      runMorningGreeting().catch((e) => logger.error("[MORNING] Fatal", { e }));
    }, 24 * 60 * 60 * 1000);
  }, delay);

  logger.info(`[MORNING] Prochain bonjour dans ${Math.round(delay / 1000 / 60)} minutes`);
}
