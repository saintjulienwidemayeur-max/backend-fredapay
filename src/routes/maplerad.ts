// ============================================================
// Routes Maplerad — Freda Pay LLC
// Base: /api/maplerad
// Cards, Dépôts, Retraits, Comptes USD
//
// SECTIONS:
//   /deposit   → Collections (Pay-in)
//   /payout    → Transfers (Disbursements)
//   /cards     → Virtual Card Issuing
//   /accounts  → USD Virtual Bank Accounts
// ============================================================

import { Router, Request, Response } from "express";
import { requireAuth } from "../middleware/auth";
import { db } from "../db/store";
import { logger } from "../utils/logger";
import { WalletService } from "../services/wallet.service";
import { NotificationService } from "../services/notification.service";
import { FEES, fmt } from "../config/fees.config";
import { FeeService } from "../services/fee.service";
import { toCountryCode } from "../utils/countryCode";
import { guardCardTransaction } from "../services/cardTxnGuard.service";
import { CardFeesService } from "../services/cardFees.service";
import {
  MapleradCustomerService,
  MapleradCardService,
  MapleradCollectionService,
  MapleradTransferService,
  MapleradWalletService,
  MapleradBankService,
} from "../services/maplerad.service";
import {
  PAYMENT_CHANNELS,
  getChannelsByDirection,
  getChannelById,
  getChannelsByCountry,
  estimateFee,
  TRANSFER_FEES,
  SUPPORTED_CURRENCIES,
} from "../config/paymentChannels";

const router = Router();

/** ✅ v69 — Frè fiks pou fèmen yon kat ($0.50), dedwi nan ranbousman an. */
const CARD_CLOSURE_FEE_CENTS = 50;

const ref = (prefix: string) =>
  `FP-${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

// ============================================================
// DIAGNOSTIC — Test koneksyon Maplerad
// ============================================================

/**
 * GET /api/maplerad/ping
 * Teste koneksyon ak kle API Maplerad — pa bezwen otantifikasyon kliyan
 */
router.get("/ping", async (_req: Request, res: Response) => {
  const key = process.env.MAPLERAD_SECRET_KEY || "";

  if (!key) {
    res.status(500).json({
      ok: false,
      error: "MAPLERAD_SECRET_KEY manke nan .env",
      fix: "Ajoute MAPLERAD_SECRET_KEY=mpr_sk_... nan fichye .env la",
    });
    return;
  }

  // Teste dirèkteman ak fetch natif — pa pase pa mpr() wrapper
  try {
    const response = await (fetch as any)("https://api.maplerad.com/v1/wallets", {
      method: "GET",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${key}`,
      },
    });

    const text = await response.text();
    let body: any;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }

    if (response.ok) {
      res.json({
        ok:       true,
        status:   response.status,
        message:  "✅ Maplerad connecté avec succès",
        key_hint: key.slice(0, 12) + "...",
        wallets:  body.data?.length || 0,
      });
    } else {
      // Diagnostic par code
      let hint = "";
      if (response.status === 401) {
        hint = [
          "1. Vérifiez que la clé est correctement copiée depuis app.maplerad.com → Settings → API Keys",
          "2. Vérifiez que votre KYB (Know Your Business) est approuvé sur le dashboard",
          "3. Vérifiez que votre email de compte Maplerad est vérifié",
          "4. Si le compte est en Sandbox, utilisez la clé Sandbox (pas Live)",
          "5. Si la clé a été compromise, régénérez-la depuis le dashboard",
        ].join(" | ");
      } else if (response.status === 403) {
        hint = "IP non autorisée. Sur production, whitelistez l'IP de votre serveur sur app.maplerad.com → Settings → Security";
      }

      res.status(response.status).json({
        ok:       false,
        status:   response.status,
        error:    body?.message || body?.error || `HTTP ${response.status}`,
        key_hint: key.slice(0, 12) + "...",
        hint,
      });
    }
  } catch (e: any) {
    res.status(500).json({
      ok:    false,
      error: e.message,
      hint:  "Vérifiez la connexion réseau du serveur",
    });
  }
});

// ============================================================
// CANAUX DE PAIEMENT — Deposit & Withdrawal
// ============================================================

/**
 * GET /api/maplerad/channels
 * Retourne tous les canaux de paiement disponibles
 * Query: direction=deposit|withdrawal, currency=NGN|GHS...
 */
router.get("/channels", async (req: Request, res: Response) => {
  try {
    const { direction, currency, country } = req.query as Record<string, string>;

    let channels = PAYMENT_CHANNELS;

    if (direction === "deposit" || direction === "withdrawal")
      channels = channels.filter(c => c.directions.includes(direction));
    if (currency)
      channels = channels.filter(c => c.currency === currency.toUpperCase());
    if (country)
      channels = channels.filter(c => c.countryCode === country.toUpperCase());

    res.json({
      success:    true,
      currencies: SUPPORTED_CURRENCIES,
      fees:       TRANSFER_FEES,
      byCountry:  getChannelsByCountry(),
      data:       channels,
      total:      channels.length,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/maplerad/channels/:id
 * Détails d'un canal spécifique
 */
router.get("/channels/:id", (req: Request, res: Response) => {
  const channel = getChannelById(req.params.id);
  if (!channel) { res.status(404).json({ error: "Canal introuvable" }); return; }
  res.json({ success: true, data: channel });
});

/**
 * GET /api/maplerad/banks?currency=NGN&type=bank
 * Liste des banques/telcos depuis Maplerad API (pour remplir les selects)
 */
router.get("/banks", async (req: Request, res: Response) => {
  try {
    const { currency = "NGN", type = "bank" } = req.query as Record<string, string>;
    const result = await MapleradBankService.getBanks(currency, type as "bank" | "mobilemoney");
    res.json({ success: true, data: result.data });
  } catch (e: any) {
    // En cas d'erreur API → retourner les banques statiques du config
    const fallback = PAYMENT_CHANNELS
      .filter(c => c.currency === (req.query.currency as string || "NGN"))
      .flatMap(c => (c.fields.find(f => f.key === "bank_code")?.options || []))
      .map(o => ({ code: o.value, name: o.label }));
    res.json({ success: true, data: fallback, source: "fallback" });
  }
});

/**
 * POST /api/maplerad/channels/estimate-fee
 * Calculer les frais estimés pour un transfert
 */
router.post("/channels/estimate-fee", (req: Request, res: Response) => {
  const { currency, amount, channel_id } = req.body;
  if (!currency || !amount) { res.status(400).json({ error: "currency et amount requis" }); return; }

  const amountNum  = parseFloat(amount);
  const fee        = estimateFee(currency, amountNum);
  const netAmount  = amountNum - fee;
  const channel    = channel_id ? getChannelById(channel_id) : null;

  res.json({
    success:    true,
    currency,
    amount:     amountNum,
    fee,
    net_amount: netAmount,
    fee_desc:   TRANSFER_FEES[currency] ? `${TRANSFER_FEES[currency].type === "flat" ? fee + " " + TRANSFER_FEES[currency].unit : TRANSFER_FEES[currency].value + "%"}` : "N/A",
    channel:    channel ? { id: channel.id, name: channel.name, minAmount: channel.minAmount, maxAmount: channel.maxAmount } : null,
  });
});

/**
 * Helper: Upload base64 image → Supabase Storage → URL public
 * Maplerad bezwen yon URL, PA base64 dirèkteman
 */
async function uploadKycImageToStorage(base64: string, userId: string): Promise<string> {
  const { getSupabase } = await import("../db/supabase");
  const supabase = getSupabase();

  // Extraire type MIME ak données base64
  const match  = base64.match(/^data:(image\/[a-z+]+);base64,(.+)$/);
  const mime   = match?.[1] || "image/jpeg";
  const ext    = mime.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
  const raw    = match?.[2] || base64;
  const buffer = Buffer.from(raw, "base64");

  const filename = `kyc-documents/${userId}/${Date.now()}.${ext}`;

  const { error } = await supabase.storage
    .from("avatars")      // Utilise le même bucket que les avatars
    .upload(filename, buffer, {
      contentType:  mime,
      upsert:       true,
    });

  if (error) {
    logger.warn("Upload KYC image échoué — on essaie avec data URI", { error: error.message });
    // Fallback: retourner le data URI si Maplerad l'accepte
    return base64.startsWith("data:") ? base64 : `data:image/jpeg;base64,${base64}`;
  }

  const { data } = supabase.storage.from("avatars").getPublicUrl(filename);
  return data.publicUrl;
}

/**
 * POST /api/maplerad/customers/enroll
 * Enregistre un client Maplerad Tier 2 pour accès aux cartes
 * ⚠️ Sèlman si user PA encore enregistré (mapleradCustomerId manke)
 */
router.post("/customers/enroll", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;

  // Deklarasyon valab nan tout blòk (try + catch)
  const {
    firstName, lastName, email, phone, dateOfBirth,
    street, city, state, country, postalCode,
    identityType, identityNumber, identityImage, identityCountry,
  } = req.body;

  try {
    const user = await db.users.findById(userId);
    if (!user) { res.status(404).json({ error: "Utilisateur introuvable" }); return; }

    // ✅ Si client Maplerad existe déjà → retourner directement sans rien refaire
    const existingId = (user as any).mapleradCustomerId;
    if (existingId) {
      logger.info("Client Maplerad déjà enregistré — skip enrollment", { userId, mapleradId: existingId });
      res.json({ success: true, data: { id: existingId, status: "exists" } });
      return;
    }

    // Valider champs obligatoires
    if (!dateOfBirth) {
      res.status(400).json({ error: "Date de naissance requise (format DD-MM-YYYY)" }); return;
    }
    if (!identityNumber) {
      res.status(400).json({ error: "Numéro de pièce d'identité requis" }); return;
    }

    const cc = (country || "HT").toUpperCase();

    // Séparer indicatif téléphonique
    const rawPhone  = (phone || "").replace(/\s+/g, "");
    const phoneCode = rawPhone.startsWith("+") ? rawPhone.match(/^\+\d{1,3}/)?.[0] || "+509" : "+509";
    const phoneNum  = rawPhone.replace(/^\+\d{1,3}/, "") || rawPhone;

    // ✅ BUG #1 FIX: Maplerad attend une URL pour identity.image, PAS base64
    // Upload vers Supabase Storage → obtenir URL public
    let identityImageUrl: string | undefined;
    if (identityImage) {
      try {
        identityImageUrl = await uploadKycImageToStorage(identityImage, userId);
        logger.info("KYC image uploadée", { userId, url: identityImageUrl.slice(0, 60) });
      } catch (uploadErr: any) {
        logger.warn("Upload KYC image échoué, fallback data URI", { error: uploadErr.message });
        // Fallback si storage indisponible
        identityImageUrl = identityImage.startsWith("data:") ? identityImage : `data:image/jpeg;base64,${identityImage}`;
      }
    }

    const result = await MapleradCustomerService.enrollCustomer({
      first_name:             firstName || user.firstname,
      last_name:              lastName  || user.lastname,
      email:                  email     || user.email,
      country:                cc,
      identification_number:  identityNumber,
      dob:                    dateOfBirth,  // "DD-MM-YYYY"
      phone: {
        phone_country_code: phoneCode,
        phone_number:       phoneNum,
      },
      address: {
        street:      street      || user.address || "N/A",
        city:        city        || user.city    || "Port-au-Prince",
        state:       state       || city         || "Ouest",
        country:     cc,
        postal_code: postalCode  || "HT6110",
      },
      // ✅ identity est OPTIONNEL selon docs Maplerad
      identity: identityImageUrl ? {
        type:    (identityType?.toUpperCase() as any) || "PASSPORT",
        image:   identityImageUrl,
        number:  identityNumber,
        country: (identityCountry || cc).toUpperCase(),
      } : undefined,
    });

    await db.users.update(userId, { mapleradCustomerId: result.data.id } as any).catch(() => null);
    logger.info("Client Maplerad créé avec succès", { userId, mapleradId: result.data.id });
    res.json({ success: true, data: result.data });

  } catch (e: any) {
    const msg = e.message || "Erreur inconnue";
    logger.error("Erreur enrollment Maplerad", { userId, error: msg });

    // ✅ FIX PRINCIPAL: "already enrolled" → jwenn ID li epi upgrade tier
    if (msg.includes("already") || msg.includes("enrolled")) {
      try {
        const user2 = await db.users.findById(userId);
        const targetEmail = req.body.email || user2?.email || "";
        logger.info("Client déjà inscrit sur Maplerad — recherche ID existant", { userId, email: targetEmail });

        const existingId = await MapleradCustomerService.findCustomerByEmail(targetEmail);
        if (!existingId) {
          res.status(400).json({
            error: "Compte introuvable. Contactez support@fredapay.com.",
            code:  "ALREADY_ENROLLED",
          });
          return;
        }

        // Sauvegarder l'ID
        await db.users.update(userId, { mapleradCustomerId: existingId } as any).catch(() => null);
        logger.info("ID Maplerad existant récupéré et sauvegardé", { userId, mapleradId: existingId });

        // ✅ Upgrade Tier 1 avec les données du formulaire (requis pour créer une carte)
        if (identityNumber && dateOfBirth && phone) {
          try {
            const rawPhone2  = (phone || "").replace(/\s+/g, "");
            const phoneCode2 = rawPhone2.startsWith("+") ? rawPhone2.match(/^\+\d{1,3}/)?.[0] || "+509" : "+509";
            const phoneNum2  = rawPhone2.replace(/^\+\d{1,3}/, "") || rawPhone2;
            const cc2        = (country || "HT").toUpperCase();

            await MapleradCustomerService.upgradeTier1({
              customer_id:           existingId,
              dob:                   dateOfBirth,
              identification_number: identityNumber,
              phone: { phone_country_code: phoneCode2, phone_number: phoneNum2 },
              address: {
                street:      street      || user2?.address || "N/A",
                city:        city        || user2?.city    || "Port-au-Prince",
                state:       state       || city           || "Ouest",
                country:     cc2,
                postal_code: postalCode  || "HT6110",
              },
            });
            logger.info("Client Maplerad upgradé Tier 1", { userId, mapleradId: existingId });
          } catch (t1Err: any) {
            logger.info("Tier 1 upgrade skippé (déjà upgradé probablement)", { error: t1Err.message });
          }
        }

        // ✅ Upgrade Tier 2 si image disponible
        if (identityImage && identityNumber) {
          try {
            let imgUrl: string;
            try { imgUrl = await uploadKycImageToStorage(identityImage, userId); }
            catch { imgUrl = identityImage.startsWith("data:") ? identityImage : `data:image/jpeg;base64,${identityImage}`; }

            await MapleradCustomerService.upgradeTier2({
              customer_id: existingId,
              identity: {
                type:    (identityType?.toUpperCase()) || "PASSPORT",
                image:   imgUrl,
                number:  identityNumber,
                country: (identityCountry || country || "HT").toUpperCase(),
              },
            });
            logger.info("Client Maplerad upgradé Tier 2", { userId, mapleradId: existingId });
          } catch (t2Err: any) {
            logger.info("Tier 2 upgrade skippé", { error: t2Err.message });
          }
        }

        res.json({ success: true, data: { id: existingId, status: "recovered" } });
      } catch (recoverErr: any) {
        res.status(400).json({ error: "Client déjà inscrit.", code: "ALREADY_ENROLLED" });
      }
      return;
    }

    let userMsg = msg;
    if (msg.includes("401") || msg.includes("auth"))
      userMsg = "Service de paiement indisponible. Réessayez dans quelques instants.";
    else if (msg.includes("dob") || msg.includes("date"))
      userMsg = "Format date invalide. Utilisez DD-MM-YYYY (ex: 15-03-1990).";
    else if (msg.includes("image") || msg.includes("identity"))
      userMsg = "Document d'identité invalide. Vérifiez la photo.";

    res.status(400).json({ error: userMsg, detail: msg !== userMsg ? msg : undefined });
  }
});

/**
 * GET /api/maplerad/customers/status
 * ✅ Vérifie si le user a déjà un compte Maplerad et retourne son ID + comptes
 * Utilisé par le frontend pour skip le formulaire d'enrollment
 */
router.get("/customers/status", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  try {
    // ✅ No-cache — evite browser 304 ki kache update mapleradCustomerId
    res.set("Cache-Control", "no-store, no-cache, must-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");

    const user = await db.users.findById(userId);
    if (!user) { res.status(404).json({ error: "Utilisateur introuvable" }); return; }

    const mapleradCustomerId = (user as any).mapleradCustomerId;

    if (!mapleradCustomerId) {
      res.json({ enrolled: false, mapleradCustomerId: null });
      return;
    }

    let accounts: any[] = [];
    try {
      const result = await MapleradCustomerService.getCustomerAccounts(mapleradCustomerId);
      accounts = result.data || [];
    } catch { /* ignorer si Maplerad indisponible */ }

    res.json({ enrolled: true, mapleradCustomerId, accounts });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// CARD ISSUING — Cartes virtuelles USD
// ============================================================

/**
 * POST /api/maplerad/cards/create
 * Crée une carte virtuelle USD (async — webhook confirme)
 */
router.post("/cards/create", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  const { initial_amount, brand, network, pin, theme, type: cardType } = req.body;
  // ✅ Sipò tou bien "network" (nouvo modal) ke "brand" (ansyen)
  const cardNetwork = ((network || brand || "MASTERCARD") as string).toUpperCase() as "VISA" | "MASTERCARD";
  // "tokenized" → $12.00 | "debit" / undefined → $5.20
  const isTokenized = cardType === "tokenized";
  // ✅ NOUVO: chak kat DWE gen omwen $2.00 sou li lè l kreye — si kliyan an pa
  // presize okenn montan (oswa antre mwens pase $2), nou aplike $2.00 pa
  // defo, e nou pran l dirèkteman nan wallet kliyan an. Deklare `feeCents`/
  // `initialCents`/`totalCents` isit la (AVAN `try`) pou chemen "retry" (nan
  // `catch` pi ba a, lè yon upgrade Tier 1 otomatik reyisi) ka itilize menm
  // valè yo — anvan sa, chemen retry a te kreye kat la sou Maplerad san
  // janm debite wallet la ni anrejistre kat la lokalman (wè fix pi ba).
  const MIN_CARD_FUNDING_CENTS = 200;  // $2.00
  let feeCents = 0, initialCents = 0, totalCents = 0;
  try {
    feeCents = await CardFeesService.cardCreationFee(isTokenized);  // ✅ modifyab pa admin (card_fees table)
    const user = await db.users.findById(userId);
    if (!user) { res.status(404).json({ error: "Utilisateur introuvable" }); return; }

    // ✅ AUTO-ENROLLMENT: Si KYC approuvé mais pas encore de mapleradCustomerId
    // Utilise les données DB (enregistrées lors de KYC Didit) pour s'inscrire automatiquement
    let customerId = (user as any).mapleradCustomerId;
    const knownTier = (user as any).mapleradTier;

    if (!customerId && user.kycStatus === "approved") {
      // ✅ FIX: prefere nasyonalite VERIFYE pa Didit KYC a, sinon peyi tape nan enskripsyon an
      const enrollCountry = toCountryCode((user as any).kycNationality || user.country);

      const doUpgradeTier1 = async (cid: string) => {
        const rawPhone  = (user.phone || "+50900000000").replace(/\s+/g, "");
        const phoneCode = rawPhone.match(/^\+\d{1,3}/)?.[0] || "+509";
        const phoneNum  = rawPhone.replace(/^\+\d{1,3}/, "") || rawPhone;
        const dobRaw    = (user as any).dateOfBirth || "";
        const dobFmt    = dobRaw && dobRaw.split("-")[0].length === 4
          ? `${dobRaw.split("-")[2]}-${dobRaw.split("-")[1]}-${dobRaw.split("-")[0]}` : dobRaw;

        try {
          await MapleradCustomerService.upgradeTier1({
            customer_id:           cid,
            dob:                   dobFmt || "01-01-1990",
            identification_number: (user as any).kycIdNumber || user.email,
            phone: { phone_country_code: phoneCode, phone_number: phoneNum },
            address: {
              // ✅ FIX: te itilize city kòm state (bug) ak "N/A" kòm defo —
              // Maplerad egzije yon vrè adrès pou l sèvi kòm "billing address"
              // pou verifikasyon AVS lè kliyan achte sou sit ameriken yo.
              street:      (user as any).address || "Adresse non renseignée",
              city:        (user as any).city    || "Port-au-Prince",
              state:       (user as any).state   || "Ouest",
              country:     enrollCountry,
              postal_code: (user as any).postalCode || "HT6110",
            },
          });
          await db.users.update(userId, { mapleradTier: 1 } as any).catch(() => null);
          logger.info("✅ Tier 1 terminé", { userId, customerId: cid });
        } catch (tierErr: any) {
          logger.error("Upgrade Tier 1 Maplerad échoué", { userId, customerId: cid, error: tierErr.message });
        }
      };

      try {
        // ✅ FIX: chèche DABÒ si kliyan an deja egziste sou Maplerad, olye eseye kreye l
        // ANNAN retounen sou erè "already enrolled" — sa te repete chak fwa yon kliyan
        // deja anrejistre te eseye kreye yon kat, ak plizyè apèl API initil chak fwa.
        const existingId = await MapleradCustomerService.findCustomerByEmail(user.email);

        if (existingId) {
          customerId = existingId;
          await db.users.update(userId, { mapleradCustomerId: customerId } as any).catch(() => null);
          logger.info("Kliyan deja anrejistre sou Maplerad — pa kreye l ankò", { userId, customerId });

          // Si nou pa deja konnen Tier 1/2 fèt lokalman, verifye vrè tier la sou Maplerad
          // anvan nou re-eseye Tier 1 alavans (evite apèl initil si li deja fèt).
          if (knownTier !== 1 && knownTier !== 2) {
            try {
              const custData = await MapleradCustomerService.getCustomer(customerId);
              const remoteTier = Number(custData?.data?.tier ?? custData?.data?.kyc_tier ?? custData?.data?.level ?? 0);
              if (remoteTier >= 1) {
                await db.users.update(userId, { mapleradTier: remoteTier } as any).catch(() => null);
                logger.info("Tier Maplerad reyèl konfime — Tier 1 deja fèt", { userId, customerId, tier: remoteTier });
              } else {
                await doUpgradeTier1(customerId);
              }
            } catch {
              // Pa ka verifye tier la — eseye Tier 1 kanmenm, san blòke si li echwe
              await doUpgradeTier1(customerId);
            }
          }
        } else {
          // Kliyan pa egziste ditou sou Maplerad — kreye l pou premye fwa
          logger.info("Nouvo kliyan Maplerad — kreyasyon", { userId });
          const t0 = await MapleradCustomerService.createCustomer({
            first_name: user.firstname,
            last_name:  user.lastname,
            email:      user.email,
            country:    enrollCountry,
          });
          customerId = t0.data.id;
          await db.users.update(userId, { mapleradCustomerId: customerId } as any).catch(() => null);
          await doUpgradeTier1(customerId);
          logger.info("✅ Nouvo kliyan Maplerad kreye + Tier 1", { userId, customerId });
        }
      } catch (autoErr: any) {
        logger.error("Auto-enrollment Maplerad échoué", { userId, error: autoErr.message, raw: autoErr?.response?.data || autoErr?.data });
        if (!customerId) {
          res.status(400).json({
            error: "Complétez votre KYC pour activer cette fonctionnalité.",
            code: "AUTO_ENROLLMENT_FAILED",
            raw: autoErr.message || "Erreur inconnue",
          });
          return;
        }
      }
    }

    if (!customerId) {
      res.status(400).json({
        error: "Enregistrement requis",
        detail: "Complétez d'abord votre KYC ou remplissez le formulaire d'identité.",
        code: "CUSTOMER_REQUIRED",
      });
      return;
    }

    // Vérifier limite de cartes du plan
    const sub = await db.subscriptions.findByUserId(userId);
    if (sub && sub.maxCards > 0) {
      const { data: existingCards } = await (await import("../db/supabase")).getSupabase()
        .from("cards").select("id").eq("user_id", userId).neq("status", "terminated");
      const cardCount = existingCards?.length || 0;
      if (cardCount >= sub.maxCards) {
        res.status(403).json({
          error: `Limite atteinte: votre plan ${sub.plan} permet ${sub.maxCards} carte(s). Passez au plan supérieur.`,
          maxCards: sub.maxCards, currentCards: cardCount,
        });
        return;
      }
    }

    // ✅ FIX KRITIK — SWIV EGZANP OFISYÈL MAPLERAD LA EGZAKTEMAN:
    //   curl -d '{"customer_id":"...","currency":"USD","type":"VIRTUAL",
    //             "auto_approve":true,"brand":"MASTERCARD"}'
    // Egzanp ofisyèl la PA GEN chan `amount` DITOU pou yon kat san finansman.
    // ✅ NOUVO: kounye a `initial_amount` PA JANM ka bay 0 — si kliyan an pa
    // presize anyen (oswa antre mwens pase $2), nou APLIKE $2.00 pa defo.
    const requestedInitialCents = initial_amount ? Math.round(parseFloat(initial_amount) * 100) : 0;
    initialCents = Math.max(MIN_CARD_FUNDING_CENTS, requestedInitialCents);
    totalCents   = feeCents + initialCents;

    const wallet = await db.wallets.findByUserId(userId);
    // ✅ Sipò null/0 available_balance — itilize balance kòm fallback
    const walletBalance = (wallet?.availableBalance ?? null) !== null && wallet!.availableBalance > 0
      ? wallet!.availableBalance
      : (wallet?.balance ?? 0);
    const balanceDollars = (walletBalance / 100).toFixed(2);
    const needDollars    = (totalCents / 100).toFixed(2);

    logger.info("Card balance check", {
      userId, walletBalance, totalCents,
      availableBalance: wallet?.availableBalance,
      balance: wallet?.balance,
      feeCents, isTokenized,
    });

    if (!wallet || walletBalance < totalCents) {
      // ✅ FIX: mesaj la kounye a detaye poukisa total la egziste — frè kreyasyon
      // an SÈPARE de $2.00 minimòm ki oblije rete sou kat la, pou kliyan an
      // konprann egzakteman poukisa li bezwen $${needDollars} la, pa jis yon chif.
      res.status(402).json({
        error:    `Solde insuffisant. Cette carte nécessite $${(feeCents / 100).toFixed(2)} de frais de création + $${(initialCents / 100).toFixed(2)} minimum à charger sur la carte = $${needDollars} USD au total. Vous avez $${balanceDollars} USD disponible.`,
        required:  totalCents,
        available: walletBalance,
        code:     "BALANCE_INSUFFICIENT",
      });
      return;
    }

    const reference = ref("CARD");

    // ✅ Créer la carte via Maplerad — POST /v1/issuing
    // is_contactless: true = tokenized (Apple Pay / Google Pay)
    // ✅ NOUVO: `amount` toujou prezan kounye a (initialCents pa janm 0 — minimòm $2.00)
    const result = await MapleradCardService.createCard({
      customer_id:    customerId,
      currency:       "USD",
      type:           "VIRTUAL",
      auto_approve:   true,
      brand:          cardNetwork,
      amount:         initialCents,
      is_contactless: isTokenized,  // ✅ Tokenized = contactless
    });

    // Débiter frais de création
    await db.wallets.debit(userId, totalCents);
    // ✅ FIX CRITIQUE: ansyen kòd la anrejistre SÈLMAN `feeCents_val` ($12) nan
    // istorik tranzaksyon an, alòske `totalCents` ($14 = frè + $2 finansman
    // inisyal) se sa ki VRÈMAN debite nan wallet la (liy anwo a). Sa te koz
    // yon diferans ant sa itilizatè a wè nan "Transactions récentes" ($12.00)
    // ak sa ki te reyèlman soti nan kont li a ($14.00). Kounye a nou anrejistre
    // `totalCents` — montan afiche a matche EGZAKTEMAN ak montan debite a.
    // ✅ FIX: retire mansyon "(Maplerad)" — non founisè a pa dwe parèt bay kliyan.
    await db.ledger.insert({
      userId, type: "card_creation_fee", status: "completed", direction: "debit",
      grossCents: totalCents, feeCents: 0, netCents: totalCents,
      description: `Émission carte ${isTokenized ? "tokenisée (Apple/Google Pay)" : "débit"} ${cardNetwork}`,
      externalRef: result.data.reference,
    }).catch(() => null);

    // Sauvegarder en DB locale (status "pending" — webhook confirmera)
    // ✅ FIX: card_type dwe rezo a (visa/mastercard) — se sa CHECK CONSTRAINT DB a egzije.
    // "tokenized"/"virtual_usd" pa t janm valab, sa te fè upsert echwe an silans.
    await db.cards.upsert({
      cardid:      result.data.reference,
      userId,
      email:       user.email,
      firstname:   user.firstname,
      lastname:    user.lastname,
      cardType:    cardNetwork.toLowerCase(),   // "visa" oswa "mastercard"
      status:      "pending",
      balance:     initialCents,
      theme:       (req.body.theme as string) || theme || "card-blue",
      isTokenized: isTokenized,
    });

    if (pin) {
      logger.info("Carte créée avec PIN défini", { userId, ref: result.data.reference, pinLength: String(pin).length });
    }

    // ✅ FIX: mesaj sa a te DI FIKS "Mastercard" pou TOUT kat, menm lè
    // itilizatè a te chwazi Visa — kliyan Visa yo te toujou resevwa yon
    // notifikasyon ki di "carte Mastercard". Kounye a nou itilize `cardNetwork`
    // (deja kalkile pi wo apati `network`/`brand` itilizatè a te voye).
    const networkLabel = cardNetwork === "VISA" ? "Visa" : "Mastercard";
    await NotificationService.system(userId,
      "Carte virtuelle en création",
      `Votre carte ${networkLabel} USD est en cours de création. Vous serez notifié dès qu'elle sera active.`
    );

    logger.info("Carte Maplerad créée", { userId, ref: result.data.reference, customerId });
    res.json({
      success: true,
      data: {
        reference:   result.data.reference,
        status:      "pending",
        currency:    "USD",
        message:     "Carte en cours de création. Vous recevrez une notification quand elle sera active.",
      },
    });
  } catch (e: any) {
    const msg   = e.message || "";
    const lower = msg.toLowerCase();
    logger.error("Erreur création carte Maplerad", { userId, error: msg });

    // ✅ Si tier ensifizan → tante upgrade Tier 1 otomatikman epi retry yon fwa
    if (lower.includes("tier") || lower.includes("upgrade") || lower.includes("kyc") || lower.includes("level")) {
      try {
        const user2 = await db.users.findById(userId);
        const cId   = (user2 as any)?.mapleradCustomerId;
        if (cId && user2) {
          logger.info("Tentative upgrade Tier 1 avant création carte", { userId, customerId: cId });
          const rawPhone  = ((user2 as any).phone || "+50900000000").replace(/\s+/g, "");
          const phoneCode = rawPhone.match(/^\+\d{1,3}/)?.[0] || "+509";
          const phoneNum  = rawPhone.replace(/^\+\d{1,3}/, "") || rawPhone;
          const dob       = (user2 as any).dateOfBirth || "01-01-1990";
          const dobFmt    = dob.includes("-") && dob.split("-")[0].length === 4
            ? `${dob.split("-")[2]}-${dob.split("-")[1]}-${dob.split("-")[0]}`
            : dob;

          await MapleradCustomerService.upgradeTier1({
            customer_id:           cId,
            dob:                   dobFmt,
            identification_number: user2.email,  // fallback si pa gen ID card
            phone: { phone_country_code: phoneCode, phone_number: phoneNum },
            address: {
              street:      (user2 as any).address || "Adresse non renseignée",
              city:        (user2 as any).city    || "Port-au-Prince",
              state:       (user2 as any).state   || "Ouest",
              country:     toCountryCode((user2 as any).kycNationality || (user2 as any).country),
              postal_code: (user2 as any).postalCode || "HT6110",
            },
          });

          // Retry kat kreye — avèk bon network (re-parse depuis req.body)
          const retryNetwork   = ((req.body.network || req.body.brand || "MASTERCARD") as string).toUpperCase() as "VISA" | "MASTERCARD";
          const retryTokenized = req.body.type === "tokenized";
          const retry = await MapleradCardService.createCard({
            customer_id:    cId,
            currency:       "USD",
            type:           "VIRTUAL",
            auto_approve:   true,
            brand:          retryNetwork,
            amount:         initialCents,  // ✅ NOUVO: menm minimòm $2.00 la apike la tou
            is_contactless: retryTokenized,
          });

          // ✅ FIX KRITIK: chemen "retry" (apre yon upgrade Tier 1 otomatik) te
          // kreye kat la sou Maplerad ak SIKSÈ, men li pa t janm (1) debite
          // wallet kliyan an, (2) anrejistre yon liy nan istorik tranzaksyon
          // yo, ni (3) sove kat la nan DB lokal nou an. Rezilta: kliyan te ka
          // jwenn yon kat San peye pou li, e kat la te vin "envizib" pou tout
          // rès app la — webhook "kat aktive" a pa ta ka jwenn ki itilizatè
          // ki posede l, paske pa t gen okenn anrejistreman lokal pou l
          // matche sou li. Kounye a nou fè EGZAKTEMAN menm bagay ak chemen
          // prensipal la anlè a.
          await db.wallets.debit(userId, totalCents);
          await db.ledger.insert({
            userId, type: "card_creation_fee", status: "completed", direction: "debit",
            grossCents: totalCents, feeCents: 0, netCents: totalCents,
            description: `Émission carte ${retryTokenized ? "tokenisée (Apple/Google Pay)" : "débit"} ${retryNetwork}`,
            externalRef: retry.data.reference,
          }).catch(() => null);
          await db.cards.upsert({
            cardid:      retry.data.reference,
            userId,
            email:       user2.email,
            firstname:   user2.firstname,
            lastname:    user2.lastname,
            cardType:    retryNetwork.toLowerCase(),
            status:      "pending",
            balance:     initialCents,
            theme:       (req.body.theme as string) || theme || "card-blue",
            isTokenized: retryTokenized,
          });
          const retryNetworkLabel = retryNetwork === "VISA" ? "Visa" : "Mastercard";
          await NotificationService.system(userId,
            "Carte virtuelle en création",
            `Votre carte ${retryNetworkLabel} USD est en cours de création. Vous serez notifié dès qu'elle sera active.`
          );
          res.json({
            success: true,
            data: { reference: retry.data.reference, status: "pending", currency: "USD",
              message: "Carte en cours de création. Vous recevrez une notification quand elle sera active." },
          });
          return;
        }
      } catch (upgradeErr: any) {
        logger.warn("Upgrade Tier 1 + retry carte échoué", { error: upgradeErr.message });
      }
      res.status(400).json({ error: "Complétez votre KYC pour créer une carte.", code: "TIER_REQUIRED" });
    } else if (lower.includes("customer") || lower.includes("not found")) {
      res.status(400).json({ error: "Vérification d'identité requise. Complétez votre KYC.", code: "CUSTOMER_INVALID", raw: msg });
    } else if (lower.includes("balance") || lower.includes("insufficient")) {
      res.status(503).json({ error: "Service temporairement indisponible. Réessayez plus tard.", code: "ISSUING_BALANCE_LOW", raw: msg });
    } else if (lower.includes("401") || lower.includes("auth")) {
      res.status(503).json({ error: "Service de paiement indisponible. Réessayez dans quelques instants.", code: "AUTH_ERROR", raw: msg });
    } else {
      res.status(400).json({ error: msg || "Erreur lors de la création de la carte.", raw: msg });
    }
  }
});

/**
 * GET /api/maplerad/cards
 * Lister les cartes d'un utilisateur
 */
router.get("/cards", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  try {
    const user    = await db.users.findById(userId);
    let dbCards = user ? await db.cards.findByEmail(user.email) : [];

    // ✅ FIX: repare otomatikman kat "pending" ki gen plis pase 15s depi kreyasyon
    // (dwe kite ase tan pou webhook la gen chans rive nòmalman anvan nou fòse tcheke)
    const pendingOld = (dbCards as any[]).filter(c =>
      c.status === "pending" && !c.maplerad_card_id &&
      (Date.now() - new Date(c.created_at).getTime()) > 15_000
    );
    if (pendingOld.length > 0) {
      await Promise.all(pendingOld.map(async (c) => {
        try {
          const live = await MapleradCardService.getCard(c.cardid);
          if (live?.data?.id) {
            const lc: any = live.data;
            const liveExpiry = lc.expiry || lc.expiry_date || lc.exp_date ||
              (lc.expiry_month && lc.expiry_year ? `${lc.expiry_month}/${String(lc.expiry_year).slice(-2)}` : undefined);
            await db.cards.upsert({
              cardid: c.cardid, userId: c.user_id,
              status: live.data.status === "ACTIVE" ? "active" : c.status,
              balance: live.data.balance, maskedPan: live.data.masked_pan,
              mapleradCardId: live.data.id, expiry: liveExpiry,
            }).catch(() => null);
          }
        } catch { /* Maplerad pa rekonèt li kòm ID — kat la toujou vrèman pending */ }
      }));
      dbCards = user ? await db.cards.findByEmail(user.email) : [];
    }

    // ✅ NOUVO: balans yo dwe TOUJOU reflete VRÈ balans Maplerad la — pa jis
    // kopi lokal nou an. Si yon moun ajoute lajan DIRÈKTEMAN sou Dashboard
    // Maplerad (pa pase pa app nou, kidonk pa gen webhook ki avize nou), lis
    // lokal la ta rete VYE pou tout tan san sa. Kounye a, chak fwa moun nan
    // louvri "Cartes", nou re-tcheke VRÈ balans lan pou chak kat ki gen yon
    // ID Maplerad konfime, an paralèl (Promise.all — pa youn apre lòt).
    const syncable = (dbCards as any[]).filter(c => c.maplerad_card_id && c.status !== "terminated" && !c.hidden);
    if (syncable.length > 0) {
      await Promise.all(syncable.map(async (c) => {
        try {
          const live = await MapleradCardService.getCard(c.maplerad_card_id);
          if (live?.data && typeof live.data.balance === "number") {
            c.balance    = live.data.balance;
            c.masked_pan = live.data.masked_pan || c.masked_pan;
            // Sove kopi lokal la a jou tou — lòt kote nan app la (notifikasyon,
            // resi, elt) li DB a dirèkteman san repase pa Maplerad chak fwa.
            await db.cards.upsert({
              cardid: c.cardid, userId: c.user_id,
              balance: live.data.balance, maskedPan: live.data.masked_pan,
            }).catch(() => null);
          }
        } catch (e: any) {
          // Maplerad pa reponn (rezo, rate limit, elt) — kenbe dènye valè
          // lokal nou konnen an olye kraze tout lis la; log pou n ka wè si
          // sa rive twò souvan.
          logger.warn("Échec sync balance carte en direct", { cardid: c.cardid, error: e.message });
        }
      }));
    }

    res.json({ success: true, data: dbCards });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ✅ FIX: `cardid` nan DB nou an se REFERANS PA NOU (ex: "CARD-xxxx"), men Maplerad
// egzije SON PWÒP ID (`card.id`, sove sèlman apre webhook "issuing.created.successful").
// San rezolisyon sa a, tout apèl Maplerad sou yon kat spesifik (detay, freeze, fund,
// transactions) te voye yon ID Maplerad pa rekonèt → "detay pa moute", 404/405, elt.
// ✅ EXPÒTE v106: `/api/fredai/execute` bezwen MENM rezolisyon an. Anvan,
// Fred'AI te pase `card.cardid` (referans LOKAL nou an) dirèkteman bay
// Maplerad ak bay `guard` la — DE bug:
//   1. Maplerad pa rekonèt referans lokal nou an → apèl la echwe.
//   2. `guard.commit()` te sove referans lokal la nan `card_id` ledger la,
//      men webhook la chèche pa VRÈ ID Maplerad la → pa gen match →
//      `completeCardFundPending()` pa janm jwenn liy lan → estati a rete
//      "En attente" POU TOUT TAN. Se egzakteman bug ki siyale a.
export async function resolveMapleradCardId(ourRefOrId: string): Promise<string> {
  const local = await db.cards.findByCardId(ourRefOrId);
  if (!local) throw new Error("Carte introuvable");

  // Chemen ideal: nou deja gen ID Maplerad la (webhook te reyisi)
  const real = (local as any)?.maplerad_card_id;
  if (real) return real;

  // ✅ FIX: Ansyen kòd la te rele `MapleradCardService.getCard(ourRef)` — men `ourRef`
  // se referans LOKAL nou an (FP-CARD-xxx), PA UUID Maplerad la. Maplerad p ap janm
  // rekonèt li → 404 → erè silans → return `ourRef` → tout apèl aval echwe an silans.
  //
  // Nouvo apwòch: LISTE tout kat kliyan an sou Maplerad, epi matche pa dat kreyasyon
  // ki pi pre kat lokal nou an. Fè self-heal pou pwochen fwa.
  const supa = (await import("../db/supabase")).getSupabase();
  const { data: userRow } = await supa
    .from("users")
    .select("maplerad_customer_id")
    .eq("id", local.user_id)
    .maybeSingle();

  const customerId = userRow?.maplerad_customer_id;
  if (!customerId) {
    if (local.status === "pending") {
      throw new Error("Carte en cours de création — réessayez dans 30 secondes.");
    }
    throw new Error("Client Maplerad introuvable. Complétez votre KYC.");
  }

  try {
    const allCards = await MapleradCardService.getCards();
    const list = Array.isArray(allCards?.data) ? allCards.data : [];

    // Filtre kat kliyan sa a — chan an ka gen non diferan selon vèsyon API a
    const mine = list.filter((c: any) =>
      c.customer_id === customerId ||
      c.customer?.id === customerId ||
      c.holder_id === customerId
    );

    if (mine.length === 0) {
      if (local.status === "pending") {
        throw new Error("Carte en cours de création — réessayez dans 30 secondes.");
      }
      throw new Error("Carte introuvable sur Maplerad — le webhook n'a peut-être pas été reçu.");
    }

    // Matche kat ki pi pre `local.created_at` la (nou konsidere ekar < 24h valab)
    const localCreated = new Date(local.created_at as string).getTime();
    const best = mine
      .map((c: any) => ({ card: c, diff: Math.abs(new Date(c.created_at).getTime() - localCreated) }))
      .sort((a, b) => a.diff - b.diff)[0];

    if (!best || best.diff > 24 * 3600 * 1000) {
      throw new Error("Impossible de faire correspondre la carte sur Maplerad.");
    }

    // Self-heal: sove ID reyèl la + ekri lòt chan yo tou
    const lc: any = best.card;
    const liveExpiry = lc.expiry || lc.expiry_date || lc.exp_date ||
      (lc.expiry_month && lc.expiry_year ? `${lc.expiry_month}/${String(lc.expiry_year).slice(-2)}` : undefined);

    await db.cards.upsert({
      cardid: local.cardid as string,
      userId: local.user_id as string,
      status: lc.status === "ACTIVE" ? "active" : (local.status as string),
      balance: lc.balance,
      maskedPan: lc.masked_pan,
      mapleradCardId: lc.id,
      expiry: liveExpiry,
    }).catch(() => null);

    logger.info("✅ maplerad_card_id rezoud via list matching", {
      ourRef: local.cardid, mapleradId: lc.id, customerId,
    });
    return lc.id;
  } catch (e: any) {
    logger.error("resolveMapleradCardId échec complet", { ourRef: ourRefOrId, error: e.message });
    throw e;  // Pa bay yon fo ID — kite l echwe klèman pou frontend afiche mesaj presi
  }
}

/**
 * GET /api/maplerad/cards/otp/pending
 * ✅ NOUVO: polling rapid frontend la itilize pou detekte yon kòd 3DS/OTP
 * ki fenk rive (via webhook "issuing.activation"). Retounen `data: null`
 * si pa gen anyen an atant — se ka NÒMAL la, PA yon erè.
 * ⚠️ POZISYON KRITIK: wout sa a DWE vini AVAN "/cards/:cardId" pi ba a —
 * otreman Express ta trete "otp" tankou yon valè `:cardId` e wout sa a
 * pa ta janm rive (menm bug modèl nou te wè ak lòt wout ki gen segman fiks).
 */
router.get("/cards/otp/pending", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  try {
    const pending = await db.cards.findPendingOtpByUserId(userId);
    if (!pending) { res.json({ success: true, data: null }); return; }
    res.json({
      success: true,
      data: {
        cardId:    pending.cardid,
        maskedPan: pending.masked_pan,
        code:      pending.otp_code,
        expiresAt: pending.otp_expires_at,
      },
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * PATCH /api/maplerad/cards/otp/dismiss
 * Kliyan an konfime li wè kòd la — efase l pou l pa re-parèt.
 */
router.patch("/cards/otp/dismiss", requireAuth, async (req: Request, res: Response) => {
  const { cardId } = req.body;
  if (!cardId) { res.status(400).json({ error: "cardId requis" }); return; }
  try {
    await db.cards.clearOtp(cardId);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/maplerad/cards/:cardId
 * Détails d'une carte (depuis Maplerad)
 */
router.get("/cards/:cardId", requireAuth, async (req: Request, res: Response) => {
  try {
    const realId = await resolveMapleradCardId(req.params.cardId);
    const result = await MapleradCardService.getCard(realId);
    // ✅ DYAGNOSTIK: log repons BRIT Maplerad la san filtraj — pou verifye si li
    // gen plis chan (egzanp nimewo kat konplè, cvv) ke sa dokiman yo mansyone.
    logger.info("Maplerad getCard — repons brit", { cardId: realId, rawKeys: Object.keys(result.data || {}), raw: result.data });
    res.json({ success: true, data: result.data });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/maplerad/cards/:cardId/fund
 * Recharger une carte depuis le wallet Freda Pay
 */
router.post("/cards/:cardId/fund", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  try {
    const { amount }  = req.body;
    const { cardId }  = req.params;
    const realId       = await resolveMapleradCardId(cardId);
    const amountCents = Math.round(parseFloat(amount) * 100);

    // ✅ v66.1 — pri rechaj la depann si kat la TOKENIZE oswa non.
    //   Tokenize : 1–100 $ → 2,79 $ ·  100–500 $ → 5 %
    //   Klasik   : 1–100 $ → 1,20 $ ·  100–500 $ → 2,5 %
    const localCard   = await db.cards.findByCardId(cardId);
    const isTokenized = (localCard as any)?.is_tokenized === true;

    if (!amountCents || isNaN(amountCents) || amountCents <= 0) {
      res.status(400).json({ error: "Montant invalide.", code: "INVALID_AMOUNT" });
      return;
    }

    // ✅ FIX: `cardReloadFee` leve yon erè technique "CARD_RELOAD_AMOUNT_OUT_OF_RANGE"
    // si montan an deyò $3–$500 — ansyen kòd la pa t kaptire sa a klèman, kidonk
    // itilizatè a te wè yon mesaj jenerik "Une erreur s'est produite" san konnen
    // poukisa. Nou kaptire erè sa a espesifikman epi retounen yon mesaj klè + yon
    // kòd (`AMOUNT_OUT_OF_RANGE`) pou frontend ka afiche yon validasyon presi.
    let feeCents: number;
    try {
      feeCents = await CardFeesService.cardReloadFee(amountCents, isTokenized);
    } catch (feeErr: any) {
      if (String(feeErr.message).includes("CARD_RELOAD_AMOUNT_OUT_OF_RANGE")) {
        res.status(400).json({
          error: "Montant de rechargement invalide. Le montant doit être entre $1.00 et $500.00.",
          code: "AMOUNT_OUT_OF_RANGE", min: 100, max: 50000,
        });
        return;
      }
      throw feeErr;
    }
    // ══════════════════════════════════════════════════════════
    // ✅ NOUVO: `guardCardTransaction` — validasyon AVAN Maplerad
    // ══════════════════════════════════════════════════════════
    // Sa a ranplase ansyen tchèk balans lan AK debi a. Li fè:
    //   1. total_required = montan + frè Freda Pay (konfigirab)
    //   2. si PA ase → penalite NSF $0.50 + refi 400, SAN rele Maplerad
    //   3. si ase   → debite AVAN, epi `refund()` si Maplerad echwe
    //
    // ✅ FIX BUG LÒD KI TE LA: ansyen kòd la te rele `fundCard()` AVAN
    // `db.wallets.debit()`. Si debi a te echwe APRE Maplerad te reyisi,
    // kat la te finanse men wallet la pa t janm debite — Freda Pay t ap
    // pèdi lajan an. Kounye a nou debite AVAN (rezève lajan an), epi nou
    // ranbouse si Maplerad echwe. Sa fèmen tou yon kous kondisyon: 2 rekèt
    // ansanm pa ka depanse MENM lajan an de fwa.
    //
    // NÒT: `feeCents` isit se frè RECHAJMAN an (card_reload_tier1/2) —
    // guard la ajoute PWÒP frè tranzaksyon Freda Pay pa li an plis.
    const guard = await guardCardTransaction(userId, amountCents + feeCents, {
      // ⚠️ `realId` (VRÈ ID Maplerad), PA `cardId` (referans lokal nou an) —
      // webhook la chèche pa `data.card_id`. Si nou mete referans lokal la,
      // `completeCardFundPending()` pa jwenn match e antre "pending" la rete
      // "En attente" pou tout tan (bug ki te deja korije — pa refè l).
      cardId: realId,
      type: "card_fund",
      description: "Rechargement carte",
      // ✅ v66.1 — tèks frè a jan li te ye nan moman rechaj la, pou detay
      // tranzaksyon an montre EGZAKTEMAN ki palye ki te aplike.
      feeLabel: await CardFeesService.cardReloadFeeLabel(amountCents, isTokenized),
    });
    if (!guard.ok) {
      res.status(guard.httpStatus).json(guard.body);
      return;
    }

    try {
      await MapleradCardService.fundCard(realId, amountCents);
    } catch (mapleradErr: any) {
      // ⚠️ Maplerad echwe → RANBOUSE. PA GEN PENALITE isit: moun nan TE GEN
      // lajan an, se pa fòt li.
      await guard.refund(mapleradErr?.message || "MAPLERAD_FUND_FAILED");
      throw mapleradErr;   // kite `catch` anba a fè dyagnostik li a
    }
    // ✅ FIX KRITIK: ansyen kòd la te KREYE antre istorik la "completed" AK
    // mete ajou balans kat la SENKWONIKMAN, isit la — epi APRE sa, webhook
    // konfimasyon Maplerad a te fè MENM 2 bagay yo YON DEZYÈM FWA, doub-
    // kredite balans kat la pou CHAK rechajman. Kounye a: SÈL wallet la
    // debite touswit isit la (pou anpeche moun depanse plis pase sa yo
    // genyen pandan y ap tann); antre istorik la kreye "pending" (PA
    // "completed"), e balans kat la PA touche ditou isit la — se SÈL
    // webhook `issuing.transaction` (`type: "FUNDING"`) ki konfime vrèman
    // e fè tou de bagay sa yo, yon sèl fwa, yon sèl kote.
    // ✅ Se `guard.commit()` ki ekri antre istorik la kounye a (yon sèl
    // kote) — nou pase VRÈ chif yo: `feeCents` isit se frè rechajman an
    // PLIS frè tranzaksyon Freda Pay guard la ajoute a.
    await guard.commit({
      grossCents: amountCents,
      feeCents:   feeCents + guard.feeCents,
      description: "Rechargement carte",
      externalRef: ref("CFUND"),
    }).catch(() => null);

    logger.info("Rechargement kat lanse — an atant konfimasyon webhook", { userId, cardId, amount });
    res.json({ success: true, pending: true, message: `Rechargement de ${fmt(amountCents)} en cours de confirmation...` });
  } catch (e: any) {
    // ✅ FIX: dyagnostik otomatik lè fund echwe. Dokiman Maplerad konfime:
    // "The amount will be debited from YOUR Maplerad balance" — sa vle di
    // echèk "could not process request" la pa yon bug nan fòma demand nou an
    // (nou swiv dokiman an 100%: POST /issuing/{id}/fund { amount }), men gen
    // gwo chans se BALANS PWOP FREDA PAY sou Maplerad ki ensifizan — sitou
    // depi Maplerad divize USD an 2 wallet separe (SPEND pou fund/withdraw,
    // TREASURY pou lòt operasyon) — si lajan an rete nan TREASURY, fund echwe
    // menm si "balans total" la sanble sifizan sou dashboard la.
    const msg = e.message || "";
    if (msg.toLowerCase().includes("could not process request") || msg.includes("[400]")) {
      try {
        const wallets = await MapleradWalletService.getWallets();
        logger.error("⚠️ Fund carte echwe — verifye balans Maplerad (SPEND wallet)", {
          userId, cardId: req.params.cardId, mapleradError: msg,
          mapleradWallets: wallets?.data,
          hint: "Si SPEND wallet la vid pandan TREASURY gen lajan, transfere via /reference/wallet-funding sou Maplerad.",
        });
      } catch { /* pa bloke repons kliyan an si dyagnostik la echwe */ }
    }
    logger.error("Erreur rechargement carte Maplerad", { userId, cardId: req.params.cardId, error: msg });
    res.status(500).json({ error: e.message });
  }
});

/**
 * PATCH /api/maplerad/cards/:cardId/suspend
 * Geler une carte (freeze)
 */
router.patch("/cards/:cardId/suspend", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  try {
    const realId = await resolveMapleradCardId(req.params.cardId);
    await MapleradCardService.freezeCard(realId);
    await db.cards.updateStatus(req.params.cardId, "blocked");
    await NotificationService.system(userId, "Carte gelée", "Votre carte a été gelée avec succès.");
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * PATCH /api/maplerad/cards/:cardId/activate
 * Dégeler une carte (unfreeze)
 */
router.patch("/cards/:cardId/activate", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  try {
    const realId = await resolveMapleradCardId(req.params.cardId);
    await MapleradCardService.unfreezeCard(realId);
    await db.cards.updateStatus(req.params.cardId, "active");
    await NotificationService.system(userId, "Carte dégelée", "Votre carte est de nouveau active.");
    res.json({ success: true });
  } catch (e: any) {
    // ✅ FIX: rasin pwoblèm lan te chemen/mòd HTTP nan maplerad.service.ts
    // (`PUT .../unfreeze` → 405 — wè fix nan MapleradCardService.unfreezeCard).
    // Kounye a se korije nan sous la; si yon erè rive kanmenm, nou toujou
    // evite yon 500 "brit" — 502 vle di "founisè a echwe", pa "nou kraze".
    logger.warn("Échec dégel carte", { userId, cardId: req.params.cardId, error: e.message });
    res.status(502).json({ error: "Le dégel a échoué. Réessayez dans quelques instants ou contactez le support." });
  }
});

/**
 * DELETE /api/maplerad/cards/:cardId
 * "Supprimer ma carte" — sipprime kat la nan app kliyan an.
 *
 * Konpòtman:
 *  - Si kat la PA "terminated" sou Maplerad: nou TÈMINE l pou tout tan
 *    (PUT .../terminate — https://maplerad.dev/reference/freeze-a-card-1)
 *    anvan nou kache l — sa anpeche nenpòt itilizasyon fwod si kat la
 *    ta gen enfo aktif toujou sou Maplerad menm apre kliyan retire l
 *    lokalman. ✅ FIX: ansyen kòd la te SÈLMAN JELE (freeze — reversib) kat
 *    la olye tèmine l — yon kat "siprime" te ka toujou dégele e itilize sou
 *    kote Maplerad, malgre li disparèt nan app la.
 *  - Si kat la DEJA "terminated" (egzanp: apre yon evènman webhook
 *    `issuing.terminated`, oswa yon echèk kreyasyon): nou pa rele Maplerad
 *    ditou (kat la deja mouri sou kote yo) — nou jis kache l lokalman.
 *  - Nan tou 2 ka: ranje a rete nan DB (pa efase) pou konfòmite/istorik —
 *    nou mete `hidden = true`, epi `GET /cards` filtre kat sa yo deyò.
 */
router.delete("/cards/:cardId", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  const { cardId } = req.params;
  try {
    const local = await db.cards.findByCardId(cardId);
    if (!local) { res.status(404).json({ error: "Carte introuvable" }); return; }
    if (local.user_id !== userId) { res.status(403).json({ error: "Accès refusé" }); return; }

    const alreadyTerminated = local.status === "terminated";

    // ── ✅ v69 — RANBOUSMAN BALANS KAT LA (mwens $0.50 frè fèmti) ──
    // Anvan nou tèmine kat la, nou reprann lajan ki rete sou li epi nou
    // remèt li nan pòtfèy la. Nou pran yon frè fiks $0.50 ladan l (frè
    // fèmti), jan sa fèt sou pifò platfòm kat vityèl.
    //
    // Règ pridan yo:
    //   • Si balans lan ≤ frè a → nou pa ranbouse anyen (pa gen balans
    //     negatif; nou pa fè moun nan dwe lajan pou fèmen yon kat).
    //   • Nou li balans lan sou MAPLERAD (sous verite a), pa lokalman.
    //   • Yon echèk isit la PA anpeche siprimasyon an — nou log li.
    let refundedCents = 0;
    let feeCents = 0;
    if (!alreadyTerminated) {
      try {
        const realId = await resolveMapleradCardId(cardId);
        const remote: any = await MapleradCardService.getCard(realId).catch(() => null);
        const balCents = Math.max(0, Math.round(Number(remote?.data?.balance ?? 0)));
        if (balCents > CARD_CLOSURE_FEE_CENTS) {
          feeCents = CARD_CLOSURE_FEE_CENTS;
          refundedCents = balCents - feeCents;
          await db.wallets.credit(userId, refundedCents, "USD");
          // ✅ v70 — ANRJISTRE nan istorik tranzaksyon (ledger) pou moun
          // nan wè aksyon sa a nan detay tranzaksyon yo. San sa, balans
          // lan monte $X.XX MEN pa gen okenn tranzaksyon ki eksplike sa
          // — konfizyon total. Nou kreye yon SÈL antre `card_closure`
          // ki gen ansanm balans lan (gross) ak frè a (fee) — konsa
          // detay tranzaksyon montre "$X.XX ranbouse - $0.50 frè fèmti".
          const last4 = (local as any).last4 || "????";
          await db.ledger.insert({
            userId, cardId,
            type: "card_closure",
            status: "completed",
            direction: "credit",
            grossCents: balCents,      // balans total ki te sou kat la
            feeCents: feeCents,        // $0.50 frè fèmti
            netCents: refundedCents,   // sa moun nan resevwa vre
            description: `Fermeture carte •••• ${last4} — remboursement du solde`,
            paymentMethod: "card_closure",
            feeLabel: `Frais de fermeture: $${(feeCents / 100).toFixed(2)}`,
          }).catch((e) => logger.warn("Ledger insert (card_closure) echwe", { error: e.message }));

          logger.info("Balans kat ranbouse nan pòtfèy (mwens frè fèmti)", {
            userId, cardId, balCents, feeCents, refundedCents,
          });
          void NotificationService.system(userId,
            "Solde de carte remboursé",
            `$${(refundedCents / 100).toFixed(2)} USD remboursés sur votre portefeuille (frais de fermeture $${(feeCents / 100).toFixed(2)} déduits).`
          ).catch(() => null);
        } else if (balCents > 0) {
          // Balans twò piti pou kouvri frè a — nou pa kreye yon dèt.
          logger.info("Balans kat twò piti pou ranbousman apre frè", { userId, cardId, balCents });
        }
      } catch (refundErr: any) {
        logger.warn("Ranbousman balans kat echwe — siprimasyon kontinye", {
          userId, cardId, error: refundErr.message,
        });
      }
    }

    if (!alreadyTerminated) {
      // ✅ FIX KRITIK: "Supprimer cette carte" te SÈLMAN JELE (freeze) kat la
      // sou Maplerad — yon aksyon REVERSIB — pandan li te kache l pou tout tan
      // lokalman e make l "blocked" (pa "terminated"). Sa vle di yon kat
      // itilizatè a "siprime" te ka toujou DEGELE e itilize ankò sou kote
      // Maplerad, menm si li disparèt nan app la — yon twou sekirite reyèl.
      // "Supprimer" dwe TÈMINE kat la pou tout tan (PUT .../terminate,
      // konfime: https://maplerad.dev/reference/freeze-a-card-1), menm jan
      // ak "Cancel" nan tout platfòm kat vityèl (irevèsib, kont "Freeze" ki
      // se yon poz tanporè).
      try {
        const realId = await resolveMapleradCardId(cardId);
        await MapleradCardService.terminateCard(realId);
        logger.info("Kat tèmine pou tout tan anvan siprime (delete)", { userId, cardId, realId });
      } catch (termErr: any) {
        // Si Maplerad pa rekonèt kat la ankò (deja terminate/echwe sou kote
        // yo), nou pa dwe bloke kliyan an ki jis vle netwaye lis li — nou
        // kontinye ak siprimasyon lokal la kanmenm, men nou log erè a.
        logger.warn("Echèk tèminezon anvan siprime — kontinye siprimasyon lokal kanmenm", {
          userId, cardId, error: termErr.message,
        });
      }
    }

    await db.cards.upsert({
      cardid: cardId, userId,
      // ✅ FIX: "terminated" kounye a, pa "blocked" — reflete VRÈ aksyon an
      // (pèmanan), e anpeche `resolveMapleradCardId`/lòt wout panse kat la
      // ka toujou jele/dégele apre sa.
      status: "terminated",
      hidden: true,
    });

    logger.info("Kat siprime nan app kliyan an", { userId, cardId, alreadyTerminated });
    res.json({
      success: true,
      message: refundedCents > 0
        ? `Carte supprimée. $${(refundedCents / 100).toFixed(2)} reversés sur votre portefeuille (frais de $${(feeCents / 100).toFixed(2)}).`
        : "Carte supprimée de votre application.",
      refundedCents, feeCents,
    });
  } catch (e: any) {
    logger.error("Erreur siprime kat", { userId, cardId, error: e.message });
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/maplerad/cards/:cardId/transactions
 */
router.get("/cards/:cardId/transactions", requireAuth, async (req: Request, res: Response) => {
  try {
    const realId = await resolveMapleradCardId(req.params.cardId);
    const result = await MapleradCardService.getCardTransactions(realId);
    // ✅ DYAGNOSTIK: menm rezon ak "getCard — repons brit" — konfime VRÈ fòm
    // (non chan yo) done tranzaksyon Maplerad voye, pou "Transactions récentes"
    // sou paj Cartes la afiche yo byen (montan, machann, dat, kredi/debi).
    logger.info("Maplerad getCardTransactions — repons brit", {
      cardId: realId,
      count: Array.isArray(result.data) ? result.data.length : 0,
      sample: Array.isArray(result.data) ? result.data.slice(0, 3) : result.data,
    });
    res.json({ success: true, data: result.data });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// DEPOSIT (Collections) — Pay-in
// ============================================================

/**
 * POST /api/maplerad/deposit/virtual-account
 * Crée un compte virtuel pour dépôt (NGN → wallet business)
 * Le frontend affiche le numéro de compte au client
 */
// ============================================================
// PAY-IN — Dépôt (rute principal)
// ============================================================

/**
 * POST /api/maplerad/deposit/payin
 * Route principale pour TOUS les dépôts Maplerad
 * - NGN Bank Transfer  → Compte virtuel Maplerad (bank account)
 * - Mobile Money (GHS/KES/XAF/XOF/UGX/TZS) → Instructions de dépôt
 */
router.post("/deposit/payin", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  try {
    const {
      currency = "NGN",
      channel_id,
      operator,
      amount,           // Montant en USD (frontend)
      phone,            // Numéro téléphone kliyan (pou MoMo STK push)
      bank_code: overrideBankCode,  // Override si connu
    } = req.body;

    const currencyUpper = currency.toString().toUpperCase();

    // Deviz sipòte pou MoMo automatik via Maplerad collections/momo
    const MOMO_CURRENCIES = ["XAF", "KES", "NGN_MOMO", "XOF", "TZX", "TZS", "UGX"];
    const isMoMo = MOMO_CURRENCIES.includes(currencyUpper) ||
      (channel_id && channel_id !== "ngn_bank" && currencyUpper !== "NGN");

    const user = await db.users.findById(userId);
    if (!user) { res.status(404).json({ error: "Utilisateur introuvable" }); return; }

    // Auto-créer client Maplerad si manquant
    let customerId = (user as any).mapleradCustomerId;
    if (!customerId) {
      try {
        const r0 = await MapleradCustomerService.createCustomer({
          first_name: user.firstname,
          last_name:  user.lastname,
          email:      user.email,
          country:    toCountryCode((user as any).kycNationality || user.country),
        });
        customerId = r0.data.id;
        await db.users.update(userId, { mapleradCustomerId: customerId } as any).catch(() => null);
      } catch (err: any) {
        if (err.message?.includes("already")) {
          customerId = await MapleradCustomerService.findCustomerByEmail(user.email);
          if (customerId) await db.users.update(userId, { mapleradCustomerId: customerId } as any).catch(() => null);
        }
      }
    }

    if (isMoMo) {
      // ── MoMo Pay-in: STK push otomatik sou telefòn kliyan ─
      if (!phone) {
        res.status(400).json({
          error: "Numéro de téléphone requis pour les dépôts Mobile Money",
          code:  "PHONE_REQUIRED",
        });
        return;
      }
      if (!amount || parseFloat(amount) <= 0) {
        res.status(400).json({ error: "Montant requis", code: "AMOUNT_REQUIRED" });
        return;
      }

      // ── Règles Maplerad docs: amount en LOWEST DENOMINATION ─
      // ⚠️ Maplerad testé:
      // KES → shillings ENTIERS (×1), PAS en senti (×100)
      // NGN → naira ENTIERS (×1), PAS en kobo (×100)
      // XAF, XOF, UGX, TZX → toujours entiers (×1)
      const RATES: Record<string, number> = {
        XAF: 620, KES: 130, XOF: 620, UGX: 3700, TZX: 2600, TZS: 2600, NGN: 1600,
      };
      // Tout deviz Maplerad en unités entières (pas de subunit)
      const SUBUNIT: Record<string, number> = {
        NGN: 1, KES: 1, XAF: 1, XOF: 1, UGX: 1, TZX: 1, TZS: 1,
      };
      // Limites Maplerad par devise (en unité locale)
      const MAPLERAD_MAX: Record<string, number> = {
        KES: 2000,     // ~$15 USD par transaction
        XAF: 2000000,  // ~$3,200 USD
        XOF: 2000000,
        UGX: 5000000,
        TZX: 5000000,
        NGN: 1000000,
        TZS: 5000000,
      };

      const rate        = RATES[currencyUpper] || 1;
      const subunit     = SUBUNIT[currencyUpper] || 1;
      const amtUSD      = parseFloat(amount);
      const amtLocal    = Math.round(amtUSD * rate);
      const amtMaplerad = Math.round(amtLocal * subunit);
      const amtUSDCents = Math.round(amtUSD * 100);

      // ✅ Valider limite Maplerad anvan rele API
      const maxLocal = MAPLERAD_MAX[currencyUpper];
      if (maxLocal && amtMaplerad > maxLocal) {
        const maxUSD = maxLocal / rate;
        res.status(400).json({
          error: `Montant maximum pour ${currencyUpper} via ce canal: ${maxLocal.toLocaleString("fr-FR")} ${currencyUpper} (≈$${maxUSD.toFixed(2)} USD). Effectuez plusieurs transactions ou utilisez un autre canal.`,
          code:  "AMOUNT_EXCEEDS_LIMIT",
          maxLocal,
          maxUSD,
        });
        return;
      }

      // ── bank_code: TOUJOU soti de GET /institutions?type=MOMOCOLLECTION ─
      // ⚠️ MOMOCOLLECTION codes != MOMO (payout) codes!
      // Règle Maplerad: toujou fetch le bon code depuis l'API
      const momoCountryMap: Record<string, string> = {
        XAF: "CM", KES: "KE", XOF: "CI", UGX: "UG",
        TZX: "TZ", TZS: "TZ", NGN: "NG",
      };
      // Pour XOF Bénin, on utilise BJ (même XOF que CI mais pays différent)
      const momoCountry = req.body.countryCode || momoCountryMap[currencyUpper] || "NG";

      let bankCode = overrideBankCode;
      if (!bankCode) {
        try {
          const institutions = await MapleradCollectionService.getInstitutions(
            momoCountry, "MOMOCOLLECTION"
          );
          const list = institutions.data || [];
          // Chercher par nom d'opérateur (ex: "MTN", "MPESA", "ORANGE")
          const match = list.find((i: any) => {
            const iName = (i.name || "").toUpperCase();
            const op    = (operator || "").toUpperCase();
            return iName.includes(op) ||
              (op === "MPESA"   && iName.includes("MPESA")) ||
              (op === "AIRTEL"  && (iName.includes("AIRTEL") || iName.includes("TIGO"))) ||
              (op === "ORANGE"  && iName.includes("ORANGE")) ||
              (op === "MOOV"    && iName.includes("MOOV"))   ||
              (op === "CELTIS"  && iName.includes("CELTIS")) ||
              (op === "HALO"    && iName.includes("HALO"));
          });
          bankCode = match?.code;
          logger.info("Institution MOMOCOLLECTION trouvée", {
            country: momoCountry, operator, bankCode, available: list.map((i: any) => i.name),
          });
        } catch (instErr: any) {
          logger.warn("Erreur fetch institutions MOMOCOLLECTION", { error: instErr.message });
        }
      }

      if (!bankCode) {
        res.status(400).json({
          error: `Code institution ${operator || channel_id} introuvable pour ${momoCountry}. Vérifiez que l'opérateur est supporté.`,
          code:  "BANK_CODE_MISSING",
          hint:  `GET /institutions?type=MOMOCOLLECTION&country=${momoCountry}`,
        });
        return;
      }

      // ── account_number: sans "+" (règle Maplerad) ───────────
      // Maplerad format: "23572826364" (pas "+23572826364")
      const phoneClean = phone.replace(/\s+/g, "").replace(/^\+/, "");

      const ref = `FREDA-${userId.slice(0, 8)}-${Date.now().toString(36).toUpperCase()}`;

      // ── Appel collections/momo ───────────────────────────────
      const result = await MapleradCollectionService.createMomoCollection({
        account_number: phoneClean,
        amount:         amtMaplerad,
        bank_code:      bankCode,
        currency:       (currencyUpper === "TZS" ? "TZX" : currencyUpper) as any,
        description:    `Dépôt Freda Pay — ${user.FredaTag || userId.slice(0, 8)}`,
        reference:      ref,
        meta: {
          // ✅ REQUIS selon docs Maplerad — informations du kliyan ki paie
          counterparty: {
            first_name:   user.firstname || "Freda",
            last_name:    user.lastname  || "User",
            email:        user.email,
            phone_number: phoneClean,
          },
        },
      });

      await db.ledger.insert({
        userId, type: "vba_deposit", status: "pending", direction: "credit",
        grossCents: amtUSDCents, feeCents: 0, netCents: amtUSDCents,
        description: `Dépôt MoMo ${currencyUpper} en attente ($${amtUSD} USD = ${amtLocal.toLocaleString()} ${currencyUpper})`,
        paymentMethod: channel_id || currencyUpper,
        externalRef:  ref,
      }).catch(() => null);

      logger.info("MoMo collection initiée", {
        userId, ref, currency: currencyUpper,
        amtUSD, amtLocal, amtMaplerad, bankCode,
        requires_otp: result.data.requires_otp,
      });

      res.json({
        success: true,
        type:    "momo_pending",
        data: {
          reference:     ref,
          id:            result.data.id,
          status:        result.data.status,
          currency:      currencyUpper,
          amount:        amtUSD,
          requires_otp:  result.data.requires_otp,
          // Si OTP requis → instructions spécifiques à l'opérateur
          otp_instruction: result.data.requires_otp ? result.data.otp_instruction : undefined,
          message: result.data.requires_otp
            ? `Entrez le code OTP (${result.data.otp_instruction?.length || 4} chiffres) reçu sur votre téléphone pour confirmer le dépôt.`
            : `Un STK push a été envoyé au +${phoneClean}. Entrez votre PIN pour confirmer le dépôt de ${amtLocal.toLocaleString()} ${currencyUpper} ($${amtUSD} USD).`,
        },
      });
      // ✅ FIX: te gen yon 2yèm ledger.insert() + res.json() doubon isit la (menm kòd la de fwa).
      // Sa te kreye 2 antre "pending" pou menm depo a, epi 2yèm res.json() la te jete yon erè
      // "headers already sent" (Express pa kite w voye 2 repons pou menm requête). Retire l.

    } else {
      // ── NGN Bank Transfer: Compte virtuel Maplerad ─────────
      if (!customerId) {
        res.status(400).json({
          error: "Profil de paiement requis. Complétez votre KYC.",
          code:  "CUSTOMER_REQUIRED",
        });
        return;
      }
      const result = await MapleradCollectionService.createVirtualAccount(customerId, "NGN");
      logger.info("Compte virtuel NGN créé", { userId, accountId: result.data.id });
      res.json({
        success: true,
        type:    "virtual_account",
        data: {
          id:             result.data.id,
          bank_name:      result.data.bank_name,
          account_number: result.data.account_number,
          account_name:   result.data.account_name,
          currency:       "NGN",
          instructions:   "Effectuez un virement bancaire vers ce compte. Les fonds seront crédités automatiquement sous 1-2h.",
        },
      });
    }
  } catch (e: any) {
    const msg   = e.message || "Erreur inconnue";
    const lower = msg.toLowerCase();
    // Log detaye pou debogaj
    logger.error("Erreur deposit payin", {
      error:     msg,
      stack:     e.stack?.split("\n")[1]?.trim(),
      userId,
      body:      JSON.stringify(req.body).slice(0, 200),
    });
    // Errè Maplerad → 400, pa 500
    if (lower.includes("maplerad [4")) {
      res.status(400).json({ error: "Transaction refusée. Vérifiez les informations et réessayez.", code: "MAPLERAD_ERROR" });
    } else if (lower.includes("bank_code") || lower.includes("institution")) {
      res.status(400).json({ error: "Opérateur temporairement indisponible. Choisissez un autre moyen de paiement.", code: "BANK_CODE_MISSING" });
    } else if (lower.includes("phone") || lower.includes("account_number")) {
      res.status(400).json({ error: "Numéro de téléphone invalide. Vérifiez le format.", code: "PHONE_INVALID" });
    } else {
      res.status(500).json({ error: "Une erreur s'est produite. Réessayez dans quelques instants." });
    }
  }
});

/**
 * POST /api/maplerad/deposit/usd-account
 * Demande un compte USD ACH/Fedwire (async — documents KYC requis)
 */
router.post("/deposit/usd-account", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  try {
    const user = await db.users.findById(userId);
    if (!user) { res.status(404).json({ error: "Utilisateur introuvable" }); return; }

    const customerId = (user as any).mapleradCustomerId;
    if (!customerId) {
      res.status(400).json({ error: "Complétez votre KYC pour activer les dépôts.", code: "CUSTOMER_REQUIRED" });
      return;
    }

    const {
      identificationNumber, employmentStatus, employmentDescription,
      employerName, occupation, usResidencyStatus,
      identificationImageFront, identificationImageBack,
      sourceOfFunds, proofOfAddress, identificationType,
    } = req.body;

    const result = await MapleradCollectionService.createUSDAccount({
      customer_id: customerId,
      meta: {
        identification_number:  identificationNumber,
        employment_status:      employmentStatus || "SELF_EMPLOYED",
        employment_description: employmentDescription || "Financial Services",
        nationality:            toCountryCode((user as any).kycNationality || (user as any).country),
        employer_name:          employerName || "Freda Pay",
        occupation:             occupation || "Entrepreneur",
        us_residency_status:    usResidencyStatus || "NON_RESIDENT_ALIEN",
        documents: {
          identification_country:     toCountryCode((user as any).kycNationality || (user as any).country),
          identification_image_front: identificationImageFront,
          identification_image_back:  identificationImageBack,
          identification_type:        identificationType || "PASSPORT",
          ...(sourceOfFunds   ? { source_of_funds:  sourceOfFunds }  : {}),
          ...(proofOfAddress  ? { proof_of_address: proofOfAddress } : {}),
        },
      },
    });

    await db.users.update(userId, { usdAccountRef: result.data.reference } as any).catch(() => null);

    logger.info("Demande compte USD Maplerad créée", { userId, ref: result.data.reference });
    res.json({
      success: true,
      data: {
        reference: result.data.reference,
        status:    result.data.status,
        currency:  "USD",
        kyc_link:  result.data.kyc_link,
        message:   "Votre demande de compte USD est en cours de traitement. Vous serez notifié sous 24-48h.",
      },
    });
  } catch (e: any) {
    logger.error("Erreur création compte USD", { error: e.message });
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/maplerad/deposit/usd-account/:reference/status
 */
router.get("/deposit/usd-account/:reference/status", requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await MapleradCollectionService.checkUSDAccountStatus(req.params.reference);
    res.json({ success: true, data: result.data });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// PAYOUT (Transfers) — Retrait
// ============================================================

/**
 * POST /api/maplerad/payout/local
 * Retrait vers compte bancaire local (NGN) ou Mobile Money Afrique
 */
router.post("/payout/local", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  try {
    const {
      channel_id,
      amount,
      account_number,
      account_name,
      bank_code,       // ✅ Override direct (ex: code NGN choisi par user)
      currency,
      reason,
      reference: clientRef,
    } = req.body;

    const channel = channel_id ? getChannelById(channel_id) : null;
    // ✅ Priorité: bank_code body > channel config
    const finalCurrency = (channel?.currency  || currency  || "NGN").toUpperCase();
    const finalBankCode = bank_code || channel?.bank_code || bank_code;
    const finalScheme    = channel?.scheme;

    if (!finalBankCode)     { res.status(400).json({ error: "bank_code ou channel_id requis" }); return; }
    if (!account_number)    { res.status(400).json({ error: "account_number requis" });           return; }
    if (!amount)            { res.status(400).json({ error: "amount requis" });                   return; }

    const amountInt  = Math.round(parseFloat(amount));
    const amountUSD  = amountInt / 100;
    const feeCents   = await FeeService.calcWithdrawFee(Math.round(amountUSD * 100), finalCurrency);
    const totalCents = Math.round(amountUSD * 100) + feeCents;

    const user   = await db.users.findById(userId);
    const wallet = await db.wallets.findByUserId(userId);
    if (!user)   { res.status(404).json({ error: "Utilisateur introuvable" }); return; }
    if (!wallet || wallet.availableBalance < totalCents) {
      res.status(402).json({
        error:     `Solde insuffisant. ${fmt(totalCents)} requis.`,
        required:  totalCents,
        available: wallet?.availableBalance || 0,
      });
      return;
    }

    // Valider limites du canal
    if (channel) {
      if (amountInt < channel.minAmount) {
        res.status(400).json({ error: `Montant minimum: ${channel.minAmount} ${channel.currency}` }); return;
      }
      if (amountInt > channel.maxAmount) {
        res.status(400).json({ error: `Montant maximum: ${channel.maxAmount} ${channel.currency}` }); return;
      }
    }

    const txRef = clientRef || `FP-POUT-${Date.now().toString(36).toUpperCase()}`;
    await db.wallets.debit(userId, totalCents);
    await db.ledger.insert({
      userId, type: "withdrawal", status: "processing", direction: "debit",
      grossCents: Math.round(amountUSD * 100), feeCents, netCents: Math.round(amountUSD * 100),
      description: reason || `Retrait ${channel?.name || finalCurrency}`,
      paymentMethod: channel_id || finalCurrency,
      externalRef: txRef,
    }).catch(() => null);

    // Construire body Maplerad selon schème
    const isMoMo = finalScheme === "MOBILEMONEY" ||
      ["GHS", "KES", "XAF", "XOF", "UGX", "TZS"].includes(finalCurrency);

    const result = await MapleradTransferService.transferLocal({
      bank_code:      finalBankCode,
      account_number: account_number.replace(/\s+/g, ""),
      amount:         amountInt,
      currency:       finalCurrency as any,
      reason:         reason || `Retrait Freda Pay via ${channel?.name || finalCurrency}`,
      reference:      txRef,
      ...(isMoMo ? {
        meta: {
          scheme:       "MOBILEMONEY",
          counterparty: { name: account_name || user.firstname + " " + user.lastname },
        },
      } : {}),
    });

    logger.info("Retrait local Maplerad initié", {
      userId, txRef, currency: finalCurrency, channel: channel_id,
    });

    res.json({
      success: true,
      data: {
        reference: txRef,
        id:        result.data.id,
        status:    result.data.status,
        amount:    amountUSD,
        fee:       feeCents / 100,
        channel:   channel?.name || finalCurrency,
        message:   "Retrait en cours de traitement.",
      },
    });
  } catch (e: any) {
    try {
      const amtCents = Math.round(parseFloat(req.body?.amount || "0") / 100 * 100);
      const fee      = await FeeService.calcWithdrawFee(amtCents, "");
      if (amtCents > 0) await db.wallets.credit(userId, amtCents + fee);
    } catch {}
    logger.error("Erreur retrait local Maplerad", { error: e.message });
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/maplerad/payout/usd
 * Retrait USD via ACH / Fedwire (vers counterparty enregistré)
 */
router.post("/payout/usd", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  try {
    const { amount_usd, counterparty_id, payment_rail, memo, reason } = req.body;

    if (!amount_usd || !counterparty_id) {
      res.status(400).json({ error: "amount_usd et counterparty_id sont requis" });
      return;
    }

    const amountCents = Math.round(parseFloat(amount_usd) * 100);
    const feeCents    = await FeeService.calcWithdrawFee(amountCents, "usd_wire");
    const totalCents  = amountCents + feeCents;

    const wallet = await db.wallets.findByUserId(userId);
    if (!wallet || wallet.availableBalance < totalCents) {
      res.status(402).json({
        error: `Solde insuffisant. ${fmt(totalCents)} requis.`,
        required: totalCents, available: wallet?.availableBalance || 0,
      });
      return;
    }

    const txRef = ref("USD");
    await db.wallets.debit(userId, totalCents);
    await db.ledger.insert({
      userId, type: "withdrawal", status: "processing", direction: "debit",
      grossCents: amountCents, feeCents, netCents: amountCents,
      description: memo || `Virement USD ACH/Wire`,
      externalRef: txRef,
    }).catch(() => null);

    const result = await MapleradTransferService.transferUSD({
      counterparty_id,
      memo:         memo || "Retrait Freda Pay",
      amount:       amountCents,
      payment_rail: (payment_rail as any) || "ACH",
      reason:       reason || "Personal transfer",
      reference:    txRef,
    });

    logger.info("Retrait USD Maplerad initié", { userId, txRef, amountCents });
    res.json({
      success: true,
      data: {
        reference: txRef,
        id:        result.data.id,
        status:    result.data.status,
        amount:    parseFloat(amount_usd),
        fee:       feeCents / 100,
        message:   "Virement USD en traitement (1-3 jours ouvrés).",
      },
    });
  } catch (e: any) {
    try {
      const amtCents = Math.round(parseFloat(req.body?.amount_usd || "0") * 100);
      const fee      = await FeeService.calcWithdrawFee(amtCents, "usd_wire");
      if (amtCents > 0) await db.wallets.credit(userId, amtCents + fee);
    } catch {}
    logger.error("Erreur retrait USD Maplerad", { error: e.message });
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/maplerad/payout/counterparty
 * Enregistre un destinataire USD
 */
router.post("/payout/counterparty", requireAuth, async (req: Request, res: Response) => {
  try {
    const { account_id, account_number, account_name, bank_code, bank_name } = req.body;
    if (!account_id || !account_number || !bank_code) {
      res.status(400).json({ error: "account_id, account_number et bank_code sont requis" });
      return;
    }
    const result = await MapleradTransferService.createCounterparty({
      account_id, account_number, account_name, bank_code, bank_name, currency: "USD",
    });
    res.json({ success: true, data: result.data });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// WALLETS MAPLERAD — Soldes internes
// ============================================================

/**
 * POST /api/maplerad/deposit/verify-otp
 * Vérifie le code OTP pour les collections MoMo qui le requièrent (ex: Orange XOF)
 * Docs: https://maplerad.dev/reference/verify-otp
 * Body: { transaction_id, otp, reference }
 */
router.post("/deposit/verify-otp", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  try {
    const { transaction_id, otp, reference } = req.body;
    if (!transaction_id || !otp) {
      res.status(400).json({ error: "transaction_id et otp sont requis" });
      return;
    }

    const result = await MapleradCollectionService.verifyMomoOtp(transaction_id, otp);

    logger.info("OTP MoMo vérifié", { userId, transaction_id, status: result.data.status });
    res.json({
      success: true,
      data: {
        id:        result.data.id,
        status:    result.data.status,
        reference: result.data.reference || reference,
        message:   result.data.status === "PENDING"
          ? "OTP accepté. Votre dépôt est en cours de traitement."
          : "Dépôt confirmé !",
      },
    });
  } catch (e: any) {
    logger.error("Erreur verify OTP MoMo", { userId, error: e.message });
    res.status(400).json({ error: e.message || "OTP invalide. Réessayez." });
  }
});

/**
 * GET /api/maplerad/institutions?country=CM&type=MOMOCOLLECTION
 * Retourne codes institutions pour MoMo collection ou payout
 */
router.get("/institutions", async (req: Request, res: Response) => {
  try {
    const { country = "NG", type = "MOMOCOLLECTION" } = req.query as Record<string, string>;
    const result = await MapleradCollectionService.getInstitutions(country, type as any);
    res.json({ success: true, data: result.data });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
router.get("/balance", requireAuth, async (_req: Request, res: Response) => {
  try {
    const result = await MapleradWalletService.getWallets();
    res.json({ success: true, data: result.data });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
