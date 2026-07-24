// ============================================================
// Pay'm Service — Freda Pay
// Depo (deposit) ak Retrè (withdrawal) via MonCash / NatCash / Kashpaw
// Docs: https://plopplop.solutionip.app/paiement-doc
// API v1.3
// ============================================================

import crypto  from "crypto";
import { logger } from "../utils/logger";
import { isDemoRequest, simulatePaym } from "./demoMode.service";

const BASE_URL     = "https://plopplop.solutionip.app";
const CLIENT_ID    = process.env.PAYM_CLIENT_ID     || "pp_8fb5dfd47355608cf078a62083fb";
const CLIENT_SECRET = process.env.PAYM_CLIENT_SECRET || "13e820ad1eeb188a97d94ec91c6baef394f0c2ecb028038b189620b1efc2106d";

// Taux de change HTG → USD (configurable via env)
export const HTG_TO_USD = parseFloat(process.env.HTG_RATE || "135");

// Méthodes disponibles
export type PaymMethod = "moncash" | "natcash" | "kashpaw";

// ── Fetch générique ───────────────────────────────────────────
async function paymFetch<T>(
  method: "GET" | "POST" | "DELETE",
  endpoint: string,
  body?: object,
  bearerToken?: string,
  retryCount = 0
): Promise<T> {
  // ✅ v66 — KONT DEMO: zewo apèl rezo, repons simile.
  if (isDemoRequest()) {
    logger.info("Pay'm court-circuité (compte démo)", { method, endpoint });
    return simulatePaym(method, endpoint, body) as T;
  }

  const url = `${BASE_URL}/${endpoint}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (bearerToken) headers["Authorization"] = `Bearer ${bearerToken}`;

  logger.debug(`Pay'm ${method} /${endpoint}`);

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  // 429 — attendre et réessayer (max 2 fois)
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("Retry-After") || "3", 10);
    if (retryCount < 2) {
      logger.warn(`Pay'm 429 — retry dans ${retryAfter}s (tentative ${retryCount + 1}/2)`, { endpoint });
      await new Promise(r => setTimeout(r, retryAfter * 1000));
      return paymFetch<T>(method, endpoint, body, bearerToken, retryCount + 1);
    }
    throw new Error("Service temporairement indisponible (limite de requêtes). Réessayez dans quelques secondes.");
  }

  const raw = await res.text();
  let data: any;
  try { data = JSON.parse(raw); }
  catch {
    logger.error("Pay'm réponse non-JSON", { status: res.status, preview: raw.slice(0, 200) });
    throw new Error(`Service de paiement indisponible (${res.status}). Réessayez.`);
  }

  if (!res.ok) {
    const msg = data?.message || data?.error || `HTTP ${res.status}`;
    logger.error(`Pay'm erreur ${res.status}`, { endpoint, msg });
    throw new Error(msg);
  }

  return data as T;
}

// ── Générer une référence unique ──────────────────────────────
export function genPaymRef(prefix = "FP"): string {
  const ts    = Date.now().toString(36).toUpperCase();
  const rand  = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `${prefix}-${ts}-${rand}`;
}

// ── Signer un payload HMAC-SHA256 (retrait) ───────────────────
function hmacSign(amount: number, method: string, recipient: string, reference: string, timestamp: number): string {
  const payload = [amount, method, recipient, reference, timestamp].join("|");
  return crypto.createHmac("sha256", CLIENT_SECRET).update(payload).digest("hex");
}

// ============================================================
// 💳 DEPO (Paiement entrant)
// ============================================================
export const PaymDepositService = {

  /**
   * Kreye yon tranzaksyon depo via Pay'm
   * Retounen URL pou redireksyon kliyan an
   */
  async createDeposit(params: {
    amountHTG:     number;          // Montan en HTG (>= 20)
    method:        PaymMethod | "all";
    referenceId?:  string;           // Opsyonèl — jenere otomatikman
  }): Promise<{ url: string; transactionId: string; referenceId: string }> {

    if (params.amountHTG < 20) throw new Error("Montant minimum: 20 HTG");

    const referenceId = params.referenceId || genPaymRef("DEP");

    const body = {
      client_id:      CLIENT_ID,
      refference_id:  referenceId,          // double f — se konsa API a ekri li
      montant:        Math.round(params.amountHTG),
      payment_method: params.method,
    };

    logger.info("Pay'm dépôt init", { referenceId, amountHTG: params.amountHTG, method: params.method });

    const data = await paymFetch<{
      status: boolean; message: string; url: string; transaction_id: string;
    }>("POST", "api/paiement-marchand", body);

    if (!data.status || !data.url) throw new Error(data.message || "URL de paiement manquante. Réessayez.");

    return {
      url:           data.url,
      transactionId: data.transaction_id,
      referenceId,
    };
  },

  /**
   * Vérifye estati yon tranzaksyon
   * trans_status: "no" = an attente | "ok" = konfime
   */
  async verifyDeposit(referenceId: string): Promise<{
    confirmed:     boolean;
    amountHTG:     number;
    amountUSD:     number;
    transactionId: string;
    method:        string;
    date:          string;
    heure:         string;
  }> {
    const data = await paymFetch<{
      status: boolean; message: string;
      montant: number; trans_status: string;
      id_transaction: string; date: string; heure: string; method: string;
    }>("POST", "api/paiement-verify", {
      client_id:     CLIENT_ID,
      refference_id: referenceId,
    });

    const confirmed = data.trans_status === "ok";
    const amountHTG = data.montant || 0;
    const amountUSD = parseFloat((amountHTG / HTG_TO_USD).toFixed(2));

    logger.info("Pay'm vérif dépôt", { referenceId, confirmed, amountHTG, amountUSD });

    return {
      confirmed,
      amountHTG,
      amountUSD,
      transactionId: data.id_transaction,
      method:        data.method,
      date:          data.date,
      heure:         data.heure,
    };
  },
};

// ============================================================
// 🏧 RETRÈ (Withdrawal — 3 etap)
// ============================================================
export const PaymWithdrawService = {

  /**
   * Etap 1 — Otantifikasyon → marchand_token (valide ~5 min)
   */
  async authenticate(): Promise<string> {
    const data = await paymFetch<{
      success: boolean; message: string;
      token?: string; marchand_token?: string; access_token?: string;
    }>("POST", "api/auth/marchand", {
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
    });

    // Pay'm peut retourner le token dans différents champs
    const token = data.token || data.marchand_token || data.access_token;
    if (!data.success || !token) {
      logger.error("Pay'm auth: token manquant dans réponse", { data });
      throw new Error(data.message || "Authentification au service de paiement échouée.");
    }
    logger.info("Pay'm auth OK", { tokenLength: token.length });
    return token;
  },

  /**
   * Etap 2 — Jenere withdrawal_token (lye ak montan + destinatè)
   */
  async generateWithdrawalToken(params: {
    marchandToken: string;
    amountHTG:     number;
    method:        "moncash" | "natcash";
    recipient:     string;      // 509XXXXXXXX
    reference:     string;
  }): Promise<string> {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = hmacSign(
      params.amountHTG,
      params.method,
      params.recipient,
      params.reference,
      timestamp
    );

    logger.debug("Pay'm withdrawal-token request", {
      amount: params.amountHTG, method: params.method,
      recipient: params.recipient, reference: params.reference,
    });

    const data = await paymFetch<{
      success: boolean; message: string; withdrawal_token: string;
    }>("POST", "api/auth/marchand/withdrawal-token", {
      amount:               params.amountHTG,
      method:               params.method,
      recipient:            params.recipient,
      reference:            params.reference,
      timestamp,
      withdrawal_signature: signature,
    }, params.marchandToken);

    if (!data.success || !data.withdrawal_token) throw new Error(data.message || "Token de retrait non généré");
    return data.withdrawal_token;
  },

  /**
   * Etap 3 — Ekzekite retrè
   */
  async executeWithdrawal(params: {
    withdrawalToken: string;
    amountHTG:       number;
    method:          "moncash" | "natcash";
    recipient:       string;
    reference:       string;
  }): Promise<{
    transactionId: string;
    apiReference:  string;
    amountHTG:     number;
    fee:           number;
    total:         number;
    balanceBefore: number;
    balanceAfter:  number;
  }> {
    const data = await paymFetch<{
      success: boolean; message: string;
      data: {
        transaction_id: string; api_reference: string;
        amount: number; fee: number; total: number;
        recipient: string; reference: string;
        balance_before: number; balance_after: number;
        status: "success" | "failed";
      };
    }>("POST", "api/withdraw/marchand", {
      amount:    params.amountHTG,
      method:    params.method,
      recipient: params.recipient,
      reference: params.reference,
    }, params.withdrawalToken);

    if (!data.success || data.data?.status === "failed") {
      throw new Error(data.message || "Le retrait a échoué. Réessayez ou contactez le support.");
    }

    logger.info("Pay'm retrait succès", {
      txId:      data.data.transaction_id,
      amountHTG: data.data.amount,
      fee:       data.data.fee,
      recipient: data.data.recipient,
    });

    return {
      transactionId: data.data.transaction_id,
      apiReference:  data.data.api_reference,
      amountHTG:     data.data.amount,
      fee:           data.data.fee,
      total:         data.data.total,
      balanceBefore: data.data.balance_before,
      balanceAfter:  data.data.balance_after,
    };
  },

  /**
   * Fonksyon konplè — fè 3 etap yo ansanm
   */
  async withdraw(params: {
    amountHTG: number;
    method:    "moncash" | "natcash";
    recipient: string;
    reference?: string;
  }) {
    const reference = params.reference || genPaymRef("WD");

    // Etap 1: Auth
    const marchandToken = await this.authenticate();

    // Etap 2: Gen token
    const withdrawalToken = await this.generateWithdrawalToken({
      marchandToken,
      amountHTG:  params.amountHTG,
      method:     params.method,
      recipient:  params.recipient,
      reference,
    });

    // Etap 3: Execute
    const result = await this.executeWithdrawal({
      withdrawalToken,
      amountHTG:  params.amountHTG,
      method:     params.method,
      recipient:  params.recipient,
      reference,
    });

    return { ...result, reference };
  },

  // ── VERIFIKASYON RETRÈ (Pay'm v1.5) ─────────────────────────
  /**
   * ✅ AJOUTE v66 — `POST api/withdraw/marchand/verify`
   *
   * Andwa sa a te MANKE nan entegrasyon an. Dokimantasyon an (v1.5) di
   * yon retrè ka rete nan estati `pending` — san andwa sa a nou pa t gen
   * OKENN fason pou nou konnen si li fini oswa si li echwe apre sa.
   * Rezilta: lajan an ta bloke nan ledger la san rezolisyon.
   *
   * ⚠️ PA konfonn ak `api/paiement-verify` ki sèvi SÈLMAN pou depo.
   * Sa a mande jeton MARCHAND lan (etap 1), pa jeton retrè a (etap 2).
   */
  async verifyWithdrawal(reference: string): Promise<{
    status:        "pending" | "failed" | "success" | "remboursé";
    transactionId: string | null;
    amountHTG:     number;
    method:        string | null;
    recipient:     string | null;
    updatedAt:     string | null;
  }> {
    // Etap 1 — jeton marchand (li dire ~1 minit, donk nou pran youn fre)
    const token = await PaymWithdrawService.authenticate();

    const data = await paymFetch<{
      success: boolean; message: string;
      data: {
        transaction_id: string; reference: string;
        status: "pending" | "failed" | "success" | "remboursé";
        amount: number; method: string; recipient: string;
        created_at: string; updated_at: string;
        provider?: Record<string, unknown>;
      };
    }>("POST", "api/withdraw/marchand/verify", { reference }, token);

    if (!data.success) throw new Error(data.message || "Vérification retrait échouée");

    logger.info("Pay'm retrait vérifié", { reference, status: data.data?.status });

    return {
      status:        data.data?.status ?? "pending",
      transactionId: data.data?.transaction_id ?? null,
      amountHTG:     data.data?.amount ?? 0,
      method:        data.data?.method ?? null,
      recipient:     data.data?.recipient ?? null,
      updatedAt:     data.data?.updated_at ?? null,
    };
  },
};

export default { deposit: PaymDepositService, withdraw: PaymWithdrawService, genRef: genPaymRef, HTG_TO_USD };
