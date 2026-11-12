// Pedidos prontos para a IA (modo B: a nutricionista copia, cola na IA que já assina e cola a resposta).
// Nunca incluem nome, e-mail, telefone ou CPF: o paciente aparece só pelo código, sexo e idade.
import { fmtDate, ageFrom, patientCode, SEX_LABEL, OBJECTIVE_LABEL, todayISO } from './util.js';
import { FIELDS, TYPE_LABEL } from '../views/anamnesis.js';

function patientLine(patient) {
  const age = ageFrom(patient.birth_date);
  return [patientCode(patient.code), patient.sex ? SEX_LABEL[patient.sex] : null, age != null ? `${age} anos` : null]
    .filter(Boolean).join(', ');
}

/** Histórico em texto: anamneses (da mais antiga para a mais recente) e evolução do peso. */
export function historyText({ patient, consultations, measurements, appointments, responses = [], questionnaires = [] }) {
  const out = [];
  const today = todayISO();
  const chronological = [...consultations].sort((a, b) => a.date.localeCompare(b.date));

  out.push(`PACIENTE: ${patientLine(patient)}`);
  out.push(`DATA DE HOJE: ${fmtDate(today)}`);
  const next = appointments.filter((a) => a.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  if (next) out.push(`PRÓXIMA CONSULTA: ${fmtDate(next.date)}`);
  const past = appointments.filter((a) => a.date < today);
  if (past.length) out.push(`CONSULTAS NO NUTRIUM (sem anotações): ${past.map((a) => fmtDate(a.date)).sort().join(', ')}`);

  out.push('');
  out.push(`ANAMNESES REGISTRADAS (${chronological.length}):`);
  if (!chronological.length) out.push('(nenhuma)');
  for (const c of chronological) {
    out.push('');
    out.push(`=== ${fmtDate(c.date)} — ${TYPE_LABEL[c.type]} ===`);
    for (const [k, label] of FIELDS[c.type]) {
      if (k === '@objetivo') { if (c.objective) out.push(`Objetivo: ${OBJECTIVE_LABEL[c.objective]}`); continue; }
      const v = c.anamnesis?.[k]?.trim();
      if (v) out.push(`${label}: ${v}`);
    }
  }

  const weights = measurements.filter((m) => m.metric === 'peso').sort((a, b) => a.date.localeCompare(b.date));
  if (weights.length) {
    out.push('');
    out.push('EVOLUÇÃO DO PESO (kg):');
    out.push(weights.slice(-15).map((m) => `${fmtDate(m.date)}: ${m.value}`).join(' | '));
  }
  if (responses.length) {
    const qById = new Map(questionnaires.map((q) => [q.id, q]));
    out.push('');
    out.push(`RESPOSTAS DOS QUESTIONÁRIOS SEMANAIS (${Math.min(responses.length, 12)} mais recentes, da mais antiga para a mais recente):`);
    for (const r of [...responses].sort((a, b) => a.submitted_at.localeCompare(b.submitted_at)).slice(-12)) {
      const q = qById.get(r.questionnaire_id);
      out.push(`--- ${fmtDate(r.submitted_at.slice(0, 10))} ---`);
      for (const question of q?.questions || []) {
        const v = r.answers?.[question.id];
        if (v == null || v === '') continue;
        out.push(`${question.label}: ${v}${question.type === 'scale' ? ` (escala ${question.min} a ${question.max})` : ''}`);
      }
    }
  }
  const height = measurements.filter((m) => m.metric === 'altura').sort((a, b) => b.date.localeCompare(a.date))[0];
  if (height) out.push(`ALTURA: ${height.value} cm`);
  return out.join('\n');
}

export function summaryPrompt(data) {
  return `Você é assistente de uma nutricionista. Abaixo está o histórico de um paciente dela.
Prepare um resumo para a nutricionista ler ANTES da próxima consulta, em português, em tópicos curtos:

1. **Resumo do período** desde a última consulta (o que mudou, como foi).
2. **Evolução geral** desde o início do acompanhamento (peso, hábitos, objetivo).
3. **Pontos de atenção**, incluindo problemas citados em consultas anteriores que não foram retomados depois.
4. **Combinados anteriores para conferir** (metas e orientações que ela deve checar se foram cumpridas).
5. **Perguntas sugeridas** para a próxima consulta (de 5 a 8).

Regras: use apenas as informações do histórico, não invente nada. Quando algo não estiver registrado, diga que não consta.
Não faça prescrição; o objetivo é ajudar a nutricionista a lembrar e organizar.

------ HISTÓRICO ------
${historyText(data)}`;
}

export function questionPrompt(data, question) {
  return `Você é assistente de uma nutricionista. Responda à pergunta dela usando APENAS o histórico do paciente abaixo.
Cite a data da consulta de onde tirou a informação. Se a informação não estiver no histórico, diga que não consta.

PERGUNTA: ${question}

------ HISTÓRICO ------
${historyText(data)}`;
}

/** Copia para a área de transferência; devolve false se o navegador não deixar. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
