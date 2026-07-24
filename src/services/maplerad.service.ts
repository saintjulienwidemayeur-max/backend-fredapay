// ============================================================
// Maplerad Service — Freda Pay LLC
// Docs: https://maplerad.dev/docs/intro
// Cards, Collections (Pay-in), Transfers (Payout), USD Accounts
// ============================================================

import { logger } from "../utils/logger";
import { isDemoRequest, simulateMaplerad } from "./demoMode.service";

const BASE    = "https://api.maplerad.com/v1";
const BASE_V2 = "https://api.maplerad.com/v2";

// Kle Maplerad — soti .env (prod) ou sandbox pou test
const SANDBOX_SK = "mpr_sandbox_sk_7f369ff5-7eee-41f3-9b20-ced5ecf59a9c";
const SANDBOX_PK = "mpr_sandbox_pk_375f1c03f876d77a7cc03d620c83fab5";

const getKey = () =>
  process.env.MAPLERAD_SECRET_KEY || SANDBOX_SK;

const getPublicKey = () =>
  process.env.MAPLERAD_PUBLIC_KEY || SANDBOX_PK;

export const isMapleradSandbox = () => getKey().startsWith("mpr_sandbox_");

const headers = () => ({
  "Content-Type":  "application/json",
  "Authorization": `Bearer ${getKey()}`,
});

// ── HTTP helper ───────────────────────────────────────────────
async function mpr<T = any>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: Record<string, unknown>,
  v2 = false
): Promise<T> {
  const url = `${v2 ? BASE_V2 : BASE}${path}`;

  // ✅ v66 — KONT DEMO: zewo apèl rezo, repons simile ki gen menm fòm.
  if (isDemoRequest()) {
    logger.info("Maplerad court-circuité (compte démo)", { method, path });
    return simulateMaplerad(method, path, body) as T;
  }

  let res: Response;
  try {
    res = await (fetch as any)(url, {
      method,
      headers: headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (netErr: any) {
    throw new Error(`Maplerad réseau injoignable: ${netErr.message}`);
  }

  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = { message: text }; }

  if (!res.ok) {
    const msg = data?.message || data?.error || data?.data?.message || `HTTP ${res.status}`;

    // Diagnostic clair par code HTTP
    if (res.status === 401) {
      logger.error("Maplerad 401 — Clé API invalide ou compte non activé", {
        url, key_prefix: getKey().slice(0, 12) + "...",
        hint: "Vérifiez: (1) Clé correctement copiée depuis app.maplerad.com → Settings → API Keys, (2) KYB approuvé sur le dashboard, (3) Compte email vérifié",
      });
      throw new Error("Maplerad accès refusé (401). Vérifiez votre clé API sur app.maplerad.com → Settings → API Keys");
    }
    if (res.status === 403) {
      throw new Error("Maplerad accès interdit (403). IP non autorisée ou permissions insuffisantes.");
    }
    if (res.status === 422) {
      const details = JSON.stringify(data?.data || data?.errors || {});
      throw new Error(`Maplerad validation (422): ${msg} — ${details}`);
    }
    if (res.status === 404) {
      throw new Error(`Maplerad ressource introuvable (404): ${url}`);
    }

    throw new Error(`Maplerad [${res.status}]: ${msg}`);
  }
  return data;
}

// ============================================================
// CUSTOMERS — Cardholder
// Enroll = crée + upgrade Tier 2 en un seul appel
// ============================================================
export const MapleradCustomerService = {

  /**
   * POST /customers
   * Créer un client Tier 0 (juste nom/email/pays — aucun document requis)
   * ✅ Appelé automatiquement à l'inscription
   */
  async createCustomer(data: {
    first_name: string;
    last_name:  string;
    email:      string;
    country:    string;  // ISO alpha-2 ex: "HT"
  }) {
    return mpr<{ status: boolean; message: string; data: { id: string; status: string; tier: number } }>(
      "POST", "/customers", data as any
    );
  },

  /**
   * GET /customers
   * Lister tous les clients (filtrer par email pour retrouver un client existant)
   */
  async getAllCustomers(): Promise<{ status: boolean; data: any[] }> {
    return mpr<{ status: boolean; data: any[] }>("GET", "/customers");
  },

  /**
   * Trouver un client par email (utile quand "already enrolled")
   */
  async findCustomerByEmail(email: string): Promise<string | null> {
    try {
      const res = await MapleradCustomerService.getAllCustomers();
      const list = Array.isArray(res.data) ? res.data : [];
      const found = list.find((c: any) =>
        c.email?.toLowerCase() === email.toLowerCase()
      );
      return found?.id || null;
    } catch {
      return null;
    }
  },

  /**
   * POST /customers/enroll
   * Enroll complet Tier 2 — accès Issuing
   */
  async enrollCustomer(data: {
    first_name: string;
    last_name:  string;
    email:      string;
    country:    string;           // ISO alpha-2 ex: "HT"
    identification_number: string; // ID national, passeport, etc.
    dob:        string;           // format "DD-MM-YYYY"
    phone: {
      phone_country_code: string; // "+509"
      phone_number:       string; // "34567890"
    };
    address: {
      street:      string;
      city:        string;
      state:       string;
      country:     string;
      postal_code: string;
    };
    identity?: {
      type:    "NIN" | "PASSPORT" | "VOTERS_CARD" | "DRIVERS_LICENSE";
      image:   string;   // URL vers document uploadé
      number:  string;
      country: string;
    };
    photo?: string;      // URL selfie
  }) {
    return mpr<{ status: boolean; message: string; data: { id: string; status: string; tier: number } }>(
      "POST", "/customers/enroll", data as any
    );
  },

  /**
   * PATCH /customers/upgrade/tier1
   * Upgrade kliyan pou aksede Collections + Issuing
   */
  async upgradeTier1(data: {
    customer_id:           string;
    dob:                   string;  // "DD-MM-YYYY"
    identification_number: string;
    phone: { phone_country_code: string; phone_number: string };
    address: { street: string; city: string; state: string; country: string; postal_code: string };
    photo?: string;
  }) {
    return mpr<{ status: boolean; message: string; data: any }>(
      "PATCH", "/customers/upgrade/tier1", data as any
    );
  },

  /**
   * PATCH /customers/upgrade/tier2
   * Upgrade kliyan ak dokiman ID (requis pou Issuing complet)
   */
  async upgradeTier2(data: {
    customer_id: string;
    identity: { type: string; image: string; number: string; country: string };
    photo?: string;
  }) {
    return mpr<{ status: boolean; message: string; data: any }>(
      "PATCH", "/customers/upgrade/tier2", data as any
    );
  },

  /**
   * GET /customers/{id}
   */
  async getCustomer(customerId: string) {
    return mpr<{ status: boolean; data: any }>("GET", `/customers/${customerId}`);
  },

  /**
   * GET /customers/:id/accounts
   */
  async getCustomerAccounts(customerId: string) {
    return mpr<{ status: boolean; data: any[] }>("GET", `/customers/${customerId}/accounts`);
  },
};

// ============================================================
// CARD ISSUING — Virtual USD Cards
// ============================================================
export const MapleradCardService = {

  /**
   * POST /issuing
   * Crée une carte virtuelle USD (async — webhook confirme)
   * Retourne un `reference` pour tracking
   */
  async createCard(data: {
    customer_id:    string;
    currency:       "USD";
    type:           "VIRTUAL";
    auto_approve:   true;
    brand?:         "VISA" | "MASTERCARD";
    amount?:        number;  // cents — montant initial
    is_contactless?: boolean;
  }) {
    return mpr<{ status: boolean; message: string; data: { reference: string } }>(
      "POST", "/issuing", data as any
    );
  },

  /**
   * GET /issuing
   * ✅ FIX kòmantè: sa a se PA yon "business cards"-only endpoint — li
   * retounen TOUT kat ki sou kont Maplerad ou a (kat kliyan KREYE VIA
   * POST /issuing AK customer_id, konfime nou itilize sa 100% kòrèkteman).
   * Sa DIFERAN de POST /issuing/business (Create a Business Card — chan
   * `name`, PA `customer_id` — nou pa janm rele l, konfime pa rechèch
   * egzoustif nan tout backend la).
   */
  async getCards() {
    return mpr<{ status: boolean; data: MapleradCard[] }>("GET", "/issuing");
  },

  /**
   * GET /issuing/:cardId
   */
  async getCard(cardId: string) {
    return mpr<{ status: boolean; data: MapleradCard }>("GET", `/issuing/${cardId}`);
  },

  /**
   * POST /issuing/:cardId/fund
   * ✅ FIX: chemen an te "/funding" (envalid) — dokiman ofisyèl Maplerad
   * (https://maplerad.dev/reference/fund-a-card) konfime se "/fund".
   */
  async fundCard(cardId: string, amountCents: number) {
    return mpr<{ status: boolean; message: string }>(
      "POST", `/issuing/${cardId}/fund`, { amount: amountCents }
    );
  },

  /**
   * POST /issuing/:cardId/withdrawal
   * Retirer des fonds d'une carte vers le wallet
   */
  async withdrawFromCard(cardId: string, amountCents: number) {
    return mpr<{ status: boolean; message: string }>(
      "POST", `/issuing/${cardId}/withdrawal`, { amount: amountCents }
    );
  },

  /**
   * PATCH /issuing/:cardId/freeze
   * Geler yon kat — SANS l pèmanan.
   * ✅ FIX KRITIK: ansyen kòd la te itilize `PUT /issuing/{id}/terminate` —
   * yon paj dokiman DIFERAN (freeze-a-card-1) te dekri sa kòm yon fason pou
   * "jele" yon kat, men se yon MALANTANDI: "Terminate" se yon aksyon PÈMANAN
   * (webhook `issuing.terminated` konfime sa — "désactivée définitivement").
   * Dokiman OFISYÈL korèk la (https://maplerad.dev/reference/freeze-a-card,
   * bay pa kliyan an) montre yon andpwen SEPARE, SANS rapò ak Terminate:
   *   PATCH https://api.maplerad.com/v1/issuing/{id}/freeze
   * "This resource allows a card created on Maplerad to be frozen. When a
   * card is frozen no transaction (funding/withdrawal) will be allowed."
   * — sa a se VRÈ jèl REVERSIB la, sa ki t ap koze erè 405 sou "/unfreeze"
   * la (mòd HTTP la, PUT olye PATCH, ki te mal — pa chemen an).
   */
  async freezeCard(cardId: string) {
    return mpr<{ status: boolean; message: string }>("PATCH", `/issuing/${cardId}/freeze`);
  },

  /**
   * PATCH /issuing/:cardId/unfreeze
   * Dégeler yon kat.
   * ✅ FIX KRITIK: erè 405 ("Method Not Allowed") ansyen kòd la te resevwa a
   * se te YON ENDIS FÒ chemen an ("/unfreeze") te DEJA korèk — 405 vle di
   * REsous la egziste men MÒD HTTP la (nou te voye PUT) pa t bon. Kounye a
   * nou itilize PATCH, menm konvansyon ak "Freeze a Card" (konfime ofisyèl).
   */
  async unfreezeCard(cardId: string) {
    return mpr<{ status: boolean; message: string }>("PATCH", `/issuing/${cardId}/unfreeze`);
  },

  /**
   * PUT /issuing/:cardId/terminate
   * Aksyon PÈMANAN — pa konfonn ak freezeCard() (ki reversib).
   * ✅ FIX: ansyen kòd la te fè `terminateCard()` yon ALIAS pou `freezeCard()`,
   * baze sou yon move konklizyon (paj dokiman "freeze-a-card-1" te sanble
   * dekri "Terminate" kòm sèl mwayen pou jele yon kat). Dokiman OFISYÈL
   * "Freeze a Card" (san sifiks) konfime yo se DE aksyon SEPARE:
   *   - `PATCH .../freeze` (freezeCard) — REVERSIB, `PATCH .../unfreeze` anile l
   *   - `PUT .../terminate` (fonksyon sa a) — PÈMANAN (webhook `issuing.terminated`
   *     konfime: "désactivée définitivement", kat la pa ka janm reaktive)
   * Fonksyon sa a poko itilize okenn kote nan app la (pa gen fonksyonalite
   * "anile kat pou tout tan" ki separe de "Geler" ak "Supprimer" kounye a) —
   * li disponib pou lè app la ta bezwen sa kòm yon vrè aksyon final.
   */
  async terminateCard(cardId: string) {
    return mpr<{ status: boolean; message: string }>("PUT", `/issuing/${cardId}/terminate`);
  },

  /**
   * GET /issuing/:cardId/transactions
   */
  async getCardTransactions(cardId: string) {
    return mpr<{ status: boolean; data: any[] }>("GET", `/issuing/${cardId}/transactions`);
  },
};

// ============================================================
// COLLECTIONS — Pay-in (Dépôt via compte virtuel ou MoMo)
// ============================================================
export const MapleradCollectionService = {

  /**
   * POST /collections/momo/verify-otp
   * Vérifie l'OTP pour les collections MoMo qui le requièrent
   * Docs: https://maplerad.dev/reference/verify-otp
   */
  async verifyMomoOtp(transactionId: string, otp: string) {
    return mpr<{
      status:  boolean;
      message: string;
      data: {
        id:         string;
        status:     "PENDING" | "SUCCESS" | "FAILED";
        currency:   string;
        amount:     number;
        fee:        number;
        reference:  string;
        created_at: string;
        updated_at: string;
      };
    }>("POST", "/collections/momo/verify-otp", {
      transaction_id: transactionId,
      otp,
    });
  },

  /**
   * POST /collections/momo
   * MoMo Pay-in AUTOMATIQUE — STK push ou OTP
   */
  async createMomoCollection(data: {
    account_number: string;
    amount:         number;
    bank_code:      string;
    currency:       "XAF" | "KES" | "NGN" | "XOF" | "TZX" | "UGX";
    description:    string;
    reference:      string;
    meta: {
      counterparty: {   // ⚠️ REQUIS selon docs Maplerad
        first_name:   string;
        last_name:    string;
        email:        string;
        phone_number: string;  // Sans "+", avec indicatif pays
      };
    };
  }) {
    return mpr<{
      status:  boolean;
      message: string;
      data: {
        id:           string;
        reference:    string;
        status:       "PENDING" | "SUCCESS" | "FAILED";
        currency:     string;
        amount:       number;
        fee:          number;
        requires_otp: boolean;
        otp_instruction?: {
          details: string;
          length:  number;
        };
      };
    }>("POST", "/collections/momo", data as any);
  },

  /**
   * POST /collections/virtual-account
   * Compte virtuel NGN — Bank Transfer (NGN sèlman)
   * Docs: https://maplerad.dev/reference/create-a-virtual-account
   */
  async createVirtualAccount(customerId: string, currency: "NGN" = "NGN", preferredBank?: string) {
    return mpr<{
      status: boolean;
      data: {
        id:             string;
        bank_name:      string;
        account_number: string;
        account_name:   string;
        currency:       string;
        created_at:     string;
      };
    }>("POST", "/collections/virtual-account", {
      customer_id:   customerId,
      currency,
      ...(preferredBank ? { preferred_bank: preferredBank } : {}),
    });
  },

  /**
   * GET /institutions?type=MOMOCOLLECTION&country=XX
   * ✅ Retourne codes MoMo pour collections (différent de MOMO pour payout)
   * Types: NUBAN, MOMO, MOMOCOLLECTION, VIRTUAL, BOG, CBK
   * Docs: https://maplerad.dev/reference/get-all-institutions
   */
  async getInstitutions(country: string, type: "MOMOCOLLECTION" | "MOMO" | "NUBAN" | "VIRTUAL" | "BOG" | "CBK" = "MOMOCOLLECTION") {
    return mpr<{
      status: boolean;
      data:   { code: string; name: string; type: string; country: string }[];
    }>("GET", `/institutions?country=${country}&type=${type}`);
  },

  /**
   * GET /collections/virtual-account/:id
   */
  async getVirtualAccount(accountId: string) {
    return mpr<{ status: boolean; data: any }>("GET", `/collections/virtual-account/${accountId}`);
  },

  /**
   * GET /collections/virtual-account/usd/:reference/status
   */
  async checkUSDAccountStatus(reference: string) {
    return mpr<{ status: boolean; data: { status: string; reference: string } }>(
      "GET", `/collections/virtual-account/usd/${reference}/status`
    );
  },

  /**
   * POST /collections/virtual-account/usd
   * Compte USD ACH/Fedwire
   */
  async createUSDAccount(data: {
    customer_id: string;
    meta: {
      identification_number:  string;
      employment_status:      "EMPLOYED" | "SELF_EMPLOYED" | "UNEMPLOYED" | "STUDENT" | "RETIRED";
      employment_description: string;
      nationality:            string;
      employer_name:          string;
      occupation:             string;
      us_residency_status:    "NON_RESIDENT_ALIEN" | "RESIDENT_ALIEN" | "US_CITIZEN";
      documents?: {
        identification_country:     string;
        identification_image_front: string;
        identification_image_back?: string;
        source_of_funds?: { file_name: "PAYSLIP" | "BANK_STATEMENT"; file: string };
        proof_of_address?: { file_name: string; file: string };
        identification_type?: "PASSPORT" | "NIN" | "DRIVERS_LICENSE";
      };
    };
  }) {
    return mpr<{
      status:  boolean;
      message: string;
      data: { reference: string; status: string; currency: "USD"; kyc_link?: string };
    }>("POST", "/collections/virtual-account/usd", data as any);
  },
};

// ============================================================
// TRANSFERS — Payout (Retrait)
// ============================================================
export const MapleradTransferService = {

  /**
   * POST /transfers
   * Virement local (NGN, MoMo Africa)
   */
  async transferLocal(data: {
    bank_code:      string;
    account_number: string;
    amount:         number;   // en kobo/centimes selon devise
    currency:       "NGN" | "XAF" | "KES" | "XOF" | "GHS";
    reason?:        string;
    reference?:     string;
    meta?: {
      scheme?: "MOBILEMONEY";
      counterparty?: { name: string };
    };
  }) {
    return mpr<MapleradTransferResponse>("POST", "/transfers", data as any);
  },

  /**
   * POST /v2/transfers/usd   (API v2!)
   * Virement USD via ACH ou Fedwire vers un counterparty enregistré
   */
  async transferUSD(data: {
    counterparty_id: string;     // ID enregistré sur Maplerad
    memo:            string;
    amount:          number;     // en cents
    payment_rail:    "ACH" | "ACH-ACCELERATED" | "FEDWIRE";
    reason:          string;
    reference:       string;
  }) {
    return mpr<MapleradTransferResponse>("POST", "/transfers/usd", data as any, true /* v2 */);
  },

  /**
   * POST /counterparties
   * Enregistrer un destinataire USD avant paiement
   */
  async createCounterparty(data: {
    account_id:     string;      // ID du compte USD source
    account_number: string;
    account_name:   string;
    bank_code:      string;      // ABA routing number ou SWIFT
    bank_name:      string;
    currency:       "USD";
    meta?: Record<string, string>;
  }) {
    return mpr<{ status: boolean; data: { id: string } }>(
      "POST", "/counterparties", data as any
    );
  },
};

// ============================================================
// BANKS — Listes banques et telcos par devise
// ============================================================
export const MapleradBankService = {
  /**
   * GET /banks?currency=NGN&type=bank
   * Récupère la liste des banques ou telcos supportés
   * type: "bank" | "mobilemoney"
   */
  async getBanks(currency: string, type: "bank" | "mobilemoney" = "bank") {
    return mpr<{
      status: boolean;
      data: { code: string; name: string; type: string; currency: string }[];
    }>("GET", `/banks?currency=${currency}&type=${type}`);
  },
};

// ============================================================
// WALLETS — Soldes Maplerad business
// ============================================================
export const MapleradWalletService = {

  /**
   * GET /wallets
   * Récupère les wallets (SPEND + TREASURY par devise)
   */
  async getWallets() {
    return mpr<{ status: boolean; data: MapleradWallet[] }>("GET", "/wallets");
  },

  /**
   * POST /test/wallet/credit
   * SANDBOX SÈLMAN — kredite wallet tès la ak lajan fiktif.
   * Docs: https://maplerad.dev/reference/credit-test-wallet
   */
  async creditTestWallet(amount: number, currency = "USD") {
    return mpr<{ status: boolean; message?: string; data?: any }>("POST", "/test/wallet/credit", { amount, currency });
  },

  /**
   * POST /wallets/fund
   * Déplace des fonds entre wallets SPEND ↔ TREASURY
   */
  async fundWallet(data: {
    currency:                 string;
    source_wallet_type:       "SPEND" | "TREASURY";
    destination_wallet_type:  "SPEND" | "TREASURY";
    amount:                   number;
  }) {
    return mpr<{ status: boolean }>("POST", "/wallets/fund", data as any);
  },
};

// ============================================================
// TYPES
// ============================================================
export interface MapleradCard {
  id:          string;
  name:        string;              // Nom titulaire
  masked_pan:  string;              // "536898******1914"
  type:        "VIRTUAL";
  issuer:      "VISA" | "MASTERCARD";
  currency:    "USD";
  status:      "ACTIVE" | "DISABLED" | "TERMINATED";
  balance:     number;              // en cents
  auto_approve: boolean;
  created_at:  string;
}

export interface MapleradTransferResponse {
  status:  boolean;
  message: string;
  data: {
    id:         string;
    currency:   string;
    status:     "PENDING" | "SUCCESS" | "FAILED" | "PROCESSING";
    entry:      "DEBIT";
    type:       "TRANSFER";
    amount:     number;
    summary?:   string;
    reason?:    string;
    fee:        number;
    reference?: string;
    created_at: string;
    updated_at: string;
  };
}

export interface MapleradWallet {
  id:          string;
  currency:    string;
  type:        "SPEND" | "TREASURY";
  balance:     number;
  created_at:  string;
}
