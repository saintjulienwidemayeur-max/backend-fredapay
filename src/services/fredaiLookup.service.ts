// ============================================================
// fredaiLookup — Fred'AI CHÈCHE enfo a AVAN li reponn
// ============================================================
// ⚠️ POUKISA:
// Kontèks la (`fredaiContext.service.ts`) bay yon PHOTO jeneral: 8 dènye
// tranzaksyon, kat yo, balans. Sa sifi pou 80% kesyon. Men pou yon kesyon
// presi — "konbyen mwen depanse mwa pase?", "montre m tranzaksyon
// @widem22 yo", "ki detay tranzaksyon TXN-123 la?" — enfo a PA nan foto a.
// Anvan, Fred'AI te REPONN KANMENM, ak sa l te "sonje" → li te envante.
//
// Kounye a li ka MANDE done a:
//   Pas 1 → modèl la emèt __LOOKUP__{"lookup":"...","params":{...}}__END__
//   Nou chèche nan DB a
//   Pas 2 → nou re-mande modèl la ak REZILTA a, epi li reponn
//
// Règ: MAKS 1 pas rechèch (evite boukle san fen ak latans ki monte).
import { db } from "../db/store";
import { logger } from "../utils/logger";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export interface LookupCall { lookup: string; params: Record<string, any>; }

/** Detekte yon demann rechèch nan repons modèl la. */
export function parseLookup(text: string): { clean: string; call: LookupCall | null } {
  const m = text.match(/__LOOKUP__\s*(\{[\s\S]*?\})\s*__END__/);
  if (!m) return { clean: text, call: null };
  try {
    const call = JSON.parse(m[1]) as LookupCall;
    return { clean: text.replace(m[0], "").trim(), call };
  } catch {
    return { clean: text.replace(m[0], "").trim(), call: null };
  }
}

/**
 * Egzekite yon rechèch. Retounen yon tèks lizib pou modèl la.
 *
 * ⚠️ SEKIRITE: CHAK rechèch filtre pa `userId`. Modèl la PA ka mande done
 * yon lòt moun — menm si li eseye pase yon lòt ID nan `params`, nou pa
 * janm itilize l.
 */
export async function runLookup(userId: string, call: LookupCall): Promise<string> {
  try {
    switch (call.lookup) {
      // ── Tranzaksyon ak yon moun espesifik ────────────────
      case "transactions_with": {
        const tag  = String(call.params?.tag || "").replace("@", "").toLowerCase();
        const all  = await db.ledger.findByUserId(userId, 200);
        const hits = (all as any[]).filter((t) =>
          String(t.to_freda_tag || "").toLowerCase() === tag ||
          String(t.from_freda_tag || "").toLowerCase() === tag
        );
        if (!hits.length) return `Aucune transaction avec @${tag}.`;
        const total = hits.reduce((s, t) => s + (t.gross_amount || 0), 0);
        return [
          `${hits.length} transaction(s) avec @${tag}, total ${money(total)}:`,
          ...hits.slice(0, 15).map((t) =>
            `- ${String(t.created_at).slice(0, 10)} | ${t.type} | ${t.direction === "credit" ? "+" : "-"}${money(t.gross_amount || 0)} | ${t.status}`),
        ].join("\n");
      }

      // ── Rezime yon peryòd ────────────────────────────────
      case "spending_summary": {
        const days = Math.min(Number(call.params?.days) || 30, 365);
        const since = Date.now() - days * 86_400_000;
        const all = await db.ledger.findByUserId(userId, 500);
        const inRange = (all as any[]).filter((t) => new Date(t.created_at).getTime() >= since);
        const out = inRange.filter((t) => t.direction === "debit");
        const inc = inRange.filter((t) => t.direction === "credit");
        const sum = (arr: any[]) => arr.reduce((s, t) => s + (t.gross_amount || 0), 0);
        // Group pa tip pou yon repons ki gen sans
        const byType: Record<string, number> = {};
        for (const t of out) byType[t.type] = (byType[t.type] || 0) + (t.gross_amount || 0);
        return [
          `Sur ${days} jours:`,
          `- Sorties: ${money(sum(out))} (${out.length} txn)`,
          `- Entrées: ${money(sum(inc))} (${inc.length} txn)`,
          `- Détail sorties: ${Object.entries(byType).map(([k, v]) => `${k}=${money(v)}`).join(", ") || "aucune"}`,
        ].join("\n");
      }

      // ── Detay yon tranzaksyon ────────────────────────────
      case "transaction_detail": {
        const id  = String(call.params?.txnId || "");
        const txn = await db.ledger.findByTxnId(id) as any;
        // ⚠️ Verifye pwopriyetè a — yon ID pa ase pou bay aksè.
        if (!txn || txn.user_id !== userId) return `Transaction ${id} introuvable.`;
        return [
          `Transaction ${id}:`,
          `- Type: ${txn.type} | Statut: ${txn.status} | Sens: ${txn.direction}`,
          `- Montant: ${money(txn.gross_amount || 0)} | Frais: ${money(txn.fee_amount || 0)} | Net: ${money(txn.net_amount || 0)}`,
          `- Date: ${txn.created_at}`,
          `- Description: ${txn.description || "—"}`,
          txn.failure_reason ? `- Échec: ${txn.failure_reason}` : "",
        ].filter(Boolean).join("\n");
      }

      // ── Tranzaksyon yon kat ──────────────────────────────
      case "card_transactions": {
        const last4 = String(call.params?.last4 || "");
        const user  = await db.users.findById(userId);
        const cards = user?.email ? await db.cards.findByEmail(user.email) as any[] : [];
        const card  = cards.find((c) => String(c.masked_pan || "").endsWith(last4));
        if (!card) return `Aucune carte se terminant par ${last4}.`;
        const all  = await db.ledger.findByUserId(userId, 200);
        const hits = (all as any[]).filter((t) => t.card_id === card.cardid || t.card_id === card.maplerad_card_id);
        if (!hits.length) return `Aucune transaction sur la carte ····${last4}.`;
        return [
          `${hits.length} transaction(s) sur ····${last4}:`,
          ...hits.slice(0, 15).map((t) =>
            `- ${String(t.created_at).slice(0, 10)} | ${t.type} | ${money(t.gross_amount || 0)} | ${t.status}`),
        ].join("\n");
      }

      // ── Plis tranzaksyon ─────────────────────────────────
      case "more_transactions": {
        const limit = Math.min(Number(call.params?.limit) || 30, 100);
        const all = await db.ledger.findByUserId(userId, limit);
        if (!all.length) return "Aucune transaction.";
        return (all as any[]).map((t) =>
          `- ${String(t.created_at).slice(0, 10)} | ${t.type} | ${t.direction === "credit" ? "+" : "-"}${money(t.gross_amount || 0)} | ${t.status} | ${t.description || ""}`
        ).join("\n");
      }

      default:
        return `Recherche inconnue: ${call.lookup}`;
    }
  } catch (e: any) {
    logger.warn("Fred'AI lookup echwe", { userId, lookup: call.lookup, error: e?.message });
    // ⚠️ Nou di modèl la KLÈMAN ke rechèch la echwe — konsa li di moun nan
    // li pa ka jwenn enfo a, olye li envante yon repons.
    return `ERREUR: la recherche a échoué. Dis à l'utilisateur que tu n'as pas pu récupérer cette information — n'invente rien.`;
  }
}
