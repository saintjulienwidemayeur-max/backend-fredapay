// ============================================================
// DemoMode — kont demo pou revizè App Store / Play Store
// ============================================================
// POUKISA:
//   Apple (App Review Guideline 2.1) ak Google mande yon kont demo
//   konplètman fonksyonèl pou yo teste app la. Men nou PA KA bay yo yon
//   kont ki fè vrè tranzaksyon: sa ta deplase vrè lajan, kreye vrè kat,
//   epi frape vrè API patnè yo (Maplerad, Pay'm, Didit).
//
// KIJAN SA MACHE:
//   Nou pa touche okenn lojik biznis. Nou entèsepte YON SÈL kote pou chak
//   patnè — fonksyon HTTP la — epi nou retounen yon repons SIMILE ki gen
//   MENM FÒM ak repons reyèl la. Konsa:
//     • Tout lojik la (frè, ledger, notifikasyon, limit) kouri NÒMALMAN
//     • Revizè a wè yon app 100% fonksyonèl
//     • ZEWO apèl rezo soti vè Maplerad / Pay'm / Didit
//     • ZEWO vrè lajan deplase
//
// KIJAN NOU KONNEN SE YON KONT DEMO:
//   1. Kolòn `is_demo` nan tab `users` (migration 034)
//   2. Oswa varyab anviwònman `DEMO_ACCOUNT_EMAILS` (lis separe pa vigil)
//   Nou gen tou de pou n ka aktive/dezaktive san yon deplwaman DB.
//
// ⚠️ SEKIRITE: yon kont demo PA KA JANM vin yon kont reyèl. Drapo a li
//   sèlman — okenn wout API pa modifye l. Pou kreye/efase yon kont demo,
//   se sèlman via SQL (migration 034).
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { logger } from "../utils/logger";

interface DemoStore { demo: boolean; userId?: string }

const storage = new AsyncLocalStorage<DemoStore>();

/** Imèl kont demo yo, an plis kolòn `is_demo` a. */
export function demoEmails(): string[] {
  return (process.env.DEMO_ACCOUNT_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isDemoEmail(email?: string | null): boolean {
  if (!email) return false;
  return demoEmails().includes(email.toLowerCase());
}

/** Mete kontèks demo a pou tout dire yon rekèt. */
export function runWithDemoContext<T>(demo: boolean, userId: string | undefined, fn: () => T): T {
  return storage.run({ demo, userId }, fn);
}

/** `true` si rekèt aktyèl la soti nan yon kont demo. */
export function isDemoRequest(): boolean {
  return storage.getStore()?.demo === true;
}

// ── Ti zouti pou fabrike done similye ──────────────────────────
const ref = (p: string) => `${p}_demo_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
const luhn = (base15: string) => {
  let sum = 0;
  for (let i = 0; i < base15.length; i++) {
    let d = Number(base15[base15.length - 1 - i]);
    if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return `${base15}${(10 - (sum % 10)) % 10}`;
};
/** Nimewo kat demo VALID Luhn men nan plaj test 4000 00.. (pa yon vrè BIN). */
const demoPan = () => luhn("400000" + String(Date.now()).slice(-9));

function demoCard(id?: string) {
  const cardId = id || ref("card");
  const pan = demoPan();
  const exp = new Date(Date.now() + 3 * 365 * 24 * 3600 * 1000);
  return {
    id: cardId,
    card_number: pan,
    masked_pan: `**** **** **** ${pan.slice(-4)}`,
    last4: pan.slice(-4),
    cvv: String(100 + (Number(pan.slice(-3)) % 900)),
    expiry_month: String(exp.getMonth() + 1).padStart(2, "0"),
    expiry_year: String(exp.getFullYear()),
    status: "ACTIVE",
    type: "VIRTUAL",
    brand: "VISA",
    currency: "USD",
    balance: 0,
    name: "FREDA DEMO",
    issuer: "Freda Pay (DEMO)",
  };
}

/**
 * Simile yon repons Maplerad. Fòm nan swiv dokimantasyon an:
 * `{ status, message, data }`.
 */
export function simulateMaplerad(method: string, path: string, body?: Record<string, unknown>): any {
  const ok = (data: any, message = "Demo mode — aucune requête réelle envoyée") =>
    ({ status: true, message, data });

  // ── ISSUING (kat vityèl) ─────────────────────────────────────
  if (path === "/issuing" && method === "GET") return ok([demoCard()]);
  if (path === "/issuing" && method === "POST") return ok({ reference: ref("issue") });
  const issuingMatch = path.match(/^\/issuing\/([^/]+)(\/.*)?$/);
  if (issuingMatch) {
    const [, cardId, sub] = issuingMatch;
    if (sub === "/transactions") return ok([]);
    if (sub === "/fund" || sub === "/withdraw") return ok({ reference: ref("txn") });
    if (sub === "/freeze" || sub === "/unfreeze") return ok({ id: cardId });
    if (method === "PUT") return ok({ id: cardId, status: "TERMINATED" });
    return ok(demoCard(cardId));
  }

  // ── CUSTOMERS ────────────────────────────────────────────────
  if (path === "/customers" && method === "GET") return ok([]);
  if (path.startsWith("/customers")) {
    if (path.endsWith("/accounts")) return ok([]);
    return ok({ id: ref("cus"), status: "APPROVED", tier: 2 });
  }

  // ── TRANSFERS ────────────────────────────────────────────────
  if (path.startsWith("/transfers")) {
    return ok({ id: ref("trf"), reference: ref("trf"), status: "SUCCESS" });
  }

  // ── COLLECTIONS / VIRTUAL ACCOUNTS ───────────────────────────
  if (path.includes("virtual-account")) {
    return ok({ id: ref("va"), status: "ACTIVE", account_number: "0000000000", bank_name: "DEMO BANK" });
  }

  // ── WALLETS ──────────────────────────────────────────────────
  if (path === "/wallets") return ok([{ id: ref("wal"), currency: "USD", balance: 1_000_000 }]);
  if (path.startsWith("/wallets") || path.startsWith("/test/wallet")) return ok({ reference: ref("fund") });

  logger.warn("Demo mode — chemen Maplerad ki pa simile eksplisitman", { method, path });
  return ok({});
}

/** Simile yon repons Pay'm (MonCash / NatCash / KashPaw). */
export function simulatePaym(method: string, endpoint: string, body?: any): any {
  const now = new Date();
  const txnId = String(Date.now()) + String(Math.floor(Math.random() * 1000));

  if (endpoint === "api/paiement-marchand") {
    return {
      status: true,
      message: "success",
      // ⚠️ Pa gen redireksyon reyèl — app la dwe detekte mòd demo a epi
      // konfime touswit (wè `paym.ts`, gad demo a).
      url: `https://demo.fredapay.local/paiement/${txnId}`,
      transaction_id: txnId,
    };
  }
  if (endpoint === "api/paiement-verify") {
    return {
      status: true, message: "success",
      montant: Number(body?.montant) || 0,
      trans_status: "ok",              // ✅ toujou konfime an demo
      id_transaction: txnId,
      date: now.toISOString().slice(0, 10),
      heure: now.toISOString().slice(11, 19),
      method: "moncash", id_client: null,
    };
  }
  if (endpoint === "api/auth/marchand") {
    return { success: true, message: "Demo", token: ref("tok"), marchand: { client_id: "pp_demo" }, expires_in: 300 };
  }
  if (endpoint === "api/auth/marchand/withdrawal-token") {
    return {
      success: true, message: "Demo", withdrawal_token: ref("wtok"),
      authorized_for: { amount: body?.amount, method: body?.method, recipient: body?.recipient, reference: body?.reference },
      expires_in: 120,
    };
  }
  if (endpoint === "api/withdraw/marchand") {
    return {
      success: true, message: "Retrait demo effectué",
      data: {
        transaction_id: ref("wd"), api_reference: txnId,
        amount: body?.amount, fee: 0, total: body?.amount,
        recipient: body?.recipient, reference: body?.reference,
        balance_before: 0, balance_after: 0, status: "success",
      },
    };
  }
  if (endpoint === "api/withdraw/marchand/verify") {
    return {
      success: true, message: "Demo",
      data: { reference: body?.reference, status: "success", amount: 0, method: "moncash" },
    };
  }

  logger.warn("Demo mode — chemen Pay'm ki pa simile eksplisitman", { method, endpoint });
  return { status: true, success: true, message: "Demo" };
}

/** Simile yon repons Didit (KYC) — toujou apwouve. */
export function simulateDidit(method: string, path: string): any {
  if (path.includes("/session")) {
    return {
      session_id: ref("kyc"),
      session_token: ref("tok"),
      url: "https://demo.fredapay.local/kyc",
      status: "Approved",
    };
  }
  return { status: "Approved", decision: { status: "Approved" } };
}
