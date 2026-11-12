# Consultório Nutri

Software pessoal de acompanhamento nutricional entre consultas: anamneses, histórico,
questionários pelo WhatsApp, medições, motor de cálculos metabólicos e apoio de IA.

- A especificação completa e as decisões do projeto estão em [ESPECIFICACAO.md](ESPECIFICACAO.md).
- Este repositório contém **apenas código**. Nenhum dado de paciente fica aqui: os dados ficam no Supabase.
- Endereço do sistema: **https://carolinawaldhelm.github.io/consultorio_nutri/**

## Situação

| Fase | O que entrega | Situação |
|---|---|---|
| 1 | Login, cadastro rápido, importação do Nutrium, ficha, painel de anotações, histórico de anamneses, resumo pré-consulta (IA modo B) | ✅ Pronta |
| 2 | Medições (texto, foto via IA, tabela), gráficos, motor de cálculos, histórico de cálculos | ✅ Pronta |
| 3 | Google Agenda e alerta de 50 dias | ✅ Pronta |
| 4 | Questionários e WhatsApp | Próxima |
| 5 | IA modo B (já antecipada nas Fases 1 e 2) | ✅ |
| 6 | Exames, PDF, insights, backup | — |

## Configuração (feita uma vez)

### 1. Banco de dados (Supabase)
1. No painel do Supabase, abra o projeto e clique em **SQL Editor** → **New query**.
2. Copie todo o conteúdo do arquivo [`supabase/schema.sql`](supabase/schema.sql), cole e clique em **Run**.
   Deve aparecer "Success. No rows returned".
   *(A cada fase nova, o arquivo ganha tabelas novas: é só rodar de novo. Ele não apaga dados.)*

### 2. Sua conta de acesso
1. No Supabase: **Authentication** → **Users** → **Add user** → **Create new user**.
2. Digite seu e-mail e uma senha, marque **Auto Confirm User** e clique em **Create user**.
3. Em **Authentication** → **Sign In / Providers**, desligue **"Allow new users to sign up"** e salve.
   Assim ninguém mais consegue criar conta no seu sistema.

### 3. Colocar o site no ar (GitHub Pages)
1. No GitHub, abra o repositório → **Settings** → **Pages**.
2. Em **Source**, escolha **Deploy from a branch**. Em **Branch**, escolha **main** e **/ (root)**, e clique em **Save**.
3. Em 1 a 2 minutos, o site fica disponível em https://carolinawaldhelm.github.io/consultorio_nutri/

## Para quem for mexer no código

- Site estático, sem etapa de build: HTML + módulos JavaScript ([Preact](https://preactjs.com/) + `htm` via CDN).
- Banco, login e regras de acesso: Supabase (`supabase/schema.sql`, idempotente).
- Leitura da planilha do Nutrium: [SheetJS](https://sheetjs.com/), carregado só na tela de importação.
- Gráficos: [Chart.js](https://www.chartjs.org/) 4.4.1, carregado só quando há gráfico.
- Para rodar localmente: `python3 -m http.server` na pasta do projeto e abrir `http://localhost:8000`.

```
index.html            página única
css/style.css         estilos
js/app.js             rotas (#/, #/paciente/:id, #/importar) e login
js/config.js          endereço e chave pública do Supabase
js/lib/               banco, utilitários, leitura do Nutrium
js/views/             telas
supabase/schema.sql   estrutura do banco
```
