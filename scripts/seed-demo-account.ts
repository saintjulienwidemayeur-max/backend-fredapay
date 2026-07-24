// ============================================================
// seed-demo-account — kreye/mete-ajou kont demo revizè yo
// ============================================================
// ITILIZASYON:
//   1. Fè migration 034 la pase anvan (kolòn `is_demo`)
//   2. npx tsx scripts/seed-demo-account.ts
//
// Script la IDEMPOTAN — ou ka relanse l otan fwa ou vle. Li:
//   • kreye (oswa mete ajou) kont demo a
//   • mete `is_demo = TRUE`
//   • apwouve KYC + verifye imèl (revizè a pa ka fè yon vrè KYC)
//   • ranpli wallet la ak lajan DEMO
//
// POUKISA YON SCRIPT E PA YON MIGRATION SQL:
//   Yon hash bcrypt modpas PA DWE chita nan git. Script la jenere l
//   lokalman lè w lanse l, epi li antre dirèkteman nan DB a.
//
// ⚠️ Chanje `DEMO_PASSWORD` la anvan ou soumèt app la, epi voye vrè
//    valè a bay Apple/Google nan fòm "App Review Information" an.
import "dotenv/config";
import bcrypt from "bcryptjs";
import { createClient } from "@supabase/supabase-js";

const DEMO_EMAIL    = process.env.DEMO_EMAIL    || "demo.review@fredapay.com";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || "FredaDemo2026!";  // ← sa a se sa w bay Apple/Google
const DEMO_TAG      = process.env.DEMO_TAG      || "demoreview";
/** Balans demo an santim (100_000 = $1,000.00). */
const DEMO_BALANCE_CENTS = Number(process.env.DEMO_BALANCE_CENTS || 100_000);

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error("❌ SUPABASE_URL / SUPABASE_SECRET_KEY manke nan .env");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  // ── 1. Kont lan ────────────────────────────────────────────
  const { data: existing } = await sb
    .from("users").select("id").eq("email", DEMO_EMAIL).maybeSingle();

  const profile = {
    email:          DEMO_EMAIL,
    password_hash:  passwordHash,
    firstname:      "Demo",
    lastname:       "Reviewer",
    phone:          "50900000000",
    dial_code:      "+509",
    country:        "HT",
    city:           "Port-au-Prince",
    date_of_birth:  "1995-01-01",
    genre:          "Autre",
    freda_tag:      DEMO_TAG,
    role:           "user",
    status:         "active",
    // Revizè a pa ka fè yon vrè KYC (li pa gen dokiman nou yo) —
    // donk nou apwouve l davans pou li ka teste TOUT app la.
    kyc_status:     "approved",
    email_verified: true,
    phone_verified: true,
    is_demo:        true,
    updated_at:     new Date().toISOString(),
  };

  let userId: string;
  if (existing?.id) {
    userId = existing.id;
    const { error } = await sb.from("users").update(profile).eq("id", userId);
    if (error) throw error;
    console.log("♻️  Kont demo a mete ajou");
  } else {
    const { data, error } = await sb.from("users").insert(profile).select("id").single();
    if (error) throw error;
    userId = data.id;
    console.log("✅ Kont demo a kreye");
  }

  // ── 2. Wallet la ───────────────────────────────────────────
  const { data: wallet } = await sb
    .from("wallets").select("id").eq("user_id", userId).eq("currency", "USD").maybeSingle();

  const walletRow = {
    user_id: userId, currency: "USD",
    balance: DEMO_BALANCE_CENTS,
    available_balance: DEMO_BALANCE_CENTS,
    pending_balance: 0, is_active: true,
    updated_at: new Date().toISOString(),
  };

  if (wallet?.id) {
    const { error } = await sb.from("wallets").update(walletRow).eq("id", wallet.id);
    if (error) throw error;
  } else {
    const { error } = await sb.from("wallets").insert(walletRow);
    if (error) throw error;
  }

  console.log("\n────────────────────────────────────────────");
  console.log("  KONT DEMO — pou App Store / Play Store");
  console.log("────────────────────────────────────────────");
  console.log(`  Imèl    : ${DEMO_EMAIL}`);
  console.log(`  Modpas  : ${DEMO_PASSWORD}`);
  console.log(`  FredaTag: @${DEMO_TAG}`);
  console.log(`  Balans  : $${(DEMO_BALANCE_CENTS / 100).toFixed(2)} (DEMO)`);
  console.log("────────────────────────────────────────────");
  console.log("  ⚠️  Ajoute imèl sa a nan .env tou:");
  console.log(`      DEMO_ACCOUNT_EMAILS=${DEMO_EMAIL}`);
  console.log("────────────────────────────────────────────\n");
}

main().catch((e) => { console.error("❌", e.message || e); process.exit(1); });
