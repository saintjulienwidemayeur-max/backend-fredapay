// ============================================================
// Service Email — Freda Pay via Brevo (ex-Sendinblue)
// Sender: contact@fredapay.com
// Design: style officiel Freda Pay (email.html v2)
// ============================================================
//
// ✅ v53 — Chanjman KRITIK pou:
//   1. Imèl (menm OTP) t ap ale nan tab "Promotions" Gmail
//   2. Logo pa monte sou Android
//
// SOLISYON YO:
//   • Logo: sèvi depi backend la limenm (`${BACKEND_URL}/public/logo.png`)
//     olye dl.dropboxusercontent.com — proxy imaj Gmail la mache pi byen
//     ak yon URL nan yon domèn "reliable" ki gen Cache-Control byen mete.
//   • Headers transactionnels: `X-Category: Transactional`,
//     `X-Priority: 1`, `Precedence: transactional`, `X-Auto-Response-
//     Suppress: All` — sa siyale Gmail sa a se yon imèl kont/sekirite,
//     pa pwomosyon.
//   • Text (plain-text) OBLIGATWA pou chak imèl — Gmail penalize imèl
//     ki gen SÈLMAN HTML.
//   • Kle: retire twòp emoji nan subject (⚠️🔒💸🎉) — se yon siyal for
//     ke classification "Promotional".
//   • Subject transactionnel klè: "Freda Pay: Code 123456" olye
//     "🎉 Bienvenue! Votre code!".

// ✅ v54 — KORIJE logo ki KASE NÈT (Android + iPhone) + email nan
//   Promotions:
//   • v53 te chanje logo a pou `${BACKEND_URL}/public/logo.png`. Men
//     backend la sou Render FREE TIER — li DÒMI apre kèk minit inaktivite.
//     Lè Gmail (oswa Apple Mail) al chèche imaj la pandan sèvè a ap
//     reveye, demann nan TIMEOUT → logo an kase sou TOU DE platfòm. Se yon
//     regresyon v53 te entwodwi.
//   • SOLISYON FYAB: entegre logo a DIRÈKTEMAN nan imèl la kòm imaj CID
//     inline (baz64). Imaj la vwayaje AK imèl la — li pa depann ankò de
//     okenn sèvè ki dwe reveye, ni de proxy imaj ki ka echwe. Sa mache sou
//     Gmail Android, Gmail iOS, Apple Mail, Outlook.
//   • BONIS: imaj inline (olye yon imaj lwen ki chaje) se yon siyal PI
//     "transactionnel" pou Gmail — sa ede imèl yo RETE DEYÒ Promotions.

import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { logger } from "../utils/logger";

interface EmailOptions {
  to: string;
  toName?: string;
  subject: string;
  html: string;
  text?: string;
  tags?: string[];
  /** ✅ v53: klasifikasyon obligatwa — transactional pou OTP/tranzaksyon,
   * marketing pou pwomosyon (nou pa itilize l pou kounye a). */
  category?: "transactional" | "notification" | "marketing";
}

const BREVO_URL    = "https://api.brevo.com/v3/smtp/email";
const SENDER_EMAIL = "contact@fredapay.com";
const SENDER_NAME  = "Freda Pay";

// ✅ v54: sèvi logo a depi backend URL kòm FALLBACK sèlman. Metòd
// prensipal la se CID inline pi ba a.
const BACKEND_URL = process.env.BACKEND_URL || process.env.PUBLIC_URL || "https://backend-fredapay11.onrender.com";
const LOGO_URL = `${BACKEND_URL}/public/logo.png`;

// ✅ v54: chaje logo a YON SÈL FWA lè sèvè a demare, kòm baz64, pou
// entegre l inline (CID) nan chak imèl. Nou eseye plizyè chemen posib
// paske selon build la (ts-node vs dist), `process.cwd()` ka varye.
const LOGO_CID = "fredalogo.png";
function loadLogoBase64(): string {
  const candidates = [
    path.join(process.cwd(), "public", "logo.png"),
    path.join(process.cwd(), "dist", "public", "logo.png"),
    path.join(__dirname, "..", "..", "public", "logo.png"),
    path.join(__dirname, "..", "public", "logo.png"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p).toString("base64");
    } catch { /* eseye pwochen an */ }
  }
  logger.warn("Logo email pa jwenn sou disk — fallback sou URL lwen an", { candidates });
  return "";
}
const LOGO_BASE64 = loadLogoBase64();
const USE_INLINE_LOGO = LOGO_BASE64.length > 0;

// ✅ v54: si nou gen imaj la lokalman → `cid:` inline (fyab). Sinon →
// URL lwen an (fallback, ka kase si Render ap dòmi).
const LOGO_SVG = `<img
  src="${USE_INLINE_LOGO ? `cid:${LOGO_CID}` : LOGO_URL}"
  width="88" height="88" alt="Freda Pay"
  style="width:88px !important;height:88px !important;display:block;margin:0 auto;border:0 !important;border-radius:20px;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic"
/>`;

// ✅ v53: konvèti HTML an tèks plen pou vèsyon text/plain imèl la —
// obligatwa pou deliverability. Yon vèsyon senp ki retire tag yo,
// otorize entite HTML de baz, epi netwaye espas.
function htmlToText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

// ── Template base — style officiel ───────────────────────────
const baseTemplate = (content: string, preheader = "") => `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0,user-scalable=yes">
  <title>Freda Pay</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Helvetica,Arial,sans-serif;background:#f0f2f6;padding:2rem 1rem;min-height:100vh}
    .container{max-width:600px;width:100%;margin:0 auto;background:#ffffff;border-radius:2rem;overflow:hidden;box-shadow:0 20px 40px -12px rgba(0,0,0,0.12)}
    /* Header */
    .header{background:#ef366e;padding:2.5rem 2rem 2rem;text-align:center;position:relative}
    .header::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,rgba(255,255,255,.2),rgba(255,255,255,.9),rgba(255,255,255,.2))}
    .logo-wrap{display:block;text-align:center;margin-bottom:.9rem}
    .freedom-tagline{font-size:.82rem;font-weight:500;letter-spacing:.5px;color:rgba(255,255,255,.95);margin-bottom:.6rem;font-style:italic}
    .tagline-pill{font-size:.65rem;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,.85);background:rgba(0,0,0,.18);display:inline-block;padding:.28rem 1.1rem;border-radius:30px}
    /* Content */
    .content{padding:2.5rem 2.2rem;text-align:center}
    .content h1{font-size:1.85rem;font-weight:700;color:#1a1e2b;margin-bottom:.6rem;letter-spacing:-.3px}
    .content h2{font-size:1.35rem;font-weight:700;color:#1a1e2b;margin-bottom:.6rem}
    .lead{font-size:.95rem;line-height:1.65;color:#2c3e44;margin:1rem 0 1.2rem;font-weight:400}
    .highlight{font-weight:700;color:#ef366e;background:#fef2f5;padding:.1rem .4rem;border-radius:5px}
    /* OTP / Code box */
    .code-box{background:#fafbfe;border:2px solid #ef366e;border-radius:1.3rem;padding:2rem 1.5rem;text-align:center;margin:1.5rem 0}
    .code{font-size:3rem;font-weight:900;letter-spacing:12px;color:#ef366e;font-family:'Courier New',Courier,monospace;display:block;line-height:1}
    .code-label{font-size:.65rem;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#9aa6b9;margin-bottom:.7rem;display:block}
    .code-expire{font-size:.75rem;color:#7a879b;margin-top:.75rem;display:block}
    /* Info rows */
    .info-box{background:#fafbfe;border:1px solid #edeff4;border-radius:1.3rem;padding:1.2rem 1.5rem;margin:1.5rem 0;text-align:left}
    .info-row{display:flex;justify-content:space-between;align-items:center;padding:.6rem 0;border-bottom:1px solid #eceef3}
    .info-row:last-child{border-bottom:none}
    .info-lbl{font-size:.78rem;color:#6c7b8f}
    .info-val{font-size:.78rem;font-weight:700;color:#1a1e2b;text-align:right}
    /* Benefits */
    .benefits{background:#fafbfe;border:1px solid #edeff4;border-radius:1.3rem;padding:1.3rem 1.5rem;margin:1.5rem 0;text-align:left}
    .benefit-item{display:flex;align-items:flex-start;gap:.8rem;font-size:.88rem;color:#1e2a32;line-height:1.5;padding:.45rem 0;border-bottom:1px solid #eceef3}
    .benefit-item:last-child{border-bottom:none}
    .benefit-dot{color:#ef366e;font-weight:800;font-size:1rem;flex-shrink:0;margin-top:1px}
    /* Alerts */
    .alert-warn{background:#fffbeb;border:1px solid #fcd34d;border-radius:1rem;padding:1rem 1.2rem;margin:1.2rem 0;text-align:left}
    .alert-warn p{font-size:.82rem;color:#92400e;margin:0;line-height:1.5}
    .alert-danger{background:#fff5f5;border:1px solid #fca5a5;border-radius:1rem;padding:1rem 1.2rem;margin:1.2rem 0;text-align:left}
    .alert-danger p{font-size:.82rem;color:#991b1b;margin:0;line-height:1.5}
    .alert-success{background:#f0fdf4;border:1px solid #86efac;border-radius:1rem;padding:1rem 1.2rem;margin:1.2rem 0;text-align:left}
    .alert-success p{font-size:.82rem;color:#14532d;margin:0;line-height:1.5}
    /* Tag box */
    .tag-box{background:#fafbfe;border:2px solid #edeff4;border-radius:1.3rem;padding:1.5rem;text-align:center;margin:1.5rem 0}
    .tag-label{font-size:.6rem;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#9aa6b9;display:block;margin-bottom:.5rem}
    .tag-value{font-size:1.8rem;font-weight:900;color:#1a1e2b;letter-spacing:2px;font-family:'Courier New',Courier,monospace}
    /* Button */
    .btn{display:inline-block;background:#1a1e2b;color:#ffffff !important;padding:.85rem 2.2rem;border-radius:48px;text-decoration:none;font-weight:700;font-size:.88rem;letter-spacing:.2px;margin-top:1rem}
    /* Amount */
    .amount-credit{font-size:1.6rem;font-weight:900;color:#16a34a}
    .amount-debit{font-size:1.6rem;font-weight:900;color:#dc2626}
    /* Footer */
    .footer{background:#ffffff;padding:1.6rem 2rem;text-align:center;border-top:1px solid #eceef3}
    .footer .co{font-weight:700;color:#11161f;font-size:.82rem;margin-bottom:.3rem}
    .footer address{font-style:normal;font-size:.7rem;color:#6c7b8f;line-height:1.5}
    .footer .contact{margin:.5rem 0;font-size:.7rem;color:#6c7b8f}
    .footer .contact a{color:#ef366e;text-decoration:none}
    .footer .unsub{margin:.65rem 0;font-size:.65rem;color:#8f9bb3}
    .footer .unsub a{color:#ef366e;text-decoration:none}
    .footer .disclaimer{font-size:.6rem;color:#9aa6b9;line-height:1.5;margin:.65rem 0}
    .sep{width:36px;margin:.5rem auto;border:0;height:1px;background:#dfe3ea}
    .legal{font-size:.58rem;color:#a0abc0;line-height:1.4;margin-top:.3rem}
    @media(max-width:540px){
      body{padding:1rem .75rem}
      .content{padding:1.8rem 1.3rem}
      .content h1{font-size:1.55rem}
      .code{font-size:2.2rem;letter-spacing:8px}
    }
  </style>
</head>
<body>
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${preheader}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>` : ""}
  <div class="container">

    <!-- HEADER -->
    <div class="header">
      <div class="logo-wrap">${LOGO_SVG}</div>
      <div class="freedom-tagline">La liberté de payer partout</div>
      <div class="tagline-pill">DIGITAL BANKING</div>
    </div>

    <!-- CONTENT -->
    <div class="content">
      ${content}
    </div>

    <!-- FOOTER -->
    <div class="footer">
      <div class="co">Freda Pay LLC</div>
      <address>30 N Gould St Ste R, Sheridan, WY 82801, United States</address>
      <div class="contact">
        Support&nbsp;: <a href="mailto:contact@fredapay.com">contact@fredapay.com</a>
        &nbsp;·&nbsp; <a href="https://fredapay.com">www.fredapay.com</a>
      </div>
      <div class="unsub">
        Vous recevez cet e-mail car vous êtes inscrit sur Freda Pay.
        <a href="${process.env.FRONTEND_URL || "https://fredapay.com"}/unsubscribe">Se désinscrire</a>
      </div>
      <div class="disclaimer">
        Freda Pay LLC est une plateforme technologique financière (FinTech) et non une banque.
        Les cartes virtuelles et services de comptes en USD sont fournis en partenariat avec des institutions financières agréées.
      </div>
      <hr class="sep">
      <div class="legal">© 2026 Freda Pay LLC. Tous droits réservés.</div>
    </div>

  </div>
</body>
</html>`;

export const EmailService = {

  // ── Envoi central via Brevo ───────────────────────────────────
  async send(opts: EmailOptions): Promise<boolean> {
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) {
      logger.warn("BREVO_API_KEY manquant — email non envoyé", { to: opts.to });
      return false;
    }

    // ✅ v53: itilize text bay a, oswa jenere yon vèsyon fallback soti nan
    // HTML la — Gmail penalize imèl san text/plain.
    const textContent = opts.text || htmlToText(opts.html);

    // ✅ v53: header transactionnels — reponn kesyon "sa se yon
    // transaksyon oswa yon pwomosyon?". Precedence + X-Category yo se
    // siyal ki Gmail/Outlook itilize pou klasifikasyon.
    const category = opts.category || "transactional";
    const transactionalHeaders: Record<string, string> = {
      "X-Category": category === "transactional" ? "Transactional" : category === "notification" ? "Notification" : "Marketing",
      // Precedence: normal or list — jamais bulk (bulk = spam signal)
      "Precedence": category === "marketing" ? "list" : "normal",
      // Auto-response suppress — bloke "out of office" ki polue kèz
      "X-Auto-Response-Suppress": "All",
      // Priorite HIGH pou tranzaksyon
      ...(category === "transactional" && {
        "X-Priority": "1",
        "X-MSMail-Priority": "High",
        "Importance": "High",
      }),
      // Entity ID — Freda Pay identifikasyon
      "X-Entity-Ref-ID": `fredapay-${Date.now()}`,
      // Konpayans anti-spam
      "X-Mailer": "Freda Pay Transactional Service",
    };

    try {
      const res = await fetch(BREVO_URL, {
        method: "POST",
        headers: {
          "accept":       "application/json",
          "api-key":      apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sender:      { name: SENDER_NAME, email: SENDER_EMAIL },
          to:          [{ email: opts.to, name: opts.toName || opts.to }],
          subject:     opts.subject,
          htmlContent: opts.html,
          textContent, // ✅ TOUJOU voye text/plain — kritik pou deliverability
          headers:     transactionalHeaders,
          // ✅ v54: logo inline (CID) — Brevo rekonèt `cid:fredalogo.png`
          // paske non atachman an se menm bagay la. Imaj la parèt ANNDAN
          // imèl la, li pa yon atachman apa, e li pa depann de okenn sèvè.
          ...(USE_INLINE_LOGO && {
            attachment: [{ content: LOGO_BASE64, name: LOGO_CID }],
          }),
          ...(opts.tags && { tags: opts.tags }),
        }),
      });
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) {
        logger.error("Brevo erreur envoi", { status: res.status, body: data, to: opts.to });
        return false;
      }
      logger.info("✅ Email envoyé", { to: opts.to, subject: opts.subject, msgId: data.messageId, category });
      return true;
    } catch (err) {
      logger.error("Brevo fetch échoué", { error: err instanceof Error ? err.message : err });
      return false;
    }
  },

  // ── 1. Vérification email (OTP) ───────────────────────────────
  async sendVerification(email: string, firstname: string, code: string): Promise<boolean> {
    return this.send({
      to: email, toName: firstname,
      // ✅ v53: subject klè, san emoji, ki gen kod la ANVAN — Gmail
      // klasifye sa a kòm transactional, pa promotional.
      subject: `Freda Pay: Code de vérification ${code}`,
      tags: ["verification"],
      category: "transactional",
      html: baseTemplate(`
        <h1>Vérification</h1>
        <p class="lead">Bonjour <span class="highlight">${firstname}</span>, entrez ce code pour activer votre compte :</p>
        <div class="code-box">
          <span class="code-label">Code de vérification</span>
          <span class="code">${code}</span>
          <span class="code-expire">⏱ Expire dans <strong>15 minutes</strong> · Usage unique</span>
        </div>
        <div class="alert-warn">
          <p>Ne partagez jamais ce code. Freda Pay ne vous le demandera jamais par téléphone ou message.</p>
        </div>
        <p style="font-size:.8rem;color:#7a879b;margin-top:1rem">Si vous n'avez pas créé de compte, ignorez cet email.</p>
      `, `Votre code de vérification Freda Pay est ${code}`),
    });
  },

  // ── 2. Bienvenue ──────────────────────────────────────────────
  async sendWelcome(email: string, firstname: string, FredaTag: string): Promise<boolean> {
    return this.send({
      to: email, toName: firstname,
      subject: `Bienvenue sur Freda Pay, ${firstname}`,
      tags: ["welcome"],
      category: "notification",
      html: baseTemplate(`
        <h1>Bienvenue !</h1>
        <p class="lead">
          <span class="highlight">FREDA PAY LLC</span> est ravi de vous accueillir.
          Une expérience financière repensée pour être <strong>rapide, sécurisée</strong> et <strong>parfaitement fluide</strong>.
        </p>
        <div class="tag-box">
          <span class="tag-label">Votre FredaTag</span>
          <span class="tag-value">@${FredaTag}</span>
        </div>
        <div class="benefits">
          <div class="benefit-item"><span class="benefit-dot">—</span>Transactions instantanées disponibles 24 heures sur 24</div>
          <div class="benefit-item"><span class="benefit-dot">—</span>Sécurité bancaire certifiée norme institutionnelle</div>
          <div class="benefit-item"><span class="benefit-dot">—</span>Support client dédié et réactif 7 jours sur 7</div>
        </div>
        <p style="font-size:.85rem;color:#3b4e5a;margin:.6rem 0 0">Commencez par vérifier votre identité pour débloquer toutes les fonctionnalités.</p>
        <a href="${process.env.FRONTEND_URL || "https://fredapay.com"}/kyc" class="btn">Vérifier mon identité →</a>
        <p style="font-size:.68rem;color:#7a879b;margin-top:.9rem">Plateforme sécurisée — authentification renforcée</p>
      `, `Bienvenue sur Freda Pay, ${firstname} !`),
    });
  },

  // ── 3. Code 2FA ───────────────────────────────────────────────
  async send2FACode(email: string, firstname: string, code: string, device?: string): Promise<boolean> {
    return this.send({
      to: email, toName: firstname,
      subject: `Freda Pay: Code de connexion ${code}`,
      tags: ["2fa"],
      category: "transactional",
      html: baseTemplate(`
        <h1>Connexion</h1>
        <p class="lead">Bonjour <span class="highlight">${firstname}</span>, voici votre code de connexion :</p>
        <div class="code-box">
          <span class="code-label">Code d'authentification</span>
          <span class="code">${code}</span>
          <span class="code-expire">⏱ Expire dans <strong>5 minutes</strong> · Usage unique</span>
        </div>
        ${device ? `
        <div class="info-box">
          <div class="info-row"><span class="info-lbl">Appareil</span><span class="info-val">${device}</span></div>
          <div class="info-row"><span class="info-lbl">Date</span><span class="info-val">${new Date().toLocaleString("fr-FR")}</span></div>
        </div>` : ""}
        <div class="alert-warn">
          <p>Ne partagez jamais ce code. Freda Pay ne vous le demandera jamais.</p>
        </div>
        <div class="alert-danger">
          <p>Si ce n'est pas vous, changez votre mot de passe immédiatement et contactez le support.</p>
        </div>
      `, `Votre code de connexion Freda Pay est ${code}`),
    });
  },

  // ── 4. Reset mot de passe ─────────────────────────────────────
  async sendPasswordReset(email: string, firstname: string, code: string): Promise<boolean> {
    return this.send({
      to: email, toName: firstname,
      subject: `Freda Pay: Code de réinitialisation ${code}`,
      tags: ["password-reset"],
      category: "transactional",
      html: baseTemplate(`
        <h1>Nouveau mot de passe</h1>
        <p class="lead">Bonjour <span class="highlight">${firstname}</span>, utilisez ce code pour réinitialiser votre mot de passe :</p>
        <div class="code-box">
          <span class="code-label">Code de réinitialisation</span>
          <span class="code">${code}</span>
          <span class="code-expire">⏱ Expire dans <strong>10 minutes</strong></span>
        </div>
        <div class="alert-warn">
          <p>Ce code est valable une seule fois. Ne le partagez avec personne.</p>
        </div>
        <div class="alert-danger">
          <p>Vous n'avez pas demandé cette réinitialisation ? Contactez <a href="mailto:contact@fredapay.com" style="color:#991b1b;font-weight:700">contact@fredapay.com</a> immédiatement.</p>
        </div>
      `, `Votre code de réinitialisation Freda Pay est ${code}`),
    });
  },

  // ── 5. Transaction ────────────────────────────────────────────
  async sendTransactionNotif(
    email: string, firstname: string,
    type: "received" | "sent",
    amount: string, counterpart: string, txnId: string
  ): Promise<boolean> {
    const isSent = type === "sent";
    return this.send({
      to: email, toName: firstname,
      subject: isSent
        ? `Freda Pay: Transfert de ${amount} envoyé`
        : `Freda Pay: Vous avez reçu ${amount}`,
      tags: ["transaction"],
      category: "transactional",
      html: baseTemplate(`
        <h1>${isSent ? "Transfert envoyé" : "Argent reçu"}</h1>
        <p class="lead">Bonjour <span class="highlight">${firstname}</span>,
          ${isSent
            ? `votre transfert de <strong>${amount}</strong> à <strong>${counterpart}</strong> a été effectué avec succès.`
            : `vous avez reçu <strong style="color:#16a34a">${amount}</strong> de la part de <strong>${counterpart}</strong>.`
          }
        </p>
        <div style="text-align:center;margin:1.5rem 0">
          <span class="${isSent ? "amount-debit" : "amount-credit"}">${isSent ? "−" : "+"}${amount}</span>
        </div>
        <div class="info-box">
          <div class="info-row">
            <span class="info-lbl">${isSent ? "Destinataire" : "Expéditeur"}</span>
            <span class="info-val">${counterpart}</span>
          </div>
          <div class="info-row">
            <span class="info-lbl">Statut</span>
            <span class="info-val" style="color:#16a34a">Confirmé</span>
          </div>
          <div class="info-row">
            <span class="info-lbl">Référence</span>
            <span class="info-val" style="font-family:monospace;font-size:.7rem">${txnId}</span>
          </div>
          <div class="info-row">
            <span class="info-lbl">Date</span>
            <span class="info-val">${new Date().toLocaleString("fr-FR")}</span>
          </div>
        </div>
        <a href="${process.env.FRONTEND_URL || "https://fredapay.com"}/wallet" class="btn">Voir mon portefeuille →</a>
      `, isSent ? `Transfert de ${amount} envoyé à ${counterpart}` : `Vous avez reçu ${amount} de ${counterpart}`),
    });
  },

  // ── 6. Alerte sécurité ────────────────────────────────────────
  async sendSecurityAlert(
    email: string, firstname: string,
    alertType: "new_login" | "password_changed" | "card_blocked",
    details?: Record<string, string>
  ): Promise<boolean> {
    const configs: Record<string, { subject: string; icon: string; title: string; body: string }> = {
      new_login: {
        subject: "Freda Pay: Nouvelle connexion à votre compte",
        icon: "", title: "Nouvelle connexion",
        body: `Une connexion a été détectée depuis <strong>${details?.device || "un appareil inconnu"}</strong> le ${details?.time || new Date().toLocaleString("fr-FR")}.`,
      },
      password_changed: {
        subject: "Freda Pay: Mot de passe modifié",
        icon: "", title: "Mot de passe modifié",
        body: `Votre mot de passe a été modifié avec succès le ${new Date().toLocaleString("fr-FR")}.`,
      },
      card_blocked: {
        subject: "Freda Pay: Carte bloquée",
        icon: "", title: "Carte bloquée",
        body: `Votre carte <strong>···· ${details?.lastFour || "****"}</strong> a été bloquée suite à une demande de sécurité.`,
      },
    };
    const cfg = configs[alertType];
    return this.send({
      to: email, toName: firstname,
      subject: cfg.subject,
      tags: ["security"],
      category: "transactional",
      html: baseTemplate(`
        <h1>${cfg.title}</h1>
        <p class="lead">Bonjour <span class="highlight">${firstname}</span>,</p>
        <div class="alert-danger">
          <p><strong>Alerte de sécurité</strong><br>${cfg.body}</p>
        </div>
        <div class="benefits">
          <div class="benefit-item"><span class="benefit-dot">—</span>Si c'est bien vous : aucune action requise.</div>
          <div class="benefit-item"><span class="benefit-dot">—</span>Si ce n'est pas vous : changez votre mot de passe immédiatement.</div>
          <div class="benefit-item"><span class="benefit-dot">—</span>En cas de doute, contactez notre support 24h/7j.</div>
        </div>
        <a href="mailto:contact@fredapay.com" class="btn">Contacter le support →</a>
      `, cfg.body),
    });
  },

  // ── 7. KYC status ─────────────────────────────────────────────
  async sendKYCStatus(email: string, firstname: string, status: "approved" | "declined" | "in_review"): Promise<boolean> {
    const cfgs = {
      approved: {
        subject: "Freda Pay: Votre identité est vérifiée",
        html: `
          <h1>Identité vérifiée ✅</h1>
          <p class="lead">Bonjour <span class="highlight">${firstname}</span>, votre identité a été vérifiée avec succès !</p>
          <div class="alert-success">
            <p>✅ <strong>Félicitations !</strong> Votre compte est maintenant pleinement opérationnel.</p>
          </div>
          <div class="benefits">
            <div class="benefit-item"><span class="benefit-dot">—</span>Envoi et réception d'argent débloqués</div>
            <div class="benefit-item"><span class="benefit-dot">—</span>Création de carte virtuelle disponible</div>
            <div class="benefit-item"><span class="benefit-dot">—</span>Accès complet au compte USD</div>
          </div>
          <a href="${process.env.FRONTEND_URL || "https://fredapay.com"}" class="btn">Accéder à mon compte →</a>`,
      },
      declined: {
        subject: "Freda Pay: Vérification non approuvée",
        html: `
          <h1>Vérification refusée</h1>
          <p class="lead">Bonjour <span class="highlight">${firstname}</span>,</p>
          <div class="alert-danger">
            <p>❌ Votre vérification d'identité n'a pas pu être approuvée. Cela peut être dû à des documents illisibles ou incomplets.</p>
          </div>
          <div class="benefits">
            <div class="benefit-item"><span class="benefit-dot">—</span>Assurez-vous que vos documents sont clairs et valides</div>
            <div class="benefit-item"><span class="benefit-dot">—</span>Toutes les informations doivent correspondre</div>
            <div class="benefit-item"><span class="benefit-dot">—</span>Contactez le support en cas de besoin</div>
          </div>
          <a href="mailto:contact@fredapay.com" class="btn">Contacter le support →</a>`,
      },
      in_review: {
        subject: "Freda Pay: Votre dossier est en cours d'examen",
        html: `
          <h1>Dossier en révision ⏳</h1>
          <p class="lead">Bonjour <span class="highlight">${firstname}</span>, votre dossier KYC est en cours d'examen par notre équipe.</p>
          <div class="alert-warn">
            <p>⏳ La révision prend généralement <strong>24 à 48 heures</strong>. Vous recevrez un email dès qu'une décision sera prise.</p>
          </div>
          <p style="font-size:.82rem;color:#3b4e5a;margin-top:.8rem">Merci pour votre patience. Notre équipe traite votre dossier avec soin.</p>`,
      },
    };
    const cfg = cfgs[status];
    return this.send({
      to: email, toName: firstname,
      subject: cfg.subject,
      tags: ["kyc"],
      category: "transactional",
      html: baseTemplate(cfg.html),
    });
  },

  // ── 8. Dunning (plan expiré / grace period) ───────────────────
  // ── Imèl konfirmasyon abònman ─────────────────────────────
  async sendPlanActivated(
    email: string,
    firstname: string,
    plan: string,
    planLabel: string,
    amountPaid: string,
    nextRenewal: string,
    features: string[],
  ): Promise<boolean> {
    const featureRows = features.map(f =>
      `<div class="benefit-item"><span class="benefit-dot">✓</span>${f}</div>`
    ).join("");

    const html = baseTemplate(`
      <div class="content">
        <h2>🎉 Plan ${planLabel} activé !</h2>
        <p class="lead">Bonjour <span class="highlight">${firstname}</span>,<br>
        Votre abonnement <strong>${planLabel}</strong> est maintenant actif. Profitez de toutes vos fonctionnalités.</p>

        <div class="info-box">
          <div class="info-row">
            <span class="info-lbl">Plan</span>
            <span class="info-val">${planLabel}</span>
          </div>
          <div class="info-row">
            <span class="info-lbl">Montant débité</span>
            <span class="info-val" style="color:#ef366e;font-size:.9rem;font-weight:900">${amountPaid}</span>
          </div>
          <div class="info-row">
            <span class="info-lbl">Prochain renouvellement</span>
            <span class="info-val">${nextRenewal}</span>
          </div>
        </div>

        <div class="alert-success">
          <p>✅ Votre compte est actif. Toutes les fonctionnalités du plan ${planLabel} sont disponibles immédiatement.</p>
        </div>

        ${features.length > 0 ? `
        <div class="benefits">
          <p style="font-size:.78rem;font-weight:700;color:#6c7b8f;letter-spacing:2px;text-transform:uppercase;margin-bottom:.7rem">Inclus dans votre plan</p>
          ${featureRows}
        </div>` : ""}

        <a href="https://fredapay.com/subscription" class="btn" style="display:inline-block;background:#ef366e;color:#fff;text-decoration:none;padding:.85rem 2.2rem;border-radius:1rem;font-weight:700;font-size:.92rem;margin:1.2rem 0">
          Gérer mon abonnement →
        </a>

        <p style="font-size:.78rem;color:#9aa6b9;margin-top:1.5rem;line-height:1.6">
          Pour annuler ou changer de plan, rendez-vous dans l'application.<br>
          Des questions ? <a href="mailto:contact@fredapay.com" style="color:#ef366e">contact@fredapay.com</a>
        </p>
      </div>
    `, `Plan ${planLabel} activé — ${amountPaid} débités`);

    return this.send({
      to: email, toName: firstname,
      subject: `Freda Pay: Plan ${planLabel} activé`,
      html,
      tags: ["subscription", "plan-activated", plan],
      category: "transactional",
    });
  },

  async sendDunningEmail(
    to: string, name: string,
    data: { plan: string; amountDue: string; daysRemaining: number; isLocked?: boolean }
  ): Promise<void> {
    const subject = data.isLocked
      ? `Freda Pay: Compte verrouillé — Action requise (${data.amountDue})`
      : data.daysRemaining > 0
      ? `Freda Pay: ${data.daysRemaining} jour(s) pour renouveler votre plan`
      : `Freda Pay: Votre plan a expiré`;

    await this.send({
      to, toName: name, subject,
      tags: ["dunning"],
      category: "transactional",
      html: baseTemplate(`
        <h1>${data.isLocked ? "🔒 Compte verrouillé" : "⚠️ Plan expiré"}</h1>
        <p class="lead">Bonjour <span class="highlight">${name}</span>,
          ${data.isLocked
            ? "votre compte Freda Pay est verrouillé. Vous pouvez uniquement recevoir des fonds ou recharger votre wallet."
            : `votre plan <strong>${data.plan || "actuel"}</strong> a expiré ou ne peut pas être renouvelé automatiquement.`
          }
        </p>
        <div class="${data.isLocked ? "alert-danger" : "alert-warn"}">
          <p>
            <strong>Montant dû : ${data.amountDue}</strong>
            ${data.daysRemaining > 0 ? `<br>Il vous reste <strong>${data.daysRemaining} jour(s)</strong> avant verrouillage total.` : ""}
          </p>
        </div>
        <div class="benefits">
          ${data.isLocked
            ? `<div class="benefit-item"><span class="benefit-dot">—</span>Réception de fonds : autorisée</div>
               <div class="benefit-item"><span class="benefit-dot">—</span>Rechargement wallet : autorisé</div>
               <div class="benefit-item"><span class="benefit-dot">—</span>Envoi d'argent : bloqué jusqu'au paiement</div>`
            : `<div class="benefit-item"><span class="benefit-dot">—</span>Réglez avant l'échéance pour éviter le verrouillage</div>
               <div class="benefit-item"><span class="benefit-dot">—</span>Toutes vos données sont conservées</div>
               <div class="benefit-item"><span class="benefit-dot">—</span>Réactivation immédiate après paiement</div>`
          }
        </div>
        <a href="${process.env.FRONTEND_URL || "https://fredapay.com"}/subscription" class="btn">
          ${data.isLocked ? "Payer et débloquer mon compte →" : "Renouveler mon abonnement →"}
        </a>
        <p style="font-size:.68rem;color:#7a879b;margin-top:.9rem">Plateforme sécurisée — paiement instantané</p>
      `, `Montant dû : ${data.amountDue}`),
    });
  },

  // ── 9. Compte verrouillé ──────────────────────────────────────
  async sendAccountLockedEmail(to: string, name: string, amountDue: string): Promise<void> {
    await this.sendDunningEmail(to, name, { plan: "", amountDue, daysRemaining: 0, isLocked: true });
  },

  // ── Imèl admin ekri manyèlman (Inbox reply, oswa mesaj/anons jeneral) ──
  async sendAdminMessage(to: string, toName: string, subject: string, message: string): Promise<boolean> {
    const paragraphs = message.split("\n").filter(Boolean).map(p => `<p class="lead">${p}</p>`).join("");
    const html = baseTemplate(`
      <h2>${subject}</h2>
      ${paragraphs}
      <p style="font-size:.78rem;color:#9aa6b9;margin-top:1.5rem;line-height:1.6">
        Des questions ? <a href="mailto:contact@fredapay.com" style="color:#ef366e">contact@fredapay.com</a>
      </p>
    `, subject);
    return this.send({ to, toName, subject, html, tags: ["admin-message"] });
  },

  // ── Test connexion Brevo ──────────────────────────────────────
  async testConnection(): Promise<boolean> {
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) {
      logger.warn("⚠ BREVO_API_KEY manquant — emails désactivés");
      return false;
    }
    try {
      const res = await fetch("https://api.brevo.com/v3/account", {
        headers: { "api-key": apiKey, "accept": "application/json" },
      });
      if (res.ok) {
        const d = await res.json() as { email?: string; plan?: Array<{ type: string }> };
        logger.info("✅ Brevo connecté", { account: d.email, plan: d.plan?.[0]?.type });
        return true;
      }
      logger.warn("⚠ Brevo auth échoué", { status: res.status });
      return false;
    } catch (err) {
      logger.warn("⚠ Brevo non disponible", { error: err instanceof Error ? err.message : err });
      return false;
    }
  },
};
