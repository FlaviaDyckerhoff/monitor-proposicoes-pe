const fs = require('fs');
const nodemailer = require('nodemailer');

const EMAIL_DESTINO = process.env.EMAIL_DESTINO;
const EMAIL_REMETENTE = process.env.EMAIL_REMETENTE;
const EMAIL_SENHA = process.env.EMAIL_SENHA;
const ARQUIVO_ESTADO = 'estado.json';
const API_BASE = 'https://dadosabertos.alepe.pe.gov.br/api/v1/proposicoes';
const PORTAL_BASE = 'https://proposicoes.alepe.pe.gov.br';
const LEGISLATURA = 20; // XX Legislatura (2023-2026)

// Endpoints por tipo de proposição
const ENDPOINTS = [
  { path: 'projetos',      label: 'Projetos de Lei' },
  { path: 'indicacoes',    label: 'Indicações' },
  { path: 'requerimentos', label: 'Requerimentos' },
];

const TIPO_URL_POR_ENDPOINT = {
  projetos: 'projeto',
  indicacoes: 'indicacao',
  requerimentos: 'requerimento',
};

function carregarEstado() {
  if (fs.existsSync(ARQUIVO_ESTADO)) {
    return JSON.parse(fs.readFileSync(ARQUIVO_ESTADO, 'utf8'));
  }
  return { maior_docid_visto: 0, ultima_execucao: '' };
}

function salvarEstado(estado) {
  fs.writeFileSync(ARQUIVO_ESTADO, JSON.stringify(estado, null, 2));
}

// Parser XML simples — sem dependências externas
// Extrai atributos de cada tag <projeto .../>
function parseXML(xml) {
  const proposicoes = [];
  // Captura tags <projeto ...> ou <projeto .../> incluindo conteúdo interno
  const tagRegex = /<projeto([^>]*)>([\s\S]*?)<\/projeto>|<projeto([^>]*?)\/>/g;
  let match;

  while ((match = tagRegex.exec(xml)) !== null) {
    const attrStr = match[1] || match[3] || '';
    const innerXml = match[2] || '';

    const attrs = {};
    const attrRegex = /(\w+)="([^"]*)"/g;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(attrStr)) !== null) {
      attrs[attrMatch[1]] = attrMatch[2];
    }

    // Extrai autores do conteúdo interno
    const autores = [];
    const autorRegex = /<autor\s+nome="([^"]*)"[^/]*\/>/g;
    let autorMatch;
    while ((autorMatch = autorRegex.exec(innerXml)) !== null) {
      autores.push(autorMatch[1]);
    }
    attrs._autores = autores.join(', ') || '-';

    proposicoes.push(attrs);
  }

  return proposicoes;
}

async function buscarEndpoint(path, label) {
  const url = `${API_BASE}/${path}/?legislatura=${LEGISLATURA}`;
  console.log(`🔍 Buscando ${label}... (${url})`);

  const response = await fetch(url);

  if (!response.ok) {
    console.error(`❌ Erro em ${label}: ${response.status} ${response.statusText}`);
    return [];
  }

  const xml = await response.text();
  const lista = parseXML(xml);
  lista.forEach(p => { p._endpoint = path; });
  console.log(`   📦 ${lista.length} ${label} recebidos`);
  return lista;
}

async function buscarTodasProposicoes() {
  const resultados = await Promise.all(
    ENDPOINTS.map(e => buscarEndpoint(e.path, e.label))
  );
  return resultados.flat();
}

function normalizarProposicao(p) {
  const tipoUrl = TIPO_URL_POR_ENDPOINT[p._endpoint] || 'projeto';
  const numero = p.numero || '';
  const ano = p.ano || '';
  const docid = p.docid || '';
  const url = numero && ano
    ? `${PORTAL_BASE}/proposicoes/detalhes?tipo=${encodeURIComponent(tipoUrl)}&numero=${encodeURIComponent(numero)}&ano=${encodeURIComponent(ano)}`
    : `${PORTAL_BASE}/proposicoes/detalhes?docid=${encodeURIComponent(docid)}`;

  return {
    docid: parseInt(p.docid) || 0,
    tipo: p.tipo || '-',
    numero: p.numero || '-',
    ano: p.ano || '-',
    autor: p._autores || '-',
    data: p.dataPublicacao || '-',
    ementa: (p.ementa || '-'),
    url,
  };
}

function prioridadeTipoEmail(tipo) {
  const t = String(tipo || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();

  if (/^(PL|PLO)(\b|$)/.test(t) || /^PROJETO DE LEI( ORDINARIA)?$/.test(t)) return 0;
  if (/^PLC(\b|$)/.test(t) || /^PROJETO DE LEI COMPLEMENTAR/.test(t)) return 1;
  if (/^PEC(\b|$)/.test(t) || /^(PROPOSTA|PROJETO) DE EMENDA (A )?CONSTITUCIONAL/.test(t)) return 2;
  return 10;
}

function compararTiposEmail(a, b) {
  const prioridadeA = prioridadeTipoEmail(a);
  const prioridadeB = prioridadeTipoEmail(b);
  if (prioridadeA !== prioridadeB) return prioridadeA - prioridadeB;
  return String(a || '').localeCompare(String(b || ''), 'pt-BR');
}


const CLIENTES_NOMES_PROPRIOS = [
  'FIRJAN', 'Red Bull', 'Sindicerv', 'Boticario',
  'Boticário', 'Grupo Boticario', 'Grupo Boticário', 'O Boticario',
  'O Boticário', 'Abrasel', 'Abrasel PB', 'Abrasel Paraíba',
  'ANBRASEL', 'Ambev', 'Heineken', 'Abralatas',
  'ABIR', 'Coca-Cola', 'Coca Cola', 'Coca-Cola Company',
  'Femsa', 'Solar', 'Grupo Simões', 'Grupo Simoes',
  'Andina', 'CVI', 'iFood', 'Zé Delivery',
  'Ze Delivery', 'Verde Brasil', 'JCRIG', 'Associação dos Cemitérios e Crematórios do Brasil',
  'Associacao dos Cemiterios e Crematorios do Brasil', 'Lalamove', 'Matrix', 'CVC',
  'Rei do Pitaco', 'Maersk', 'Mac Jee', 'Norte Energia',
  'Pacto Pela Fome', 'Sanofi', 'TikTok', 'Minalba',
  'Esmaltec', 'Nacional Gás', 'Nacional Gas', 'Syngenta',
  'Braskem', 'Ypê', 'Ype', 'VTal',
  'V.tal', 'Grupo EPR', 'EPR', 'Natural Energia',
  'DIAGEO', 'Alpargatas', 'Ternium', 'ABRADEE',
  'Eletrobras', 'Eletrobrás', 'MeetKai', 'IPQ',
  'Equatorial', 'EquatorialEnergia', 'Equatorial Energia', 'Equatorial Goiás',
  'Equatorial Goias', 'Equatorial Goiás Distribuidora de Energia', 'Equatorial Goias Distribuidora de Energia', 'CEA Equatorial',
  'CEA Equatorial Energia', 'Equtorial', 'Energisa', 'EnergisaLuz',
  'Neoenergia', 'ENEL', 'Ampla Energia', 'SABESP',
  'COMGAS', 'COMGÁS', 'AEGEA', 'Aegea Saneamento',
  'Águas de Teresina', 'Aguas de Teresina', 'Águas de Timon', 'Aguas de Timon',
  'Águas do Rio', 'Aguas do Rio', 'Águas do Rio 1', 'Águas do Rio 4',
  'Naturgy', 'Agenersa', 'Regenera', 'Comlurb',
  'Hekos', 'Orizon', 'Solvi', 'União Norte',
  'Uniao Norte', 'Vital', 'Eletromidia', 'Eletromídia',
  'AkzoNobel', 'Expedia', 'Hotels.com', 'Vrbo',
  'RTSC', 'Gramado Parks', 'Grupo Wish', 'Huawei',
  'Carrefour', 'Atacadão', 'Atacadao', 'Walmart',
  "Sam's Club", 'Sams Club', 'JBS', 'Friboi',
  'Seara', 'Swift', "Pilgrim's", 'Pilgrims',
  'Wild Fork', 'Ajinomoto', 'Vibra', 'Vibra Energia',
  'BR Distribuidora', 'Raízen', 'Raizen', 'Mindlab',
  'ABVTEX', 'Semove', 'Barcas', 'Seta',
  'Nova Infra', 'BRT'
];

function clientesCitadosNaProposicao(p) {
  const texto = [p.cliente, p.clientes, p.autor, p.autores, p.tipo, p.rotulo, p.titulo, p.identificacao, p.ementa]
    .filter(Boolean)
    .join(' ');
  const achados = [];
  for (const nome of CLIENTES_NOMES_PROPRIOS) {
    const escaped = nome.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(^|[^A-Za-zÀ-ÿ0-9])' + escaped + '([^A-Za-zÀ-ÿ0-9]|$)', 'i');
    if (re.test(texto) && !achados.some(a => a.toLowerCase() === nome.toLowerCase())) achados.push(nome);
  }
  return achados;
}

function anotarClientesCitados(proposicoes) {
  for (const p of proposicoes || []) {
    const clientes = clientesCitadosNaProposicao(p);
    p.clientesCitados = clientes;
    if (clientes.length && p.ementa && !String(p.ementa).includes('Cliente citado:')) {
      p.ementa = String(p.ementa).trim() + ' | Cliente citado: ' + clientes.join(', ');
    }
  }
}

function mlEscapeHtmlClienteDestaque(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function mlEscapeRegExpClienteDestaque(valor) {
  return String(valor).replace(/[.*+?^\${}()|[\]\\]/g, '\\$&');
}

function mlDestacarTermosClienteEmail(texto, clientes) {
  const nomes = Array.from(new Set([...(clientes || []), ...CLIENTES_NOMES_PROPRIOS]))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (!nomes.length) return mlEscapeHtmlClienteDestaque(texto);

  const regex = new RegExp('(^|[^A-Za-zÀ-ÿ0-9])(' + nomes.map(mlEscapeRegExpClienteDestaque).join('|') + ')(?=[^A-Za-zÀ-ÿ0-9]|$)', 'gi');
  return mlEscapeHtmlClienteDestaque(texto).replace(regex, (match, prefixo, termo) => {
    return prefixo + '<span style="background:#dbeafe;color:#1e3a8a;font-weight:700;border-radius:3px;padding:1px 3px">' + termo + '</span>';
  });
}

function renderizarEmentaCliente(p, renderBase) {
  const texto = String((p && p.ementa) || '-');
  const partes = texto.split(/\s+\|\s+Cliente citado:\s+/i);
  const ementa = renderBase
    ? renderBase(partes[0])
    : mlDestacarTermosClienteEmail(partes[0], p && p.clientesCitados);
  const clientes = partes.length > 1
    ? partes.slice(1).join(' | Cliente citado: ')
    : ((p && p.clientesCitados) || []).join(', ');

  if (!clientes) return ementa;
  return ementa + '<div style="margin-top:6px">' +
    '<span style="display:inline-block;background:#eef6ff;border:1px solid #bfdbfe;color:#1e3a8a;border-radius:999px;padding:3px 8px;font-size:11px;font-weight:700">' +
    'Cliente citado: ' + mlDestacarTermosClienteEmail(clientes, p && p.clientesCitados) +
    '</span></div>';
}

async function enviarEmail(novas) {
  anotarClientesCitados(novas);
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: EMAIL_REMETENTE, pass: EMAIL_SENHA },
  });

  // Agrupa por tipo
  const porTipo = {};
  novas.forEach(p => {
    const tipo = p.tipo || 'OUTROS';
    if (!porTipo[tipo]) porTipo[tipo] = [];
    porTipo[tipo].push(p);
  });

  const linhas = Object.keys(porTipo).sort(compararTiposEmail).map(tipo => {
    const header = `<tr><td colspan="5" style="padding:10px 8px 4px;background:#f0f4f8;font-weight:bold;color:#003d7a;font-size:13px;border-top:2px solid #003d7a">${tipo} — ${porTipo[tipo].length} proposição(ões)</td></tr>`;
    const rows = porTipo[tipo].map(p =>
      `<tr>
        <td style="padding:8px;border-bottom:1px solid #eee;color:#555;font-size:12px">${p.tipo}</td>
        <td style="padding:8px;border-bottom:1px solid #eee"><strong><a href="${p.url || PORTAL_BASE}" style="color:#003d7a;text-decoration:none">${p.numero}/${p.ano}</a></strong></td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px">${p.autor}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px;white-space:nowrap">${p.data}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px">${renderizarEmentaCliente(p)}</td>
      </tr>`
    ).join('');
    return header + rows;
  }).join('');

  const html = `
    <div style="font-family:Arial,sans-serif;width:100%;max-width:960px;margin:0 auto">
      <h2 style="color:#003d7a;border-bottom:2px solid #003d7a;padding-bottom:8px">
        🏛️ Pernambuco — ${novas.length} nova(s) proposição(ões)
      </h2>
      <p style="color:#666">Monitoramento automático — ${new Date().toLocaleString('pt-BR')}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead>
          <tr style="background:#003d7a;color:white">
            <th style="padding:10px;text-align:left">Tipo</th>
            <th style="padding:10px;text-align:left">Número/Ano</th>
            <th style="padding:10px;text-align:left">Autor</th>
            <th style="padding:10px;text-align:left">Data Publicação</th>
            <th style="padding:10px;text-align:left">Ementa</th>
          </tr>
        </thead>
        <tbody>${linhas}</tbody>
      </table>
      <p style="margin-top:20px;font-size:12px;color:#999">
        Acesse: <a href="https://proposicoes.alepe.pe.gov.br/">proposicoes.alepe.pe.gov.br</a>
      </p>
    </div>
  `;

  await transporter.sendMail({
    from: `"Monitor Pernambuco" <${EMAIL_REMETENTE}>`,
    to: EMAIL_DESTINO,
    subject: `🏛️ Pernambuco: ${novas.length} nova(s) proposição(ões) — ${new Date().toLocaleDateString('pt-BR')}`,
    html,
  });

  console.log(`✅ Email enviado com ${novas.length} proposições novas.`);
}

(async () => {
  console.log('🚀 Iniciando monitor ALEPE-PE...');
  console.log(`⏰ ${new Date().toLocaleString('pt-BR')}`);

  const estado = carregarEstado();
  const maiorDocidVisto = estado.maior_docid_visto || 0;
  console.log(`📌 Maior docid visto até agora: ${maiorDocidVisto}`);

  const raw = await buscarTodasProposicoes();
  console.log(`📊 Total recebido: ${raw.length} proposições`);

  if (raw.length === 0) {
    console.log('⚠️ Nenhuma proposição encontrada. Encerrando.');
    process.exit(0);
  }

  const proposicoes = raw.map(normalizarProposicao).filter(p => p.docid > 0);

  // Detecta novas pelo docid — maior docid = mais recente
  const novas = proposicoes.filter(p => p.docid > maiorDocidVisto);
  console.log(`🆕 Proposições novas (docid > ${maiorDocidVisto}): ${novas.length}`);

  // Atualiza o maior docid visto
  const novoMaiorDocid = Math.max(maiorDocidVisto, ...proposicoes.map(p => p.docid));

  if (novas.length > 0) {
    // Ordena por tipo alfabético, depois por número decrescente dentro de cada tipo
    novas.sort((a, b) => {
      if (a.tipo < b.tipo) return -1;
      if (a.tipo > b.tipo) return 1;
      return (parseInt(b.numero) || 0) - (parseInt(a.numero) || 0);
    });

    await enviarEmail(novas);
  } else {
    console.log('✅ Sem novidades. Nada a enviar.');
  }

  estado.maior_docid_visto = novoMaiorDocid;
  estado.ultima_execucao = new Date().toISOString();
  salvarEstado(estado);
  console.log(`💾 Estado salvo. Maior docid: ${novoMaiorDocid}`);
})();
