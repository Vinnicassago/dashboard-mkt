/**
 * Fixtures da Fase 5 de nov/26 — o Conteúdo (fora da coleta do vitest, que só pega
 * `*.test.ts`). Só DADO: monta posts, a conta do Instagram, linhas de anúncio,
 * criativos, leads e peças da Produção. Nenhuma função daqui chama a lib da tela
 * (`entrada-conteudo.ts` é quem chama).
 *
 * `producaoConteudo()` tem a FORMA da produção de 13/11/2026 (marca Consórcio), com
 * números e legendas FICTÍCIOS — o repositório é público:
 *   • posts de 01/07 a 11/11 (≈ 90 da grade + os cortes), o último da grade em 11/11
 *     ("há 2 dias"); cinco por semana (seg, ter, qui, sex, sáb), alguns às 21:30 de
 *     Brasília (o dia seguinte em UTC);
 *   • 13 grupos de posts iguais no mesmo dia com 2+ na GRADE (2 a 7 posts; o de 7 em
 *     28/07; UM nos últimos 30 dias, 03/11, às 21:10 e 22:40 de Brasília; o de 12/08
 *     com uma versão impulsionada, que fica fora da grade mas no grupo), nenhum
 *     marcado; e dois grupos que NÃO contam: 3 posts com 2 já marcados como teste
 *     (sobra 1) e o par [orgânico + versão impulsionada];
 *   • um post de TESTE e um IMPULSIONADO com mais salvos, compartilhamentos e
 *     interações que todos — nenhum dos dois pode aparecer nos melhores;
 *   • nos últimos 30 dias, os três melhores: um reel com a capa válida e o `.mp4`,
 *     um carrossel com a imagem válida e um feed com a imagem vencida; e um reel só
 *     com o `.mp4` (sem capa);
 *   • 60% das legendas regulares pedem DM (a ação "Peça menos DM" dispara em 30 dias);
 *   • a conta de 01/07 a 12/11, o total desde 01/07 (sem véspera em Campanha), ganhos
 *     e perdas só desde 06/08, nenhum toque nos botões, nenhuma conversa de DM;
 *   • anúncios de conversão (o `span` começa em 01/07) e UMA linha de descoberta
 *     VIDEO_VIEWS com gasto (o `vanity-objective` não pode aparecer no Consórcio);
 *   • 3 leads "Pessoa-conteudo-NN-zq" (1 orgânico), só para a LGPD do payload;
 *   • metas de seguidores e de conversas de DM (a antiga continua legível); 0 peças.
 *
 * Os leads se chamam "Pessoa-conteudo-NN-zq": `conferirLgpd(…, { semNomes })` procura
 * o nome como SUBSTRING do payload; nenhuma legenda tem nome de pessoa. Todo
 * `publishedAt` sai de `brt(dia, "hh:mm")` (ISO com Z): texto sem fuso mudaria de dia
 * entre a máquina do dev e o CI.
 */
import type { AdDaily, Creative, DashboardData, Goal, IgAccountDaily, IgMediaType, IgPost, Lead, PostDraft } from "@/lib/types";
import { base, brt } from "./fixtures-robo";

// ---------------------------------------------------------------- relógio

/** Sexta, 13/11/2026 — o dia do retrato de produção. */
export const HOJE = "2026-11-13";
/** 12:00 em Brasília. */
export const AGORA = "2026-11-13T15:00:00.000Z";
/** 22:00 de 13/11 em Brasília (já 14/11 em UTC). */
export const AGORA_NOITE = "2026-11-14T01:00:00.000Z";
/** Terça, 10/11 (a segunda 09/11 já passou). */
export const HOJE_TERCA = "2026-11-10";
export const AGORA_TERCA = "2026-11-10T15:00:00.000Z";
/** Segunda, 09/11 (nenhum dia de feed antes de hoje na semana). */
export const HOJE_SEGUNDA = "2026-11-09";
export const AGORA_SEGUNDA = "2026-11-09T15:00:00.000Z";
export const MARCA = "consorcio";
export const MARCA_AWARENESS = "krone";

/** Um período que ainda não começou (C9): `resolveRange` devolve o 1º dia, vazio. */
export const CHAVE_NAO_COMECOU = "2099-01-01..2099-01-31";

/** `oe` da Meta: válido até 31/12/2026 e vencido em 01/11/2026. */
export const OE_VALIDO = "6B359B00";
export const OE_VENCIDO = "6AE68100";

/** A URL do CDN do Instagram de uma fixture. */
export const urlDoCdn = (arq: string, oe: string, ext = "jpg") => `https://scontent.cdninstagram.com/v/fixture-${arq}.${ext}?oe=${oe}`;
/** O permalink público de uma fixture. */
export const permalinkDe = (n: string) => `https://www.instagram.com/p/FIXTURE${n}/`;

/** O dia `n` dias depois de `dia` (AAAA-MM-DD). */
export function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Os dias de `de` a `ate`, inclusive. */
function diasEntre(de: string, ate: string): string[] {
  const out: string[] = [];
  for (let d = de; d <= ate; d = somarDias(d, 1)) out.push(d);
  return out;
}

/** 0 = domingo … 6 = sábado (o dia do calendário, sem fuso). */
const diaDaSemana = (dia: string) => new Date(`${dia}T00:00:00Z`).getUTCDay();

// ---------------------------------------------------------------- construtores

/** Um post da marca: `id` "IG-…", permalink "FIXTURE…", `publishedAt` em Brasília. */
export function post(id: string, dia: string, hhmm: string, type: IgMediaType, caption: string, over: Partial<IgPost> = {}): IgPost {
  return {
    id,
    brand: MARCA,
    publishedAt: brt(dia, hhmm),
    type,
    caption,
    permalink: permalinkDe(id.replace(/^IG-/, "").replace(/-/g, "")),
    reach: 60,
    views: 120,
    likes: 3,
    comments: 0,
    saved: 0,
    shares: 0,
    ...(type === "reel" ? { avgWatchTime: 9.7 } : {}),
    ...over,
  };
}

/** Uma linha de anúncio. */
function anuncio(date: string, adId: string, spend: number, extra: Partial<AdDaily> = {}): AdDaily {
  return {
    brand: MARCA,
    date,
    campaign: "Leads consórcio",
    adset: "Aberto Brasil",
    adId,
    objective: "OUTCOME_LEADS",
    spend,
    impressions: Math.round(spend * 40),
    reach: Math.round(spend * 30),
    frequency: 1.3,
    clicks: Math.round(spend / 2),
    leads: 1,
    ...extra,
  };
}

/** Uma peça da Produção planejada para `plannedFor`. */
export function peca(id: string, plannedFor: string, type: IgMediaType, over: Partial<PostDraft> = {}): PostDraft {
  return {
    id,
    brand: MARCA,
    status: "aprovado",
    createdAt: brt("2026-11-08", "10:00"),
    updatedAt: brt("2026-11-08", "10:00"),
    plannedFor,
    type,
    hookText: "A parcela que cabe no plano",
    hookSpoken: "Quanto custa uma carta de crédito por mês?",
    script: "Roteiro da peça planejada.",
    caption: "Legenda da peça planejada.",
    ...over,
  };
}

// ---------------------------------------------------------------- os ids e textos que os testes citam

/** Os posts que os testes procuram pelo id. */
export const IDS_CONTEUDO = {
  /** Reel de 06/11 com a capa válida e o `.mp4`: o 1º dos melhores em 30 dias (6 salvos, 3 compart.). */
  melhor1: "IG-MELHOR-1",
  /** Carrossel de 26/10 com a imagem válida: o 2º (5 salvos, 2 compart.). */
  melhor2: "IG-MELHOR-2",
  /** Feed de 20/10 com a imagem vencida: o 3º (4 salvos, 1 compart.). */
  melhor3: "IG-MELHOR-3",
  /** Reel de 02/11 só com o `.mp4` (sem capa). */
  reelSoMp4: "IG-REEL-MP4",
  /** Teste de 05/11: mais salvos, compartilhamentos e interações que todos. */
  teste: "IG-TESTE",
  /** Impulsionado de 30/10 (um criativo aponta para ele): idem. */
  impulsionado: "IG-IMPULSIONADO",
  /** A versão impulsionada DENTRO do grupo de 12/08 (o grupo continua com 3 na grade). */
  impulsionadoNoGrupo: "IG-G06-4",
  /** O par [orgânico + versão impulsionada] de 21/10: a versão impulsionada. */
  impulsionadoDoPar: "IG-NG2-2",
  /** O último post da grade (11/11, 21:30 de Brasília = 12/11 em UTC). */
  ultimo: "IG-ULTIMO",
} as const;

/** A legenda de 40+ palavras (o 1º dos melhores): nunca inteira no HTML. */
export const LEGENDA_LONGA =
  "Planejamento patrimonial começa pela conta certa\n" +
  "Neste reel mostramos, passo a passo, como comparar o custo total de um consórcio com o de um financiamento imobiliário, " +
  "incluindo taxa de administração, fundo de reserva, seguro e correção anual da carta, para que a decisão seja tomada " +
  "com todos os números na mesa e sem surpresa nas parcelas futuras.";

/** Quantos grupos com 2+ posts na grade a produção tem (no histórico). */
export const GRUPOS_NA_GRADE = 13;
/** O dia do único grupo dentro dos últimos 30 dias (fora dos 7). */
export const DIA_DO_GRUPO_NO_PERIODO = "2026-11-03";

// ---------------------------------------------------------------- a produção (Consórcio)

const TEMAS = [
  "Consórcio ou financiamento: a conta que ninguém mostra",
  "Como funciona o lance embutido",
  "Carta de crédito: o que muda na contemplação",
  "Três perguntas antes de entrar num grupo",
  "Taxa de administração explicada sem rodeio",
  "Imóvel na planta com carta contemplada",
  "O que acontece se uma parcela atrasar",
  "Reajuste da carta: INCC ou IPCA",
  "Bastidor: a assembleia do mês",
  "Mito ou verdade: consórcio só sai no sorteio",
  "Quanto rende a carta parada",
  "Simulação da semana: carta de 400 mil",
];
const SEGUNDA_LINHA_COM_DM = ["Me chama na DM para simular a sua.", "Me chama na DM e tire a dúvida."];
const SEGUNDA_LINHA_SEM_DM = ["Salve para consultar depois.", "Comente sua dúvida aqui embaixo.", "Assista até o fim."];
const HORAS = ["09:30", "12:10", "18:40", "21:30"];

interface Grupo {
  /** Número do grupo (o id dos posts é "IG-G<nn>-<j>"). */
  n: number;
  dia: string;
  posts: number;
  type: IgMediaType;
  legenda: string;
  horas?: string[];
}

/** Os 13 grupos de cortes com 2+ posts na grade. */
const GRUPOS: Grupo[] = [
  { n: 1, dia: "2026-07-08", posts: 2, type: "reel", legenda: "Você sabe quanto paga de juros no financiamento?\nA conta completa está no vídeo." },
  { n: 2, dia: "2026-07-15", posts: 3, type: "reel", legenda: "Carta contemplada: o que fazer no primeiro dia\nSalve para consultar depois." },
  { n: 3, dia: "2026-07-22", posts: 2, type: "reel", legenda: "Três sinais de que o consórcio combina com você\nComente qual deles é o seu." },
  { n: 4, dia: "2026-07-28", posts: 7, type: "reel", legenda: "Um milhão em carta de crédito: quanto custa por mês?\nSimulação feita no quadro." },
  { n: 5, dia: "2026-08-04", posts: 2, type: "reel", legenda: "Lance embutido sem mistério\nO passo a passo no vídeo." },
  { n: 6, dia: "2026-08-12", posts: 4, type: "reel", legenda: "Consórcio para investir em imóvel de aluguel\nVeja a conta do rendimento." },
  { n: 7, dia: "2026-08-19", posts: 2, type: "reel", legenda: "O erro mais caro de quem compra imóvel à vista\nAssista até o fim." },
  { n: 8, dia: "2026-08-26", posts: 3, type: "carrossel", legenda: "Quanto tempo leva para ser contemplado?\nA resposta honesta no carrossel." },
  { n: 9, dia: "2026-09-02", posts: 2, type: "reel", legenda: "Consórcio de veículo pesado para a sua frota\nA conta para empresas." },
  { n: 10, dia: "2026-09-10", posts: 5, type: "reel", legenda: "Financiamento ou consórcio para a casa própria\nComparativo lado a lado." },
  { n: 11, dia: "2026-09-23", posts: 2, type: "reel", legenda: "Assembleia do mês: como funciona o sorteio\nBastidor do escritório." },
  { n: 12, dia: "2026-10-07", posts: 3, type: "reel", legenda: "Carta de crédito parada rende?\nA correção explicada." },
  { n: 13, dia: DIA_DO_GRUPO_NO_PERIODO, posts: 2, type: "reel", legenda: "A conta que o banco não mostra na simulação\nVeja os números completos.", horas: ["21:10", "22:40"] },
];

/** Os dois grupos que NÃO contam: [3 posts, 2 já marcados] e [orgânico + versão impulsionada]. */
const GRUPO_RESOLVIDO = { dia: "2026-09-16", legenda: "Mito: consórcio só serve para quem não tem pressa\nCorte de teste do gancho." };
const PAR_IMPULSIONADO = { dia: "2026-10-21", legenda: "Como planejar a compra do imóvel em cinco anos\nO plano está no carrossel." };

const CRIATIVO_CONVERSAO: Creative = { adId: "120000000001", brand: MARCA, name: "Simulador de carta — vídeo", format: "video", creativeId: "cr-conv-1" };
const CRIATIVO_DESCOBERTA: Creative = { adId: "120000000201", brand: MARCA, name: "Vídeo institucional", format: "video", creativeId: "cr-desc-1" };
/** Os criativos que apontam para os posts impulsionados (pelo `instagramMediaId`). */
const impulsionando = (adId: string, mediaId: string): Creative => ({
  adId,
  brand: MARCA,
  name: `Impulsionado ${adId.slice(-3)}`,
  format: "carrossel",
  instagramMediaId: mediaId,
});

/** Os 3 leads da LGPD (1 orgânico). */
export function leadsDoConteudo(brand = MARCA): Lead[] {
  return [
    {
      id: "lead-conteudo-01",
      brand,
      createdAt: brt("2026-11-10", "10:00"),
      name: "Pessoa-conteudo-01-zq",
      email: "pessoa.conteudo.01@exemplo.com.br",
      phone: "5511977710001",
      status: "lead",
      utmSource: "meta",
      utmContent: "Simulador de carta — vídeo|120000000001",
      adId: "120000000001",
    },
    {
      id: "lead-conteudo-02",
      brand,
      createdAt: brt("2026-11-11", "15:00"),
      name: "Pessoa-conteudo-02-zq",
      email: "pessoa.conteudo.02@exemplo.com.br",
      phone: "5511977710002",
      status: "lead",
      utmSource: "meta",
      utmContent: "Simulador de carta — vídeo|120000000001",
      adId: "120000000001",
    },
    {
      // Orgânico: sem UTM pago.
      id: "lead-conteudo-03",
      brand,
      createdAt: brt("2026-11-12", "09:00"),
      name: "Pessoa-conteudo-03-zq",
      email: "pessoa.conteudo.03@exemplo.com.br",
      phone: "5511977710003",
      status: "lead",
    },
  ];
}

/** A conta do Instagram de 01/07 a 12/11: total desde 01/07, ganhos e perdas só desde 06/08. */
function contaDoInstagram(): IgAccountDaily[] {
  const out: IgAccountDaily[] = [];
  let seguidores = 82;
  diasEntre("2026-07-01", "2026-11-12").forEach((date, i) => {
    const ganho = i === 0 ? 0 : 6 + (i % 7);
    seguidores += ganho;
    const perdas = i % 3;
    const reach = 400 + ((i * 53) % 300);
    out.push({
      brand: MARCA,
      date,
      followers: seguidores,
      reach,
      views: reach * 2,
      profileLinkTaps: 0,
      accountsEngaged: 30 + (i % 20),
      totalInteractions: 20 + ((i * 7) % 25),
      profileViews: 15 + ((i * 11) % 20),
      ...(date >= "2026-08-06" ? { followsDay: ganho + perdas, unfollowsDay: perdas } : {}),
    });
  });
  return out;
}

/** Os anúncios: conversão toda semana de 01/07 a 12/11 (o `span`) e UMA linha de descoberta VIDEO_VIEWS com gasto. */
function anuncios(): AdDaily[] {
  const out: AdDaily[] = [];
  for (let d = "2026-07-01"; d <= "2026-11-12"; d = somarDias(d, 7)) out.push(anuncio(d, CRIATIVO_CONVERSAO.adId, 50));
  out.push(anuncio("2026-11-12", CRIATIVO_CONVERSAO.adId, 50));
  out.push(
    anuncio("2026-11-09", CRIATIVO_DESCOBERTA.adId, 120, {
      campaign: "Descoberta vídeo",
      adset: "Engajamento vídeo",
      objective: "VIDEO_VIEWS",
      leads: 0,
    }),
  );
  return out;
}

interface Producao {
  data: DashboardData;
  /** Os ids de cada grupo de posts iguais (os 13 e os 2 que não contam), em ordem de publicação. */
  grupos: string[][];
}

function montarProducao(): Producao {
  const posts: IgPost[] = [];
  const grupos: string[][] = [];
  const criativos: Creative[] = [CRIATIVO_CONVERSAO, CRIATIVO_DESCOBERTA];

  const diasDeGrupo = new Set([...GRUPOS.map((g) => g.dia), GRUPO_RESOLVIDO.dia, PAR_IMPULSIONADO.dia]);

  // Os posts especiais (substituem o regular do dia).
  const especiais: Record<string, IgPost> = {
    "2026-11-06": post(IDS_CONTEUDO.melhor1, "2026-11-06", "12:10", "reel", LEGENDA_LONGA, {
      reach: 140,
      views: 380,
      likes: 8,
      comments: 1,
      saved: 6,
      shares: 3,
      thumbnailUrl: urlDoCdn("101", OE_VALIDO),
      mediaUrl: urlDoCdn("101", OE_VALIDO, "mp4"),
    }),
    "2026-10-26": post(IDS_CONTEUDO.melhor2, "2026-10-26", "18:40", "carrossel", "Cinco perguntas para fazer antes de assinar\nArraste para o lado e salve este carrossel.", {
      reach: 120,
      views: 200,
      likes: 6,
      saved: 5,
      shares: 2,
      mediaUrl: urlDoCdn("102", OE_VALIDO),
    }),
    "2026-10-20": post(IDS_CONTEUDO.melhor3, "2026-10-20", "09:30", "feed", "Bastidor: a reunião de planejamento da semana\nO time por trás das simulações.", {
      reach: 95,
      views: 150,
      likes: 5,
      saved: 4,
      shares: 1,
      mediaUrl: urlDoCdn("103", OE_VENCIDO),
    }),
    "2026-11-02": post(IDS_CONTEUDO.reelSoMp4, "2026-11-02", "20:15", "reel", "Mito ou verdade: dá para usar o FGTS no consórcio?\nResposta direta no reel.", {
      reach: 70,
      views: 160,
      likes: 3,
      saved: 1,
      shares: 1,
      mediaUrl: urlDoCdn("104", OE_VALIDO, "mp4"),
    }),
  };

  // Os regulares: seg, ter, qui, sex e sáb de 01/07 a 09/11, e o último em 11/11 (quarta, 21:30).
  let i = 0;
  for (const dia of diasEntre("2026-07-01", "2026-11-09")) {
    const dow = diaDaSemana(dia);
    if (![1, 2, 4, 5, 6].includes(dow) || diasDeGrupo.has(dia)) continue;
    if (especiais[dia]) {
      posts.push(especiais[dia]);
      continue;
    }
    const semana = Math.floor(i / 5);
    const type: IgMediaType = dow === 1 ? "feed" : dow === 5 ? (semana % 2 === 0 ? "carrossel" : "feed") : "reel";
    const pedeDm = i % 5 === 0 || i % 5 === 2 || i % 5 === 3;
    const segunda = pedeDm ? SEGUNDA_LINHA_COM_DM[i % 2] : SEGUNDA_LINHA_SEM_DM[i % 3];
    const reach = 35 + ((i * 37) % 55);
    posts.push(
      post(`IG-${String(i + 1).padStart(3, "0")}`, dia, HORAS[i % HORAS.length], type, `${TEMAS[i % TEMAS.length]}\n${segunda}`, {
        reach,
        views: reach * 2 + (i % 3),
        likes: 1 + ((i * 3) % 5),
        comments: i % 9 === 4 ? 1 : 0,
        saved: i % 6 === 1 ? 1 : 0,
        shares: i % 10 === 3 ? 1 : 0,
      }),
    );
    i += 1;
  }
  posts.push(
    post(IDS_CONTEUDO.ultimo, "2026-11-11", "21:30", "reel", "Carta de crédito para quem já tem imóvel\nSalve para consultar depois.", {
      reach: 48,
      views: 110,
      likes: 2,
    }),
  );

  // Os 13 grupos com 2+ na grade (o de 12/08 com a versão impulsionada no fim).
  for (const g of GRUPOS) {
    const ids: string[] = [];
    for (let j = 1; j <= g.posts; j++) {
      const id = `IG-G${String(g.n).padStart(2, "0")}-${j}`;
      const hhmm = g.horas?.[j - 1] ?? `${String(10 + Math.floor((j - 1) / 2)).padStart(2, "0")}:${(j - 1) % 2 === 0 ? "00" : "30"}`;
      posts.push(post(id, g.dia, hhmm, g.type, g.legenda, { reach: 30 + j * 4, views: 70 + j * 5, likes: 1 + (j % 2) }));
      ids.push(id);
    }
    grupos.push(ids);
  }
  criativos.push(impulsionando("120000000101", IDS_CONTEUDO.impulsionadoNoGrupo));

  // [3 posts, 2 já marcados como teste]: sobra 1 na grade.
  const resolvido = [1, 2, 3].map((j) =>
    post(`IG-NG1-${j}`, GRUPO_RESOLVIDO.dia, `1${j}:00`, "reel", GRUPO_RESOLVIDO.legenda, { reach: 40, views: 90, likes: 2, ...(j > 1 ? { isTest: true } : {}) }),
  );
  posts.push(...resolvido);
  grupos.push(resolvido.map((p) => p.id));

  // [orgânico + versão impulsionada]: o impulsionado já está fora da grade.
  const par = [1, 2].map((j) => post(`IG-NG2-${j}`, PAR_IMPULSIONADO.dia, `1${j}:15`, "carrossel", PAR_IMPULSIONADO.legenda, { reach: 55, views: 90, likes: 2 }));
  posts.push(...par);
  grupos.push(par.map((p) => p.id));
  criativos.push(impulsionando("120000000102", IDS_CONTEUDO.impulsionadoDoPar));

  // O teste e o impulsionado com mais salvos, compartilhamentos e interações que todos.
  posts.push(
    post(IDS_CONTEUDO.teste, "2026-11-05", "15:00", "reel", "[TESTE] Gancho B — a parcela que cabe no bolso\nCorte de validação.", {
      isTest: true,
      reach: 900,
      views: 2400,
      likes: 120,
      comments: 10,
      saved: 40,
      shares: 20,
      thumbnailUrl: urlDoCdn("105", OE_VALIDO),
    }),
    post(IDS_CONTEUDO.impulsionado, "2026-10-30", "11:00", "carrossel", "Simule sua carta de crédito em dois minutos\nLink na bio.", {
      reach: 4200,
      views: 6100,
      likes: 300,
      comments: 12,
      saved: 35,
      shares: 25,
      mediaUrl: urlDoCdn("106", OE_VALIDO),
    }),
  );
  criativos.push(impulsionando("120000000103", IDS_CONTEUDO.impulsionado));

  const goals: Goal[] = [
    { brand: MARCA, metric: "followers", period: "campanha", target: 1500 },
    { brand: MARCA, metric: "conversas_dm", period: "campanha", target: 60 },
  ];

  const data = base({
    campaign: { id: "camp-conteudo", brand: MARCA, name: "Consórcio", objective: "Geração de cadastros (leads)", status: "ativa", startDate: "2026-07-01", budgetTotal: 0 },
    igAccountDaily: contaDoInstagram(),
    igPosts: posts,
    adDaily: anuncios(),
    creatives: criativos,
    leads: leadsDoConteudo(),
    goals,
    updatedAt: AGORA,
  });
  return { data, grupos };
}

/** A FORMA da produção de 13/11 (Consórcio), números e legendas fictícios. Peças: nenhuma (`drafts: []`). */
export function producaoConteudo(): DashboardData {
  return montarProducao().data;
}

/** Os ids de cada grupo de posts iguais da produção (os 13 que contam e os 2 que não contam). */
export function gruposDaProducao(): string[][] {
  return montarProducao().grupos;
}

/** A produção com outros posts (a conta, os anúncios, os leads e as metas ficam). */
function comPosts(igPosts: IgPost[], creatives?: Creative[]): DashboardData {
  const d = producaoConteudo();
  return { ...d, igPosts, creatives: creatives ?? d.creatives };
}

// ---------------------------------------------------------------- os cenários

/** O último post da grade 9 dias antes de `HOJE` (04/11): com `?range=7d` o período está vazio. */
export function semPostNaSemana(): DashboardData {
  const d = producaoConteudo();
  const antes = d.igPosts.filter((p) => Date.parse(p.publishedAt) < Date.parse(brt("2026-11-04", "00:00")));
  return { ...d, igPosts: [...antes, post("IG-QUARTA", "2026-11-04", "12:00", "reel", "Como a carta de crédito é corrigida\nSalve para consultar depois.")] };
}

/** Em cada grupo, todos marcados como teste menos um: nenhum grupo com 2+ na grade. */
export function variacoesResolvidas(): DashboardData {
  const { data, grupos } = montarProducao();
  const impulsionados = new Set(data.creatives.map((c) => c.instagramMediaId).filter(Boolean));
  const marcar = new Set<string>();
  for (const ids of grupos) {
    const naGrade = ids.filter((id) => !impulsionados.has(id) && !data.igPosts.find((p) => p.id === id)?.isTest);
    for (const id of naGrade.slice(1)) marcar.add(id);
  }
  return { ...data, igPosts: data.igPosts.map((p) => (marcar.has(p.id) ? { ...p, isTest: true } : p)) };
}

/** Sem a conta do Instagram. */
export function semInstagram(): DashboardData {
  return { ...producaoConteudo(), igAccountDaily: [] };
}

/** Os snapshots desde 01/10 vieram sem o total (`followers` 0): nos 30 dias não há total. */
export function semTotalDeSeguidores(): DashboardData {
  const d = producaoConteudo();
  return { ...d, igAccountDaily: d.igAccountDaily.map((r) => (r.date >= "2026-10-01" ? { ...r, followers: 0 } : r)) };
}

/** Um só post da grade em todo o histórico (10/11), com 42 interações. */
export function umPostDaGrade(): DashboardData {
  return comPosts([post("IG-UNICO", "2026-11-10", "12:00", "reel", "Simulação da semana: carta de 250 mil\nSalve para consultar depois.", { reach: 110, likes: 30, comments: 4, saved: 5, shares: 3 })]);
}

/** Três posts da grade nos 30 dias, todos com 0 interação. */
export function semInteracao(): DashboardData {
  const zero = { likes: 0, comments: 0, saved: 0, shares: 0 };
  return comPosts([
    post("IG-ZERO-1", "2026-11-02", "12:00", "feed", "Bastidor da semana no escritório\nAssista até o fim.", zero),
    post("IG-ZERO-2", "2026-11-05", "12:00", "reel", "Carta de crédito sem entrada\nAssista até o fim.", zero),
    post("IG-ZERO-3", "2026-11-09", "12:00", "carrossel", "Seis passos para a primeira carta\nAssista até o fim.", zero),
  ]);
}

/** A: 30 curtidas e nenhum salvo; B: 10 curtidas e 2 salvos → B lidera ("Carrossel de 06/11 lidera: 2 salvos"). */
export function salvosContraCurtidas(): DashboardData {
  return comPosts([
    post("IG-CURTIDAS", "2026-11-05", "12:00", "reel", "Quanto custa esperar para comprar\nAssista até o fim.", { reach: 200, likes: 30, comments: 0, saved: 0, shares: 0 }),
    post("IG-SALVOS", "2026-11-06", "12:00", "carrossel", "Checklist antes da primeira assembleia\nSalve para consultar depois.", { reach: 80, likes: 10, comments: 0, saved: 2, shares: 0 }),
  ]);
}

/**
 * Dois posts com 11 interações e nenhum salvo ou compartilhamento (alcance 90, o MAIS
 * ANTIGO, e 70) e um 3º com 4 → "2 posts empatam com 11 interações", o de alcance 90 primeiro.
 */
export function empateNoTopo(): DashboardData {
  return comPosts([
    post("IG-EMPATE-90", "2026-11-03", "12:00", "carrossel", "Consórcio imobiliário em quatro perguntas\nAssista até o fim.", { reach: 90, likes: 11, comments: 0, saved: 0, shares: 0 }),
    post("IG-EMPATE-70", "2026-11-05", "12:00", "reel", "Contemplação por lance: como funciona\nAssista até o fim.", { reach: 70, likes: 10, comments: 1, saved: 0, shares: 0 }),
    post("IG-TERCEIRO", "2026-11-06", "12:00", "feed", "Agenda de atendimento da semana\nAssista até o fim.", { reach: 120, likes: 4, comments: 0, saved: 0, shares: 0 }),
  ]);
}

/**
 * Os dois primeiros empatam em salvos + compartilhamentos (1 cada) e o 1º tem mais
 * interações (11 × 6) → "Feed de 04/11 lidera com 11 interações".
 */
export function lideraPorInteracoes(): DashboardData {
  return comPosts([
    post("IG-MAIS-INTERACOES", "2026-11-04", "12:00", "feed", "Quem pode participar de um grupo\nAssista até o fim.", { reach: 60, likes: 10, comments: 0, saved: 1, shares: 0 }),
    post("IG-MENOS-INTERACOES", "2026-11-06", "12:00", "reel", "A carta serve para reforma?\nAssista até o fim.", { reach: 150, likes: 5, comments: 0, saved: 0, shares: 1 }),
  ]);
}

/**
 * A borda das 21h–24h (F5-D25), com `AGORA_NOITE` (13/11 22:00 em Brasília): um post da
 * grade às 21:30 de 13/11 em Brasília (14/11 00:30 em UTC) e outro às 21:30 de 06/11
 * (07/11 00:30 em UTC). Em 7 dias: "1 post no período · Último post hoje".
 */
export function postDaNoite(): DashboardData {
  return comPosts([
    post("IG-NOITE-HOJE", "2026-11-13", "21:30", "reel", "Simulação ao vivo da carta de 300 mil\nSalve para consultar depois.", { reach: 50, likes: 4, saved: 1 }),
    post("IG-NOITE-SEMANA", "2026-11-06", "21:30", "carrossel", "Quatro dúvidas sobre o lance livre\nAssista até o fim.", { reach: 65, likes: 3 }),
  ]);
}

/** Sem grupo de posts iguais, e um dia dos 30 (06/11) com 2 posts da grade de legendas DIFERENTES. */
export function pileupSemVariacao(): DashboardData {
  const { data, grupos } = montarProducao();
  const dosGrupos = new Set(grupos.flat());
  return {
    ...data,
    igPosts: [
      ...data.igPosts.filter((p) => !dosGrupos.has(p.id)),
      post("IG-SEGUNDO-DO-DIA", "2026-11-06", "19:00", "feed", "Agenda da semana no escritório\nAssista até o fim.", { reach: 40, likes: 2 }),
    ],
  };
}

/**
 * A grade da semana em dia (`hoje` 13/11): posts em 09/11 (seg), 10/11 (ter) e 12/11
 * (qui) e peças planejadas para 13/11, 14/11 e 15/11 — os 6 dias de feed. Nos 30 dias,
 * menos de 1 carrossel por semana (a média do período, `grade-composicao`, dispara).
 */
export function gradeCompleta(): { data: DashboardData; drafts: PostDraft[] } {
  const d = producaoConteudo();
  return {
    data: {
      ...d,
      igPosts: [
        ...d.igPosts,
        post("IG-TERCA", "2026-11-10", "12:00", "reel", "Simulação da semana: carta de 180 mil\nSalve para consultar depois."),
        post("IG-QUINTA", "2026-11-12", "12:00", "reel", "Mito ou verdade: a parcela dobra depois\nAssista até o fim."),
      ],
    },
    drafts: [peca("PECA-SEX", "2026-11-13", "reel"), peca("PECA-SAB", "2026-11-14", "reel"), peca("PECA-DOM", "2026-11-15", "carrossel")],
  };
}

/**
 * Para `HOJE_TERCA` (10/11) e `HOJE_SEGUNDA` (09/11): seis posts da grade na semana
 * anterior (02/11 a 08/11, nenhum pedindo DM, um por dia) e nada publicado nem
 * planejado na semana de 09/11. Na terça: "Complete a grade da semana: 0 de 6 com
 * peça"; na segunda, nenhum dia de feed antes de hoje.
 */
export function tercaSemSegunda(): DashboardData {
  const tipos: [string, IgMediaType][] = [
    ["2026-11-02", "carrossel"],
    ["2026-11-03", "reel"],
    ["2026-11-05", "reel"],
    ["2026-11-06", "reel"],
    ["2026-11-07", "reel"],
    ["2026-11-08", "carrossel"],
  ];
  return comPosts(tipos.map(([dia, type], j) => post(`IG-SEMANA-${j + 1}`, dia, "12:00", type, `${TEMAS[j]}\nSalve para consultar depois.`, { likes: 2 + j })));
}

// ---------------------------------------------------------------- a marca de awareness

/** Awareness (Krone): posts, seguidores sem a série de ganhos e perdas, sem playbook, e a descoberta VIDEO_VIEWS com gasto. */
export function kroneConteudo(): DashboardData {
  const brand = MARCA_AWARENESS;
  const temas = ["Patrimônio: proteger antes de multiplicar", "Diversificar é ter os ativos certos", "O custo de deixar dinheiro parado", "Sucessão patrimonial sem susto", "Renda passiva com imóveis"];
  const posts: IgPost[] = [];
  let i = 0;
  for (const dia of diasEntre("2026-09-01", "2026-11-11")) {
    const dow = diaDaSemana(dia);
    if (![2, 4, 6].includes(dow) && dia !== "2026-11-11") continue;
    const type: IgMediaType = (["reel", "carrossel", "feed"] as const)[i % 3];
    posts.push({
      ...post(`IG-K${String(i + 1).padStart(3, "0")}`, dia, HORAS[i % HORAS.length], type, `${temas[i % temas.length]}\nSalve para consultar depois.`, {
        reach: 200 + ((i * 41) % 400),
        views: 500 + ((i * 59) % 700),
        likes: 10 + ((i * 7) % 30),
        comments: 1 + (i % 4),
        saved: 2 + (i % 9),
        shares: 1 + (i % 6),
      }),
      brand,
    });
    i += 1;
  }
  const conta: IgAccountDaily[] = diasEntre("2026-09-01", "2026-11-12").map((date, j) => ({
    brand,
    date,
    followers: 1500 + j * 4,
    reach: 900 + ((j * 31) % 500),
    views: 2000 + ((j * 43) % 900),
    profileLinkTaps: 0,
    accountsEngaged: 60 + (j % 30),
    totalInteractions: 50 + ((j * 13) % 60),
    profileViews: 40 + ((j * 17) % 30),
  }));
  const descoberta: Creative = { adId: "120000000301", brand, name: "Seguidores patrimônio", format: "video", creativeId: "cr-krone-1" };
  const video: Creative = { adId: "120000000302", brand, name: "Vídeo de alcance", format: "video", creativeId: "cr-krone-2" };
  const ads: AdDaily[] = [];
  for (let d = "2026-09-01"; d <= "2026-11-12"; d = somarDias(d, 3)) {
    ads.push(anuncio(d, descoberta.adId, 20, { brand, campaign: "Seguidores Krone", adset: "Perfil", objective: "OUTCOME_ENGAGEMENT", leads: 0 }));
  }
  ads.push(anuncio("2026-11-09", video.adId, 80, { brand, campaign: "Alcance Krone", adset: "Vídeo amplo", objective: "VIDEO_VIEWS", leads: 0 }));
  const lead: Lead = {
    id: "lead-conteudo-04",
    brand,
    createdAt: brt("2026-11-09", "11:00"),
    name: "Pessoa-conteudo-04-zq",
    email: "pessoa.conteudo.04@exemplo.com.br",
    phone: "5511977710004",
    status: "lead",
  };
  return base({
    campaign: { id: "camp-krone", brand, name: "Krone", objective: "Seguidores", status: "ativa", startDate: "2026-09-01", budgetTotal: 0 },
    igAccountDaily: conta,
    igPosts: posts,
    adDaily: ads,
    creatives: [descoberta, video],
    leads: [lead],
    goals: [{ brand, metric: "followers", period: "campanha", target: 2000 }],
    updatedAt: AGORA,
  });
}

// ---------------------------------------------------------------- o pior caso de texto

/** O período antigo do pior caso: 123 dias, de 13/03 a 13/07 (o último post da grade, há 123 dias). */
export const CHAVE_DO_PIOR_CASO = "2026-03-13..2026-07-13";

/** As legendas de 12 palavras dos três melhores do pior caso. */
export const LEGENDAS_DO_PIOR_CASO = [
  "Planilha para comparar consórcio e financiamento antes de assinar o contrato final",
  "Guia definitivo das taxas cobradas pelo consórcio explicado para quem nunca participou",
  "Roteiro prático para usar a carta contemplada na compra do primeiro imóvel",
];

/**
 * O pior caso de texto (§2.8): 1.234 posts da grade em 13/03..13/07 (10 por dia + 4 no
 * último), 123 grupos de 2 posts iguais (um por dia), o último post há 123 dias,
 * seguidores +12.345, os 3 melhores com legendas de 12 palavras e 1.234 salvos e
 * compartilhamentos (2.468 interações), reels com 12,3 s de tempo assistido contra 45,6 s
 * no período anterior. Disparam `no-recent-post` (alta), `retention-drop` por tempo
 * assistido e `grade-da-semana` (médias): a tela mostra as 2 primeiras.
 */
export function piorCasoDeTexto(): DashboardData {
  const posts: IgPost[] = [];
  const dias = diasEntre("2026-03-13", "2026-07-13");
  const melhores: Record<string, number> = { "2026-04-20": 0, "2026-05-18": 1, "2026-06-15": 2 };
  dias.forEach((dia, k) => {
    for (let j = 0; j < 10; j++) {
      const id = `IG-P${String(k + 1).padStart(3, "0")}-${j}`;
      const type: IgMediaType = j % 2 === 0 ? "reel" : "carrossel";
      const hhmm = `${String(8 + j).padStart(2, "0")}:00`;
      const m = melhores[dia];
      if (j === 9 && m !== undefined) {
        posts.push(post(id, dia, hhmm, "carrossel", LEGENDAS_DO_PIOR_CASO[m], { likes: 0, comments: 0, saved: 1234 - m, shares: 1234, reach: 5000 }));
        continue;
      }
      // Os 2 primeiros de cada dia são o grupo de posts iguais do dia.
      const legenda = j < 2 ? `Corte do gancho do dia ${dia}\nVersão de teste.` : `Post ${j} do dia ${dia}\nAssista até o fim.`;
      posts.push(post(id, dia, hhmm, type, legenda, { likes: 1, ...(type === "reel" ? { avgWatchTime: 12.3 } : {}) }));
    }
  });
  for (let j = 0; j < 4; j++) {
    posts.push(post(`IG-PEXTRA-${j}`, "2026-07-13", `${String(19 + j).padStart(2, "0")}:00`, "feed", `Extra ${j} do último dia\nAssista até o fim.`, { likes: 1 }));
  }
  // O período anterior: reels com 45,6 s de tempo assistido.
  posts.push(
    post("IG-ANTERIOR-1", "2026-03-01", "12:00", "reel", "Reel do período anterior\nAssista até o fim.", { avgWatchTime: 45.6 }),
    post("IG-ANTERIOR-2", "2026-03-05", "12:00", "reel", "Outro reel do período anterior\nAssista até o fim.", { avgWatchTime: 45.6 }),
  );
  // Seguidores: a véspera (12/03) com 1.000 e o fim (13/07) com 13.345 → +12.345.
  const conta: IgAccountDaily[] = [{ brand: MARCA, date: "2026-03-12", followers: 1000, reach: 500, views: 900, profileLinkTaps: 0, accountsEngaged: 40, totalInteractions: 60, profileViews: 30 }];
  dias.forEach((date, k) => {
    conta.push({
      brand: MARCA,
      date,
      followers: 1000 + Math.round((12345 * (k + 1)) / dias.length),
      reach: 5000 + k,
      views: 9000 + k,
      profileLinkTaps: 0,
      accountsEngaged: 400,
      totalInteractions: 900,
      profileViews: 300,
    });
  });
  return base({
    campaign: { id: "camp-pior", brand: MARCA, name: "Consórcio", objective: "Geração de cadastros (leads)", status: "ativa", startDate: "2026-01-01", budgetTotal: 0 },
    igAccountDaily: conta,
    igPosts: posts,
    adDaily: [anuncio("2026-01-01", CRIATIVO_CONVERSAO.adId, 50), anuncio("2026-11-12", CRIATIVO_CONVERSAO.adId, 50)],
    creatives: [CRIATIVO_CONVERSAO],
    leads: leadsDoConteudo(),
    goals: [],
    updatedAt: AGORA,
  });
}
