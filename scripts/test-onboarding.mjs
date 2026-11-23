import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const start = source.indexOf("async function salvarEtapaOnboarding(");
const end = source.indexOf("\nfunction iniciarOnboarding()", start);
assert.ok(start > 0 && end > start);
const state = {
    dados: {}, salarioFixoBase: 0, receitasFixas: [], cartoes: [],
    categorias: [{ name: "Essencial", color: "#000000" }], contasFixas: [],
    categoriasLembretes: [{ id: "geral", nome: "Geral", cor: "#D78341" }],
    lembretes: [], configuracoes: { nomeUsuario: "Novo", referenciaMes: "atual", diaVirada: 1, onboarding: { status: "pending", step: 0 } },
    structuredClone, crypto, sessionStorage: { removeItem() {} },
    aplicarTema() {},
    salvarFirebase: async () => true,
    getMesReferenciaAtivo() { return { anoAt: 2026, mesAt: 10 }; },
    garantirMesHome(ano, mes) {
        if (!state.dados[ano]) state.dados[ano] = { meses: [] };
        while (state.dados[ano].meses.length <= mes) state.dados[ano].meses.push({ conta: 0, salario: 0 });
        return state.dados[ano].meses[mes];
    }
};
vm.createContext(state);
vm.runInContext(source.slice(start, end), state);
const save = (step, payload, next) => state.salvarEtapaOnboarding(step, payload, next);

assert.equal(await save(0, { nomeUsuario: "Ana" }, 1), true);
assert.equal(state.configuracoes.nomeUsuario, "Ana");
await save(1, { referenciaMes: "proximo", diaVirada: "21" }, 2);
await save(2, { salario: "4000", conta: "250", diaSalario: "5", tipoDiaSalario: "util" }, 3);
assert.equal(state.salarioFixoBase, 4000);
const today = new Date();
assert.equal(state.dados[today.getFullYear()].meses[today.getMonth()].conta, 250);
assert.equal(state.dados[today.getFullYear()].meses[today.getMonth()].contaManual, true);
await save(3, { rows: [{ nome: "Extra", valor: "100", dia: "15" }] }, 4);
const incomeId = state.receitasFixas[0].id;
await save(3, { rows: [{ id: incomeId, nome: "Extra", valor: "120", dia: "15" }] }, 4);
assert.equal(state.receitasFixas.length, 1);
assert.equal(state.receitasFixas[0].id, incomeId);
await save(4, { rows: [{ nome: "Banco", color: "#abcdef", tipo: "Crédito", fechamento: "10", vencimento: "17" }] }, 5);
const cardId = state.cartoes[0].id;
await save(6, { rows: [{ nome: "Aluguel", valor: "800", dia: "1", categoria: "Essencial", cartaoId: "" }] }, 7);
await save(7, { rows: [{ nome: "Streaming", valor: "35", dia: "7", categoria: "Essencial", cartaoId: cardId }] }, 8);
assert.equal(state.contasFixas.length, 2);
await save(6, { rows: [{ ...state.contasFixas[0], valor: "900" }] }, 7);
assert.equal(state.contasFixas.length, 2);
assert.equal(state.contasFixas.find(item => item.tipo === "assinatura").cartaoId, cardId);
await save(8, { visaoCalendario: "semanal", inicioSemanaCalendario: "1", horaViradaCalendario: "21", periodoHome: "semana", categoriaLembrete: "Trabalho", lembreteNome: "Reunião", lembreteData: "2026-11-27", lembreteHora: "10:00" }, 9);
const reminderId = state.lembretes[0].id;
const categoryId = state.categoriasLembretes.at(-1).id;
await save(8, { visaoCalendario: "mensal", inicioSemanaCalendario: "0", horaViradaCalendario: "20", periodoHome: "mes", categoriaLembrete: "Trabalho", lembreteNome: "Reunião nova", lembreteData: "2026-11-28", lembreteHora: "11:00" }, 9);
assert.equal(state.lembretes.length, 1);
assert.equal(state.lembretes[0].id, reminderId);
assert.equal(state.categoriasLembretes.at(-1).id, categoryId);
state.salvarFirebase = async () => false;
await assert.rejects(save(9, { tema: "noite" }, 10));
assert.equal(state.configuracoes.onboarding.step, 9);
assert.equal(state.configuracoes.tema, undefined);
state.salvarFirebase = async () => true;
await save(9, { tema: "noite" }, 10);
await save(10, {}, "complete");
assert.equal(state.configuracoes.onboarding.status, "complete");
console.log("Onboarding: progression, rollback, IDs, optional data and completion passed.");
