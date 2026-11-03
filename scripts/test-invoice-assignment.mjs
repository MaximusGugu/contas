import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Exercise the production helpers without initializing Firebase or the UI.
const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const state = {
    dados: {},
    gastosDetalhes: {},
    cartoes: [{ id: "card", fechamento: 10 }],
    nomesMesesFull: Array.from({ length: 12 }, (_, i) => `Month ${i + 1}`)
};
vm.createContext(state);
for (const name of ["parseIsoData", "getCartaoById", "resolverFaturaCartaoPorData", "garantirMesDados", "opcoesFaturaGasto", "lerFaturaGasto", "moverGastoParaFatura"]) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `Missing production helper: ${name}`);
    const end = source.indexOf("\n}", start) + 2;
    vm.runInContext(source.slice(start, end), state);
}

const reference = (date) => JSON.parse(JSON.stringify(state.resolverFaturaCartaoPorData("card", date)));
assert.equal(reference("2026-11-09").mes, 10);
assert.equal(reference("2026-11-10").mes, 11);
assert.equal(reference("2026-12-10").ano, 2027);
assert.equal(reference("2026-12-10").mes, 0);
assert.equal(state.lerFaturaGasto("2026-13"), null);
assert.equal(state.lerFaturaGasto(""), null);

const gasto = { id: "purchase", data: "2026-11-09", mes: 11, valor: 100, cartaoId: "card", checked: true };
const parcela = { id: "installment", parcelaId: "series", mes: 11, valor: 50, data: "2026-12-10" };
state.gastosDetalhes[2026] = [gasto, parcela];
state.moverGastoParaFatura(gasto, 2026, 10, 2026);
assert.equal(state.gastosDetalhes[2026].filter(g => g.mes === 10).reduce((sum, g) => sum + g.valor, 0), 100);
assert.equal(state.gastosDetalhes[2026].filter(g => g.mes === 11).reduce((sum, g) => sum + g.valor, 0), 50);
assert.equal(gasto.data, "2026-11-09");

state.moverGastoParaFatura(gasto, 2026, 0, 2027);
assert.equal(state.gastosDetalhes[2026].includes(gasto), false);
assert.equal(state.gastosDetalhes[2027][0], gasto);
assert.ok(state.dados[2027].meses[0]);
state.moverGastoParaFatura(gasto, 2027, 0, 2027);
assert.equal(state.gastosDetalhes[2027].length, 1);
assert.equal(state.gastosDetalhes[2026][0], parcela);
assert.equal(parcela.parcelaId, "series");

const persisted = JSON.parse(JSON.stringify(state.gastosDetalhes));
assert.equal(persisted[2027][0].mes, 0);
assert.equal(persisted[2027][0].data, "2026-11-09");
const options = state.opcoesFaturaGasto(2027, 0);
assert.match(options, /value="2027-01" selected/);
assert.equal((options.match(/ selected/g) || []).length, 1);
console.log("Invoice assignment: closing date, manual month/year, totals, identity and serialization passed.");
