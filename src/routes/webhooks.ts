// ============================================================
// Webhooks Maplerad — Freda Pay LLC
// Route: POST /api/webhooks/maplerad
// ============================================================

import { Router, Request, Response } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { db } from "../db/store";
import { logger } from "../utils/logger";
import { NotificationService } from "../services/notification.service";
import { ReferralService } from "../services/referral.service";
import { LogoDevService } from "../services/logodev.service";

const router = Router();

// ✅ FIX: Maplerad itilize SVIX pou webhook yo — se PA yon HMAC senp sou payload la.
// Dokiman: https://maplerad.dev/docs/verifying-webhooks
// - Header yo se svix-id / svix-timestamp / svix-signature (PA maplerad-signature)
// - Kontni ki siyen an se "{svix_id}.{svix_timestamp}.{rawBody}" (PA payload sèl)
// - Algorithm se HMAC-SHA256 (PA SHA512), sekrè a dwe DEKODE base64 anvan (retire "whsec_" prefix)
// - Rezilta a base64 (PA hex), epi header la ka gen plizyè siyati separe pa espas ("v1,xxx v2,yyy")
// Ansyen kòd la te itilize yon fòmil konplètman diferan → li te rejte TOUT webhook yo an silans
// depi MAPLERAD_WEBHOOK_SECRET te konfigire, kidonk okenn kat pa t janm konfime (pending pou tout tan).
function validateMapleradSignature(svixId: string, svixTimestamp: string, rawBody: string, svixSignatureHeader: string): boolean {
  const secret = process.env.MAPLERAD_WEBHOOK_SECRET || "";
  if (!secret || !svixSignatureHeader || !svixId || !svixTimestamp) return false;

  const secretPart = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const candidates = svixSignatureHeader.split(" ").map(s => s.split(",")[1] || s);

  // ✅ FIX: dekodaj sekrè a ka swa base64 (estanda Svix.com) oswa hex/utf8 (si
  // Maplerad enplemante pwòp vèsyon yo). Nou eseye tou 3 posiblite yo pou
  // maksimize chans nou matche siyati Maplerad reyèlman voye a.
  const keyVariants: Buffer[] = [];
  try { keyVariants.push(Buffer.from(secretPart, "base64")); } catch {}
  keyVariants.push(Buffer.from(secretPart, "utf8"));
  if (/^[0-9a-fA-F]+$/.test(secretPart) && secretPart.length % 2 === 0) {
    try { keyVariants.push(Buffer.from(secretPart, "hex")); } catch {}
  }

  for (const key of keyVariants) {
    const expected = createHmac("sha256", key).update(signedContent).digest("base64");
    const match = candidates.some(sig => {
      if (sig.length !== expected.length) return false;
      try { return timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); } catch { return false; }
    });
    if (match) return true;
  }
  return false;
}

router.post("/maplerad", async (req: Request & { rawBody?: Buffer }, res: Response) => {
  res.status(200).json({ received: true });
  try {
    const svixId        = (req.headers["svix-id"] || "") as string;
    const svixTimestamp = (req.headers["svix-timestamp"] || "") as string;
    const svixSignature = (req.headers["svix-signature"] || "") as string;
    const rawBody   = req.rawBody?.toString("utf8") || JSON.stringify(req.body);

    if (process.env.MAPLERAD_WEBHOOK_SECRET && !validateMapleradSignature(svixId, svixTimestamp, rawBody, svixSignature)) {
      // ✅ DYAGNOSTIK: si sa toujou echwe apre fix la, sa ap montre nou EGZAKTEMAN
      // ki header ki manke oswa ki gen fòma diferan de sa nou tann.
      logger.warn("Webhook Maplerad: signature invalide — ignoré", {
        svixId, hasSvixId: !!svixId, hasSvixTimestamp: !!svixTimestamp,
        hasSvixSignature: !!svixSignature, svixSignaturePreview: svixSignature.slice(0, 20),
        allHeaderKeys: Object.keys(req.headers),
      });
      return;
    }

    const event     = req.body;
    const eventType = (event.event || event.type || "unknown") as string;
    logger.info(`Webhook Maplerad reçu: ${eventType}`, { ref: event.reference || event.id });

    const eventId = event.reference || event.id || `${eventType}-${Date.now()}`;
    if (eventId && await db.webhookEvents.isDuplicate(eventId).catch(() => false)) {
      logger.info(`Webhook Maplerad doublon ignoré: ${eventId}`);
      return;
    }

    const dbEvent = await db.webhookEvents.insert({
      eventId, eventName: eventType,
      cardId: event.card_id || event.id || "", status: "pending", payload: event,
    }).catch(() => null);

    try {
      await handleMapleradEvent(eventType, event);
      if (dbEvent?.id) await db.webhookEvents.markProcessed(dbEvent.id).catch(() => null);
    } catch (err: any) {
      logger.error(`Webhook Maplerad erreur: ${eventType}`, { error: err.message });
      if (dbEvent?.id) await db.webhookEvents.markFailed(dbEvent.id, err.message).catch(() => null);
    }
  } catch (e: any) {
    logger.error("Webhook Maplerad erreur globale", { error: e.message });
  }
});

async function handleMapleradEvent(eventType: string, data: any) {
  switch (eventType) {

    case "issuing.created.successful": {
      const ref  = data.reference;
      const card = data.card;
      if (!ref || !card) break;
      const userId = await getUserIdFromCardRef(ref);
      if (userId) {
        // ✅ FIX: itilize `ref` (menm cardid ki te sèvi lè kreyasyon an) pou GARANTI
        // nou mete ajou MENM ranje a — ansyen kòd la te itilize `card.id || ref`,
        // ki te ka kreye yon dezyèm ranje si card.id diferan de ref.
        // ✅ FIX: pa voye cardType/status jenerik ki ta ka ekrase rezo a (visa/mastercard)
        // deja anrejistre lè kreyasyon an — sèlman mete ajou sa webhook la konnen vre.
        // ✅ FIX: ekstrè `expiry` defansivman — dokiman/tip nou an pa presize non
        // egzat chan an, kidonk nou tcheke plizyè posiblite.
        const cardExpiry = card.expiry || card.expiry_date || card.exp_date ||
          (card.expiry_month && card.expiry_year ? `${card.expiry_month}/${String(card.expiry_year).slice(-2)}` : undefined);
        await db.cards.upsert({
          cardid: ref, userId,
          status: "active", balance: card.balance || 0, maskedPan: card.masked_pan,
          mapleradCardId: card.id, expiry: cardExpiry,
        });
        // ✅ FIX: `card.issuer` soti nan payload webhook Maplerad la e souvan
        // `undefined` — sa te fè fallback "Mastercard" la aktive PRESKE toutan,
        // menm pou yon kat Visa (menm bug ak kreyasyon an: "si se yon kat visa
        // kreye li ap plede di mastercard"). Nou gen VRÈ rezo a deja anrejistre
        // nan DB nou depi kreyasyon an (`card_type` — wè upsert pi wo a ki
        // eksprè PA ekrase l), kidonk sèvi ak sa a olye.
        const savedCard   = await db.cards.findByCardId(ref).catch(() => undefined);
        const networkRaw  = ((savedCard as any)?.card_type || card.issuer || "").toString().toUpperCase();
        const networkLabel = networkRaw === "VISA" ? "Visa" : "Mastercard";
        await NotificationService.system(userId,
          "Carte virtuelle activée",
          `Carte ${networkLabel} USD ···· ${card.masked_pan?.slice(-4) || "????"} active. Prête pour vos paiements en ligne.`
        );
        // ✅ v68 — parennaj: si moun sa a te envite pa yon lòt, peye
        // parennè a. Idanpotan (kontrent UNIQUE) → OK menm si kat sa a
        // pa premye a; rekonpans lan peye yon sèl fwa.
        void ReferralService.onRefereeCardCreated(userId);
      }
      logger.info("Carte Maplerad créée", { ref, cardId: card.id });
      break;
    }

    case "issuing.created.failed": {
      const ref    = data.reference;
      const userId = await getUserIdFromCardRef(ref);
      if (userId) {
        await db.cards.upsert({ cardid: ref, userId, status: "terminated" }).catch(() => null);

        // ✅ FIX KRITIK: ansyen kòd la te ranbouse yon montan FIKS $5.20 (520 cents)
        // san rapò ak sa ki te reyèlman debite. Depi fix minimòm $2 la aplike pou
        // TOUT kat yo, yon kat tokenized koute $14.00 (1400 cents) ak yon kat
        // débit koute $7.20 (720 cents) — ni yonn ni lòt pa egal $5.20. Yon kliyan
        // ki gen kat tokenized echwe ta pèdi $8.80 pou tout tan san repare sa a.
        // Kounye a nou chèche EGZAKTEMAN konbyen te debite (via `external_ref`
        // sou antre "card_creation_fee" ki te kreye lè kreyasyon an) epi nou
        // ranbouse menm montan an, ak yon fallback rezonab si antre a pa jwenn.
        const original = await db.ledger.findByExternalRef(ref).catch(() => undefined);
        const refundCents = (original?.net_amount as number) || (original?.gross_amount as number) || 720;

        await db.wallets.credit(userId, refundCents);
        await db.ledger.insert({
          userId, type: "refund", status: "completed", direction: "credit",
          grossCents: refundCents, feeCents: 0, netCents: refundCents,
          description: "Remboursement frais création carte (échec)",
        }).catch(() => null);
        await NotificationService.system(userId, "Création de carte échouée",
          `Création de carte échouée. Vos frais de $${(refundCents / 100).toFixed(2)} ont été remboursés.`);
      }
      break;
    }

    case "issuing.transaction": {
      const cardId = data.card_id;
      const userId = await getUserIdFromCardId(cardId);
      if (!userId) break;

      const amount   = data.amount || 0;
      const approved = (data.status || "").toUpperCase() === "SUCCESS";
      const mode     = data.mode;
      const txnType  = (data.type || "").toString().toUpperCase();
      const isTermination = data.is_termination === true;
      let processed  = false;

      // ✅ FIX KRITIK: konfime pa done pwodiksyon (yon rechajman te parèt kòm
      // "Carte de retrait" nan istorik kliyan an) — Maplerad rapòte evènman
      // FUNDING ak `mode: "DEBIT"`, PA `"CREDIT"` jan nou te sipoze anvan!
      // San chèk sa a AVAN nenpòt lòt branch `mode`, yon rechajman tonbe nan
      // branch DEBIT jenerik pi ba a — sa chaje yon FRÈ SIPLEMANTÈ $0.50 e
      // kreye yon FO antre "Pèman kat"/"Retrait carte" pou MENM aksyon
      // rechajman an, PANDAN antre "pending" orijinal la rete kwense pou tout
      // tan (paske kòd konfimasyon FUNDING a pa t janm rive ladan l, li te
      // kache dèyè yon chèk `mode === "CREDIT"` ki pa t janm vre pou FUNDING).
      // Kounye a nou detekte FUNDING AVAN tout lòt bagay, kèlkeswa `mode`.
      // ✅ FIX KRITIK: Maplerad voye DE evènman SEPARE pou MENM aksyon
      // rechajman an — youn `type: "FUNDING"`, yon lòt `type: "WITHDRAWAL"`
      // (konfime pa done pwodiksyon: menm montan, menm kat, apeprè menm
      // segonn). Yo ka rive nan NENPÒT lòd. Lojik anba a asire SÈLMAN
      // PREMYE evènman ki wè yon antre "pending" (oswa okenn antre ditou)
      // konplete istorik la EPI mete ajou balans kat la — TOUT lòt evènman
      // ki swiv pou MENM rechajman an rekonèt sa e pa fè AYEN ankò (ni
      // dezyèm antre, ni dezyèm balans, ni dezyèm notifikasyon).
      if ((txnType === "FUNDING" || txnType === "WITHDRAWAL") && !isTermination) {
        const isFunding = txnType === "FUNDING";
        // Pou FUNDING: eseye konplete yon antre "pending" ki egziste deja.
        // Pou WITHDRAWAL: jis gade si yon antre REKAN egziste, san chanje l.
        const completedNow = isFunding
          ? await db.ledger.completeCardFundPending(cardId).catch(() => false)
          : false;
        const recentFund = completedNow
          ? undefined
          : await db.ledger.findRecentCardFund(cardId, 120).catch(() => undefined);

        if (completedNow) {
          // Nou menm ki fèk konplete l — se nou ki responsab balans lan.
          processed = true;
          const cardBefore = await db.cards.findByCardId(cardId).catch(() => undefined);
          const balBefore  = (cardBefore?.balance as number) || 0;
          await db.cards.updateBalance(cardId, balBefore + amount).catch(() => null);
          await NotificationService.system(userId, "Carte rechargée",
            `$${(amount / 100).toFixed(2)} ajoutés à votre carte.`
          ).catch(() => null);
        } else if (recentFund && recentFund.status === "pending" && !isFunding) {
          // WITHDRAWAL rive AVAN FUNDING — se NOU ki konplete l pou premye fwa.
          processed = true;
          await db.ledger.completeCardFundPending(cardId).catch(() => null);
          const cardBefore = await db.cards.findByCardId(cardId).catch(() => undefined);
          const balBefore  = (cardBefore?.balance as number) || 0;
          await db.cards.updateBalance(cardId, balBefore + amount).catch(() => null);
          await NotificationService.system(userId, "Carte rechargée",
            `$${(amount / 100).toFixed(2)} ajoutés à votre carte.`
          ).catch(() => null);
        } else if (recentFund) {
          // Yon lòt evènman DEJA trete rechajman sa a (antre a "completed"
          // deja) — nou rekonèt sa e nou pa fè anyen ankò.
          logger.info("Webhook FUNDING/WITHDRAWAL — rechajman sa a deja trete pa yon lòt evènman", {
            cardId, txnType, recentFundStatus: recentFund.status, reference: data.reference,
          });
        } else if (isFunding) {
          // Okenn antre pending/rekan pa jwenn — rechajman "òdinè" (pa soti
          // nan `/fund` app nou an, egzanp ajoute dirèkteman sou Dashboard
          // Maplerad). Nou kreye yon antre konplè pou l rete vizib.
          processed = true;
          await db.ledger.insert({
            userId, type: "card_fund", status: "completed", direction: "debit",
            grossCents: amount, feeCents: 0, netCents: amount,
            description: "Rechargement carte", cardId, externalRef: data.reference,
          }).catch(() => null);
          const cardBefore = await db.cards.findByCardId(cardId).catch(() => undefined);
          const balBefore  = (cardBefore?.balance as number) || 0;
          await db.cards.updateBalance(cardId, balBefore + amount).catch(() => null);
          await NotificationService.system(userId, "Carte rechargée",
            `$${(amount / 100).toFixed(2)} ajoutés à votre carte.`
          ).catch(() => null);
          logger.warn("Webhook FUNDING san antre pending matchan — kreye nouvo antre", { cardId });
        }
        // ✅ Si se WITHDRAWAL SAN okenn antre "card_fund" ki matche ditou
        // (pa `recentFund`, pa `completedNow`) — se PA yon eko rechajman,
        // se yon VRÈ retrè/acha — nou KITE l tonbe nan branch DEBIT jenerik
        // ki pi ba a (pa `break` la a).
        if (isFunding || recentFund) break;
      }

      // ✅ DYAGNOSTIK: log peyòd BRIT webhook la san filtraj — pou konfime
      // EGZAKTEMAN ki chan (`status`, `mode`, elt) Maplerad voye pou
      // tranzaksyon MOCK (sandbox) yo. Andpwen "Mock Card Transaction" nan
      // pa menm ofri yon paramèt pou simile yon echèk (sèlman `amount` ak
      // `type: CREDIT|DEBIT`) — sanble posib chan `status` mock la voye a
      // pa literalman `"SUCCESS"` jan vrè tranzaksyon yo fè, kidonk verifikasyon
      // `approved` ki anba a ka bloke tranzaksyon DEBIT mock yo an silans.
      logger.info("issuing.transaction — payload brit", { cardId, rawKeys: Object.keys(data), raw: data });

      // ✅ FIX KRITIK: Maplerad voye `merchant.name: "Maplerad"` LITERALMAN
      // pou evènman ENTÈN (ranbousman/tèminezon kat) — san filtraj, non
      // founisè teknik nou an (Maplerad) parèt dirèkteman nan notifikasyon
      // ak istorik kliyan an. Nou detekte sa AVAN menm rele Logo.dev (ki ta
      // jis KONFIME "Maplerad" kòm yon non valid), epi nou ranplase l ak yon
      // etikèt Freda Pay pwòp. (FUNDING pa rive isit la ankò — deja jere pi
      // wo a, kidonk nou pa bezwen konsidere l nan branch sa a ankò.)
      const merchantRaw = data.merchant?.name || data.description || "";
      const isInternalMaplerad = /maplerad/i.test(merchantRaw) || txnType === "WITHDRAWAL";
      const { domain, logoUrl, name: merchantName } = isInternalMaplerad
        ? { domain: null, logoUrl: null, name: mode === "CREDIT" ? "Remboursement" : "Retrait carte" }
        : await LogoDevService.getMerchantLogo(merchantRaw).catch(() =>
            ({ domain: null, logoUrl: null, name: merchantRaw }));

      if (approved && mode === "DEBIT") {
        processed = true;
        const feeCents = 50;
        // ✅ FIX KRITIK: ansyen kòd la te debite `amount + feeCents` sou WALLET
        // la, EPI SEPAREMAN diminye `amount` sou balans pwòp KAT la — yon
        // DOUB-DEBI pou MENM lajan an. Wallet la deja debite YON SÈL FWA lè
        // kat la te FINANSE (`POST /cards/:cardId/fund` — wè menm rezon nan
        // kòd sa a). Yon acha ki fèt AK kat la dwe sèlman diminye balans PWÒP
        // kat la; SÈL frè tranzaksyon an ($0.50) touche wallet la (revni Freda
        // Pay), pa montan acha total la.
        await db.wallets.debit(userId, feeCents).catch(() => null);
        await db.ledger.insert({
          userId, type: "card_transaction", status: "completed", direction: "debit",
          grossCents: amount + feeCents, feeCents, netCents: amount,
          description: merchantName || "Pèman kat",
          paymentMethod: domain || "card",
          externalRef: data.reference, note: logoUrl || undefined,
        }).catch(() => null);
        // ✅ FIX: mete ajou balans PWÒP kat la tou — pa t janm fèt anvan, kidonk
        // balans ki afiche sou paj Cartes la te toujou rete jele nan valè kreyasyon an
        const cardBefore = await db.cards.findByCardId(cardId).catch(() => undefined);
        const balBefore  = (cardBefore?.balance as number) || 0;
        await db.cards.updateBalance(cardId, Math.max(0, balBefore - amount)).catch(() => null);
      }
      if (mode === "CREDIT") {
        processed = true;
        // ✅ FIX KRITIK: lè yon kat TÈMINE (siprime) ak yon balans ki te sou
        // li, Maplerad otomatikman ranbouse rès la nan yon evènman CREDIT
        // separe (`is_termination: true`, konfime nan peyòd brit yo). Ansyen
        // kòd la te kredite balans PWÒP KAT la nan tou de ka yo — men yon
        // kat TÈMINE vin KACHE/INAKSESIB touswit apre (`hidden: true`), kidonk
        // lajan an te rete "kwense" sou yon kat itilizatè a pa ka wè ankò!
        // Kounye a: si se yon tèminezon, lajan an ale nan WALLET la (sèl
        // kote itilizatè a ka toujou jwenn li) — sinon (yon ranbousman nòmal
        // sou yon kat ki toujou AKTIF), li rete kredite balans kat la, jan sa
        // te ye a. (FUNDING deja jere pi wo, anvan branch sa a — pa gen chèk
        // pou li isit la ankò.)
        await db.ledger.insert({
          userId, type: "refund", status: "completed", direction: "credit",
          grossCents: amount, feeCents: 0, netCents: amount,
          description: isTermination
            ? "Solde carte restitué au wallet (carte fermée)"
            : `Remboursement${merchantName ? ` — ${merchantName}` : ""}`,
          externalRef: data.reference,
        }).catch(() => null);

        if (isTermination) {
          await db.wallets.credit(userId, amount).catch(() => null);
        } else {
          const cardBefore = await db.cards.findByCardId(cardId).catch(() => undefined);
          const balBefore  = (cardBefore?.balance as number) || 0;
          await db.cards.updateBalance(cardId, balBefore + amount).catch(() => null);
        }
      }
      // ✅ FIX: mesaj la te toujou baze sou `approved` (`data.status === "SUCCESS"`)
      // — men CREDIT pa menm verifye `approved` anvan l aji, kidonk yon kredi
      // ki VRÈMAN pase te ka toujou di "❌ refusée" nan notifikasyon an (egzakteman
      // sa te rive nan tès admin lan). Kounye a mesaj la baze sou si nou VRÈMAN
      // trete tranzaksyon an (`processed`), pa sèlman yon chan Maplerad ki ka pa
      // fyab pou tranzaksyon mock.
      if (mode === "CREDIT" && data.is_termination === true) {
        // ✅ NOUVO: mesaj espesifik ak klè — presize kòb la ale nan WALLET la
        // (pa sou kat la, ki fèk fèmen), pou itilizatè a pa chèche l sou yon
        // kat ki disparèt.
        await NotificationService.system(userId,
          "Solde de carte remboursé",
          `$${(amount / 100).toFixed(2)} de votre carte fermée crédités sur votre portefeuille.`
        );
      } else {
        await NotificationService.system(userId,
          processed ? "Paiement par carte approuvé" : "Paiement par carte refusé",
          processed
            ? `$${(amount / 100).toFixed(2)}${merchantName ? ` chez ${merchantName}` : ""} ${mode === "CREDIT" ? "crédités sur" : "débités de"} votre carte.`
            : `Paiement de $${(amount / 100).toFixed(2)}${merchantName ? ` chez ${merchantName}` : ""} refusé. Vérifiez le solde ou les limites.`
        );
      }
      break;
    }

    case "issuing.terminated": {
      const userId = await getUserIdFromCardId(data.card_id);
      if (userId) {
        await db.cards.updateStatus(data.card_id, "terminated");
        await NotificationService.system(userId, "Carte terminée",
          "Carte fermée définitivement. Solde restant remboursé sur votre portefeuille.");
      }
      break;
    }

    // ✅ NOUVO: "3D Secure" vèsyon Maplerad. Kontrèman ak bank tradisyonèl
    // (ki voye SMS OTP dirèkteman bay kliyan an), Maplerad voye kòd 6-chif
    // la BA NOU — nou responsab montre l bay kliyan an vit ase (fenèt ~5 min)
    // pou li ka antre l sou paj konfimasyon machann nan. San handler sa a,
    // kòd la te disparèt san kliyan an janm wè l, e tranzaksyon an echwe.
    // Dokiman: maplerad.dev/docs/issuing — evènman "issuing.activation".
    case "issuing.activation": {
      const cardId = data.card_id;
      const code   = data.activation_code;
      if (!cardId || !code) {
        logger.warn("issuing.activation: card_id oswa activation_code manke", { data });
        break;
      }
      const userId = await getUserIdFromCardId(cardId);
      if (!userId) {
        logger.warn("issuing.activation: itilizatè pa jwenn pou kat la", { cardId });
        break;
      }

      // Anrejistre kòd la (ekspire otomatikman apre 5 min) pou frontend
      // ka pran l via polling rapid.
      await db.cards.setOtp(cardId, code).catch((e) =>
        logger.error("issuing.activation: echèk anrejistreman OTP", { cardId, error: e.message })
      );

      // ✅ Kanal segondè: yon notifikasyon nòmal tou, kòm backup si polling
      // frontend la echwe pou nenpòt rezon (app fèmen, koneksyon koupe, elt.)
      await NotificationService.system(
        userId, "Code de vérification 3D Secure",
        `Code de vérification : ${code} (valide 5 min). Saisissez-le sur la page du marchand.`
      ).catch(() => null);

      logger.info("✅ Kòd 3DS/OTP anrejistre ak notifye", { cardId, userId });
      break;
    }

    // ── COLLECTION — Dépôt auto (NGN bank + MoMo XAF/KES/XOF/UGX/TZS) ──
    case "collection.successful": {
      const collectionId = data.id;
      const refId        = data.reference || collectionId;
      const currency     = (data.currency || "NGN").toUpperCase();
      const rawAmount    = data.amount || 0;  // Montant en unité locale (avec subunit)
      const rawFee       = data.fee    || 0;  // Frè Maplerad en unité locale

      const RATES: Record<string, number> = {
        NGN: 1600, XAF: 620, KES: 130, XOF: 620, UGX: 3700, TZX: 2600, TZS: 2600,
      };
      const SUBUNIT: Record<string, number> = {
        NGN: 100, KES: 100, XAF: 1, XOF: 1, UGX: 1, TZX: 1, TZS: 1,
      };
      const rate       = RATES[currency] || 1;
      const subunit    = SUBUNIT[currency] || 1;
      // Convertir en USD cents — diviser par subunit d'abord (pour obtenir unités entières)
      const grossUSD   = Math.round((rawAmount / subunit / rate) * 100);  // Montant brut USD en cents
      const feeUSD     = Math.round((rawFee   / subunit / rate) * 100);   // Frè Maplerad en cents USD
      const netUSD     = Math.max(0, grossUSD - feeUSD);                   // Montant net à créditer

      const userId = await getUserIdFromExternalRef(refId) ||
                     await getUserIdFromCollectionId(collectionId);
      if (!userId) {
        logger.warn("collection.successful: userId introuvable", { collectionId, ref: refId });
        break;
      }

      const supa = (await import("../db/supabase")).getSupabase();

      // ✅ FIX DOUBLE TRANSACTION: Chercher l'entrée "pending" existante pour la mettre à jour
      const { data: pendingEntry } = await supa.from("ledger")
        .select("id")
        .eq("external_ref", refId)
        .eq("status", "pending")
        .limit(1)
        .maybeSingle();

      // Anti-doublon — si déjà completed, ignorer
      const { data: completedEntry } = await supa.from("ledger")
        .select("id")
        .eq("external_ref", refId)
        .eq("status", "completed")
        .limit(1)
        .maybeSingle();

      if (completedEntry) {
        logger.info("collection déjà créditée — doublon ignoré", { refId });
        break;
      }

      // Créditer le montant NET (après frais Maplerad) sur le wallet
      await db.wallets.credit(userId, netUSD);

      if (pendingEntry?.id) {
        // ✅ UPDATE l'entrée pending existante → évite la double transaction
        await supa.from("ledger").update({
          status:      "completed",
          gross_cents: grossUSD,
          fee_cents:   feeUSD,
          net_cents:   netUSD,
          description: `Dépôt ${currency} confirmé (${(rawAmount / subunit).toLocaleString()} ${currency}, frais: ${(rawFee / subunit).toLocaleString()} ${currency})`,
          updated_at:  new Date().toISOString(),
        }).eq("id", pendingEntry.id);
        logger.info("Entrée pending mise à jour → completed", { refId, ledgerId: pendingEntry.id });
      } else {
        // Pas d'entrée pending (NGN bank transfer ou collection sans init) → insérer
        await db.ledger.insert({
          userId, type: "vba_deposit", status: "completed", direction: "credit",
          grossCents: grossUSD, feeCents: feeUSD, netCents: netUSD,
          description: `Dépôt ${currency} (${(rawAmount / subunit).toLocaleString()} ${currency}, frais: ${(rawFee / subunit).toLocaleString()} ${currency})`,
          paymentMethod: currency === "NGN" ? "ngn_bank" : "momo",
          externalRef: refId,
        }).catch(() => null);
      }

      await NotificationService.system(userId,
        "Dépôt confirmé",
        `${(rawAmount / subunit).toLocaleString()} ${currency} reçus. Net crédité : $${(netUSD / 100).toFixed(2)} USD (frais : ${(rawFee / subunit).toLocaleString()} ${currency}).`
      );
      logger.info("Collection créditée auto", { userId, currency, grossUSD, feeUSD, netUSD });
      break;
    }

    case "collection.failed": {
      const refId  = data.reference || data.id;
      const userId = await getUserIdFromExternalRef(refId) ||
                     await getUserIdFromCollectionId(data.id);
      if (userId) {
        const supa2 = (await import("../db/supabase")).getSupabase();
        await supa2.from("ledger").update({ status: "failed" }).eq("external_ref", refId);
        await NotificationService.system(userId,
          "Dépôt échoué",
          "Votre dépôt Mobile Money n'a pas abouti. Aucun montant prélevé, vous pouvez réessayer."
        );
      }
      logger.warn("Collection échouée", { ref: refId });
      break;
    }

    case "transfer.successful": {
      const txId   = data.id || data.reference;
      const userId = await getUserIdFromExternalRef(txId);
      if (userId) {
        await db.ledger.insert({
          userId, type: "withdrawal", status: "completed", direction: "debit",
          grossCents: data.amount || 0, feeCents: data.fee || 0,
          netCents: (data.amount || 0) - (data.fee || 0),
          description: "Retrait confirmé", externalRef: txId,
        }).catch(() => null);
        await NotificationService.system(userId, "Retrait confirmé",
          `Retrait de $${((data.amount || 0) / 100).toFixed(2)} USD envoyé. Arrivée dans quelques minutes.`);
      }
      break;
    }

    case "transfer.failed": {
      const txId   = data.id || data.reference;
      const userId = await getUserIdFromExternalRef(txId);
      if (userId) {
        const total = (data.amount || 0) + (data.fee || 0);
        if (total > 0) {
          await db.wallets.credit(userId, total).catch(() => null);
          await db.ledger.insert({
            userId, type: "refund", status: "completed", direction: "credit",
            grossCents: total, feeCents: 0, netCents: total,
            description: "Remboursement retrait échoué",
          }).catch(() => null);
        }
        await NotificationService.system(userId, "Retrait échoué",
          `Retrait échoué.${total > 0 ? ` $${(total / 100).toFixed(2)} USD remboursés sur votre portefeuille.` : ""}`);
      }
      break;
    }

    case "account.transaction": {
      const amount   = data.amount || 0;
      const netCents = Math.round(amount * 100);
      const type     = data.type;
      const userId   = await getUserIdFromUSDAccount(data.id);
      if (userId && type !== "microdeposit" && netCents > 0) {
        await db.wallets.credit(userId, netCents);
        await db.ledger.insert({
          userId, type: "vba_deposit", status: "completed", direction: "credit",
          grossCents: netCents, feeCents: 0, netCents,
          description: `Dépôt USD via ${data.source?.payment_rail || "ACH/Fedwire"}`,
          paymentMethod: "usd_wire", externalRef: data.id,
        }).catch(() => null);
        await NotificationService.system(userId, "Dépôt USD reçu 💵",
          `$${amount.toFixed(2)} USD reçu via ${data.source?.sender_name || "virement bancaire"}.`);
      }
      break;
    }

    case "account.creation.successful": {
      const userId = await getUserIdFromUSDAccountRef(data.reference);
      if (userId) {
        await NotificationService.system(userId, "Compte USD activé ✅",
          "Votre compte bancaire USD est maintenant actif. Vous pouvez recevoir des virements ACH et Fedwire.");
      }
      break;
    }

    case "account.creation.failed": {
      const userId  = await getUserIdFromUSDAccountRef(data.reference);
      const reasons = (data.Decline_reason || data.decline_reason || []).join(" | ");
      if (userId) {
        await NotificationService.system(userId, "Demande compte USD rejetée ❌",
          `Raison: ${reasons || "Documents invalides"}. Veuillez soumettre à nouveau.`);
      }
      break;
    }

    case "account.creation.change_request": {
      const userId  = await getUserIdFromUSDAccountRef(data.reference);
      const reasons = (data.decline_reason || []).join(" | ");
      if (userId) {
        await NotificationService.system(userId, "Documents à corriger",
          `Corrections nécessaires: ${reasons || "Documents non conformes"}.`);
      }
      break;
    }

    default:
      logger.info(`Webhook Maplerad: événement non géré — ${eventType}`);
  }
}

async function getUserIdFromCollectionId(collectionId: string): Promise<string | null> {
  try {
    const supabase = (await import("../db/supabase")).getSupabase();
    // Chercher via maplerad_collection_id ou external_ref dans ledger
    const { data: ledger } = await supabase.from("ledger").select("user_id")
      .eq("external_ref", collectionId).limit(1).single();
    if ((ledger as any)?.user_id) return (ledger as any).user_id;
    // Chercher via virtual account id dans users
    const { data: user } = await supabase.from("users").select("id")
      .eq("maplerad_collection_ref", collectionId).limit(1).single();
    return (user as any)?.id || null;
  } catch { return null; }
}

async function getUserIdFromCardId(cardId: string): Promise<string | null> {
  // ✅ FIX KRITIK: `db.cards.findByCardId()` retounen yon RAW ranje Supabase
  // (`select("*")`, san okenn tradiksyon camelCase) — chan an rele `user_id`
  // (snake_case), PA `userId`. `(c as any)?.userId` te TOUJOU `undefined`,
  // kidonk fonksyon sa a te TOUJOU retounen `null`, KELKESWA si kat la te
  // jwenn oswa pa. Rezilta: CHAK webhook ki itilize l (`issuing.transaction`,
  // `issuing.terminated`, `issuing.activation`) te "reyisi" (200 bay Maplerad,
  // paske `if (!userId) break;` pa leve okenn erè) SAN JANM aji — balans kat/
  // wallet pa t janm mete ajou, notifikasyon pa t janm voye, kòd OTP 3DS pa
  // t janm anrejistre, e tranzaksyon yo pa t janm parèt nan istorik la.
  try { const c = await db.cards.findByCardId(cardId); return (c as any)?.user_id || null; }
  catch { return null; }
}
async function getUserIdFromCardRef(ref: string): Promise<string | null> {
  try { const c = await db.cards.findByCardId(ref); return (c as any)?.user_id || null; }
  catch { return null; }
}
async function getUserIdFromExternalRef(externalRef: string): Promise<string | null> {
  try {
    const supabase = (await import("../db/supabase")).getSupabase();
    const { data } = await supabase.from("ledger").select("user_id")
      .eq("external_ref", externalRef).limit(1).single();
    return (data as any)?.user_id || null;
  } catch { return null; }
}
async function getUserIdFromUSDAccount(accountId: string): Promise<string | null> {
  try {
    const supabase = (await import("../db/supabase")).getSupabase();
    const { data } = await supabase.from("users").select("id")
      .eq("usd_account_id", accountId).limit(1).single();
    return (data as any)?.id || null;
  } catch { return null; }
}
async function getUserIdFromUSDAccountRef(reference: string): Promise<string | null> {
  try {
    const supabase = (await import("../db/supabase")).getSupabase();
    const { data } = await supabase.from("users").select("id")
      .eq("usd_account_ref", reference).limit(1).single();
    return (data as any)?.id || null;
  } catch { return null; }
}

// ============================================================
// POST /api/webhooks/inbound-email — Brevo Inbound Parsing
// Resevwa imèl ki rive sou contact@fredapay.com / support@fredapay.com
// ============================================================
// ⚠️ POU AKTIVE: nan Dashboard Brevo → Transactional → Inbound Parsing,
// konfigire MX record domèn ou an pou pwente sou Brevo, epi mete URL
// webhook sa a (https://<backend>/api/webhooks/inbound-email) kòm sib la.
router.post("/inbound-email", async (req: Request, res: Response) => {
  // ✅ DYAGNOSTIK: fòma egzat peyòd Brevo a ka varye — nou log peyòd BRIT la
  // konplè premye fwa a pou konfime egzakteman ki chan yo voye, menm teknik
  // ki te ede n konfime fòma tranzaksyon Maplerad yo pi bonè.
  logger.info("Webhook imèl antran — peyòd brit", { rawKeys: Object.keys(req.body || {}), raw: req.body });

  try {
    // Brevo Inbound Parsing voye yon tablo "items" — chak eleman se yon imèl.
    // Nou aksepte tou yon sèl objè dirèk (kèk konfigirasyon voye l konsa).
    const items = Array.isArray(req.body?.items) ? req.body.items : [req.body];

    for (const item of items) {
      if (!item || typeof item !== "object") continue;

      const fromEmail = item.From?.Address || item.from?.address || item.from_email || item.sender || "";
      const fromName  = item.From?.Name    || item.from?.name    || item.from_name  || fromEmail;
      const toList    = item.To || item.to || [];
      const toEmail   = (Array.isArray(toList) ? toList[0]?.Address || toList[0]?.address || toList[0] : toList) || "contact@fredapay.com";
      const subject   = item.Subject || item.subject || "(Sans objet)";
      const bodyText  = item.RawTextBody || item.text || item.ExtractedMarkdownMessage || "";
      const bodyHtml  = item.RawHtmlBody || item.html || "";
      const inReplyTo = item.InReplyTo || item.in_reply_to || item.headers?.["in-reply-to"];

      if (!fromEmail) { logger.warn("Webhook imèl antran san 'from' — inyore l", { item }); continue; }

      // Detèmine bwat lèt la (contact@ oswa support@) — defo contact@ si nou
      // pa rekonèt adrès la (egzanp yon alias oswa yon fòma ki pa atann).
      const mailbox = String(toEmail).toLowerCase().includes("support@") ? "support@fredapay.com" : "contact@fredapay.com";

      // Si se yon repons a yon konvèsasyon nou deja gen tras li, mete l nan
      // menm "thread" a; sinon kòmanse yon nouvo konvèsasyon.
      let threadId: string | undefined;
      if (inReplyTo) {
        const supabase = (await import("../db/supabase")).getSupabase();
        const { data: existing } = await supabase.from("inbox_emails")
          .select("thread_id, id").or(`raw_payload->>MessageId.eq.${inReplyTo}`).limit(1).maybeSingle();
        threadId = (existing as any)?.thread_id || (existing as any)?.id;
      }

      const saved: any = await db.inboxEmails.create({
        direction: "inbound",
        mailbox,
        from_email: fromEmail,
        from_name: fromName,
        to_email: String(toEmail),
        subject,
        body_text: bodyText,
        body_html: bodyHtml,
        thread_id: threadId || null,
        is_read: false,
        raw_payload: item,
      });

      // Premye mesaj nan yon konvèsasyon — li vin rasin pwòp thread pa li.
      if (!threadId) {
        const supabase = (await import("../db/supabase")).getSupabase();
        await supabase.from("inbox_emails").update({ thread_id: saved.id }).eq("id", saved.id);
      }

      logger.info("Imèl antran sove", { mailbox, from: fromEmail, subject });
    }

    res.json({ success: true });
  } catch (e: any) {
    logger.error("Erreur webhook imèl antran", { error: e.message });
    // ✅ Toujou reponn 200 bay Brevo — yon erè entèn nou pa dwe fè Brevo
    // reyeseye endefiniman e potansyèlman blackliste webhook la.
    res.json({ success: false, error: e.message });
  }
});

export default router;
