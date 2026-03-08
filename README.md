# Smart Choice Vendas - Base Profissional

Projeto full-stack para loja de celulares e acessorios com:
- Cadastro multi-etapa + verificacao por codigo.
- Login de usuario/admin.
- Bonus automatico de 50 creditos no cadastro ativo.
- Vitrine com ofertas para iniciantes.
- Troca por creditos (saldo minimo obrigatorio).
- Painel admin oculto com master key para ajuste manual de creditos.
- Tickets de suporte (IA triagem -> humano no admin).
- Programa parceiro com bonus mensal automatico de 100 creditos.
- Logs de atividade e analytics de visitantes/vendas.

## Estrutura

- `index.html` + `styles.css` + `script.js`: frontend principal (cliente).
- `painel-admin-pedro-oculto.html` + `admin.css` + `admin.js`: painel admin (URL oculta).
- `server/`: API Node/Express + SQLite.
- `desktop-admin/`: app desktop Electron para gerar `.exe` do painel admin.

## Credenciais iniciais

- Admin: `pedro dono`
- Senha: `12345678`
- Master key de ajuste de creditos: `03142911`

## Como rodar

1. Instale Node.js 20+.
2. Abra `server/` e instale dependencias:
   - `npm install`
3. Copie `.env.example` para `.env` e ajuste os valores.
4. Inicie o backend:
   - `npm start`
5. Abra `index.html` no navegador para area cliente.
6. Abra `painel-admin-pedro-oculto.html` no navegador para area admin.

### SMTP Gmail (codigo de verificacao por e-mail)

Se usar Gmail no `SMTP_USER`, o `SMTP_PASS` precisa ser uma **Senha de App** (16 caracteres), nao a senha normal da conta.

Passos:
1. Ative a verificacao em duas etapas na conta Google.
2. Gere uma Senha de App para "Mail".
3. Coloque essa senha no `SMTP_PASS`.

Enquanto SMTP nao estiver valido, a API retorna `dev_code` (se `SHOW_DEV_CODE=true`) para teste local.

### Plano B (Brevo API - recomendado em producao)

Se SMTP estiver instavel no Render, use Brevo via API:
- `EMAIL_PROVIDER=BREVO` (ou `AUTO`)
- `BREVO_API_KEY=<sua_chave_brevo>`
- `BREVO_FROM_EMAIL=<email_remetente_verificado_na_brevo>`
- `BREVO_FROM_NAME=Smart Choice Vendas`
- `BREVO_TIMEOUT_MS=5000`

No modo `AUTO`, se Brevo estiver configurado ele e usado primeiro, com fallback para SMTP.

### Timeout de e-mail (performance)

Para evitar travamento no cadastro quando o SMTP demora:
- `SMTP_CONNECTION_TIMEOUT_MS` (padrao: 4000)
- `SMTP_GREETING_TIMEOUT_MS` (padrao: 4000)
- `SMTP_SOCKET_TIMEOUT_MS` (padrao: 8000)
- `SMTP_SEND_TIMEOUT_MS` (padrao: 5000)

## Fluxos principais

- Cadastro:
  1. Etapa 1 envia codigo.
  2. Etapa 2 valida codigo e ativa usuario.
  3. Sistema credita +50 automaticamente.

- Compras:
  - Pedido em dinheiro entra pendente.
  - Admin aprova pedido no painel.
  - Sistema aplica premio em creditos ao cliente.

- Troca por creditos:
  - Botao so conclui quando `saldo >= preco_creditos`.

- Parceiro:
  - Usuario envia CPF/CNPJ + regiao.
  - Admin ativa parceiro no painel.
  - Cron mensal credita +100 automaticamente.

## Observacoes de seguranca

- Senhas com hash `bcrypt`.
- Queries parametrizadas (mitigacao SQL Injection).
- Logs para auditoria de alteracoes no admin.
- Ajuste manual de creditos exige master key.

## SEO

Meta tags do frontend foram otimizadas para buscas de celulares (Redmi, Xiaomi, Realme, iPhone, Samsung).
