// ============================================================
// Repository Supabase — Freda Pay v3
// Ajoute: subscriptions, bank_accounts, transactions_ledger
// ============================================================

import { getSupabase } from "./supabase";
import { logger } from "../utils/logger";
import type { DbUser, DbRefreshToken } from "../types/user";
import type { DbWallet, DbTransfer, Currency } from "../types/wallet";
import type { DbNotification } from "../types/notification";
import type { DbKycSession } from "../types/didit";
import type { DbSubscription, SubscriptionPlan, SubscriptionStatus } from "../types/subscription";
import { PLANS, fmt } from "../config/fees.config";

// ── Mappers ──────────────────────────────────────────────────
const toUser = (r: Record<string, unknown>): DbUser => ({
  id: r.id as string, email: r.email as string, passwordHash: r.password_hash as string,
  firstname: r.firstname as string, lastname: r.lastname as string,
  phone: r.phone as string | undefined, dialCode: r.dial_code as string | undefined,
  country: r.country as string | undefined, city: r.city as string | undefined,
  address: r.address as string | undefined, state: r.state as string | undefined,
  postalCode: r.postal_code as string | undefined, dateOfBirth: r.date_of_birth as string | undefined,
  genre: r.genre as string | undefined, FredaTag: r.freda_tag as string,
  avatarUrl: r.avatar_url as string | undefined, role: r.role as "user" | "admin",
  status: r.status as DbUser["status"], kycStatus: r.kyc_status as DbUser["kycStatus"],
  kycSessionId: r.kyc_session_id as string | undefined,
  emailVerified: r.email_verified as boolean, phoneVerified: r.phone_verified as boolean,
  twoFactorEnabled: r.two_factor_enabled as boolean,
  lastLoginAt: r.last_login_at ? new Date(r.last_login_at as string) : undefined,
  mapleradCustomerId: r.maplerad_customer_id as string | undefined,
  mapleradTier: r.maplerad_tier as number | undefined,
  usdAccountRef: r.usd_account_ref as string | undefined,
  kycIdNumber:  r.kyc_id_number  as string | undefined,
  kycIdType:    r.kyc_id_type    as string | undefined,
  kycIdCountry: r.kyc_id_country as string | undefined,
  kycFirstName:  r.kyc_first_name  as string | undefined,
  kycLastName:   r.kyc_last_name   as string | undefined,
  kycNationality: r.kyc_nationality as string | undefined,
  createdByAdminId: r.created_by_admin_id as string | undefined,
  trialUsed: r.trial_used as boolean | undefined,
  notifPrefs: r.notif_prefs as Record<string, boolean> | undefined,
  referralCode: r.referral_code as string | undefined,
  referredBy: r.referred_by as string | undefined,
  createdAt: new Date(r.created_at as string), updatedAt: new Date(r.updated_at as string),
});

const toWallet = (r: Record<string, unknown>): DbWallet => ({
  id: r.id as string, userId: r.user_id as string, currency: r.currency as Currency,
  balance: r.balance as number, availableBalance: r.available_balance as number,
  pendingBalance: r.pending_balance as number, isActive: r.is_active as boolean,
  createdAt: new Date(r.created_at as string), updatedAt: new Date(r.updated_at as string),
});

// ✅ FIX KRITIK v51 "erè lè m aksepte yon demand": mapping an te li
// `r.amount`, `r.total_amount`, `r.fee` — TWA kolòn ki PA JANM EGZISTE nan
// tab `transactions_ledger` la. Vrè kolòn yo se `net_amount`, `gross_amount`,
// `fee_amount` (menm jan ak `db.ledger.insert()` ekri yo, e menm jan ak
// `WalletService.getHistory()` li yo kòrèkteman). Rezilta: `transfer.amount`
// te TOUJOU `undefined` → `PATCH /request/:id/accept` te kalkile
// `undefined / 100` = NaN → `sendMoney({amount: NaN})` → `toCents(NaN)` =
// NaN → `NaN < 50` se FALSE an JavaScript (donk validation MIN_TRANSFER lan
// pa t rate l), e apèl la te kontinye ak yon montan envalid jouk li echwe
// pi lwen ak yon erè jenerik "Échec du paiement".
const toTransfer = (r: Record<string, unknown>): DbTransfer => ({
  id: r.id as string, txnId: r.txn_id as string,
  fromUserId: r.from_user_id as string | undefined, toUserId: r.to_user_id as string | undefined,
  fromFredaTag: r.from_freda_tag as string | undefined, toFredaTag: r.to_freda_tag as string | undefined,
  type: r.type as DbTransfer["type"], status: r.status as DbTransfer["status"],
  amount: r.net_amount as number, currency: r.currency as Currency,
  fee: r.fee_amount as number, totalAmount: r.gross_amount as number,
  feeLabel: (r.fee_label as string | undefined) || undefined,
  description: r.description as string | undefined, note: r.note as string | undefined,
  paymentMethod: r.payment_method as string | undefined, externalRef: r.external_ref as string | undefined,
  metadata: r.metadata as Record<string, unknown> | undefined, failureReason: r.failure_reason as string | undefined,
  completedAt: r.completed_at ? new Date(r.completed_at as string) : undefined,
  createdAt: new Date(r.created_at as string), updatedAt: new Date(r.updated_at as string),
});

const toSub = (r: Record<string, unknown>): DbSubscription => ({
  id: r.id as string, userId: r.user_id as string,
  plan: r.plan as SubscriptionPlan, status: r.status as SubscriptionStatus,
  priceCents: r.price_cents as number,
  trialEndsAt: r.trial_ends_at ? new Date(r.trial_ends_at as string) : undefined,
  currentPeriodStart: r.current_period_start ? new Date(r.current_period_start as string) : undefined,
  currentPeriodEnd: r.current_period_end ? new Date(r.current_period_end as string) : undefined,
  graceStartedAt: r.grace_started_at ? new Date(r.grace_started_at as string) : undefined,
  lockedAt: r.locked_at ? new Date(r.locked_at as string) : undefined,
  cancelledAt: r.cancelled_at ? new Date(r.cancelled_at as string) : undefined,
  penaltyApplied: r.penalty_applied as boolean,
  penaltyAmountCents: r.penalty_amount_cents as number,
  penaltyAppliedAt: r.penalty_applied_at ? new Date(r.penalty_applied_at as string) : undefined,
  maxCards: r.max_cards as number, monthlyLimitCents: r.monthly_limit_cents as number,
  fredaiMessagesLimit: r.fredai_messages_limit as number, freeCardsIncluded: r.free_cards_included as number,
  includesBankAccount: r.includes_bank_account as boolean,
  cardsCreatedThisMonth: r.cards_created_this_month as number,
  monthlyVolumeCents: r.monthly_volume_cents as number, fredaiMessagesUsed: r.fredai_messages_used as number,
  usageResetAt: r.usage_reset_at ? new Date(r.usage_reset_at as string) : undefined,
  dunningEmailsSent: r.dunning_emails_sent as number,
  lastDunningAt: r.last_dunning_at ? new Date(r.last_dunning_at as string) : undefined,
  debtCents: r.debt_cents as number,
  createdAt: new Date(r.created_at as string), updatedAt: new Date(r.updated_at as string),
});

const genTxnId = () => {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const r = (n: number) => Array.from({length:n},()=>c[Math.floor(Math.random()*c.length)]).join("");
  return `FP-${r(4)}-${r(6)}`;
};

// ============================================================
export const SupabaseRepo = {

  // ── USERS ─────────────────────────────────────────────────
  users: {
    async create(data: Omit<DbUser, "id"|"createdAt"|"updatedAt">): Promise<DbUser> {
      const sb = getSupabase();
      const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(); // 14 jours
      // ✅ v68 — jenere kòd parennaj inik pou chak nouvo itilizatè (8
      // karaktè, MAJISKIL). Menm fòma ak backfill migration 039 la.
      const referralCode = ((data as any).referralCode as string)
        || Math.random().toString(36).slice(2, 10).toUpperCase();
      const { data: row, error } = await sb.from("users").insert({
        email: data.email, password_hash: data.passwordHash,
        firstname: data.firstname, lastname: data.lastname,
        phone: data.phone, dial_code: data.dialCode, country: data.country,
        city: data.city, address: data.address, state: (data as any).state, date_of_birth: data.dateOfBirth,
        genre: data.genre, freda_tag: data.FredaTag, avatar_url: data.avatarUrl,
        role: data.role, status: data.status, kyc_status: data.kycStatus,
        email_verified: data.emailVerified, phone_verified: data.phoneVerified,
        two_factor_enabled: data.twoFactorEnabled,
        // ✅ v68 — parennaj: kòd inik moun sa a ap pataje + ki moun ki envite l.
        referral_code: referralCode, referred_by: (data as any).referredBy,
      }).select().single();
      if (error) { if (error.code==="23505") throw new Error("EMAIL_ALREADY_EXISTS"); throw new Error(error.message); }
      // Créer subscription trial + wallet — non-bloquant si tables pas encore créées
      const userId = (row as any).id;
      await SupabaseRepo.subscriptions.createTrial(userId, new Date(trialEndsAt)).catch(e => {
        logger.warn("createTrial skip (table manque?)", { error: e.message });
      });
      await SupabaseRepo.wallets.getOrCreate(userId).catch(e => {
        logger.warn("getOrCreate wallet skip", { error: e.message });
      });
      logger.debug("DB: User créé", { email: data.email });
      return toUser(row as Record<string, unknown>);
    },
    async findById(id: string): Promise<DbUser|undefined> {
      const {data,error} = await getSupabase().from("users").select("*").eq("id",id).single();
      if (error||!data) return undefined; return toUser(data as Record<string,unknown>);
    },
    async findByEmail(email: string): Promise<DbUser|undefined> {
      const {data,error} = await getSupabase().from("users").select("*").eq("email",email.toLowerCase()).single();
      if (error||!data) return undefined; return toUser(data as Record<string,unknown>);
    },
    /**
     * ✅ v69 — DETEKSYON DOUB KONT (menm moun, lòt imèl).
     * Kritè: MENM prenon + MENM siyati + MENM dat nesans + MENM peyi.
     * Nou konpare an MINISKIL e san espas anplis, paske "Jean " ak "jean"
     * se menm moun. Nou EGZIJE dat nesans + peyi pou evite fo pozitif
     * (de moun ki rele "Jean Pierre" nan de peyi diferan se 2 moun).
     * Kont ki `deleted` yo pa konte.
     */
    async findByIdentity(
      firstname: string, lastname: string, dateOfBirth?: string, country?: string
    ): Promise<DbUser|undefined> {
      if (!dateOfBirth || !country) return undefined; // san sa yo, twòp risk fo pozitif
      const { data } = await getSupabase().from("users")
        .select("*")
        .eq("date_of_birth", dateOfBirth)
        .eq("country", country)
        .neq("status", "deleted");
      if (!data?.length) return undefined;
      const norm = (v?: string) => (v || "").trim().toLowerCase();
      const fn = norm(firstname), ln = norm(lastname);
      const hit = (data as any[]).find(r => norm(r.firstname) === fn && norm(r.lastname) === ln);
      return hit ? toUser(hit as Record<string,unknown>) : undefined;
    },
    /**
     * ✅ v69 — Twouve LÒT kont ki gen MENM idantite VERIFYE pa KYC.
     * Sèvi apre yon KYC apwouve: si dokiman ofisyèl la montre menm non +
     * menm dat nesans ke yon lòt kont, se MENM moun nan ki te kreye 2
     * kont (souvan ak yon non ki chanje pou kontounen kontwòl la).
     * Nou konpare sou done KYC yo (`kyc_first_name`…) EPI sou done
     * enskripsyon yo, paske premye kont lan ka poko fè KYC.
     */
    async findIdentityTwins(
      excludeUserId: string, firstname: string, lastname: string, dateOfBirth: string
    ): Promise<DbUser[]> {
      if (!firstname || !lastname || !dateOfBirth) return [];
      const { data } = await getSupabase().from("users")
        .select("*").eq("date_of_birth", dateOfBirth).neq("id", excludeUserId).neq("status", "deleted");
      if (!data?.length) return [];
      const norm = (v?: string) => (v || "").trim().toLowerCase();
      const fn = norm(firstname), ln = norm(lastname);
      return (data as any[])
        .filter(r =>
          (norm(r.kyc_first_name) === fn && norm(r.kyc_last_name) === ln) ||
          (norm(r.firstname) === fn && norm(r.lastname) === ln))
        .map(r => toUser(r as Record<string, unknown>));
    },
    async findByFredaTag(tag: string): Promise<DbUser|undefined> {
      const clean = tag.startsWith("@")?tag.slice(1):tag;
      const {data,error} = await getSupabase().from("users").select("*").eq("freda_tag",clean.toLowerCase()).single();
      if (error||!data) return undefined; return toUser(data as Record<string,unknown>);
    },
    async findByPhone(phone: string): Promise<DbUser|undefined> {
      const {data,error} = await getSupabase().from("users").select("*").eq("phone",phone).single();
      if (error||!data) return undefined; return toUser(data as Record<string,unknown>);
    },
    async update(id: string, data: Partial<Omit<DbUser,"id"|"createdAt"|"passwordHash">>): Promise<DbUser|undefined> {
      const sb = getSupabase();
      const updates: Record<string,unknown> = {};
      if (data.firstname!==undefined) updates.firstname=data.firstname;
      if (data.lastname!==undefined)  updates.lastname=data.lastname;
      if (data.phone!==undefined)     updates.phone=data.phone;
      if (data.dialCode!==undefined)  updates.dial_code=data.dialCode;
      if (data.country!==undefined)   updates.country=data.country;
      if (data.city!==undefined)      updates.city=data.city;
      if (data.address!==undefined)   updates.address=data.address;
      if ((data as any).state!==undefined)      updates.state=(data as any).state;
      if ((data as any).postalCode!==undefined) updates.postal_code=(data as any).postalCode;
      if (data.genre!==undefined)     updates.genre=data.genre;
      if (data.FredaTag!==undefined)  updates.freda_tag=data.FredaTag;
      if (data.avatarUrl!==undefined) updates.avatar_url=data.avatarUrl;
      if (data.status!==undefined)    updates.status=data.status;
      if (data.kycStatus!==undefined) updates.kyc_status=data.kycStatus;
      if (data.kycSessionId!==undefined) updates.kyc_session_id=data.kycSessionId;
      if (data.emailVerified!==undefined) updates.email_verified=data.emailVerified;
      if (data.lastLoginAt!==undefined)   updates.last_login_at=data.lastLoginAt;
      if ((data as any).mapleradCustomerId!==undefined)   updates.maplerad_customer_id=(data as any).mapleradCustomerId;
      if ((data as any).mapleradTier!==undefined)         updates.maplerad_tier=(data as any).mapleradTier;
      if ((data as any).usdAccountRef!==undefined)        updates.usd_account_ref=(data as any).usdAccountRef;
      if ((data as any).kycIdNumber!==undefined)          updates.kyc_id_number=(data as any).kycIdNumber;
      if ((data as any).kycIdType!==undefined)            updates.kyc_id_type=(data as any).kycIdType;
      if ((data as any).kycIdCountry!==undefined)         updates.kyc_id_country=(data as any).kycIdCountry;
      if ((data as any).kycFirstName!==undefined)         updates.kyc_first_name=(data as any).kycFirstName;
      if ((data as any).kycLastName!==undefined)          updates.kyc_last_name=(data as any).kycLastName;
      if ((data as any).kycNationality!==undefined)       updates.kyc_nationality=(data as any).kycNationality;
      if ((data as any).trialUsed!==undefined)            updates.trial_used=(data as any).trialUsed;
      if ((data as any).dateOfBirth!==undefined)          updates.date_of_birth=(data as any).dateOfBirth;
      // ✅ FIX: te manke — se sa ki fè bouton "Notifications" nan Pwofil la
      // pa t janm sove anyen (wè migration 019).
      if ((data as any).notifPrefs!==undefined)           updates.notif_prefs=(data as any).notifPrefs;
      const {data: row, error} = await sb.from("users").update(updates).eq("id",id).select().single();
      if (error||!row) return undefined; return toUser(row as Record<string,unknown>);
    },
    async updatePassword(id: string, hash: string): Promise<boolean> {
      const {error} = await getSupabase().from("users").update({password_hash:hash}).eq("id",id);
      return !error;
    },
    async updateKycStatus(id: string, kycStatus: DbUser["kycStatus"], kycSessionId?: string): Promise<void> {
      const updates: Record<string,unknown> = {kyc_status:kycStatus};
      if (kycSessionId) updates.kyc_session_id=kycSessionId;
      if (kycStatus==="approved") updates.status="active";
      await getSupabase().from("users").update(updates).eq("id",id);
    },
    async updateStatus(id: string, status: DbUser["status"]): Promise<void> {
      await getSupabase().from("users").update({status}).eq("id",id);
    },
    async updateLastLogin(id: string): Promise<void> {
      await getSupabase().from("users").update({last_login_at:new Date().toISOString()}).eq("id",id);
    },

    /** ✅ NOUVO: sove yon nouvo kòd verifikasyon imèl (ekspire nan 15 min). */
    async setEmailVerificationCode(id: string, code: string): Promise<void> {
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      await getSupabase().from("users")
        .update({ email_verification_code: code, email_verification_expires_at: expiresAt })
        .eq("id", id);
    },

    /** ✅ NOUVO: verifye kòd la — retounen true si l bon e pa ekspire. */
    async verifyEmailCode(id: string, code: string): Promise<boolean> {
      const { data } = await getSupabase().from("users")
        .select("email_verification_code, email_verification_expires_at")
        .eq("id", id).maybeSingle();
      if (!data?.email_verification_code) return false;
      if (data.email_verification_code !== code) return false;
      if (data.email_verification_expires_at && new Date(data.email_verification_expires_at) < new Date()) return false;
      // Kòd la bon — efase l pou l pa ka re-itilize (yon sèl fwa)
      await getSupabase().from("users")
        .update({ email_verification_code: null, email_verification_expires_at: null, email_verified: true })
        .eq("id", id);
      return true;
    },

    async list(limit=100): Promise<DbUser[]> {
      const {data} = await getSupabase().from("users").select("*").order("created_at",{ascending:false}).limit(limit);
      return (data||[]).map(r=>toUser(r as Record<string,unknown>));
    },
    async count(): Promise<number> {
      const {count} = await getSupabase().from("users").select("*",{count:"exact",head:true});
      return count||0;
    },
    toPublic(user: DbUser): Omit<DbUser,"passwordHash"> {
      const {passwordHash:_,...pub}=user; return pub;
    },
  },

  // ── SUBSCRIPTIONS ─────────────────────────────────────────
  subscriptions: {
    async createTrial(userId: string, trialEndsAt: Date): Promise<DbSubscription> {
      const plan = PLANS.trial;
      const {data,error} = await getSupabase().from("subscriptions").insert({
        user_id: userId, plan: "trial", status: "trial", price_cents: 0,
        trial_ends_at: trialEndsAt.toISOString(),
        max_cards: plan.maxCards, monthly_limit_cents: plan.monthlyLimitCents,
        fredai_messages_limit: plan.fredaiMessages, free_cards_included: plan.freeCardsIncluded,
        includes_bank_account: plan.includesBankAccount,
        usage_reset_at: new Date().toISOString(),
      }).select().single();
      if (error) throw new Error(error.message);
      return toSub(data as Record<string,unknown>);
    },

    async findByUserId(userId: string): Promise<DbSubscription|undefined> {
      const {data} = await getSupabase().from("subscriptions").select("*").eq("user_id",userId).single();
      if (!data) return undefined; return toSub(data as Record<string,unknown>);
    },

    async choosePlan(userId: string, plan: SubscriptionPlan): Promise<DbSubscription> {
      const p = PLANS[plan];
      const now = new Date();
      const periodEnd = new Date(now); periodEnd.setMonth(periodEnd.getMonth()+1);

      const payload = {
        user_id: userId,
        plan, status: "active", price_cents: p.priceCents,
        current_period_start: now.toISOString(), current_period_end: periodEnd.toISOString(),
        trial_ends_at: null, grace_started_at: null, locked_at: null,
        max_cards: p.maxCards, monthly_limit_cents: p.monthlyLimitCents,
        fredai_messages_limit: p.fredaiMessages, free_cards_included: p.freeCardsIncluded,
        includes_bank_account: p.includesBankAccount,
        debt_cents: 0, dunning_emails_sent: 0, monthly_volume_cents: 0,
        cards_created_this_month: 0, fredai_messages_used: 0,
        usage_reset_at: now.toISOString(),
      };

      // Upsert — crée OU met à jour selon si la subscription existe
      const {data, error} = await getSupabase()
        .from("subscriptions")
        .upsert(payload, { onConflict: "user_id" })
        .select()
        .single();

      if (error) throw new Error(error.message);
      logger.info("Plan choisi", {userId, plan});
      return toSub(data as Record<string,unknown>);
    },

    async update(userId: string, updates: Record<string,unknown>): Promise<void> {
      await getSupabase().from("subscriptions").update(updates).eq("user_id",userId);
    },

    async getInfo(userId: string): Promise<import("../types/subscription").SubscriptionInfo|null> {
      const sub = await this.findByUserId(userId);
      if (!sub) return null;
      const now = new Date();
      let daysUntilExpiry: number|null = null;
      if (sub.plan === "trial" && sub.trialEndsAt) {
        // Trial → calculer sur trialEndsAt (14 jours), pas currentPeriodEnd
        daysUntilExpiry = Math.ceil((sub.trialEndsAt.getTime() - now.getTime()) / (1000*60*60*24));
      } else if (sub.currentPeriodEnd) {
        daysUntilExpiry = Math.ceil((sub.currentPeriodEnd.getTime() - now.getTime()) / (1000*60*60*24));
      } else if (sub.trialEndsAt) {
        daysUntilExpiry = Math.ceil((sub.trialEndsAt.getTime() - now.getTime()) / (1000*60*60*24));
      }
      return {
        plan: sub.plan, status: sub.status,
        label: PLANS[sub.plan]?.label || sub.plan,
        priceCents: sub.priceCents,
        isLocked: sub.status==="locked",
        isGrace:  sub.status==="grace",
        isTrial:  sub.status==="trial",
        daysUntilExpiry,
        debtCents: sub.debtCents, debtFormatted: fmt(sub.debtCents),
        limits: { maxCards: sub.maxCards, monthlyLimitCents: sub.monthlyLimitCents, fredaiMessages: sub.fredaiMessagesLimit },
        usage:  { monthlyVolumeCents: sub.monthlyVolumeCents, cardsThisMonth: sub.cardsCreatedThisMonth, fredaiMessages: sub.fredaiMessagesUsed },
        freeCardsRemaining: Math.max(0, sub.freeCardsIncluded - sub.cardsCreatedThisMonth),
        includesBankAccount: sub.includesBankAccount,
      };
    },

    async incrementFredaiMessages(userId: string): Promise<boolean> {
      const sub = await this.findByUserId(userId);
      if (!sub) return false;
      if (sub.fredaiMessagesLimit > 0 && sub.fredaiMessagesUsed >= sub.fredaiMessagesLimit) return false;
      await this.update(userId, { fredai_messages_used: sub.fredaiMessagesUsed + 1 });
      return true;
    },

    async listAllForCron(): Promise<DbSubscription[]> {
      const {data} = await getSupabase().from("subscriptions").select("*").neq("status","cancelled");
      return (data||[]).map(r=>toSub(r as Record<string,unknown>));
    },
  },

  // ── REFRESH TOKENS ────────────────────────────────────────
  refreshTokens: {
    async create(userId: string, token: string): Promise<void> {
      await getSupabase().from("refresh_tokens").insert({
        user_id:userId, token, expires_at: new Date(Date.now()+7*24*60*60*1000).toISOString(),
      });
    },
    async find(token: string): Promise<DbRefreshToken|undefined> {
      const {data,error} = await getSupabase().from("refresh_tokens").select("*")
        .eq("token",token).is("revoked_at",null).gt("expires_at",new Date().toISOString()).single();
      if (error||!data) return undefined;
      const r = data as Record<string,unknown>;
      return {id:r.id as string,userId:r.user_id as string,token:r.token as string,
        expiresAt:new Date(r.expires_at as string),createdAt:new Date(r.created_at as string)};
    },
    async revoke(token: string): Promise<void> {
      await getSupabase().from("refresh_tokens").update({revoked_at:new Date().toISOString()}).eq("token",token);
    },
    async revokeAllForUser(userId: string): Promise<void> {
      await getSupabase().from("refresh_tokens").update({revoked_at:new Date().toISOString()})
        .eq("user_id",userId).is("revoked_at",null);
    },
  },

  // ── WALLETS ───────────────────────────────────────────────
  wallets: {
    async getOrCreate(userId: string, currency: Currency="USD"): Promise<DbWallet> {
      const {data:existing} = await getSupabase().from("wallets").select("*").eq("user_id",userId).eq("currency",currency).single();
      if (existing) return toWallet(existing as Record<string,unknown>);
      const {data:created,error} = await getSupabase().from("wallets").insert({
        user_id:userId, currency, balance:0, available_balance:0, pending_balance:0,
      }).select().single();
      if (error) throw new Error(error.message);
      return toWallet(created as Record<string,unknown>);
    },
    async findByUserId(userId: string, currency: Currency="USD"): Promise<DbWallet|undefined> {
      const {data} = await getSupabase().from("wallets").select("*").eq("user_id",userId).eq("currency",currency).single();
      if (!data) return undefined; return toWallet(data as Record<string,unknown>);
    },
    async credit(userId: string, cents: number, currency: Currency="USD"): Promise<DbWallet> {
      const w = await this.getOrCreate(userId,currency);
      const {data,error} = await getSupabase().from("wallets")
        .update({balance:w.balance+cents,available_balance:w.availableBalance+cents})
        .eq("user_id",userId).eq("currency",currency).select().single();
      if (error) throw new Error(error.message);
      return toWallet(data as Record<string,unknown>);
    },
    async debit(userId: string, cents: number, currency: Currency="USD"): Promise<DbWallet> {
      const w = await this.getOrCreate(userId,currency);
      // ✅ Si available_balance = 0/null, itilize balance kòm fallback
      const effectiveBalance = (w.availableBalance ?? 0) > 0 ? w.availableBalance : (w.balance ?? 0);
      if (effectiveBalance < cents) throw new Error("INSUFFICIENT_BALANCE");
      const {data,error} = await getSupabase().from("wallets")
        .update({
          balance: Math.max(0, w.balance - cents),
          available_balance: Math.max(0, effectiveBalance - cents),
        })
        .eq("user_id",userId).eq("currency",currency).select().single();
      if (error) throw new Error(error.message);
      return toWallet(data as Record<string,unknown>);
    },
    /**
     * ✅ NOUVO: debite SA KI POSIB, san janm echwe pou "solde insuffisant".
     *
     * `debit()` nòmal la LEVE `INSUFFICIENT_BALANCE` si pa gen ase lajan —
     * sa kòrèk pou yon tranzaksyon (nou pa vle li pase), men li PA bon pou
     * yon PENALITE: se JISTMAN paske moun nan pa t gen lajan an ke nou ap
     * aplike penalite a. Si nou te itilize `debit()`, penalite a ta echwe
     * chak fwa — egzakteman nan sèl ka kote nou bezwen l.
     *
     * Règ DB aktyèl nou an: balans PA KA vin negatif (`Math.max(0, ...)`
     * nan `debit()`). Nou respekte menm règ la isit: nou pran sa ki
     * disponib, epi nou rive a $0.00 — nou pa desann anba.
     *
     * Retounen: konbyen nou VRÈMAN pran (ka mwens pase sa nou te mande).
     */
    async debitUpTo(userId: string, cents: number, currency: Currency="USD"): Promise<{ takenCents: number; wallet: DbWallet }> {
      const w = await this.getOrCreate(userId, currency);
      const effectiveBalance = (w.availableBalance ?? 0) > 0 ? w.availableBalance : (w.balance ?? 0);
      const taken = Math.max(0, Math.min(cents, effectiveBalance));
      if (taken === 0) return { takenCents: 0, wallet: w };
      const {data,error} = await getSupabase().from("wallets")
        .update({
          balance: Math.max(0, w.balance - taken),
          available_balance: Math.max(0, effectiveBalance - taken),
        })
        .eq("user_id",userId).eq("currency",currency).select().single();
      if (error) throw new Error(error.message);
      return { takenCents: taken, wallet: toWallet(data as Record<string,unknown>) };
    },
    async list(): Promise<DbWallet[]> {
      const {data} = await getSupabase().from("wallets").select("*");
      return (data||[]).map(r=>toWallet(r as Record<string,unknown>));
    },
  },

  // ── TRANSACTIONS LEDGER ───────────────────────────────────
  ledger: {
    async insert(entry: {
      txnId?: string; userId?: string; fromUserId?: string; toUserId?: string;
      cardId?: string; fromFredaTag?: string; toFredaTag?: string;
      type: string; status: string; direction: "credit"|"debit";
      grossCents: number; feeCents: number; netCents: number;
      description: string; note?: string; paymentMethod?: string;
      externalRef?: string; failureReason?: string;
      // ✅ v66 — tèks frè a jan li te ye NAN MOMAN tranzaksyon an.
      // Nou anrejistre l pou yon resi ki gen 6 mwa toujou montre bon frè a,
      // menm si administratè a chanje pri a nan `fee_rules` apre sa.
      feeLabel?: string;
    }): Promise<string> {
      const txnId = entry.txnId || genTxnId();
      const {error} = await getSupabase().from("transactions_ledger").insert({
        txn_id: txnId, user_id: entry.userId||null, from_user_id: entry.fromUserId||null,
        to_user_id: entry.toUserId||null, card_id: entry.cardId||null,
        from_freda_tag: entry.fromFredaTag||null, to_freda_tag: entry.toFredaTag||null,
        type: entry.type, status: entry.status, direction: entry.direction,
        gross_amount: entry.grossCents, fee_amount: entry.feeCents, net_amount: entry.netCents,
        fee_label: entry.feeLabel || null,
        currency: "USD", description: entry.description, note: entry.note||null,
        payment_method: entry.paymentMethod||null, external_ref: entry.externalRef||null,
        failure_reason: entry.failureReason||null,
        completed_at: entry.status==="completed"?new Date().toISOString():null,
      });
      if (error) logger.error("Ledger insert failed", {error:error.message});
      return txnId;
    },

    async findByUserId(userId: string, limit=30): Promise<any[]> {
      // ✅ FIX KRITIK "tranzaksyon moute 2 fwa": ansyen kòd la te fè
      // `.or(user_id.eq.X, from_user_id.eq.X, to_user_id.eq.X)`. Pou yon
      // tranzaksyon P2P, DE liy ledger yo kreye: youn pou moun ki voye
      // (user_id=voyè, to_user_id=moun k ap resevwa) ak youn pou moun k ap
      // resevwa (user_id=resevwa). Lè MOUN K AP RESEVWA a chaje istorik li
      // (findByUserId(resevwa)), condition `to_user_id.eq.resevwa` a
      // ATRAPE tou de liy yo: PWÒP liy li a (p2p_receive) AK liy voyè a
      // (p2p_send) — paske to_user_id nan liy voyè a se tou ID resevwa a.
      // Rezilta: resevwa a wè tranzaksyon an 2 fwa, e li wè "reçu" voyè a
      // tou. Chak liy ledger gen you SÈL vrè pwopriyetè: `user_id`. Se
      // SÈL kolòn sa a ki dwe filtre — `from_user_id`/`to_user_id` se
      // metadata sou lòt moun nan tranzaksyon an, PA yon pwopriyetè.
      const {data} = await getSupabase().from("transactions_ledger").select("*")
        .eq("user_id", userId)
        .order("created_at",{ascending:false}).limit(limit);
      return data||[];
    },

    async findByTxnId(txnId: string): Promise<any|undefined> {
      const {data} = await getSupabase().from("transactions_ledger").select("*").eq("txn_id",txnId).single();
      return data||undefined;
    },

    /**
     * ✅ NOUVO: jwenn antre ledger a pa `external_ref` (egzanp: referans kat la).
     * Itilize pou konnen EGZAKTEMAN konbyen lajan yon tranzaksyon te koute
     * anvan nou fè yon ranbousman — olye de kodifye yon montan fiks ki ka
     * pa matche (egzanp: kat tokenized koute $14 men ranbousman fiks te $5.20).
     */
    async findByExternalRef(externalRef: string): Promise<any|undefined> {
      const {data} = await getSupabase().from("transactions_ledger").select("*")
        .eq("external_ref", externalRef).order("created_at", { ascending: false }).limit(1).maybeSingle();
      return data || undefined;
    },

    /**
     * ✅ NOUVO: konplete antre "card_fund" ki an ATANT pou yon kat espesifik —
     * itilize lè webhook Maplerad konfime yon rechajman te vrèman reyisi.
     * Sa evite yon DEZYÈM antre/balans dwoub — SÈL webhook la deside si/kilè
     * rechajman an "vrèman" pase, `/fund` la sèlman antame l an atant.
     * Retounen `true` si li jwenn e konplete yon antre, `false` sinon (ka sa
     * a: fè apèl la konsidere kòm yon fondman "òdinè" — pa gen fondman
     * lokal ki an atant, sitiyasyon posib si lajan an te ajoute dirèkteman
     * sou Dashboard Maplerad, pa pa app nou an).
     */
    async completeCardFundPending(cardId: string): Promise<boolean> {
      const { data } = await getSupabase().from("transactions_ledger").select("txn_id")
        .eq("card_id", cardId).eq("type", "card_fund").eq("status", "pending")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!data) return false;
      await getSupabase().from("transactions_ledger")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("txn_id", (data as any).txn_id);
      return true;
    },

    /**
     * ✅ NOUVO: Maplerad voye PLIZYÈ evènman webhook SEPARE pou MENM aksyon
     * rechajman an (konfime pa done pwodiksyon: yon evènman `FUNDING` E yon
     * dezyèm evènman `WITHDRAWAL` distenk, tou de pou MENM $10.00 la, sou
     * MENM kat la, apeprè menm moman an). Fonksyon sa a detekte si yon
     * rechajman (`card_fund`) fèt DEJA sou kat sa a nan yon fenèt tan resan
     * — itilize kòm yon FILÈ SEKIRITE pou siprime evènman "eko" ki ta lakòz
     * yon dezyèm antre fo parèt (egzanp "Retrait carte" pou yon rechajman).
     */
    async findRecentCardFund(cardId: string, withinSeconds = 120): Promise<any | undefined> {
      const since = new Date(Date.now() - withinSeconds * 1000).toISOString();
      const { data } = await getSupabase().from("transactions_ledger").select("*")
        .eq("card_id", cardId).eq("type", "card_fund")
        .gte("created_at", since)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      return data || undefined;
    },

    async count(): Promise<number> {
      const {count} = await getSupabase().from("transactions_ledger").select("*",{count:"exact",head:true});
      return count||0;
    },
  },

  // ── TRANSFERS (compatibilité ancienne API) ────────────────
  transfers: {
    async create(data: Omit<DbTransfer,"id"|"txnId"|"createdAt"|"updatedAt">): Promise<DbTransfer> {
      const txnId = genTxnId();
      const {data:row,error} = await getSupabase().from("transactions_ledger").insert({
        txn_id:txnId, from_user_id:data.fromUserId||null, to_user_id:data.toUserId||null,
        from_freda_tag:data.fromFredaTag||null, to_freda_tag:data.toFredaTag||null,
        type:data.type, status:data.status, direction: data.toUserId&&!data.fromUserId?"credit":"debit",
        gross_amount:data.totalAmount, fee_amount:data.fee, net_amount:data.amount,
        currency:data.currency, description:data.description||null, note:data.note||null,
        payment_method:data.paymentMethod||null, external_ref:data.externalRef||null,
        failure_reason:data.failureReason||null, user_id:data.fromUserId||data.toUserId||null,
        completed_at:data.status==="completed"?new Date().toISOString():null,
      }).select().single();
      if (error) throw new Error(error.message);
      return {id:(row as any).id,txnId,...data,createdAt:new Date(),updatedAt:new Date()};
    },
    async findByTxnId(txnId: string): Promise<DbTransfer|undefined> {
      const {data} = await getSupabase().from("transactions_ledger").select("*").eq("txn_id",txnId).single();
      if (!data) return undefined; return toTransfer(data as Record<string,unknown>);
    },
    async findByUserId(userId: string, limit=50): Promise<DbTransfer[]> {
      const {data} = await getSupabase().from("transactions_ledger").select("*")
        .or(`user_id.eq.${userId},from_user_id.eq.${userId},to_user_id.eq.${userId}`)
        .order("created_at",{ascending:false}).limit(limit);
      return (data||[]).map(r=>toTransfer(r as Record<string,unknown>));
    },
    async updateStatus(id: string, status: DbTransfer["status"], failureReason?: string): Promise<DbTransfer|undefined> {
      const updates: Record<string,unknown> = {status};
      if (status==="completed") updates.completed_at=new Date().toISOString();
      if (failureReason) updates.failure_reason=failureReason;
      const {data} = await getSupabase().from("transactions_ledger").update(updates).eq("id",id).select().single();
      if (!data) return undefined; return toTransfer(data as Record<string,unknown>);
    },
    async list(limit=100): Promise<DbTransfer[]> {
      const {data} = await getSupabase().from("transactions_ledger").select("*").order("created_at",{ascending:false}).limit(limit);
      return (data||[]).map(r=>toTransfer(r as Record<string,unknown>));
    },
    async count(): Promise<number> {
      const {count} = await getSupabase().from("transactions_ledger").select("*",{count:"exact",head:true});
      return count||0;
    },
  },

  // ── NOTIFICATIONS ─────────────────────────────────────────
  notifications: {
    async create(data: Omit<import("../types/notification").DbNotification,"id"|"createdAt">): Promise<import("../types/notification").DbNotification> {
      const {data:row,error} = await getSupabase().from("notifications").insert({
        user_id:data.userId, type:data.type, title:data.title, message:data.message,
        data:data.data, is_read:false, priority:data.priority,
      }).select().single();
      if (error) throw new Error(error.message);
      const r=row as Record<string,unknown>;
      return {id:r.id as string,userId:r.user_id as string,type:r.type as any,
        title:r.title as string,message:r.message as string,data:r.data as any,
        isRead:r.is_read as boolean,priority:r.priority as any,createdAt:new Date(r.created_at as string)};
    },
    async findByUserId(userId: string, limit=30): Promise<import("../types/notification").DbNotification[]> {
      const {data} = await getSupabase().from("notifications").select("*")
        .eq("user_id",userId).order("created_at",{ascending:false}).limit(limit);
      return (data||[]).map(r=>{const row=r as Record<string,unknown>;return{
        id:row.id as string,userId:row.user_id as string,type:row.type as any,
        title:row.title as string,message:row.message as string,data:row.data as any,
        isRead:row.is_read as boolean,priority:row.priority as any,
        readAt:row.read_at?new Date(row.read_at as string):undefined,
        createdAt:new Date(row.created_at as string)};});
    },
    async markRead(id: string, userId: string): Promise<boolean> {
      const {error} = await getSupabase().from("notifications")
        .update({is_read:true,read_at:new Date().toISOString()}).eq("id",id).eq("user_id",userId);
      return !error;
    },
    async markAllRead(userId: string): Promise<number> {
      const {data} = await getSupabase().from("notifications")
        .update({is_read:true,read_at:new Date().toISOString()}).eq("user_id",userId).eq("is_read",false).select();
      return data?.length||0;
    },
    async delete(id: string, userId: string): Promise<boolean> {
      const {error} = await getSupabase().from("notifications").delete().eq("id",id).eq("user_id",userId);
      return !error;
    },
    async countUnread(userId: string): Promise<number> {
      const {count} = await getSupabase().from("notifications")
        .select("*",{count:"exact",head:true}).eq("user_id",userId).eq("is_read",false);
      return count||0;
    },
    async list(limit=200): Promise<import("../types/notification").DbNotification[]> {
      const {data} = await getSupabase().from("notifications").select("*").order("created_at",{ascending:false}).limit(limit);
      return data||[];
    },
  },

  // ── KYC ──────────────────────────────────────────────────
  kyc: {
    async upsert(data: Omit<DbKycSession,"id"|"createdAt"|"updatedAt">): Promise<DbKycSession> {
      const {data:row,error} = await getSupabase().from("kyc_sessions").upsert({
        user_id:data.userId, email:data.email, session_id:data.sessionId,
        session_url:data.sessionUrl, status:data.status, workflow_id:data.workflowId,
      },{onConflict:"session_id"}).select().single();
      if (error) throw new Error(error.message);
      const r=row as Record<string,unknown>;
      return {id:r.id as string,userId:r.user_id as string,email:r.email as string,
        sessionId:r.session_id as string,sessionUrl:r.session_url as string,
        status:r.status as any,workflowId:r.workflow_id as string,
        createdAt:new Date(r.created_at as string),updatedAt:new Date(r.updated_at as string)};
    },
    async findByUserId(userId: string): Promise<DbKycSession|undefined> {
      const {data} = await getSupabase().from("kyc_sessions").select("*")
        .eq("user_id",userId).order("created_at",{ascending:false}).limit(1).single();
      if (!data) return undefined;
      const r=data as Record<string,unknown>;
      return {id:r.id as string,userId:r.user_id as string,email:r.email as string,
        sessionId:r.session_id as string,sessionUrl:r.session_url as string,
        status:r.status as any,workflowId:r.workflow_id as string,
        verificationData:r.verification_data as any,
        createdAt:new Date(r.created_at as string),updatedAt:new Date(r.updated_at as string)};
    },
    async findBySessionId(sessionId: string): Promise<DbKycSession|undefined> {
      const {data} = await getSupabase().from("kyc_sessions").select("*").eq("session_id",sessionId).single();
      if (!data) return undefined;
      const r=data as Record<string,unknown>;
      return {id:r.id as string,userId:r.user_id as string,email:r.email as string,
        sessionId:r.session_id as string,sessionUrl:r.session_url as string,
        status:r.status as any,workflowId:r.workflow_id as string,
        createdAt:new Date(r.created_at as string),updatedAt:new Date(r.updated_at as string)};
    },
    async updateStatus(sessionId: string, status: DbKycSession["status"]): Promise<void> {
      const updates: Record<string,unknown>={status};
      if (status==="Approved"||status==="Declined") updates.completed_at=new Date().toISOString();
      await getSupabase().from("kyc_sessions").update(updates).eq("session_id",sessionId);
    },
    async updateVerificationData(sessionId: string, data: object): Promise<void> {
      await getSupabase().from("kyc_sessions").update({verification_data:data}).eq("session_id",sessionId);
    },
    async deleteBySessionId(sessionId: string): Promise<void> {
      await getSupabase().from("kyc_sessions").delete().eq("session_id",sessionId);
    },
    async list(): Promise<DbKycSession[]> {
      const {data} = await getSupabase().from("kyc_sessions").select("*").order("created_at",{ascending:false});
      return (data||[]).map(r=>{const row=r as Record<string,unknown>;return{
        id:row.id as string,userId:row.user_id as string,email:row.email as string,
        sessionId:row.session_id as string,sessionUrl:row.session_url as string,
        status:row.status as any,workflowId:row.workflow_id as string,
        createdAt:new Date(row.created_at as string),updatedAt:new Date(row.updated_at as string)};});
    },
  },

  // ── WEBHOOK EVENTS ────────────────────────────────────────
  webhookEvents: {
    async insert(data:{eventId:string;eventName:string;cardId:string;status:string;payload:object;source?:string}): Promise<{id:string}> {
      const {data:row,error} = await getSupabase().from("webhook_events").insert({
        event_id:data.eventId,event_name:data.eventName,card_id:data.cardId,
        status:data.status,payload:data.payload,source:data.source||"maplerad",received_at:new Date().toISOString(),
      }).select("id").single();
      if (error) throw new Error(error.message);
      return {id:(row as Record<string,unknown>).id as string};
    },
    async isDuplicate(eventId: string): Promise<boolean> {
      const {count} = await getSupabase().from("webhook_events")
        .select("*",{count:"exact",head:true}).eq("event_id",eventId).neq("status","failed");
      return (count||0)>0;
    },
    async markProcessed(id: string): Promise<void> {
      await getSupabase().from("webhook_events").update({status:"processed",processed_at:new Date().toISOString()}).eq("id",id);
    },
    async markFailed(id: string, errorMessage: string): Promise<void> {
      await getSupabase().from("webhook_events").update({status:"failed",error_message:errorMessage}).eq("id",id);
    },
    async list(limit=100): Promise<unknown[]> {
      const {data} = await getSupabase().from("webhook_events").select("*").order("received_at",{ascending:false}).limit(limit);
      return data||[];
    },
  },

  // ── AUDIT LOGS ────────────────────────────────────────────
  auditLogs: {
    async insert(data:{userId?:string;action:string;entity?:string;entityId?:string;ipAddress?:string;metadata?:object}): Promise<void> {
      try {
        await getSupabase().from("audit_logs").insert({
          user_id:data.userId,action:data.action,entity:data.entity,
          entity_id:data.entityId,ip_address:data.ipAddress,metadata:data.metadata,
        });
      } catch {}
    },
    async findByUserId(userId: string, limit=50): Promise<unknown[]> {
      const {data} = await getSupabase().from("audit_logs").select("*")
        .eq("user_id",userId).order("created_at",{ascending:false}).limit(limit);
      return data||[];
    },
  },

  // ── CARDS ─────────────────────────────────────────────────
  cards: {
    async upsert(data:{
      cardid:string; userId:string; email?:string; firstname?:string; lastname?:string;
      cardType?:string; status?:string; balance?:number;
      maskedPan?:string; expiry?:string; theme?:string; isTokenized?:boolean;
      mapleradCardId?:string; hidden?:boolean;
    }): Promise<void> {
      const row: Record<string, unknown> = {};
      if (data.email          !== undefined) row.email             = data.email;
      if (data.firstname      !== undefined) row.firstname          = data.firstname;
      if (data.lastname       !== undefined) row.lastname           = data.lastname;
      if (data.cardType       !== undefined) row.card_type          = data.cardType;
      if (data.status         !== undefined) row.status             = data.status;
      if (data.balance        !== undefined) row.balance            = data.balance;
      if (data.maskedPan      !== undefined) row.masked_pan         = data.maskedPan;
      if (data.expiry         !== undefined) row.expiry             = data.expiry;
      if (data.theme          !== undefined) row.theme              = data.theme;
      if (data.isTokenized    !== undefined) row.is_tokenized       = data.isTokenized;
      if (data.mapleradCardId !== undefined) row.maplerad_card_id   = data.mapleradCardId;
      if (data.hidden         !== undefined) row.hidden             = data.hidden;

      // ✅ FIX: Postgres tcheke kontrent NOT NULL (egzanp email) pandan l ap
      // konstwi ranje INSERT la POU YOU ka teste konfli — sa fè l echwe menm si
      // rezilta final la ta dwe yon UPDATE ki pa janm touche `email`. Se poutèt
      // sa CHAK mizajou pasyèl (balans, estati, self-heal) te echwe pou kat ki
      // te DEJA egziste. Kounye a nou tcheke si ranje a egziste anvan:
      // - Si li egziste  → UPDATE (san danje pou done pasyèl, pa gen pwoblèm NOT NULL)
      // - Si li pa egziste → INSERT (mande tout chan obligatwa yo prezan)
      const { data: existing } = await getSupabase().from("cards").select("cardid").eq("cardid", data.cardid).maybeSingle();

      if (existing) {
        const { error } = await getSupabase().from("cards").update(row).eq("cardid", data.cardid);
        if (error) {
          logger.error("db.cards.upsert (update) échoué", { cardid: data.cardid, error: error.message });
          throw new Error(`Impossible de mettre à jour la carte: ${error.message}`);
        }
      } else {
        const { error } = await getSupabase().from("cards").insert({ cardid: data.cardid, user_id: data.userId, ...row });
        if (error) {
          logger.error("db.cards.upsert (insert) échoué", { cardid: data.cardid, error: error.message });
          throw new Error(`Impossible de créer la carte: ${error.message}`);
        }
      }
    },
    async findByCardId(cardidOrId: string): Promise<Record<string,unknown>|undefined> {
      // ✅ FIX KRITIK: ansyen kòd la te chèche SÈLMAN pa `cardid` (referans
      // lokal nou an) oswa `id` (Supabase row PK) — men VRÈ webhook Maplerad
      // yo (egzanp "issuing.transaction") voye `card_id` kòm UUID MAPLERAD
      // la, ki sove nan kolòn `maplerad_card_id` — yon TWAZYÈM valè
      // totalman diferan. San fix sa a, `getUserIdFromCardId()` nan
      // webhooks.ts toujou retounen `null` pou VRÈ tranzaksyon Maplerad yo,
      // kidonk balans kat/wallet kliyan an PA JANM mete ajou pou vrè lè yon
      // achte fèt — echèk sa a te pase an silans (`if (!userId) break;`).
      const supa = getSupabase();
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cardidOrId);
      const query = isUuid
        ? supa.from("cards").select("*").or(`cardid.eq.${cardidOrId},id.eq.${cardidOrId},maplerad_card_id.eq.${cardidOrId}`)
        : supa.from("cards").select("*").eq("cardid", cardidOrId);
      const { data } = await query.maybeSingle();
      return data as Record<string,unknown>|undefined;
    },
    async findByEmail(email: string): Promise<unknown[]> {
      // ✅ FIX KRITIK: si migrasyon 014 (`ALTER TABLE cards ADD COLUMN hidden`)
      // poko kouri sou DB pwodiksyon an, filtre `.eq("hidden", false)` fè
      // Supabase retounen yon ERÈ (kolòn pa egziste) — `data` vin `undefined`,
      // epi fonksyon an te retounen `[]` san dout: TOUT kat itilizatè a
      // disparèt nan app la, menm si yo la nan DB. Kounye a nou detekte erè
      // sa a espesifikman epi nou FALLBACK sou yon rekèt san filtè `hidden`
      // — konsa lis kat la pa janm disparèt, menm si migrasyon an poko kouri.
      const supa = getSupabase();
      const { data, error } = await supa.from("cards").select("*").eq("email", email).eq("hidden", false);
      if (error) {
        logger.warn("db.cards.findByEmail: filtre 'hidden' echwe (migrasyon 014 poko kouri?) — fallback san filtè", {
          email, error: error.message,
        });
        const fallback = await supa.from("cards").select("*").eq("email", email);
        return fallback.data || [];
      }
      return data || [];
    },
    async updateStatus(cardidOrMapleradId: string, status: string): Promise<void> {
      // ✅ FIX KRITIK: menm rezon ak findByCardId — webhook "issuing.terminated"
      // voye `card_id` kòm UUID Maplerad, PA referans lokal nou an.
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cardidOrMapleradId);
      const supa = getSupabase();
      if (isUuid) {
        await supa.from("cards").update({status}).or(`cardid.eq.${cardidOrMapleradId},maplerad_card_id.eq.${cardidOrMapleradId}`);
      } else {
        await supa.from("cards").update({status}).eq("cardid", cardidOrMapleradId);
      }
    },
    async updateBalance(cardidOrMapleradId: string, balance: number): Promise<void> {
      // ✅ FIX KRITIK: menm rezon ak findByCardId — san sa a, balans kat la
      // pa janm mete ajou lè yon VRÈ achte fèt sou kat la (webhook Maplerad
      // voye UUID Maplerad, PA referans lokal FP-CARD-xxx nou an).
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cardidOrMapleradId);
      const supa = getSupabase();
      if (isUuid) {
        await supa.from("cards").update({balance}).or(`cardid.eq.${cardidOrMapleradId},maplerad_card_id.eq.${cardidOrMapleradId}`);
      } else {
        await supa.from("cards").update({balance}).eq("cardid", cardidOrMapleradId);
      }
    },

    /**
     * ✅ NOUVO: anrejistre kòd 3DS/OTP la lè webhook `issuing.activation` rive.
     * Ekspire nan 5 minit — menm fenèt tan Maplerad/machann yo tipikman itilize.
     */
    async setOtp(cardidOrMapleradId: string, code: string): Promise<Record<string,unknown>|undefined> {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cardidOrMapleradId);
      const supa = getSupabase();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      const query = isUuid
        ? supa.from("cards").update({ otp_code: code, otp_expires_at: expiresAt })
            .or(`cardid.eq.${cardidOrMapleradId},maplerad_card_id.eq.${cardidOrMapleradId}`)
        : supa.from("cards").update({ otp_code: code, otp_expires_at: expiresAt })
            .eq("cardid", cardidOrMapleradId);
      const { data } = await query.select().maybeSingle();
      return data as Record<string,unknown>|undefined;
    },

    /**
     * ✅ NOUVO: jwenn si gen yon kòd OTP AKTYÈL (pa ekspire) pou yonn nan kat
     * itilizatè a. Itilize pa polling frontend la — retounen `undefined` si
     * pa gen anyen an atant (sa a se ka NÒMAL la, pa yon erè).
     */
    async findPendingOtpByUserId(userId: string): Promise<Record<string,unknown>|undefined> {
      const supa = getSupabase();
      const { data } = await supa.from("cards")
        .select("cardid, masked_pan, otp_code, otp_expires_at")
        .eq("user_id", userId)
        .not("otp_code", "is", null)
        .gt("otp_expires_at", new Date().toISOString())
        .order("otp_expires_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as Record<string,unknown>|undefined;
    },

    /** ✅ NOUVO: efase kòd OTP la apre kliyan an wè l (evite l re-parèt). */
    async clearOtp(cardid: string): Promise<void> {
      await getSupabase().from("cards").update({ otp_code: null, otp_expires_at: null }).eq("cardid", cardid);
    },
    async list(): Promise<unknown[]> {
      const {data} = await getSupabase().from("cards").select("*");
      return data||[];
    },
  },

  // ============================================================
  // Anons/bannyè app la
  // ============================================================
  announcements: {
    async list(): Promise<unknown[]> {
      const { data } = await getSupabase().from("announcements").select("*").order("created_at", { ascending: false });
      return data || [];
    },
    async getActive(): Promise<Record<string, unknown> | undefined> {
      const { data } = await getSupabase().from("announcements").select("*")
        .eq("is_active", true).order("updated_at", { ascending: false }).limit(1).maybeSingle();
      return data as Record<string, unknown> | undefined;
    },
    async create(input: { message: string; isScrolling?: boolean; tone?: string; createdByAdminId: string }) {
      const { data, error } = await getSupabase().from("announcements").insert({
        message: input.message,
        is_scrolling: input.isScrolling ?? false,
        tone: input.tone ?? "info",
        is_active: false,
        created_by_admin_id: input.createdByAdminId,
      }).select().single();
      if (error) throw new Error(error.message);
      return data;
    },
    async update(id: string, patch: Record<string, unknown>) {
      const { data, error } = await getSupabase().from("announcements")
        .update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).select().single();
      if (error) throw new Error(error.message);
      return data;
    },
    // ✅ Garanti YON SÈL anons aktif alafwa — dezaktive tout lòt yo anvan aktive nouvo a
    async deactivateAll(): Promise<void> {
      await getSupabase().from("announcements").update({ is_active: false }).eq("is_active", true);
    },
    async delete(id: string): Promise<void> {
      await getSupabase().from("announcements").delete().eq("id", id);
    },
  },

  // ============================================================
  // Paramèt jeneral app la (kle → valè JSON) — egzanp mòd mentnans
  // ============================================================
  appSettings: {
    async get(key: string): Promise<Record<string, unknown> | undefined> {
      const { data } = await getSupabase().from("app_settings").select("value").eq("key", key).maybeSingle();
      return (data?.value as Record<string, unknown> | undefined) || undefined;
    },
    async set(key: string, value: Record<string, unknown>, adminId?: string) {
      const { data, error } = await getSupabase().from("app_settings").upsert({
        key, value, updated_by_admin_id: adminId, updated_at: new Date().toISOString(),
      }).select().single();
      if (error) throw new Error(error.message);
      return data;
    },
  },

  // ============================================================
  // Inbox imèl — contact@fredapay.com / support@fredapay.com
  // ============================================================
  inboxEmails: {
    async list(mailbox?: string, limit = 200): Promise<unknown[]> {
      let q = getSupabase().from("inbox_emails").select("*").order("created_at", { ascending: false }).limit(limit);
      if (mailbox) q = q.eq("mailbox", mailbox);
      const { data } = await q;
      return data || [];
    },
    async findById(id: string): Promise<Record<string, unknown> | undefined> {
      const { data } = await getSupabase().from("inbox_emails").select("*").eq("id", id).maybeSingle();
      return data as Record<string, unknown> | undefined;
    },
    async findByThreadId(threadId: string): Promise<unknown[]> {
      const { data } = await getSupabase().from("inbox_emails").select("*").eq("thread_id", threadId).order("created_at", { ascending: true });
      return data || [];
    },
    async create(input: Record<string, unknown>) {
      const { data, error } = await getSupabase().from("inbox_emails").insert(input).select().single();
      if (error) throw new Error(error.message);
      return data;
    },
    async markRead(id: string): Promise<void> {
      await getSupabase().from("inbox_emails").update({ is_read: true }).eq("id", id);
    },
  },

  // ============================================================
  // Taux chanj deviz — modifyab pa admin
  // ============================================================
  currencyRates: {
    async list(): Promise<unknown[]> {
      const { data } = await getSupabase().from("currency_rates").select("*").order("currency", { ascending: true });
      return data || [];
    },
    async update(currency: string, usdRate: number, adminId?: string) {
      const { data, error } = await getSupabase().from("currency_rates").upsert({
        currency, usd_rate: usdRate, updated_by_admin_id: adminId, updated_at: new Date().toISOString(),
      }).select().single();
      if (error) throw new Error(error.message);
      return data;
    },
  },

  // ============================================================
  // Verifikasyon imèl AVAN kreyasyon kont
  // ============================================================
  pendingEmailVerifications: {
    async upsert(email: string, code: string, expiresAt: Date) {
      const { error } = await getSupabase().from("pending_email_verifications").upsert({
        email: email.toLowerCase(), code, verified: false, expires_at: expiresAt.toISOString(),
      });
      if (error) throw new Error(error.message);
    },
    async find(email: string): Promise<Record<string, unknown> | undefined> {
      const { data } = await getSupabase().from("pending_email_verifications").select("*").eq("email", email.toLowerCase()).maybeSingle();
      return data as Record<string, unknown> | undefined;
    },
    async markVerified(email: string): Promise<void> {
      await getSupabase().from("pending_email_verifications").update({ verified: true }).eq("email", email.toLowerCase());
    },
  },

  // ============================================================
  // Token push notifikasyon (Expo Push API)
  // ============================================================
  pushTokens: {
    async register(userId: string, token: string, platform?: string): Promise<void> {
      // ✅ `upsert` sou `token` (UNIQUE) — si menm aparèy la re-enskri (egzanp
      // apre yon re-enstalasyon), li mete ajou `user_id` olye kreye yon doub.
      await getSupabase().from("push_tokens").upsert(
        { user_id: userId, token, platform },
        { onConflict: "token" }
      );
      // ✅ FIX "2 notifikasyon pou menm evènman an": filè sekirite backend
      // — menm si klijan an echwe netwaye ansyen token li yo (egzanp
      // AsyncStorage efase san app la pa konnen), nou KENBE SÈLMAN 3 token
      // ki PI RESAN pou yon itilizatè, retire tout ki pi ansyen otomatikman.
      const { data: allTokens } = await getSupabase().from("push_tokens")
        .select("id, created_at").eq("user_id", userId).order("created_at", { ascending: false });
      if (allTokens && allTokens.length > 3) {
        const staleIds = allTokens.slice(3).map((r: any) => r.id);
        await getSupabase().from("push_tokens").delete().in("id", staleIds);
      }
    },
    async unregister(token: string): Promise<void> {
      await getSupabase().from("push_tokens").delete().eq("token", token);
    },
    async findByUserId(userId: string): Promise<string[]> {
      const { data } = await getSupabase().from("push_tokens").select("token").eq("user_id", userId);
      return (data || []).map((r: any) => r.token as string);
    },
    // ✅ v68 — nou bezwen `platform` pou konstwi bon fòma son an pou chak
    // aparèy: iOS mande son an nan yon OBJÈ, Android jwenn son an nan
    // channel la. San distenksyon sa a, Expo Push API retounen HTTP 400.
    async findWithPlatformByUserId(userId: string): Promise<{ token: string; platform: string | null }[]> {
      const { data } = await getSupabase().from("push_tokens").select("token, platform").eq("user_id", userId);
      return (data || []).map((r: any) => ({ token: r.token as string, platform: (r.platform as string) ?? null }));
    },
  },

  // ── REFERRALS (parennaj) ──────────────────────────────────
  // ✅ v68 — tout lojik pwogram parennaj la (front lan te deja la, backend
  // lan te vid). Wè migration 039.
  referrals: {
    /** Twouve yon itilizatè pa kòd parennaj li (san sansiblite kas). */
    async findUserByCode(code: string): Promise<DbUser | undefined> {
      const clean = code.trim().toUpperCase();
      if (!clean) return undefined;
      const { data, error } = await getSupabase()
        .from("users").select("*").eq("referral_code", clean).single();
      if (error || !data) return undefined;
      return toUser(data as Record<string, unknown>);
    },

    /** Tout fiye yon parennè (moun `referred_by = referrerId`). */
    async listReferees(referrerId: string): Promise<DbUser[]> {
      const { data } = await getSupabase()
        .from("users").select("*").eq("referred_by", referrerId)
        .order("created_at", { ascending: false });
      return (data || []).map((r: any) => toUser(r as Record<string, unknown>));
    },

    /** Rekonpans deja anrejistre pou yon parennè (pou kalkile total + eta). */
    async listRewards(referrerId: string): Promise<{ refereeId: string; amountCents: number; status: string; reason: string }[]> {
      const { data } = await getSupabase()
        .from("referral_rewards").select("referee_id, amount_cents, status, reason")
        .eq("referrer_id", referrerId);
      return (data || []).map((r: any) => ({
        refereeId: r.referee_id as string, amountCents: r.amount_cents as number,
        status: r.status as string, reason: r.reason as string,
      }));
    },

    /**
     * Anrejistre yon rekonpans SI li poko egziste (kontrent UNIQUE
     * anpeche doub). Retounen `true` si se yon NOUVO rekonpans (donk nou
     * dwe kredite parennè a), `false` si li te deja la.
     */
    async recordRewardIfNew(referrerId: string, refereeId: string, reason: string, amountCents: number): Promise<boolean> {
      const { error } = await getSupabase().from("referral_rewards").insert({
        referrer_id: referrerId, referee_id: refereeId, reason, amount_cents: amountCents, status: "paid",
      });
      if (error) {
        // 23505 = vyolasyon UNIQUE → rekonpans lan te deja peye, pa yon erè.
        if ((error as any).code === "23505") return false;
        throw new Error(error.message);
      }
      return true;
    },
  },
};
