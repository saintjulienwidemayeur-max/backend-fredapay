// ============================================================
// PushNotificationService — voye push atravè Expo Push API
// ============================================================
// Itilize Expo Push API (https://exp.host/--/api/v2/push/send) — pa mande
// okenn kle API, otantifikasyon fèt pa Expo pou app ki bati ak Expo.
//
// 🔴 FIX v68 — POUKISA PUSH YO PA T ALE (HTTP 400):
// Ansyen kòd la te voye `sound: "tambou.wav"` (yon senp chèn karaktè).
// Expo Push API VALIDE chan `sound` la, e li aksepte SÈLMAN 3 valè:
//   • "default"
//   • null
//   • yon OBJÈ (rezève pou "critical alerts" iOS)
// Yon chèn tankou "tambou.wav" → `VALIDATION_ERROR` → **HTTP 400**, e
// Expo REJTE mesaj la nèt (okenn push pa pati, ni iOS ni Android). Se
// egzakteman erè `Push notification échec HTTP {status:400}` nan log yo.
//
// ✅ KIJAN SON TANBOU A MACHE VRE:
//   • Android → son an chita nan CHANNEL la (`freda-tambou-v1`, kreye pa
//     app mobil la). Backend la voye `channelId` epi `sound: "default"`.
//     Android IYORE chan `sound` la lè channel la egziste — se channel la
//     ki jwe tanbou a. ✅ Tanbou a mache sou Android.
//   • iOS → ❌ son tanbou a PA KA MACHE via Expo Push. Sèvis push Expo a
//     PA sipòte son pèsonalize (sèlman API kliyan `expo-notifications`
//     sipòte l — konfime pa ekip Expo a). Pou yon son pèsonalize sou iOS
//     ou ta bezwen pale dirèkteman ak APNs. Donk nou voye `"default"`.
//
// ⚠️ NOU PA SÈVI AK FÒM OBJÈ A POU iOS: li fèt pou **critical alerts**,
// ki mande yon entitlement Apple espesyal. San li, APNs ka rejte
// notifikasyon an → push la pa rive ditou. Yon son sistèm ki RIVE pi bon
// pase yon son tanbou ki fè notifikasyon an disparèt.
import fetch from "node-fetch";
import { db } from "../db/store";
import { logger } from "../utils/logger";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

// ⚠️ Toude valè sa yo DWE rete idantik ak sa ki nan app mobil la
// (src/hooks/usePushNotifications.ts). Si w chanje son an, monte nimewo
// channel la (freda-tambou-v2) LA A epi nan app la AN MENM TAN — Android
// pa janm chanje son yon channel ki deja egziste.
const ANDROID_CHANNEL_ID = "freda-tambou-v1";
/** Channel san tanbou (notifikasyon ki pa merite yon son fò). */
const ANDROID_CHANNEL_SILENT = "freda-default-v1";

/** Kèk notifikasyon pa merite yon tanbou (egzanp "bonjou" maten an). */
const SILENT_TYPES = new Set(["system", "morning_greeting", "low_balance"]);

/** Fòma yon token Expo valid: `ExponentPushToken[...]` oswa `ExpoPushToken[...]`. */
function isExpoPushToken(t: string): boolean {
  return /^Expo(nent)?PushToken\[.+\]$/.test(t);
}

interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: "default";
  channelId?: string;
  priority: "high";
}

/**
 * Konstwi yon mesaj Expo VALID pou yon token, selon platfòm li.
 *
 * 🔊 KIJAN SON AN MACHE VRE (verifye nan sous ofisyèl Expo):
 *
 * • **Android** → son tanbou a MACHE. Li chita nan **CHANNEL** la
 *   (`freda-tambou-v1`), ki app la kreye ak `sound: "tambou.wav"`.
 *   Backend la jis bezwen voye `channelId` — Android jwe son channel la.
 *
 * • **iOS** → son tanbou a **PA KA MACHE via Expo Push**. Sèvis push
 *   Expo a pa sipòte son pèsonalize (sèlman API kliyan an sipòte l).
 *   Sèl fason: pale dirèkteman ak APNs, oswa yon Notification Service
 *   Extension. Donk sou iOS nou voye `"default"` = son sistèm nan.
 *
 * ⚠️ POUKISA NOU PA VOYE YON OBJÈ POU iOS:
 * Fòm objè a (`{critical, name, volume}`) egziste, MEN li fèt pou
 * **critical alerts**, ki mande yon **entitlement Apple espesyal**
 * (`com.apple.developer.usernotifications.critical-alerts`) Apple bay
 * sou demann sèlman. San entitlement sa a, APNs ka **rejte** notifikasyon
 * an — donk push la pa rive ditou. Pi bon yon son sistèm ki RIVE pase yon
 * son tanbou ki fè notifikasyon an disparèt.
 */
function buildMessage(
  to: string,
  platform: string | null,
  title: string,
  body: string,
  data: Record<string, unknown>,
  useTambou: boolean
): ExpoMessage {
  const isIOS = platform === "ios";

  const msg: ExpoMessage = {
    to,
    title,
    body,
    data,
    // Toujou "default": sou Android se channel la ki bay tanbou a; sou
    // iOS se sèl valè ki garanti livrezon.
    sound: "default",
    priority: "high",
  };

  // channelId itil sèlman sou Android; sou iOS li senpleman inyore.
  // `useTambou` chwazi ant channel tanbou a ak channel silansye a.
  if (!isIOS) msg.channelId = useTambou ? ANDROID_CHANNEL_ID : ANDROID_CHANNEL_SILENT;

  return msg;
}

export const PushNotificationService = {
  async sendToUser(userId: string, title: string, body: string, data: Record<string, unknown> = {}): Promise<void> {
    const type = String((data as any)?.type || (data as any)?.kind || "");
    const useTambou = !SILENT_TYPES.has(type);
    try {
      // ✅ v68: nou li `platform` ansanm ak token an.
      const rows = await db.pushTokens.findWithPlatformByUserId(userId);
      if (!rows.length) return;

      // Filtre token envalid AVAN voye: yon sèl token malfòme fè Expo
      // rejte TOUT lo a ak yon 400. (Se yon dezyèm sous posib pou 400 la.)
      const valid = rows.filter((r) => isExpoPushToken(r.token));
      if (!valid.length) return;

      // ✅ v70 FIX — `PUSH_TOO_MANY_EXPERIENCE_IDS`.
      //
      // Log Render an montre erè sa a: `TOUT push notifications nan menm
      // apèl la dwe pou menm pwojè a`. Sa rive lè yon itilizatè te
      // enstale app la sou de "pwojè" Expo diferan (egz. `@widedev/
      // freda-pay` ak `@widemayeur/freda-pay` — nòmalman apre yon
      // migrasyon nan yon lòt kont Expo). Chak enstalasyon te sove yon
      // token, epi tou de rete nan tab `push_tokens`. Lè nou voye yo
      // ansanm, Expo rejte TOUT lo a → **zewo push ale**.
      //
      // Solisyon: gwoupe token yo pa "pwojè" epi voye chak gwoup nan
      // pwòp apèl li. Konsa yon tokèn zonbi soti nan yon ansyen pwojè pa
      // ka anpeche vrè yo rive. (Nou pa ka konnen ki pwojè yon token
      // apatni nan payload la — Expo a pa mande sa — donk nou senpleman
      // separe pa 100, ki jene ka rejè a ki dekri nan log la lè menm
      // moun nan gen youn nan chak pwojè.)
      //
      // 🔴 Tokèn zonbi yo pral netwaye pi rapid apre koreksyon sa a: chak
      // gwoup ki jwenn `DeviceNotRegistered` retire nan DB imedyatman
      // (kòd anba a fè sa deja).
      const messages = valid.map((r) =>
        buildMessage(r.token, r.platform, title, body, data, useTambou)
      );

      /**
       * Divize `messages` an lo, epi voye chak lo separeman. Si yon lo
       * echwe (egzanp konfli pwojè), lòt yo kontinye. Sa vle di push la
       * ap **rive kèk kote** menm si youn nan token yo pwoblèm.
       */
      const chunkSize = 100;
      const chunks: ExpoMessage[][] = [];
      for (let i = 0; i < messages.length; i += chunkSize) {
        chunks.push(messages.slice(i, i + chunkSize));
      }

      // Voye chak chunk endepandan.
      const invalidTokens: string[] = [];
      await Promise.all(chunks.map(async (chunk, idx) => {
        try {
          const res = await sendChunk(chunk);
          if (!res.ok) {
            const errBody = await res.text().catch(() => "");
            // Ka espesyal: si Expo di TOO_MANY_EXPERIENCE_IDS, sa vle di
            // token yo mele pwojè. Nou re-eseye youn-pa-youn.
            if (errBody.includes("TOO_MANY_EXPERIENCE_IDS")) {
              logger.warn("Push: konfli pwojè detekte, retente youn-pa-youn", { userId, chunk: idx });
              await Promise.all(chunk.map(async (m) => {
                const r = await sendChunk([m]).catch(() => null);
                if (r && !r.ok) {
                  const body = await r.text().catch(() => "");
                  // Token ki soti nan yon pwojè ki pa nou an → zonbi.
                  // Retire l imedyatman pou l pa deranje nou ankò.
                  if (body.includes("MismatchSenderId") || body.includes("InvalidProviderToken")
                      || body.includes("experience")) {
                    invalidTokens.push(m.to);
                    logger.warn("Push: token nan yon lòt pwojè Expo, retire", { userId, token: m.to.slice(0, 30) });
                  } else {
                    logger.warn("Push notification échec HTTP (individuel)", { status: r.status, body: body.slice(0, 300), userId });
                  }
                } else if (r) {
                  await processTickets(await r.json().catch(() => null), [m], invalidTokens, userId);
                }
              }));
              return;
            }
            logger.warn("Push notification échec HTTP", { status: res.status, body: errBody.slice(0, 500), userId });
            return;
          }
          await processTickets(await res.json().catch(() => null), chunk, invalidTokens, userId);
        } catch (e: any) {
          logger.warn("Push chunk echwe", { userId, chunk: idx, error: e.message });
        }
      }));

      // Netwaye token mouri yo (yon sèl fwa, apre tout chunks yo fini).
      await Promise.all(invalidTokens.map((t) => db.pushTokens.unregister(t)));
    } catch (e: any) {
      // Push se "best effort" — yon echèk pa dwe janm kraze flux prensipal
      // la (antre DB a, notifikasyon nan app la).
      logger.warn("Push notification échec", { userId, error: e.message });
    }
  },
};

// ── Helpers ────────────────────────────────────────────────

async function sendChunk(chunk: ExpoMessage[]) {
  return fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
    },
    body: JSON.stringify(chunk),
  });
}

/**
 * Analize tikè Expo yo. Li mete token ki mouri (`DeviceNotRegistered`)
 * nan yon lis pou netwayaj apre. Yon token ki `DeviceNotRegistered` vle
 * di app la efase sou aparèy la — kenbe l nan DB a fè chak voye pi lan.
 */
async function processTickets(
  result: any,
  chunk: ExpoMessage[],
  invalidTokens: string[],
  userId: string
): Promise<void> {
  const tickets: any[] = Array.isArray(result?.data) ? result.data : [];
  tickets.forEach((t: any, i: number) => {
    if (t?.status === "error") {
      const errCode = t?.details?.error;
      if (errCode === "DeviceNotRegistered") invalidTokens.push(chunk[i].to);
      else logger.warn("Push ticket erè", { userId, errCode, message: t?.message });
    }
  });
}
