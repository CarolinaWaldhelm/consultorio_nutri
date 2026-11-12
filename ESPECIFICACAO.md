# Software de Acompanhamento Nutricional — Especificação

Documento de referência do projeto. Tudo o que foi decidido nas conversas de planejamento está aqui.
Quando algo mudar, este arquivo é atualizado primeiro.

- **Usuária:** uma única nutricionista (atendimento remoto). Ninguém mais acessa o sistema.
- **Papel do Nutrium:** continua sendo a ferramenta de prescrição e o app do paciente.
  A inteligência da gestão (anamnese, histórico, questionários, cálculos) fica neste software.

---

## 0. Princípios

1. **Custo zero.** Só serviços gratuitos (ver §12).
2. **IA no "modo B" (copiar e colar).** O sistema não chama nenhuma IA diretamente. Ele monta o pedido
   pronto, **sem dados pessoais**, a nutricionista cola na IA que já assina e cola a resposta de volta.
   O código fica preparado para trocar para IA automática (modo A) no futuro, só com uma configuração.
3. **Cálculos nunca são feitos por IA.** IMC, TMB, GET e meta calórica são código fixo. A IA só interpreta
   texto (fator de atividade) e lê documentos (fotos e exames).
4. **Nada extraído por IA é salvo sem confirmação.** Sempre há uma tela de revisão antes de salvar.
5. **Privacidade.** Nos pedidos para a IA, o paciente aparece só como código (ex.: `P-0042`), sexo e idade.
   Nunca nome, e-mail, telefone ou CPF.

---

## 1. Estrutura de navegação

Menu principal:

- **Pacientes** (tela inicial)
- **Questionários**

Não existe aba "Gráficos": todos os gráficos ficam dentro da ficha de cada paciente.

Login: e-mail e senha da nutricionista, com a conta criada no painel do Supabase. O cadastro de novas contas fica desligado, então só ela entra.

---

## 2. Tela inicial — Pacientes

1. **Busca** de paciente por nome.
2. **Próximas consultas** (vindas do Google Agenda, ver §9):

   | Horário | Paciente | Última consulta | Dias passados |
   |---|---|---|---|
   | 09:00 | Maria Silva | 12/10/2026 | Há 30 dias |
   | 10:30 | João Santos | Primeira consulta | – |

   Eventos não vinculados aparecem com ⚠️ e as ações `[Vincular a paciente]` `[Criar cadastro]`.
3. **Pacientes sem retorno há mais de 50 dias.** Contam como atualização: uma consulta **ou** uma resposta
   de questionário. Ações: `[Marcar como inativo / pausar questionários]`, `[Manter ativo]`,
   `[Registrar nova consulta]`.
4. **Botão `[Importar planilha do Nutrium]`** (ver §8).
5. **Botão `[+ Cadastro rápido]`:** nome, data de nascimento e telefone.

---

## 3. Ficha do paciente

### 3.1 Cabeçalho fixo

- Nome, idade, data de nascimento e telefone.
- Data da última consulta e dias decorridos.
- Status dos questionários: **ativo / pausado** (alternável aqui).
- Botões:
  - `[▶ Iniciar consulta de hoje]`: cria o registro da consulta com a data do dia e o tipo (inicial, se não há
    consulta anterior; retorno, nos demais casos) e abre o painel de anotações.
  - `[➕ Registrar consulta em outra data]`: cria uma consulta **separada** numa data escolhida (para lançar
    consultas antigas). O tipo é sugerido pela data e pode ser trocado.
  - `[📋 Painel de anotações]`
  - `[➕ Medição / Bioimpedância]`
  - `[📄 Exames laboratoriais]`

### 3.2 Painel lateral de anotações (drawer)

Fica aberto durante o atendimento e permite navegar pela ficha ao fundo sem perder o que está sendo digitado.
- Botões `[💾 Salvar]` (no topo), `[💾 Salvar e fechar]` e `[➕ Outra consulta]` (no final). Além disso, o texto
  também é salvo sozinho enquanto ela digita.
- O campo "Data desta consulta" muda a data **da mesma consulta** (pede confirmação e não deixa usar uma data
  que já tem outra consulta). Para uma consulta diferente, usa-se `[➕ Outra consulta]`.

**A. Anamnese inicial**

1. Objetivos da consulta: texto livre **+ seleção obrigatória no final**
   (Perda de peso · Recomposição corporal · Manutenção · Ganho de massa).
2. Funcionamento do intestino e água
3. Qualidade do sono
4. Tabaco
5. Álcool
6. Atividade física: texto livre (tipo, dias por semana, duração). É a base do fator de atividade.
7. Doenças diagnosticadas
8. Medicações de uso contínuo
9. Alimentos mal aceitos
10. Alimentos favoritos
11. Alergias e intolerâncias
12. Observações sobre exames iniciais (os valores entram na seção de exames, §3.7)
13. **Combinados / Conduta:** o que foi alinhado com o paciente (metas, orientações)

**B. Anamnese de retorno**

1. Relato sobre intestino e água
2. Relato de sono
3. Relato de atividade física: sempre preenchido. **É o texto que o motor de cálculos usa**
   (vale o da anamnese mais recente).
4. Objetivo: mantém o anterior ou altera a seleção.
5. **Combinados / Conduta**
6. **Resumo do mês:** escrito pela nutricionista, no final. Inclui mudanças de medicação, novas doenças
   e adesão ao plano (não há campos separados para isso). Alimenta o resumo pré-consulta.

### 3.3 Resumo pré-consulta e memória (IA, modo B)

- `[Gerar pedido de resumo]`: monta o pedido com todas as anamneses, resumos do mês, combinados,
  respostas de questionários desde a última consulta e a evolução de peso. A IA devolve:
  - o resumo do período;
  - pontos de atenção e problemas que ficaram para trás;
  - perguntas sugeridas para a consulta.
- O resultado colado fica salvo na ficha, com a data (tabela `ai_notes`). O mais recente aparece aberto e os
  anteriores ficam em "Ver resumos anteriores".
- *Antecipado da Fase 5 para a Fase 1, a pedido da nutricionista.*
- **Pergunta sobre o histórico:** campo de pergunta livre (ex.: "Qual meta de água combinamos na consulta 3?").
  O sistema monta o pedido com o histórico e a pergunta.

### 3.4 Questionários

- Resumo do último questionário respondido.
- Gráficos de linha das perguntas de escala ao longo do tempo (ex.: intestino de 0 a 5).
- Histórico das respostas, agrupado pelo modelo de questionário que as gerou.

### 3.5 Composição corporal

**Entrada de dados (`[➕ Medição / Bioimpedância]`), por três caminhos:**

1. **Texto livre:** ex. "peso 54,2 cintura 71 gordura 22%". É interpretado por código quando possível;
   se não for, vira um pedido para a IA.
2. **Foto ou print da bioimpedância (modo B):** `[Copiar instruções]` → ela cola na IA junto com a foto →
   a IA devolve um bloco padronizado → `[Colar resultado]`.
3. **Tabela manual.**

Em todos os casos, aparece uma tela de revisão com os valores antes de salvar.

**Lista fixa de medidas:**

- Básicas: peso (kg), altura (cm). O IMC é calculado.
- Circunferências (cm): cintura, quadril, abdômen, braço, coxa.
- Bioimpedância: % gordura, massa gorda (kg), massa magra (kg), massa muscular esquelética (kg),
  água corporal (%), gordura visceral (nível), TMB do aparelho (kcal).
- O que vier fora da lista é guardado como observação, sem gráfico.

**Origem e prioridade:**

- Do Nutrium, entram **só peso e altura** (ver §8).
- Vale sempre o valor mais recente. Se houver mais de um no mesmo dia, o registrado pela nutricionista
  tem prioridade sobre o registrado pelo paciente no app.
- Cada valor mostra a origem: "consulta" ou "Nutrium (app)".

**Visualização:**

- Gráfico de evolução de cada medida. Meses sem dado não quebram a linha.
- `[📄 Gerar PDF dos gráficos]` para enviar ao paciente.
- `[Relatório de evolução por IA]`: só quando ela pedir (modo B).

### 3.6 Motor de cálculos

**Entradas:** sexo, idade (calculada pela data de nascimento), peso e altura mais recentes, massa magra
(se houver, registrada por ela nos últimos 60 dias), texto de atividade da anamnese mais recente e
objetivo selecionado.

- Gênero "Outro" ou ausente: o sistema pede o sexo para o cálculo.

**Classificação do IMC**

| Adultos (< 60 anos, OMS) | | Idosos (≥ 60 anos, Lipschitz / SISVAN) | |
|---|---|---|---|
| < 18,5 | Baixo peso | < 22 | Baixo peso |
| 18,5–24,9 | Eutrofia | 22–27 | Eutrofia |
| 25–29,9 | Sobrepeso | > 27 | Sobrepeso |
| 30–34,9 | Obesidade I | | |
| 35–39,9 | Obesidade II | | |
| ≥ 40 | Obesidade III | | |

**Fórmulas de TMB.** Todas são calculadas e mostradas lado a lado. A recomendada fica destacada com o
motivo, e ela pode trocar com um clique.

| Fórmula | Equação |
|---|---|
| Mifflin-St Jeor | H: 10·P + 6,25·A − 5·I + 5  ·  M: 10·P + 6,25·A − 5·I − 161 |
| Harris-Benedict revisada (Roza & Shizgal, 1984) | H: 88,362 + 13,397·P + 4,799·A − 5,677·I  ·  M: 447,593 + 9,247·P + 3,098·A − 4,330·I |
| Harris-Benedict com peso ajustado | mesma equação, com P = peso ideal + 0,25 × (peso atual − peso ideal) |
| Katch-McArdle | 370 + 21,6 × massa magra (kg) |

(P = peso em kg, A = altura em cm, I = idade em anos. Peso ideal = IMC 22 × altura² em metros, editável.)

**Regra de recomendação:**

- Eutrofia, sobrepeso ou obesidade: **Mifflin-St Jeor com peso atual.** É a de melhor precisão em adultos
  não hospitalizados, inclusive com obesidade.
- Há massa magra recente e paciente muito ativo ou com muita massa muscular: sugerir **Katch-McArdle**
  como alternativa. Em obesidade, avisar que a bioimpedância pode ser menos precisa.
- Harris-Benedict (com ou sem peso ajustado) sempre disponível para escolha manual.

**Fator de atividade (IA, modo B):** a IA lê o texto de atividade e escolhe um nível da escala, com a
justificativa. A nutricionista confirma ou troca.

| Nível | Fator |
|---|---|
| Sedentário | 1,2 |
| Levemente ativo | 1,375 |
| Moderadamente ativo | 1,55 |
| Muito ativo | 1,725 |
| Extremamente ativo | 1,9 |

**Meta calórica**

- GET = TMB × fator de atividade.
- Ajuste pelo objetivo. Os percentuais padrão são editáveis nas configurações e ajustáveis em cada cálculo:

  | Objetivo | Ajuste |
  |---|---|
  | Perda de peso | −20% |
  | Recomposição corporal | −10% |
  | Manutenção | 0% |
  | Ganho de massa | +10% |

- **O déficit e o superávit nunca são sugeridos por IA.**
- Alerta se a meta ficar abaixo da TMB.
- **Histórico de cálculos:** cada cálculo é salvo com data, entradas, fórmula, fator, objetivo, ajuste e resultado.

### 3.7 Exames laboratoriais (final da ficha)

- `[📄 Anexar exame (PDF ou foto)]` → modo B → revisão → salvar. O arquivo original fica anexado.
- Biomarcadores com unidade padronizada e data do exame.
- Tabela histórica e um gráfico de linha por biomarcador.

### 3.8 Histórico de anamneses

Lista cronológica das consultas (data e tipo). Clicando, abre a íntegra.

### 3.9 Quadro de insights (IA, modo B)

- Monta o pedido com o perfil do paciente (doenças, medicações, objetivo, sexo e idade, sem dados pessoais)
  pedindo condutas baseadas em evidência, **com o link de cada fonte** (PubMed, diretrizes).
- É apoio à decisão e não substitui a conduta da nutricionista.
- *Detalhes a definir mais adiante.*

---

## 4. Questionários

### 4.1 Modelos

- Lista de modelos com nome e status (ativo / inativo). `[➕ Criar novo questionário]`.
- Tipos de pergunta: escala numérica (ex.: 0 a 5), texto livre e múltipla escolha.
- **Um modelo padrão ativo por vez**, enviado a todos os pacientes ativos.
- Não há edição de modelo já usado: para mudar, ela desativa o antigo e cria um novo. As respostas
  antigas continuam no histórico, ligadas ao modelo original, sem ligação com o novo.

### 4.2 Regras de envio

| Regra | Valor |
|---|---|
| Frequência geral (configurável) | a cada 7 dias, contados da última consulta |
| Não envia se há consulta marcada nos próximos | 3 dias |
| Reenvio para pendentes | após 3 dias sem resposta, entra na lista de reenvio |
| Pausa automática | após 2 questionários seguidos sem resposta |
| Retomada da pausa automática | na próxima consulta |
| Pausa manual por paciente | na ficha ou na aba Questionários |
| Link vence | quando é respondido ou quando o próximo questionário é enviado |

### 4.3 Envio semiautomático pelo WhatsApp (número pessoal)

- Aba **Questionários → "Envios de hoje"**: lista de quem deve receber, com `[Enviar]`.
- O clique abre o WhatsApp na conversa do paciente com a mensagem pronta e o link dele
  (`https://wa.me/55DDDNUMERO?text=...`). Ela só aperta enviar, e o sistema marca como enviado.
- Lista separada de **reenvios**.
- Paciente sem telefone aparece com aviso para completar o cadastro.

### 4.4 Link e resposta sem login

- Cada envio gera um código aleatório e impossível de adivinhar (ex.: `/q/k7Xp2mQ9...`), ligado no banco a:
  paciente, modelo e data de envio.
- O formulário abre com "Olá, [primeiro nome]!" e não mostra nenhum outro dado.
- A resposta cai direto no histórico do paciente.

### 4.5 Log de disparos e respostas

| Paciente | Questionário | Enviado em | Status |
|---|---|---|---|
| Maria Silva | Acompanhamento semanal | 05/11/2026 | 🟢 Respondido (há 2 dias), clicável para ver o resumo |
| João Santos | Acompanhamento semanal | 06/11/2026 | 🟡 Pendente (há 5 dias) |

---

## 5. Pacientes inativos

- Alerta após **50 dias** sem consulta **e** sem resposta de questionário.
- Inativo não recebe questionários até ser reativado ou ter nova consulta.

---

## 6. Fluxo diário

```
Durante o dia
  ├─ Home mostra as consultas do dia (Google Agenda)
  ├─ Paciente novo → cadastro rápido (nome, nascimento, telefone)
  └─ [Iniciar consulta] → anota a anamnese no painel lateral

Envios
  └─ Aba Questionários → "Envios de hoje" → clicar em [Enviar] em cada um

Final do dia (montagem dos planos)
  ├─ Exporta a planilha no Nutrium (chega por e-mail)
  ├─ [Importar planilha do Nutrium] → revisão dos não encontrados
  ├─ Motor de cálculos → meta calórica
  └─ Monta e entrega o plano no Nutrium
```

---

## 7. Data da última consulta

- **A partir do uso do software:** última consulta iniciada no software (`[Iniciar consulta]`).
- **Histórico anterior:** aba "Consultas" da planilha do Nutrium, considerando só datas até hoje.
  Datas repetidas no mesmo dia contam como uma consulta.
- *A verificar:* se consultas canceladas aparecem na exportação. Se aparecerem, o sistema usa a agenda
  para descartá-las.

---

## 8. Importação da planilha do Nutrium

**Como exportar:** no Nutrium, menu do usuário → Privacidade e notificações → "Exportar informações de
todos os clientes". O arquivo chega por e-mail. Usar o **.xlsx** exatamente como chega, sem editar.
O .csv tem problema de acentuação.

**Abas usadas:**

| Aba | Colunas | O que o sistema usa |
|---|---|---|
| Perfil do paciente | E-mail, Nome, Data de nascimento, Gênero, Telefone, Data de registro, Etiquetas, Local de consulta (+ colunas sempre vazias) | Cadastro |
| Consultas | E-mail, Data, Hora de início, Hora de término | Histórico de consultas antigas |
| Medições | E-mail, Medição, Data, Valor, Unidade, Registrada por | **Só "Peso" e "Altura"**. O resto é ignorado |

**Cruzamento com os pacientes do sistema (nesta ordem):**

1. **E-mail.** Pacientes sem e-mail têm um e-mail interno da Nutrium (`k1234567@patients.nutrium.com`),
   que também funciona como ID.
2. Nome (sem acentos, minúsculas, sem espaços extras) + data de nascimento.
3. Se nenhum bater, entra na **tela de revisão**: "X pacientes não encontrados: vincular a um existente
   ou criar novo".

**Regras:**

- Mesma pessoa com duas contas (e-mails diferentes): juntar num paciente só. O e-mail da conta com data
  mais recente vira o principal e o antigo fica guardado como secundário.
- Telefone: o do sistema prevalece (no Nutrium quase sempre está vazio).
- **Pacientes inativos há mais de 150 dias não entram.** A última atividade é a consulta mais recente na aba
  Consultas (inclusive agendada) ou, sem consultas, a data de registro. Se estiver há mais de 150 dias, o paciente
  é ignorado na importação.
- Pacientes antigos (mais de 150 dias) que **já estão no sistema** podem ser removidos na própria importação
  (caixa marcada por padrão), **desde que não tenham nada escrito pela nutricionista**: nenhuma consulta registrada
  no software, nenhum resumo e nenhum telefone. Os que têm alguma dessas coisas continuam.
- Fora isso, a importação nunca apaga dados do sistema, só acrescenta ou atualiza.

---

## 9. Google Agenda

- Leitura pelo **endereço secreto no formato iCal** da agenda (Google Agenda → Configurações da agenda →
  "Endereço secreto no formato iCal"). Não precisa de Google Cloud. Somente leitura.
- *A verificar:* se o iCal traz o e-mail do convidado. Se não trouxer, o vínculo é feito só pelo nome.
- Só considera eventos cujo título começa com **"Consulta de nutrição - "**.
- Vínculo com o paciente: 1º pelo **e-mail do convidado**, 2º pelo **nome no título**, 3º "não vinculado"
  na home.
- Reagendamentos e cancelamentos são feitos no Nutrium e refletidos na agenda. O sistema sempre usa o
  estado atual da agenda para as próximas consultas e para a pausa de 3 dias.
- O telefone **não** vem pela agenda.

---

## 10. IA no modo B: como funciona na tela

1. Botão `[Copiar pedido para a IA]`: copia o texto com as instruções e os dados, sem identificação pessoal.
2. A nutricionista cola na IA que já assina (e anexa a foto ou o PDF, quando for o caso).
3. A IA responde num formato padronizado (instruído no pedido).
4. Botão `[Colar resposta]` → o sistema lê → tela de revisão → `[Confirmar e salvar]`.

É usado em: resumo pré-consulta, pergunta sobre o histórico, fator de atividade, leitura de bioimpedância,
leitura de exames, relatório de evolução e quadro de insights.

---

## 11. Segurança e LGPD

- Acesso só com o e-mail e a senha dela (novos cadastros desligados no Supabase).
- Sem camadas extras de criptografia, por decisão da usuária (uso pessoal).
- Banco com regras de acesso: o paciente só consegue gravar a resposta do próprio link, sem ler nada.
- Pedidos para a IA sem dados pessoais (código do paciente).
- Backup semanal (ver §12).
- O repositório do código é **público** (exigência do GitHub Pages gratuito). Ele nunca contém dados de pacientes.
- Recomendação: incluir no termo de atendimento que são usadas ferramentas digitais de acompanhamento.

---

## 12. Infraestrutura (custo zero)

| Parte | Serviço | Observação |
|---|---|---|
| Banco de dados, login e arquivos | Supabase (plano gratuito) — **única conta nova** | 500 MB de dados, 1 GB de arquivos (imagens comprimidas). Pausa após 7 dias sem uso |
| Site | GitHub Pages (gratuito) | Exige repositório público (só o código). Atualiza sozinho a cada mudança |
| Código | GitHub (repositório `consultorio_nutri`, em outra conta) | Versão de tudo e histórico de mudanças |
| Agenda | Endereço secreto iCal do Google Agenda | Gratuito, sem Google Cloud |
| WhatsApp | links `wa.me` | Gratuito |
| IA | modo B (assinatura que ela já tem) | Sem custo extra |
| Backup | cópia semanal da base, salva no Google Drive da nutricionista + botão `[Baixar backup]` | O plano gratuito do Supabase não faz backup |

---

## 13. Ordem de construção

| Fase | Entrega | Já dá para usar? |
|---|---|---|
| 1 | Login, cadastro rápido, importação do Nutrium, ficha, painel de anotações, iniciar consulta, histórico de anamneses, resumo pré-consulta e pergunta sobre o histórico (modo B) | Sim: substitui as anotações |
| 2 | Medições, gráficos, motor de cálculos, histórico de cálculos | Sim: cálculos rápidos |
| 3 | Google Agenda na home, alerta de 50 dias | Sim |
| 4 | Questionários: modelos, links, envios de hoje, reenvios, log, gráficos na ficha | Sim |
| 5 | IA modo B: fator de atividade, leitura de bioimpedância | Sim |
| 6 | Exames laboratoriais, PDF dos gráficos, relatório por IA, quadro de insights, backup automático | Sim |

---

## 14. Pendências

- [ ] Verificar se consultas canceladas aparecem na aba "Consultas" da exportação.
- [ ] Definir as perguntas do primeiro questionário padrão.
- [ ] Detalhar o quadro de insights.
