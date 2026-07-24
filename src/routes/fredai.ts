// ============================================================
// Fred'AI Route — DeepSeek + Groq Whisper STT
// ============================================================

import { Router, Request, Response } from "express";
import { requireAuth } from "../middleware/auth";
import { db } from "../db/store";
import { getSupabase } from "../db/supabase";
import { WalletService } from "../services/wallet.service";
import { MapleradCardService } from "../services/maplerad.service";
import { resolveMapleradCardId } from "./maplerad";
import { guardCardTransaction } from "../services/cardTxnGuard.service";
import { CardFeesService } from "../services/cardFees.service";
import { logger } from "../utils/logger";
import { FREDAPAY_INFO } from "../data/fredapay-info";
import { buildFredaiContext, USD_HTG_RATE as CTX_RATE } from "../services/fredaiContext.service";
import { parseLookup, runLookup } from "../services/fredaiLookup.service";

const router = Router();

// ── DeepSeek + Groq config ────────────────────────────────────
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || "sk-b7396345efc442faa2944435225c50b1";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const GROQ_KEY     = process.env.GROQ_API_KEY || "";
const GROQ_STT_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const USD_HTG_RATE = 132.5;

// ── Helper: sove yon mesaj nan DB ────────────────────────────
async function saveMessage(userId: string, role: "user" | "assistant", content: string, tokensUsed = 0) {
  try {
    await getSupabase().from("fredai_conversations").insert({
      user_id:     userId,
      role,
      content:     content.slice(0, 10000), // max 10k chars
      tokens_used: tokensUsed,
      created_at:  new Date().toISOString(),
    });
  } catch (e) {
    logger.warn("Fred'AI: échec sauvegarde message", { userId, role, error: (e as any).message });
  }
}

// ── Helper: charger historique depuis DB ──────────────────────
async function loadHistory(userId: string, limit = 20): Promise<{ role: string; parts: { text: string }[] }[]> {
  try {
    const { data } = await getSupabase()
      .from("fredai_conversations")
      .select("role, content")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (!data || data.length === 0) return [];

    // Renverser pour ordre chronologique + formater pour Gemini
    return data.reverse().map((row: any) => ({
      role:  row.role === "assistant" ? "model" : "user",
      parts: [{ text: row.content }],
    }));
  } catch (e) {
    logger.warn("Fred'AI: échec chargement historique", { userId });
    return [];
  }
}

// ── POST /api/fredai/transcribe ──────────────────────────────
// Resevwa odyo blob → Groq Whisper → retounen tèks
// Fonksyone nan TOUT navigatè (pa bezwen SpeechRecognition)
router.post("/transcribe", requireAuth, async (req: Request, res: Response) => {
  if (!GROQ_KEY) {
    res.status(503).json({ error: "Groq API key manke. Mete GROQ_API_KEY nan .env" });
    return;
  }
  try {
    // req.body.audio = base64 string (webm/mp4/ogg/wav)
    const { audio, mimeType = "audio/webm", language } = req.body;
    if (!audio) { res.status(400).json({ error: "audio base64 requis" }); return; }

    // Konvèti base64 → Buffer → FormData
    const buf  = Buffer.from(audio.replace(/^data:[^;]+;base64,/, ""), "base64");
    const ext  = mimeType.includes("mp4") ? "mp4" : mimeType.includes("ogg") ? "ogg"
               : mimeType.includes("wav") ? "wav" : "webm";

    // FormData pou Groq (multipart/form-data)
    const FormData = (await import("form-data")).default;
    const form = new FormData();
    form.append("file", buf, { filename: `audio.${ext}`, contentType: mimeType });
    form.append("model",  "whisper-large-v3-turbo");
    form.append("response_format", "json");
    if (language) form.append("language", language);  // ex: "fr", "ht", "en"

    // @ts-ignore — fetch avec FormData headers
    const groqRes = await fetch(GROQ_STT_URL, {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_KEY}`,
        ...form.getHeaders(),
      },
      body: form,
    });

    if (!groqRes.ok) {
      const err = await groqRes.text();
      logger.error("Groq STT erreur", { status: groqRes.status, err });
      res.status(502).json({ error: `Groq erreur ${groqRes.status}`, detail: err });
      return;
    }

    const data = await groqRes.json() as any;
    const text = data.text?.trim() || "";
    logger.info("Groq STT OK", { chars: text.length });
    res.json({ success: true, text });

  } catch (e: any) {
    logger.error("Transcription erreur", { error: e.message });
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/fredai/chat ─────────────────────────────────────
router.post("/chat", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;

  // Vérifier + incrémenter limite messages Fred'AI du plan
  const canChat = await db.subscriptions.incrementFredaiMessages(userId);
  if (!canChat) {
    res.status(429).json({
      error: "Limite de messages Fred'AI atteinte pour ce mois. Passez au plan Pro ou Standard pour un accès illimité.",
      code:  "FREDAI_LIMIT_REACHED",
    });
    return;
  }

  const { message, history: clientHistory = [] } = req.body;
  if (!message?.trim()) {
    res.status(400).json({ error: "Message requis" });
    return;
  }

  try {
    // ✅ v45: KONTÈKS KONPLÈ apati DB a — wè `fredaiContext.service.ts`.
    // Ansyen prompt lan te gen SÈLMAN non+tag+balans+KYC, se poutèt sa
    // Fred'AI t ap envante tout rès la (frè, dat, kat, abònman...).
    const [ctx, dbHistory] = await Promise.all([
      buildFredaiContext(userId),
      loadHistory(userId, 10),
    ]);
    const systemPrompt = ctx.prompt;
    const balance    = (ctx.facts.balanceCents / 100).toFixed(2);
    const balanceHTG = ((ctx.facts.balanceCents / 100) * USD_HTG_RATE).toFixed(0);

    const contents = [
      ...(dbHistory.length > 0 ? dbHistory : (clientHistory as any[]).slice(-6)),
      { role: "user", parts: [{ text: message }] },
    ];

    // ── Appel DeepSeek ────────────────────────────────────────
    // Konvèti format Gemini → format OpenAI (DeepSeek)
    const dsMessages = [
      { role: "system", content: systemPrompt },
      ...contents.map((c: any) => ({
        role:    c.role === "model" ? "assistant" : "user",
        content: c.parts?.[0]?.text ?? "",
      })),
    ];

    const callDeepSeek = async (msgs: any[]) => {
      // @ts-ignore — fetch disponib Node 18+
      const r = await fetch(DEEPSEEK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${DEEPSEEK_KEY}` },
        body: JSON.stringify({
          model: "deepseek-chat", messages: msgs,
          max_tokens: 400, temperature: 0.6, stream: false,
        }),
      });
      if (!r.ok) throw new Error(`DeepSeek error ${r.status}: ${await r.text()}`);
      return await r.json() as any;
    };

    let dsData = await callDeepSeek(dsMessages);
    let aiText = dsData?.choices?.[0]?.message?.content
      || "Désolé, je n'ai pas pu traiter votre demande. Réessayez ou contactez contact@fredapay.com.";
    let tokensUsed = dsData?.usage?.total_tokens || 0;

    // ══════════════════════════════════════════════════════════
    // ✅ NOUVO v106 — PAS RECHÈCH: Fred'AI CHÈCHE avan li reponn
    // ══════════════════════════════════════════════════════════
    // Si modèl la mande yon done ki PA nan foto kontèks la (yon tranzaksyon
    // presi, yon rezime peryòd, tranzaksyon yon kat...), li emèt yon blòk
    // __LOOKUP__. Nou chèche VRÈMAN nan DB a, epi nou re-mande l ak rezilta
    // a. Konsa li reponn ak DONE REYÈL — li pa devine.
    //
    // MAKS 1 pas: evite boukle san fen e kenbe latans rezonab.
    const { clean, call } = parseLookup(aiText);
    if (call) {
      logger.info("Fred'AI rechèch", { userId, lookup: call.lookup });
      const result = await runLookup(userId, call);
      dsData = await callDeepSeek([
        ...dsMessages,
        { role: "assistant", content: clean || "(recherche)" },
        {
          role: "user",
          content: `RÉSULTAT DE TA RECHERCHE (données réelles de la base) :\n${result}\n\n`
            + `Réponds maintenant à ma question en utilisant UNIQUEMENT ces données. `
            + `N'émets PAS un autre __LOOKUP__.`,
        },
      ]);
      aiText = dsData?.choices?.[0]?.message?.content || clean
        || "Je n'ai pas pu récupérer cette information.";
      tokensUsed += dsData?.usage?.total_tokens || 0;
      // Sekirite: si l re-emèt yon __LOOKUP__ kanmenm, nou jis retire l.
      aiText = parseLookup(aiText).clean;
    }

    // Détection action transfert JSON
    let transferAction = null;
    try {
      const jsonMatch = aiText.match(/\{[^}]*"action"\s*:\s*"send"[^}]*\}/);
      if (jsonMatch) {
        transferAction = JSON.parse(jsonMatch[0]);
        aiText = aiText.replace(jsonMatch[0], "").trim();
      }
    } catch { /* pas un JSON valide */ }

    // ── Sove les 2 messages dans DB ──────────────────────────
    await Promise.all([
      saveMessage(userId, "user",      message, 0),
      saveMessage(userId, "assistant", aiText,  tokensUsed),
    ]);

    res.json({
      success:  true,
      reply:    aiText,
      action:   transferAction,
      context:  { balance, balanceHTG, usdHtgRate: USD_HTG_RATE },
    });

  } catch (e: any) {
    logger.error("Fred'AI chat error", { error: e.message });
    res.status(500).json({ error: "Fred'AI indisponible momentanément. Réessayez dans quelques instants." });
  }
});

// ── GET /api/fredai/history ───────────────────────────────────
// Charger l'historique des conversations depuis DB
router.get("/history", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  const limit  = Math.min(parseInt(String(req.query.limit || "50")), 200);
  try {
    const history = await loadHistory(userId, limit);
    res.json({ success: true, data: { messages: history, count: history.length } });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/fredai/history ────────────────────────────────
// Effacer l'historique du client (GDPR)
router.delete("/history", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  try {
    await getSupabase().from("fredai_conversations").delete().eq("user_id", userId);
    res.json({ success: true, message: "Historique effacé" });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/fredai/execute ──────────────────────────────────
// ── POST /api/fredai/execute ──────────────────────────────────
// Exécute une action confirmée (transfert, etc.)
router.post("/execute", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  const { action, tool, params } = req.body;

  // ✅ v45: sipòte TOU DE fòma — ansyen `{action:{type:"send",...}}` (kliyan
  // ki poko ajou) ak nouvo `{tool, params}`.
  const toolName: string = tool || (action?.type === "send" ? "send_money" : action?.type);
  const p: Record<string, any> = params || action || {};

  if (!toolName) { res.status(400).json({ error: "Action requise" }); return; }

  try {
    // ── Rezoud yon kat pa 4 dènye chif li ────────────────────
    // ⚠️ SEKIRITE: nou chèche SÈLMAN nan kat MOUN NAN. Yon `last4` ki soti
    // nan AI a pa janm fè konfyans — nou verifye l kont DB a.
    const resolveCard = async (last4: string) => {
      const u = await db.users.findById(userId);
      if (!u?.email) throw new Error("Utilisateur introuvable");
      const cards = await db.cards.findByEmail(u.email) as any[];
      const matches = cards.filter((c) => String(c.masked_pan || "").endsWith(String(last4)));
      if (matches.length === 0) throw new Error(`Aucune carte se terminant par ${last4}`);
      // Si 2 kat fini menm jan, nou PA devine — nou mande presizyon.
      if (matches.length > 1) throw new Error(`Plusieurs cartes se terminent par ${last4}. Précisez laquelle.`);
      return matches[0];
    };

    switch (toolName) {
      // ── VOYE LAJAN ────────────────────────────────────────
      case "send_money": {
        const to     = String(p.to || "").replace("@", "").trim();
        const amount = parseFloat(String(p.amount));
        if (!to || !Number.isFinite(amount) || amount <= 0) {
          res.status(400).json({ error: "Destinataire ou montant invalide" }); return;
        }
        const recipient = await db.users.findByFredaTag(to);
        if (!recipient) { res.status(404).json({ error: `Utilisateur @${to} introuvable` }); return; }

        await WalletService.sendMoney(userId, {
          toFredaTag: recipient.FredaTag,
          amount,
          note: p.note || "Transfert via Fred'AI",
          type: "send",
        } as any);
        res.json({ success: true, message: `$${amount.toFixed(2)} envoyé à @${recipient.FredaTag} avec succès !` });
        return;
      }

      // ── METE LAJAN SOU YON KAT ────────────────────────────
      case "fund_card": {
        const amount = parseFloat(String(p.amount));
        if (!Number.isFinite(amount) || amount <= 0) { res.status(400).json({ error: "Montant invalide" }); return; }
        const card = await resolveCard(p.last4);
        const amountCents = Math.round(amount * 100);
        // ✅ FIX KRITIK v106: `card.cardid` se referans LOKAL nou an. Nou DWE
        // rezoud VRÈ ID Maplerad la — sinon (a) apèl Maplerad la echwe, e
        // (b) webhook la pa ka matche antre ledger la, donk estati a rete
        // "En attente" pou tout tan. MENM fonksyon EGZAK ak wout `fund` la.
        const realId = await resolveMapleradCardId(String(card.cardid));

        // ✅ v66.1 — MENM règ ak wout `fund` la: pri a depann si kat la
        // tokenize. San sa, yon rechaj fèt pa Fred'AI sou yon kat
        // tokenize ta peye pri kat klasik la (Freda Pay ta pèdi frè a).
        const localCardAI  = await db.cards.findByCardId(String(card.cardid));
        const isTokenizedAI = (localCardAI as any)?.is_tokenized === true;

        // ✅ FIX KRITIK v106: Fred'AI te SOTE FRÈ RECHAJMAN KAT la nèt.
        // Wout `POST /cards/:id/fund` la kalkile `CardFeesService
        // .cardReloadFee(amountCents)` (card_reload_tier1/tier2 nan DB a) e
        // li ajoute l nan total la. Fred'AI te rele guard la ak SÈLMAN
        // `amountCents` — donk yon rechajman fèt pa Fred'AI pa t peye frè
        // rechaj la ditou. Freda Pay t ap pèdi frè a chak fwa. Kounye a
        // MENM kalkil EGZAK la, ak MENM validasyon rang lan.
        let reloadFeeCents: number;
        try {
          reloadFeeCents = await CardFeesService.cardReloadFee(amountCents, isTokenizedAI);
        } catch (feeErr: any) {
          if (String(feeErr.message).includes("CARD_RELOAD_AMOUNT_OUT_OF_RANGE")) {
            res.status(400).json({ error: "Montant de rechargement invalide. Le montant doit être entre $1.00 et $500.00.", code: "AMOUNT_OUT_OF_RANGE" });
            return;
          }
          throw feeErr;
        }

        // ✅ Nou pase pa MENM guard ak wout `fund` la — frè Freda Pay,
        // penalite NSF, debi anvan Maplerad, ranbousman si l echwe. Fred'AI
        // PA gen yon chemen apa ki ta sote pwoteksyon sa yo.
        const guard = await guardCardTransaction(userId, amountCents + reloadFeeCents, {
          cardId: realId, type: "card_fund", description: "Rechargement via Fred'AI",
        });
        if (!guard.ok) { res.status(guard.httpStatus).json(guard.body); return; }
        try {
          await MapleradCardService.fundCard(realId, amountCents);
        } catch (e: any) {
          await guard.refund(e?.message || "MAPLERAD_FUND_FAILED");
          throw e;
        }
        await guard.commit({
          grossCents: amountCents,
          feeCents: reloadFeeCents + guard.feeCents,
          description: "Rechargement via Fred'AI",
        });
        const totalTxt = ((amountCents + reloadFeeCents + guard.feeCents) / 100).toFixed(2);
        res.json({
          success: true,
          message: `$${amount.toFixed(2)} ajouté à la carte ····${p.last4} (total débité : $${totalTxt}, frais inclus). Confirmation en cours...`,
        });
        return;
      }

      // ── JLE / DEJLE / SIPRIME KAT ─────────────────────────
      case "freeze_card": {
        const card = await resolveCard(p.last4);
        // ✅ v106: VRÈ ID Maplerad pou apèl la; referans LOKAL pou DB nou an.
        await MapleradCardService.freezeCard(await resolveMapleradCardId(String(card.cardid)));
        await db.cards.updateStatus(String(card.cardid), "blocked");
        res.json({ success: true, message: `Carte ····${p.last4} gelée. Tu peux la dégeler quand tu veux.` });
        return;
      }
      case "unfreeze_card": {
        const card = await resolveCard(p.last4);
        await MapleradCardService.unfreezeCard(await resolveMapleradCardId(String(card.cardid)));
        await db.cards.updateStatus(String(card.cardid), "active");
        res.json({ success: true, message: `Carte ····${p.last4} réactivée.` });
        return;
      }
      case "delete_card": {
        const card = await resolveCard(p.last4);
        await MapleradCardService.terminateCard(await resolveMapleradCardId(String(card.cardid)));
        await db.cards.updateStatus(String(card.cardid), "terminated");
        res.json({ success: true, message: `Carte ····${p.last4} supprimée définitivement. Tout solde restant sera crédité à ton wallet.` });
        return;
      }

      // ── TÈM ───────────────────────────────────────────────
      case "change_theme": {
        const theme = String(p.theme || "").toLowerCase();
        if (!["light", "dark", "pink", "midnight"].includes(theme)) {
          res.status(400).json({ error: "Thème invalide (light, dark, pink, midnight)" }); return;
        }
        // Tèm nan se yon preferans KLIYAN (AsyncStorage/localStorage) — pa gen
        // kolòn pou li nan DB a. Nou retounen l pou app la aplike l.
        res.json({ success: true, message: `Thème changé en ${theme}.`, applyClient: { theme } });
        return;
      }

      // ── ABÒNMAN ───────────────────────────────────────────
      case "change_subscription": {
        const plan = String(p.plan || "").toLowerCase();
        if (!["startup", "pro", "standard"].includes(plan)) {
          res.status(400).json({ error: "Plan invalide (startup, pro, standard)" }); return;
        }
        await db.subscriptions.choosePlan(userId, plan as any);
        res.json({ success: true, message: `Abonnement changé pour le plan ${plan}.` });
        return;
      }

      default:
        res.status(400).json({ error: `Action non supportée: ${toolName}` });
        return;
    }
  } catch (e: any) {
    logger.error("Fred'AI execute erreur", { userId, toolName, message: e?.message });
    res.status(500).json({ error: e.message || "Erreur exécution" });
  }
});

// ── GET /api/fredai/info ──────────────────────────────────────
// Retourne les infos officielles Freda Pay (frais, conditions, etc.)
router.get("/info", requireAuth, (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      fees:      FREDAPAY_INFO.fees,
      services:  FREDAPAY_INFO.services,
      company:   FREDAPAY_INFO.company,
      links: {
        terms:   FREDAPAY_INFO.termsOfService.url,
        privacy: FREDAPAY_INFO.privacyPolicy.url,
        fees:    "https://fredapay.com/frais",
        site:    "https://fredapay.com",
      },
    },
  });
});

export default router;
