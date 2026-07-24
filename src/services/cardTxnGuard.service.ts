// ============================================================
// cardTxnGuard — validasyon AVAN yon tranzaksyon kat Maplerad
// ============================================================
// Responsablite:
//   1. Kalkile KÒ TOTAL la  = montan mande + frè Freda Pay pa nou
//   2. Tcheke balans wallet la
//        • PA ase  → aplike penalite NSF $0.50, LOGE l, REFIZE (400),
//                    epi PA JANM rele Maplerad
//        • Ase     → debite total la, rele Maplerad, ranbouse si l echwe
//
// ⚠️ FRÈ MAPLERAD: Maplerad dedwi PWÒP frè pa li DIRÈKTEMAN pandan
// tranzaksyon kat la. Nou PA kalkile ni ajoute frè Maplerad isit — SÈLMAN
// frè Freda Pay pa nou an. (Konfime pa ou.)
//
// ────────────────────────────────────────────────────────────
// ⚠️ 2 KONTRENT REYÈL NAN ESTAK NOU AN — LI SA A:
//
// 1) PA GEN VRÈ TRANZAKSYON DB (BEGIN/COMMIT/ROLLBACK).
//    Nou pase pa Supabase (PostgREST) ak kliyan JS la. PostgREST fè CHAK
//    apèl kòm yon rekèt HTTP endepandan — pa gen okenn fason pou kenbe yon
//    tranzaksyon PostgreSQL louvri atravè plizyè apèl. Donk "start a
//    database transaction / rollback" PA POSIB literalman isit.
//    Sa nou fè olye: yon TRANZAKSYON KONPANSATWA (saga) — nou debite, epi
//    si Maplerad echwe nou RANBOUSE egzakteman menm montan an. Rezilta
//    biznis la MENM ak yon rollback; se sèlman mekanis lan ki diferan.
//    (Si yon jou nou vle vrè tranzaksyon atomik, li ta mande yon fonksyon
//    PostgreSQL `rpc()` ki fè tout bagay la anndan DB a.)
//
// 2) BALANS PA KA VIN NEGATIF.
//    Règ DB aktyèl nou an (`db.wallets.debit`) kole balans lan a $0.00
//    (`Math.max(0, ...)`). Ou te di "allow negative OR cap at $0.00
//    depending on our current db rules" — règ aktyèl nou an se KOLE A
//    $0.00. Donk si yon moun gen $0.20 e penalite a se $0.50, nou pran
//    $0.20 e balans lan rive $0.00. Nou LOGE montan RÈYÈL nou pran an
//    (`netCents`) ak montan NOU TE DWE pran an (`grossCents`) — konsa
//    diferans lan (dèt la) rete vizib nan istorik la.
import { db } from "../db/store";
import { logger } from "../utils/logger";
import { fmt } from "../config/fees.config";
import { CardFeesService } from "./cardFees.service";

/** Kle `card_fees` yo (modifyab pa admin — wè migration 032). */
const FREDA_FEE_KEY = "card_txn_freda_fee";
const NSF_FEE_KEY   = "card_txn_nsf";

/** Valè fallback si tab `card_fees` la pa reponn (menm modèl ak rès kòd la). */
const FREDA_FEE_FALLBACK_CENTS = 50;  // $0.50
const NSF_FEE_FALLBACK_CENTS   = 50;  // $0.50

/** Frè Freda Pay pa nou sou yon tranzaksyon kat — KONFIGIRAB. */
export async function getFredaCardTxnFee(): Promise<number> {
  return CardFeesService.getAmountCents(FREDA_FEE_KEY, FREDA_FEE_FALLBACK_CENTS);
}

/** Penalite fon ensifizan (NSF) — KONFIGIRAB. */
export async function getNsfPenaltyFee(): Promise<number> {
  return CardFeesService.getAmountCents(NSF_FEE_KEY, NSF_FEE_FALLBACK_CENTS);
}

export interface GuardOk {
  ok: true;
  amountCents: number;
  feeCents: number;
  totalRequiredCents: number;
  /** Rele sa a SÈLMAN si apèl Maplerad la ECHWE — li ranbouse total la. */
  refund: (reason: string) => Promise<void>;
  /** Rele sa a lè Maplerad la REYISI — li konfime/loge tranzaksyon an.
   *  `grossCents`/`feeCents` opsyonèl: yon wout ki gen PWÒP frè pa li
   *  (egz. frè rechajman) ka pase vrè chif li yo pou istorik la egzak. */
  commit: (opts?: {
    externalRef?: string; description?: string;
    grossCents?: number; feeCents?: number; status?: string;
  }) => Promise<string>;
}

export interface GuardFail {
  ok: false;
  httpStatus: number;
  body: Record<string, unknown>;
}

export type GuardResult = GuardOk | GuardFail;

/**
 * Valide + rezève lajan an AVAN yon tranzaksyon kat Maplerad.
 *
 * IMPÒTAN: si sa retounen `ok: false`, ou DWE reponn `res.status(r.httpStatus).json(r.body)`
 * epi RETOUNEN TOUSWIT — pa janm rele Maplerad.
 *
 * @param userId    Moun ki mande tranzaksyon an
 * @param amountCents Montan tranzaksyon an (an cents), SAN frè
 * @param ctx       Kontèks pou istorik la (cardId, tip, elt.)
 */
export async function guardCardTransaction(
  userId: string,
  amountCents: number,
  ctx: {
    cardId?: string; type?: string; description?: string;
    /** ✅ v66.1 — tèks frè a nan moman tranzaksyon an (istorik fig). */
    feeLabel?: string;
  } = {}
): Promise<GuardResult> {
  const txnType = ctx.type || "card_fund";

  // ── 0. Validasyon debaz ──────────────────────────────────
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return {
      ok: false, httpStatus: 400,
      body: { error: "Montant invalide.", code: "INVALID_AMOUNT" },
    };
  }

  // ── 1. Kalkile kòt total la ──────────────────────────────
  //    total_required = montan mande + frè Freda Pay pa nou
  //    (PA gen frè Maplerad isit — Maplerad dedwi pa li menm.)
  const feeCents           = await getFredaCardTxnFee();
  const totalRequiredCents = amountCents + feeCents;

  // ── 2. Tcheke balans lan ─────────────────────────────────
  const wallet    = await db.wallets.getOrCreate(userId, "USD");
  const available = (wallet.availableBalance ?? 0) > 0 ? wallet.availableBalance : (wallet.balance ?? 0);

  if (available < totalRequiredCents) {
    // ── 2a. FON ENSIFIZAN → PENALITE NSF, PA GEN APÈL MAPLERAD ──
    const nsfCents = await getNsfPenaltyFee();

    // `debitUpTo` (pa `debit`) — wè kòmantè anlè a: `debit()` ta LEVE
    // INSUFFICIENT_BALANCE, egzakteman nan sèl ka kote nou bezwen l.
    const { takenCents } = await db.wallets.debitUpTo(userId, nsfCents, "USD");

    // Loge penalite a — MENM si nou pa t ka pran l nèt. `grossCents` =
    // sa nou te dwe pran, `netCents` = sa nou VRÈMAN pran.
    const nsfTxnId = await db.ledger.insert({
      userId,
      cardId:      ctx.cardId,
      type:        "nsf_penalty",
      status:      "completed",
      direction:   "debit",
      grossCents:  nsfCents,
      feeCents:    nsfCents,
      netCents:    takenCents,
      feeLabel:    "Pénalité solde insuffisant",
      description: "Pénalité fonds insuffisants (NSF)",
      failureReason: `INSUFFICIENT_BALANCE: requis ${fmt(totalRequiredCents)}, disponible ${fmt(available)}`,
    }).catch((e) => {
      logger.error("NSF: echèk anrejistreman ledger", { userId, error: e?.message });
      return null;
    });

    logger.warn("Tranzaksyon kat refize — fon ensifizan + penalite NSF", {
      userId, cardId: ctx.cardId, amountCents, feeCents,
      totalRequiredCents, available, nsfCents, takenCents, nsfTxnId,
    });

    // Avize moun nan — best-effort, pa bloke repons lan.
    void import("./notification.service").then(({ NotificationService }) =>
      NotificationService.system(
        userId,
        "Transaction refusée — fonds insuffisants",
        `Une pénalité de ${fmt(takenCents)} a été appliquée. Rechargez votre wallet avant de réessayer.`
      ).catch(() => null)
    ).catch(() => null);

    return {
      ok: false,
      httpStatus: 400,
      body: {
        error: `Transaction refusée : solde insuffisant. ${fmt(totalRequiredCents)} requis (${fmt(amountCents)} + ${fmt(feeCents)} de frais), ${fmt(available)} disponible. Une pénalité de ${fmt(takenCents)} a été appliquée.`,
        code: "INSUFFICIENT_FUNDS_NSF",
        requiredCents:  totalRequiredCents,
        availableCents: available,
        amountCents,
        feeCents,
        nsfPenaltyCents:        nsfCents,
        nsfPenaltyChargedCents: takenCents,
        // ✅ Transparans: si nou pa t ka pran tout penalite a (balans kole
        // a $0.00), frontend la ka di sa klèman bay moun nan.
        nsfFullyCharged: takenCents === nsfCents,
        nsfTxnId,
      },
    };
  }

  // ── 3. FON SIFIZAN → rezève lajan an TOUSWIT ─────────────
  // Nou debite AVAN nou rele Maplerad (pa apre) — konsa menm si 2 rekèt
  // rive an menm tan, dezyèm lan wè balans lan deja diminye e li p ap ka
  // depanse menm lajan an de fwa.
  await db.wallets.debit(userId, totalRequiredCents, "USD");

  let settled = false;  // pwoteksyon: pa janm ranbouse E komèt

  const refund = async (reason: string) => {
    if (settled) return;
    settled = true;
    // ⚠️ Se ISIT LA "rollback" la ye — yon konpansasyon, pa yon vrè
    // ROLLBACK SQL (wè nòt anlè a). Nou remèt EGZAKTEMAN menm montan an.
    await db.wallets.credit(userId, totalRequiredCents, "USD").catch((e) => {
      // Si MENM ranbousman an echwe, sa se yon ka GRAV: lajan moun nan
      // debite men tranzaksyon an pa fèt. Nou loge l kòm ERÈ pou yon moun
      // ka repare l alamen — nou pa vale l an silans.
      logger.error("🚨 KRITIK: ranbousman echwe apre echèk Maplerad", {
        userId, totalRequiredCents, reason, error: e?.message,
      });
      throw e;
    });

    // Tras nan istorik la: PA GEN penalite isit — moun nan TE GEN lajan an,
    // se pa fòt li si Maplerad echwe.
    await db.ledger.insert({
      userId, cardId: ctx.cardId,
      type: txnType, status: "failed", direction: "debit",
      grossCents: totalRequiredCents, feeCents, netCents: 0,
      feeLabel: ctx.feeLabel,
      description: ctx.description || "Transaction carte échouée (remboursée)",
      failureReason: reason,
    }).catch(() => null);

    logger.warn("Tranzaksyon kat echwe → wallet ranbouse (pa gen penalite)", {
      userId, cardId: ctx.cardId, totalRequiredCents, reason,
    });
  };

  const commit: GuardOk["commit"] = async (opts = {}) => {
    if (settled) throw new Error("GUARD_ALREADY_SETTLED");
    settled = true;
    const txnId = await db.ledger.insert({
      userId, cardId: ctx.cardId,
      type: txnType, status: opts.status || "pending", direction: "debit",
      grossCents: opts.grossCents ?? amountCents,
      feeCents:   opts.feeCents   ?? feeCents,
      netCents:   opts.grossCents ?? amountCents,
      // ✅ v66.1 — tèks frè a (palye ki aplike a) sou tranzaksyon reyisi yo.
      feeLabel:   ctx.feeLabel,
      description: opts.description || ctx.description || "Transaction carte",
      externalRef: opts.externalRef,
    });
    // ✅ v105: tcheke balans ba apre debi a — se la balans lan desann.
    void import("./notification.service").then(({ NotificationService }) =>
      NotificationService.checkLowBalance(userId, "").catch(() => null)
    ).catch(() => null);
    logger.info("Tranzaksyon kat konfime", {
      userId, cardId: ctx.cardId, amountCents, feeCents, totalRequiredCents, txnId,
    });
    return txnId;
  };

  return { ok: true, amountCents, feeCents, totalRequiredCents, refund, commit };
}
