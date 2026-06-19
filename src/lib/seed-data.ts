import type {
  Account,
  AppData,
  EventRecord,
  GameRecord,
  Medal,
  MuralPost,
  Player,
  PlayerRatingHistoryPoint,
  RatingType,
  WorkerRun,
} from "./types";
import fideHistorySeed from "./fide-history-seed.json";

type FideHistorySeedRow = {
  fideId: string;
  listMonth: string;
  ratingType: RatingType;
  rating: number;
  games?: number | null;
};

const RATING_TYPES: RatingType[] = ["standard", "rapid", "blitz"];
const seedRatingHistoryByFideId = buildSeedRatingHistoryByFideId(
  fideHistorySeed as FideHistorySeedRow[],
);

const playerRows: Array<
  [string, number, number, number, string, string, number, string?, string?]
> = [
  [
    "José Veiga",
    2417,
    2304,
    2278,
    "1930087",
    "Sénior",
    2333,
    "1998-03-14",
    "M",
  ],
  [
    "Miguel Sismeiro",
    2339,
    2303,
    2219,
    "1950975",
    "Sénior",
    2287,
    "1996-06-11",
    "M",
  ],
  [
    "Filipa Pipiras",
    2323,
    2196,
    2068,
    "1944894",
    "Sénior",
    2196,
    "2000-04-21",
    "F",
  ],
  [
    "Pedro Caramez",
    2085,
    2105,
    2141,
    "1904485",
    "Sénior",
    2110,
    "1985-01-09",
    "M",
  ],
  [
    "Lucas Jordão",
    2035,
    2175,
    2105,
    "1945360",
    "2007 · Sub-20",
    2105,
    "2007-03-07",
    "M",
  ],
  [
    "Ricardo Marques",
    2046,
    2084,
    2095,
    "1949438",
    "Sénior",
    2075,
    undefined,
    "M",
  ],
  [
    "Rodrigo Sarabando",
    2044,
    2081,
    2075,
    "1950010",
    "2007 · Sub-20",
    2067,
    "2007-11-18",
    "M",
  ],
  [
    "André Almeida",
    2144,
    2060,
    1921,
    "1982893",
    "Sénior",
    2042,
    undefined,
    "M",
  ],
  [
    "Diogo Martins",
    1987,
    2134,
    1991,
    "1926934",
    "Sénior",
    2037,
    undefined,
    "M",
  ],
  [
    "Dinis Neto",
    1962,
    2026,
    2009,
    "1970445",
    "2011 · Sub-16",
    1999,
    "2011-02-08",
    "M",
  ],
  [
    "Tiago Frutuoso",
    1975,
    1981,
    2006,
    "1966898",
    "2013 · Sub-14",
    1987,
    "2013-05-13",
    "M",
  ],
  [
    "Tomás Costa",
    1890,
    1983,
    1968,
    "1962701",
    "2010 · Sub-16",
    1947,
    "2010-09-27",
    "M",
  ],
  [
    "Tomás Almeida",
    1867,
    2000,
    1892,
    "1980670",
    "2017 · Sub-10",
    1920,
    "2017-01-25",
    "M",
  ],
  [
    "Emanuel Sousa",
    1915,
    1929,
    1909,
    "1903705",
    "Sénior",
    1918,
    undefined,
    "M",
  ],
  ["Pedro Mendes", 1947, 1896, 1861, "1908049", "Sénior", 1901, undefined, "M"],
  [
    "Bernardo Beijoco",
    1898,
    1873,
    1899,
    "1979485",
    "2015 · Sub-12",
    1890,
    "2015-03-19",
    "M",
  ],
  [
    "Pedro Marinho",
    1815,
    1885,
    1950,
    "1912682",
    "Sénior",
    1883,
    undefined,
    "M",
  ],
  [
    "Sofia Valente",
    1822,
    1897,
    1899,
    "1953494",
    "2010 · Sub-16",
    1873,
    "2010-07-02",
    "F",
  ],
  [
    "Daniel Silva",
    1857,
    1903,
    1828,
    "1951378",
    "2008 · Sub-18",
    1863,
    "2008-08-13",
    "M",
  ],
  [
    "Manuel Tenreiro",
    1889,
    1774,
    1920,
    "1976346",
    "2012 · Sub-14",
    1861,
    "2012-11-05",
    "M",
  ],
  [
    "Gabriel Silva",
    1864,
    1839,
    1834,
    "1959549",
    "2007 · Sub-20",
    1846,
    "2007-06-16",
    "M",
  ],
  [
    "Gonçalo Montenegro",
    1824,
    1855,
    1841,
    "1970020",
    "2009 · Sub-18",
    1840,
    "2009-12-14",
    "M",
  ],
  [
    "Diogo Borges",
    1854,
    1844,
    1806,
    "1980157",
    "2013 · Sub-14",
    1835,
    "2013-04-25",
    "M",
  ],
  ["Daniel Gago", 1840, 1843, 1768, "1970119", "Sénior", 1817, undefined, "M"],
  [
    "Rúben Freitas",
    1787,
    1725,
    1760,
    "1926420",
    "Sénior",
    1757,
    undefined,
    "M",
  ],
  [
    "Nuno Costa",
    1743,
    1804,
    1721,
    "1981196",
    "2015 · Sub-12",
    1756,
    "2015-01-31",
    "M",
  ],
  [
    "Rúben Marriós",
    1660,
    1757,
    1823,
    "1920669",
    "Sénior",
    1747,
    undefined,
    "M",
  ],
  ["João Marques", 1755, 1700, 1710, "1968408", "Sénior", 1722, undefined, "M"],
  [
    "Filipe Encarnação",
    1632,
    1747,
    1634,
    "1942018",
    "Sénior",
    1671,
    undefined,
    "M",
  ],
  [
    "Afonso Oliveira",
    1533,
    1743,
    1716,
    "1972790",
    "2015 · Sub-12",
    1664,
    "2015-10-12",
    "M",
  ],
  [
    "Maria Rita Matos",
    1576,
    1609,
    1639,
    "1969935",
    "2014 · Sub-12",
    1608,
    "2014-09-06",
    "F",
  ],
  [
    "Bernardo Teixeira",
    1762,
    1494,
    1566,
    "1981870",
    "2009 · Sub-18",
    1607,
    "2009-07-22",
    "M",
  ],
  [
    "Pedro Ribeiro",
    1619,
    1590,
    1466,
    "1977717",
    "Sénior",
    1558,
    undefined,
    "M",
  ],
  [
    "Afonso Borges",
    1592,
    1545,
    1487,
    "1944797",
    "Sénior",
    1541,
    undefined,
    "M",
  ],
  [
    "Martim Garcez",
    1520,
    1552,
    1550,
    "1981803",
    "2006 · Sub-20",
    1541,
    "2006-02-04",
    "M",
  ],
  [
    "Constança Fonseca",
    1540,
    1565,
    1481,
    "1981897",
    "2015 · Sub-12",
    1529,
    "2015-06-18",
    "F",
  ],
  [
    "Maria Rita Pinto",
    1521,
    1567,
    1484,
    "1956388",
    "2009 · Sub-18",
    1524,
    "2009-04-29",
    "F",
  ],
  [
    "Beatriz Gonçalves",
    1419,
    1517,
    1417,
    "1980688",
    "2017 · Sub-10",
    1451,
    "2017-09-18",
    "F",
  ],
  [
    "Benjamin Job",
    0,
    1695,
    1447,
    "1991515",
    "2016 · Sub-10",
    1047,
    "2016-05-18",
    "M",
  ],
  [
    "Pedro Amado",
    0,
    1408,
    1552,
    "1988930",
    "Veterano S50",
    987,
    undefined,
    "M",
  ],
  [
    "Miguel Fernandes",
    0,
    1412,
    1495,
    "1984365",
    "2010 · Sub-16",
    969,
    "2010-12-03",
    "M",
  ],
  [
    "Miguel Amado",
    0,
    1430,
    1425,
    "1979477",
    "2015 · Sub-10",
    952,
    "2015-07-21",
    "M",
  ],
  [
    "Rafael Ramos",
    0,
    0,
    1606,
    "1993534",
    "2016 · Sub-10",
    535,
    "2016-09-09",
    "M",
  ],
  ["Fernando Matos", 0, 1597, 0, "1993097", "Sénior", 532, undefined, "M"],
  [
    "Jeronimo Moreno",
    0,
    1527,
    0,
    "1993208",
    "2014 · Sub-12",
    509,
    "2014-12-09",
    "M",
  ],
  [
    "Tomás Liberato",
    0,
    0,
    1446,
    "1993950",
    "2015 · Sub-10",
    482,
    "2015-08-30",
    "M",
  ],
  [
    "Maria Filipa Matos",
    0,
    0,
    1424,
    "1981846",
    "2017 · Sub-10",
    475,
    "2017-02-26",
    "F",
  ],
  ["David Beijoco", 0, 1410, 0, "1992848", "Sénior", 470, undefined, "M"],
];

function missingProfileFields(input: {
  dateOfBirth?: string;
  fideId?: string;
  phone?: string;
  sex?: string;
}) {
  const missing: string[] = [];
  if (!input.dateOfBirth) missing.push("data de nascimento");
  if (!input.fideId) missing.push("ID FIDE");
  if (!input.phone) missing.push("telefone");
  if (!input.sex) missing.push("sexo");
  return missing;
}

function buildSeedRatingHistoryByFideId(rows: FideHistorySeedRow[]) {
  const byFideId = new Map<string, Map<string, PlayerRatingHistoryPoint>>();
  for (const row of rows) {
    if (!row.fideId || !row.listMonth || !RATING_TYPES.includes(row.ratingType))
      continue;
    const rating = Number(row.rating);
    if (!Number.isFinite(rating) || rating <= 0) continue;
    const months =
      byFideId.get(row.fideId) ?? new Map<string, PlayerRatingHistoryPoint>();
    const point = months.get(row.listMonth) ?? { listMonth: row.listMonth };
    point[row.ratingType] = rating;
    const gamesKey = `${row.ratingType}Games` as const;
    if (row.games !== undefined && row.games !== null)
      point[gamesKey] = row.games;
    months.set(row.listMonth, point);
    byFideId.set(row.fideId, months);
  }

  return new Map(
    [...byFideId.entries()].map(([fideId, months]) => [
      fideId,
      [...months.values()].sort((a, b) =>
        a.listMonth.localeCompare(b.listMonth),
      ),
    ]),
  );
}

function latestSeedRating(
  history: PlayerRatingHistoryPoint[] | undefined,
  ratingType: RatingType,
) {
  if (!history) return undefined;
  for (let index = history.length - 1; index >= 0; index--) {
    const rating = history[index][ratingType];
    if (rating) return rating;
  }
  return undefined;
}

export const players: Player[] = playerRows.map(
  (
    [
      name,
      standard,
      rapid,
      blitz,
      fideId,
      category,
      combined,
      dateOfBirth,
      sex,
    ],
    index,
  ) => {
    const missingFields = missingProfileFields({ dateOfBirth, fideId, sex });
    const ratingHistory = seedRatingHistoryByFideId.get(fideId);
    const latestStandard =
      latestSeedRating(ratingHistory, "standard") ?? standard;
    const latestRapid = latestSeedRating(ratingHistory, "rapid") ?? rapid;
    const latestBlitz = latestSeedRating(ratingHistory, "blitz") ?? blitz;
    const latestRatings = [latestStandard, latestRapid, latestBlitz].filter(
      Boolean,
    );
    return {
      id: `pl-${index + 1}`,
      name,
      fideId,
      dateOfBirth,
      category,
      sex: sex as "M" | "F" | undefined,
      standard: latestStandard,
      rapid: latestRapid,
      blitz: latestBlitz,
      combined: latestRatings.length
        ? Math.round(
            latestRatings.reduce((sum, rating) => sum + rating, 0) /
              latestRatings.length,
          )
        : combined,
      active: true,
      profileStatus: missingFields.length ? "incomplete" : "complete",
      missingFields,
      ratingHistory,
    };
  },
);

export const accounts: Account[] = [
  {
    id: "a1",
    name: "Pedro Caramez",
    email: "pedro.caramez@colegioefanor.pt",
    role: "admin",
    status: "active",
    profileStatus: "complete",
    missingFields: [],
    fideId: "1904485",
    dateOfBirth: "1988-01-01",
    phone: "917910541",
  },
];

export const seedAccountCredentials = [
  {
    email: "pedro.caramez@colegioefanor.pt",
    passwordHash:
      "scrypt$UgTsy9mazbWX8-boIe4ECA$JuwuEEmdEU5HQD7pGA4ndeIMc5CS4UDiBMEF23myAPa_IunhoVHY4sac_FY38ZGpbzlCrgFo8IcnifkPQHNCVQ",
  },
] as const;

export const posts: MuralPost[] = [
  {
    id: "p1",
    tag: "Regras",
    author: "Pedro Caramez",
    date: "2026-06-16",
    tint: "#FCEBC4",
    rotation: "-1deg",
    x: 30,
    y: 28,
    z: 6,
    title: "Regras do Clube",
    body: "1. Todas as inscrições são feitas PELO CLUBE.\n2. Obrigatório estar EQUIPADO em qualquer prova.\n3. Pagamento sempre prévio à inscrição.\n4. Pagamentos para IBAN PT50356000019001840667012 com nome do aluno + prova.",
  },
  {
    id: "p2",
    tag: "Kit",
    author: "Secretaria",
    date: "2026-06-10",
    tint: "#CFE0F3",
    rotation: "1.7deg",
    x: 350,
    y: 380,
    z: 5,
    title: "Encomendas de Equipamento",
    body: "Novos alunos: encomendar KIT COMPLETO pelo [formulário](https://forms.office.com/pages/responsepage.aspx?id=nM9rUTV8pEmIMX014EtXcu_59eOEAmpEmm18FEi8AlxUOE9YMEZKU0ZLMDZSWExIUUU3UEI1SEhKNC4u&origin=lprLink&route=shorturl). Quem já frequenta pode pedir peças avulso.",
  },
  {
    id: "p3",
    tag: "Treinos",
    author: "Pedro Caramez",
    date: "2026-06-17",
    tint: "#D6E9C6",
    rotation: "-1.2deg",
    x: 680,
    y: 130,
    z: 4,
    title: "Horário dos Treinos",
    body: "Os treinos são às segundas, quartas, quintas e sextas, das 17:30 às 19:15, no Pavilhão do Colégio Efanor.",
  },
];

export const events: EventRecord[] = [];

export const medals: Medal[] = [];

export const games: GameRecord[] = [];

export const workerRuns: WorkerRun[] = [];

export const seedData: AppData = {
  accounts,
  players,
  posts,
  events,
  medals,
  games,
  workerRuns,
};
