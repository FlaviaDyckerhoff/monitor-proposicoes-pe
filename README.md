# 🏛️ Monitor Proposições PE — ALEPE

Monitora automaticamente a API de Dados Abertos da Assembleia Legislativa de Pernambuco e envia email quando há proposições novas. Roda **4x por dia** via GitHub Actions (8h, 12h, 17h e 21h, horário de Brasília).

---

## Como funciona

1. O GitHub Actions roda o script nos horários configurados
2. O script chama a API pública da ALEPE (`dadosabertos.alepe.pe.gov.br/api/v1/proposicoes`)
3. Faz 3 chamadas em paralelo — uma por tipo: projetos, indicações e requerimentos
4. Compara os `docid` recebidos com o maior `docid` já registrado no `estado.json`
5. Se há proposições novas (docid maior que o último visto) → envia email com a lista organizada por tipo
6. Salva o estado atualizado no repositório

---

## Por que `docid` e não `estado.json` com lista de IDs?

A API da ALEPE retorna toda a legislatura de uma vez (sem filtro de data). O `docid` é sequencial e crescente — o maior `docid` = a proposição mais recente. Guardar apenas o maior `docid` visto é mais eficiente do que uma lista de milhares de IDs.

---

## Estrutura do repositório

```
monitor-proposicoes-pe/
├── monitor.js                      # Script principal
├── package.json                    # Dependências (só nodemailer)
├── estado.json                     # Estado salvo automaticamente pelo workflow
├── README.md                       # Este arquivo
└── .github/
    └── workflows/
        └── monitor.yml             # Workflow do GitHub Actions
```

---

## Setup — Passo a Passo

### PARTE 1 — Preparar o Gmail

**1.1** Acesse [myaccount.google.com/security](https://myaccount.google.com/security)

**1.2** Certifique-se de que a **Verificação em duas etapas** está ativa.

**1.3** Procure por **"Senhas de app"** e clique.

**1.4** Digite um nome qualquer (ex: `monitor-alepe`) e clique em **Criar**.

**1.5** Copie a senha de **16 letras** gerada — ela só aparece uma vez.

> Se já usa o mesmo Gmail em outro monitor, pode reutilizar a mesma App Password.

---

### PARTE 2 — Criar o repositório no GitHub

**2.1** Acesse [github.com](https://github.com) → **+ → New repository**

**2.2** Preencha:
- **Repository name:** `monitor-proposicoes-pe`
- **Visibility:** Private

**2.3** Clique em **Create repository**

---

### PARTE 3 — Fazer upload dos arquivos

**3.1** Clique em **"uploading an existing file"**

**3.2** Faça upload de:
```
monitor.js
package.json
README.md
```
Clique em **Commit changes**.

**3.3** Crie o workflow manualmente: **Add file → Create new file**, digite:
```
.github/workflows/monitor.yml
```
Cole o conteúdo do `monitor.yml` e clique em **Commit changes**.

---

### PARTE 4 — Configurar os Secrets

**Settings → Secrets and variables → Actions → New repository secret**

| Name | Valor |
|------|-------|
| `EMAIL_REMETENTE` | seu Gmail (ex: seuemail@gmail.com) |
| `EMAIL_SENHA` | a senha de 16 letras do App Password (sem espaços) |
| `EMAIL_DESTINO` | email onde quer receber os alertas |

---

### PARTE 5 — Testar

**5.1** Vá em **Actions → Monitor Proposições PE → Run workflow → Run workflow**

**5.2** Aguarde ~20 segundos. Verde = funcionou.

**5.3** O **primeiro run** envia email com todas as proposições da legislatura atual e salva o maior docid. A partir do segundo run, só envia se houver proposições novas.

---

## Email recebido

```
🏛️ ALEPE — 5 nova(s) proposição(ões)

INDICAÇÃO — 2 proposição(ões)
  450/2026 | Dep. Fulano     | 27/03/2026 | Indica pavimentação...
  449/2026 | Dep. Ciclano    | 27/03/2026 | Indica iluminação...

PROJETO DE LEI ORDINÁRIA — 1 proposição(ões)
  101/2026 | Dep. Beltrano   | 27/03/2026 | Dispõe sobre...

REQUERIMENTO — 2 proposição(ões)
  792/2026 | Dep. Fulano     | 27/03/2026 | Requer informações...
  791/2026 | Dep. Ciclano    | 27/03/2026 | Requer envio de...
```

---

## API utilizada

```
URL Base: https://dadosabertos.alepe.pe.gov.br/api/v1/proposicoes
Endpoints:
  GET /projetos/?legislatura=20
  GET /indicacoes/?legislatura=20
  GET /requerimentos/?legislatura=20

Formato: XML (sem autenticação)
```

---

## Resetar o estado

Para forçar o reenvio de tudo:

1. No repositório, clique em `estado.json` → lápis
2. Substitua o conteúdo por:
```json
{"maior_docid_visto":0,"ultima_execucao":""}
```
3. Commit → rode o workflow manualmente

---

## Problemas comuns

**Não aparece "Senhas de app" no Google**
→ Ative a verificação em duas etapas primeiro.

**Erro "Authentication failed" no log**
→ Verifique se `EMAIL_SENHA` foi colado sem espaços.

**Workflow não aparece em Actions**
→ Confirme que o arquivo está em `.github/workflows/monitor.yml`.

**Primeiro run sem email**
→ Verifique o spam. Se não estiver lá, abra o log do run em Actions e procure `❌`.

**Nova legislatura (2027+)**
→ Atualize a constante `LEGISLATURA = 20` no `monitor.js` para o número correto.
