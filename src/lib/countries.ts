/**
 * Countries, for the nationality picker.
 *
 * Stored as "CODE:Name" pairs and parsed once, because the flag never needs storing:
 * a regional-indicator pair derived from the ISO 3166-1 alpha-2 code IS the emoji, so
 * 🇺🇸 is two characters computed from "US" rather than 250 pasted glyphs that a stray
 * encoding change could mangle.
 */
const RAW =
  'AF:Afghanistan,AL:Albania,DZ:Algeria,AD:Andorra,AO:Angola,AG:Antigua and Barbuda,AR:Argentina,' +
  'AM:Armenia,AU:Australia,AT:Austria,AZ:Azerbaijan,BS:Bahamas,BH:Bahrain,BD:Bangladesh,BB:Barbados,' +
  'BY:Belarus,BE:Belgium,BZ:Belize,BJ:Benin,BM:Bermuda,BT:Bhutan,BO:Bolivia,BA:Bosnia and Herzegovina,' +
  'BW:Botswana,BR:Brazil,BN:Brunei,BG:Bulgaria,BF:Burkina Faso,BI:Burundi,KH:Cambodia,CM:Cameroon,' +
  'CA:Canada,CV:Cape Verde,CF:Central African Republic,TD:Chad,CL:Chile,CN:China,CO:Colombia,' +
  'KM:Comoros,CG:Congo,CD:Congo (DRC),CR:Costa Rica,CI:Côte d’Ivoire,HR:Croatia,CU:Cuba,CY:Cyprus,' +
  'CZ:Czechia,DK:Denmark,DJ:Djibouti,DM:Dominica,DO:Dominican Republic,EC:Ecuador,EG:Egypt,' +
  'SV:El Salvador,GQ:Equatorial Guinea,ER:Eritrea,EE:Estonia,SZ:Eswatini,ET:Ethiopia,FJ:Fiji,' +
  'FI:Finland,FR:France,GA:Gabon,GM:Gambia,GE:Georgia,DE:Germany,GH:Ghana,GI:Gibraltar,GR:Greece,' +
  'GL:Greenland,GD:Grenada,GT:Guatemala,GN:Guinea,GW:Guinea-Bissau,GY:Guyana,HT:Haiti,HN:Honduras,' +
  'HK:Hong Kong,HU:Hungary,IS:Iceland,IN:India,ID:Indonesia,IR:Iran,IQ:Iraq,IE:Ireland,IL:Israel,' +
  'IT:Italy,JM:Jamaica,JP:Japan,JO:Jordan,KZ:Kazakhstan,KE:Kenya,KI:Kiribati,KW:Kuwait,KG:Kyrgyzstan,' +
  'LA:Laos,LV:Latvia,LB:Lebanon,LS:Lesotho,LR:Liberia,LY:Libya,LI:Liechtenstein,LT:Lithuania,' +
  'LU:Luxembourg,MO:Macau,MG:Madagascar,MW:Malawi,MY:Malaysia,MV:Maldives,ML:Mali,MT:Malta,' +
  'MH:Marshall Islands,MR:Mauritania,MU:Mauritius,MX:Mexico,FM:Micronesia,MD:Moldova,MC:Monaco,' +
  'MN:Mongolia,ME:Montenegro,MA:Morocco,MZ:Mozambique,MM:Myanmar,NA:Namibia,NR:Nauru,NP:Nepal,' +
  'NL:Netherlands,NZ:New Zealand,NI:Nicaragua,NE:Niger,NG:Nigeria,KP:North Korea,MK:North Macedonia,' +
  'NO:Norway,OM:Oman,PK:Pakistan,PW:Palau,PS:Palestine,PA:Panama,PG:Papua New Guinea,PY:Paraguay,' +
  'PE:Peru,PH:Philippines,PL:Poland,PT:Portugal,PR:Puerto Rico,QA:Qatar,RO:Romania,RU:Russia,' +
  'RW:Rwanda,KN:Saint Kitts and Nevis,LC:Saint Lucia,VC:Saint Vincent and the Grenadines,WS:Samoa,' +
  'SM:San Marino,ST:São Tomé and Príncipe,SA:Saudi Arabia,SN:Senegal,RS:Serbia,SC:Seychelles,' +
  'SL:Sierra Leone,SG:Singapore,SK:Slovakia,SI:Slovenia,SB:Solomon Islands,SO:Somalia,' +
  'ZA:South Africa,KR:South Korea,SS:South Sudan,ES:Spain,LK:Sri Lanka,SD:Sudan,SR:Suriname,' +
  'SE:Sweden,CH:Switzerland,SY:Syria,TW:Taiwan,TJ:Tajikistan,TZ:Tanzania,TH:Thailand,TL:Timor-Leste,' +
  'TG:Togo,TO:Tonga,TT:Trinidad and Tobago,TN:Tunisia,TR:Türkiye,TM:Turkmenistan,TV:Tuvalu,' +
  'UG:Uganda,UA:Ukraine,AE:United Arab Emirates,GB:United Kingdom,US:United States,UY:Uruguay,' +
  'UZ:Uzbekistan,VU:Vanuatu,VA:Vatican City,VE:Venezuela,VN:Vietnam,YE:Yemen,ZM:Zambia,ZW:Zimbabwe'

export interface Country {
  code: string
  name: string
  flag: string
}

/** 'US' → 🇺🇸. Two regional-indicator code points, offset from 'A'. */
export function codeToFlag(code: string): string {
  const c = code.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(c)) return ''
  return String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65))
}

export const COUNTRIES: Country[] = RAW.split(',').map((pair) => {
  const i = pair.indexOf(':')
  const code = pair.slice(0, i)
  return { code, name: pair.slice(i + 1), flag: codeToFlag(code) }
})

const BY_NAME = new Map(COUNTRIES.map((c) => [c.name.toLowerCase(), c]))
const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]))

/**
 * The flag for whatever is stored on a driver.
 *
 * `drivers.country` predates this picker and holds a mixture — a raw emoji from the
 * old free-text box, a country name, sometimes a code. All three have to keep
 * rendering, so an existing roster does not lose its flags the day the picker lands.
 */
export function flagFor(value?: string | null): string {
  const v = (value ?? '').trim()
  if (!v) return ''
  // Already an emoji flag (a regional-indicator pair).
  if (/^[\u{1F1E6}-\u{1F1FF}]{2}$/u.test(v)) return v
  const byName = BY_NAME.get(v.toLowerCase())
  if (byName) return byName.flag
  const byCode = BY_CODE.get(v.toUpperCase())
  if (byCode) return byCode.flag
  return ''
}

/** Ranked matches for a typed fragment. Prefix hits first — typing "un" should
 *  reach "United States" before "Brunei". */
export function searchCountries(q: string, limit = 8): Country[] {
  const s = q.trim().toLowerCase()
  if (!s) return []
  const starts: Country[] = []
  const contains: Country[] = []
  for (const c of COUNTRIES) {
    const n = c.name.toLowerCase()
    if (n.startsWith(s) || c.code.toLowerCase() === s) starts.push(c)
    else if (n.includes(s)) contains.push(c)
    if (starts.length >= limit) break
  }
  return [...starts, ...contains].slice(0, limit)
}
