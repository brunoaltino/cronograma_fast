export const SUPABASE_URL = "https://bitkrlqmenyjhsjqjktr.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_iIRQFLPKftWcXsJ_8ba5Qw_ToQELnmI";

export const TABLE_ESTADO = "cronograma_estado";
export const TABLE_RANKING = "ranking_amigos";
export const AVATAR_BUCKET = "avatars";

export const EXAM = new Date(2027, 0, 24);

export const D = {
  LP: { n: "Português", c: "#ffb15c", q: 10, g: 1 },
  MT: { n: "RLM/Matemática", c: "#a8d86e", q: 10, g: 1 },
  AT: { n: "Atualidades do mercado", c: "#ffd08a", q: 5, g: 1 },
  ET: { n: "Ética, Compliance e ESG", c: "#7fcf8f", q: 5, g: 1 },
  CB: { n: "Conhecimentos Bancários", c: "#ff9a3c", q: 15, g: 0 },
  MF: { n: "Matemática Financeira", c: "#c2e58a", q: 5, g: 0 },
  PE: { n: "Probabilidade e Estatística", c: "#6fd0b0", q: 5, g: 0 },
  IN: { n: "Informática", c: "#9be0a4", q: 5, g: 0 },
  VN: { n: "Vendas, Negociação e Atendimento", c: "#ff8f6b", q: 10, g: 0 }
};

export const T = {
  CB: [
    "SFN: CMN, BC, CVM, Susep, Previc e FGC",
    "Política monetária: Selic, Copom, compulsório, open market",
    "Instituições: bancos, cooperativas, SCD/SEP e instituições de pagamento",
    "Contas, tarifas (Res. 3.919) e serviços essenciais; poupança e conta-salário",
    "Meios de pagamento: Pix, TED, cartões, cheque, boleto e SPB",
    "Crédito: consignado, rotativo, CCB, garantias, desconto de títulos, portabilidade, SCR",
    "Renda fixa: CDB, LCI/LCA, Tesouro, FGC e tributação; risco e retorno",
    "Mercado de capitais: ações, debêntures, fundos, B3, IPO, câmbio",
    "Seguros, previdência (PGBL/VGBL), capitalização, consórcio e bancassurance",
    "PLD/FT (COAF, KYC, PEP), Res. 4.966 e gestão de riscos",
    "Proteção do consumidor: CDC, SAC, Ouvidoria, atendimento prioritário e Open Finance"
  ],
  LP: [
    "Interpretação de textos e inferência",
    "Ortografia, acentuação e crase",
    "Pontuação e coordenação/subordinação",
    "Concordância verbal e nominal",
    "Regência e colocação pronominal",
    "Vozes, discurso direto/indireto/livre; tempos e modos",
    "Formação de palavras, figuras de linguagem, denotação e conotação"
  ],
  VN: [
    "Atendimento: qualidade, SERVQUAL e momentos da verdade",
    "Comunicação, escuta ativa e assertividade",
    "Etapas da venda, SPIN e objeções",
    "Negociação: Harvard, MAANA, estilos e mediação",
    "CRM, fidelização, NPS, CSAT, jornada e omnicanalidade",
    "Ética na oferta: suitability, venda casada, CDC e Guia de Conduta"
  ],
  MT: [
    "Lógica proposicional: negação, equivalências, argumentos",
    "Relações arbitrárias, silogismos e dedução",
    "Porcentagem, razão, proporção e regra de três",
    "Divisão proporcional, frações e problemas",
    "Contagem: princípio multiplicativo, permutações e combinações",
    "Sequências, orientação espacial e temporal; conjuntos"
  ],
  ET: [
    "Guia de Conduta Ética: princípios, presentes e conflito de interesse",
    "Guia: sigilo, nepotismo, assédio, relacionamento com clientes e fornecedores",
    "Compliance, controles internos, três linhas e integridade",
    "Prevenção à corrupção e à lavagem; governança e Lei das Estatais",
    "ESG, ODS e finanças sustentáveis"
  ],
  MF: [
    "Juros simples e desconto simples",
    "Juros compostos e taxas (nominal, efetiva, equivalente, real)",
    "Séries de pagamentos e valor presente",
    "Sistemas de amortização: SAC, Price e Americano"
  ],
  PE: [
    "Medidas centrais e de dispersão",
    "Probabilidade: união, condicional e independência",
    "Distribuição normal, amostragem e gráficos"
  ],
  IN: [
    "LGPD: conceitos, direitos, bases legais e sanções",
    "Segurança: phishing, golpes, malware, MFA e criptografia",
    "Google Workspace, Windows/Linux básico, redes, nuvem e IA"
  ],
  AT: [
    "Selic, inflação, juros reais e reforma tributária",
    "Pix, Open Finance, ativos virtuais e fintechs",
    "Educação financeira, Cadastro Positivo, ESG e risco climático"
  ]
};

export function buildPlan() {
  const rem = {}, tot = {};
  const k = Object.keys(T);
  k.forEach(x => { rem[x] = tot[x] = T[x].length; });
  const out = [];
  let prev = "";

  for (let i = 0; i < 48; i++) {
    let best = null, bs = -1;
    k.forEach(x => {
      if (rem[x] > 0 && x !== prev) {
        const s = rem[x] / tot[x] + (tot[x] > 5 ? 0.02 : 0);
        if (s > bs) { bs = s; best = x; }
      }
    });
    if (!best) k.forEach(x => { if (rem[x] > 0) best = x; });
    const idx = tot[best] - rem[best];
    rem[best]--;
    prev = best;
    out.push({ d: best, t: T[best][idx] });
  }

  for (let s = 1; s <= 4; s++) {
    out.push({ s, t: `Simulado ${s}: resolver em 4h, sem consulta` });
    out.push({ s, t: `Simulado ${s}: corrigir, ler os comentários e anotar os erros` });
  }
  out.push({ r: 1, t: "Revisão dos pontos mais fracos (veja o ranking em Desempenho)" });
  out.push({ r: 1, t: "Revisão: refazer questões erradas e resumos" });
  out.push({ r: 1, t: "Revisão: Guia de Conduta, fórmulas e legislação" });
  out.push({ r: 2, t: "Véspera: revisão leve, descanso e documentos da prova" });
  return out;
}
