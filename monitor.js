const fs = require('fs');
const nodemailer = require('nodemailer');

const EMAIL_DESTINO = process.env.EMAIL_DESTINO;
const EMAIL_REMETENTE = process.env.EMAIL_REMETENTE;
const EMAIL_SENHA = process.env.EMAIL_SENHA;
const ARQUIVO_ESTADO = 'estado.json';
const API_BASE = 'https://dadosabertos.alepe.pe.gov.br/api/v1/proposicoes';
const LEGISLATURA = 20; // XX Legislatura (2023-2026)

// Endpoints por tipo de proposição
const ENDPOINTS = [
  { path: 'projetos',      label: 'Projetos de Lei' },
  { path: 'indicacoes',    label: 'Indicações' },
  { path: 'requerimentos', label: 'Requerimentos' },
];

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
  return {
    docid: parseInt(p.docid) || 0,
    tipo: p.tipo || '-',
    numero: p.numero || '-',
    ano: p.ano || '-',
    autor: p._autores || '-',
    data: p.dataPublicacao || '-',
    ementa: (p.ementa || '-').substring(0, 200),
  };
}

async function enviarEmail(novas) {
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

  const linhas = Object.keys(porTipo).sort().map(tipo => {
    const header = `<tr><td colspan="5" style="padding:10px 8px 4px;background:#f0f4f8;font-weight:bold;color:#003d7a;font-size:13px;border-top:2px solid #003d7a">${tipo} — ${porTipo[tipo].length} proposição(ões)</td></tr>`;
    const rows = porTipo[tipo].map(p =>
      `<tr>
        <td style="padding:8px;border-bottom:1px solid #eee;color:#555;font-size:12px">${p.tipo}</td>
        <td style="padding:8px;border-bottom:1px solid #eee"><strong>${p.numero}/${p.ano}</strong></td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px">${p.autor}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px;white-space:nowrap">${p.data}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px">${p.ementa}</td>
      </tr>`
    ).join('');
    return header + rows;
  }).join('');

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:900px;margin:0 auto">
      <h2 style="color:#003d7a;border-bottom:2px solid #003d7a;padding-bottom:8px">
        🏛️ ALEPE — ${novas.length} nova(s) proposição(ões)
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
    from: `"Monitor ALEPE" <${EMAIL_REMETENTE}>`,
    to: EMAIL_DESTINO,
    subject: `🏛️ ALEPE: ${novas.length} nova(s) proposição(ões) — ${new Date().toLocaleDateString('pt-BR')}`,
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
