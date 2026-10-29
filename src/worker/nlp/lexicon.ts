// Clasificación explicable por léxico (inglés y español). Workers AI la complementa cuando no hay coincidencias.

export type Category =
  | 'politica_monetaria' | 'conflicto' | 'sanciones' | 'regulacion' | 'elecciones' | 'energia'
  | 'crisis_bancaria' | 'hackeo' | 'adopcion' | 'tecnologia_btc' | 'aranceles' | 'desastre'
  | 'cortes_internet' | 'datos_macro' | 'mercado_cripto' | 'otro';

export const CATEGORY_LABEL: Record<Category, string> = {
  politica_monetaria: 'Política monetaria', conflicto: 'Conflicto armado', sanciones: 'Sanciones', regulacion: 'Regulación cripto',
  elecciones: 'Elecciones', energia: 'Energía', crisis_bancaria: 'Crisis bancaria', hackeo: 'Hackeo o quiebra', adopcion: 'Adopción institucional',
  tecnologia_btc: 'Tecnología Bitcoin', aranceles: 'Comercio y aranceles', desastre: 'Desastres y crisis humanitarias',
  cortes_internet: 'Cortes de internet', datos_macro: 'Datos macroeconómicos', mercado_cripto: 'Mercado cripto', otro: 'Otros',
};

/** Descripciones usadas como anclas semánticas para la clasificación por embeddings. */
export const CATEGORY_ANCHORS: Partial<Record<Category, string>> = {
  politica_monetaria: 'central bank interest rate decision, Federal Reserve, ECB, monetary policy, inflation target',
  conflicto: 'war, military strike, missiles, invasion, armed conflict between countries',
  sanciones: 'economic sanctions, embargo, export controls, asset freeze',
  regulacion: 'cryptocurrency regulation, SEC, crypto law, stablecoin bill, crypto ban',
  elecciones: 'national election, presidential vote, polls, election results',
  energia: 'oil prices, OPEC, natural gas supply, energy crisis',
  crisis_bancaria: 'bank failure, bank run, financial crisis, liquidity crisis, default',
  hackeo: 'crypto exchange hacked, stolen funds, exploit, bankruptcy of crypto firm',
  adopcion: 'company buys bitcoin, bitcoin ETF inflows, institutional adoption, treasury reserve',
  tecnologia_btc: 'Bitcoin Core software, protocol upgrade, mining difficulty, lightning network',
  aranceles: 'tariffs, trade war, import duties, trade deal',
  datos_macro: 'inflation data, CPI report, jobs report, GDP growth, unemployment',
};

const R = (s: string) => new RegExp(s, 'i');

const RULES: [Category, RegExp][] = [
  ['hackeo', R(String.raw`\b(hack(ed|ers?)?|exploit(ed)?|drained|stolen|heist|insolven|bankrupt|quiebra|hackeo|robo de|suspend(s|ed)? withdrawals|congela retiradas)\b`)],
  ['sanciones', R(String.raw`\b(sanction(s|ed)?|sancion(es)?|embargo|export controls?|asset freeze|ofac)\b`)],
  ['conflicto', R(String.raw`\b(war|airstrikes?|missiles?|invasion|invade[sd]?|troops|shelling|drone strikes?|military|ceasefire|guerra|ataque|misil(es)?|bombarde|invasi[oó]n|tropas|alto el fuego|ofensiva)\b`)],
  ['aranceles', R(String.raw`\b(tariffs?|trade war|import dut(y|ies)|aranceles?|guerra comercial)\b`)],
  ['politica_monetaria', R(String.raw`\b(fed|fomc|federal reserve|powell|ecb|bce|lagarde|bank of england|bank of japan|boj|rate (cut|hike)s?|interest rates?|tipos de inter[eé]s|recorte de tipos|subida de tipos|banco central|reserva federal|quantitative)\b`)],
  ['crisis_bancaria', R(String.raw`\b(bank run|bank failure|bailout|rescate bancario|crisis bancaria|default(s|ed)?|impago|credit crunch|contagion)\b`)],
  ['regulacion', R(String.raw`\b(sec|cftc|esma|mica|cnmv|regulat\w*|regula\w*|lawsuit|demanda|stablecoin bill|genius act|clarity act|crypto (law|bill|ban)|ley cripto|licen[cs]e?|prohib\w*|ban(s|ned)?)\b`)],
  ['elecciones', R(String.raw`\b(elections?|elecciones|vote|votaci[oó]n|polls?|encuestas?|ballot|presidential race|candidat[oe]s?)\b`)],
  ['energia', R(String.raw`\b(oil|crude|opec|opep|brent|wti|natural gas|petr[oó]leo|gas natural|energ[ií]a)\b`)],
  ['datos_macro', R(String.raw`\b(cpi|inflation|inflaci[oó]n|ipc|jobs report|payrolls|unemployment|desempleo|paro|gdp|pib|recession|recesi[oó]n|pmi)\b`)],
  ['adopcion', R(String.raw`\b(etf (inflows?|outflows?)|treasury (reserve|strategy)|buys? bitcoin|compra bitcoin|strategic bitcoin reserve|reserva estrat[eé]gica|blackrock|microstrategy|strategy inc|8-k|adoption|adopci[oó]n)\b`)],
  ['tecnologia_btc', R(String.raw`\b(bitcoin core|soft ?fork|taproot|lightning network|op_return|halving|hashrate|difficulty adjustment|bip-?\d+|covenant)\b`)],
  ['desastre', R(String.raw`\b(earthquake|terremoto|hurricane|hurac[aá]n|flood(ing)?|inundaci|tsunami|wildfire|incendio forestal|famine|hambruna|crisis:)\b`)],
  ['cortes_internet', R(String.raw`\b(internet (outage|shutdown|blackout)|corte de internet|apag[oó]n de internet)\b`)],
  ['mercado_cripto', R(String.raw`\b(bitcoin|btc|crypto\w*|cripto\w*|ether(eum)?|stablecoins?|solana|binance|coinbase)\b`)],
];

const HINT_MAP: Record<string, Category> = {
  politica_monetaria: 'politica_monetaria', regulacion: 'regulacion', sanciones: 'sanciones', desastre: 'desastre',
  cortes_internet: 'cortes_internet', adopcion: 'adopcion', tecnologia_btc: 'tecnologia_btc',
};

export function classify(title: string, hint?: string): { category: Category; matched: string | null } {
  for (const [cat, re] of RULES) {
    const m = re.exec(title);
    if (m) {
      // "regulación" solo cuenta si el titular trata de cripto o lo publica un regulador
      if (cat === 'regulacion' && hint !== 'regulacion' && !RULES.find(([c]) => c === 'mercado_cripto')![1].test(title)) continue;
      return { category: cat, matched: m[0] };
    }
  }
  if (hint && HINT_MAP[hint]) return { category: HINT_MAP[hint], matched: null };
  return { category: 'otro', matched: null };
}

// ---------- Tono ----------
const POS = /\b(surge[sd]?|soar(s|ed)?|rall(y|ies|ied)|gain(s|ed)?|record high|approv(e[sd]?|al)|boost(s|ed)?|win(s)?|eas(e[sd]?|ing)|agreement|deal|ceasefire|recover(y|s|ed)?|sube|dispara|r[eé]cord|aprueba|aprobaci[oó]n|acuerdo|alivio|recupera|impulsa|alto el fuego|avanza|respaldo)\b/gi;
const NEG = /\b(plunge[sd]?|crash(es|ed)?|tumble[sd]?|slump(s|ed)?|fall(s)?|fell|drop(s|ped)?|loss(es)?|fear(s)?|hack(ed)?|ban(s|ned)?|lawsuit|sues?|crackdown|war|attack(s|ed)?|sanction(s|ed)?|default|collapse[sd]?|recession|escalat\w*|threat(en)?s?|cae|caída|desploma|hunde|p[eé]rdidas?|miedo|demanda|prohib\w*|guerra|ataque|sanci[oó]n|colapso|recesi[oó]n|amenaza|escalada|quiebra)\b/gi;

export function tone(title: string): number {
  const p = title.match(POS)?.length ?? 0, n = title.match(NEG)?.length ?? 0;
  return p + n === 0 ? 0 : (p - n) / (p + n);
}

const RUMOR = /\b(reportedly|rumou?r(s|ed)?|unconfirmed|sources say|could|may|might|según fuentes|sin confirmar|podr[ií]a|rumor(es)?)\b|\?$/i;
export const isRumor = (title: string) => RUMOR.test(title);

// ---------- Países (para el mapa) ----------
export const COUNTRIES: { iso: string; nombre: string; lat: number; lon: number; re: RegExp }[] = [
  ['US', 'Estados Unidos', 39, -98, String.raw`\b(u\.?s\.?a?|united states|america(n)?|washington|estados unidos|ee\.? ?uu\.?|trump|white house|casa blanca)\b`],
  ['CN', 'China', 35, 103, String.raw`\b(china|chinese|chin[oa]s?|beijing|pek[ií]n|xi jinping)\b`],
  ['RU', 'Rusia', 60, 90, String.raw`\b(russia(n)?|rusia|rus[oa]s?|moscow|mosc[uú]|kremlin|putin)\b`],
  ['UA', 'Ucrania', 49, 32, String.raw`\b(ukrain\w*|ucrania\w*|kyiv|kiev|zelensk\w*)\b`],
  ['IL', 'Israel', 31.5, 34.8, String.raw`\b(israel\w*|netanyahu|idf)\b`],
  ['PS', 'Palestina', 31.9, 35.2, String.raw`\b(gaza|hamas|hamás|palestin\w*|west bank|cisjordania)\b`],
  ['IR', 'Irán', 32, 53, String.raw`\b(iran\w*|irán|tehran|teher[aá]n)\b`],
  ['LB', 'Líbano', 33.9, 35.8, String.raw`\b(leban\w*|l[ií]bano|hezbollah)\b`],
  ['SY', 'Siria', 35, 38, String.raw`\b(syria\w*|siria\w*|damascus|damasco)\b`],
  ['YE', 'Yemen', 15.5, 48, String.raw`\b(yemen\w*|houthis?|hut[ií]es)\b`],
  ['SA', 'Arabia Saudí', 24, 45, String.raw`\b(saudi\w*|arabia saud[ií])\b`],
  ['TW', 'Taiwán', 23.7, 121, String.raw`\b(taiwan\w*|taiw[aá]n)\b`],
  ['KP', 'Corea del Norte', 40, 127, String.raw`\b(north korea\w*|corea del norte|pyongyang|kim jong)\b`],
  ['KR', 'Corea del Sur', 36, 128, String.raw`\b(south korea\w*|corea del sur|seoul|se[uú]l)\b`],
  ['JP', 'Japón', 36, 138, String.raw`\b(japan\w*|jap[oó]n|japones\w*|tokyo|tokio|boj)\b`],
  ['IN', 'India', 21, 78, String.raw`\b(india\w*|new delhi|nueva delhi|modi)\b`],
  ['PK', 'Pakistán', 30, 70, String.raw`\b(pakistan\w*|pakist[aá]n)\b`],
  ['GB', 'Reino Unido', 54, -2, String.raw`\b(u\.?k\.?|britain|british|reino unido|brit[aá]nic\w*|london|londres|bank of england)\b`],
  ['EU', 'Unión Europea', 50.8, 4.4, String.raw`\b(e\.?u\.?|european union|uni[oó]n europea|brussels|bruselas|ecb|bce|eurozone|eurozona)\b`],
  ['DE', 'Alemania', 51, 10, String.raw`\b(german\w*|alemania|alem[aá]n\w*|berlin|berl[ií]n)\b`],
  ['FR', 'Francia', 46, 2, String.raw`\b(france|french|francia|franc[eé]s\w*|paris|par[ií]s|macron)\b`],
  ['ES', 'España', 40, -4, String.raw`\b(spain|spanish|españa|español\w*|madrid|banco de españa|cnmv)\b`],
  ['IT', 'Italia', 42.8, 12.8, String.raw`\b(ital\w*|rome|roma)\b`],
  ['TR', 'Turquía', 39, 35, String.raw`\b(turk(ey|ish)|turqu[ií]a|turc[oa]s?|erdogan|erdo[gğ]an)\b`],
  ['BR', 'Brasil', -10, -55, String.raw`\b(brazil\w*|brasil\w*|lula)\b`],
  ['AR', 'Argentina', -34, -64, String.raw`\b(argentin\w*|milei|buenos aires)\b`],
  ['MX', 'México', 23, -102, String.raw`\b(mexic\w*|m[eé]xic\w*)\b`],
  ['VE', 'Venezuela', 8, -66, String.raw`\b(venezuel\w*|maduro|caracas)\b`],
  ['CA', 'Canadá', 56, -106, String.raw`\b(canad\w*|ottawa)\b`],
  ['SV', 'El Salvador', 13.8, -88.9, String.raw`\b(el salvador|bukele)\b`],
  ['NG', 'Nigeria', 9, 8, String.raw`\b(nigeria\w*)\b`],
  ['ZA', 'Sudáfrica', -29, 24, String.raw`\b(south africa\w*|sud[aá]frica)\b`],
  ['EG', 'Egipto', 26, 30, String.raw`\b(egypt\w*|egipt\w*|cairo)\b`],
  ['SD', 'Sudán', 15, 30, String.raw`\b(sudan\w*|sud[aá]n)\b`],
  ['AU', 'Australia', -25, 133, String.raw`\b(australia\w*)\b`],
  ['HK', 'Hong Kong', 22.3, 114.2, String.raw`\b(hong kong)\b`],
  ['SG', 'Singapur', 1.35, 103.8, String.raw`\b(singapore|singapur)\b`],
  ['AE', 'Emiratos Árabes', 24, 54, String.raw`\b(uae|dubai|abu dhabi|emiratos)\b`],
  ['CH', 'Suiza', 46.8, 8.2, String.raw`\b(switzerland|swiss|suiza|zurich|z[uú]rich)\b`],
  ['PL', 'Polonia', 52, 19, String.raw`\b(poland|polish|polonia)\b`],
].map(([iso, nombre, lat, lon, re]) => ({ iso: iso as string, nombre: nombre as string, lat: lat as number, lon: lon as number, re: new RegExp(re as string, 'i') }));
// "US" en mayúsculas no debe confundirse con el pronombre inglés "us".
COUNTRIES[0].re = /\b(U\.S\.A?\.?|USA|US)\b|\b([Uu]nited [Ss]tates|[Aa]merican?|Washington|[Ee]stados [Uu]nidos|EE\.? ?UU\.?|Trump|White House|Casa Blanca|Fed|FOMC|Federal Reserve|Reserva Federal|Powell|Warsh|SEC|CFTC|Treasury|Wall Street|OFAC)\b/;

export function countriesIn(title: string): string[] {
  return COUNTRIES.filter((c) => c.re.test(title)).map((c) => c.iso).slice(0, 4);
}
