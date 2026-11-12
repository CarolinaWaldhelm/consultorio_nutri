# Notas para o Claude

- A usuária é uma nutricionista, **sem conhecimento de programação**. Converse em português, sem jargão,
  e dê instruções passo a passo (onde clicar) para tudo que ela precisar fazer fora do código.
- **Leia `ESPECIFICACAO.md` antes de qualquer mudança.** É a fonte das decisões já tomadas. Não reabra
  decisões registradas ali sem ela pedir. Quando algo mudar, atualize o documento no mesmo commit.
- Custo zero: só serviços gratuitos (Supabase free, GitHub Pages). IA no "modo B" (copiar e colar,
  sem chamar API nenhuma). Nada que gere cobrança sem ela pedir.
- Cálculos (IMC, TMB, GET, meta) sempre em código, nunca por IA. Valores extraídos por IA sempre passam
  por uma tela de revisão antes de salvar.
- Nenhum dado de paciente no repositório (ele é público). Nada de planilhas, prints ou exemplos reais.
- Stack: site estático sem build (Preact + htm via CDN com versões fixas), Supabase para dados e login.
  Mudanças no banco vão em `supabase/schema.sql`, sempre idempotentes (`if not exists`, `create or replace`);
  depois de mudar, peça para ela rodar o arquivo de novo no SQL Editor.
- Publicação: GitHub Pages a partir da branch `main`. Um push em `main` publica o site.
- Atualize a tabela de situação das fases no `README.md` ao concluir cada fase.
