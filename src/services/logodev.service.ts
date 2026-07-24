// ============================================================
// LogoDev Service — Jwenn logo komèsan via domain
// Docs: https://www.logo.dev/docs/introduction
// Publishable key: pou URL imaj (frontend-safe)
// Secret key: pou Search API (backend sèlman)
// ============================================================

import { logger } from "../utils/logger";

const SK  = process.env.LOGODEV_SECRET_KEY || "sk_aqPEpY3kQp--bhHYKokgXw";
const PK  = process.env.LOGODEV_PUBLIC_KEY || "pk_PNFxvrJwQWWyuYrO1NYDGQ";
const BASE = "https://api.logo.dev";

// Cache 24h — evite repeat API calls pou menm komèsan
const cache = new Map<string, { domain: string; logoUrl: string; ts: number }>();
const TTL = 24 * 60 * 60 * 1000;

// ── Mèt domain depi non komèsan ──────────────────────────────
// ex: "NETFLIX.COM *123" → "netflix.com"
// ex: "AMAZON PRIME VIDEO" → null (chèche via API)
function extractDomain(merchantStr: string): string | null {
  if (!merchantStr) return null;

  // Domèn dirèk nan non (ex: "NETFLIX.COM *123")
  const domainMatch = merchantStr.match(/([a-zA-Z0-9-]+\.(com|net|org|io|app|co|fr|ht|us|uk|ca))/i);
  if (domainMatch) return domainMatch[1].toLowerCase();

  // Konèsans komen — map non → domèn
  const KNOWN: Record<string, string> = {
    "amazon":      "amazon.com",
    "netflix":     "netflix.com",
    "spotify":     "spotify.com",
    "apple":       "apple.com",
    "google":      "google.com",
    "microsoft":   "microsoft.com",
    "facebook":    "facebook.com",
    "meta":        "meta.com",
    "instagram":   "instagram.com",
    "uber":        "uber.com",
    "airbnb":      "airbnb.com",
    "paypal":      "paypal.com",
    "shopify":     "shopify.com",
    "stripe":      "stripe.com",
    "slack":       "slack.com",
    "zoom":        "zoom.us",
    "dropbox":     "dropbox.com",
    "github":      "github.com",
    "canva":       "canva.com",
    "notion":      "notion.so",
    "openai":      "openai.com",
    "chatgpt":     "openai.com",
    "anthropic":   "anthropic.com",
    "digitalocean":"digitalocean.com",
    "netlify":     "netlify.com",
    "vercel":      "vercel.com",
    "cloudflare":  "cloudflare.com",
    "godaddy":     "godaddy.com",
    "namecheap":   "namecheap.com",
    "aliexpress":  "aliexpress.com",
    "alibaba":     "alibaba.com",
    "temu":        "temu.com",
    "shein":       "shein.com",
    "wish":        "wish.com",
    "ebay":        "ebay.com",
    "etsy":        "etsy.com",
    "digicel":     "digicel.com",
    "natcom":      "natcom.com.ht",
  };

  const key = merchantStr.toLowerCase().trim().split(/\s+/)[0];
  if (KNOWN[key]) return KNOWN[key];

  // Essaie le premier mot comme domèn .com
  const word = merchantStr.replace(/[^a-zA-Z]/g, "").toLowerCase();
  if (word.length > 3) return `${word}.com`;

  return null;
}

// ── Chèche domèn via Logo.dev Search API ─────────────────────
async function searchDomain(query: string): Promise<string | null> {
  const cacheKey = `search:${query.toLowerCase()}`;
  const cached   = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < TTL) return cached.domain;

  try {
    // @ts-ignore — fetch Node 18+
    const res = await fetch(
      `${BASE}/search?q=${encodeURIComponent(query)}&limit=1`,
      { headers: { "Authorization": `Bearer ${SK}` } }
    );
    if (!res.ok) return null;
    const data = await res.json() as any[];
    if (!data?.length) return null;
    const domain = data[0]?.domain;
    if (domain) {
      cache.set(cacheKey, { domain, logoUrl: buildLogoUrl(domain), ts: Date.now() });
      return domain;
    }
  } catch (e) {
    logger.warn("Logo.dev search error", { query, error: (e as any).message });
  }
  return null;
}

// ── Konstrwi URL logo piblik ──────────────────────────────────
export function buildLogoUrl(domain: string, size = 64): string {
  return `https://img.logo.dev/${domain}?token=${PK}&size=${size}&format=webp`;
}

// ── Jwenn logo URL pou yon komèsan ────────────────────────────
// Entry point prensipal la
export async function getMerchantLogo(merchantName: string): Promise<{
  domain:  string | null;
  logoUrl: string | null;
  name:    string;
}> {
  if (!merchantName?.trim()) return { domain: null, logoUrl: null, name: merchantName };

  const clean = merchantName.trim();
  const cacheKey = clean.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < TTL) {
    return { domain: cached.domain, logoUrl: cached.logoUrl, name: clean };
  }

  // 1. Esèye ekstrak domèn dirèkteman
  let domain = extractDomain(clean);

  // 2. Si pa jwenn → chèche via Logo.dev Search API
  if (!domain) {
    domain = await searchDomain(clean);
  }

  const logoUrl = domain ? buildLogoUrl(domain) : null;

  if (domain && logoUrl) {
    cache.set(cacheKey, { domain, logoUrl, ts: Date.now() });
    logger.info("Logo.dev: merchant logo found", { merchantName: clean, domain });
  }

  return { domain, logoUrl, name: clean };
}

export const LogoDevService = { getMerchantLogo, buildLogoUrl, searchDomain };
