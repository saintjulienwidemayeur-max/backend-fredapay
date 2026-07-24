// ============================================================
// ReferralService — lojik pwogram parennaj Freda Pay
// ============================================================
// Front lan (mobil: ReferralScreen.tsx) atann EGZAKTEMAN fòma sa a nan
// `GET /api/referrals/dashboard`:
//   { referralCode, referralLink, totalReferrals, referralsForPro,
//     proUnlocked, totalEarnedCents, totalEarned, filleuls: [...] }
// Service sa a bay egzakteman sa.
import { db } from "../db/store";
import { logger } from "../utils/logger";
import { NotificationService } from "./notification.service";

/** Konbyen fiye pou debloke Plan Pro gratis. */
const REFERRALS_FOR_PRO = 5;
/** Rekonpans an santim pou chak fiye ki kreye premye kat li. */
const REWARD_CENTS = 50; // $0.50

/** Baz lyen pataj la — sit piblik la (pa API a). */
function referralLinkBase(): string {
  // FRONTEND_URL se sit la; nou tonbe sou domèn pwodiksyon an si l absan.
  return (process.env.FRONTEND_URL_PUBLIC || process.env.FRONTEND_URL || "https://fredapay.com").replace(/\/$/, "");
}

/**
 * ✅ v70 — LYEN PARENNAJ TE BAY 404.
 *
 * Ansyen fòma a: `https://fredapay.com/r/CODE` — sa mande yon wout
 * `/r/:code` egziste sou SIT WEB la (fredapay.com). Sit sa a PA nan
 * pwojè sa a (ni mobil, ni backend) — donk nou pa ka konfime si wout
 * sa a egziste vre. Si li pa la, CHAK moun ki peze lyen an jwenn 404.
 *
 * Nouvo fòma a: `https://fredapay.com/?ref=CODE` — yon paramèt sou
 * DOMÈN RASIN lan olye yon chemen espesifik. Rasin domèn nan gen mwens
 * chans 404 pase yon sou-chemen ki poko konstwi. Sa PA yon solisyon
 * konplè — paramèt `ref` la pa fè anyen otomatik sof si sit la li l
 * epi montre yon paj envitasyon (oswa redirije nan magazen an ak kòd
 * la anrejistre pou l ranpli otomatikman lè moun nan enskri).
 *
 * 🔴 POU YON VRÈ SOLISYON: sit fredapay.com bezwen yon paj `/?ref=`
 * (oswa `/r/:code`) ki montre yon envitasyon epi ki redirije bay App
 * Store / Play Store — oswa, pi bon toujou, yon "universal link" /
 * "app link" ki louvri app la dirèkteman si li deja enstale.
 */
function buildReferralLink(code: string): string {
  return `${referralLinkBase()}/?ref=${encodeURIComponent(code)}`;
}

export const ReferralService = {
  REFERRALS_FOR_PRO,
  REWARD_CENTS,

  /**
   * Konstwi dashboard parennaj yon itilizatè.
   * `cardCreated` pou chak fiye vin de tab rekonpans lan (yon rekonpans
   * `card_created` vle di fiye a te vrèman kreye yon kat).
   */
  async getDashboard(userId: string) {
    const me = await db.users.findById(userId);
    if (!me) throw new Error("USER_NOT_FOUND");

    const code = me.referralCode || "";
    const referralLink = code ? buildReferralLink(code) : referralLinkBase();

    const [referees, rewards] = await Promise.all([
      db.referrals.listReferees(userId),
      db.referrals.listRewards(userId),
    ]);

    const rewardByReferee = new Map(rewards.map((r) => [r.refereeId, r]));
    const totalEarnedCents = rewards
      .filter((r) => r.status === "paid")
      .reduce((sum, r) => sum + r.amountCents, 0);

    const filleuls = referees.map((f) => {
      const rw = rewardByReferee.get(f.id);
      return {
        id: f.id,
        firstname: f.firstname,
        fredaTag: f.FredaTag,
        status: f.status,
        cardCreated: !!rw, // yon rekonpans egziste = kat te kreye
        rewardPaid: rw?.status === "paid",
        joinedAt: f.createdAt instanceof Date ? f.createdAt.toISOString() : String(f.createdAt),
      };
    });

    const totalReferrals = referees.length;
    const proUnlocked = totalReferrals >= REFERRALS_FOR_PRO;

    return {
      referralCode: code,
      referralLink,
      totalReferrals,
      referralsForPro: REFERRALS_FOR_PRO,
      proUnlocked,
      totalEarnedCents,
      totalEarned: `$${(totalEarnedCents / 100).toFixed(2)}`,
      filleuls,
    };
  },

  /**
   * Rele lè yon itilizatè kreye premye kat li. Si li te envite pa yon
   * lòt moun, nou peye parennè a $0.50 (yon sèl fwa), epi si parennè a
   * rive nan 5 fiye ak kat, nou debloke Plan Pro pou li.
   *
   * Byen an sekirite: tou sa se "best effort" — yon echèk pa dwe janm
   * kraze kreyasyon kat la (aksyon prensipal itilizatè a).
   */
  async onRefereeCardCreated(refereeId: string): Promise<void> {
    try {
      const referee = await db.users.findById(refereeId);
      if (!referee?.referredBy) return; // moun sa a pa te envite

      const referrerId = referee.referredBy;

      // Anrejistre rekonpans lan — `false` vle di li te deja peye (doub).
      const isNew = await db.referrals.recordRewardIfNew(referrerId, refereeId, "card_created", REWARD_CENTS);
      if (!isNew) return;

      // Kredite parennè a.
      await db.wallets.credit(referrerId, REWARD_CENTS, "USD");
      logger.info("Rekonpans parennaj peye", { referrerId, refereeId, cents: REWARD_CENTS });

      void NotificationService.send(referrerId, "system", {
        title: "Rekonpans parennaj 🎁",
        message: `Ou fèk touche $${(REWARD_CENTS / 100).toFixed(2)} paske yon moun ou envite kreye premye kat li !`,
      }).catch(() => null);

      // Debloke Pro si parennè a rive nan papòt la.
      const referees = await db.referrals.listReferees(referrerId);
      const rewards = await db.referrals.listRewards(referrerId);
      const withCard = new Set(rewards.map((r) => r.refereeId));
      const qualified = referees.filter((f) => withCard.has(f.id)).length;

      if (qualified >= REFERRALS_FOR_PRO) {
        const sub = await db.subscriptions.findByUserId(referrerId).catch(() => null);
        if (sub && sub.plan !== "pro" && sub.plan !== "standard") {
          await db.subscriptions.choosePlan(referrerId, "pro");
          logger.info("Plan Pro debloke pa parennaj", { referrerId, qualified });
          void NotificationService.send(referrerId, "system", {
            title: "Plan Pro debloke 👑",
            message: `Felisitasyon ! ${REFERRALS_FOR_PRO} moun ou envite kreye kat yo — Plan Pro ou aktive gratis !`,
          }).catch(() => null);
        }
      }
    } catch (e: any) {
      logger.warn("onRefereeCardCreated echwe", { refereeId, error: e.message });
    }
  },
};
