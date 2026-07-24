import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { globalLimit, authLimit, sensitiveLimit, perUserLimit, transferLimit, webhookLimit, resetRateLimits } from "./middleware/rateLimiter";
import { logger } from "./utils/logger";
import { testSupabaseConnection } from "./db/supabase";

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  if (msg.includes("WebSocket") || msg.includes("ws") || msg.includes("realtime")) return;
  console.error("[UnhandledRejection]", msg);
});
process.on("uncaughtException", (err) => {
  if (err.message?.includes("WebSocket") || err.message?.includes("realtime")) return;
  console.error("[UncaughtException]", err.message);
});

import webhookRoutes       from "./routes/webhooks";
import adminRoutes         from "./routes/admin";
import kycRoutes           from "./routes/kyc";
import authRoutes          from "./routes/auth";
import auth2faRoutes       from "./routes/auth2fa";
import walletRoutes        from "./routes/wallet";
import notifRoutes         from "./routes/notifications";
import userRoutes          from "./routes/users";
import mapleradRoutes      from "./routes/maplerad";
import fredaiRoutes        from "./routes/fredai";
import feesRoutes          from "./routes/fees";
import subscriptionRoutes  from "./routes/subscriptions";
import paymRoutes          from "./routes/paym";
import cronRoutes          from "./routes/cron";
import appStatusRoutes     from "./routes/appStatus";
import referralRoutes      from "./routes/referrals";

const app  = express();
// ✅ FIX: Render (ak pifò PaaS) sèvi ak yon reverse proxy — san sa,
// express-rate-limit ap voye yon ValidationError sou CHAK demand paske
// li wè header X-Forwarded-For san Express pa konfigire pou fè l konfyans.
app.set("trust proxy", 1);
const PORT = parseInt(process.env.PORT || "3001", 10);

app.use(helmet());
// ✅ NOUVO: pa t gen okenn konpresyon (gzip/brotli) sou repons API yo —
// chak repons JSON te voye "kri", san konprese. Konpresyon redwi gwosè
// repons yo anpil (souvan 60-80% pou JSON, ki konprese trè byen), sa ki
// enpòtan sitou pou itilizatè sou koneksyon mobil pi lan/pi chè. San
// danje pou webhook yo — konpresyon aji sou REPONS SÈLMAN, pa sou kò
// demand lan (`rawBody` pou siyati webhook rete entak pi ba a).
app.use(compression());
const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.FRONTEND_URL_2,
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
].filter(Boolean) as string[];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (origin.endsWith(".netlify.app")) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    const localNet = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/.test(origin);
    if (localNet) return callback(null, true);
    callback(new Error("CORS: origin pa otorizé — " + origin));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-admin-token"],
  credentials: true,
}));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 500,
  standardHeaders: true, legacyHeaders: false,
  message: { error: "Trop de requêtes — réessayez dans quelques minutes" },
  skip: (req) => req.method === "OPTIONS",
});
const webhookLimiter = rateLimit({ windowMs: 1 * 60 * 1000, max: 200, message: { error: "Rate limit webhook" } });

app.use(morgan("combined", { stream: { write: (msg) => logger.info(msg.trim()) } }));

// ✅ FIX KRITIK: ansyen kòd la te mete middleware "rawBody" (ki fè
// `req.on('data', ...)` manyèlman) APRE `express.json()` — men `express.json()`
// deja KONSOME tout stream lan pou l analize l an JSON. Yon fwa yon stream Node.js
// fini (`'end'` deja emèt), okenn NOUVO listener pa ka resevwa evènman `'data'`
// ankò — kidonk `req.rawBody` te toujou vid pou TOU 2 webhook yo (Maplerad AK
// Didit). Sa te kache pa 2 mekanis diferan:
//   - Maplerad: yon "filè" (`req.rawBody?.toString() || JSON.stringify(req.body)`)
//     ki rekonstwi yon JSON apati `req.body` deja analize a — mache pa "chans"
//     (Node prezève lòd kle yo souvan), men PA garanti bit-pou-bit.
//   - Didit: PA gen filè — verifikasyon siyati a SENPMAN SOTE an silans (twou
//     sekirite, byenke sa pa bloke trètman webhook la).
//
// ✅ SOLISYON ESTANDA: `express.json()` limenm ofri yon opsyon `verify` ki bay
// aksè a BIT BRIT yo (Buffer) AVAN analiz JSON — san n pa bezwen li stream la
// yon dezyèm fwa (ki ta ka BLOKE pou tout tan si n eseye l apre 'end' deja rive).
// Sa a se apwòch OFISYÈL Express dokimantasyon rekòmande pou webhook signature verification.
app.use(express.json({
  limit: "10mb",
  verify: (req: Request & { rawBody?: Buffer }, _res, buf) => { req.rawBody = Buffer.from(buf); },
}));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ✅ v53 — sèvi fichye statik depi /public/ (logo email, elt.)
// Rezon: (1) imèl bezwen yon URL fyab pou logo — Dropbox links yo souvan
// echwe nan proxy imaj Gmail sou Android. (2) Cache-Control pou 30 jou
// pou pi bon pèfòmans.
app.use("/public", express.static("public", {
  maxAge: "30d",
  etag: true,
  lastModified: true,
  setHeaders: (res) => {
    res.setHeader("Cache-Control", "public, max-age=2592000, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
  },
}));

// ── Routes ───────────────────────────────────────────────────
app.use("/api/webhooks",      webhookLimiter,  webhookRoutes);
app.use("/api/admin",                          adminRoutes);
app.use("/api/auth",          authLimit,       authRoutes);
app.use("/api/auth",                           auth2faRoutes);
app.use("/api/wallet",        apiLimiter,      walletRoutes);
app.use("/api/notifications", apiLimiter,      notifRoutes);
app.use("/api/users",         apiLimiter,      userRoutes);
app.use("/api/maplerad",      apiLimiter,      mapleradRoutes);
app.use("/api/fees",                           feesRoutes);
app.use("/api/fredai",        apiLimiter,      fredaiRoutes);
app.use("/api/kyc",                            kycRoutes);
app.use("/api/subscriptions", apiLimiter,      subscriptionRoutes);
app.use("/api/paym",                           paymRoutes);
app.use("/api/cron",                           cronRoutes);
app.use("/api/app-status",                     appStatusRoutes);
app.use("/api/referrals",     apiLimiter,      referralRoutes);

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "Freda Pay Backend", version: "3.0.0", timestamp: new Date().toISOString() });
});

app.post("/dev/reset-rate-limits", (_req: Request, res: Response) => {
  if (process.env.NODE_ENV === "production") { res.status(403).json({ error: "Disabled in production" }); return; }
  resetRateLimits();
  res.json({ success: true, message: "Rate limits reset" });
});

app.get("/", (_req: Request, res: Response) => {
  res.json({
    name: "Freda Pay LLC — Backend API",
    version: "3.0.0",
    provider: "Maplerad",
    endpoints: {
      health:           "GET  /health",
      auth:             "POST /api/auth/login",
      wallet:           "GET  /api/wallet/balance",
      maplerad_enroll:  "POST /api/maplerad/customers/enroll",
      maplerad_card:    "POST /api/maplerad/cards/create",
      maplerad_deposit: "POST /api/maplerad/deposit/virtual-account",
      maplerad_payout:  "POST /api/maplerad/payout/local",
      fredai:           "POST /api/fredai/chat",
      kyc:              "POST /api/kyc/start",
      webhook:          "POST /api/webhooks/maplerad",
    },
  });
});

app.use((_req: Request, res: Response) => { res.status(404).json({ error: "Route introuvable" }); });
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error("Erreur non gérée", { message: err.message });
  res.status(500).json({ error: process.env.NODE_ENV === "production" ? "Erreur serveur interne" : err.message });
});

app.listen(PORT, "0.0.0.0", async () => {
  logger.info("══════════════════════════════════════════");
  logger.info(`  Freda Pay Backend v3.0 (Maplerad) — Port ${PORT}`);
  logger.info(`  Enroll    : POST /api/maplerad/customers/enroll`);
  logger.info(`  Card      : POST /api/maplerad/cards/create`);
  logger.info(`  Deposit   : POST /api/maplerad/deposit/virtual-account`);
  logger.info(`  Payout    : POST /api/maplerad/payout/local`);
  logger.info(`  Fred'AI   : POST /api/fredai/chat`);
  logger.info(`  Webhook   : POST /api/webhooks/maplerad`);
  logger.info("══════════════════════════════════════════");

  if (process.env.NODE_ENV !== "production") { resetRateLimits(); logger.info("Rate limits reset (DEV mode)"); }

  // ── Verifikasyon variables ───────────────────────────────
  const REQUIRED = [
    { key: "SUPABASE_URL",         hint: "supabase.com → Project → Settings → API → Project URL" },
    { key: "SUPABASE_SECRET_KEY",  hint: "supabase.com → Project → Settings → API → service_role key" },
    { key: "JWT_SECRET",           hint: "Jenere: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\"" },
    { key: "MAPLERAD_SECRET_KEY",  hint: "app.maplerad.com → Settings → API Keys (fallback: sandbox)" },
    { key: "MAPLERAD_PUBLIC_KEY",  hint: "app.maplerad.com → Settings → API Keys (fallback: sandbox)" },
    { key: "DEEPSEEK_API_KEY",     hint: "platform.deepseek.com → API Keys" },
  ];
  const OPTIONAL = [
    { key: "BREVO_API_KEY",            effect: "Emails tranzaksyonèl dezaktive" },
    { key: "GROQ_API_KEY",             effect: "Mod Vwa Fred'AI dezaktive" },
    { key: "MAPLERAD_WEBHOOK_SECRET",  effect: "Signature webhook pa verifye (risk sekirite)" },
    { key: "LOGODEV_PUBLIC_KEY",       effect: "Logos marchands pa afiche" },
    { key: "PAYM_CLIENT_ID",           effect: "Pay'm (MonCash/NatCash) dezaktive" },
    { key: "DIDIT_API_KEY",            effect: "KYC Didit dezaktive" },
    { key: "ADMIN_TOKEN",              effect: "Rout admin pa pwoteje — RISK SEKIRITE" },
  ];

  let missing = 0;
  logger.info("── Verifikasyon variables .env ──────────────");
  REQUIRED.forEach(({ key, hint }) => {
    if (!process.env[key]) { logger.error(`❌ REQUIS: ${key} manke → ${hint}`); missing++; }
    else logger.info(`✅ ${key}`);
  });
  OPTIONAL.forEach(({ key, effect }) => {
    if (!process.env[key]) logger.warn(`⚠  OPSYONÈL: ${key} manke — ${effect}`);
  });
  if (missing > 0) {
    logger.error(`── ${missing} variable(s) requis manke ──────────────`);
    logger.error(`   → Edite .env epi relanse: npm run dev`);
  } else {
    logger.info("── Tout variables requis prezan ✅ ──────────");
  }

  await testSupabaseConnection();

  try {
    const { scheduleDailyCron } = await import("./cron/subscription.cron");
    scheduleDailyCron();
    // ✅ v105: bonjou chak maten + rapèl biometrik.
    const { scheduleMorningGreeting } = await import("./cron/morningGreeting.cron");
    scheduleMorningGreeting();
  } catch (e: any) { logger.warn("Cron non démarré: " + e.message); }

  const { EmailService } = await import("./services/email.service");
  await EmailService.testConnection();

  // Test Maplerad connexion
  try {
    const { MapleradWalletService } = await import("./services/maplerad.service");
    await MapleradWalletService.getWallets();
    logger.info("✅ Maplerad connecté");
  } catch (e: any) {
    logger.warn("⚠ Maplerad: " + e.message);
  }
});

export default app;
