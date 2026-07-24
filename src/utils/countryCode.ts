// ============================================================
// Normalizasyon kòd peyi — ISO 3166-1 alpha-2
// ============================================================
// ✅ FIX: Maplerad egzije yon kòd peyi 2 lèt (ex: "HT", "NG").
// Men fòm enskripsyon an (Register.tsx) sove NON konplè peyi a (ex: "Haïti")
// nan users.country, pa kòd la. Lè valè sa a te voye dirèkteman bay Maplerad,
// li rejte demand lan: "Field validation for 'Country' failed on the
// 'iso3166_1_alpha2' tag". Fonksyon sa a konvèti non peyi yo (menm lis ak
// frontend `src/data/countryCodes.ts`) an kòd ISO 2-lèt anvan nou rele Maplerad.

const NAME_TO_CODE: Record<string, string> = {
  "AFGHANISTAN": "AF", "AFRIQUE DU SUD": "ZA", "ALBANIE": "AL", "ALGERIE": "DZ", "ALGÉRIE": "DZ",
  "ALLEMAGNE": "DE", "ANGOLA": "AO", "ARABIE SAOUDITE": "SA", "ARGENTINE": "AR", "AUSTRALIE": "AU",
  "AUTRICHE": "AT", "AZERBAIDJAN": "AZ", "AZERBAÏDJAN": "AZ", "BAHAMAS": "BS", "BAHREIN": "BH",
  "BAHREÏN": "BH", "BANGLADESH": "BD", "BELGIQUE": "BE", "BENIN": "BJ", "BÉNIN": "BJ",
  "BIELORUSSIE": "BY", "BIÉLORUSSIE": "BY", "BOLIVIE": "BO", "BOSNIE-HERZEGOVINE": "BA",
  "BOSNIE-HERZÉGOVINE": "BA", "BOTSWANA": "BW", "BRESIL": "BR", "BRÉSIL": "BR", "BULGARIE": "BG",
  "BURKINA FASO": "BF", "BURUNDI": "BI", "CAMBODGE": "KH", "CAMEROUN": "CM", "CANADA": "CA",
  "CAP-VERT": "CV", "CHILI": "CL", "CHINE": "CN", "CHYPRE": "CY", "COLOMBIE": "CO", "COMORES": "KM",
  "CONGO (BRAZZAVILLE)": "CG", "CONGO (RDC)": "CD", "COREE DU SUD": "KR", "CORÉE DU SUD": "KR",
  "COSTA RICA": "CR", "COTE D'IVOIRE": "CI", "CÔTE D'IVOIRE": "CI", "CROATIE": "HR", "CUBA": "CU",
  "DANEMARK": "DK", "DJIBOUTI": "DJ", "EGYPTE": "EG", "ÉGYPTE": "EG", "EMIRATS ARABES UNIS": "AE",
  "ÉMIRATS ARABES UNIS": "AE", "EQUATEUR": "EC", "ÉQUATEUR": "EC", "ESPAGNE": "ES", "ESTONIE": "EE",
  "ETATS-UNIS": "US", "ÉTATS-UNIS": "US", "ETHIOPIE": "ET", "ÉTHIOPIE": "ET", "FIDJI": "FJ",
  "FINLANDE": "FI", "FRANCE": "FR", "GABON": "GA", "GAMBIE": "GM", "GHANA": "GH", "GRECE": "GR",
  "GRÈCE": "GR", "GUATEMALA": "GT", "GUINEE": "GN", "GUINÉE": "GN", "GUINEE EQUATORIALE": "GQ",
  "GUINÉE ÉQUATORIALE": "GQ", "GUINEE-BISSAU": "GW", "GUINÉE-BISSAU": "GW", "HAITI": "HT",
  "HAÏTI": "HT", "HONDURAS": "HN", "HONGRIE": "HU", "INDE": "IN", "INDONESIE": "ID",
  "INDONÉSIE": "ID", "IRAK": "IQ", "IRAN": "IR", "IRLANDE": "IE", "ISLANDE": "IS", "ISRAEL": "IL",
  "ISRAËL": "IL", "ITALIE": "IT", "JAMAIQUE": "JM", "JAMAÏQUE": "JM", "JAPON": "JP",
  "JORDANIE": "JO", "KAZAKHSTAN": "KZ", "KENYA": "KE", "KOWEIT": "KW", "KOWEÏT": "KW", "LAOS": "LA",
  "LIBAN": "LB", "LIBERIA": "LR", "LIBYE": "LY", "LITUANIE": "LT", "LUXEMBOURG": "LU",
  "MADAGASCAR": "MG", "MALAISIE": "MY", "MALAWI": "MW", "MALI": "ML", "MALTE": "MT", "MAROC": "MA",
  "MAURICE": "MU", "MAURITANIE": "MR", "MEXIQUE": "MX", "MOLDAVIE": "MD", "MONACO": "MC",
  "MONGOLIE": "MN", "MONTENEGRO": "ME", "MONTÉNÉGRO": "ME", "MOZAMBIQUE": "MZ", "NAMIBIE": "NA",
  "NEPAL": "NP", "NÉPAL": "NP", "NICARAGUA": "NI", "NIGER": "NE", "NIGERIA": "NG", "NORVEGE": "NO",
  "NORVÈGE": "NO", "NOUVELLE-ZELANDE": "NZ", "NOUVELLE-ZÉLANDE": "NZ", "OMAN": "OM",
  "OUGANDA": "UG", "OUZBEKISTAN": "UZ", "OUZBÉKISTAN": "UZ", "PAKISTAN": "PK", "PALESTINE": "PS",
  "PANAMA": "PA", "PARAGUAY": "PY", "PAYS-BAS": "NL", "PEROU": "PE", "PÉROU": "PE",
  "PHILIPPINES": "PH", "POLOGNE": "PL", "PORTUGAL": "PT", "QATAR": "QA",
  "REPUBLIQUE CENTRAFRICAINE": "CF", "RÉPUBLIQUE CENTRAFRICAINE": "CF",
  "REPUBLIQUE DOMINICAINE": "DO", "RÉPUBLIQUE DOMINICAINE": "DO", "REPUBLIQUE TCHEQUE": "CZ",
  "RÉPUBLIQUE TCHÈQUE": "CZ", "ROUMANIE": "RO", "ROYAUME-UNI": "GB", "RUSSIE": "RU",
  "RWANDA": "RW", "SALVADOR": "SV", "SENEGAL": "SN", "SÉNÉGAL": "SN", "SERBIE": "RS",
  "SIERRA LEONE": "SL", "SINGAPOUR": "SG", "SLOVAQUIE": "SK", "SLOVENIE": "SI", "SLOVÉNIE": "SI",
  "SOMALIE": "SO", "SOUDAN": "SD", "SRI LANKA": "LK", "SUEDE": "SE", "SUÈDE": "SE", "SUISSE": "CH",
  "TANZANIE": "TZ", "TCHAD": "TD", "THAILANDE": "TH", "THAÏLANDE": "TH", "TOGO": "TG",
  "TUNISIE": "TN", "TURQUIE": "TR", "UKRAINE": "UA", "URUGUAY": "UY", "VENEZUELA": "VE",
  "VIETNAM": "VN", "YEMEN": "YE", "YÉMEN": "YE", "ZAMBIE": "ZM", "ZIMBABWE": "ZW",
};

/**
 * Konvèti yon valè peyi (kòd 2-lèt oswa non konplè an fransè) an kòd ISO 3166-1 alpha-2.
 * Sinon retounen fallback la (default "HT").
 */
export function toCountryCode(value: string | undefined | null, fallback = "HT"): string {
  if (!value) return fallback;
  const trimmed = value.trim();
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase();

  const key = trimmed.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const keyAccented = trimmed.toUpperCase();
  return NAME_TO_CODE[keyAccented] || NAME_TO_CODE[key] || fallback;
}
