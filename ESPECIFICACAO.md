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
2. **Próximas consultas** (Google Agenda, ver §9; sem agenda, planilha do Nutrium): as **15 próximas** que ainda
   não terminaram. Cada consulta **sai da lista quando o horário dela termina** (fim do evento; sem fim, 1 hora
   após o início) e as seguintes sobem. A tela se atualiza sozinha: relógio a cada minuto, agenda a cada 10 minutos,
   pacientes a cada 5 minutos e sempre que a aba do navegador volta a ficar ativa.

   | Horário | Paciente | Última consulta | Dias passados |
   |---|---|---|---|
   | Hoje 09:00 | Maria Silva | 12/10/2026 | Há 30 dias |
   | Amanhã 10:30 | João Santos | Primeira consulta | – |

   Eventos não vinculados aparecem com ⚠️ e as ações `[Vincular a paciente]` `[Criar cadastro]`.
   Vincular guarda no cadastro o e-mail do convidado e o nome do título (coluna `aliases`), e nas próximas
   vezes o vínculo é automático.
3. **✅ Lembretes** (coluna lateral fixa à direita; no celular, no topo): lista simples (tabela `todos`). Pendentes ficam até serem feitos, de um
   dia para o outro. Os marcados como feitos continuam visíveis, riscados, **até a meia-noite** do dia em que
   foram marcados; depois são apagados. Dá para desmarcar e apagar.
4. **Sem retorno há mais de 50 dias**: só quem **não tem consulta marcada** (na agenda, nos próximos 90 dias, ou
   na planilha). Com consulta marcada, não há aviso. Contam como atualização uma consulta ou uma resposta de
   questionário. Ação: `[Lembrar em 7 dias]` (coluna `snooze_until`). 15 visíveis, `[Mostrar mais]` de 10 em 10 e
   `[Mostrar menos]` (volta aos 15).
5. **Todos os pacientes**: 15 visíveis, `[Mostrar mais]` de 10 em 10 e `[Mostrar menos]`.
   **Não existe ativo/inativo** (decisão da nutricionista: o paciente não formaliza o fim do acompanhamento).
6. **Regra dos 100 dias, na hora:** paciente com mais de 100 dias da última consulta e nada marcado sai da lista
   de pacientes, do alerta de 50 dias e dos questionários, sem esperar a importação. Continua aparecendo **na busca
   por nome**, com a etiqueta "+100 dias". Se marcar consulta, volta sozinho. (Na importação, a regra remove de vez
   os que não têm anotações, ver §8.)
7. Avisos no topo: questionários para enviar hoje e backup semanal.
8. **Botão `[Importar planilha do Nutrium]`** (menu) e **`[+ Cadastro rápido]`** (nome, nascimento, telefone).

## 3. Ficha do paciente

### 3.1 Cabeçalho fixo

- Nome, idade, data de nascimento e telefone.
- Data da última consulta e dias decorridos.
- Envio de questionários: pausar/reativar para aquele paciente (na seção Questionários da ficha).
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
Em telas largas, a página abre espaço à direita para o painel. Uma consulta fechada sem nenhuma anotação é
apagada automaticamente (não fica vazia no histórico).
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

**B. Anamnese de retorno** (nesta ordem)

1. **Resumo do mês:** escrito pela nutricionista. Como foi o período: mudanças de medicação, novas doenças,
   acontecimentos. Alimenta o resumo pré-consulta.
2. Relato sobre intestino e água
3. Relato de sono
4. Relato de atividade física: sempre preenchido. **É o texto que o motor de cálculos usa**
   (vale o da anamnese mais recente).
5. Objetivo: mantém o anterior ou altera a seleção.
6. **Adesão ao plano do último mês:** o que o paciente conseguiu seguir, as dificuldades e o balanço do mês em
   relação à conduta combinada. Só existe no retorno.
7. **Combinados / Conduta**

**C. Copiar anotações do dia (para o Nutrium)**

- Botão na ficha (`[📋 Copiar anotações de hoje]`, ou da data mais recente com anotações) e no painel
  (`[📋 Copiar para o Nutrium]`, da data da consulta aberta).
- Junta num texto só: tipo e data da consulta, objetivo, todos os campos preenchidos da anamnese, as medidas
  registradas no dia (com a diferença para o registro anterior) e o último cálculo salvo no dia (dados, TMB,
  fator, GET, meta e macros). Inclui o nome do paciente: é só para colar no Nutrium, não vai para a IA.

### 3.3 Resumo pré-consulta (IA, modo B)

- Só um botão: `[📋 Copiar pedido de resumo]`. Ele monta o pedido com todas as anamneses, resumos do mês,
  combinados e a evolução do peso, sem dados pessoais. A IA devolve:
  - o resumo do período;
  - pontos de atenção e problemas que ficaram para trás;
  - combinados para conferir;
  - perguntas sugeridas para a consulta.
- A resposta não é colada de volta no sistema (decisão da nutricionista: basta copiar o pedido).

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

- Gráfico de evolução de cada medida com pelo menos 2 registros. Meses sem dado não quebram a linha.
- Histórico de medições por data e origem, com opção de apagar um registro.
- Salvar uma medida na mesma data substitui o valor anterior daquela data.
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

**Fator de atividade (IA, modo B):** botão que copia um pedido com o relato de atividade mais recente; a IA
responde com o nível e a justificativa, e a nutricionista clica no nível na tela. Sem escolha, não há resultado.

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
- Peso, altura e massa magra vêm preenchidos (os mais recentes) e podem ser ajustados só para aquele cálculo.
- O ajuste de cada objetivo pode ser salvo como novo padrão (tabela `app_settings`, chave `adjust_defaults`).

**Macronutrientes (passo 6 do motor)**

- **Peso de referência**, sugerido pelo IMC e editável (botões "usar peso atual" e "usar peso ajustado"):
  - Eutrofia ou baixo peso: peso atual.
  - Sobrepeso ou obesidade: peso ajustado = peso ideal + 0,25 × (peso atual − peso ideal); peso ideal = IMC 22 × altura².
  - O peso de referência é usado **só nos macros** (decisão da nutricionista). As fórmulas de TMB mantêm os pesos
    que cada uma usa (peso atual; peso ajustado só na "Harris-Benedict com peso ajustado"; massa magra na Katch-McArdle).
- **Distribuição:** proteína em g/kg do peso de referência, lipídios em % do VET (meta calórica), carboidratos
  completam o VET (1 g de proteína ou carboidrato = 4 kcal; 1 g de lipídio = 9 kcal).
- **Padrão inicial por objetivo** (editável e salvável como padrão, chave `macro_defaults`):

  | Objetivo | Proteína | Lipídios |
  |---|---|---|
  | Perda de peso | 2,0 g/kg | 30% do VET |
  | Ganho de massa (hipertrofia) | 2,0 g/kg | 25% do VET |
  | Recomposição corporal | 1,6 g/kg | 30% do VET |
  | Manutenção | 1,6 g/kg | 30% do VET |

- **Alertas (não bloqueiam):** proteína fora de 1,6–2,2 g/kg (perda de peso, hipertrofia, recomposição) ou
  1,2–1,6 g/kg (manutenção); lipídios fora de 20–35% do VET; carboidratos fora de 40–60% ou negativos.
- A tabela mostra g, g/kg, kcal e % do VET de cada macro, e o cálculo salvo guarda os macros (coluna `macros`).

### 3.7 Exames laboratoriais (final da ficha)

- `[📄 Registrar exame]`: `[Copiar instruções para a IA]` → ela cola na IA e anexa o laudo **lá na IA** → cola a
  resposta ("Nome: valor unidade", "Data: DD/MM/AAAA") → **revisão** (corrige, apaga, acrescenta) → salvar.
- **O arquivo do laudo não é guardado** (decisão da nutricionista). Fica guardada a resposta da IA (coluna `notes`),
  com o botão "Ver resposta da IA".
- Lista padrão de ~30 biomarcadores com unidade padrão (glicemia, HbA1c, insulina, perfil lipídico, TGO/TGP/GGT,
  creatinina, ureia, ácido úrico, TSH/T4L, hemograma básico, ferritina, ferro, vitamina D, B12, ácido fólico, PCR,
  eletrólitos, zinco). Conversões automáticas conhecidas (mmol/L → mg/dL em glicose, colesterol e triglicerídeos;
  nmol/L → ng/mL na vitamina D; mg/dL → mg/L na PCR). Exames fora da lista ficam com o nome do laudo.
- Tabela com um biomarcador por linha e as datas de coleta **em ordem cronológica** nas colunas (as 6 mais recentes),
  mesmo que um exame antigo seja lançado depois; a lista de exames segue a mesma ordem. Gráficos dos que têm 2+ resultados.
- **Valores de referência** (base geral para adultos, em `js/lib/labs.js` → `REFERENCES`; lipídios pelos alvos
  desejáveis da SBC 2017, vitamina D pela SBPC/SBEM; faixas por sexo em TGO, TGP, GGT, creatinina, ácido úrico,
  hemoglobina, hematócrito, ferritina e ferro). Coluna "Referência" na tabela e na revisão.
- **Cores:** valor **verde** dentro da faixa, **vermelho com ↑ ou ↓** fora (a seta garante a leitura sem cor).
  Fica sem cor quando não há referência, quando a faixa depende do sexo e o sexo não está no cadastro, ou quando
  a unidade é diferente da padrão. Vale sempre a referência do laudo em caso de dúvida.
- Tabelas `lab_exams` e `lab_results`. Os exames entram no resumo pré-consulta e no quadro de insights, com a
  referência e a marcação "acima/abaixo da ref.".

### 3.7.1 Relatório em PDF para o paciente

- `[🖨️ Relatório em PDF]` na ficha: escolhe as partes (composição corporal, exames, questionários), uma mensagem
  opcional e abre a impressão do navegador ("Salvar como PDF"). A página tem só o relatório, em A4.

### 3.8 Histórico de anamneses

Lista cronológica das consultas (data e tipo). Clicando, abre a íntegra.

### 3.9 Quadro de insights (IA, modo B)

- Botão `[📚 Copiar pedido de insights]`, no mesmo cartão do resumo pré-consulta. Mesmo histórico, sem dados
  pessoais, pedindo: pontos de atenção, condutas sugeridas com força da evidência e **fonte com link**, interações
  com medicações e suplementos, exames para acompanhar e perguntas para a próxima consulta.
- A IA é instruída a não inventar referências ("buscar no PubMed: termos" quando não tiver certeza).
- É apoio à decisão e não substitui a conduta da nutricionista.

---

## 4. Questionários

### 4.1 Modelos

- Lista de modelos com nome e status (ativo / inativo). `[➕ Criar novo questionário]`.
- Tipos de pergunta: escala numérica (ex.: 0 a 5), texto livre e múltipla escolha.
- **Um modelo padrão ativo por vez**, enviado a todos os pacientes ativos.
- Não há edição de modelo já usado: para mudar, ela desativa o antigo e cria um novo. As respostas
  antigas continuam no histórico, ligadas ao modelo original, sem ligação com o novo.

### 4.2 Regras de envio

1. A pessoa veio à consulta: a contagem começa da **data da última consulta**.
2. Envia a cada **7 dias** (frequência configurável), até a **véspera** da próxima consulta.
3. Se o dia do envio cair no **dia da consulta**, não envia.
4. Fez a consulta: **zera a contagem** e volta a enviar 7 dias depois.
5. **Não respondeu 2 questionários seguidos: para de enviar** (volta depois da próxima consulta).
6. Mais de 100 dias sem consulta: não envia.

Outras regras:

| Regra | Valor |
|---|---|
| Lembrete para pendentes (opcional) | após 3 dias sem resposta, aparece na lista de lembretes |
| Pausa manual por paciente | na ficha (seção Questionários) |
| Link vence | quando é respondido ou quando o próximo questionário é enviado |

### 4.3 Envio semiautomático pelo WhatsApp (número pessoal)

- Aba **Questionários → "Envios de hoje"**: **lista de conferência** de quem vai receber, todos já marcados,
  com caixa de seleção individual e os botões `[Marcar todos]` / `[Desmarcar todos]`.
- `[📲 Enviar para os selecionados (N)]` abre uma fila: "Enviando 1 de N: Maria — [Abrir WhatsApp]". Cada clique
  abre o WhatsApp na conversa do paciente com a mensagem pronta e o link dele (`https://wa.me/55DDDNUMERO?text=...`);
  ela aperta enviar lá e o sistema passa para o próximo (`[Pular]` e `[Parar]` disponíveis). O WhatsApp exige um
  clique por pessoa, porque o envio sai do número pessoal dela. Cada envio pode ser desfeito.
- Lista separada de **reenvios**.
- Paciente sem telefone aparece com aviso para completar o cadastro.

### 4.4 Link e resposta sem login

- Cada envio gera um código aleatório de 128 bits (link `…/q.html?t=CÓDIGO`), ligado no banco a:
  paciente, modelo e data de envio.
- O formulário abre com "Olá, [primeiro nome]!" e não mostra nenhum outro dado.
- A resposta cai direto no histórico do paciente.
- O paciente só consegue usar duas funções do banco: `get_questionnaire(token)` (lê o próprio questionário)
  e `submit_questionnaire(token, respostas)` (responde uma vez). As tabelas continuam fechadas para quem não está logado.
- Ao enviar um novo questionário, o link anterior ainda sem resposta vence.
- As respostas entram no pedido de resumo pré-consulta (as 12 mais recentes) e contam como atividade no alerta de 50 dias.

### 4.5 Log de disparos e respostas

| Paciente | Questionário | Enviado em | Status |
|---|---|---|---|
| Maria Silva | Acompanhamento semanal | 05/11/2026 | 🟢 Respondido (há 2 dias), clicável para ver o resumo |
| João Santos | Acompanhamento semanal | 06/11/2026 | 🟡 Pendente (há 5 dias) |

---

## 5. Sem ativo/inativo

- O sistema não tem a escolha "ativo/inativo". O que tira um paciente das listas é só a regra dos 100 dias
  (sem consulta e sem nada marcado), e ele volta sozinho ao marcar consulta. Dados antigos com `status = 'inativo'`
  são ignorados.

---

## 6. Fluxo diário

```
Durante o dia
  ├─ Home mostra as consultas do dia (Google Agenda)
  ├─ Paciente novo → cadastro rápido (nome, nascimento, telefone)
  └─ [Iniciar consulta] → anota a anamnese no painel lateral

Envios
  └─ Aba Questionários → "Envios de hoje" → conferir a lista → [Enviar para os selecionados]

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
- **Regra dos 100 dias:** fica fora da base quem está há **mais de 100 dias da última consulta e não tem consulta
  marcada**. Uma consulta futura conta como atividade (quem marcou fica). Sem nenhuma consulta, vale a data de
  registro. Uma consulta registrada no software nos últimos 100 dias também conta.
  - Quem ainda não está no sistema: não é importado.
  - Quem já está no sistema: é **removido automaticamente** na importação.
  - Exceção: se tiver anotações da nutricionista (consulta registrada no software ou resumo salvo), **não é apagado**:
    só some das listas (pela regra da tela) e continua aparecendo na busca.
  - Se a pessoa marcar consulta de novo, volta na importação seguinte.
- Fora isso, a importação nunca apaga dados do sistema, só acrescenta ou atualiza.

---

## 9. Google Agenda

- Conexão em **⚙️ Configurações**: a nutricionista cola o **endereço secreto no formato iCal** da agenda
  (Google Agenda → Configurações → a agenda → "Integrar agenda"). Fica em `app_settings` (`calendar_ics_url`).
- O navegador não pode ler a agenda do Google direto. Quem busca é o banco: função `fetch_calendar()` com a
  extensão `http` do Supabase, só para usuária logada e só para endereços `https://calendar.google.com/calendar/ical/…`.
- Só considera eventos cujo título começa com **"Consulta de nutrição - "** e que não estão cancelados.
- Vínculo com o paciente: 1º pelo **e-mail do convidado**, 2º pelo **nome no título** (ou nome alternativo salvo),
  3º "não vinculado" na home. O e-mail da dona da agenda (organizador, ou que aparece em muitas consultas) nunca
  é usado no vínculo.
- Reagendamentos e cancelamentos são feitos no Nutrium e refletidos na agenda. A home lê a agenda ao abrir
  (guarda por 5 minutos) e tem o botão `[↻ Atualizar]`.
- O telefone **não** vem pela agenda.

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
| Banco de dados e login | Supabase (plano gratuito) — **única conta nova** | 500 MB de banco (o sistema guarda só texto; nenhum arquivo). Pausa após 7 dias sem uso. O uso aparece em ⚙️ Configurações → "Espaço usado" (função `db_usage()`) |
| Site | GitHub Pages (gratuito) | Exige repositório público (só o código). Atualiza sozinho a cada mudança |
| Código | GitHub (repositório `consultorio_nutri`, em outra conta) | Versão de tudo e histórico de mudanças |
| Agenda | Endereço secreto iCal do Google Agenda | Gratuito, sem Google Cloud |
| WhatsApp | links `wa.me` | Gratuito |
| IA | modo B (assinatura que ela já tem) | Sem custo extra |
| Backup | botão `[⬇️ Baixar backup agora]` em Configurações (arquivo .json com todas as tabelas, sem o endereço secreto da agenda) + aviso semanal na tela inicial | O plano gratuito do Supabase não faz backup. A cópia automática no Google Drive exigiria Google Cloud (fora, por decisão de custo zero/simplicidade): ela guarda o arquivo numa pasta do Drive |

---

## 13. Ordem de construção

| Fase | Entrega | Já dá para usar? |
|---|---|---|
| 1 | Login, cadastro rápido, importação do Nutrium, ficha, painel de anotações, iniciar consulta, histórico de anamneses, resumo pré-consulta e pergunta sobre o histórico (modo B) | Sim: substitui as anotações |
| 2 | Medições (texto, foto via IA modo B, tabela), gráficos, motor de cálculos com sugestão de fator pela IA, histórico de cálculos | Sim: cálculos rápidos |
| 3 | Google Agenda na home, alerta de 50 dias | Sim |
| 4 | Questionários: modelos, links, envios de hoje, reenvios, log, gráficos na ficha | Sim |
| 5 | (IA modo B já antecipada nas Fases 1 e 2) | – |
| 6 | Exames laboratoriais, PDF dos gráficos, relatório por IA, quadro de insights, backup automático | Sim |

---

## 14. Pendências

- [ ] Verificar se consultas canceladas aparecem na aba "Consultas" da exportação.
- [ ] Definir as perguntas do primeiro questionário padrão.
- [ ] Detalhar o quadro de insights.
