# Smart Choice Admin Desktop (EXE)

Aplicativo desktop em Electron para abrir o mesmo painel admin do site, usando o mesmo backend e banco.

## O que fica interligado

- Painel web e painel EXE usam as mesmas APIs.
- Alteracoes feitas no EXE aparecem no site.
- Usuarios, pedidos, creditos, produtos e tickets ficam sincronizados no mesmo banco.

## Executar em modo dev

```powershell
cd "C:\Users\ferra\OneDrive\Documentos\New project\desktop-admin"
npm install
npm start
```

## Gerar instalador EXE

```powershell
cd "C:\Users\ferra\OneDrive\Documentos\New project\desktop-admin"
powershell -ExecutionPolicy Bypass -File .\build-exe.ps1
```

Saida esperada:
- instalador em `desktop-admin\dist\` (arquivo `Smart Choice Admin Setup ... .exe`)

## URLs configuraveis no app

No menu do app:
- `Painel -> Abrir configuracoes`

Campos:
- URL do painel web
- URL da API backend

Padrao:
- Painel: `https://smart-choice-vendas.pages.dev/painel-admin-pedro-oculto.html`
- API: `https://smart-choice-vendas.onrender.com/api`
