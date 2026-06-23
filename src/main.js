import { auth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from "./firebase/auth.js";
import { db, doc, setDoc, getDoc } from "./firebase/firestore.js";
import { encryptData, decryptData } from "./crypto/crypto.js";
import { formatar, parseValor } from "./utils/formatters.js";
import { nomesMesesFull, nomesMesesCurto, categoriasPadrao, configuracoesPadrao } from "./state/state.js";
import { saveLocalSnapshot } from "./state/storage.js";
import { getMesReferenciaAtivo as calcularMesReferenciaAtivo } from "./utils/dates.js";
import { renderCalendario, calcularDiaSalarioConfigurado, obterFeriados } from "./modules/calendar.js";
import { aplicarTema } from "./modules/themes.js";

// ================= VARIAVEIS GLOBAIS =================
let usuarioLogado = null;
let senhaDoUsuario = sessionStorage.getItem("temp_key") || "";
let dados = {};
let parcelasMemoria = [];
let lembretes = [];
let mesesDOM = [];
let chartResumo = null;
let mesesAbertos = new Set();
let mesesGastosAbertos = new Set();
let caixinhas = [];

let contasFixas = [];
let receitasFixas = [];
let salarioFixoBase = 0;
let categorias = structuredClone(categoriasPadrao);
let configuracoes = { ...configuracoesPadrao };
let categoriasLembretes = [];
let cartoes = [];
let gastosDetalhes = {};
let filtrosPorMes = {};
let chartBalancoRapido = null;
let chartCategoriasResumoGastos = null;
let homeMesOffset = 0;
let gastosDetalhadosMesCursor = null;
let filtrosGastosDetalhados = { cartao: "todos", tipo: "todos", status: "todos", busca: "", categoria: "todas" };
let gastosBuscaTimer = null;
let gastoLinhaExpandidaKey = null;
let gastoLinhaUiSeq = 0;
const gastoLinhaUiKeys = new WeakMap();
let filtrosAnalise = {
    ano: String(new Date().getFullYear()),
    periodo: "ano",
    mes: String(new Date().getMonth()),
    cartao: "todos",
    categoria: "todas",
    tipo: "todos",
    apenasPagos: false
};
let chartAnaliseSaldo = null;
let chartAnaliseCategorias = null;
let chartAnaliseCartoes = null;
let chartAnaliseFluxo = null;
let chartAnaliseComposicao = null;
let pwaInstallPrompt = null;
let pwaRecarregandoAposUpdate = false;

const VERSAO_ATUAL_APP = "4.2.20";
const coresCategoriasLembretes = ["#D78341", "#3C5558", "#586E5F", "#8E6F3E", "#7A4E7A"];
const tiposExibicaoPadrao = {
    feriados: true,
    salario: true,
    receitas: true,
    cartoes: true,
    fixas: true,
    variaveis: true,
    lembretes: true
};
const periodoHomePadrao = { tipo: "semana", inicio: "", fim: "" };
const diasSemanaConfig = [
    ["0", "Domingo"],
    ["1", "Segunda-feira"],
    ["2", "Terca-feira"],
    ["3", "Quarta-feira"],
    ["4", "Quinta-feira"],
    ["5", "Sexta-feira"],
    ["6", "Sabado"]
];
const iconesExibicaoCalendario = [
    "description", "calendar_month", "event", "event_available", "event_note",
    "credit_card", "payments", "account_balance_wallet", "attach_money",
    "notifications", "push_pin", "star", "favorite", "work", "school",
    "location_on", "home", "shopping_cart", "restaurant", "local_grocery_store",
    "fitness_center", "sports_volleyball", "flight", "directions_car", "pets"
];

const hoje = new Date();
let contextParcelaCartao = { mes: 0, ano: 2024 };

function criarCategoriaLembretePadrao() {
    return { id: "geral", nome: "Geral", cor: "#D78341" };
}

function normalizarCategoriasLembretes(lista) {
    const origem = Array.isArray(lista) && lista.length ? lista : [criarCategoriaLembretePadrao()];
    return origem.map((cat, index) => ({
        id: String(cat.id || `lem-cat-${index + 1}`),
        nome: cat.nome || cat.name || `Categoria ${index + 1}`,
        cor: cat.cor || cat.color || coresCategoriasLembretes[index % coresCategoriasLembretes.length]
    }));
}

function normalizarConfigExibicao(config) {
    const cfg = config && typeof config === "object" ? config : {};
    return {
        tipos: { ...tiposExibicaoPadrao, ...(cfg.tipos || {}) },
        categoriasLembretes: Array.isArray(cfg.categoriasLembretes) ? cfg.categoriasLembretes.map(String) : [],
        categoriasFinanceiras: Array.isArray(cfg.categoriasFinanceiras) ? cfg.categoriasFinanceiras : [],
        periodo: normalizarPeriodoHome(cfg.periodo)
    };
}

function normalizarPeriodoHome(periodo) {
    const cfg = periodo && typeof periodo === "object" ? periodo : {};
    const tiposValidos = ["semana", "hoje", "proximos7", "mes", "personalizado"];
    const tipo = tiposValidos.includes(cfg.tipo) ? cfg.tipo : periodoHomePadrao.tipo;
    return {
        tipo,
        inicio: cfg.inicio || "",
        fim: cfg.fim || ""
    };
}

function getPeriodoHomeDatas(configHome = configuracoes.exibicaoHome) {
    const periodo = normalizarPeriodoHome(configHome?.periodo);
    const hojeBase = new Date();
    hojeBase.setHours(0, 0, 0, 0);
    let inicio = new Date(hojeBase);
    let fim = new Date(hojeBase);

    if (periodo.tipo === "hoje") {
        fim = new Date(hojeBase);
    } else if (periodo.tipo === "proximos7") {
        fim.setDate(inicio.getDate() + 6);
    } else if (periodo.tipo === "mes") {
        fim = new Date(hojeBase.getFullYear(), hojeBase.getMonth() + 1, 0);
    } else if (periodo.tipo === "personalizado") {
        const dataInicio = periodo.inicio ? new Date(`${periodo.inicio}T00:00:00`) : null;
        const dataFim = periodo.fim ? new Date(`${periodo.fim}T00:00:00`) : null;
        if (dataInicio && !isNaN(dataInicio)) inicio = dataInicio;
        if (dataFim && !isNaN(dataFim)) fim = dataFim;
        if (fim < inicio) fim = new Date(inicio);
    } else {
        const domingo = new Date(hojeBase);
        domingo.setDate(hojeBase.getDate() - hojeBase.getDay());
        fim = new Date(domingo);
        fim.setDate(domingo.getDate() + 6);
    }

    fim.setHours(23, 59, 59, 999);
    return { inicio, fim, periodo };
}

function criarViewCalendarioPadrao() {
    return { id: "view-1", nome: "Exibição 1", icone: "description", filtros: normalizarConfigExibicao({ tipos: tiposExibicaoPadrao }) };
}

function normalizarNomeExibicao(nome) {
    return String(nome || "").replace(/\bView\b/gi, "Exibição");
}

function normalizarIconeMaterial(nome, fallback = "description") {
    const limpo = String(nome || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_");
    return limpo || fallback;
}

function normalizarViewsCalendario(lista) {
    const views = Array.isArray(lista) && lista.length ? lista : [criarViewCalendarioPadrao()];
    return views.map((view, index) => ({
        id: String(view.id || `view-${index + 1}`),
        nome: normalizarNomeExibicao(view.nome || `Exibição ${index + 1}`),
        icone: normalizarIconeMaterial(view.icone || ["description", "location_on", "star"][index % 3]),
        filtros: normalizarConfigExibicao(view.filtros || view)
    }));
}

function isoHoje() {
    return new Date().toLocaleDateString("en-CA");
}

function isoDataMes(ano, mes, dia = 1) {
    const anoNum = Number(ano) || new Date().getFullYear();
    const mesNum = Math.max(0, Math.min(11, Number(mes) || 0));
    const ultimoDia = new Date(anoNum, mesNum + 1, 0).getDate();
    const diaNum = Math.max(1, Math.min(ultimoDia, Number(dia) || 1));
    return new Date(anoNum, mesNum, diaNum).toLocaleDateString("en-CA");
}

function parseIsoData(valor) {
    const match = String(valor || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const data = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return isNaN(data) ? null : data;
}

function getDataDespesa(despesa, ano, mes) {
    return parseIsoData(despesa?.data) ? despesa.data : isoDataMes(ano, mes, despesa?.dia || 1);
}

function aplicarDataDespesa(despesa, dataIso) {
    const data = parseIsoData(dataIso);
    if (!data) return false;
    despesa.data = data.toLocaleDateString("en-CA");
    despesa.dia = data.getDate();
    despesa.mes = data.getMonth();
    return true;
}

function compararDespesasPorData(a, b) {
    return String(a.data || "").localeCompare(String(b.data || "")) || ((a.criadoEm || 0) - (b.criadoEm || 0));
}

function ultimoDiaDoMes(ano, mes) {
    return new Date(Number(ano), Number(mes) + 1, 0).getDate();
}

function normalizarRecorrenciaLembrete(l) {
    const recorrente = l.recorrente === true;
    const tipo = recorrente ? (["semanal", "mensal", "intervalo"].includes(l.recorrenciaTipo) ? l.recorrenciaTipo : "semanal") : "semanal";
    const diasSemana = Array.isArray(l.diasSemana) ? l.diasSemana.map(Number).filter(d => d >= 0 && d <= 6) : [];
    const intervaloDias = Math.max(1, parseInt(l.intervaloDias) || 1);
    return { recorrente, recorrenciaTipo: tipo, diasSemana, intervaloDias: tipo === "intervalo" ? intervaloDias : null };
}

function lembreteOcorreNaData(l, dataObj) {
    const iso = dataObj.toLocaleDateString("en-CA");
    if (l.data === iso) return true;
    if (!l.recorrente) return false;
    const dataBase = parseIsoData(l.data);
    if (!dataBase || dataObj < dataBase) return false;

    if (l.recorrenciaTipo === "mensal") {
        const diaBase = dataBase.getDate();
        const diaOcorrencia = Math.min(diaBase, ultimoDiaDoMes(dataObj.getFullYear(), dataObj.getMonth()));
        return dataObj.getDate() === diaOcorrencia;
    }

    if (l.recorrenciaTipo === "intervalo") {
        const intervalo = Math.max(1, parseInt(l.intervaloDias) || 1);
        const base = new Date(dataBase);
        const atual = new Date(dataObj);
        base.setHours(0, 0, 0, 0);
        atual.setHours(0, 0, 0, 0);
        const diffDias = Math.floor((atual - base) / 86400000);
        return diffDias >= 0 && diffDias % intervalo === 0;
    }

    return l.diasSemana?.includes(dataObj.getDay());
}

function normalizarDadosApp() {
    categoriasLembretes = normalizarCategoriasLembretes(categoriasLembretes);
    const viewsCalendario = normalizarViewsCalendario(configuracoes?.viewsCalendario);
    const viewAtivaValida = viewsCalendario.some(v => String(v.id) === String(configuracoes?.viewCalendarioAtiva));
    configuracoes = {
        ...configuracoesPadrao,
        ...(configuracoes || {}),
        viewsCalendario,
        viewCalendarioAtiva: viewAtivaValida ? String(configuracoes.viewCalendarioAtiva) : viewsCalendario[0].id,
        tipoDiaSalario: configuracoes?.tipoDiaSalario === "corrido" ? "corrido" : "util",
        visaoCalendario: normalizarVisaoCalendario(configuracoes?.visaoCalendario),
        horaViradaCalendario: normalizarHoraViradaCalendario(configuracoes?.horaViradaCalendario),
        inicioSemanaCalendario: normalizarInicioSemanaCalendario(configuracoes?.inicioSemanaCalendario),
        exibicaoCalendario: normalizarConfigExibicao(configuracoes?.exibicaoCalendario),
        exibicaoHome: normalizarConfigExibicao(configuracoes?.exibicaoHome)
    };

    const categoriaDefault = categoriasLembretes[0]?.id || "geral";
    lembretes = (Array.isArray(lembretes) ? lembretes : []).map((l, lembreteIndex) => {
        const subtarefas = Array.isArray(l.subtarefas) ? l.subtarefas.map((s, idx) => ({
            id: String(s.id || `${l.id || Date.now()}-sub-${idx}`),
            texto: s.texto || s.nome || "",
            concluida: s.concluida === true
        })).filter(s => s.texto.trim() !== "") : [];
        const concluido = subtarefas.length > 0 ? subtarefas.every(s => s.concluida) : l.concluido === true;
        const recorrencia = normalizarRecorrenciaLembrete(l);
        return {
            ...l,
            id: String(l.id || `lembrete-${l.data || "sem-data"}-${l.criadoEm || lembreteIndex}-${Math.random().toString(36).slice(2, 8)}`),
            categoriaId: String(l.categoriaId || categoriaDefault),
            anotacoes: l.anotacoes || "",
            subtarefas,
            concluido,
            ...recorrencia
        };
    });

    Object.entries(dados || {}).forEach(([ano, anoData]) => {
        (anoData.meses || []).forEach((mesData, mes) => {
            (mesData.despesas || []).forEach(d => {
                d.data = getDataDespesa(d, ano, mes);
                d.dia = parseIsoData(d.data)?.getDate() || d.dia || 1;
            });
        });
    });

    Object.entries(gastosDetalhes || {}).forEach(([ano, lista]) => {
        (lista || []).forEach(g => {
            g.data = getDataDespesa(g, ano, g.mes);
            g.checked = gastoCartaoContaNoTotal(g);
            if (!g.id) g.id = `${g.mes ?? "m"}-${g.cartaoId ?? "card"}-${g.parcelaId ?? "manual"}-${g.criadoEm || Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            if (!g.criadoEm) g.criadoEm = Date.now();
        });
    });
}

function getViewCalendarioAtiva() {
    normalizarDadosApp();
    return configuracoes.viewsCalendario.find(view => String(view.id) === String(configuracoes.viewCalendarioAtiva)) || configuracoes.viewsCalendario[0];
}

function getCategoriaLembrete(id) {
    return categoriasLembretes.find(cat => String(cat.id) === String(id)) || categoriasLembretes[0] || criarCategoriaLembretePadrao();
}

function hexParaRgb(cor) {
    const hex = String(cor || "").replace("#", "").trim();
    const normalizado = hex.length === 3 ? hex.split("").map(ch => ch + ch).join("") : hex;
    if (!/^[0-9a-fA-F]{6}$/.test(normalizado)) return null;
    return {
        r: parseInt(normalizado.slice(0, 2), 16),
        g: parseInt(normalizado.slice(2, 4), 16),
        b: parseInt(normalizado.slice(4, 6), 16)
    };
}

function getCorTextoContraste(corFundo) {
    const rgb = hexParaRgb(corFundo);
    if (!rgb) return "#ffffff";
    const luminancia = ((rgb.r * 299) + (rgb.g * 587) + (rgb.b * 114)) / 1000;
    return luminancia >= 145 ? "#1f1f1f" : "#ffffff";
}

function getEstadoCalendario() {
    normalizarDadosApp();
    return {
        dados,
        cartoes,
        contasFixas,
        receitasFixas,
        lembretes,
        configuracoes,
        gastosDetalhes,
        salarioFixoBase,
        categoriasLembretes,
        usuarioEmail: usuarioLogado?.email || "",
        saudacaoHtml: getSaudacaoResumoHtml(),
        menuLateralHtml: renderMenuLateral("#calendario"),
        viewCalendarioAtiva: getViewCalendarioAtiva()
    };
}

function passaFiltroEvento(ev, cfg) {
    const config = normalizarConfigExibicao(cfg);
    if (config.tipos?.[ev.tipo] === false) return false;
    if (ev.tipo === "lembretes" && config.categoriasLembretes.length > 0) {
        return config.categoriasLembretes.includes(String(ev.categoriaId));
    }
    if (ev.categoria && config.categoriasFinanceiras.length > 0) {
        return config.categoriasFinanceiras.includes(ev.categoria);
    }
    return true;
}

function filtrarEventosCalendario(eventos, cfg) {
    return eventos.filter(ev => passaFiltroEvento(ev, cfg));
}

function filtrarEventosHome(eventos, cfg) {
    return eventos.filter(ev => passaFiltroEvento(ev, cfg));
}

function minutosDoHorario(hora) {
    if (!hora) return 24 * 60 + 1;
    const match = String(hora).match(/^(\d{1,2}):(\d{2})/);
    if (!match) return 24 * 60 + 1;
    return (Number(match[1]) * 60) + Number(match[2]);
}

function compararEventosPorDataHora(a, b) {
    const dataA = a.data instanceof Date ? a.data.getTime() : new Date(a.data).getTime();
    const dataB = b.data instanceof Date ? b.data.getTime() : new Date(b.data).getTime();
    if (dataA !== dataB) return dataA - dataB;
    return minutosDoHorario(a.hora) - minutosDoHorario(b.hora);
}

function eventoJaPassouHoje(ev) {
    const dataEvento = ev?.data instanceof Date ? ev.data : new Date(ev?.data);
    if (!dataEvento || isNaN(dataEvento)) return false;

    const agora = new Date();
    if (
        dataEvento.getFullYear() !== agora.getFullYear() ||
        dataEvento.getMonth() !== agora.getMonth() ||
        dataEvento.getDate() !== agora.getDate()
    ) return false;

    const minutosEvento = minutosDoHorario(ev.hora || ev.info);
    if (minutosEvento > 24 * 60) return false;
    return minutosEvento < (agora.getHours() * 60 + agora.getMinutes());
}

// ================= FUNCOES DE APOIO =================
// CALCULO DINAMICO DE SALDO

// ATUALIZACAO DO DEPOSITO
window.atualizarDataLembrete = async (id, novaData, novoDiaSemana) => {
    // Comentario removido por encoding corrompido.
    const index = lembretes.findIndex(l => String(l.id) === String(id));
    if (index === -1) return;

    // Comentario removido por encoding corrompido.
    if (lembretes[index].recorrente) {
        lembretes[index].diasSemana = [novoDiaSemana];
    }
    lembretes[index].data = novaData;

    // 3. Salva no Firebase
    await salvarFirebase();
    renderLembretesHome();

    // Comentario removido por encoding corrompido.
    rerenderCalendarioNoShell();
};

function congelarHistoricoFixas() {
    // Comentario removido por encoding corrompido.
    const { mesAt, anoAt } = getMesReferenciaAtivo();

    const anos = Object.keys(dados).map(Number).sort((a, b) => a - b);

    anos.forEach(ano => {
        if (!dados[ano] || !dados[ano].meses) return;
        dados[ano].meses.forEach((m, idx) => {

            // Comentario removido por encoding corrompido.
            // Se o ano for menor que o ano ativo OU
            // Comentario removido por encoding corrompido.
            if (ano < anoAt || (ano === anoAt && idx < mesAt)) {

                // Comentario removido por encoding corrompido.
                if (!m.fixasSnapshot) {
                    m.fixasSnapshot = JSON.parse(JSON.stringify(contasFixas));
                }

                // Comentario removido por encoding corrompido.
                if (!m.receitasSnapshot) {
                    m.receitasSnapshot = JSON.parse(JSON.stringify(receitasFixas));
                }

                // Comentario removido por encoding corrompido.
                if (m.salarioSnapshot === undefined) {
                    m.salarioSnapshot = salarioFixoBase;
                }
            }
        });
    });
}

function atualizarTituloSite() {
    const tituloEl = document.getElementById("tituloSite");
    if (configuracoes.nomeUsuario && configuracoes.nomeUsuario.trim() !== "") {
        const nomeUpper = configuracoes.nomeUsuario.toUpperCase();
        // Comentario removido por encoding corrompido.
        if (tituloEl) tituloEl.innerText = "CONTAS DE " + nomeUpper;
        // Muda o nome na aba do navegador (Title)
        document.title = "Contas de " + configuracoes.nomeUsuario;
    } else {
        // Comentario removido por encoding corrompido.
        if (tituloEl) tituloEl.innerText = "CONTAS MENSAIS";
        document.title = "Contas Mensais - Premium";
    }
}

let estaCarregandoLembretes = false;

async function renderLembretesHome() {
    const lista = document.getElementById("listaLembretesHome");
    if (!lista) return;

    try {
        normalizarDadosApp();
        const hoje = new Date();
        const hojeSemHoras = new Date(hoje);
        hojeSemHoras.setHours(0,0,0,0);

        const { inicio: inicioPeriodo, fim: fimPeriodo } = getPeriodoHomeDatas(configuracoes.exibicaoHome);

        let eventosSemana = [];
        const feriadosPorAno = {};
        const feriadosDoAno = async (ano) => {
            if (!feriadosPorAno[ano]) feriadosPorAno[ano] = await obterFeriados(ano);
            return feriadosPorAno[ano];
        };
        const pushEvento = (data, nome, info, valor, tipo, pago = false, extra = {}) => {
            eventosSemana.push({ nome, info, valor, data: new Date(data), tipo, pago, ...extra });
        };

        for (let dataLoop = new Date(inicioPeriodo); dataLoop <= fimPeriodo; dataLoop.setDate(dataLoop.getDate() + 1)) {
            const diaNum = dataLoop.getDate();
            const mesIdx = dataLoop.getMonth();
            const anoDoDia = dataLoop.getFullYear();
            const isoData = dataLoop.toLocaleDateString('en-CA');
            const mData = dados[anoDoDia]?.meses?.[mesIdx];
            const feriados = await feriadosDoAno(anoDoDia);
            const stringFeriado = `${(mesIdx + 1).toString().padStart(2, '0')}-${diaNum.toString().padStart(2, '0')}`;

            if (feriados.includes(stringFeriado)) {
                pushEvento(dataLoop, "Feriado", "Calendario", 0, "feriados");
            }

            if (diaNum === calcularDiaSalarioConfigurado(configuracoes, mesIdx, anoDoDia, feriados)) {
                pushEvento(dataLoop, "Salario", "Renda", salarioFixoBase || 0, "salario");
            }

            const listaReceitas = mData?.receitasSnapshot ? mData.receitasSnapshot : receitasFixas;
            listaReceitas.forEach(rf => {
                if (rf.ativo && parseInt(rf.dia) === diaNum) {
                    const desativada = mData?.receitasDesativadas?.[rf.id] === true;
                    pushEvento(dataLoop, rf.nome, desativada ? "INATIVA" : "Renda fixa", rf.valor, "receitas", !desativada);
                }
            });

            cartoes.forEach(c => {
                if (parseInt(c.vencimento) === diaNum) {
                    const totalV = (gastosDetalhes[anoDoDia] || []).filter(g => g.mes === mesIdx && String(g.cartaoId) === String(c.id) && gastoCartaoContaNoTotal(g)).reduce((acc, g) => acc + g.valor, 0);
                    const listaFixas = mData?.fixasSnapshot ? mData.fixasSnapshot : contasFixas;
                    const totalF = listaFixas.filter(f => f.ativo && String(f.cartaoId) === String(c.id)).reduce((acc, f) => {
                        const valorEfetivo = (mData?.fixasEditadas?.[f.id] !== undefined) ? mData.fixasEditadas[f.id] : f.valor;
                        return acc + valorEfetivo;
                    }, 0);
                    const pago = mData?.cartoesPagos?.[c.id] === true;
                    pushEvento(dataLoop, `Fatura ${c.nome}`, pago ? "PAGO" : "Cartao", totalV + totalF, "cartoes", pago);
                }
            });

            const listaFixas = mData?.fixasSnapshot ? mData.fixasSnapshot : contasFixas;
            listaFixas.forEach(f => {
                if (f.ativo && parseInt(f.dia) === diaNum) {
                    const valorEfetivo = (mData?.fixasEditadas?.[f.id] !== undefined) ? mData.fixasEditadas[f.id] : f.valor;
                    const pago = mData?.fixasDesativadas?.[f.id] !== true;
                    pushEvento(dataLoop, f.nome, "Fixa", valorEfetivo, "fixas", pago, { categoria: f.categoria });
                }
            });

            (mData?.despesas || []).forEach(d => {
                const dataDespesa = getDataDespesa(d, anoDoDia, mesIdx);
                if (dataDespesa === isoData || (!d.data && d.dia && parseInt(d.dia) === diaNum)) {
                    pushEvento(dataLoop, d.nome, "Variavel", d.valor, "variaveis", d.checked, { categoria: d.categoria });
                }
            });

            lembretes.filter(l => lembreteOcorreNaData(l, new Date(dataLoop))).forEach(l => {
                const cat = getCategoriaLembrete(l.categoriaId);
                pushEvento(dataLoop, l.nome, l.hora || "Lembrete", l.valor, "lembretes", l.concluido, {
                    lembreteId: l.id,
                    categoriaId: l.categoriaId,
                    cor: cat.cor,
                    subtarefas: l.subtarefas || [],
                    anotacoes: l.anotacoes || "",
                    hora: l.hora || ""
                });
            });
        }

        eventosSemana = filtrarEventosHome(eventosSemana, configuracoes.exibicaoHome);
        eventosSemana.sort(compararEventosPorDataHora);

        if (eventosSemana.length === 0) {
            lista.innerHTML = `<div class="lembrete-vazio">Sem eventos para o periodo selecionado.</div>`;
            recalcularHomeAposLembretes();
            return;
        }

        lista.innerHTML = eventosSemana.map(ev => {
            const dataFormatada = ev.data.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit' });
            const textoValor = (ev.valor && ev.valor > 0) ? ` | <b>${formatar(ev.valor)}</b>` : "";
            const subtarefasHtml = ev.tipo === "lembretes" && ev.subtarefas?.length ? `
                <div class="subtarefas-home">
                    ${ev.subtarefas.map(st => `
                        <label>
                            <input type="checkbox" class="check-subtarefa-home" data-lembrete-id="${ev.lembreteId}" data-subtarefa-id="${st.id}" ${st.concluida ? "checked" : ""}>
                            <span>${st.texto}</span>
                        </label>
                    `).join("")}
                </div>` : "";
            const lembreteOriginal = ev.tipo === "lembretes" ? lembretes.find(l => String(l.id) === String(ev.lembreteId)) : null;
            const corLembrete = lembreteOriginal ? getCategoriaLembrete(lembreteOriginal.categoriaId).cor : "";
            const opacidade = (ev.pago || eventoJaPassouHoje(ev)) ? "0.6" : "1";
            return `
                <div class="item-lembrete-home agenda-tipo-${ev.tipo}" data-tipo="${ev.tipo}" data-lembrete-id="${ev.lembreteId || ""}" style="opacity: ${opacidade}; ${corLembrete ? `--lembrete-cor:${corLembrete}; border-left:4px solid ${corLembrete};` : ""}">
                    <div class="info">
                        <span class="titulo" style="font-size:14px">${ev.nome}</span>
                        <span class="data" style="font-size:11px">${dataFormatada.toUpperCase()} - ${ev.info}${textoValor}</span>
                        ${subtarefasHtml}
                    </div>
                </div>`;
        }).join('');

        lista.querySelectorAll(".check-subtarefa-home").forEach(input => {
            input.onchange = async (e) => {
                e.stopPropagation();
                const lembrete = lembretes.find(l => String(l.id) === String(e.target.dataset.lembreteId));
                if (!lembrete) return;
                const subtarefa = lembrete.subtarefas?.find(st => String(st.id) === String(e.target.dataset.subtarefaId));
                if (!subtarefa) return;
                subtarefa.concluida = e.target.checked;
                lembrete.concluido = lembrete.subtarefas.length > 0 && lembrete.subtarefas.every(st => st.concluida);
                await salvarFirebase();
                renderLembretesHome();
                if (window.location.hash === "#calendario") rerenderCalendarioNoShell();
            };
            input.onclick = (e) => e.stopPropagation();
        });

        lista.querySelectorAll(".item-lembrete-home").forEach(item => {
            item.onclick = () => {
                if (item.dataset.tipo !== "lembretes") return;
                const lembrete = lembretes.find(l => String(l.id) === String(item.dataset.lembreteId));
                if (lembrete) abrirPostit(lembrete);
            };
        });
        recalcularHomeAposLembretes();
    } catch (e) { console.error(e); }
}

function getMesReferenciaAtivo() {
    return calcularMesReferenciaAtivo(configuracoes);
}

function migrarCategorias(lista) {
    if(!lista || !Array.isArray(lista)) return categorias;
    return lista.map(c => (typeof c === 'string' ? { name: c, color: "#D78341" } : c));
}

function materialIcon(nome, extraClass = "") {
    return `<span class="material-icons ${extraClass}" aria-hidden="true">${nome}</span>`;
}

function appEstaEmModoStandalone() {
    return window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
}

function atualizarModoStandalonePwa() {
    document.body.classList.toggle("pwa-standalone", appEstaEmModoStandalone());
    atualizarBotoesInstalacaoPwa();
}

function atualizarBotoesInstalacaoPwa() {
    const podeInstalar = Boolean(pwaInstallPrompt) && !appEstaEmModoStandalone();
    document.querySelectorAll("[data-pwa-install]").forEach((botao) => {
        botao.hidden = !podeInstalar;
        botao.disabled = !podeInstalar;
    });
}

async function solicitarInstalacaoPwa() {
    if (!pwaInstallPrompt || appEstaEmModoStandalone()) return;
    const promptEvent = pwaInstallPrompt;
    pwaInstallPrompt = null;
    atualizarBotoesInstalacaoPwa();
    await promptEvent.prompt();
    const escolha = await promptEvent.userChoice;
    console.info(`[PWA] Instala\u00e7\u00e3o ${escolha.outcome === "accepted" ? "aceita" : "dispensada"} pelo usu\u00e1rio.`);
}

function pwaPodeRegistrarServiceWorker() {
    return "serviceWorker" in navigator && (
        window.location.protocol === "https:"
        || ["localhost", "127.0.0.1"].includes(window.location.hostname)
    );
}

async function registrarServiceWorkerPwa() {
    if (!pwaPodeRegistrarServiceWorker()) {
        console.info("[PWA] Service worker aguardando HTTPS ou localhost.");
        return;
    }

    try {
        const tinhaController = Boolean(navigator.serviceWorker.controller);
        const registro = await navigator.serviceWorker.register("service-worker.js", { scope: "./", updateViaCache: "none" });
        console.info("[PWA] Service worker registrado.", registro.scope);
        if (["localhost", "127.0.0.1"].includes(window.location.hostname)) {
            registro.update();
        }

        registro.addEventListener("updatefound", () => {
            const novoWorker = registro.installing;
            if (!novoWorker) return;
            console.info("[PWA] Nova vers\u00e3o em cache.");
            novoWorker.addEventListener("statechange", () => {
                if (novoWorker.state === "installed" && navigator.serviceWorker.controller) {
                    console.info("[PWA] Atualiza\u00e7\u00e3o pronta para assumir o app.");
                    novoWorker.postMessage({ type: "SKIP_WAITING" });
                }
            });
        });

        if (registro.waiting) registro.waiting.postMessage({ type: "SKIP_WAITING" });

        navigator.serviceWorker.addEventListener("controllerchange", () => {
            if (!tinhaController || pwaRecarregandoAposUpdate) return;
            pwaRecarregandoAposUpdate = true;
            console.info("[PWA] Cache atualizado. Recarregando a interface.");
            window.location.reload();
        });
    } catch (erro) {
        console.warn("[PWA] N\u00e3o foi poss\u00edvel registrar o service worker.", erro);
    }
}

function inicializarPwa() {
    atualizarModoStandalonePwa();

    const mediaStandalone = window.matchMedia?.("(display-mode: standalone)");
    mediaStandalone?.addEventListener?.("change", atualizarModoStandalonePwa);

    window.addEventListener("beforeinstallprompt", (event) => {
        event.preventDefault();
        pwaInstallPrompt = event;
        console.info("[PWA] App pronto para instala\u00e7\u00e3o.");
        atualizarBotoesInstalacaoPwa();
    });

    window.addEventListener("appinstalled", () => {
        pwaInstallPrompt = null;
        console.info("[PWA] App instalado.");
        atualizarModoStandalonePwa();
    });

    document.addEventListener("click", (event) => {
        const botao = event.target.closest?.("[data-pwa-install]");
        if (!botao) return;
        event.preventDefault();
        solicitarInstalacaoPwa();
    });

    registrarServiceWorkerPwa();
}

function popularSelectCategorias(select, valor = "") {
    if (!select) return;
    select.innerHTML = categorias.map(c => `<option value="${c.name}" ${valor === c.name ? "selected" : ""}>${c.name}</option>`).join("");
    aplicarCorCategoriaSelect(select);
}

function aplicarCorCategoriaSelect(select) {
    if (!select) return;
    const atualizar = () => {
        const cor = categorias.find(c => c.name === select.value)?.color || "transparent";
        select.style.borderLeft = `5px solid ${cor}`;
    };
    select.onchange = atualizar;
    atualizar();
}

function normalizarVisaoCalendario(valor) {
    return valor === "semanal" ? "semanal" : "mensal";
}

function normalizarHoraViradaCalendario(valor) {
    const hora = parseInt(valor);
    return Number.isFinite(hora) ? Math.max(0, Math.min(23, hora)) : 21;
}

function normalizarInicioSemanaCalendario(valor) {
    const dia = parseInt(valor);
    return Number.isFinite(dia) ? Math.max(0, Math.min(6, dia)) : 0;
}

function aplicarCorCartaoSelect(select) {
    if (!select) return;
    const atualizar = () => {
        const cor = cartoes.find(c => String(c.id) === String(select.value))?.color || "transparent";
        select.style.borderLeft = `5px solid ${cor}`;
    };
    select.addEventListener("change", atualizar);
    atualizar();
}

function escapeHtml(valor) {
    return String(valor ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function categoriaFinanceiraEmUso(nome) {
    if (contasFixas.some(item => item.categoria === nome)) return true;
    if (Object.values(dados).some(anoData => (anoData.meses || []).some(mesData => (mesData.despesas || []).some(d => d.categoria === nome)))) return true;
    if (Object.values(gastosDetalhes).some(lista => (lista || []).some(g => g.categoria === nome))) return true;
    return false;
}

async function alterarSenhaUsuario(senhaAntiga, senhaNova) {
    if(!senhaAntiga || !senhaNova) {
        alert("Preencha a senha antiga e a nova senha.");
        return false;
    }

    try {
        const cred = EmailAuthProvider.credential(usuarioLogado.email, senhaAntiga);
        await reauthenticateWithCredential(usuarioLogado, cred);
        await updatePassword(usuarioLogado, senhaNova);
        senhaDoUsuario = senhaNova;
        sessionStorage.setItem("temp_key", senhaNova);
        await salvarFirebase();
        alert("Senha e criptografia atualizadas com sucesso!");
        return true;
    } catch (e) {
        console.error("Erro detalhado:", e);
        alert("Erro: Verifique se a senha antiga est\u00e1 correta ou se a nova tem pelo menos 6 caracteres.");
        return false;
    }
}

// Comentario removido por encoding corrompido.

function atualizarSaudacao() {
    const el = document.getElementById("saudacaoDinamica");
    if (!el) return;
    el.innerHTML = getSaudacaoResumoHtml();
}

function getSaudacaoResumoHtml() {
    const agora = new Date();
    const hora = agora.getHours();
    let saudacao = "";

    if (hora >= 6 && hora < 12) saudacao = "Bom dia";
    else if (hora >= 12 && hora < 18) saudacao = "Boa tarde";
    else saudacao = "Boa noite";

    const nomeSaudacao = String(configuracoes?.nomeUsuario || "").trim();
    if (nomeSaudacao) saudacao = `${saudacao}, ${escapeHtml(nomeSaudacao)}`;

    const dataExtenso = agora.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).toLowerCase();
    return `${saudacao}! Hoje &eacute; ${escapeHtml(dataExtenso)}. <span style="opacity: 0.7; font-weight: normal;">Aqui est&aacute; o seu resumo:</span>`;
}

function renderMenuLateral(activeHash = "#resumo") {
    const itens = [
        ["#resumo", "sideNavResumo", "Dashboard"],
        ["#gastos", "sideNavGastos", "Gastos"],
        ["#calendario", "sideNavCalendario", "Calend&aacute;rio"]
        // ["#analise", "sideNavAnalise", "An&aacute;lise"]
    ];
    return `
        <nav class="home-side-nav" aria-label="Navega&ccedil;&atilde;o principal">
            ${itens.map(([href, id, label]) => `<a href="${href}" id="${id}" data-route="${href}" class="${href === activeHash ? "active" : ""}">${label}</a>`).join("")}
        </nav>
    `;
}

function renderTopbarHtml(prefix = "App") {
    return `
        <div class="app-topbar home-figma-topbar">
            <div class="app-greeting titulo-secao" id="${prefix}SaudacaoMount">${getSaudacaoResumoHtml()}</div>
            <div class="app-user-actions home-user-actions">
                <span id="${prefix}DisplayEmail">${escapeHtml(usuarioLogado?.email || "")}</span>
                <button class="btn app-install-button" data-pwa-install title="Instalar o app" type="button" hidden>${materialIcon("download")}<span>INSTALAR APP</span></button>
                <button id="${prefix}SettingsBtn" class="btn-icon-home app-icon-button" title="Configura\u00e7\u00f5es" type="button">${materialIcon("settings")}</button>
                <button id="${prefix}SalvarBtn" class="btn" type="button">SALVAR</button>
                <button id="${prefix}LogoutBtn" class="btn sair" type="button">SAIR</button>
            </div>
        </div>
    `;
}

function vincularTopbar(prefix = "App") {
    const settings = document.getElementById(`${prefix}SettingsBtn`);
    const salvar = document.getElementById(`${prefix}SalvarBtn`);
    const logout = document.getElementById(`${prefix}LogoutBtn`);
    if (settings) settings.onclick = () => window.location.hash = "#configuracoes";
    if (salvar) salvar.onclick = salvarFirebase;
    if (logout) logout.onclick = () => document.getElementById("logoutBtn")?.click();
}

function renderMonthNavHtml({ prefix, anterior, atual, proximo }) {
    return `
        <div class="app-month-nav home-month-nav">
            <button class="btn" id="${prefix}MesAnterior" type="button">&lt; ${anterior}</button>
            <div class="home-current-month app-current-period"><span id="${prefix}MesAtualLabel">${atual}</span></div>
            <button class="btn" id="${prefix}MesProximo" type="button">${proximo} &gt;</button>
        </div>
    `;
}

function getAppMainContainer() {
    return Array.from(document.querySelectorAll("#appContainer > .container-central"))
        .find(el => el.querySelector("#viewResumo"));
}

function renderAppShell(activeHash = "#resumo") {
    const container = getAppMainContainer();
    if (!container) return null;
    let shell = document.getElementById("appShell");
    if (!shell) {
        shell = document.createElement("div");
        shell.id = "appShell";
        shell.className = "app-shell";
        shell.innerHTML = `
            <div class="app-topbar">
                <div class="app-greeting" id="appShellSaudacao"></div>
                <div class="app-user-actions home-user-actions">
                    <span id="appShellEmail"></span>
                    <button class="btn app-install-button" data-pwa-install title="Instalar o app" type="button" hidden>${materialIcon("download")}<span>INSTALAR APP</span></button>
                    <button id="appShellSettingsBtn" class="btn-icon-home app-icon-button" title="Configura\u00e7\u00f5es" type="button">${materialIcon("settings")}</button>
                    <button id="appShellSalvarBtn" class="btn" type="button">SALVAR</button>
                    <button id="appShellLogoutBtn" class="btn sair" type="button">SAIR</button>
                </div>
            </div>
            <div class="app-main">
                <aside class="app-sidebar">
                    <div id="appShellNav"></div>
                    <div id="appShellSidebarPanel" class="app-sidebar-panel"></div>
                </aside>
                <main id="appShellContent" class="app-content"></main>
            </div>
        `;
        container.insertBefore(shell, container.firstChild);
    }

    const footer = container.querySelector(":scope > .siteFooter");
    if (footer && footer.parentElement !== shell) {
        footer.classList.add("app-footer");
        shell.appendChild(footer);
    }

    shell.querySelector("#appShellSaudacao").innerHTML = getSaudacaoResumoHtml();
    shell.querySelector("#appShellEmail").textContent = usuarioLogado?.email || "";
    shell.querySelector("#appShellNav").innerHTML = renderMenuLateral(activeHash);
    shell.querySelector("#appShellSettingsBtn").onclick = () => window.location.hash = "#configuracoes";
    shell.querySelector("#appShellSalvarBtn").onclick = salvarFirebase;
    shell.querySelector("#appShellLogoutBtn").onclick = () => document.getElementById("logoutBtn")?.click();
    atualizarBotoesInstalacaoPwa();
    vincularDelegacaoAppShell(shell);
    return {
        shell,
        sidebarPanel: shell.querySelector("#appShellSidebarPanel"),
        content: shell.querySelector("#appShellContent")
    };
}

function vincularDelegacaoAppShell(shell) {
    if (!shell || shell.dataset.delegacaoVinculada === "true") return;
    shell.dataset.delegacaoVinculada = "true";
    shell.addEventListener("click", (event) => {
        const alvo = event.target.closest?.(
            "#homeBtnConfigCartoes, .btn-edit-cartoes-home, .btn-edit-categorias-home, #gastosBtnCartoes, #gastosBtnCategorias, #gastosBtnFixas, #gastosAddManual, #gastosAddParcela"
        );
        if (!alvo || !shell.contains(alvo)) return;

        event.preventDefault();
        event.stopPropagation();

        if (alvo.matches("#homeBtnConfigCartoes, .btn-edit-cartoes-home, #gastosBtnCartoes")) {
            abrirGerenciadorCartoes();
        } else if (alvo.matches(".btn-edit-categorias-home, #gastosBtnCategorias")) {
            abrirGerenciadorCategorias();
        } else if (alvo.matches("#gastosBtnFixas")) {
            abrirModalModuloConfigHome("moduloContasFixas", "Configurar despesas fixas", renderContasFixas);
        } else if (alvo.matches("#gastosAddManual")) {
            const { ano, mes } = getMesGastosAtivo();
            abrirModalGastoDetalhado(mes, ano);
        } else if (alvo.matches("#gastosAddParcela")) {
            const { ano, mes } = getMesGastosAtivo();
            window.abrirModalParcelamento(mes, ano);
        }
    }, true);
}

function getAppParkingLot() {
    let parking = document.getElementById("appShellParking");
    if (!parking) {
        parking = document.createElement("div");
        parking.id = "appShellParking";
        parking.hidden = true;
        document.body.appendChild(parking);
    }
    return parking;
}

function limparAppSlot(slot) {
    const parking = getAppParkingLot();
    while (slot.firstChild) parking.appendChild(slot.firstChild);
}

function moverParaSlot(el, slot) {
    if (!el || !slot) return;
    slot.appendChild(el);
}

function getOrCreateRouteContent(viewId, routeName) {
    let wrapper = document.querySelector(`[data-app-route-content="${routeName}"]`);
    if (wrapper) return wrapper;
    const view = document.getElementById(viewId);
    if (!view) return null;
    wrapper = document.createElement("div");
    wrapper.className = "app-route-content app-scroll";
    wrapper.dataset.appRouteContent = routeName;
    Array.from(view.childNodes).forEach(node => wrapper.appendChild(node));
    return wrapper;
}

function sincronizarRotaNoAppShell(hash = "#resumo") {
    const activeHash = hash === "#notas" || hash === "#configuracoes" ? "#resumo" : hash;
    const slots = renderAppShell(activeHash);
    if (!slots) return;
    limparAppSlot(slots.sidebarPanel);
    limparAppSlot(slots.content);

    if (hash === "#resumo" || hash === "") {
        moverParaSlot(document.getElementById("homeLembretesMount"), slots.sidebarPanel);
        moverParaSlot(document.querySelector(".home-dashboard-area"), slots.content);
    } else if (hash === "#gastos") {
        moverParaSlot(document.querySelector(".gastos-filter-card"), slots.sidebarPanel);
        moverParaSlot(document.querySelector(".gastos-work-area"), slots.content);
    } else if (hash === "#calendario") {
        moverParaSlot(document.querySelector(".calendar-filter-card"), slots.sidebarPanel);
        moverParaSlot(document.querySelector(".calendar-dashboard-area"), slots.content);
    } else if (hash === "#configuracoes") {
        moverParaSlot(document.querySelector(".config-hub-nav"), slots.sidebarPanel);
        moverParaSlot(document.getElementById("configHubPanel"), slots.content);
    } else if (hash === "#analise") {
        moverParaSlot(document.querySelector(".analise-filter-card"), slots.sidebarPanel);
        moverParaSlot(document.querySelector(".analise-dashboard-area"), slots.content);
    } else if (hash === "#notas") {
        moverParaSlot(getOrCreateRouteContent("viewNotas", "notas"), slots.content);
    }
}

async function rerenderRotaAtual() {
    const hash = window.location.hash || "#resumo";
    if (hash === "#gastos") {
        renderPaginaGastos();
        sincronizarRotaNoAppShell("#gastos");
    } else if (hash === "#calendario") {
        await renderCalendario(getEstadoCalendario(), getAcoesCalendario());
        sincronizarRotaNoAppShell("#calendario");
    } else if (hash === "#resumo" || hash === "") {
        renderHomeFigmaResumo();
        sincronizarRotaNoAppShell("#resumo");
    } else if (hash === "#analise") {
        renderAnalise();
        sincronizarRotaNoAppShell("#analise");
    }
}

async function rerenderCalendarioNoShell() {
    if ((window.location.hash || "#resumo") === "#calendario") {
        await rerenderRotaAtual();
    } else {
        await renderCalendario(getEstadoCalendario(), getAcoesCalendario());
    }
}

function liberarSlotsAppShellParaRender() {
    const shell = document.getElementById("appShell");
    if (!shell) return;
    const sidebarPanel = shell.querySelector("#appShellSidebarPanel");
    const content = shell.querySelector("#appShellContent");
    if (sidebarPanel) limparAppSlot(sidebarPanel);
    if (content) limparAppSlot(content);
}

// Comentario removido por encoding corrompido.
function controleAvisoPendente(mostrar) {
    ["statusAlteracao", "statusAlteracaoFloating"].forEach(id => {
      const aviso = document.getElementById(id);
      if (!aviso) return;
        aviso.style.display = mostrar ? "inline-block" : "none";
    });
}

function salvarDadosLocal() {
  saveLocalSnapshot({
    financas: dados,
    parcelas: parcelasMemoria,
    lembretes,
    contasFixas,
    receitasFixas,
    salarioFixoBase,
    categorias,
    categoriasLembretes,
    configuracoes,
    cartoes,
    gastosDetalhes,
    caixinhas
  });
}

function atualizarTextoBotoesSalvar(texto) {
  ["salvarNuvemBtn", "salvarNuvemBtnFloating", "salvarNuvemBtnHome", "appShellSalvarBtn"].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.innerText = texto;
  });
}

async function salvarFirebase() {
  if (!usuarioLogado || !senhaDoUsuario) return false;
  try {
    normalizarDadosApp();
    atualizarTextoBotoesSalvar("SALVANDO...");

    const pacote = await encryptData({
        dados,
        parcelasMemoria,
        lembretes,
        contasFixas,
        receitasFixas,
        salarioFixoBase,
        categorias,
        categoriasLembretes,
        configuracoes,
        cartoes,
        gastosDetalhes,
        caixinhas
    }, senhaDoUsuario);

    await setDoc(doc(db, "financas", usuarioLogado.uid), pacote);

    // Comentario removido por encoding corrompido.
    controleAvisoPendente(false);
    atualizarTextoBotoesSalvar("SALVO NA NUVEM");
    salvarDadosLocal();
    const btn = { set innerText(valor) { atualizarTextoBotoesSalvar(valor.replace(/^.*SALVAR$/, "SALVAR")); } };

    setTimeout(() => { if(btn) btn.innerText = "SALVAR"; }, 2000);
    return true;
  } catch (e) {
      console.error("Erro ao salvar:", e);
      atualizarTextoBotoesSalvar("ERRO AO SALVAR");
      return false;
  }
}

function aplicarComportamentoInput(input, getV, setV, anoVinculado = null) {
  if (!input) return;

  // Comentario removido por encoding corrompido.
  input.addEventListener("focus", () => {
      input.dataset.old = input.value;
      input.value = "";
  });

  // Ao sair ou dar Enter: valida e formata
  input.addEventListener("blur", async () => {
    const txt = input.value.trim();
    if (txt === "") {
        // Se sair sem digitar nada, volta o valor anterior
        input.value = input.dataset.old;
    } else {
        const v = parseValor(txt);
        setV(v);
        input.value = formatar(v);
        if (anoVinculado) atualizarTudo(anoVinculado);
        else salvarDadosLocal();
        await salvarFirebase();
    }
  });

  input.addEventListener("keydown", (e) => {
      if(e.key === "Enter") input.blur();
  });
}

// Comentario removido por encoding corrompido.
function habilitarEdicaoTextoInline(el, getValor, salvarValor) {
  if (!el) return;
  el.style.cursor = "text";
  el.onclick = (event) => {
    event.stopPropagation();
    const original = String(getValor() || "");
    const input = document.createElement("input");
    input.type = "text";
    input.className = "home-row-name inputPadrao";
    input.value = original;
    el.replaceWith(input);
    input.focus();
    input.select();
    let confirmado = false;
    input.onkeydown = async (e) => {
      if (e.key === "Enter") {
        confirmado = true;
        await salvarValor(input.value.trim() || original);
        renderHomeFigmaResumo();
      }
      if (e.key === "Escape") renderHomeFigmaResumo();
    };
    input.onblur = () => {
      if (!confirmado) renderHomeFigmaResumo();
    };
  };
}

function habilitarEdicaoValorInline(el, getValor, salvarValor) {
  if (!el) return;
  el.style.cursor = "text";
  el.onclick = (event) => {
    event.stopPropagation();
    const original = Number(getValor()) || 0;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "home-row-value inputPadrao";
    input.value = formatar(original);
    el.replaceWith(input);
    aplicarComportamentoInput(input, () => original, async (valor) => {
      await salvarValor(valor);
      renderHomeFigmaResumo();
    }, getMesHomeAtivo().anoAt);
    input.focus();
  };
}

function atualizarTudo(anoParaVisualizar) {
  const { mesAt, anoAt } = getMesReferenciaAtivo();
  const anosOrdenados = Object.keys(dados).map(Number).sort((a, b) => a - b);

  let saldoAcumulado = 0;
  let ehOPrimeiroMesDeTodos = true;

  anosOrdenados.forEach(ano => {
    if (!dados[ano] || !dados[ano].meses) return;
    dados[ano].meses.forEach((m, idx) => {
      if (!m.fixasDesativadas) m.fixasDesativadas = {};
      if (!m.receitasDesativadas) m.receitasDesativadas = {};
      if (!m.cartoesPagos) m.cartoesPagos = {};
      if (!m.fixasEditadas) m.fixasEditadas = {};

      if (!ehOPrimeiroMesDeTodos && m.contaManual !== true) m.conta = saldoAcumulado;

      const listaBaseFixas = m.fixasSnapshot ? m.fixasSnapshot : contasFixas;
      const listaBaseReceitas = m.receitasSnapshot ? m.receitasSnapshot : receitasFixas;
      const gastosDetalhados = (gastosDetalhes[ano] || []).filter(g => g.mes === idx && gastoCartaoContaNoTotal(g));
      const fixasAtivas = listaBaseFixas.filter(f => f.ativo && !m.fixasDesativadas[f.id]);

      const obterValorFixo = (f) => (m.fixasEditadas[f.id] !== undefined) ? m.fixasEditadas[f.id] : f.valor;

      const despesasPagasHome = (m.despesas || []).filter(x => x.checked).reduce((acc, b) => acc + b.valor, 0);
      const fixasPagasDinheiro = fixasAtivas.filter(f => !f.cartaoId).reduce((acc, f) => acc + obterValorFixo(f), 0);

      let totalCartoesPagos = 0;
      const totaisPorCartao = {};
      gastosDetalhados.forEach(g => { totaisPorCartao[g.cartaoId] = (totaisPorCartao[g.cartaoId] || 0) + g.valor; });
      fixasAtivas.filter(f => f.cartaoId).forEach(f => { totaisPorCartao[f.cartaoId] = (totaisPorCartao[f.cartaoId] || 0) + obterValorFixo(f); });
      Object.keys(totaisPorCartao).forEach(cid => {
          if (m.cartoesPagos[cid] === true) totalCartoesPagos += totaisPorCartao[cid];
      });

      const totalSaidaEfetiva = despesasPagasHome + fixasPagasDinheiro + totalCartoesPagos;
      const totalRendasFixas = listaBaseReceitas.filter(rf => rf.ativo && !m.receitasDesativadas[rf.id]).reduce((acc, rf) => acc + rf.valor, 0);
      const eTotal = (m.empresa || []).filter(x => x.checked).reduce((acc, b) => acc + b.valor, 0);
      const salarioBase = (m.salarioSnapshot !== undefined) ? m.salarioSnapshot : (m.salario || 0);

      const tDisp = salarioBase + (m.conta || 0) + eTotal + totalRendasFixas;
      const saldoFinal = tDisp - totalSaidaEfetiva;

      m.saldoCalculadoFinal = saldoFinal;
      saldoAcumulado = saldoFinal;
      ehOPrimeiroMesDeTodos = false;

      if (ano === Number(anoParaVisualizar)) {
        const infoHome = mesesDOM.find(item => item.index === idx);
        if (infoHome) {
          const dom = infoHome.dom;
          const listaCartoesDiv = dom.querySelector(".listaCartoesDinamica");
          if (listaCartoesDiv) {
              listaCartoesDiv.innerHTML = "";
              if (Object.keys(totaisPorCartao).length > 0) {
                  listaCartoesDiv.innerHTML = `<div style='display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; gap:8px;'><small style='opacity:0.6'>PAGAMENTO DE CART?ES:</small><button type='button' class='btn-mini-gerenciar btn-edit-cartoes-home' title='Editar cart?es'>${materialIcon("settings")}</button></div>`;
                  const btnEditCartoesHome = listaCartoesDiv.querySelector(".btn-edit-cartoes-home");
                  if (btnEditCartoesHome) btnEditCartoesHome.onclick = (e) => { e.stopPropagation(); abrirGerenciadorCartoes(); };
                  Object.keys(totaisPorCartao).forEach(cid => {
                      const cObj = cartoes.find(c => c.id == cid);
                      if (cObj) {
                          const itemC = document.createElement("div");
                          const pago = m.cartoesPagos[cid] === true;
                          itemC.className = `item-cartao-resumo ${pago ? 'pago' : ''}`;
                          const corCard = cObj.color || '#D78341';
                          itemC.style.borderLeft = `4px solid ${corCard}`;
                          itemC.onmouseenter = () => { itemC.style.backgroundColor = corCard + "4D"; itemC.style.color = "white"; };
                          itemC.onmouseleave = () => { itemC.style.backgroundColor = ""; itemC.style.color = ""; };
                          itemC.innerHTML = `<div style="display:flex; align-items:center;"><input type="checkbox" class="check-cartao" ${pago ? 'checked' : ''}><span class="txt-cartao">${cObj.nome}</span></div><span>${formatar(totaisPorCartao[cid])}</span>`;
                          itemC.querySelector(".check-cartao").onclick = (e) => { e.stopPropagation(); m.cartoesPagos[cid] = e.target.checked; controleAvisoPendente(true); atualizarTudo(ano); salvarFirebase(); renderLembretesHome(); rerenderCalendarioNoShell(); };
                          itemC.onclick = () => { document.getElementById("anoGastos").value = ano; setMesGastosAtivo(ano, idx); filtrosPorMes[idx] = cid; filtrosGastosDetalhados.cartao = cid; window.location.hash = "#gastos"; };
                          listaCartoesDiv.appendChild(itemC);
                      }
                  });
              }
          }
          dom.querySelector(".totalDespesas").textContent = formatar(totalSaidaEfetiva);
          dom.querySelector(".totalDinheiro").textContent = formatar(tDisp);
          const sEl = dom.querySelector(".saldo"); sEl.textContent = formatar(saldoFinal);
          sEl.className = "saldo " + (saldoFinal >= 0 ? "positivo" : "negativo");
          dom.querySelector(".mesTotal").textContent = formatar(saldoFinal);
          const inS = dom.querySelector("input.salario"); const inC = dom.querySelector("input.conta");
          if (document.activeElement !== inS) inS.value = formatar(salarioBase);
          if (document.activeElement !== inC) { inC.value = formatar(m.conta); if (m.contaManual === true) inC.classList.add("manual"); else inC.classList.remove("manual"); }
          if (ano === anoAt && idx === mesAt) dom.classList.add("mesAtual"); else dom.classList.remove("mesAtual");
        }
      }
    });
  });
  salvarDadosLocal();
  atualizarGrafico(Number(anoParaVisualizar));
  renderLembretesHome();
  renderBalancoRapido();
  renderHomeFinanceCards();
  popularControlesDespesaRapida();
  renderCaixinhas(); // <--- CRUCIAL: RECONECTA AS CAIXINHAS
}

function processarAutoCobranca() {
    const agora = new Date();
    const diaHoje = agora.getDate();
    const mesHoje = agora.getMonth();
    const anoHoje = agora.getFullYear();

    // Comentario removido por encoding corrompido.
    if (dados[anoHoje] && dados[anoHoje].meses[mesHoje]) {
        const m = dados[anoHoje].meses[mesHoje];

        // Comentario removido por encoding corrompido.
        if (!m.fixasDesativadas) m.fixasDesativadas = {};

        // Varre todas as suas despesas fixas (assinaturas, contas, etc)
        contasFixas.forEach(f => {
            const diaVencimento = parseInt(f.dia) || 1;

            // Comentario removido por encoding corrompido.
            // Comentario removido por encoding corrompido.
            if (diaHoje < diaVencimento) {
                // Comentario removido por encoding corrompido.
                m.fixasDesativadas[f.id] = true;
            } else {
                // Comentario removido por encoding corrompido.
                // Removemos da lista de desativadas
                delete m.fixasDesativadas[f.id];
            }
        });
    }
}

function atualizarGrafico(ano) {
    const ctx = document.getElementById("grafico");
    if (!ctx || !dados[ano] || !dados[ano].meses || dados[ano].meses.length === 0) return;

    const agora = new Date();
    const mesReal = agora.getMonth();
    const anoReal = agora.getFullYear();

    // Comentario removido por encoding corrompido.
    let pColor = getComputedStyle(document.body).getPropertyValue('--P04').trim() || '#D78341';
    const tColor = "#ffffff";

    const saldos = dados[ano].meses.map(m => parseFloat((m.saldoCalculadoFinal || 0).toFixed(2)));
    const labels = dados[ano].meses.map((_, i) => nomesMesesCurto[i]);

    const coresDinamicas = labels.map((_, i) => {
        const ehFuturo = (Number(ano) > anoReal) || (Number(ano) === anoReal && i > mesReal);
        return ehFuturo ? pColor + "80" : pColor;
    });

    const options = {
        series: [{ name: 'Saldo', data: saldos }],
        chart: {
            type: 'bar',
            height: '100%',
            width: '100%',
            toolbar: { show: false },
            background: 'transparent',
            foreColor: tColor
        },
        colors: coresDinamicas,
        xaxis: { categories: labels },
        yaxis: { labels: { formatter: (val) => "R$ " + val.toLocaleString('pt-BR') } },
        grid: { borderColor: 'rgba(255,255,255,0.1)' },
        legend: { show: false },
        dataLabels: {
            enabled: true,
            formatter: (val) => "R$ " + val.toLocaleString('pt-BR'),
            style: { fontSize: '10px' },
            offsetY: -20
        },
        plotOptions: {
            bar: {
                dataLabels: { position: 'top' },
                borderRadius: 4,
                distributed: true
            }
        },
        // --- REGRA DE HOVER (TOOLTIP) RECUPERADA AQUI ---
        tooltip: {
            theme: 'dark',
            y: {
                formatter: (val) => "R$ " + val.toLocaleString('pt-BR'),
                title: {
                    formatter: (seriesName, { dataPointIndex }) => {
                        // Comentario removido por encoding corrompido.
                        const ehFuturo = (Number(ano) > anoReal) || (Number(ano) === anoReal && dataPointIndex > mesReal);
                        return ehFuturo ? "Previs?o: " : "Saldo: ";
                    }
                }
            }
        }
    };

    if (chartResumo) chartResumo.destroy();
    chartResumo = new ApexCharts(ctx, options);
    chartResumo.render();
}

function obterTotalCartoesMes(ano, mes) {
    const mData = dados?.[ano]?.meses?.[mes];
    const listaFixas = mData?.fixasSnapshot ? mData.fixasSnapshot : contasFixas;
    const totalVariavel = (gastosDetalhes[ano] || [])
        .filter(g => g.mes === mes && gastoCartaoContaNoTotal(g))
        .reduce((acc, g) => acc + (Number(g.valor) || 0), 0);
    const totalFixo = listaFixas
        .filter(f => f.ativo && f.cartaoId)
        .reduce((acc, f) => acc + ((mData?.fixasEditadas?.[f.id] !== undefined) ? mData.fixasEditadas[f.id] : f.valor), 0);
    return totalVariavel + totalFixo;
}

function getCorCategoriaAnalise(nome) {
    return categorias.find(c => String(c.name) === String(nome))?.color || "var(--P04)";
}

function getNomeCategoriaAnalise(nome) {
    return String(nome || categorias[0]?.name || "Sem categoria");
}

function getMesesDisponiveisAnalise(ano) {
    const mesesAno = dados?.[ano]?.meses || [];
    if (!mesesAno.length) return Array.from({ length: 12 }, (_, index) => index);
    return mesesAno.map((_, index) => index);
}

function getMesesFiltradosAnalise(ano, filtros = filtrosAnalise) {
    const disponiveis = getMesesDisponiveisAnalise(ano);
    if (filtros.periodo === "mes") {
        const mes = Number(filtros.mes);
        return disponiveis.includes(mes) ? [mes] : [];
    }
    if (filtros.periodo === "ultimos3" || filtros.periodo === "ultimos6") {
        const qtd = filtros.periodo === "ultimos3" ? 3 : 6;
        const ref = getMesReferenciaAtivo();
        let fim = Number(ano) === Number(ref.anoAt) ? ref.mesAt : disponiveis[disponiveis.length - 1];
        if (!Number.isInteger(fim)) fim = 11;
        return disponiveis.filter(mes => mes <= fim).slice(-qtd);
    }
    return disponiveis;
}

function passaFiltrosDespesaAnalise(item, filtros = filtrosAnalise) {
    if (!item) return false;
    if (filtros.tipo !== "todos" && item.tipo !== filtros.tipo) return false;
    if (filtros.categoria !== "todas" && getNomeCategoriaAnalise(item.categoria) !== filtros.categoria) return false;
    if (filtros.cartao !== "todos" && String(item.cartaoId || "") !== String(filtros.cartao)) return false;
    if (filtros.apenasPagos && item.pago !== true) return false;
    return true;
}

function adicionarValorMapa(mapa, chave, valor, extra = {}) {
    const key = String(chave || "Sem categoria");
    if (!mapa[key]) mapa[key] = { nome: key, valor: 0, ...extra };
    mapa[key].valor += Number(valor) || 0;
    Object.assign(mapa[key], extra);
}

function coletarDespesasAnaliseMes(ano, mes, filtros = filtrosAnalise) {
    const mData = dados?.[ano]?.meses?.[mes] || {};
    const itens = [];
    const listaFixas = mData.fixasSnapshot ? mData.fixasSnapshot : contasFixas;
    const fixasAtivas = (listaFixas || []).filter(f => f.ativo && !mData.fixasDesativadas?.[f.id]);

    fixasAtivas.forEach(fixa => {
        const valor = Number(getValorFixaMes(fixa, mData)) || 0;
        const card = getCartaoById(fixa.cartaoId);
        const pago = fixa.cartaoId ? mData.cartoesPagos?.[fixa.cartaoId] === true : true;
        itens.push({
            tipo: "fixas",
            nome: fixa.nome || "Despesa fixa",
            valor,
            categoria: getNomeCategoriaAnalise(fixa.categoria),
            cartaoId: fixa.cartaoId || "",
            cartaoNome: card?.nome || "",
            cartaoCor: card?.color || "var(--P04)",
            data: isoDataMes(ano, mes, fixa.dia || 1),
            pago,
            fixa: true
        });
    });

    (mData.despesas || []).forEach(despesa => {
        itens.push({
            tipo: "variaveis",
            nome: despesa.nome || despesa.descricao || "Despesa",
            valor: Number(despesa.valor) || 0,
            categoria: getNomeCategoriaAnalise(despesa.categoria),
            cartaoId: "",
            cartaoNome: "",
            data: getDataDespesa(despesa, ano, mes),
            pago: despesa.checked === true
        });
    });

    (gastosDetalhes[ano] || [])
        .filter(gasto => Number(gasto.mes) === Number(mes) && gastoCartaoContaNoTotal(gasto))
        .forEach(gasto => {
            const card = getCartaoById(gasto.cartaoId);
            itens.push({
                tipo: gasto.parcelaId ? "parcelas" : "cartoes",
                nome: gasto.nome || "Gasto no cartao",
                valor: Number(gasto.valor) || 0,
                categoria: getNomeCategoriaAnalise(gasto.categoria),
                cartaoId: gasto.cartaoId || "",
                cartaoNome: card?.nome || "",
                cartaoCor: card?.color || "var(--P04)",
                data: getDataDespesa(gasto, ano, mes),
                pago: mData.cartoesPagos?.[gasto.cartaoId] === true,
                parcelaId: gasto.parcelaId || ""
            });
        });

    return itens.filter(item => passaFiltrosDespesaAnalise(item, filtros));
}

function calcularEntradasAnaliseMes(ano, mes) {
    const mData = dados?.[ano]?.meses?.[mes] || {};
    const listaReceitas = mData.receitasSnapshot ? mData.receitasSnapshot : receitasFixas;
    const salarioBase = (mData.salarioSnapshot !== undefined) ? Number(mData.salarioSnapshot) : Number(mData.salario || salarioFixoBase || 0);
    const conta = Number(mData.conta) || 0;
    const empresas = (mData.empresa || [])
        .filter(item => item.checked !== false)
        .reduce((acc, item) => acc + (Number(item.valor) || 0), 0);
    const rendas = (listaReceitas || [])
        .filter(renda => renda.ativo && !mData.receitasDesativadas?.[renda.id])
        .reduce((acc, renda) => acc + (Number(renda.valor) || 0), 0);
    return salarioBase + conta + empresas + rendas;
}

function calcularPrevisaoAnalise(anoBase) {
    const ref = getMesReferenciaAtivo();
    const inicio = new Date(Number(ref.anoAt), Number(ref.mesAt) + 1, 1);
    const horizontes = [3, 6, 12];
    return horizontes.map(qtd => {
        let total = 0;
        for (let i = 0; i < qtd; i += 1) {
            const data = new Date(inicio.getFullYear(), inicio.getMonth() + i, 1);
            const ano = data.getFullYear();
            const mes = data.getMonth();
            const mData = dados?.[ano]?.meses?.[mes] || {};
            const despesas = coletarDespesasAnaliseMes(ano, mes, { ...filtrosAnalise, periodo: "ano", tipo: "todos", cartao: "todos", categoria: "todas", apenasPagos: false })
                .reduce((acc, item) => acc + item.valor, 0);
            total += calcularEntradasAnaliseMes(ano, mes) - despesas;
        }
        return { label: `${qtd} meses`, meses: qtd, valor: total, anoBase };
    });
}

function criarAgregacaoAnalise() {
    const ano = Number(filtrosAnalise.ano || hoje.getFullYear());
    const meses = getMesesFiltradosAnalise(ano, filtrosAnalise);
    const labels = meses.map(mes => nomesMesesCurto[mes]);
    const categoriasMap = {};
    const cartoesMap = {};
    const composicao = { fixas: [], variaveis: [], cartoes: [], parcelas: [] };
    const entradasSerie = [];
    const despesasSerie = [];
    const saldoSerie = [];
    const gastosPorMesCartao = [];
    const todosGastos = [];
    let totalEntradas = 0;
    let totalDespesas = 0;

    meses.forEach(mes => {
        const entradasMes = calcularEntradasAnaliseMes(ano, mes);
        const despesasMesItens = coletarDespesasAnaliseMes(ano, mes, filtrosAnalise);
        const totalMes = despesasMesItens.reduce((acc, item) => acc + item.valor, 0);
        totalEntradas += entradasMes;
        totalDespesas += totalMes;
        entradasSerie.push(Number(entradasMes.toFixed(2)));
        despesasSerie.push(Number(totalMes.toFixed(2)));
        saldoSerie.push(Number((entradasMes - totalMes).toFixed(2)));

        const somaTipo = { fixas: 0, variaveis: 0, cartoes: 0, parcelas: 0 };
        let cartoesMes = 0;
        despesasMesItens.forEach(item => {
            somaTipo[item.tipo] += item.valor;
            adicionarValorMapa(categoriasMap, getNomeCategoriaAnalise(item.categoria), item.valor, { cor: getCorCategoriaAnalise(item.categoria) });
            if (item.cartaoId) {
                cartoesMes += item.valor;
                adicionarValorMapa(cartoesMap, item.cartaoId, item.valor, {
                    id: item.cartaoId,
                    nome: item.cartaoNome || "Cartao",
                    cor: item.cartaoCor || "var(--P04)"
                });
            }
            todosGastos.push({ ...item, ano, mes });
        });
        Object.keys(composicao).forEach(tipo => composicao[tipo].push(Number((somaTipo[tipo] || 0).toFixed(2))));
        gastosPorMesCartao.push({ mes, valor: cartoesMes });
    });

    const mesesComSaldo = meses.map((mes, index) => ({ mes, label: nomesMesesFull[mes], saldo: saldoSerie[index], despesas: despesasSerie[index], cartoes: gastosPorMesCartao[index]?.valor || 0 }));
    const melhorMes = mesesComSaldo.length ? mesesComSaldo.reduce((a, b) => b.saldo > a.saldo ? b : a) : null;
    const piorMes = mesesComSaldo.length ? mesesComSaldo.reduce((a, b) => b.saldo < a.saldo ? b : a) : null;
    const mesMaisCaroCartoes = mesesComSaldo.length ? mesesComSaldo.reduce((a, b) => b.cartoes > a.cartoes ? b : a) : null;
    const categoriasLista = Object.values(categoriasMap).sort((a, b) => b.valor - a.valor);
    const cartoesLista = Object.values(cartoesMap).sort((a, b) => b.valor - a.valor);
    const maioresGastos = todosGastos.slice().sort((a, b) => b.valor - a.valor).slice(0, 10);
    const fixasPesadas = todosGastos.filter(item => item.tipo === "fixas").sort((a, b) => b.valor - a.valor).slice(0, 5);
    const parcelasFuturas = coletarParcelasFuturasAnalise();
    const caixinhasResumo = caixinhas.map(cx => {
        const info = obterDadosCaixinha(cx.id);
        return { nome: cx.nome || "Caixinha", saldo: info.total || 0, movimentacoes: info.historico?.length || 0 };
    }).sort((a, b) => b.saldo - a.saldo);

    return {
        ano,
        meses,
        labels,
        totalEntradas,
        totalDespesas,
        saldoAcumulado: totalEntradas - totalDespesas,
        mediaGastos: meses.length ? totalDespesas / meses.length : 0,
        melhorMes,
        piorMes,
        mesMaisCaroCartoes,
        categorias: categoriasLista,
        cartoes: cartoesLista,
        maioresGastos,
        fixasPesadas,
        parcelasFuturas,
        caixinhas: caixinhasResumo,
        previsoes: calcularPrevisaoAnalise(ano),
        series: { saldo: saldoSerie, entradas: entradasSerie, despesas: despesasSerie, composicao },
        insights: gerarInsightsAnalise({ totalEntradas, totalDespesas, categoriasLista, cartoesLista, maioresGastos, parcelasFuturas, fixasPesadas })
    };
}

function coletarParcelasFuturasAnalise() {
    const ref = getMesReferenciaAtivo();
    const futuras = {};
    Object.entries(gastosDetalhes || {}).forEach(([ano, lista]) => {
        (lista || []).forEach(gasto => {
            if (!gasto.parcelaId || !gastoCartaoContaNoTotal(gasto)) return;
            const dataMes = new Date(Number(ano), Number(gasto.mes) || 0, 1);
            const depoisReferencia = dataMes.getFullYear() > ref.anoAt || (dataMes.getFullYear() === ref.anoAt && dataMes.getMonth() >= ref.mesAt);
            if (!depoisReferencia) return;
            const chave = `${dataMes.getFullYear()}-${String(dataMes.getMonth()).padStart(2, "0")}`;
            futuras[chave] = futuras[chave] || { label: `${nomesMesesCurto[dataMes.getMonth()]} ${dataMes.getFullYear()}`, valor: 0 };
            futuras[chave].valor += Number(gasto.valor) || 0;
        });
    });
    return Object.values(futuras).sort((a, b) => a.label.localeCompare(b.label)).slice(0, 12);
}

function gerarInsightsAnalise(base) {
    const insights = [];
    const maiorGasto = base.maioresGastos?.[0];
    if (maiorGasto) insights.push(`Seu maior gasto no periodo foi ${maiorGasto.nome}, com ${formatar(maiorGasto.valor)}.`);
    const topCategoria = base.categoriasLista?.[0];
    if (topCategoria && base.totalDespesas > 0) {
        const pct = Math.round((topCategoria.valor / base.totalDespesas) * 100);
        insights.push(`${topCategoria.nome} concentrou ${pct}% das despesas filtradas.`);
    }
    const topCartao = base.cartoesLista?.[0];
    if (topCartao) insights.push(`${topCartao.nome} foi o cartao com maior volume no periodo.`);
    const totalParcelas = (base.parcelasFuturas || []).reduce((acc, item) => acc + item.valor, 0);
    if (totalParcelas > 0) insights.push(`Voce tem ${formatar(totalParcelas)} em parcelas futuras ja cadastradas.`);
    const totalFixas = (base.fixasPesadas || []).reduce((acc, item) => acc + item.valor, 0);
    if (totalFixas > 0 && base.totalEntradas > 0) {
        insights.push(`As fixas filtradas comprometem ${Math.round((totalFixas / base.totalEntradas) * 100)}% das entradas do periodo.`);
    }
    return insights;
}

function renderAnalise() {
    atualizarSeletorAnos();
    const anoAtual = String(filtrosAnalise.ano || document.getElementById("ano")?.value || hoje.getFullYear());
    filtrosAnalise.ano = anoAtual;
    atualizarTudo(anoAtual);
    const area = document.getElementById("viewAnalise");
    if (!area) return;
    const agregacao = criarAgregacaoAnalise();
    const opcoesAno = Array.from(new Set([...Object.keys(dados), String(hoje.getFullYear()), String(hoje.getFullYear() + 1)]))
        .map(Number).sort((a, b) => a - b)
        .map(ano => `<option value="${ano}" ${String(ano) === String(filtrosAnalise.ano) ? "selected" : ""}>${ano}</option>`).join("");
    const opcoesMes = nomesMesesFull.map((nome, index) => `<option value="${index}" ${String(index) === String(filtrosAnalise.mes) ? "selected" : ""}>${nome}</option>`).join("");
    const opcoesCategoria = [`<option value="todas">Todas</option>`].concat(categorias.map(cat => `<option value="${escapeHtml(cat.name)}" ${filtrosAnalise.categoria === cat.name ? "selected" : ""}>${escapeHtml(cat.name)}</option>`)).join("");
    const opcoesCartao = [`<option value="todos">Todos</option>`].concat(cartoes.map(card => `<option value="${card.id}" ${String(filtrosAnalise.cartao) === String(card.id) ? "selected" : ""}>${escapeHtml(card.nome)}</option>`)).join("");

    area.innerHTML = `
        <div class="analise-filter-card app-card">
            <div class="app-card-header despHeader"><h3>Filtros</h3></div>
            <div class="app-card-body analise-filter-body">
                <label>Ano<select id="analiseAnoFiltro" class="inputPadrao">${opcoesAno}</select></label>
                <label>Periodo<select id="analisePeriodoFiltro" class="inputPadrao">
                    <option value="ano" ${filtrosAnalise.periodo === "ano" ? "selected" : ""}>Ano inteiro</option>
                    <option value="mes" ${filtrosAnalise.periodo === "mes" ? "selected" : ""}>Mes especifico</option>
                    <option value="ultimos3" ${filtrosAnalise.periodo === "ultimos3" ? "selected" : ""}>Ultimos 3 meses</option>
                    <option value="ultimos6" ${filtrosAnalise.periodo === "ultimos6" ? "selected" : ""}>Ultimos 6 meses</option>
                </select></label>
                <label class="${filtrosAnalise.periodo === "mes" ? "" : "is-muted"}">Mes<select id="analiseMesFiltro" class="inputPadrao" ${filtrosAnalise.periodo === "mes" ? "" : "disabled"}>${opcoesMes}</select></label>
                <label>Cartao<select id="analiseCartaoFiltro" class="inputPadrao">${opcoesCartao}</select></label>
                <label>Categoria<select id="analiseCategoriaFiltro" class="inputPadrao">${opcoesCategoria}</select></label>
                <label>Tipo<select id="analiseTipoFiltro" class="inputPadrao">
                    <option value="todos" ${filtrosAnalise.tipo === "todos" ? "selected" : ""}>Todos</option>
                    <option value="fixas" ${filtrosAnalise.tipo === "fixas" ? "selected" : ""}>Fixas</option>
                    <option value="variaveis" ${filtrosAnalise.tipo === "variaveis" ? "selected" : ""}>Variaveis</option>
                    <option value="cartoes" ${filtrosAnalise.tipo === "cartoes" ? "selected" : ""}>Cartoes</option>
                    <option value="parcelas" ${filtrosAnalise.tipo === "parcelas" ? "selected" : ""}>Parcelas</option>
                </select></label>
                <label class="analise-check"><input id="analiseApenasPagos" type="checkbox" ${filtrosAnalise.apenasPagos ? "checked" : ""}> Somente pagos/checkados</label>
                <button type="button" id="analiseLimparFiltros" class="btn">Limpar filtros</button>
            </div>
        </div>
        <div class="analise-dashboard-area">
            <div class="analise-metric-grid">
                ${renderAnaliseMetrica("Entradas", agregacao.totalEntradas)}
                ${renderAnaliseMetrica("Despesas", agregacao.totalDespesas)}
                ${renderAnaliseMetrica("Saldo acumulado", agregacao.saldoAcumulado)}
                ${renderAnaliseMetrica("Media mensal", agregacao.mediaGastos)}
                ${renderAnaliseMetrica("Melhor mes", agregacao.melhorMes ? agregacao.melhorMes.saldo : 0, agregacao.melhorMes?.label || "-")}
                ${renderAnaliseMetrica("Pior mes", agregacao.piorMes ? agregacao.piorMes.saldo : 0, agregacao.piorMes?.label || "-")}
                ${renderAnaliseMetrica("Mes mais caro em cartoes", agregacao.mesMaisCaroCartoes?.cartoes || 0, agregacao.mesMaisCaroCartoes?.label || "-")}
            </div>
            <div class="analise-chart-grid">
                ${renderAnaliseChartCard("Saldo por mes", "analiseChartSaldo", "wide")}
                ${renderAnaliseChartCard("Gastos por categoria", "analiseChartCategorias")}
                ${renderAnaliseChartCard("Gastos por cartao", "analiseChartCartoes")}
                ${renderAnaliseChartCard("Entradas vs despesas", "analiseChartFluxo", "wide")}
                ${renderAnaliseChartCard("Composicao das despesas", "analiseChartComposicao", "wide")}
            </div>
            <div class="analise-list-grid">
                ${renderAnaliseLista("Top categorias", agregacao.categorias.slice(0, 5), item => item.nome, item => item.valor)}
                ${renderAnaliseLista("Top cartoes", agregacao.cartoes.slice(0, 5), item => item.nome, item => item.valor)}
                ${renderAnaliseLista("Maiores gastos", agregacao.maioresGastos, item => `${item.nome} - ${formatarDataCompactaGasto(item.data)}`, item => item.valor)}
                ${renderAnaliseLista("Parcelas futuras", agregacao.parcelasFuturas, item => item.label, item => item.valor)}
                ${renderAnaliseLista("Fixas mais pesadas", agregacao.fixasPesadas, item => item.nome, item => item.valor)}
                ${renderAnaliseLista("Caixinhas", agregacao.caixinhas, item => `${item.nome} (${item.movimentacoes})`, item => item.saldo)}
            </div>
            <div class="analise-projecao">
                <div class="app-card-header despHeader"><h3>Proximos meses</h3></div>
                <div class="analise-projecao-grid">
                    ${agregacao.previsoes.map(item => renderAnaliseMetrica(item.label, item.valor)).join("")}
                </div>
            </div>
            <div class="analise-insights">
                <div class="app-card-header despHeader"><h3>Insights automaticos</h3></div>
                <div class="analise-insight-list">
                    ${agregacao.insights.length ? agregacao.insights.map(texto => `<div class="analise-insight-card">${escapeHtml(texto)}</div>`).join("") : `<div class="home-empty-row">Sem dados suficientes para gerar insights.</div>`}
                </div>
            </div>
        </div>
    `;

    vincularFiltrosAnalise();
    sincronizarRotaNoAppShell("#analise");
    renderAnaliseCharts(agregacao);
}

function renderAnaliseMetrica(label, valor, contexto = "") {
    return `
        <div class="home-metric analise-metric-card">
            <small>${escapeHtml(label)}</small>
            ${contexto ? `<span>${escapeHtml(contexto)}</span>` : ""}
            <strong>${formatar(valor || 0)}</strong>
        </div>
    `;
}

function renderAnaliseChartCard(titulo, id, classe = "") {
    return `
        <section class="analise-chart-card ${classe}">
            <div class="app-card-header despHeader"><h3>${escapeHtml(titulo)}</h3></div>
            <div class="analise-chart-body"><div id="${id}"></div></div>
        </section>
    `;
}

function renderAnaliseLista(titulo, itens, getNome, getValor) {
    return `
        <section class="analise-list-card">
            <div class="app-card-header despHeader"><h3>${escapeHtml(titulo)}</h3></div>
            <div class="analise-list-body">
                ${itens?.length ? itens.map(item => `
                    <button type="button" class="analise-list-row" data-analise-label="${escapeHtml(getNome(item))}">
                        <span>${escapeHtml(getNome(item))}</span>
                        <strong>${formatar(getValor(item) || 0)}</strong>
                    </button>
                `).join("") : `<div class="home-empty-row">Sem dados no periodo.</div>`}
            </div>
        </section>
    `;
}

function vincularFiltrosAnalise() {
    const bind = (id, prop, parser = v => v) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.onchange = () => {
            filtrosAnalise[prop] = parser(el.type === "checkbox" ? el.checked : el.value);
            renderAnalise();
        };
    };
    bind("analiseAnoFiltro", "ano");
    bind("analisePeriodoFiltro", "periodo");
    bind("analiseMesFiltro", "mes");
    bind("analiseCartaoFiltro", "cartao");
    bind("analiseCategoriaFiltro", "categoria");
    bind("analiseTipoFiltro", "tipo");
    bind("analiseApenasPagos", "apenasPagos", Boolean);
    const limpar = document.getElementById("analiseLimparFiltros");
    if (limpar) limpar.onclick = () => {
        filtrosAnalise = { ...filtrosAnalise, periodo: "ano", cartao: "todos", categoria: "todas", tipo: "todos", apenasPagos: false };
        renderAnalise();
    };
}

function renderAnaliseCharts(agregacao) {
    const corTexto = getComputedStyle(document.body).getPropertyValue("--P01").trim() || "#FFF8E7";
    const corPrimaria = getComputedStyle(document.body).getPropertyValue("--P04").trim() || "#D78341";
    const corSecundaria = getComputedStyle(document.body).getPropertyValue("--P05").trim() || "#586E5F";
    const destruir = chart => { if (chart) chart.destroy(); };
    destruir(chartAnaliseSaldo); destruir(chartAnaliseCategorias); destruir(chartAnaliseCartoes); destruir(chartAnaliseFluxo); destruir(chartAnaliseComposicao);
    chartAnaliseSaldo = chartAnaliseCategorias = chartAnaliseCartoes = chartAnaliseFluxo = chartAnaliseComposicao = null;

    const baseChart = {
        background: "transparent",
        foreColor: corTexto,
        toolbar: { show: false },
        animations: { enabled: true }
    };
    const money = valor => formatar(Number(valor) || 0);

    const saldoEl = document.getElementById("analiseChartSaldo");
    if (saldoEl) {
        chartAnaliseSaldo = new ApexCharts(saldoEl, {
            series: [{ name: "Saldo", data: agregacao.series.saldo }],
            chart: { ...baseChart, type: "bar", height: 250 },
            colors: [corPrimaria],
            xaxis: { categories: agregacao.labels },
            yaxis: { labels: { formatter: money } },
            dataLabels: { enabled: false },
            grid: { borderColor: "rgba(255,255,255,0.12)" },
            tooltip: { y: { formatter: money } },
            plotOptions: { bar: { borderRadius: 5 } }
        });
        chartAnaliseSaldo.render();
    }

    const catEl = document.getElementById("analiseChartCategorias");
    if (catEl) {
        const labels = agregacao.categorias.map(item => item.nome);
        if (!labels.length) {
            catEl.innerHTML = `<div class="home-empty-row">Sem gastos por categoria no periodo.</div>`;
        } else {
        chartAnaliseCategorias = new ApexCharts(catEl, {
            series: agregacao.categorias.map(item => Number(item.valor.toFixed(2))),
            labels,
            chart: {
                ...baseChart,
                type: "donut",
                height: 260,
                events: { dataPointSelection: (_e, _ctx, cfg) => { filtrosAnalise.categoria = labels[cfg.dataPointIndex] || "todas"; renderAnalise(); } }
            },
            colors: agregacao.categorias.map(item => item.cor || corPrimaria),
            legend: { show: false },
            dataLabels: { enabled: false },
            tooltip: { y: { formatter: money } },
            plotOptions: { pie: { donut: { labels: { show: true, total: { show: true, label: "Categorias", formatter: w => money(w.globals.seriesTotals.reduce((acc, v) => acc + v, 0)) } } } } }
        });
        chartAnaliseCategorias.render();
        }
    }

    const cartEl = document.getElementById("analiseChartCartoes");
    if (cartEl) {
        const labels = agregacao.cartoes.map(item => item.nome);
        if (!labels.length) {
            cartEl.innerHTML = `<div class="home-empty-row">Sem gastos por cartao no periodo.</div>`;
        } else {
        chartAnaliseCartoes = new ApexCharts(cartEl, {
            series: [{ name: "Cartoes", data: agregacao.cartoes.map(item => Number(item.valor.toFixed(2))) }],
            chart: {
                ...baseChart,
                type: "bar",
                height: 260,
                events: { dataPointSelection: (_e, _ctx, cfg) => { const card = agregacao.cartoes[cfg.dataPointIndex]; if (card?.id) { filtrosAnalise.cartao = card.id; renderAnalise(); } } }
            },
            colors: agregacao.cartoes.map(item => item.cor || corPrimaria),
            plotOptions: { bar: { horizontal: true, borderRadius: 5, distributed: true } },
            xaxis: { categories: labels, labels: { formatter: money } },
            dataLabels: { enabled: false },
            tooltip: { y: { formatter: money } }
        });
        chartAnaliseCartoes.render();
        }
    }

    const fluxoEl = document.getElementById("analiseChartFluxo");
    if (fluxoEl) {
        chartAnaliseFluxo = new ApexCharts(fluxoEl, {
            series: [
                { name: "Entradas", data: agregacao.series.entradas },
                { name: "Despesas", data: agregacao.series.despesas }
            ],
            chart: { ...baseChart, type: "line", height: 270 },
            colors: ["#4DD48A", corPrimaria],
            xaxis: { categories: agregacao.labels },
            yaxis: { labels: { formatter: money } },
            stroke: { curve: "smooth", width: 3 },
            markers: { size: 3 },
            tooltip: { y: { formatter: money } },
            grid: { borderColor: "rgba(255,255,255,0.12)" }
        });
        chartAnaliseFluxo.render();
    }

    const compEl = document.getElementById("analiseChartComposicao");
    if (compEl) {
        chartAnaliseComposicao = new ApexCharts(compEl, {
            series: [
                { name: "Fixas", data: agregacao.series.composicao.fixas },
                { name: "Variaveis", data: agregacao.series.composicao.variaveis },
                { name: "Cartoes", data: agregacao.series.composicao.cartoes },
                { name: "Parcelas", data: agregacao.series.composicao.parcelas }
            ],
            chart: { ...baseChart, type: "bar", height: 270, stacked: true },
            colors: ["#FF4545", "#CDCDCD", corPrimaria, corSecundaria],
            xaxis: { categories: agregacao.labels },
            yaxis: { labels: { formatter: money } },
            dataLabels: { enabled: false },
            tooltip: { y: { formatter: money } },
            plotOptions: { bar: { borderRadius: 4 } },
            grid: { borderColor: "rgba(255,255,255,0.12)" }
        });
        chartAnaliseComposicao.render();
    }
}

function montarHtmlUltimasEntradasRapidas(itens) {
    return itens.length ? itens.map(item => `
        <div class="ultima-entrada" style="--entry-category-color:${item.categoriaCor || "var(--P04)"}">
            <span>${item.nome || "Despesa"}${item.dataLabel ? ` &bull; ${item.dataLabel}` : ""}</span>
            ${item.cartaoNome ? `<em class="ultima-entrada-card" style="--card-color:${item.cartaoCor || "var(--P04)"}">${escapeHtml(item.cartaoNome)}</em>` : ""}
            <strong>${formatar(item.valor || 0)}</strong>
        </div>
    `).join("") : `<div class="lembrete-vazio">Nenhuma despesa recente.</div>`;
}

function formatarDataCurtaEntrada(dataIso) {
    const data = parseIsoData(dataIso);
    if (!data) return "";
    const diaSemana = data.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "").toUpperCase();
    return `${diaSemana}, ${String(data.getDate()).padStart(2, "0")}`;
}

function calcularAlturaNaturalLembretesHome() {
    const card = document.getElementById("moduloLembretesHome");
    const body = card?.querySelector(":scope > .mesBody");
    const lista = document.getElementById("listaLembretesHome");
    const botao = document.getElementById("btnIrCalendario");
    const header = card?.querySelector(":scope > .despHeader");
    if (!card || !body || !lista) return 0;

    const estiloBody = getComputedStyle(body);
    const paddingVertical = (parseFloat(estiloBody.paddingTop) || 0) + (parseFloat(estiloBody.paddingBottom) || 0);
    const gap = parseFloat(estiloBody.rowGap || estiloBody.gap) || 0;
    const alturaHeader = header?.getBoundingClientRect().height || 0;
    const alturaLista = lista.scrollHeight || lista.getBoundingClientRect().height || 0;
    const alturaBotao = botao?.getBoundingClientRect().height || 0;
    return Math.ceil(alturaHeader + paddingVertical + alturaLista + alturaBotao + gap);
}

function resetarAlturaCardsHome() {
    ["moduloLembretesHome", "moduloDespesaRapida"].forEach(id => {
        const card = document.getElementById(id);
        if (card) card.style.height = "auto";
    });
}

function aplicarAlturaCardsHome() {
    resetarAlturaCardsHome();
    const altura = calcularAlturaNaturalLembretesHome();
    if (!altura) return 0;
    ["moduloLembretesHome", "moduloDespesaRapida"].forEach(id => {
        const card = document.getElementById(id);
        if (card) card.style.height = `${altura}px`;
    });
    return altura;
}

function recalcularHomeAposLembretes() {
    if (window.location.hash !== "#resumo" && window.location.hash) return;
    requestAnimationFrame(() => {
        aplicarAlturaCardsHome();
        requestAnimationFrame(renderBalancoRapido);
    });
}

function medirAlturaNaturalCard(card) {
    if (!card) return 0;
    const header = card.querySelector(":scope > .despHeader");
    const body = card.querySelector(":scope > .mesBody");
    const alturaHeader = header?.getBoundingClientRect().height || 0;
    if (!body) return Math.ceil(alturaHeader || card.offsetHeight || 0);

    const estiloBody = getComputedStyle(body);
    const paddingVertical = (parseFloat(estiloBody.paddingTop) || 0) + (parseFloat(estiloBody.paddingBottom) || 0);
    const gap = parseFloat(estiloBody.rowGap || estiloBody.gap) || 0;
    const filhos = Array.from(body.children).filter(child => getComputedStyle(child).display !== "none");
    const alturaFilhos = filhos.reduce((total, child) => {
        const estiloFilho = getComputedStyle(child);
        const margemVertical = (parseFloat(estiloFilho.marginTop) || 0) + (parseFloat(estiloFilho.marginBottom) || 0);
        return total + child.getBoundingClientRect().height + margemVertical;
    }, 0);

    return Math.ceil(alturaHeader + paddingVertical + alturaFilhos + Math.max(0, filhos.length - 1) * gap);
}

function preencherUltimasEntradasRapidas(ultimasEl, itensOrdenados) {
    if (!ultimasEl) return;

    if (document.querySelector(".home-figma-shell")) {
        ultimasEl.innerHTML = montarHtmlUltimasEntradasRapidas(itensOrdenados);
        return;
    }

    const maximoInicial = Math.min(itensOrdenados.length, 12);
    ultimasEl.innerHTML = "";
    const alturaAplicada = aplicarAlturaCardsHome();

    if (maximoInicial === 0) {
        ultimasEl.innerHTML = montarHtmlUltimasEntradasRapidas([]);
        return;
    }

    const cardLembretes = document.getElementById("moduloLembretesHome");
    const cardBalanco = document.getElementById("moduloDespesaRapida");
    const alturaAlvo = alturaAplicada || calcularAlturaNaturalLembretesHome() || medirAlturaNaturalCard(cardLembretes) || cardLembretes?.offsetHeight || 0;
    let limite = alturaAlvo ? maximoInicial : Math.min(maximoInicial, 3);

    const renderizar = () => {
        ultimasEl.innerHTML = limite === 0 ? "" : montarHtmlUltimasEntradasRapidas(itensOrdenados.slice(0, limite));
    };

    renderizar();
    if (!alturaAlvo || !cardBalanco) return;

    while (limite > 0 && medirAlturaNaturalCard(cardBalanco) > alturaAlvo + 4) {
        limite -= 1;
        renderizar();
    }

    while (limite < maximoInicial) {
        const anterior = limite;
        limite += 1;
        renderizar();
        if (medirAlturaNaturalCard(cardBalanco) > alturaAlvo + 4) {
            limite = anterior;
            renderizar();
            break;
        }
    }
}

function renderBalancoRapido() {
    const ctx = document.getElementById("graficoBalancoRapido");

    const { mesAt, anoAt } = document.querySelector(".home-figma-shell") ? getMesHomeAtivo() : getMesReferenciaAtivo();
    const pontos = [-3, -2, -1, 0].map(offset => {
        const data = new Date(anoAt, mesAt + offset, 1);
        const ano = data.getFullYear();
        const mes = data.getMonth();
        return { label: nomesMesesCurto[mes], saldo: Number(dados?.[ano]?.meses?.[mes]?.saldoCalculadoFinal || 0) };
    });

    const graficoVisivel = ctx && getComputedStyle(ctx).display !== "none";
    if (chartBalancoRapido) {
        chartBalancoRapido.destroy();
        chartBalancoRapido = null;
    }
    if (graficoVisivel) {
        chartBalancoRapido = new ApexCharts(ctx, {
            series: [{ name: "Saldo", data: pontos.map(p => Number(p.saldo.toFixed(2))) }],
            chart: { type: "bar", height: 170, toolbar: { show: false }, background: "transparent", foreColor: "#fff" },
            colors: [getComputedStyle(document.body).getPropertyValue("--P04").trim() || "#D78341"],
            xaxis: { categories: pontos.map(p => p.label) },
            yaxis: { labels: { formatter: val => "R$ " + Number(val).toLocaleString("pt-BR") } },
            dataLabels: { enabled: false },
            grid: { borderColor: "rgba(255,255,255,0.1)" },
            tooltip: { theme: "dark", y: { formatter: val => "R$ " + Number(val).toLocaleString("pt-BR") } }
        });
        chartBalancoRapido.render();
    }

    const mesAtual = dados?.[anoAt]?.meses?.[mesAt];
    const saldoEl = document.getElementById("saldoAtualRapido");
    const cartoesEl = document.getElementById("totalCartoesRapido");
    if (saldoEl) saldoEl.textContent = formatar(mesAtual?.saldoCalculadoFinal || 0);
    if (cartoesEl) cartoesEl.textContent = formatar(obterTotalCartoesMes(anoAt, mesAt));

    const ultimas = [];
    Object.values(gastosDetalhes).forEach(lista => {
        (lista || []).forEach(g => {
            if (g.parcelaId || !g.cartaoId) return;
            const dataOrdenacao = parseIsoData(g.data)?.getTime() || 0;
            const cartao = cartoes.find(c => String(c.id) === String(g.cartaoId));
            const categoriaCor = categorias.find(c => c.name === g.categoria)?.color || "var(--P04)";
            ultimas.push({ nome: g.nome, valor: g.valor, dataLabel: formatarDataCurtaEntrada(g.data), cartaoNome: cartao?.nome || "", cartaoCor: cartao?.color || "var(--P04)", categoriaCor, quando: dataOrdenacao + ((Number(g.criadoEm) || 0) / 10000000000000) });
        });
    });
    const ultimasEl = document.getElementById("ultimasEntradasRapidas");
    if (ultimasEl) {
        const itens = ultimas.sort((a, b) => Number(b.quando) - Number(a.quando));
        requestAnimationFrame(() => preencherUltimasEntradasRapidas(ultimasEl, itens));
    }
}

function popularControlesDespesaRapida() {
    const selCategoria = document.getElementById("quickDespCategoria");
    const selCartao = document.getElementById("quickDespCartao");
    const destino = document.getElementById("quickDespDestino");
    const boxParcelamento = document.getElementById("quickDespParcelamento");
    const selParcelar = document.getElementById("quickDespParcelar");
    const qtdParcelas = document.getElementById("quickDespQtdParcelas");
    const categoriaAtual = selCategoria?.value || "";
    const cartaoAtual = selCartao?.value || "";
    if (selCategoria) popularSelectCategorias(selCategoria, categoriaAtual);
    if (selCartao) {
        selCartao.innerHTML = cartoes.map(c => `<option value="${c.id}" ${String(cartaoAtual) === String(c.id) ? "selected" : ""}>${c.nome}</option>`).join("");
    }
    const usandoCartao = destino?.value === "cartao";
    const parcelando = selParcelar?.type === "checkbox" ? selParcelar.checked : selParcelar?.value === "sim";
    if (destino && selCartao) selCartao.style.display = usandoCartao ? "block" : "none";
    if (boxParcelamento) boxParcelamento.style.display = usandoCartao ? "grid" : "none";
    if (qtdParcelas && selParcelar) qtdParcelas.style.display = usandoCartao && parcelando ? "block" : "none";
    if (selParcelar) selParcelar.onchange = popularControlesDespesaRapida;
}

function garantirMesHome(ano, mes) {
    if (!dados[ano]) dados[ano] = { meses: [] };
    while (dados[ano].meses.length <= mes) dados[ano].meses.push(criarMesFinanceiro());
    const m = dados[ano].meses[mes];
    if (!m.fixasDesativadas) m.fixasDesativadas = {};
    if (!m.receitasDesativadas) m.receitasDesativadas = {};
    if (!m.cartoesPagos) m.cartoesPagos = {};
    if (!m.fixasEditadas) m.fixasEditadas = {};
    if (!m.empresa) m.empresa = [];
    if (!m.despesas) m.despesas = [];
    return m;
}

function criarLinhaHomeFinanceira({ checked = false, nome = "", valor = 0, cor = "var(--P04)", meta = "", editable = false, danger = false }) {
    const row = document.createElement("div");
    row.className = `home-finance-row ${checked ? "is-checked" : ""} ${danger ? "is-danger" : ""}`;
    row.style.setProperty("--row-color", cor || "var(--P04)");
    row.innerHTML = `
        <div class="home-row-main">
            <input type="checkbox" class="home-row-check" ${checked ? "checked" : ""}>
            ${editable ? `<input type="text" class="home-row-name inputPadrao" value="${escapeHtml(nome)}" placeholder="Nome">` : `<span class="home-row-name">${escapeHtml(nome)}</span>`}
            ${meta ? `<span class="home-row-meta">${meta}</span>` : ""}
        </div>
        <div class="home-row-side">
            ${editable ? `<input type="text" class="home-row-value inputPadrao" value="${formatar(valor)}">` : `<span class="home-row-value">${formatar(valor)}</span>`}
            ${danger ? `<button class="removeItem home-row-delete" type="button">${materialIcon("close")}</button>` : ""}
        </div>
    `;
    return row;
}

function renderHomeFinanceCards() {
    if (!document.querySelector(".home-figma-shell")) return;
    const { anoAt, mesAt } = getMesHomeAtivo();
    const mData = garantirMesHome(anoAt, mesAt);
    const listaFixas = mData.fixasSnapshot ? mData.fixasSnapshot : contasFixas;
    const listaReceitas = mData.receitasSnapshot ? mData.receitasSnapshot : receitasFixas;

    const fixasEl = document.getElementById("homeDespesasFixasLista");
    const variaveisEl = document.getElementById("homeDespesasVariaveisLista");
    const cartoesEl = document.getElementById("homeCartoesLista");
    const entradasEl = document.getElementById("homeEntradasLista");
    [fixasEl, variaveisEl, cartoesEl, entradasEl].forEach(el => { if (el) el.innerHTML = ""; });

    const obterValorFixo = (f) => (mData.fixasEditadas?.[f.id] !== undefined) ? mData.fixasEditadas[f.id] : f.valor;
    const fixasDinheiro = listaFixas.filter(f => f.ativo && !f.cartaoId);
    fixasDinheiro.forEach(f => {
        const pago = mData.fixasDesativadas?.[f.id] !== true;
        const row = criarLinhaHomeFinanceira({ checked: pago, nome: f.nome, valor: obterValorFixo(f), cor: categorias.find(c => c.name === f.categoria)?.color || "var(--P04)" });
        row.classList.add("is-fixed-home");
        row.querySelector(".home-row-check").onchange = async (e) => {
            mData.fixasDesativadas[f.id] = !e.target.checked;
            controleAvisoPendente(true);
            atualizarTudo(anoAt);
            await salvarFirebase();
        };
        fixasEl?.appendChild(row);
    });
    if (fixasEl && fixasEl.children.length === 0) fixasEl.innerHTML = `<div class="home-empty-row">Sem despesas fixas neste m\u00eas.</div>`;

    [...mData.despesas].sort(compararDespesasPorData).forEach(d => {
        const row = criarLinhaHomeFinanceira({ checked: !!d.checked, nome: d.nome, valor: d.valor, cor: categorias.find(c => c.name === d.categoria)?.color || "var(--P04)", danger: true });
        row.querySelector(".home-row-check").onchange = async (e) => {
            d.checked = e.target.checked;
            controleAvisoPendente(true);
            atualizarTudo(anoAt);
            await salvarFirebase();
        };
        row.querySelector(".home-row-delete").onclick = async () => {
            if (!confirm("Excluir esta despesa?")) return;
            mData.despesas = mData.despesas.filter(item => item !== d);
            atualizarTudo(anoAt);
            await salvarFirebase();
        };
        habilitarEdicaoTextoInline(row.querySelector(".home-row-name"), () => d.nome, async (valor) => {
            d.nome = valor;
            controleAvisoPendente(true);
            atualizarTudo(anoAt);
            await salvarFirebase();
        });
        habilitarEdicaoValorInline(row.querySelector(".home-row-value"), () => d.valor, async (valor) => {
            d.valor = valor;
            controleAvisoPendente(true);
            atualizarTudo(anoAt);
            await salvarFirebase();
        });
        variaveisEl?.appendChild(row);
    });
    if (variaveisEl && variaveisEl.children.length === 0) variaveisEl.innerHTML = `<div class="home-empty-row">Sem gastos pontuais neste m\u00eas.</div>`;

    const totaisPorCartao = {};
    (gastosDetalhes[anoAt] || []).filter(g => g.mes === mesAt && gastoCartaoContaNoTotal(g)).forEach(g => {
        totaisPorCartao[g.cartaoId] = (totaisPorCartao[g.cartaoId] || 0) + (Number(g.valor) || 0);
    });
    listaFixas.filter(f => f.ativo && f.cartaoId && mData.fixasDesativadas?.[f.id] !== true).forEach(f => {
        totaisPorCartao[f.cartaoId] = (totaisPorCartao[f.cartaoId] || 0) + obterValorFixo(f);
    });
    Object.keys(totaisPorCartao).forEach(cid => {
        const cartao = cartoes.find(c => String(c.id) === String(cid));
        if (!cartao) return;
        const pago = mData.cartoesPagos?.[cid] === true;
        const row = criarLinhaHomeFinanceira({ checked: pago, nome: cartao.nome, valor: totaisPorCartao[cid], cor: cartao.color || "var(--P04)" });
        row.classList.add("is-card-row");
        row.onclick = (e) => {
            if (e.target.closest("input,button")) return;
            document.getElementById("anoGastos").value = String(anoAt);
            mesesGastosAbertos.clear();
            mesesGastosAbertos.add(mesAt);
            filtrosPorMes[mesAt] = cid;
            filtrosGastosDetalhados.cartao = String(cid);
            window.location.hash = "#gastos";
        };
        row.querySelector(".home-row-check").onchange = async (e) => {
            mData.cartoesPagos[cid] = e.target.checked;
            controleAvisoPendente(true);
            atualizarTudo(anoAt);
            await salvarFirebase();
            renderLembretesHome();
            rerenderCalendarioNoShell();
        };
        cartoesEl?.appendChild(row);
    });
    if (cartoesEl && cartoesEl.children.length === 0) cartoesEl.innerHTML = `<div class="home-empty-row">Sem cart\u00f5es neste m\u00eas.</div>`;

    const salarioAtual = (mData.salarioSnapshot !== undefined) ? mData.salarioSnapshot : (mData.salario || 0);
    const salarioInput = document.getElementById("homeSalarioInput");
    const contaInput = document.getElementById("homeContaInput");
    if (salarioInput && document.activeElement !== salarioInput) salarioInput.value = formatar(salarioAtual);
    if (contaInput && document.activeElement !== contaInput) contaInput.value = formatar(mData.conta || 0);
    if (salarioInput && !salarioInput.dataset.homeBound) {
        salarioInput.dataset.homeBound = "1";
        aplicarComportamentoInput(salarioInput, () => (mData.salarioSnapshot !== undefined ? mData.salarioSnapshot : mData.salario), (v) => {
            const alvo = garantirMesHome(getMesHomeAtivo().anoAt, getMesHomeAtivo().mesAt);
            if (alvo.salarioSnapshot !== undefined) alvo.salarioSnapshot = v; else alvo.salario = v;
            controleAvisoPendente(true);
            atualizarTudo(getMesHomeAtivo().anoAt);
        }, anoAt);
    }
    if (contaInput && !contaInput.dataset.homeBound) {
        contaInput.dataset.homeBound = "1";
        aplicarComportamentoInput(contaInput, () => garantirMesHome(getMesHomeAtivo().anoAt, getMesHomeAtivo().mesAt).conta, (v) => {
            const alvo = garantirMesHome(getMesHomeAtivo().anoAt, getMesHomeAtivo().mesAt);
            alvo.conta = v;
            alvo.contaManual = true;
            controleAvisoPendente(true);
            atualizarTudo(getMesHomeAtivo().anoAt);
        }, anoAt);
    }
    const cascataInput = document.getElementById("homeCascataConta");
    if (cascataInput) {
        cascataInput.checked = mData.contaManual !== true;
        if (!cascataInput.dataset.homeBound) {
            cascataInput.dataset.homeBound = "1";
            cascataInput.onchange = async (event) => {
                const { anoAt: anoAtualHome, mesAt: mesAtualHome } = getMesHomeAtivo();
                const anos = Object.keys(dados).map(Number).sort((a, b) => a - b);
                let encontrou = false;
                anos.forEach(anoItem => {
                    (dados[anoItem]?.meses || []).forEach((m, idx) => {
                        if (Number(anoItem) === Number(anoAtualHome) && idx === mesAtualHome) encontrou = true;
                        if (encontrou) m.contaManual = !event.target.checked;
                    });
                });
                controleAvisoPendente(true);
                atualizarTudo(anoAtualHome);
                renderHomeFinanceCards();
                await salvarFirebase();
            };
        }
    }

    listaReceitas.filter(r => r.ativo).forEach(rf => {
        const desativada = mData.receitasDesativadas?.[rf.id] === true;
        const row = criarLinhaHomeFinanceira({ checked: !desativada, nome: rf.nome, valor: rf.valor, cor: "#cfb01f", meta: `<span class="home-date-chip">${String(rf.dia || 1).padStart(2, "0")}/${String(mesAt + 1).padStart(2, "0")}</span>` });
        row.classList.add("is-fixed-home");
        row.querySelector(".home-row-check").onchange = async (e) => {
            mData.receitasDesativadas[rf.id] = !e.target.checked;
            controleAvisoPendente(true);
            atualizarTudo(anoAt);
            await salvarFirebase();
        };
        entradasEl?.appendChild(row);
    });
    (mData.empresa || []).forEach(item => {
        const row = criarLinhaHomeFinanceira({ checked: !!item.checked, nome: item.nome || "", valor: item.valor || 0, cor: "var(--P04)", danger: true });
        row.querySelector(".home-row-check").onchange = async (e) => {
            item.checked = e.target.checked;
            controleAvisoPendente(true);
            atualizarTudo(anoAt);
            await salvarFirebase();
        };
        habilitarEdicaoTextoInline(row.querySelector(".home-row-name"), () => item.nome, async (valor) => {
            item.nome = valor;
            controleAvisoPendente(true);
            atualizarTudo(anoAt);
            await salvarFirebase();
        });
        habilitarEdicaoValorInline(row.querySelector(".home-row-value"), () => item.valor || 0, async (valor) => {
            item.valor = valor;
            controleAvisoPendente(true);
            atualizarTudo(anoAt);
            await salvarFirebase();
        });
        row.querySelector(".home-row-delete").onclick = async () => {
            if (!confirm("Excluir esta entrada?")) return;
            mData.empresa = mData.empresa.filter(e => e !== item);
            atualizarTudo(anoAt);
            await salvarFirebase();
        };
        entradasEl?.appendChild(row);
    });
    if (entradasEl && entradasEl.children.length === 0) entradasEl.innerHTML = `<div class="home-empty-row">Sem entradas extras neste m\u00eas.</div>`;

    const totalDespesas = [...fixasDinheiro.filter(f => mData.fixasDesativadas?.[f.id] !== true).map(obterValorFixo), ...mData.despesas.filter(d => d.checked).map(d => d.valor)]
        .reduce((acc, v) => acc + (Number(v) || 0), 0) + Object.keys(totaisPorCartao).reduce((acc, cid) => acc + (mData.cartoesPagos?.[cid] ? totaisPorCartao[cid] : 0), 0);
    const totalReceitas = salarioAtual + (mData.conta || 0)
        + listaReceitas.filter(r => r.ativo && mData.receitasDesativadas?.[r.id] !== true).reduce((acc, r) => acc + (Number(r.valor) || 0), 0)
        + (mData.empresa || []).filter(e => e.checked).reduce((acc, e) => acc + (Number(e.valor) || 0), 0);
    const homeTotalPago = document.getElementById("homeTotalPago");
    const homeTotalEntradas = document.getElementById("homeTotalEntradas");
    const homeMesAtualLabel = document.getElementById("homeMesAtualLabel");
    const homeMesAnterior = document.getElementById("homeMesAnterior");
    const homeMesProximo = document.getElementById("homeMesProximo");
    if (homeTotalPago) homeTotalPago.textContent = formatar(totalDespesas);
    if (homeTotalEntradas) homeTotalEntradas.textContent = formatar(totalReceitas);
    if (homeMesAtualLabel) homeMesAtualLabel.textContent = `${nomesMesesFull[mesAt]} ${anoAt}`;
    if (homeMesAnterior) homeMesAnterior.textContent = `< ${formatarMesNavHome(-1)}`;
    if (homeMesProximo) homeMesProximo.textContent = `${formatarMesNavHome(1)} >`;

    const btnAddEntrada = document.getElementById("btnAddEntradaHome");
    if (btnAddEntrada && !btnAddEntrada.dataset.homeBound) {
        btnAddEntrada.dataset.homeBound = "1";
        btnAddEntrada.onclick = () => {
            const { anoAt: anoAtualHome, mesAt: mesAtualHome } = getMesHomeAtivo();
            garantirMesHome(anoAtualHome, mesAtualHome).empresa.push({ nome: "Nova entrada", valor: 0, checked: true });
            renderHomeFinanceCards();
        };
    }
}

function abrirModalExibicao(escopo, modo = "editar") {
    normalizarDadosApp();
    const editandoCalendario = escopo === "calendario";
    const viewAtiva = editandoCalendario ? getViewCalendarioAtiva() : null;
    const nomePadraoView = editandoCalendario && modo === "criar" ? `Exibi\u00e7\u00e3o ${configuracoes.viewsCalendario.length + 1}` : normalizarNomeExibicao(viewAtiva?.nome || "");
    const iconePadraoView = normalizarIconeMaterial(editandoCalendario && modo === "criar" ? "description" : viewAtiva?.icone || "description");
    const chave = escopo === "home" ? "exibicaoHome" : "viewsCalendario";
    const titulo = escopo === "home" ? "Exibi\u00e7\u00e3o da home" : (modo === "criar" ? "Nova exibi\u00e7\u00e3o do calend\u00e1rio" : "Editar exibi\u00e7\u00e3o do calend\u00e1rio");
    const cfg = editandoCalendario
        ? normalizarConfigExibicao(modo === "criar" ? criarViewCalendarioPadrao().filtros : viewAtiva?.filtros)
        : normalizarConfigExibicao(configuracoes.exibicaoHome);
    const horaViradaAtual = normalizarHoraViradaCalendario(configuracoes.horaViradaCalendario);
    const inicioSemanaAtual = normalizarInicioSemanaCalendario(configuracoes.inicioSemanaCalendario);
    const antigo = document.getElementById("modalExibicaoEventos");
    if (antigo) antigo.remove();

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.id = "modalExibicaoEventos";
    const tipos = [
        ["feriados", "Feriados"],
        ["salario", "Salario"],
        ["receitas", "Rendas fixas"],
        ["cartoes", "Cartoes"],
        ["fixas", "Fixas"],
        ["variaveis", "Variaveis"],
        ["lembretes", "Lembretes"]
    ];
    const periodoHome = normalizarPeriodoHome(cfg.periodo);
    overlay.innerHTML = `
        <div class="modal-content" style="max-width:520px;">
            <h3>${titulo}</h3>
            ${editandoCalendario ? `
                <div class="config-view-identity">
                    <div class="campo">
                        <label>Nome da exibi\u00e7\u00e3o</label>
                        <input type="text" id="nomeViewCalendario" class="inputPadrao" value="${escapeHtml(nomePadraoView)}" placeholder="Nome da exibi\u00e7\u00e3o">
                    </div>
                    <div class="campo">
                        <label>\u00cdcone</label>
                        <div class="material-icon-picker">
                            <span class="material-icons" id="previewIconeViewCalendario">${iconePadraoView}</span>
                            <input type="search" id="iconeViewCalendario" class="inputPadrao" value="${iconePadraoView}" list="listaIconesViewCalendario" placeholder="Buscar \u00edcone Material">
                        </div>
                        <datalist id="listaIconesViewCalendario">
                            ${iconesExibicaoCalendario.map(icone => `<option value="${icone}">${icone}</option>`).join("")}
                        </datalist>
                        <small class="material-icon-hint">Use o nome do \u00edcone do Google Material Icons Filled.</small>
                    </div>
                </div>
            ` : ""}
            ${!editandoCalendario ? `
                <div class="campo config-periodo-home">
                    <label>Periodo dos lembretes</label>
                    <select id="periodoHomeTipo" class="inputPadrao">
                        <option value="semana" ${periodoHome.tipo === "semana" ? "selected" : ""}>Esta semana</option>
                        <option value="hoje" ${periodoHome.tipo === "hoje" ? "selected" : ""}>Hoje</option>
                        <option value="proximos7" ${periodoHome.tipo === "proximos7" ? "selected" : ""}>Proximos 7 dias</option>
                        <option value="mes" ${periodoHome.tipo === "mes" ? "selected" : ""}>Este mes</option>
                        <option value="personalizado" ${periodoHome.tipo === "personalizado" ? "selected" : ""}>Personalizado</option>
                    </select>
                    <div class="quick-expense-row periodo-home-custom" id="periodoHomeCustom">
                        <input type="date" id="periodoHomeInicio" class="inputPadrao" value="${periodoHome.inicio || ""}">
                        <input type="date" id="periodoHomeFim" class="inputPadrao" value="${periodoHome.fim || ""}">
                    </div>
                </div>
            ` : ""}
            ${editandoCalendario ? `
                <div class="config-view-identity">
                    <div class="campo">
                        <label>Hora que vira o dia</label>
                        <select id="horaViradaCalendario" class="inputPadrao">
                            ${Array.from({ length: 24 }, (_, hora) => `<option value="${hora}" ${horaViradaAtual === hora ? "selected" : ""}>${String(hora).padStart(2, "0")}:00</option>`).join("")}
                        </select>
                    </div>
                    <div class="campo">
                        <label>Inicio da semana</label>
                        <select id="inicioSemanaCalendario" class="inputPadrao">
                            ${diasSemanaConfig.map(([valor, label]) => `<option value="${valor}" ${String(inicioSemanaAtual) === valor ? "selected" : ""}>${label}</option>`).join("")}
                        </select>
                    </div>
                </div>
            ` : ""}
            <div class="config-exibicao-grid">
                ${tipos.map(([id, label]) => `
                    <label><input type="checkbox" data-tipo="${id}" ${cfg.tipos[id] !== false ? "checked" : ""}> ${label}</label>
                `).join("")}
            </div>
            <h4>Categorias de lembrete</h4>
            <div class="config-exibicao-grid" id="listaCategoriasLembreteConfig">
                ${categoriasLembretes.map(cat => `
                    <label class="cat-lembrete-config-row">
                        <input type="checkbox" data-cat-lembrete="${cat.id}" ${cfg.categoriasLembretes.length === 0 || cfg.categoriasLembretes.includes(String(cat.id)) ? "checked" : ""}>
                        <span class="cat-lembrete-config-nome" data-cat-label="${cat.id}">${cat.nome}</span>
                        <button type="button" class="btn-mini-gerenciar btn-edit-cat-lembrete" data-edit-cat-lembrete="${cat.id}" title="Editar categoria">${materialIcon("settings")}</button>
                    </label>
                `).join("")}
            </div>
            <div class="quick-expense-row">
                <input type="text" id="novaCategoriaLembreteNome" class="inputPadrao" placeholder="Nova categoria">
                <input type="color" id="novaCategoriaLembreteCor" class="inputPadrao" value="#D78341">
            </div>
            <button class="btn" id="btnAddCategoriaLembrete" style="margin-top:8px;">Adicionar categoria</button>
            <h4>Categorias financeiras</h4>
            <div class="config-exibicao-grid">
                ${categorias.map(cat => `
                    <label><input type="checkbox" data-cat-fin="${cat.name}" ${cfg.categoriasFinanceiras.length === 0 || cfg.categoriasFinanceiras.includes(cat.name) ? "checked" : ""}> ${cat.name}</label>
                `).join("")}
            </div>
            <div style="display:flex; gap:10px; margin-top:20px;">
                <button class="btn" id="btnSalvarExibicaoEventos" style="flex:1">Salvar</button>
                <button class="btn sair" id="btnFecharExibicaoEventos" style="flex:1">Fechar</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    overlay.style.display = "flex";
    overlay.querySelector("#btnFecharExibicaoEventos").onclick = () => overlay.remove();
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    const periodoTipoEl = overlay.querySelector("#periodoHomeTipo");
    const periodoCustomEl = overlay.querySelector("#periodoHomeCustom");
    const atualizarPeriodoCustom = () => {
        if (periodoCustomEl && periodoTipoEl) periodoCustomEl.style.display = periodoTipoEl.value === "personalizado" ? "flex" : "none";
    };
    if (periodoTipoEl) {
        periodoTipoEl.onchange = atualizarPeriodoCustom;
        atualizarPeriodoCustom();
    }
    const inputIconeView = overlay.querySelector("#iconeViewCalendario");
    const previewIconeView = overlay.querySelector("#previewIconeViewCalendario");
    if (inputIconeView && previewIconeView) {
        inputIconeView.oninput = () => {
            previewIconeView.textContent = normalizarIconeMaterial(inputIconeView.value);
        };
    }

    function abrirEditorCategoriaLembrete(catId, root) {
        const cat = categoriasLembretes.find(item => String(item.id) === String(catId));
        if (!cat) return;
        const antigo = document.getElementById("modalEditarCategoriaLembrete");
        if (antigo) antigo.remove();

        const modal = document.createElement("div");
        modal.className = "modal-overlay modal-overlay-secundario";
        modal.id = "modalEditarCategoriaLembrete";
        modal.innerHTML = `
            <div class="modal-content modal-categoria-lembrete" style="max-width:420px;">
                <h3>Editar categoria</h3>
                <div class="campo">
                    <label>Nome</label>
                    <input type="text" id="editCatLembreteNome" class="inputPadrao" value="${cat.nome}">
                </div>
                <div class="campo" style="margin-top:12px;">
                    <label>Cor</label>
                    <input type="color" id="editCatLembreteCor" class="inputPadrao" value="${cat.cor || "#D78341"}">
                </div>
                <div style="display:flex; gap:10px; margin-top:20px;">
                    <button class="btn" id="btnSalvarCatLembrete" style="flex:1">Salvar</button>
                    <button class="btn sair" id="btnFecharCatLembrete" style="flex:1">Fechar</button>
                </div>
                <button class="btn btn-sem-cor-cat-lembrete" id="btnExcluirCatLembrete">Excluir</button>
            </div>
        `;
        document.body.appendChild(modal);
        modal.style.display = "flex";
        modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
        modal.querySelector("#btnFecharCatLembrete").onclick = () => modal.remove();
        modal.querySelector("#btnSalvarCatLembrete").onclick = async () => {
            const nome = modal.querySelector("#editCatLembreteNome").value.trim();
            const cor = modal.querySelector("#editCatLembreteCor").value || cat.cor || "#D78341";
            cat.nome = nome || cat.nome;
            cat.cor = cor;

            const label = root.querySelector(`[data-cat-label="${cat.id}"]`);
            if (label) label.textContent = cat.nome;
            popularCategoriasLembreteSelect();
            renderLembretesHome();
            if (window.location.hash === "#calendario") {
                rerenderCalendarioNoShell();
            }
            await salvarFirebase();
            modal.remove();
        };
        modal.querySelector("#btnExcluirCatLembrete").onclick = async () => {
            if (categoriasLembretes.length <= 1) {
                alert("Mantenha pelo menos uma categoria de lembrete.");
                return;
            }
            if (!confirm(`Excluir a categoria "${cat.nome}"? Os lembretes dela serao movidos para a primeira categoria.`)) return;
            const fallback = categoriasLembretes.find(item => String(item.id) !== String(cat.id)) || categoriasLembretes[0];
            categoriasLembretes = categoriasLembretes.filter(item => String(item.id) !== String(cat.id));
            lembretes.forEach(lembrete => {
                if (String(lembrete.categoriaId) === String(cat.id)) lembrete.categoriaId = fallback.id;
            });
            root.querySelector(`[data-cat-label="${cat.id}"]`)?.closest(".cat-lembrete-config-row")?.remove();
            popularCategoriasLembreteSelect();
            renderLembretesHome();
            if (window.location.hash === "#calendario") {
                rerenderCalendarioNoShell();
            }
            await salvarFirebase();
            modal.remove();
        };
    }

    overlay.querySelector("#btnAddCategoriaLembrete").onclick = () => {
        const nome = overlay.querySelector("#novaCategoriaLembreteNome").value.trim();
        const cor = overlay.querySelector("#novaCategoriaLembreteCor").value || "#D78341";
        if (!nome) return;
        const nova = { id: `lem-${Date.now()}`, nome, cor };
        categoriasLembretes.push(nova);
        const lista = overlay.querySelector("#listaCategoriasLembreteConfig");
        lista.insertAdjacentHTML("beforeend", `
            <label class="cat-lembrete-config-row">
                <input type="checkbox" data-cat-lembrete="${nova.id}" checked>
                <span class="cat-lembrete-config-nome" data-cat-label="${nova.id}">${nova.nome}</span>
                <button type="button" class="btn-mini-gerenciar btn-edit-cat-lembrete" data-edit-cat-lembrete="${nova.id}" title="Editar categoria">${materialIcon("settings")}</button>
            </label>
        `);
        overlay.querySelector("#novaCategoriaLembreteNome").value = "";
        popularCategoriasLembreteSelect();
        conectarEdicaoCategoriasLembrete(overlay);
    };
    const conectarEdicaoCategoriasLembrete = (root) => {
        root.querySelectorAll(".btn-edit-cat-lembrete").forEach(btn => {
            btn.onclick = () => {
                abrirEditorCategoriaLembrete(btn.dataset.editCatLembrete, root);
            };
        });
    };
    conectarEdicaoCategoriasLembrete(overlay);
    overlay.querySelector("#btnSalvarExibicaoEventos").onclick = async () => {
        const tiposAtualizados = {};
        overlay.querySelectorAll("input[data-tipo]").forEach(input => tiposAtualizados[input.dataset.tipo] = input.checked);
        const catsLembretes = Array.from(overlay.querySelectorAll("input[data-cat-lembrete]:checked")).map(input => input.dataset.catLembrete);
        const catsFinanceiras = Array.from(overlay.querySelectorAll("input[data-cat-fin]:checked")).map(input => input.dataset.catFin);
        const filtros = {
            tipos: tiposAtualizados,
            categoriasLembretes: catsLembretes.length === categoriasLembretes.length ? [] : catsLembretes,
            categoriasFinanceiras: catsFinanceiras.length === categorias.length ? [] : catsFinanceiras
        };
        if (escopo === "home") {
            filtros.periodo = normalizarPeriodoHome({
                tipo: overlay.querySelector("#periodoHomeTipo")?.value || "semana",
                inicio: overlay.querySelector("#periodoHomeInicio")?.value || "",
                fim: overlay.querySelector("#periodoHomeFim")?.value || ""
            });
            configuracoes.exibicaoHome = filtros;
        } else {
            configuracoes.horaViradaCalendario = normalizarHoraViradaCalendario(overlay.querySelector("#horaViradaCalendario")?.value);
            configuracoes.inicioSemanaCalendario = normalizarInicioSemanaCalendario(overlay.querySelector("#inicioSemanaCalendario")?.value);
        }
        if (escopo !== "home" && modo === "criar") {
            const novaView = {
                id: `view-${Date.now()}`,
                nome: normalizarNomeExibicao(overlay.querySelector("#nomeViewCalendario")?.value.trim() || `Exibi\u00e7\u00e3o ${configuracoes.viewsCalendario.length + 1}`),
                icone: normalizarIconeMaterial(overlay.querySelector("#iconeViewCalendario")?.value || "description"),
                filtros
            };
            configuracoes.viewsCalendario.push(novaView);
            configuracoes.viewCalendarioAtiva = novaView.id;
        } else if (escopo !== "home") {
            const view = getViewCalendarioAtiva();
            view.nome = normalizarNomeExibicao(overlay.querySelector("#nomeViewCalendario")?.value.trim() || view.nome);
            view.icone = normalizarIconeMaterial(overlay.querySelector("#iconeViewCalendario")?.value || view.icone || "description");
            view.filtros = filtros;
        }
        await salvarFirebase();
        overlay.remove();
        if (escopo === "home") {
            renderLembretesHome();
        }
        else rerenderCalendarioNoShell();
    };
}

function abrirConfiguracoesCalendario() {
    abrirModalExibicao("calendario", "editar");
}

function criarViewCalendario() {
    abrirModalExibicao("calendario", "criar");
}

async function selecionarViewCalendario(id) {
    normalizarDadosApp();
    if (!configuracoes.viewsCalendario.some(view => String(view.id) === String(id))) return;
    configuracoes.viewCalendarioAtiva = String(id);
    await salvarFirebase();
    await rerenderCalendarioNoShell();
}

function editarViewCalendario(id) {
    normalizarDadosApp();
    if (id && configuracoes.viewsCalendario.some(view => String(view.id) === String(id))) {
        configuracoes.viewCalendarioAtiva = String(id);
    }
    abrirModalExibicao("calendario", "editar");
}

function abrirGastoCalendario(payload = {}) {
    const ano = Number(payload.ano || new Date().getFullYear());
    const mes = Number(payload.mes || 0);
    const anoSelect = document.getElementById("anoGastos");
    if (anoSelect) {
        if (![...anoSelect.options].some(opt => String(opt.value) === String(ano))) {
            anoSelect.insertAdjacentHTML("beforeend", `<option value="${ano}">${ano}</option>`);
        }
        anoSelect.value = String(ano);
    }
    setMesGastosAtivo(ano, mes);
    filtrosGastosDetalhados.tipo = payload.tipo || "todos";
    filtrosGastosDetalhados.cartao = payload.cartaoId ? String(payload.cartaoId) : (payload.tipo === "importado" ? "todos" : "agrupados");
    filtrosGastosDetalhados.status = "todos";
    window.location.hash = "#gastos";
}

async function atualizarFiltroCalendario(tipo, ativo) {
    normalizarDadosApp();
    const view = getViewCalendarioAtiva();
    view.filtros = normalizarConfigExibicao(view.filtros || {});
    view.filtros.tipos[tipo] = Boolean(ativo);
    await salvarFirebase();
    await rerenderCalendarioNoShell();
}

async function atualizarVisaoCalendario(visao) {
    normalizarDadosApp();
    configuracoes.visaoCalendario = normalizarVisaoCalendario(visao);
    await salvarFirebase();
    await rerenderCalendarioNoShell();
}

function getAcoesCalendario() {
    return { abrirPostit, abrirConfiguracoesCalendario, criarViewCalendario, selecionarViewCalendario, editarViewCalendario, atualizarFiltroCalendario, atualizarVisaoCalendario, abrirGastoCalendario, rerenderCalendario: rerenderCalendarioNoShell };
}

const btnConfigLembretesHome = document.getElementById("btnConfigLembretesHome");
if (btnConfigLembretesHome) btnConfigLembretesHome.onclick = () => abrirModalExibicao("home");

function getMesHomeAtivo() {
    const ref = getMesReferenciaAtivo();
    const data = new Date(ref.anoAt, ref.mesAt + homeMesOffset, 1);
    return { anoAt: data.getFullYear(), mesAt: data.getMonth() };
}

function formatarMesNavHome(offset) {
    const { anoAt, mesAt } = getMesHomeAtivo();
    const data = new Date(anoAt, mesAt + offset, 1);
    const label = nomesMesesFull[data.getMonth()].toUpperCase();
    return data.getFullYear() === anoAt ? label : `${label} ${data.getFullYear()}`;
}

function abrirModalModuloConfigHome(moduloId, titulo, renderizar) {
    const modulo = document.getElementById(moduloId);
    if (!modulo) return;
    if (typeof renderizar === "function") renderizar();

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    const placeholder = document.createComment(`placeholder-${moduloId}`);
    modulo.parentNode.insertBefore(placeholder, modulo);
    modulo.classList.remove("home-hidden-legacy", "collapsed");
    modulo.classList.add("modal-config-home-modulo");
    overlay.innerHTML = `
        <div class="modal-content modal-config-home">
            <div class="modal-config-home-header">
                <h3>${titulo}</h3>
                <button type="button" class="btn sair" id="fecharModalConfigHome">Fechar</button>
            </div>
            <div class="modal-config-home-body"></div>
        </div>
    `;
    overlay.querySelector(".modal-config-home-body").appendChild(modulo);
    document.body.appendChild(overlay);
    overlay.querySelector("#btnGerenciarCategorias")?.addEventListener("click", (event) => {
        event.stopPropagation();
        abrirGerenciadorCategorias();
    });
    overlay.querySelector("#btnGerenciarCartoes")?.addEventListener("click", (event) => {
        event.stopPropagation();
        abrirGerenciadorCartoes();
    });

    const fechar = () => {
        modulo.classList.remove("modal-config-home-modulo");
        modulo.classList.add("home-hidden-legacy", "collapsed");
        placeholder.parentNode.insertBefore(modulo, placeholder);
        placeholder.remove();
        overlay.remove();
        carregarAno();
        renderHomeFigmaResumo();
    };
    overlay.querySelector("#fecharModalConfigHome").onclick = fechar;
    overlay.onclick = (e) => { if (e.target === overlay) fechar(); };
}

function vincularAcoesContextuaisHome() {
    const btnConfigCartoes = document.getElementById("homeBtnConfigCartoes");
    if (btnConfigCartoes) {
        btnConfigCartoes.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            abrirGerenciadorCartoes();
        };
    }
    document.querySelectorAll(".btn-edit-fixas-home").forEach(btn => {
        btn.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            abrirModalModuloConfigHome("moduloContasFixas", "Configurar despesas fixas", renderContasFixas);
        };
    });
    document.querySelectorAll(".btn-edit-salario-home").forEach(btn => {
        btn.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            abrirModalModuloConfigHome("moduloReceitasFixas", "Configurar Salário e rendas", renderReceitasFixas);
        };
    });
}

function montarLayoutFigmaHome() {
    const view = document.getElementById("viewResumo");
    if (!view || view.querySelector(".home-figma-shell")) return;

    const dashboardAntigo = view.querySelector(".dashboard-resumo");
    const saudacao = document.getElementById("saudacaoDinamica");
    const lembretes = document.getElementById("moduloLembretesHome");
    const despesas = document.getElementById("moduloDespesaRapida");
    const balancoConteudo = document.getElementById("moduloBalancoRapido");
    if (!dashboardAntigo || !saudacao || !lembretes || !despesas || !balancoConteudo) return;

    const shell = document.createElement("div");
    shell.className = "app-shell home-figma-shell";
    shell.innerHTML = `
        <div class="app-topbar home-figma-topbar">
            <div id="homeSaudacaoMount"></div>
            <div class="app-user-actions home-user-actions">
                <span id="displayEmailHome"></span>
                <button id="btnSettingsHome" class="btn-icon-home" title="Configura\u00e7\u00f5es"><span class="material-icons">settings</span></button>
                <button id="salvarNuvemBtnHome" class="btn">SALVAR</button>
                <button id="logoutBtnHome" class="btn sair">SAIR</button>
            </div>
        </div>
        <div class="app-main home-figma-main">
            <aside class="app-sidebar home-sidebar">
                ${renderMenuLateral("#resumo")}
                <div id="homeLembretesMount" class="home-card"></div>
            </aside>
            <div class="app-content home-dashboard-area">
                <div class="app-month-nav home-month-nav">
                    <button class="btn" id="homeMesAnterior" type="button">&lt; MÊS ANTERIOR</button>
                    <div class="home-current-month"><span id="homeMesAtualLabel">M\u00eas atual</span></div>
                    <button class="btn" id="homeMesProximo" type="button">PR&Oacute;XIMO M&Ecirc;S &gt;</button>
                </div>
                <div class="home-dashboard-grid">
                    <div id="homeBalancoMount" class="home-card"></div>
                    <div id="homeDespesasMount" class="home-card"></div>
                    <div id="homeEntradasMount" class="home-card"></div>
                </div>
            </div>
        </div>
    `;

    view.insertBefore(shell, view.firstElementChild);
    shell.querySelector("#btnSettingsHome").title = "Configura\u00e7\u00f5es";
    shell.querySelector("#homeMesAnterior").textContent = "< MÊS ANTERIOR";
    shell.querySelector("#homeMesAtualLabel").textContent = "M\u00eas atual";
    shell.querySelector("#homeMesProximo").textContent = "PR\u00d3XIMO M\u00caS >";
    shell.querySelector("#homeSaudacaoMount").appendChild(saudacao);
    shell.querySelector("#homeLembretesMount").appendChild(lembretes);
    const balancoCard = document.createElement("div");
    balancoCard.id = "moduloBalancoRapidoCard";
    balancoCard.className = "mes figma-card";
    balancoCard.innerHTML = `
        <div class="despHeader">
            <span>Balan&ccedil;o R&aacute;pido</span>
        </div>
        <div class="mesBody balanco-rapido-body"></div>
    `;
    balancoCard.querySelector(".mesBody").appendChild(balancoConteudo);
    shell.querySelector("#homeBalancoMount").appendChild(balancoCard);
    shell.querySelector("#homeDespesasMount").appendChild(despesas);

    const balanco = balancoCard;
    [lembretes, balancoCard, despesas].forEach(card => card.classList.add("figma-card"));
    despesas.querySelector(".despHeader")?.style.removeProperty("background");
    balanco.querySelector(".despHeader span").textContent = "Balan\u00e7o R\u00e1pido";
    despesas.querySelector(".despHeader span").textContent = "Despesas";
    despesas.querySelector(".despHeader").insertAdjacentHTML("beforeend", `<button type="button" class="btn-icon-home btn-edit-fixas-home" title="Configurar despesas fixas"><span class="material-icons">settings</span></button>`);
    balancoCard.querySelector(".despHeader span").innerHTML = "Balan&ccedil;o R&aacute;pido";

    const quickBody = despesas.querySelector(".quick-expense-body");
    if (quickBody && !document.getElementById("homeDespesasFixasLista")) {
        const quickForm = document.createElement("section");
        quickForm.className = "quick-form-figma";
        const quickNome = document.getElementById("quickDespNome");
        const quickValor = document.getElementById("quickDespValor");
        const quickCategoria = document.getElementById("quickDespCategoria");
        const quickDestinoRow = document.getElementById("quickDespDestino")?.closest(".quick-expense-row");
        const quickParcelamento = document.getElementById("quickDespParcelamento");
        const quickParcelarSelect = document.getElementById("quickDespParcelar");
        if (quickParcelarSelect?.tagName === "SELECT") {
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.id = "quickDespParcelar";
            checkbox.checked = quickParcelarSelect.value === "sim";
            checkbox.className = "quick-parcelar-checkbox";
            quickParcelarSelect.replaceWith(checkbox);
        }
        [quickNome, quickValor, quickCategoria, quickDestinoRow, quickParcelamento].forEach(el => {
            if (el) quickForm.appendChild(el);
        });
        balancoCard.querySelector(".mesBody").appendChild(quickForm);

        const fixasSection = document.createElement("section");
        fixasSection.className = "home-mini-section";
        fixasSection.innerHTML = `<div class="home-mini-title"><span>Despesas Fixas</span><button type="button" class="btn-mini-gerenciar btn-edit-fixas-home" title="Editar despesas fixas"><span class="material-icons">settings</span></button></div><div id="homeDespesasFixasLista" class="home-finance-list"></div>`;
        const variaveisSection = document.createElement("section");
        variaveisSection.className = "home-mini-section";
        variaveisSection.innerHTML = `<div class="home-mini-title"><span>Gastos pontuais</span></div><div id="homeDespesasVariaveisLista" class="home-finance-list"></div>`;
        const cartoesSection = document.createElement("section");
        cartoesSection.className = "home-mini-section";
        cartoesSection.innerHTML = `<div class="home-mini-title"><span>Cart\u00f5es</span><button id="homeBtnConfigCartoes" type="button" class="btn-mini-gerenciar btn-edit-cartoes-home" title="Editar cart\u00f5es" aria-label="Editar cart\u00f5es"><span class="material-icons">settings</span></button></div><div id="homeCartoesLista" class="home-finance-list"></div>`;
        const btnSalvar = document.getElementById("btnSalvarDespesaRapida");
        if (btnSalvar) {
            btnSalvar.textContent = "+ DESPESA";
            btnSalvar.classList.add("home-action-btn");
            quickForm.appendChild(btnSalvar);
        }
        quickBody.prepend(variaveisSection);
        quickBody.prepend(fixasSection);
        quickBody.appendChild(cartoesSection);
        quickBody.insertAdjacentHTML("beforeend", `<div class="home-total-row"><strong>Total Pago:</strong><span id="homeTotalPago">R$ 0,00</span></div>`);
    }

    if (!document.getElementById("moduloEntradasHome")) {
        const entradas = document.createElement("div");
        entradas.id = "moduloEntradasHome";
        entradas.className = "mes figma-card";
        entradas.innerHTML = `
            <div class="despHeader"><span>Entradas</span><button type="button" class="btn-icon-home btn-edit-salario-home" title="Editar Salário e rendas"><span class="material-icons">settings</span></button></div>
            <div class="mesBody entradas-home-body">
                <div class="home-entrada-grid">
                    <div class="campo"><label>Salário</label><input type="text" id="homeSalarioInput" class="inputPadrao"></div>
                    <div class="campo">
                        <div class="home-conta-label">
                            <label for="homeContaInput">Conta</label>
                            <span class="home-cascata-control">
                                <span>Cascata</span>
                                <details class="home-cascata-help">
                                    <summary aria-label="Explicar cascata">?</summary>
                                    <span>Ao marcar, a Conta dos meses seguintes herda o saldo do m&ecirc;s de refer&ecirc;ncia em sequ&ecirc;ncia.</span>
                                </details>
                                <input type="checkbox" id="homeCascataConta" title="Ativar cascata da conta">
                            </span>
                        </div>
                        <input type="text" id="homeContaInput" class="inputPadrao">
                    </div>
                </div>
                <section class="home-mini-section"><div class="home-mini-title"><span>Rendas recorrentes / extras</span></div><div id="homeEntradasLista" class="home-finance-list"></div></section>
                <button class="btn home-action-btn" id="btnAddEntradaHome" type="button">+ ADICIONAR ENTRADA</button>
                <div class="home-total-row"><strong>Total:</strong><span id="homeTotalEntradas">R$ 0,00</span></div>
            </div>
        `;
        shell.querySelector("#homeEntradasMount").appendChild(entradas);
    }

    dashboardAntigo.style.display = "none";
    view.querySelector(".controles-topo")?.classList.add("home-hidden-legacy");
    view.querySelector("hr")?.classList.add("home-hidden-legacy");
    ["moduloContasFixas", "moduloReceitasFixas", "moduloCaixinhas", "areaAno"].forEach(id => {
        document.getElementById(id)?.classList.add("home-hidden-legacy");
    });

    document.getElementById("btnSettingsHome").onclick = () => window.location.hash = "#configuracoes";
    document.getElementById("salvarNuvemBtnHome").onclick = salvarFirebase;
    document.getElementById("logoutBtnHome").onclick = () => document.getElementById("logoutBtn")?.click();
    vincularAcoesContextuaisHome();
    document.getElementById("homeMesAnterior").onclick = () => { homeMesOffset -= 1; renderHomeFigmaResumo(); };
    document.getElementById("homeMesProximo").onclick = () => { homeMesOffset += 1; renderHomeFigmaResumo(); };
}

function renderHomeFigmaResumo() {
    montarLayoutFigmaHome();
    const emailHome = document.getElementById("displayEmailHome");
    if (emailHome && usuarioLogado?.email) emailHome.textContent = usuarioLogado.email;
    renderHomeFinanceCards();
    vincularAcoesContextuaisHome();
    renderBalancoRapido();
}

// Comentario removido por encoding corrompido.
function criarMesFinanceiro() {
    return {
        despesas: [],
        empresa: [],
        salario: salarioFixoBase,
        conta: 0,
        contaManual: false,
        cartoesPagos: {},
        fixasDesativadas: {},
        receitasDesativadas: {},
        fixasEditadas: {}
    };
}

function carregarAno() {
  const sel = document.getElementById("ano");
  const ano = sel ? sel.value : hoje.getFullYear();
  if (!dados[ano]) dados[ano] = { meses: [] };

  const area = document.getElementById("areaAno");
  if (!area) return;
  area.innerHTML = "";
  mesesDOM = [];

  const container = document.createElement("div");
  area.appendChild(container);

  const addBox = document.createElement("div");
  addBox.className = "addMesBox";
  const btnAdd = document.createElement("button");
  const anoNum = Number(ano);
  const anoCompleto = dados[anoNum].meses.length >= 12;
  btnAdd.innerText = anoCompleto ? "+ ADICIONAR ANO" : "+ ADICIONAR M\u00caS";

  btnAdd.onclick = () => {
    if (!dados[anoNum]) dados[anoNum] = { meses: [] };
    if (dados[anoNum].meses.length >= 12) {
      const proximoAno = anoNum + 1;
      if (!dados[proximoAno]) dados[proximoAno] = { meses: [] };
      if (dados[proximoAno].meses.length === 0) {
        dados[proximoAno].meses.push(criarMesFinanceiro());
      }
      atualizarSeletorAnos();
      if (sel) sel.value = String(proximoAno);
      const selGastos = document.getElementById("anoGastos");
      const selAnalise = document.getElementById("anoAnalise");
      if (selGastos) selGastos.value = String(proximoAno);
      if (selAnalise) selAnalise.value = String(proximoAno);
      mesesAbertos.clear();
      mesesAbertos.add(0);
      congelarHistoricoFixas();
    } else {
      dados[anoNum].meses.push(criarMesFinanceiro());
      mesesAbertos.add(dados[anoNum].meses.length - 1);
    }
    carregarAno();
    renderPaginaGastos();
    salvarFirebase();
  };

  addBox.appendChild(btnAdd);
  area.prepend(addBox);

  aplicarParcelas();

  dados[ano].meses.forEach((m, i) => {
    const mDOM = criarMesDOM(ano, i, m);
    container.prepend(mDOM);
    mesesDOM.push({ dom: mDOM, index: i });
  });

  atualizarTudo(ano);
}

// Comentario removido por encoding corrompido.
function aplicarParcelas() {
    // Comentario removido por encoding corrompido.
    Object.keys(dados).forEach(ano => {
        dados[ano].meses.forEach(m => {
            m.despesas = (m.despesas || []).filter(d => !d.parcelaId);
        });
    });

    parcelasMemoria.forEach(p => {
        if (!dados[p.ano] || !dados[p.ano].meses) return;
        let mesCorrente = p.inicio;
        let anoCorrente = p.ano;

        for (let i = 1; i <= p.parcelas; i++) {
            if (!dados[anoCorrente]) dados[anoCorrente] = { meses: [] };
            const meses = dados[anoCorrente].meses;

            if (meses[mesCorrente]) {
                const nomeP = `${p.nome} (${i}/${p.parcelas})`;
                meses[mesCorrente].despesas.push({
                    nome: nomeP,
                    valor: p.valorParcela,
                    data: isoDataMes(anoCorrente, mesCorrente, p.dia || 1),
                    dia: parseIsoData(isoDataMes(anoCorrente, mesCorrente, p.dia || 1))?.getDate() || 1,
                    checked: true,
                    parcelaId: p.id
                });
            }

            mesCorrente++;
            if (mesCorrente > 11) {
                mesCorrente = 0;
                anoCorrente++;
            }
        }
    });
}

// ================= INTERFACE RESUMO =================
function criarItem(lista, d, dataArray, ano, mesIndex = 0, mostrarData = false) {
  if (mostrarData) {
      d.data = getDataDespesa(d, ano, mesIndex);
      d.dia = parseIsoData(d.data)?.getDate() || d.dia || 1;
  }
  const tr = document.createElement("tr");
  // Comentario removido por encoding corrompido.
  if (d.checked) tr.classList.add("item-pago");

  tr.innerHTML = `
    <td style="width: 1%;"><input type="checkbox" ${d.checked?'checked':''}></td>
    <td><input class="input-tabela-edit" value="${d.nome}" placeholder="Nome..."></td>
    ${mostrarData ? `<td><input type="date" class="input-tabela-edit data-edit" value="${d.data}"></td>` : ""}
    <td style="width: fit-content;"><input class="input-tabela-edit valor" value="${formatar(d.valor)}" style="text-align:right;"></td>
    <td style="width: fit-content;"><button class="removeItem">${materialIcon("close")}</button></td>
  `;

  const [tdCheck, tdNome, tdDataOuValor, tdValorOuBtn, tdBtnTalvez] = tr.children;
  const check = tdCheck.querySelector("input");
  const nome = tdNome.querySelector("input");
  const dataInput = mostrarData ? tdDataOuValor.querySelector("input") : null;
  const tdValor = mostrarData ? tdValorOuBtn : tdDataOuValor;
  const tdBtn = mostrarData ? tdBtnTalvez : tdValorOuBtn;
  const valor = tdValor.querySelector("input");
  const btn = tdBtn.querySelector("button");

  check.onchange = async () => {
      d.checked = check.checked;
      // Toggle da cor verde
      if (d.checked) tr.classList.add("item-pago");
      else tr.classList.remove("item-pago");

      controleAvisoPendente(true);
      atualizarTudo(ano);
      await salvarFirebase();
  };

  nome.onblur = async () => { d.nome = nome.value; await salvarFirebase(); };

  if (dataInput) {
      dataInput.onchange = async () => {
          if (!moverDespesaMensalParaData(d, ano, mesIndex, dataInput.value)) return;
          await salvarFirebase();
          carregarAno();
          renderLembretesHome();
          rerenderCalendarioNoShell();
      };
  }

  aplicarComportamentoInput(valor, () => d.valor, (v) => {
      d.valor = v;
      atualizarTudo(ano);
  }, ano);

  btn.onclick = async () => {
      if (d.caixinhaId && !confirm("Item vinculado a uma Caixinha. Continuar?")) return;
      if(d.parcelaId && confirm("Deseja apagar TODAS as parcelas?")) {
          parcelasMemoria = parcelasMemoria.filter(p => p.id !== d.parcelaId);
          aplicarParcelas();
      } else { dataArray.splice(dataArray.indexOf(d), 1); }
      carregarAno();
      await salvarFirebase();
  };
  lista.appendChild(tr);
}

function criarMesDOM(ano, index, data) {
  const mes = document.createElement("div");
  mes.className = mesesAbertos.has(index) ? "mes" : "mes collapsed";

  const header = document.createElement("div");
  header.className = "mesHeader";
  header.innerHTML = `
    <span>${nomesMesesFull[index]} ${ano}</span>
    <div>
        <span class="mesTotal">0,00</span>
        <button class="duplicarMes" title="Duplicar">${materialIcon("content_copy")}</button>
        <button class="removeMes" title="Excluir m\u00eas">${materialIcon("close")}</button>
    </div>`;

  header.onclick = () => {
      mes.classList.toggle("collapsed");
      if(mes.classList.contains("collapsed")) mesesAbertos.delete(index);
      else mesesAbertos.add(index);
  };

  header.querySelector(".removeMes").onclick = (e) => {
      e.stopPropagation();
      if(confirm("Apagar m\u00eas?")) { dados[ano].meses.splice(index, 1); carregarAno(); }
  };

  header.querySelector(".duplicarMes").onclick = (e) => {
      e.stopPropagation();
      const clone = JSON.parse(JSON.stringify(data));
      dados[ano].meses.push(clone); carregarAno();
  };

  const body = document.createElement("div");
  body.className = "mesBody";
  body.innerHTML = `
    <div class="container">
        <div class="coluna despesas">
            <div class="topoColuna"><h4>DESPESAS</h4></div>
            <div class="conteudoColuna">
                <table class="tabela-gastos">
                    <thead><tr><th></th><th>Item</th><th>Data</th><th style="text-align:right;">Valor</th><th></th></tr></thead>
                    <tbody class="listaDesp"></tbody>
                </table>

                <div class="area-acoes-despesa" style="margin-top:15px; padding-top:15px; border-top:1px dashed rgba(255,255,255,0.1);">
                    <div style="display:flex; gap:8px; margin-bottom:10px;">
                        <button class="btn btn-show-quick-add" style="flex:1; font-size:11px;">+ DESPESA</button>
                        <button class="btn btn-show-quick-parcela" style="flex:1; font-size:11px;">+ PARCELA</button>
                    </div>

                    <div class="form-rapido-despesa" style="display:none; flex-direction:column; gap:8px; background:rgba(0,0,0,0.2); padding:10px; border-radius:8px;">
                        <input type="text" class="inputPadrao q-nome" placeholder="Nome">
                        <input type="text" class="inputPadrao q-valor" placeholder="R$ 0,00">

                        <div style="display:flex; gap:5px;">
                            <select class="inputPadrao q-cat" style="font-size:10px;">
                                ${categorias.map(c => `<option value="${c.name}">${c.name}</option>`).join('')}
                            </select>
                            <select class="inputPadrao q-card" style="font-size:10px;">
                                <option value="">Dinheiro (Home)</option>
                                ${cartoes.map(c => `<option value="${c.id}">${c.nome}</option>`).join('')}
                            </select>
                        </div>

                        <div style="display:flex; gap:5px;">
                            <button class="btn btn-confirm-quick" style="flex:2; font-size:11px; background:var(--P04) !important;">Adicionar</button>
                            <button class="btn btn-cancelar-quick sair" style="flex:1; font-size:11px;">X</button>
                        </div>
                    </div>
                </div>

                <div class="listaCartoesDinamica"></div>
            </div>
            <p class="rodapeColuna">Total Pago: <span class="totalDespesas">0,00</span></p>
        </div>

        <div class="coluna dinheiro">
            <div class="topoColuna"><h4>RENDAS</h4></div>
            <div class="conteudoColuna">
                <div class="linhaInputs">
                    <div class="campo"><label>Salário</label><input type="text" class="salario inputPadrao"></div>
                    <div class="campo"><label>Conta</label><input type="text" class="conta inputPadrao"></div>
                    <button class="btn-cascata" title="Ativar Cascata">?</button>
                </div>
                <h5 style="margin: 15px 0 5px 0; color: var(--P03); font-size: 10px; opacity: 0.8;">RENDAS RECORRENTES / EXTRAS</h5>
                <table class="tabela-gastos">
                    <thead><tr><th></th><th>Origem</th><th style="text-align:right;">Valor</th><th></th></tr></thead>
                    <tbody class="listaEmp"></tbody>
                </table>
                <button class="addEmp btn" style="width:100%; margin-top:10px;">+ ADICIONAR RENDA</button>
            </div>
            <p class="rodapeColuna">Total: <span class="totalDinheiro">0,00</span></p>
        </div>
    </div>
    <div class="totalFinal">
        TOTAL: <span class="saldo">0,00</span>
        <button class="btn" style="margin-left:20px; background:var(--P05) !important;" onclick="window.abrirModalGuardar(${ano}, ${index})">GUARDAR</button>
    </div>`;

  // Comentario removido por encoding corrompido.
  const btnShowAdd = body.querySelector(".btn-show-quick-add");
  const formQuick = body.querySelector(".form-rapido-despesa");
  const btnCancelQuick = body.querySelector(".btn-cancelar-quick");
  const btnConfirmQuick = body.querySelector(".btn-confirm-quick");
  const buttonGroup = btnShowAdd.parentElement;

  btnShowAdd.onclick = () => { formQuick.style.display = "flex"; buttonGroup.style.display = "none"; };
  btnCancelQuick.onclick = () => { formQuick.style.display = "none"; buttonGroup.style.display = "flex"; };

  btnConfirmQuick.onclick = async () => {
      const n = formQuick.querySelector(".q-nome").value.trim();
      const v = parseValor(formQuick.querySelector(".q-valor").value);
      const cat = formQuick.querySelector(".q-cat").value;
      const cardId = formQuick.querySelector(".q-card").value;

      if(n && v > 0) {
          const criadoEm = Date.now();
          const dataCriacao = isoHoje();
          const diaCriacao = parseIsoData(dataCriacao)?.getDate() || new Date().getDate();
          if (cardId !== "") {
              // Comentario removido por encoding corrompido.
              const dataObj = parseIsoData(dataCriacao);
              const anoDestino = dataObj?.getFullYear() || Number(ano);
              const mesDestino = dataObj?.getMonth() ?? index;
              if(!gastosDetalhes[anoDestino]) gastosDetalhes[anoDestino] = [];
              gastosDetalhes[anoDestino].push({
                  id: criadoEm + "-" + Math.random().toString(36).slice(2, 8),
                  criadoEm,
                  data: dataCriacao,
                  mes: mesDestino,
                  nome: n,
                  valor: v,
                  categoria: cat,
                  cartaoId: cardId,
                  checked: true
              });
          } else {
              // Se deixou "Dinheiro", adiciona na lista simples da Home
              const dataObj = parseIsoData(dataCriacao);
              const anoDestino = dataObj?.getFullYear() || Number(ano);
              const mesDestino = dataObj?.getMonth() ?? index;
              if (!dados[anoDestino]) dados[anoDestino] = { meses: [] };
              while (dados[anoDestino].meses.length <= mesDestino) dados[anoDestino].meses.push({ despesas: [], empresa: [], cartoesPagos: {}, fixasDesativadas: {}, receitasDesativadas: {}, fixasEditadas: {} });
              dados[anoDestino].meses[mesDestino].despesas.push({ id: criadoEm, criadoEm, data: dataCriacao, dia: diaCriacao, nome: n, valor: v, checked: true });
          }

          atualizarTudo(ano);
          await salvarFirebase(); // Salva na nuvem imediatamente
          carregarAno();
      } else {
          alert("Preencha nome e valor corretamente.");
      }
  };

  body.querySelector(".btn-show-quick-parcela").onclick = () => window.abrirModalParcelamento(index, ano);

  const listD = body.querySelector(".listaDesp");
  const listE = body.querySelector(".listaEmp");

  const listaF = data.fixasSnapshot ? data.fixasSnapshot : contasFixas;
  const listaR = data.receitasSnapshot ? data.receitasSnapshot : receitasFixas;

  // Renderizar Despesas Fixas
  listaF.filter(f => f.ativo && !f.cartaoId).forEach(f => {
      if (!data.fixasDesativadas) data.fixasDesativadas = {};
      if (!data.fixasEditadas) data.fixasEditadas = {};
      const tr = document.createElement("tr");
      const desativada = data.fixasDesativadas[f.id] === true;
      if (!desativada) tr.classList.add("item-pago");
      tr.style.opacity = desativada ? "0.3" : "1";
      const valorExibir = (data.fixasEditadas[f.id] !== undefined) ? data.fixasEditadas[f.id] : f.valor;
      tr.innerHTML = `
        <td style="width: 1%;"><input type="checkbox" ${!desativada ? 'checked' : ''}></td>
        <td style="font-style: italic; font-size:12px; opacity: 0.7;">${f.nome} <small>(fixo)</small></td>
        <td></td>
        <td style="text-align:right;">
            <input class="input-tabela-edit valor-fixa-mes" value="${formatar(valorExibir)}" style="text-align:right;">
        </td>
        <td></td>`;
      tr.querySelector("input").onchange = (e) => {
          data.fixasDesativadas[f.id] = !e.target.checked;
          atualizarTudo(ano);
          renderLembretesHome();
          rerenderCalendarioNoShell();
          carregarAno();
      };
      aplicarComportamentoInput(tr.querySelector(".valor-fixa-mes"), () => valorExibir, (v) => {
          data.fixasEditadas[f.id] = v;
          controleAvisoPendente(true);
          atualizarTudo(ano);
          renderLembretesHome();
          rerenderCalendarioNoShell();
      }, ano);
      listD.appendChild(tr);
  });

  // Renderizar Rendas Recorrentes
  listaR.filter(rf => rf.ativo).forEach(rf => {
      if (!data.receitasDesativadas) data.receitasDesativadas = {};
      const tr = document.createElement("tr");
      const desativada = data.receitasDesativadas[rf.id] === true;
      if (!desativada) tr.classList.add("item-pago");
      tr.style.opacity = desativada ? "0.3" : "1";
      tr.innerHTML = `
        <td style="width: 1%;"><input type="checkbox" ${!desativada ? 'checked' : ''}></td>
        <td style="font-style: italic; font-size:12px; color: #2ecc71;">${rf.nome} <small>(fixo)</small></td>
        <td style="text-align:right; opacity: 0.9; font-size:12px; color: #2ecc71;">${formatar(rf.valor)}</td>
        <td></td>`;
      tr.querySelector("input").onchange = (e) => {
          data.receitasDesativadas[rf.id] = !e.target.checked;
          atualizarTudo(ano);
          renderLembretesHome();
          rerenderCalendarioNoShell();
          carregarAno();
      };
      listE.appendChild(tr);
  });

  (data.empresa || []).forEach(item => criarItem(listE, item, data.empresa, ano));
  [...(data.despesas || [])].sort(compararDespesasPorData).forEach(item => criarItem(listD, item, data.despesas, ano, index, true));

  const inS = body.querySelector("input.salario");
  const inC = body.querySelector("input.conta");
  const salarioAtual = (data.salarioSnapshot !== undefined) ? data.salarioSnapshot : (data.salario || 0);
  inS.value = formatar(salarioAtual);
  inC.value = formatar(data.conta);

  aplicarComportamentoInput(inS, () => (data.salarioSnapshot !== undefined ? data.salarioSnapshot : data.salario), (v) => {
        if (data.salarioSnapshot !== undefined) data.salarioSnapshot = v; else data.salario = v;
        controleAvisoPendente(true); atualizarTudo(ano);
    }, ano);

  aplicarComportamentoInput(inC, () => data.conta, (v) => {
        data.conta = v; data.contaManual = true; inC.classList.add("manual");
        controleAvisoPendente(true); atualizarTudo(ano);
    }, ano);

  const btnCascata = body.querySelector(".btn-cascata");
  btnCascata.onclick = () => {
      const anos = Object.keys(dados).map(Number).sort((a, b) => a - b);
      let encontrou = false;
      anos.forEach(a => {
          dados[a].meses.forEach((m, i) => {
              if (a == ano && i == index) encontrou = true;
              else if (encontrou) m.contaManual = false;
          });
      });
      alert("Cascata reativada!");
      atualizarTudo(ano);
      carregarAno();
  };

  body.querySelector(".addEmp").onclick = () => {
      data.empresa.push({ nome: "", valor: 0, checked: true });
      carregarAno();
  };

  mes.appendChild(header);
  mes.appendChild(body);
  return mes;
}

// Comentario removido por encoding corrompido.

function abrirModalNoFluxoNovo(modalId, renderizar) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    if (modal.parentElement !== document.body) document.body.appendChild(modal);
    if (typeof renderizar === "function") renderizar();
    modal.classList.add("modal-appshell");
    modal.style.display = "flex";
}

function fecharModalNoFluxoNovo(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.remove("modal-appshell");
    modal.style.display = "none";
}

function abrirGerenciadorCategorias() {
    abrirModalNoFluxoNovo("modalCategorias", renderCategoriasModal);
}

function abrirGerenciadorCartoes() {
    abrirModalNoFluxoNovo("modalCartoes", renderCartoesModal);
}

function garantirIdentidadeGasto(g, anoFallback = new Date().getFullYear()) {
    if (!g.id) g.id = `${g.mes ?? "m"}-${g.cartaoId ?? "card"}-${g.parcelaId ?? "manual"}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (!g.criadoEm) g.criadoEm = Date.now();
    g.data = getDataDespesa(g, anoFallback, g.mes);
    g.checked = gastoCartaoContaNoTotal(g);
    return g;
}

function moverGastoDetalhadoParaData(gasto, anoOrigem, novaDataIso) {
    const data = parseIsoData(novaDataIso);
    if (!data) return false;
    gasto.data = data.toLocaleDateString("en-CA");
    gasto.dia = data.getDate();
    return true;
}

function moverDespesaMensalParaData(despesa, anoOrigem, mesOrigem, novaDataIso) {
    if (!aplicarDataDespesa(despesa, novaDataIso)) return false;
    const data = parseIsoData(despesa.data);
    const anoDestino = data.getFullYear();
    const mesDestino = data.getMonth();
    if (!dados[anoDestino]) dados[anoDestino] = { meses: [] };
    while (dados[anoDestino].meses.length <= mesDestino) {
        dados[anoDestino].meses.push({ despesas: [], empresa: [], cartoesPagos: {}, fixasDesativadas: {}, receitasDesativadas: {}, fixasEditadas: {} });
    }
    if (Number(anoOrigem) !== anoDestino || Number(mesOrigem) !== mesDestino) {
        const origem = dados[anoOrigem]?.meses?.[mesOrigem]?.despesas || [];
        const idx = origem.indexOf(despesa);
        if (idx >= 0) origem.splice(idx, 1);
        const destino = dados[anoDestino].meses[mesDestino].despesas;
        if (!destino.includes(despesa)) destino.push(despesa);
    }
    return true;
}

function abrirEditorDespesaFixaGlobal(fixaId, anoView) {
    const fixa = contasFixas.find(f => String(f.id) === String(fixaId));
    if (!fixa) {
        alert("Essa despesa pertence a um snapshot antigo e n\u00e3o pode ser editada globalmente.");
        return;
    }

    let modal = document.getElementById("modalEditarFixaGlobal");
    if (!modal) {
        modal = document.createElement("div");
        modal.id = "modalEditarFixaGlobal";
        modal.className = "modal-overlay";
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="modal-content" style="max-width:520px;">
            <h3>Editar despesa fixa</h3>
            <div class="campo"><label>Nome</label><input type="text" id="editFixaNome" class="inputPadrao" value="${fixa.nome || ''}"></div>
            <div class="campo" style="margin-top:10px;"><label>Dia</label><input type="number" id="editFixaDia" class="inputPadrao" value="${fixa.dia || 1}" min="1" max="31"></div>
            <div class="campo" style="margin-top:10px;"><label>Valor</label><input type="text" id="editFixaValor" class="inputPadrao" value="${formatar(fixa.valor)}"></div>
            <div class="campo" style="margin-top:10px;"><label>Categoria</label><select id="editFixaCategoria" class="inputPadrao">${categorias.map(c => `<option value="${c.name}" ${fixa.categoria === c.name ? 'selected' : ''}>${c.name}</option>`).join('')}</select></div>
            <div class="campo" style="margin-top:10px;"><label>Cart\u00e3o</label>
            <div style="display:flex; gap:10px; margin-top:20px;">
                <button class="btn" id="btnSalvarEditFixaGlobal" style="flex:1">Salvar</button>
                <button class="btn sair" id="btnFecharEditFixaGlobal" style="flex:1">Cancelar</button>
            </div>
        </div>`;

    modal.style.display = "flex";
    aplicarCorCategoriaSelect(modal.querySelector("#editFixaCategoria"));
    modal.querySelector("#btnFecharEditFixaGlobal").onclick = () => modal.style.display = "none";
    modal.querySelector("#btnSalvarEditFixaGlobal").onclick = async () => {
        congelarHistoricoFixas();
        fixa.nome = modal.querySelector("#editFixaNome").value.trim() || fixa.nome;
        fixa.dia = parseInt(modal.querySelector("#editFixaDia").value) || 1;
        fixa.valor = parseValor(modal.querySelector("#editFixaValor").value);
        fixa.categoria = modal.querySelector("#editFixaCategoria").value;
        fixa.cartaoId = modal.querySelector("#editFixaCartao").value;
        salvarDadosLocal();
        await salvarFirebase();
        modal.style.display = "none";
        renderContasFixas();
        renderPaginaGastos();
        atualizarTudo(anoView || document.getElementById("ano")?.value || new Date().getFullYear());
    };
}

function agruparLinhasGastosPorCartao(tbody, totaisPorCartao) {
    const linhas = Array.from(tbody.querySelectorAll("tr[data-card-id]"));
    if (linhas.length === 0) return;

    const grupos = new Map();
    linhas.forEach(linha => {
        const cardId = linha.dataset.cardId || "";
        if (!grupos.has(cardId)) grupos.set(cardId, []);
        grupos.get(cardId).push(linha);
    });

    tbody.innerHTML = "";

    grupos.forEach((linhasDoCartao, cardId) => {
        const cartao = cartoes.find(c => String(c.id) === String(cardId));
        const header = document.createElement("tr");
        header.className = "linha-cartao-accordion";
        header.dataset.cardId = cardId;
        header.style.cursor = "pointer";
        header.innerHTML = `
            <td colspan="7" class="cartao-accordion-cell" style="--cartao-cor:${cartao?.color || 'var(--P04)'};">
                <div class="cartao-accordion-row">
                    <strong class="cartao-accordion-nome">${cartao?.nome || 'Cart\u00e3o'}</strong>
                    <strong class="cartao-accordion-valor">${formatar(totaisPorCartao[cardId] || 0)}</strong>
                </div>
            </td>`;
        tbody.appendChild(header);

        linhasDoCartao.forEach(linha => {
            linha.style.display = "none";
            tbody.appendChild(linha);
        });

        header.onclick = () => {
            const aberto = header.classList.toggle("aberto");
            linhasDoCartao.forEach(linha => {
                linha.style.display = aberto ? "" : "none";
            });
        };
    });
}

function getMesGastosAtivo() {
    const anoSelect = document.getElementById("anoGastos");
    const ref = getMesReferenciaAtivo();
    const ano = Number(anoSelect?.value || ref.anoAt || new Date().getFullYear());
    if (gastosDetalhadosMesCursor && Number(gastosDetalhadosMesCursor.ano) === ano) {
        return { ano, mes: Number(gastosDetalhadosMesCursor.mes) };
    }
    const mesAberto = Array.from(mesesGastosAbertos).pop();
    const mes = Number.isInteger(mesAberto) ? mesAberto : (Number(ano) === Number(ref.anoAt) ? ref.mesAt : 0);
    gastosDetalhadosMesCursor = { ano, mes };
    return { ano, mes };
}

function setMesGastosAtivo(ano, mes) {
    let anoNovo = Number(ano);
    let mesNovo = Number(mes);
    if (mesNovo < 0) { mesNovo = 11; anoNovo -= 1; }
    if (mesNovo > 11) { mesNovo = 0; anoNovo += 1; }
    gastosDetalhadosMesCursor = { ano: anoNovo, mes: mesNovo };
    mesesGastosAbertos.clear();
    mesesGastosAbertos.add(mesNovo);
    const anoSelect = document.getElementById("anoGastos");
    if (anoSelect) {
        if (![...anoSelect.options].some(opt => String(opt.value) === String(anoNovo))) {
            anoSelect.insertAdjacentHTML("beforeend", `<option value="${anoNovo}">${anoNovo}</option>`);
        }
        anoSelect.value = String(anoNovo);
    }
}

function garantirMesDados(ano, mes) {
    if (!dados[ano]) dados[ano] = { meses: [] };
    while (dados[ano].meses.length <= mes) {
        dados[ano].meses.push({ despesas: [], empresa: [], cartoesPagos: {}, fixasDesativadas: {}, receitasDesativadas: {}, fixasEditadas: {} });
    }
    const mData = dados[ano].meses[mes];
    if (!mData.despesas) mData.despesas = [];
    if (!mData.empresa) mData.empresa = [];
    if (!mData.cartoesPagos) mData.cartoesPagos = {};
    if (!mData.fixasDesativadas) mData.fixasDesativadas = {};
    if (!mData.fixasEditadas) mData.fixasEditadas = {};
    return mData;
}

function getValorFixaMes(fixa, mData) {
    return (mData?.fixasEditadas?.[fixa.id] !== undefined) ? mData.fixasEditadas[fixa.id] : fixa.valor;
}

function getCartaoById(id) {
    return cartoes.find(c => String(c.id) === String(id));
}

function gastoCartaoContaNoTotal(gasto) {
    return gasto?.checked !== false;
}

function formatarDataGasto(dataIso) {
    const data = parseIsoData(dataIso);
    if (!data) return "--";
    return data.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }).replace(".", "").toUpperCase();
}

function formatarDataCompactaGasto(dataIso) {
    const data = parseIsoData(dataIso);
    if (!data) return "--/--";
    return data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function getGastoLinhaUiKey(item) {
    if (!item?.ref || typeof item.ref !== "object") return `${item?.tipo || "gasto"}:${item?.nome || "sem-nome"}:${item?.data || ""}`;
    if (!gastoLinhaUiKeys.has(item.ref)) {
        gastoLinhaUiSeq += 1;
        gastoLinhaUiKeys.set(item.ref, `${item.tipo || "gasto"}:${item.ref.id || item.ref.parcelaId || item.ref.criadoEm || item.ref.timestamp || gastoLinhaUiSeq}:${gastoLinhaUiSeq}`);
    }
    return gastoLinhaUiKeys.get(item.ref);
}

function obterParcelaInfo(nome) {
    const match = String(nome || "").match(/\((\d+)\/(\d+)\)/);
    return match ? `${match[1]}/${match[2]}` : "";
}

function getCategoriaResumoGasto(categoria) {
    return String(categoria || categorias[0]?.name || "Sem categoria");
}

function alternarFiltroCategoriaGastos(categoria) {
    const categoriaSelecionada = getCategoriaResumoGasto(categoria);
    filtrosGastosDetalhados.categoria = filtrosGastosDetalhados.categoria === categoriaSelecionada ? "todas" : categoriaSelecionada;
    rerenderRotaAtual();
}

function renderGraficoCategoriasResumoGastos(totaisCategorias) {
    const div = document.getElementById("gastosResumoCategoriasChart");
    if (chartCategoriasResumoGastos) {
        chartCategoriasResumoGastos.destroy();
        chartCategoriasResumoGastos = null;
    }
    if (!div) return;

    const entradas = Object.entries(totaisCategorias || {}).filter(([, valor]) => Number(valor) > 0);
    if (!entradas.length) {
        div.innerHTML = `<div class="home-empty-row">Sem categorias neste m\u00eas.</div>`;
        return;
    }

    const labels = entradas.map(([nome]) => nome);
    const corTexto = getComputedStyle(document.body).getPropertyValue("--P01").trim() || "#FFF8E7";
    div.innerHTML = "";
    chartCategoriasResumoGastos = new ApexCharts(div, {
        series: entradas.map(([, valor]) => Number(valor || 0)),
        labels,
        colors: labels.map(nome => categorias.find(c => c.name === nome)?.color || "#888888"),
        chart: {
            type: "donut",
            height: 220,
            background: "transparent",
            events: {
                dataPointSelection: (_event, _context, config) => {
                    const categoria = labels[config.dataPointIndex];
                    if (categoria) alternarFiltroCategoriaGastos(categoria);
                }
            }
        },
        stroke: { width: 0 },
        legend: { show: false },
        dataLabels: { enabled: false },
        tooltip: { y: { formatter: valor => formatar(valor || 0) } },
        plotOptions: {
            pie: {
                donut: {
                    size: "62%",
                    labels: {
                        show: true,
                        name: { color: corTexto },
                        value: { color: corTexto, formatter: valor => formatar(Number(valor) || 0) },
                        total: { show: true, label: "Categorias", color: corTexto, formatter: w => formatar(w.globals.seriesTotals.reduce((acc, valor) => acc + valor, 0)) }
                    }
                }
            }
        }
    });
    chartCategoriasResumoGastos.render();
}

function despesaPassaFiltrosGastos(item, filtros) {
    const busca = String(filtros.busca || "").trim().toLowerCase();
    if (busca && !String(item.nome || "").toLowerCase().includes(busca)) return false;
    if (filtros.categoria && filtros.categoria !== "todas" && getCategoriaResumoGasto(item.categoria) !== filtros.categoria) return false;
    if (filtros.tipo !== "todos" && item.tipo !== filtros.tipo) return false;
    if (filtros.status === "ativos" && item.pago) return false;
    if (filtros.status === "pagos" && !item.pago) return false;
    if (filtros.cartao !== "todos" && filtros.cartao !== "agrupados" && String(item.cartaoId || "") !== String(filtros.cartao)) return false;
    return true;
}

function moverGastoParaFatura(gasto, anoOrigem, novoMes, novoAno = anoOrigem) {
    const anoO = String(anoOrigem);
    const anoD = String(novoAno);
    gasto.mes = Number(novoMes);
    if (anoO !== anoD) {
        gastosDetalhes[anoO] = (gastosDetalhes[anoO] || []).filter(item => item !== gasto);
        if (!gastosDetalhes[anoD]) gastosDetalhes[anoD] = [];
        gastosDetalhes[anoD].push(gasto);
    }
}

async function salvarERenderizarGastos(ano = document.getElementById("anoGastos")?.value) {
    const salvou = await salvarFirebase();
    if (!salvou) return false;
    atualizarTudo(ano || new Date().getFullYear());
    renderPaginaGastos();
    if ((window.location.hash || "#resumo") === "#gastos") {
        sincronizarRotaNoAppShell("#gastos");
    }
    renderLembretesHome();
    if (window.location.hash === "#calendario") rerenderCalendarioNoShell();
    return true;
}

function renderGastosLinha(item, contexto) {
    const cartao = getCartaoById(item.cartaoId);
    const cat = categorias.find(c => c.name === item.categoria);
    const uiKey = getGastoLinhaUiKey(item);
    const expandida = gastoLinhaExpandidaKey === uiKey;
    const row = document.createElement("div");
    row.className = `gastos-work-row tipo-${item.tipo} ${item.pago ? "is-paid" : ""} ${expandida ? "is-expanded" : ""}`;
    row.dataset.cardId = item.cartaoId || "";
    row.dataset.gastoLinhaKey = uiKey;
    row.style.setProperty("--row-color", cartao?.color || cat?.color || "var(--P04)");
    row.innerHTML = `
        <div class="gastos-row-compact">
            <input type="checkbox" class="gastos-row-check" ${item.pago ? "checked" : ""}>
            <div class="gastos-row-summary">
                <strong>${escapeHtml(item.nome || "Gasto sem nome")}</strong>
                <span>&bull; ${formatarDataCompactaGasto(item.data)}</span>
                ${item.parcelaTag ? `<em class="gastos-row-badge gastos-row-parcela">${escapeHtml(item.parcelaTag)}</em>` : ""}
                <em class="gastos-row-badge gastos-row-category-badge" style="--badge-color:${cat?.color || "var(--P04)"}">${escapeHtml(item.categoria || "Sem categoria")}</em>
                ${cartao ? `<em class="gastos-row-badge gastos-row-card-badge" style="--badge-color:${cartao.color || "var(--P04)"}">${escapeHtml(cartao.nome)}</em>` : ""}
            </div>
            <strong class="gastos-row-compact-value">${formatar(item.valor || 0)}</strong>
            <button class="removeItem gastos-row-delete ${item.tipo === "fixa" ? "gastos-row-settings" : ""}" type="button" title="${item.tipo === "fixa" ? "Configurar despesas fixas" : "Excluir gasto"}" aria-label="${item.tipo === "fixa" ? "Configurar despesas fixas" : "Excluir gasto"}">${materialIcon(item.tipo === "fixa" ? "settings" : "close")}</button>
        </div>
        <div class="gastos-row-editor" ${expandida ? "" : "hidden"}>
            <input type="checkbox" class="gastos-row-check gastos-row-editor-check" ${item.pago ? "checked" : ""}>
            <input class="gastos-row-name input-tabela-edit" value="${escapeHtml(item.nome || "")}" ${item.tipo === "fixa" ? "readonly" : ""}>
            <select class="gastos-row-category input-tabela-edit" ${item.tipo === "fixa" ? "disabled" : ""}>
                ${categorias.map(c => `<option value="${c.name}" ${item.categoria === c.name ? "selected" : ""}>${c.name}</option>`).join("")}
            </select>
            <input type="date" class="gastos-row-date input-tabela-edit" value="${item.data || ""}" ${item.tipo === "fixa" ? "disabled" : ""}>
            <select class="gastos-row-card input-tabela-edit" ${item.tipo !== "manual" ? "disabled" : ""}>
                <option value="" ${!item.cartaoId ? "selected" : ""}>Sem cart\u00e3o</option>
                ${cartoes.map(c => `<option value="${c.id}" ${String(item.cartaoId) === String(c.id) ? "selected" : ""}>${escapeHtml(c.nome)}</option>`).join("")}
            </select>
            <input class="gastos-row-value input-tabela-edit" value="${formatar(item.valor || 0)}">
            <button class="removeItem gastos-row-delete ${item.tipo === "fixa" ? "gastos-row-settings" : ""}" type="button" title="${item.tipo === "fixa" ? "Configurar despesas fixas" : "Excluir gasto"}" aria-label="${item.tipo === "fixa" ? "Configurar despesas fixas" : "Excluir gasto"}">${materialIcon(item.tipo === "fixa" ? "settings" : "close")}</button>
        </div>
    `;

    const compact = row.querySelector(".gastos-row-compact");
    const editor = row.querySelector(".gastos-row-editor");
    const checks = row.querySelectorAll(".gastos-row-check");
    const nome = row.querySelector(".gastos-row-name");
    const categoria = row.querySelector(".gastos-row-category");
    const data = row.querySelector(".gastos-row-date");
    const card = row.querySelector(".gastos-row-card");
    const valor = row.querySelector(".gastos-row-value");
    const deletes = row.querySelectorAll(".gastos-row-delete");

    aplicarCorCategoriaSelect(categoria);
    aplicarCorCartaoSelect(card);

    const atualizarCheck = async (checked) => {
        if (item.tipo === "fixa") contexto.mData.fixasDesativadas[item.ref.id] = !checked;
        else item.ref.checked = checked;
        await salvarERenderizarGastos(contexto.ano);
    };
    checks.forEach(check => {
        check.onclick = event => event.stopPropagation();
        check.onchange = () => atualizarCheck(check.checked);
    });

    const salvarEdicao = async () => {
        if (row.dataset.cancelada === "true" || row.dataset.salvando === "true") return;
        row.dataset.salvando = "true";
        if (item.tipo !== "fixa") {
            item.ref.nome = nome.value.trim() || item.ref.nome;
            const categoriaAnterior = item.ref.categoria;
            const categoriaNova = categoria.value;
            item.ref.categoria = categoriaNova;
            if (item.tipo === "manual" && item.ref.parcelaId && categoriaNova !== categoriaAnterior) {
                Object.values(gastosDetalhes).forEach(lista => {
                    (lista || []).forEach(gasto => {
                        if (String(gasto.parcelaId) === String(item.ref.parcelaId)) gasto.categoria = categoriaNova;
                    });
                });
            }
            if (item.tipo === "manual") {
                item.ref.data = data.value;
                item.ref.dia = parseIsoData(data.value)?.getDate() || item.ref.dia;
            } else {
                moverDespesaMensalParaData(item.ref, contexto.ano, contexto.mes, data.value);
            }
            if (item.tipo === "manual") item.ref.cartaoId = card.value;
            if (valor.value.trim()) item.ref.valor = parseValor(valor.value);
        } else if (valor.value.trim()) {
            contexto.mData.fixasEditadas[item.ref.id] = parseValor(valor.value);
        }
        if (gastoLinhaExpandidaKey === uiKey) gastoLinhaExpandidaKey = null;
        await salvarERenderizarGastos(contexto.ano);
    };

    const cancelarEdicao = () => {
        row.dataset.cancelada = "true";
        gastoLinhaExpandidaKey = null;
        rerenderRotaAtual();
    };

    compact.onclick = (event) => {
        if (event.target.closest("input,button")) return;
        gastoLinhaExpandidaKey = uiKey;
        rerenderRotaAtual();
    };

    if (expandida) {
        requestAnimationFrame(() => nome?.focus());
        editor.querySelectorAll("input:not([type='checkbox']), select").forEach(control => {
            control.onkeydown = (event) => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    salvarEdicao();
                }
                if (event.key === "Escape") {
                    event.preventDefault();
                    cancelarEdicao();
                }
            };
        });
        row.addEventListener("focusout", () => {
            setTimeout(() => {
                if (!row.contains(document.activeElement)) {
                    salvarEdicao();
                }
            }, 0);
        });
    }

    const excluirOuConfigurar = async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (item.tipo === "fixa") {
            abrirModalModuloConfigHome("moduloContasFixas", "Configurar despesas fixas", renderContasFixas);
            return;
        } else if (item.tipo === "manual") {
            if (item.ref.parcelaId && confirm("Deseja apagar TODAS as parcelas deste gasto?")) {
                Object.keys(gastosDetalhes).forEach(ano => { gastosDetalhes[ano] = (gastosDetalhes[ano] || []).filter(g => g.parcelaId !== item.ref.parcelaId); });
            } else {
                gastosDetalhes[contexto.ano] = (gastosDetalhes[contexto.ano] || []).filter(g => g !== item.ref);
            }
        } else {
            contexto.mData.despesas = contexto.mData.despesas.filter(d => d !== item.ref);
        }
        await salvarERenderizarGastos(contexto.ano);
    };
    deletes.forEach(del => del.onclick = excluirOuConfigurar);
    return row;
}

function abrirModalGastoDetalhado(mes, ano) {
    const antigo = document.getElementById("modalGastoDetalhadoRapido");
    if (antigo) antigo.remove();
    const cartaoPadrao = filtrosGastosDetalhados.cartao !== "todos" && filtrosGastosDetalhados.cartao !== "agrupados"
        ? filtrosGastosDetalhados.cartao
        : (cartoes[0]?.id || "");
    const overlay = document.createElement("div");
    overlay.id = "modalGastoDetalhadoRapido";
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
        <div class="modal-content modal-gasto-detalhado">
            <h2>Novo gasto</h2>
            <input id="gdNomeRapido" class="inputPadrao" placeholder="Nome do gasto">
            <input id="gdValorRapido" class="inputPadrao" placeholder="Valor">
            <select id="gdCategoriaRapida" class="inputPadrao">${categorias.map(c => `<option value="${c.name}">${c.name}</option>`).join("")}</select>
            <select id="gdCartaoRapido" class="inputPadrao">${cartoes.map(c => `<option value="${c.id}" ${String(c.id) === String(cartaoPadrao) ? "selected" : ""}>${escapeHtml(c.nome)}</option>`).join("")}</select>
            <div class="modal-actions">
                <button class="btn" id="gdSalvarRapido">Salvar</button>
                <button class="btn sair" id="gdFecharRapido">Fechar</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    popularSelectCategorias(overlay.querySelector("#gdCategoriaRapida"));
    overlay.querySelector("#gdFecharRapido").onclick = () => overlay.remove();
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    overlay.querySelector("#gdSalvarRapido").onclick = async () => {
        const nome = overlay.querySelector("#gdNomeRapido").value.trim();
        const valor = parseValor(overlay.querySelector("#gdValorRapido").value);
        if (!nome || valor <= 0) return alert("Preencha corretamente.");
        if (!gastosDetalhes[ano]) gastosDetalhes[ano] = [];
        const criadoEm = Date.now();
        gastosDetalhes[ano].push({
            id: `${criadoEm}-${Math.random().toString(36).slice(2, 8)}`,
            criadoEm,
            data: isoDataMes(ano, mes, new Date().getDate()),
            dia: parseIsoData(isoDataMes(ano, mes, new Date().getDate()))?.getDate() || 1,
            mes,
            nome,
            valor,
            categoria: overlay.querySelector("#gdCategoriaRapida").value,
            cartaoId: overlay.querySelector("#gdCartaoRapido").value,
            checked: true
        });
        overlay.remove();
        await salvarERenderizarGastos(ano);
    };
}

function renderPaginaGastos() {
    const area = document.getElementById("areaGastosMensais");
    const anoSelect = document.getElementById("anoGastos");
    if (!area || !anoSelect) return;
    normalizarDadosApp();
    const ativo = getMesGastosAtivo();
    const anoView = Number(ativo.ano);
    const mes = Number(ativo.mes);
    const mData = garantirMesDados(anoView, mes);
    const listaBaseFixas = mData.fixasSnapshot ? mData.fixasSnapshot : contasFixas;
    const gastosFixosBase = listaBaseFixas.filter(f => f.ativo && f.cartaoId);
    const gastosManuaisBase = (gastosDetalhes[anoView] || []).filter(g => Number(g.mes) === mes).map(g => garantirIdentidadeGasto(g, anoView)).sort(compararDespesasPorData);
    const importadosBase = (mData.despesas || []).map(d => {
        d.data = getDataDespesa(d, anoView, mes);
        return d;
    }).sort(compararDespesasPorData);
    const mesAnterior = new Date(anoView, mes - 1, 1);
    const mesProximo = new Date(anoView, mes + 1, 1);
    const filtroCartao = filtrosGastosDetalhados.cartao || filtrosPorMes[mes] || "todos";
    filtrosGastosDetalhados.cartao = filtroCartao;

    const itens = [
        ...gastosFixosBase.map(f => ({
            tipo: "fixa",
            nome: f.nome,
            valor: getValorFixaMes(f, mData),
            categoria: f.categoria,
            cartaoId: f.cartaoId,
            data: isoDataMes(anoView, mes, f.dia || 1),
            pago: mData.fixasDesativadas[f.id] !== true,
            ref: f
        })),
        ...gastosManuaisBase.map(g => ({
            tipo: "manual",
            nome: g.nome,
            valor: g.valor,
            categoria: g.categoria,
            cartaoId: g.cartaoId,
            data: g.data,
            pago: gastoCartaoContaNoTotal(g),
            parcelaTag: obterParcelaInfo(g.nome),
            criadoEm: g.criadoEm,
            ref: g
        })),
        ...importadosBase.map(d => ({
            tipo: "importado",
            nome: d.nome,
            valor: d.valor,
            categoria: d.categoria,
            cartaoId: "",
            data: d.data,
            pago: d.checked === true,
            criadoEm: d.criadoEm || d.timestamp,
            ref: d
        }))
    ].filter(item => despesaPassaFiltrosGastos(item, filtrosGastosDetalhados));

    const totalFixas = gastosFixosBase.filter(f => mData.fixasDesativadas[f.id] !== true).reduce((acc, f) => acc + getValorFixaMes(f, mData), 0);
    const gastosManuaisIncluidos = gastosManuaisBase.filter(gastoCartaoContaNoTotal);
    const totaisCartao = {};
    [...gastosFixosBase.map(f => ({ cartaoId: f.cartaoId, valor: getValorFixaMes(f, mData), ativo: mData.fixasDesativadas[f.id] !== true })), ...gastosManuaisIncluidos.map(g => ({ cartaoId: g.cartaoId, valor: g.valor, ativo: true }))]
        .filter(item => item.ativo)
        .forEach(item => { totaisCartao[item.cartaoId] = (totaisCartao[item.cartaoId] || 0) + Number(item.valor || 0); });
    const totalCartoesResumo = Object.values(totaisCartao).reduce((acc, total) => acc + Number(total || 0), 0);
    const totaisCategoriasResumo = {};
    [
        ...gastosFixosBase
            .filter(f => mData.fixasDesativadas[f.id] !== true)
            .map(f => ({ categoria: f.categoria, valor: getValorFixaMes(f, mData) })),
        ...gastosManuaisIncluidos
            .filter(g => g.cartaoId)
            .map(g => ({ categoria: g.categoria, valor: g.valor }))
    ].forEach(item => {
        const categoria = getCategoriaResumoGasto(item.categoria);
        totaisCategoriasResumo[categoria] = (totaisCategoriasResumo[categoria] || 0) + Number(item.valor || 0);
    });
    const categoriasResumoOrdenadas = Object.keys(totaisCategoriasResumo).sort((a, b) => totaisCategoriasResumo[b] - totaisCategoriasResumo[a]);

    area.innerHTML = `
        <div class="app-route-fragments gastos-route-fragments">
            <section class="gastos-filter-card">
                        <div class="despHeader"><span>Filtros</span></div>
                        <div class="mesBody">
                            <label>Ano<select id="gastosAnoFiltro" class="inputPadrao">${[...anoSelect.options].map(opt => `<option value="${opt.value}" ${String(opt.value) === String(anoView) ? "selected" : ""}>${opt.textContent}</option>`).join("")}</select></label>
                            <label>Cart\u00e3o<select id="gastosFiltroCartao" class="inputPadrao">
                                <option value="agrupados" ${filtroCartao === "agrupados" ? "selected" : ""}>Agrupado por cart\u00e3o</option>
                                <option value="todos" ${filtroCartao === "todos" ? "selected" : ""}>Todos os cart\u00f5es</option>
                                ${cartoes.map(c => `<option value="${c.id}" ${String(filtroCartao) === String(c.id) ? "selected" : ""}>${escapeHtml(c.nome)}</option>`).join("")}
                            </select></label>
                            <label>Tipo<select id="gastosFiltroTipo" class="inputPadrao">
                                <option value="todos" ${filtrosGastosDetalhados.tipo === "todos" ? "selected" : ""}>Todos</option>
                                <option value="fixa" ${filtrosGastosDetalhados.tipo === "fixa" ? "selected" : ""}>Fixas sincronizadas</option>
                                <option value="manual" ${filtrosGastosDetalhados.tipo === "manual" ? "selected" : ""}>Manuais / cart\u00e3o</option>
                                <option value="importado" ${filtrosGastosDetalhados.tipo === "importado" ? "selected" : ""}>Dados importados</option>
                            </select></label>
                            <label>Status<select id="gastosFiltroStatus" class="inputPadrao">
                                <option value="todos" ${filtrosGastosDetalhados.status === "todos" ? "selected" : ""}>Todos</option>
                                <option value="ativos" ${filtrosGastosDetalhados.status === "ativos" ? "selected" : ""}>Em aberto</option>
                                <option value="pagos" ${filtrosGastosDetalhados.status === "pagos" ? "selected" : ""}>Pagos / ocultos</option>
                            </select></label>
                            <label>Busca
                                <div class="app-search-field">
                                    <input id="gastosBusca" class="inputPadrao" value="${escapeHtml(filtrosGastosDetalhados.busca)}" placeholder="Buscar gasto">
                                    <button id="gastosBuscaClear" class="app-search-clear ${filtrosGastosDetalhados.busca ? "is-visible" : ""}" type="button" title="Limpar busca" aria-label="Limpar busca">${materialIcon("close")}</button>
                                </div>
                            </label>
                            <div class="gastos-filter-actions">
                                <button class="btn" id="gastosBtnCategorias" type="button">Categorias</button>
                                <button class="btn" id="gastosBtnCartoes" type="button">Cart\u00f5es</button>
                                <button class="btn" id="gastosBtnFixas" type="button">Despesas fixas</button>
                            </div>
                        </div>
            </section>
            <div class="app-content gastos-work-area">
                    <div class="app-month-nav home-month-nav gastos-month-nav">
                        <button class="btn" id="gastosMesAnterior" type="button">&lt; ${nomesMesesFull[mesAnterior.getMonth()].toUpperCase()}</button>
                        <div class="home-current-month"><span>${nomesMesesFull[mes].toUpperCase()} ${anoView}</span></div>
                        <button class="btn" id="gastosMesProximo" type="button">${nomesMesesFull[mesProximo.getMonth()].toUpperCase()} &gt;</button>
                    </div>
                    <div class="gastos-work-grid">
                        <section class="gastos-list-card figma-card">
                            <div class="despHeader"><span>Lan\u00e7amentos</span><small>${itens.length} itens</small></div>
                            <div class="mesBody">
                                <div id="gastosListaLancamentos" class="gastos-list-scroll"></div>
                            </div>
                        </section>
                        <aside class="gastos-summary-card figma-card">
                            <div class="despHeader"><span>Resumo da fatura</span></div>
                            <div class="mesBody">
                                <section class="gastos-summary-categories">
                                    <div id="gastosResumoCategoriasChart" class="gastos-summary-chart"></div>
                                    <div class="gastos-category-filters">
                                        <button class="gastos-category-filter ${filtrosGastosDetalhados.categoria === "todas" ? "is-active" : ""}" type="button" data-gastos-categoria="todas">Todas</button>
                                        ${categoriasResumoOrdenadas.map(nome => `
                                            <button class="gastos-category-filter ${filtrosGastosDetalhados.categoria === nome ? "is-active" : ""}" type="button" data-gastos-categoria="${escapeHtml(nome)}" style="--category-color:${categorias.find(c => c.name === nome)?.color || "#888888"}">
                                                ${escapeHtml(nome)}
                                            </button>
                                        `).join("")}
                                    </div>
                                </section>
                                <div class="balanco-rapido-metricas">
                                    <div class="metric-card-total-cartoes"><small>Total dos cart\u00f5es</small><strong>${formatar(totalCartoesResumo)}</strong></div>
                                    <div><small>Despesas fixas</small><strong>${formatar(totalFixas)}</strong></div>
                                </div>
                                <div class="gastos-card-totals">
                                    ${Object.entries(totaisCartao).map(([cid, total]) => {
                                        const c = getCartaoById(cid);
                                        const cartaoAtivo = String(filtrosGastosDetalhados.cartao) === String(cid);
                                        return `<button class="gastos-card-total ${cartaoAtivo ? "is-active" : ""}" type="button" data-gastos-cartao="${escapeHtml(cid)}" style="--card-color:${c?.color || "var(--P04)"}" title="Filtrar por ${escapeHtml(c?.nome || "cart\u00e3o")}"><span>${escapeHtml(c?.nome || "Cart\u00e3o")}</span><strong>${formatar(total)}</strong></button>`;
                                    }).join("") || `<div class="home-empty-row">Sem cart\u00f5es neste m\u00eas.</div>`}
                                </div>
                                <div class="gastos-summary-footer">
                                    <button class="btn home-action-btn" id="gastosAddManual" type="button">+ Gasto</button>
                                    <button class="btn home-action-btn" id="gastosAddParcela" type="button">+ Parcelamento</button>
                                </div>
                            </div>
                        </aside>
                    </div>
            </div>
        </div>
    `;

    const lista = area.querySelector("#gastosListaLancamentos");
    const contexto = { ano: anoView, mes, mData };
    if (filtroCartao === "agrupados") {
        const grupos = new Map();
        itens.forEach(item => {
            const chave = item.cartaoId === undefined || item.cartaoId === null || item.cartaoId === ""
                ? "__importados"
                : String(item.cartaoId);
            if (!grupos.has(chave)) grupos.set(chave, []);
            grupos.get(chave).push(item);
        });
        grupos.forEach((grupo, cardId) => {
            const cartao = getCartaoById(cardId);
            const total = grupo.reduce((acc, item) => acc + Number(item.valor || 0), 0);
            const acc = document.createElement("section");
            acc.className = "gastos-card-accordion";
            acc.style.setProperty("--card-color", cartao?.color || "var(--P04)");
            acc.innerHTML = `<button class="gastos-card-accordion-head" type="button"><span>${escapeHtml(cartao?.nome || "Dados importados")}</span><strong>${formatar(total)}</strong></button><div class="gastos-card-accordion-body"></div>`;
            const body = acc.querySelector(".gastos-card-accordion-body");
            grupo.forEach(item => body.appendChild(renderGastosLinha(item, contexto)));
            acc.querySelector(".gastos-card-accordion-head").onclick = () => acc.classList.toggle("is-open");
            acc.classList.add("is-open");
            lista.appendChild(acc);
        });
    } else {
        itens.forEach(item => lista.appendChild(renderGastosLinha(item, contexto)));
    }
    if (!lista.children.length) lista.innerHTML = `<div class="lembrete-vazio">Sem lan\u00e7amentos para os filtros selecionados.</div>`;

    area.querySelector("#gastosMesAnterior").onclick = () => { setMesGastosAtivo(anoView, mes - 1); rerenderRotaAtual(); };
    area.querySelector("#gastosMesProximo").onclick = () => { setMesGastosAtivo(anoView, mes + 1); rerenderRotaAtual(); };
    area.querySelector("#gastosAnoFiltro").onchange = (e) => { anoSelect.value = e.target.value; gastosDetalhadosMesCursor = null; rerenderRotaAtual(); };
    area.querySelector("#gastosFiltroCartao").onchange = (e) => { filtrosGastosDetalhados.cartao = e.target.value; filtrosPorMes[mes] = e.target.value; rerenderRotaAtual(); };
    area.querySelector("#gastosFiltroTipo").onchange = (e) => { filtrosGastosDetalhados.tipo = e.target.value; rerenderRotaAtual(); };
    area.querySelector("#gastosFiltroStatus").onchange = (e) => { filtrosGastosDetalhados.status = e.target.value; rerenderRotaAtual(); };
    area.querySelector("#gastosBusca").oninput = (e) => {
        filtrosGastosDetalhados.busca = e.target.value;
        clearTimeout(gastosBuscaTimer);
        gastosBuscaTimer = setTimeout(rerenderRotaAtual, 220);
    };
    area.querySelector("#gastosBuscaClear")?.addEventListener("click", (event) => {
        event.preventDefault();
        filtrosGastosDetalhados.busca = "";
        const inputBusca = area.querySelector("#gastosBusca");
        if (inputBusca) inputBusca.value = "";
        rerenderRotaAtual();
    });
    area.querySelectorAll("[data-gastos-categoria]").forEach(btn => {
        btn.onclick = () => {
            const categoria = btn.dataset.gastosCategoria;
            filtrosGastosDetalhados.categoria = categoria === "todas" ? "todas" : getCategoriaResumoGasto(categoria);
            rerenderRotaAtual();
        };
    });
    area.querySelectorAll("[data-gastos-cartao]").forEach(btn => {
        btn.onclick = () => {
            const cartaoId = btn.dataset.gastosCartao;
            filtrosGastosDetalhados.cartao = String(filtrosGastosDetalhados.cartao) === String(cartaoId) ? "todos" : cartaoId;
            filtrosPorMes[mes] = filtrosGastosDetalhados.cartao;
            rerenderRotaAtual();
        };
    });
    area.querySelector("#gastosBtnCategorias")?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        abrirGerenciadorCategorias();
    });
    area.querySelector("#gastosBtnCartoes")?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        abrirGerenciadorCartoes();
    });
    area.querySelector("#gastosBtnFixas")?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        abrirModalModuloConfigHome("moduloContasFixas", "Configurar despesas fixas", renderContasFixas);
    });
    requestAnimationFrame(() => renderGraficoCategoriasResumoGastos(totaisCategoriasResumo));
}

const btnNovoLembreteHome = document.getElementById("btnNovoLembreteHome");
if (btnNovoLembreteHome) {
    btnNovoLembreteHome.onclick = (e) => {
        e.stopPropagation();
        if(window.resetEdicao) window.resetEdicao();
        document.getElementById("lemData").value = new Date().toLocaleDateString('en-CA');
        document.getElementById("modalLembrete").style.display = "flex";
    };
}

document.getElementById("btnSalvarParcelaCartao").onclick = async () => {
    const btnSalvar = document.getElementById("btnSalvarParcelaCartao");
    if (btnSalvar.disabled) return;
    const nome = document.getElementById("pcNome").value;
    const cartaoId = document.getElementById("pcCartao").value;
    const categoria = document.getElementById("pcCategoria").value;
    const total = parseValor(document.getElementById("pcValorTotal").value);
    const qtdInput = document.getElementById("pcQtd");
    const qtd = parseInt(qtdInput.value);

    // Comentario removido por encoding corrompido.
    if (!nome) return alert("Por favor, d? um nome para a parcela.");
    if (!cartaoId) return alert("Cadastre ou selecione um cartao.");
    if (total <= 0) return alert("O valor total deve ser maior que zero.");
    if (!qtd || qtd < 1) return alert("Preencha o n?mero de parcelas.");

    const pId = Date.now();
    const valP = Number((total / qtd).toFixed(2));
    let mesC = contextParcelaCartao.mes;
    let anoC = contextParcelaCartao.ano;
    const diaCompra = new Date().getDate();
    const parcelasAdicionadas = [];

    for(let i = 1; i <= qtd; i++) {
        if(!gastosDetalhes[anoC]) gastosDetalhes[anoC] = [];

        const parcela = {
            id: `${pId}-${i}`,
            criadoEm: pId + i,
            data: isoDataMes(anoC, mesC, diaCompra),
            mes: mesC,
            nome: `${nome} (${i}/${qtd})`,
            valor: valP,
            categoria: categoria,
            cartaoId: cartaoId,
            parcelaId: pId,
            checked: true
        };
        gastosDetalhes[anoC].push(parcela);
        parcelasAdicionadas.push({ ano: String(anoC), parcela });

        mesC++;
        if(mesC > 11) { mesC = 0; anoC++; }
    }

    btnSalvar.disabled = true;
    btnSalvar.innerText = "Salvando...";
    const salvou = await salvarERenderizarGastos(contextParcelaCartao.ano);
    if (!salvou) {
        parcelasAdicionadas.forEach(({ ano, parcela }) => {
            gastosDetalhes[ano] = (gastosDetalhes[ano] || []).filter(item => item !== parcela);
        });
        btnSalvar.disabled = false;
        btnSalvar.innerText = "Salvar Parcelas";
        alert("Não foi possível salvar o parcelamento. Tente novamente.");
        return;
    }

    document.getElementById("modalParcelaCartao").style.display = "none";
    btnSalvar.disabled = false;
    btnSalvar.innerText = "Salvar Parcelas";
};

// Comentario removido por encoding corrompido.
window.abrirModalParcelamento = (mes, ano) => {
    // Comentario removido por encoding corrompido.
    contextParcelaCartao = { mes: parseInt(mes), ano: parseInt(ano) };

    const selCard = document.getElementById("pcCartao");
    const selCat = document.getElementById("pcCategoria");
    const inQtd = document.getElementById("pcQtd");
    const inNome = document.getElementById("pcNome");
    const inValor = document.getElementById("pcValorTotal");
    const modal = document.getElementById("modalParcelaCartao");
    if (!modal || !selCard || !selCat) {
        console.error("Modal de parcelamento não está disponível no DOM.");
        alert("Não foi possível abrir o parcelamento. Recarregue a página e tente novamente.");
        return;
    }
    if (!cartoes.length) {
        alert("Cadastre um cartao antes de criar um parcelamento.");
        abrirGerenciadorCartoes();
        return;
    }

    // 1. Limpa os campos para o placeholder aparecer
    if(inQtd) inQtd.value = "";
    if(inNome) inNome.value = "";
    if(inValor) inValor.value = "";

    // Comentario removido por encoding corrompido.
    selCard.innerHTML = cartoes.map(c => `<option value="${c.id}">${c.nome}</option>`).join('');
    selCat.innerHTML = categorias.map(c => `<option value="${c.name}">${c.name}</option>`).join('');

    // Comentario removido por encoding corrompido.
    const atualizarCores = () => {
        const corCard = cartoes.find(c => String(c.id) === String(selCard.value))?.color || "transparent";
        const corCat = categorias.find(c => c.name === selCat.value)?.color || "transparent";
        selCard.style.borderLeft = `5px solid ${corCard}`;
        selCat.style.borderLeft = `5px solid ${corCat}`;
    };

    selCard.onchange = atualizarCores;
    selCat.onchange = atualizarCores;
    atualizarCores(); // Define a cor inicial

    // 4. Abre o modal
    modal.classList.add("modal-appshell");
    modal.style.display = "flex";
};

function renderPizza(mesIdx, gastos) {
    const div = document.querySelector(`#chart-pizza-${mesIdx}`); if (!div || gastos.length === 0) return;
    const tColor = getComputedStyle(document.body).getPropertyValue('--P02').trim() || '#000000';
    const res = {}; gastos.forEach(g => res[g.categoria] = (res[g.categoria] || 0) + g.valor);
    const options = { series: Object.values(res), labels: Object.keys(res), chart: { type: 'donut', height: 220, background: 'transparent' }, colors: Object.keys(res).map(n => (categorias.find(c => c.name === n)?.color || "#888")), legend: { position: 'bottom', labels: { colors: tColor } }, plotOptions: { pie: { donut: { labels: { show: true, name: { color: tColor }, value: { color: tColor } } } } } };
    div.innerHTML = ""; new ApexCharts(div, options).render();
}

// Comentario removido por encoding corrompido.
let lembreteEditandoId = null;

// Comentario removido por encoding corrompido.
window.resetEdicao = () => {
    resetCamposLembrete();
};

// Comentario removido por encoding corrompido.
window.editarLembrete = (l) => {
    const lembreteAtual = lembretes.find(item => String(item.id) === String(l?.id)) || l;
    if (!lembreteAtual?.id) return;
    lembreteEditandoId = String(lembreteAtual.id);

    const modal = document.getElementById("modalLembrete");
    if (!modal) return;

    modal.style.display = "flex";
    modal.querySelector("h3").textContent = "Editar Lembrete";

    // Preenche os campos
    document.getElementById("lemTitulo").value = lembreteAtual.nome;
    document.getElementById("lemData").value = lembreteAtual.data;
    document.getElementById("lemHora").value = lembreteAtual.hora || "";
    document.getElementById("lemValor").value = lembreteAtual.valor || "";
    document.getElementById("lemAnotacoes").value = lembreteAtual.anotacoes || "";
    subtarefasModal = Array.isArray(lembreteAtual.subtarefas) ? structuredClone(lembreteAtual.subtarefas) : [];
    popularCategoriasLembreteSelect("lemCategoria", lembreteAtual.categoriaId);
    renderSubtarefasModal();
    const recorrencia = normalizarRecorrenciaLembrete(lembreteAtual);
    document.getElementById("lemRecorrente").checked = recorrencia.recorrente;
    const radioTipo = document.querySelector(`input[name="lemRecorrenciaTipo"][value="${recorrencia.recorrenciaTipo}"]`);
    if (radioTipo) radioTipo.checked = true;
    const intervalo = document.getElementById("lemIntervaloDias");
    if (intervalo) intervalo.value = recorrencia.intervaloDias || 7;

    const divDias = document.getElementById("escolhaDiasSemana");
    atualizarUiRecorrenciaModal();

    // Marca os dias da semana
    divDias.querySelectorAll("input").forEach(input => {
        input.checked = recorrencia.diasSemana ? recorrencia.diasSemana.includes(parseInt(input.value)) : false;
    });

    // Comentario removido por encoding corrompido.
    const btnSalvar = document.getElementById("btnSalvarLembrete");
    if (btnSalvar) btnSalvar.innerText = "Atualizar Lembrete";
};

function renderContasFixas() {
    const renderTabela = (containerId, tipoFiltro) => {
        const container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = `
            <table class="tabela-gastos">
              <thead>
                <tr>
                  <th style="width: 1%;"></th>
                  <th style="width: 1%;">ok</th>
                  <th>Nome</th>
                  <th style="width: 100px;">Dia</th>
                  <th style="width: 120px;">Valor</th>
                  <th style="width: 150px;">Categoria</th>
                  <th style="width: 150px;">Cartão</th>
                  <th style="width: 1%;"></th>
                </tr>
              </thead>
              <tbody class="tbody-fixo" data-tipo="${tipoFiltro}"></tbody>
            </table>
        `;

        const tbody = container.querySelector("tbody");
        const itensFiltrados = contasFixas.filter(cf => (cf.tipo || 'fixa') === tipoFiltro);

        itensFiltrados.forEach((cf) => {
            const tr = document.createElement("tr");
            const catCor = categorias.find(c => c.name === cf.categoria)?.color || "transparent";
            const cardCor = cartoes.find(c => String(c.id) === String(cf.cartaoId))?.color || "transparent";

            tr.innerHTML = `
                <td></td>
                <td><input type="checkbox" ${cf.ativo ? 'checked' : ''} class="check-fixo"></td>
                <td><input type="text" class="input-tabela-edit nome" value="${cf.nome}"></td>
                <td><input type="number" class="input-tabela-edit dia" value="${cf.dia || 1}"></td>
                <td><input type="text" class="input-tabela-edit valor" value="${formatar(cf.valor)}"></td>
                <td>
                    <select class="input-tabela-edit cat" style="border-left: 5px solid ${catCor}">
                        ${categorias.map(c => `<option value="${c.name}" ${cf.categoria === c.name ? 'selected' : ''}>${c.name}</option>`).join('')}
                    </select>
                </td>
                <td>
                    <select class="input-tabela-edit card" style="border-left: 5px solid ${cardCor}">
                        <option value="">Sem cartão</option>
                        ${cartoes.map(c => `<option value="${c.id}" ${String(cf.cartaoId) === String(c.id) ? 'selected' : ''}>${c.nome}</option>`).join('')}
                    </select>
                </td>
                <td><button class="removeItem">${materialIcon("close")}</button></td>
            `;

            // Comentario removido por encoding corrompido.

            // Nome
            const inNome = tr.querySelector(".nome");
            inNome.onblur = (e) => {
                if (cf.nome !== e.target.value) {
                    congelarHistoricoFixas();
                    cf.nome = e.target.value;
                    salvarDadosLocal();
                    carregarAno();
                }
            };
            inNome.onkeydown = (ev) => { if(ev.key === "Enter") inNome.blur(); };

            // Dia
            const inDia = tr.querySelector(".dia");
            inDia.onblur = (e) => {
                const nDia = parseInt(e.target.value) || 1;
                if (cf.dia !== nDia) {
                    congelarHistoricoFixas();
                    cf.dia = nDia;
                    salvarDadosLocal();
                    carregarAno();
                }
            };
            inDia.onkeydown = (ev) => { if(ev.key === "Enter") inDia.blur(); };

            // Valor (Input Financeiro)
            const inValor = tr.querySelector(".valor");
            inValor.onfocus = () => {
                inValor.dataset.old = inValor.value;
                inValor.value = "";
            };
            inValor.onblur = (e) => {
                const txt = e.target.value.trim();
                if (txt === "") {
                    inValor.value = inValor.dataset.old;
                } else {
                    const nVal = parseValor(txt);
                    if (cf.valor !== nVal) {
                        congelarHistoricoFixas();
                        cf.valor = nVal;
                        salvarDadosLocal();
                        carregarAno();
                    }
                }
                // Comentario removido por encoding corrompido.
                inValor.value = formatar(cf.valor);
            };
            inValor.onkeydown = (ev) => { if(ev.key === "Enter") inValor.blur(); };

            // Checkbox Ativo
            tr.querySelector(".check-fixo").onchange = (e) => {
                congelarHistoricoFixas();
                cf.ativo = e.target.checked;
                salvarDadosLocal();
                carregarAno();
            };

            // Comentario removido por encoding corrompido.
            tr.querySelector(".cat").onchange = (e) => {
                cf.categoria = e.target.value;
                tr.querySelector(".cat").style.borderLeft = `5px solid ${categorias.find(c => c.name === e.target.value)?.color || "transparent"}`;
                salvarDadosLocal();
                carregarAno();
            };

            tr.querySelector(".card").onchange = (e) => {
                congelarHistoricoFixas();
                cf.cartaoId = e.target.value;
                const cor = cartoes.find(c => String(c.id) === String(e.target.value))?.color || "transparent";
                tr.querySelector(".card").style.borderLeft = `5px solid ${cor}`;
                salvarDadosLocal();
                carregarAno();
            };

            // Remover
            tr.querySelector(".removeItem").onclick = () => {
                if (confirm("Remover dos meses futuros?")) {
                    congelarHistoricoFixas();
                    contasFixas = contasFixas.filter(item => item.id !== cf.id);
                    renderContasFixas();
                    carregarAno();
                }
            };

            tbody.appendChild(tr);
        });
    };

    renderTabela("listaContasFixas", "fixa");
    renderTabela("listaAssinaturasFixas", "assinatura");
}

function renderReceitasFixas() {
  const container = document.getElementById("listaReceitasFixas");
  if (!container) return;

  const iS = document.getElementById("salarioFixoBase");
  iS.value = formatar(salarioFixoBase);
  aplicarComportamentoInput(iS, () => salarioFixoBase, (v) => { salarioFixoBase = v; atualizarTudo(document.getElementById("ano").value); });

  container.innerHTML = `
    <table class="tabela-gastos">
      <thead>
        <tr>
          <th style="width: 1%;">ok</th>
          <th>Origem da Renda</th>
          <th style="width: 80px;">Dia</th>
          <th style="width: 120px; text-align:right;">Valor</th>
          <th style="width: 1%;"></th>
        </tr>
      </thead>
      <tbody id="tbodyReceitasFixas"></tbody>
    </table>
  `;

  const tbody = document.getElementById("tbodyReceitasFixas");

  receitasFixas.forEach((rf) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="checkbox" ${rf.ativo?'checked':''} class="check-rf"></td>
      <td><input type="text" class="input-tabela-edit" value="${rf.nome}" placeholder="Ex: Aluguel, Extra..."></td>
      <td><input type="number" class="input-tabela-edit" value="${rf.dia||1}" min="1" max="31"></td>
      <td><input type="text" class="input-tabela-edit" value="${formatar(rf.valor)}" style="text-align:right;"></td>
      <td><button class="removeItem">${materialIcon("close")}</button></td>
    `;

    const [tdCheck, tdNome, tdDia, tdVal, tdBtn] = tr.children;

    tdCheck.querySelector("input").onchange = (e) => { rf.ativo = e.target.checked; salvarDadosLocal(); atualizarTudo(document.getElementById("ano").value); };
    tdNome.querySelector("input").onblur = (e) => { rf.nome = e.target.value; salvarDadosLocal(); carregarAno(); };
    tdDia.querySelector("input").onblur = (e) => { rf.dia = parseInt(e.target.value) || 1; salvarDadosLocal(); };

    aplicarComportamentoInput(tdVal.querySelector("input"), () => rf.valor, (v) => { rf.valor = v; atualizarTudo(document.getElementById("ano").value); });

    tdBtn.querySelector("button").onclick = () => {
        receitasFixas = receitasFixas.filter(r => r.id !== rf.id);
        renderReceitasFixas();
        salvarDadosLocal();
        carregarAno();
    };
    tbody.appendChild(tr);
  });
}

async function persistirCoresCategorias() {
    salvarDadosLocal();
    await salvarFirebase();
    renderLembretesHome();
    renderHomeFinanceCards();
    if (window.location.hash === "#gastos") {
        renderPaginaGastos();
        sincronizarRotaNoAppShell("#gastos");
    } else if (window.location.hash === "#calendario") {
        await rerenderCalendarioNoShell();
    }
}

function renderCategoriasModal() {
    const lista = document.getElementById("listaCategoriasModal"); if(!lista) return; lista.innerHTML = "";
    categorias.forEach((cat, index) => {
      const li = document.createElement("li"); li.style.display = "flex"; li.style.gap = "10px"; li.style.padding = "8px 0"; li.style.alignItems = "center";
      li.innerHTML = `<input type="color" class="seletor-cor-quadrado" value="${cat.color}" style="width:30px; height:30px;"><input type="text" class="inputPadrao cat-name-edit" value="${cat.name}" style="flex:2"><button class="removeItem" style="width:22px;height:22px">${materialIcon("close")}</button>`;
      const [col, nam, btR] = li.children;
      col.onchange = async (e) => { categorias[index].color = e.target.value; await persistirCoresCategorias(); }; nam.onblur = (e) => { categorias[index].name = e.target.value; salvarDadosLocal(); };
      nam.onkeydown = (e) => { if(e.key === 'Enter') nam.blur(); }; btR.onclick = () => { categorias.splice(index, 1); renderCategoriasModal(); salvarDadosLocal(); }; lista.appendChild(li);
    });
}

document.getElementById("btnAddCategoria").onclick = () => {
    const n = document.getElementById("novaCategoriaNome").value;
    const c = document.getElementById("novaCategoriaCor").value; if(!n) return alert("Erro");
    categorias.push({name: n, color: c}); document.getElementById("novaCategoriaNome").value = ""; renderCategoriasModal(); salvarDadosLocal();
};

function renderCartoesModal() {
    const lista = document.getElementById("listaCartoesModal");
    if(!lista) return;
    lista.innerHTML = "";

    cartoes.forEach((c, index) => {
        const div = document.createElement("div");
        div.className = "item";
        div.style.marginBottom = "10px";
        div.style.display = "flex";
        div.style.gap = "5px";

        div.innerHTML = `
            <input type="color" class="seletor-cor-quadrado" value="${c.color || '#D78341'}" style="width:40px; height:40px; padding:0; border:none;">
            <input type="text" class="inputPadrao" value="${escapeHtml(c.nome || "")}" style="flex:1;">
            <select class="inputPadrao" style="width:100px">
                <option value="Crédito" ${c.tipo === "Crédito" ? "selected" : ""}>Crédito</option>
                <option value="Débito" ${c.tipo === "Débito" ? "selected" : ""}>Débito</option>
            </select>
            <div class="campo" style="width:100px">
                <small style="font-size:9px; opacity:0.7">Fech.</small>
                <input type="number" class="inputPadrao input-fechamento" value="${c.fechamento || 1}" title="Dia de Fechamento" min="1" max="31">
            </div>
            <div class="campo" style="width:100px">
                <small style="font-size:9px; opacity:0.7">Venc.</small>
                <input type="number" class="inputPadrao input-vencimento" value="${c.vencimento}" title="Dia de Vencimento" min="1" max="31">
            </div>
            <button class="removeItem">${materialIcon("close")}</button>`;

        const iCol = div.querySelector('input[type="color"]');
        const iN = div.querySelector('input[type="text"]');
        const sT = div.querySelector('select');
        const iFech = div.querySelector('.input-fechamento');
        const iVenc = div.querySelector('.input-vencimento');
        const bR = div.querySelector('.removeItem');

        iCol.onchange = (e) => { cartoes[index].color = e.target.value; salvarDadosLocal(); };
        iN.onblur = (e) => { cartoes[index].nome = e.target.value; salvarDadosLocal(); };
        sT.onchange = (e) => { cartoes[index].tipo = e.target.value; salvarDadosLocal(); };

        // Novo: Salva o dia de fechamento
        iFech.onblur = (e) => { cartoes[index].fechamento = parseInt(e.target.value) || 1; salvarDadosLocal(); };

        iVenc.onblur = (e) => { cartoes[index].vencimento = parseInt(e.target.value) || 1; salvarDadosLocal(); };
        bR.onclick = () => { cartoes.splice(index, 1); renderCartoesModal(); salvarDadosLocal(); };

        lista.appendChild(div);
    });
}

let configHubTabAtiva = "conta";

function renderConfiguracoesHub(tab = configHubTabAtiva) {
    const panel = document.getElementById("configHubPanel");
    if (!panel) return;
    normalizarDadosApp();
    configHubTabAtiva = tab;
    document.querySelectorAll(".config-hub-tab").forEach(btn => btn.classList.toggle("active", btn.dataset.configTab === tab));
    const acoesDadosGlobais = document.getElementById("acoesDadosGlobais");
    if (acoesDadosGlobais) acoesDadosGlobais.style.display = window.location.hash === "#configuracoes" ? "none" : "";

    const renderCampo = (label, html, extra = "") => `<div class="campo ${extra}"><label>${label}</label>${html}</div>`;
    const renderAcoes = (html) => `<div class="config-actions">${html}</div>`;

    if (tab === "conta") {
        panel.innerHTML = `
            <h2 class="config-section-title">Conta</h2>
            <div class="config-grid">
                ${renderCampo("Nome de exibição", `<input id="hubNomeUsuario" class="inputPadrao" value="${escapeHtml(configuracoes.nomeUsuario || "")}">`)}
                ${renderCampo("Email", `<input class="inputPadrao input-readonly" value="${escapeHtml(usuarioLogado?.email || "")}" disabled>`)}
                ${renderCampo("Dia de virada do mês", `<input type="number" id="hubDiaVirada" class="inputPadrao" value="${configuracoes.diaVirada || 1}" min="1" max="31">`)}
                ${renderCampo("Referência de mês", `
                    <div style="display:flex; gap:15px; margin-top:7px;">
                        <label><input type="radio" name="hubRefMes" value="atual" ${configuracoes.referenciaMes !== "proximo" ? "checked" : ""}> Mês atual</label>
                        <label><input type="radio" name="hubRefMes" value="proximo" ${configuracoes.referenciaMes === "proximo" ? "checked" : ""}> Próximo mês</label>
                    </div>
                `)}
                <div class="config-full"><hr style="border:0; border-top:1px solid rgba(255,255,255,0.12);"></div>
                ${renderCampo("Senha antiga", `<input type="password" id="hubSenhaAntiga" class="inputPadrao">`)}
                ${renderCampo("Nova senha", `<input type="password" id="hubSenhaNova" class="inputPadrao">`)}
            </div>
            ${renderAcoes(`
                <button class="btn" id="hubSalvarConta">Salvar conta</button>
                <button class="btn" id="hubAtualizarSenha">Atualizar senha</button>
            `)}
        `;
        panel.querySelector("#hubSalvarConta").onclick = async () => {
            congelarHistoricoFixas();
            configuracoes.nomeUsuario = panel.querySelector("#hubNomeUsuario").value;
            configuracoes.diaVirada = parseInt(panel.querySelector("#hubDiaVirada").value) || 1;
            configuracoes.referenciaMes = panel.querySelector("input[name='hubRefMes']:checked")?.value || "atual";
            atualizarTituloSite();
            await salvarFirebase();
            carregarAno();
            renderPaginaGastos();
        };
        panel.querySelector("#hubAtualizarSenha").onclick = async () => {
            const ok = await alterarSenhaUsuario(panel.querySelector("#hubSenhaAntiga").value, panel.querySelector("#hubSenhaNova").value);
            if (ok) {
                panel.querySelector("#hubSenhaAntiga").value = "";
                panel.querySelector("#hubSenhaNova").value = "";
            }
        };
    } else if (tab === "salario") {
        panel.innerHTML = `
            <h2 class="config-section-title">Salário e rendas</h2>
            <div class="config-grid">
                ${renderCampo("Salário base", `<input type="text" id="hubSalarioBase" class="inputPadrao" value="${formatar(salarioFixoBase || 0)}">`)}
                ${renderCampo("Dia de pagamento", `<input type="number" id="hubDiaSalario" class="inputPadrao" value="${configuracoes.diaSalario || 5}" min="1" max="31">`)}
                ${renderCampo("Tipo de cálculo do dia", `
                    <div style="display:flex; gap:15px; margin-top:7px;">
                        <label><input type="radio" name="hubTipoDiaSalario" value="util" ${configuracoes.tipoDiaSalario !== "corrido" ? "checked" : ""}> Dia útil</label>
                        <label><input type="radio" name="hubTipoDiaSalario" value="corrido" ${configuracoes.tipoDiaSalario === "corrido" ? "checked" : ""}> Dia corrido</label>
                    </div>
                `, "config-full")}
            </div>
            <h3 style="margin-top:22px;">Rendas fixas</h3>
            <div class="config-list" id="hubListaRendas"></div>
            ${renderAcoes(`
                <button class="btn" id="hubAddRenda">+ Nova renda</button>
                <button class="btn" id="hubSalvarSalario">Salvar salário</button>
            `)}
        `;
        const lista = panel.querySelector("#hubListaRendas");
        receitasFixas.forEach((rf, index) => {
            const row = document.createElement("div");
            row.className = "config-row renda-row";
            row.innerHTML = `
                <input type="checkbox" class="hub-renda-ativo" ${rf.ativo ? "checked" : ""}>
                <input type="text" class="inputPadrao hub-renda-nome" value="${escapeHtml(rf.nome)}" placeholder="Nome da renda">
                <input type="number" class="inputPadrao hub-renda-dia" value="${rf.dia || 1}" min="1" max="31">
                <input type="text" class="inputPadrao hub-renda-valor" value="${formatar(rf.valor)}">
                <button class="removeItem hub-renda-del">${materialIcon("close")}</button>
            `;
            row.querySelector(".hub-renda-nome").onblur = (e) => { receitasFixas[index].nome = e.target.value; salvarDadosLocal(); };
            row.querySelector(".hub-renda-dia").onblur = (e) => { receitasFixas[index].dia = parseInt(e.target.value) || 1; salvarDadosLocal(); };
            row.querySelector(".hub-renda-ativo").onchange = (e) => { receitasFixas[index].ativo = e.target.checked; salvarDadosLocal(); };
            aplicarComportamentoInput(row.querySelector(".hub-renda-valor"), () => receitasFixas[index].valor, (v) => { receitasFixas[index].valor = v; salvarDadosLocal(); });
            row.querySelector(".hub-renda-del").onclick = () => {
                receitasFixas.splice(index, 1);
                salvarDadosLocal();
                renderConfiguracoesHub("salario");
                carregarAno();
            };
            lista.appendChild(row);
        });
        aplicarComportamentoInput(panel.querySelector("#hubSalarioBase"), () => salarioFixoBase, (v) => { salarioFixoBase = v; atualizarTudo(document.getElementById("ano")?.value || hoje.getFullYear()); });
        panel.querySelector("#hubAddRenda").onclick = () => {
            congelarHistoricoFixas();
            receitasFixas.push({ id: "r" + Date.now(), nome: "Nova Renda Extra", valor: 0, dia: 1, ativo: true });
            salvarDadosLocal();
            renderConfiguracoesHub("salario");
        };
        panel.querySelector("#hubSalvarSalario").onclick = async () => {
            congelarHistoricoFixas();
            configuracoes.diaSalario = parseInt(panel.querySelector("#hubDiaSalario").value) || 5;
            configuracoes.tipoDiaSalario = panel.querySelector("input[name='hubTipoDiaSalario']:checked")?.value || "util";
            await salvarFirebase();
            carregarAno();
            renderLembretesHome();
            if (window.location.hash === "#calendario") rerenderCalendarioNoShell();
        };
    } else if (tab === "cartoes") {
        panel.innerHTML = `
            <h2 class="config-section-title">Cartões</h2>
            <div class="config-list" id="hubListaCartoes"></div>
            ${renderAcoes(`<button class="btn" id="hubAddCartao">+ Adicionar cartão</button><button class="btn" id="hubSalvarCartoes">Salvar cartões</button>`)}
        `;
        const lista = panel.querySelector("#hubListaCartoes");
        cartoes.forEach((cartao, index) => {
            const row = document.createElement("div");
            row.className = "config-row";
            row.innerHTML = `
                <input type="color" class="seletor-cor-quadrado hub-card-cor" value="${cartao.color || "#D78341"}">
                <input type="text" class="inputPadrao hub-card-nome" value="${escapeHtml(cartao.nome)}">
                <select class="inputPadrao hub-card-tipo">
                    <option value="Crédito" ${cartao.tipo === "Crédito" ? "selected" : ""}>Crédito</option>
                    <option value="Débito" ${cartao.tipo === "Débito" ? "selected" : ""}>Débito</option>
                </select>
                <input type="number" class="inputPadrao hub-card-fech" value="${cartao.fechamento || 1}" min="1" max="31" title="Fechamento">
                <input type="number" class="inputPadrao hub-card-venc" value="${cartao.vencimento || 10}" min="1" max="31" title="Vencimento">
                <button class="removeItem hub-card-del">${materialIcon("close")}</button>
            `;
            row.querySelector(".hub-card-cor").onchange = (e) => { cartoes[index].color = e.target.value; salvarDadosLocal(); };
            row.querySelector(".hub-card-nome").onblur = (e) => { cartoes[index].nome = e.target.value; salvarDadosLocal(); };
            row.querySelector(".hub-card-tipo").onchange = (e) => { cartoes[index].tipo = e.target.value; salvarDadosLocal(); };
            row.querySelector(".hub-card-fech").onblur = (e) => { cartoes[index].fechamento = parseInt(e.target.value) || 1; salvarDadosLocal(); };
            row.querySelector(".hub-card-venc").onblur = (e) => { cartoes[index].vencimento = parseInt(e.target.value) || 1; salvarDadosLocal(); };
            row.querySelector(".hub-card-del").onclick = () => {
                cartoes.splice(index, 1);
                salvarDadosLocal();
                renderConfiguracoesHub("cartoes");
            };
            lista.appendChild(row);
        });
        panel.querySelector("#hubAddCartao").onclick = () => {
            cartoes.push({ id: Date.now(), nome: "Novo Cartão", tipo: "Crédito", fechamento: 1, vencimento: 10, color: "#D78341" });
            salvarDadosLocal();
            renderConfiguracoesHub("cartoes");
        };
        panel.querySelector("#hubSalvarCartoes").onclick = async () => {
            await salvarFirebase();
            carregarAno();
            renderPaginaGastos();
            renderLembretesHome();
        };
    } else if (tab === "categorias") {
        panel.innerHTML = `
            <h2 class="config-section-title">Categorias</h2>
            <h3>Financeiras</h3>
            <div class="config-list" id="hubCategoriasFinanceiras"></div>
            ${renderAcoes(`<input type="text" id="hubNovaCatFinNome" class="inputPadrao" placeholder="Nova categoria"><input type="color" id="hubNovaCatFinCor" class="seletor-cor-quadrado" value="#D78341"><button class="btn" id="hubAddCatFin">Adicionar</button>`)}
        `;
        const listaFin = panel.querySelector("#hubCategoriasFinanceiras");
        categorias.forEach((cat, index) => {
            const row = document.createElement("div");
            row.className = "config-row categoria-row";
            row.innerHTML = `<input type="color" class="seletor-cor-quadrado hub-cat-cor" value="${cat.color || "#D78341"}"><input type="text" class="inputPadrao hub-cat-nome" value="${escapeHtml(cat.name)}"><button class="removeItem hub-cat-del">${materialIcon("close")}</button>`;
            row.querySelector(".hub-cat-cor").onchange = async (e) => { categorias[index].color = e.target.value; await persistirCoresCategorias(); };
            row.querySelector(".hub-cat-nome").onblur = (e) => { categorias[index].name = e.target.value; salvarDadosLocal(); };
            row.querySelector(".hub-cat-del").onclick = () => {
                if (categorias.length <= 1) return alert("Mantenha pelo menos uma categoria financeira.");
                if (categoriaFinanceiraEmUso(cat.name) && !confirm("Essa categoria está em uso. Deseja excluir mesmo assim e mover os itens para a categoria padrão?")) return;
                categorias.splice(index, 1);
                salvarDadosLocal();
                renderConfiguracoesHub("categorias");
            };
            listaFin.appendChild(row);
        });
        panel.querySelector("#hubAddCatFin").onclick = () => {
            const nome = panel.querySelector("#hubNovaCatFinNome").value.trim();
            if (!nome) return;
            categorias.push({ name: nome, color: panel.querySelector("#hubNovaCatFinCor").value || "#D78341" });
            salvarDadosLocal();
            renderConfiguracoesHub("categorias");
        };
    } else if (tab === "calendario") {
        panel.innerHTML = `
            <h2 class="config-section-title">Calendário e lembretes</h2>
            <p class="config-hint">As exibições salvas controlam quais itens aparecem no calendário.</p>
            <h3>Exibições salvas</h3>
            <div class="config-list config-exibicoes-list">
                ${(configuracoes.viewsCalendario || []).map(view => `
                    <div class="config-view-row ${String(view.id) === String(configuracoes.viewCalendarioAtiva) ? "active" : ""}">
                        <button class="config-view-select" data-hub-cal-view="${view.id}">${escapeHtml(normalizarNomeExibicao(view.nome))}${String(view.id) === String(configuracoes.viewCalendarioAtiva) ? " • ativa" : ""}</button>
                        <button class="btn-mini-gerenciar" data-hub-edit-view="${view.id}" title="Editar exibição">${materialIcon("settings")}</button>
                    </div>
                `).join("")}
            </div>
            ${renderAcoes(`
                <button class="btn" id="hubNovaViewCalendario">Nova exibição</button>
                <button class="btn" id="hubConfigHome">Configurar lembretes da home</button>
            `)}
            <h3 style="margin-top:26px;">Categorias de lembrete</h3>
            <div class="config-list" id="hubCategoriasLembretes"></div>
            ${renderAcoes(`<input type="text" id="hubNovaCatLemNome" class="inputPadrao" placeholder="Nova categoria"><input type="color" id="hubNovaCatLemCor" class="seletor-cor-quadrado" value="#D78341"><button class="btn" id="hubAddCatLem">Adicionar</button>`)}
        `;
        panel.querySelectorAll("[data-hub-cal-view]").forEach(btn => {
            btn.onclick = async () => {
                await selecionarViewCalendario(btn.dataset.hubCalView);
                renderConfiguracoesHub("calendario");
            };
        });
        panel.querySelectorAll("[data-hub-edit-view]").forEach(btn => {
            btn.onclick = async () => {
                configuracoes.viewCalendarioAtiva = String(btn.dataset.hubEditView);
                await salvarFirebase();
                abrirModalExibicao("calendario", "editar");
                renderConfiguracoesHub("calendario");
            };
        });
        panel.querySelector("#hubNovaViewCalendario").onclick = () => abrirModalExibicao("calendario", "criar");
        panel.querySelector("#hubConfigHome").onclick = () => abrirModalExibicao("home");
        const listaLem = panel.querySelector("#hubCategoriasLembretes");
        categoriasLembretes.forEach((cat, index) => {
            const row = document.createElement("div");
            row.className = "config-row categoria-row";
            row.innerHTML = `<input type="color" class="seletor-cor-quadrado hub-cat-lem-cor" value="${cat.cor || "#D78341"}"><input type="text" class="inputPadrao hub-cat-lem-nome" value="${escapeHtml(cat.nome)}"><button class="removeItem hub-cat-lem-del">${materialIcon("close")}</button>`;
            row.querySelector(".hub-cat-lem-cor").onchange = async (e) => { categoriasLembretes[index].cor = e.target.value; await persistirCoresCategorias(); };
            row.querySelector(".hub-cat-lem-nome").onblur = (e) => { categoriasLembretes[index].nome = e.target.value; salvarDadosLocal(); };
            row.querySelector(".hub-cat-lem-del").onclick = () => {
                if (categoriasLembretes.length <= 1) return alert("Mantenha pelo menos uma categoria de lembrete.");
                if (!confirm(`Excluir a categoria "${cat.nome}"? Os lembretes dela serão movidos para a primeira categoria disponível.`)) return;
                const fallback = categoriasLembretes.find(item => String(item.id) !== String(cat.id)) || categoriasLembretes[0];
                categoriasLembretes = categoriasLembretes.filter(item => String(item.id) !== String(cat.id));
                lembretes.forEach(lembrete => { if (String(lembrete.categoriaId) === String(cat.id)) lembrete.categoriaId = fallback.id; });
                salvarDadosLocal();
                renderConfiguracoesHub("calendario");
                renderLembretesHome();
            };
            listaLem.appendChild(row);
        });
        panel.querySelector("#hubAddCatLem").onclick = () => {
            const nome = panel.querySelector("#hubNovaCatLemNome").value.trim();
            if (!nome) return;
            categoriasLembretes.push({ id: `lem-${Date.now()}`, nome, cor: panel.querySelector("#hubNovaCatLemCor").value || "#D78341" });
            salvarDadosLocal();
            renderConfiguracoesHub("calendario");
        };
    } else if (tab === "aparencia") {
        panel.innerHTML = `
            <h2 class="config-section-title">Aparência</h2>
            <div class="config-grid">
                ${renderCampo("Tema", `
                    <select id="hubTema" class="inputPadrao">
                        <option value="planetario" ${configuracoes.tema === "planetario" ? "selected" : ""}>Planetário</option>
                        <option value="noite" ${configuracoes.tema === "noite" ? "selected" : ""}>Noite</option>
                        <option value="natureza" ${configuracoes.tema === "natureza" ? "selected" : ""}>Calmaria</option>
                        <option value="doce" ${configuracoes.tema === "doce" ? "selected" : ""}>Algodão doce</option>
                        <option value="amanhecer" ${configuracoes.tema === "amanhecer" ? "selected" : ""}>Amanhecer</option>
                        <option value="grayscale" ${configuracoes.tema === "grayscale" ? "selected" : ""}>Cinza</option>
                    </select>
                `)}
            </div>
            ${renderAcoes(`<button class="btn" id="hubSalvarAparencia">Salvar aparência</button>`)}
        `;
        panel.querySelector("#hubTema").onchange = () => {
            configuracoes.tema = panel.querySelector("#hubTema").value;
            aplicarTema(configuracoes.tema);
            const seletorTemaFooter = document.getElementById("cfgTemaFooter");
            if (seletorTemaFooter) seletorTemaFooter.value = configuracoes.tema;
            salvarDadosLocal();
        };
        panel.querySelector("#hubSalvarAparencia").onclick = async () => {
            configuracoes.tema = panel.querySelector("#hubTema").value;
            aplicarTema(configuracoes.tema);
            const seletorTemaFooter = document.getElementById("cfgTemaFooter");
            if (seletorTemaFooter) seletorTemaFooter.value = configuracoes.tema;
            await salvarFirebase();
        };
    } else if (tab === "dados") {
        panel.innerHTML = `
            <h2 class="config-section-title">Dados</h2>
            <div class="config-grid">
                ${renderCampo("Versão atual", `<input class="inputPadrao input-readonly" value="${VERSAO_ATUAL_APP}" disabled>`)}
                ${renderCampo("Notas da versão", `<button class="btn" id="hubAbrirNotas">Abrir notas</button>`)}
                <p class="config-hint config-full">Exportação e importação usam o mesmo JSON completo do aplicativo.</p>
            </div>
            ${renderAcoes(`
                <button class="btn" id="hubExportarDados">Exportar dados</button>
                <button class="btn" id="hubImportarDados">Importar dados</button>
            `)}
        `;
        panel.querySelector("#hubAbrirNotas").onclick = () => window.location.hash = "#notas";
        panel.querySelector("#hubExportarDados").onclick = () => document.getElementById("exportarTudoBtn")?.click();
        panel.querySelector("#hubImportarDados").onclick = () => document.getElementById("inputImport")?.click();
    }
}

function setAppCarregando(ativo) {
    const loading = document.getElementById("appLoadingScreen");
    document.body.classList.toggle("app-loading-active", Boolean(ativo));
    if (!loading) return;
    loading.classList.toggle("is-hidden", !ativo);
    loading.setAttribute("aria-hidden", String(!ativo));
}

inicializarPwa();

onAuthStateChanged(auth, async (user) => {
if (user) {
    usuarioLogado = user;
    document.getElementById("displayEmail").textContent = user.email;
    const displayEmailHome = document.getElementById("displayEmailHome");
    if (displayEmailHome) displayEmailHome.textContent = user.email;

    // Comentario removido por encoding corrompido.
    if (!senhaDoUsuario) {
        senhaDoUsuario = sessionStorage.getItem("temp_key") || "";
    }

    const snap = await getDoc(doc(db, "financas", user.uid));
    if (snap.exists()) {
        try {
            // Comentario removido por encoding corrompido.
            if (!senhaDoUsuario) throw new Error("Senha ausente");

            const res = await decryptData(snap.data(), senhaDoUsuario);

            // Comentario removido por encoding corrompido.
            dados = res.dados || {};
            parcelasMemoria = res.parcelasMemoria || [];
            contasFixas = res.contasFixas || [];
            receitasFixas = res.receitasFixas || [];
            lembretes = res.lembretes || [];
            salarioFixoBase = res.salarioFixoBase || 0;
            categorias = migrarCategorias(res.categorias);
            categoriasLembretes = res.categoriasLembretes || [];
            configuracoes = res.configuracoes || configuracoes;
            cartoes = res.cartoes || [];
            gastosDetalhes = res.gastosDetalhes || {};
            caixinhas = res.caixinhas || []; // <--- CARREGANDO CAIXINHAS
            normalizarDadosApp();

            // Comentario removido por encoding corrompido.
            atualizarSeletorAnos();
            aplicarParcelas();
            renderCaixinhas(); // <--- RENDERIZANDO CAIXINHAS
        } catch (err) {
            console.error("Erro na descriptografia:", err);
            // Comentario removido por encoding corrompido.
            signOut(auth);
            return;
        }
    }

    // Comentario removido por encoding corrompido.
    atualizarSaudacao();
    aplicarTema(configuracoes.tema);
    atualizarTituloSite();

    document.getElementById("authContainer").style.display = "none";
    document.getElementById("appContainer").style.display = "block";

    const { mesAt } = getMesReferenciaAtivo();
    mesesAbertos.add(mesAt);

    // Comentario removido por encoding corrompido.
    carregarAno();
    renderContasFixas();
    renderReceitasFixas();
    renderLembretesHome();
    if (configuracoes.notasVistasVersao !== VERSAO_ATUAL_APP) {
        window.location.hash = "#notas";
    }
    roteador();
    setAppCarregando(false);

    const seletorTemaFooter = document.getElementById("cfgTemaFooter");
    if(seletorTemaFooter) seletorTemaFooter.value = configuracoes.tema || "planetario";

  } else {
      // Comentario removido por encoding corrompido.
      document.getElementById("authContainer").style.display = "flex";
      document.getElementById("appContainer").style.display = "none";
      setAppCarregando(false);
  }
});

const seletorTemaFooter = document.getElementById("cfgTemaFooter");
if(seletorTemaFooter) {
    seletorTemaFooter.onchange = async () => {
        configuracoes.tema = seletorTemaFooter.value; aplicarTema(configuracoes.tema);
        const anoAt = document.getElementById("ano").value; atualizarTudo(anoAt); await salvarFirebase();
    };
}

const quickDestino = document.getElementById("quickDespDestino");
if (quickDestino) quickDestino.onchange = popularControlesDespesaRapida;

const btnDespesaRapida = document.getElementById("btnSalvarDespesaRapida");
if (btnDespesaRapida) {
    btnDespesaRapida.onclick = async () => {
        const nomeEl = document.getElementById("quickDespNome");
        const valorEl = document.getElementById("quickDespValor");
        const categoriaEl = document.getElementById("quickDespCategoria");
        const destinoEl = document.getElementById("quickDespDestino");
        const cartaoEl = document.getElementById("quickDespCartao");
        const parcelarEl = document.getElementById("quickDespParcelar");
        const qtdParcelasEl = document.getElementById("quickDespQtdParcelas");
        const nome = nomeEl?.value.trim();
        const valor = parseValor(valorEl?.value || "");
        if (!nome || valor <= 0) {
            alert("Informe nome e valor da despesa.");
            return;
        }
        const { mesAt, anoAt } = document.querySelector(".home-figma-shell") ? getMesHomeAtivo() : getMesReferenciaAtivo();
        if (!dados[anoAt]) dados[anoAt] = { meses: [] };
        while (dados[anoAt].meses.length <= mesAt) dados[anoAt].meses.push({ despesas: [], empresa: [], cartoesPagos: {}, fixasDesativadas: {}, receitasDesativadas: {}, fixasEditadas: {} });
        const criadoEm = Date.now();
        const dataCriacao = isoHoje();
        const diaCompra = parseIsoData(dataCriacao)?.getDate() || new Date().getDate();
        if (destinoEl?.value === "cartao") {
            if (!cartaoEl?.value) {
                alert("Selecione um cartao.");
                return;
            }
            const parcelar = parcelarEl?.type === "checkbox" ? parcelarEl.checked : parcelarEl?.value === "sim";
            const qtdParcelas = parseInt(qtdParcelasEl?.value || "1", 10);
            if (parcelar && (!qtdParcelas || qtdParcelas < 2)) {
                alert("Informe o numero de parcelas.");
                return;
            }
            if (parcelar) {
                const parcelaId = criadoEm;
                const valorParcela = Number((valor / qtdParcelas).toFixed(2));
                let mesParcela = mesAt;
                let anoParcela = anoAt;
                for (let i = 1; i <= qtdParcelas; i++) {
                    if (!gastosDetalhes[anoParcela]) gastosDetalhes[anoParcela] = [];
                    gastosDetalhes[anoParcela].push({
                        id: `${parcelaId}-${i}`,
                        criadoEm: criadoEm + i,
                        data: isoDataMes(anoParcela, mesParcela, diaCompra),
                        mes: mesParcela,
                        nome: `${nome} (${i}/${qtdParcelas})`,
                        valor: valorParcela,
                        categoria: categoriaEl?.value || "Essencial",
                        cartaoId: cartaoEl.value,
                        parcelaId,
                        checked: true
                    });
                    mesParcela++;
                    if (mesParcela > 11) {
                        mesParcela = 0;
                        anoParcela++;
                    }
                }
            } else {
                if (!gastosDetalhes[anoAt]) gastosDetalhes[anoAt] = [];
                gastosDetalhes[anoAt].push({
                    id: criadoEm,
                    criadoEm,
                    data: dataCriacao,
                    nome,
                    valor,
                    categoria: categoriaEl?.value || "Essencial",
                    cartaoId: cartaoEl.value,
                    mes: mesAt,
                    checked: true
                });
            }
        } else {
            dados[anoAt].meses[mesAt].despesas.push({
                id: criadoEm,
                criadoEm,
                data: dataCriacao,
                nome,
                valor,
                categoria: categoriaEl?.value || "Essencial",
                dia: diaCompra,
                checked: true
            });
        }
        if (nomeEl) nomeEl.value = "";
        if (valorEl) valorEl.value = "";
        if (qtdParcelasEl) qtdParcelasEl.value = "";
        if (parcelarEl) parcelarEl.value = "nao";
        popularControlesDespesaRapida();
        await salvarFirebase();
        carregarAno();
        renderPaginaGastos();
        renderLembretesHome();
        renderBalancoRapido();
    };
}

document.getElementById("exportarTudoBtn").onclick = () => { normalizarDadosApp(); const b = { dados, parcelasMemoria, lembretes, contasFixas, receitasFixas, salarioFixoBase, categorias, categoriasLembretes, configuracoes, cartoes, gastosDetalhes, caixinhas }; const blob = new Blob([JSON.stringify(b, null, 2)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `backup.json`; a.click(); };

document.getElementById("inputImport").onchange = (e) => {
    const r = new FileReader();
    r.onload = async (ev) => {
        const res = JSON.parse(ev.target.result);
        dados = res.dados || {};
        parcelasMemoria = res.parcelasMemoria || [];
        lembretes = res.lembretes || [];
        contasFixas = res.contasFixas || [];
        receitasFixas = res.receitasFixas || [];
        salarioFixoBase = res.salarioFixoBase || 0;
        categorias = migrarCategorias(res.categorias);
        categoriasLembretes = res.categoriasLembretes || [];
        configuracoes = res.configuracoes || configuracoes;
        cartoes = res.cartoes || [];
        gastosDetalhes = res.gastosDetalhes || {};
        caixinhas = res.caixinhas || [];
        normalizarDadosApp();
        processarAutoCobranca();

        atualizarSeletorAnos();
        carregarAno();
        renderContasFixas();
        renderReceitasFixas();
        renderLembretesHome();
        renderCaixinhas(); // ADICIONE ESTA LINHA
        renderPaginaGastos();
        aplicarTema(configuracoes.tema);
        await salvarFirebase();
        alert("Backup carregado com sucesso!");
    };
    r.readAsText(e.target.files[0]);
};

// Comentario removido por encoding corrompido.
// Comentario removido por encoding corrompido.
async function roteador() {
    const hash = window.location.hash || "#resumo";
    document.body.classList.remove("route-resumo", "route-gastos", "route-calendario", "route-analise", "route-notas", "route-configuracoes");
    const rotaAtual = (hash || "#resumo").replace("#", "") || "resumo";
    document.body.classList.add(`route-${rotaAtual}`);
    document.body.classList.toggle("figma-home-active", hash === "#resumo" || hash === "");
    document.body.classList.toggle("figma-calendar-active", hash === "#calendario");
    document.body.classList.toggle("figma-gastos-active", hash === "#gastos");

    const views = {
        "#resumo": "viewResumo",
        "#gastos": "viewGastos",
        "#calendario": "viewCalendario",
        "#analise": "viewAnalise",
        "#notas": "viewNotas",
        "#configuracoes": "viewConfiguracoes"
    };

    // Comentario removido por encoding corrompido.
    Object.values(views).forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = "none";
    });
    liberarSlotsAppShellParaRender();
    const acoesDadosGlobais = document.getElementById("acoesDadosGlobais");
    if (acoesDadosGlobais) acoesDadosGlobais.style.display = hash === "#configuracoes" ? "none" : "";

    ["navResumo", "navGastos", "navCalendario", "navAnalise", "sideNavResumo", "sideNavGastos", "sideNavCalendario", "sideNavAnalise"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove("active");
    });

    // Comentario removido por encoding corrompido.
    const currentViewId = views[hash] || "viewResumo";
    const currentViewEl = document.getElementById(currentViewId);
    if (currentViewEl) currentViewEl.style.display = "block";

    // Comentario removido por encoding corrompido.
    if (hash === "#resumo" || hash === "") {
        document.getElementById("navResumo")?.classList.add("active");
        document.getElementById("sideNavResumo")?.classList.add("active");
        montarLayoutFigmaHome();
        atualizarSaudacao(); // Atualiza Bom dia/Boa tarde...
        carregarAno();       // Renderiza os cards dos meses na Home
        renderHomeFigmaResumo();
    }
    else if (hash === "#gastos") {
        document.getElementById("navGastos")?.classList.add("active");
        document.getElementById("sideNavGastos")?.classList.add("active");
        renderPaginaGastos(); // Renderiza as tabelas de gastos detalhados
    }
    else if (hash === "#calendario") {
        document.getElementById("navCalendario")?.classList.add("active");
        document.getElementById("sideNavCalendario")?.classList.add("active");

        // Comentario removido por encoding corrompido.
        await renderCalendario(
            getEstadoCalendario(),
            getAcoesCalendario()
        );
    }
    else if (hash === "#analise") {
        document.getElementById("navAnalise")?.classList.add("active");
        document.getElementById("sideNavAnalise")?.classList.add("active");
        filtrosAnalise.ano = filtrosAnalise.ano || String(document.getElementById("ano")?.value || hoje.getFullYear());
        renderAnalise();
    }
    else if (hash === "#notas") {
    }
    else if (hash === "#configuracoes") {
        renderConfiguracoesHub();
    }

    sincronizarRotaNoAppShell(hash);
}

window.addEventListener("hashchange", roteador);

// Remover os .onclick vazios e garantir que o roteador rode ao carregar
window.addEventListener("load", () => {
    if (usuarioLogado) roteador();
});

// Comentario removido por encoding corrompido.
[document.getElementById("navResumo"), document.getElementById("navGastos"), document.getElementById("navCalendario"), document.getElementById("navAnalise")].forEach(link => {
    if (!link) return;
    link.onclick = (e) => {
        // Comentario removido por encoding corrompido.
    };
});

const btnVoltarInicioNotas = document.getElementById("btnVoltarInicioNotas");
if (btnVoltarInicioNotas) {
    btnVoltarInicioNotas.onclick = async () => {
        configuracoes.notasVistasVersao = VERSAO_ATUAL_APP;
        await salvarFirebase();
        window.location.hash = "#resumo";
    };
}

document.querySelectorAll(".config-hub-tab").forEach(btn => {
    btn.onclick = () => renderConfiguracoesHub(btn.dataset.configTab);
});

document.getElementById("btnSalvarSenha").onclick = async () => {
    const a = document.getElementById("pwdAntiga").value;
    const n = document.getElementById("pwdNova").value;

    if(!a || !n) {
        alert("Preencha a senha antiga e a nova senha.");
        return;
    }

    try {
        // Comentario removido por encoding corrompido.
        const cred = EmailAuthProvider.credential(usuarioLogado.email, a);
        await reauthenticateWithCredential(usuarioLogado, cred);

        // 2. Atualiza a senha no Firebase Auth
        await updatePassword(usuarioLogado, n);

        // Comentario removido por encoding corrompido.
        senhaDoUsuario = n;
        sessionStorage.setItem("temp_key", n);

        // 4. Salva os dados novamente na nuvem usando a NOVA SENHA
        await salvarFirebase();

        alert("Senha e criptografia atualizadas com sucesso!");
        document.getElementById("pwdAntiga").value = "";
        document.getElementById("pwdNova").value = "";
    } catch (e) {
        console.error("Erro detalhado:", e);
        alert("Erro: Verifique se a senha antiga est\u00e1 correta ou se a nova tem pelo menos 6 caracteres.");
    }
};
// Comentario removido por encoding corrompido.

document.getElementById("loginBtn").onclick = async () => {
    const e = document.getElementById("email").value;
    const s = document.getElementById("senha").value;
    senhaDoUsuario = s;
    setAppCarregando(true);
    try {
        await signInWithEmailAndPassword(auth, e, s);
        sessionStorage.setItem("temp_key", s);
    } catch (err) {
        senhaDoUsuario = sessionStorage.getItem("temp_key") || "";
        setAppCarregando(false);
        alert("Erro login");
    }
};
document.getElementById("cadastroBtn").onclick = async () => {
    const n = document.getElementById("cadastroNome").value.trim();
    const e = document.getElementById("email").value;
    const s = document.getElementById("senha").value;

    if (!n) {
        alert("Por favor, preencha seu nome.");
        return;
    }

    try {
        senhaDoUsuario = s;
        setAppCarregando(true);
        await createUserWithEmailAndPassword(auth, e, s);
        sessionStorage.setItem("temp_key", s);

        // Comentario removido por encoding corrompido.
        configuracoes.nomeUsuario = n;
        atualizarTituloSite();

        await salvarFirebase();
    } catch (err) {
        senhaDoUsuario = sessionStorage.getItem("temp_key") || "";
        setAppCarregando(false);
        alert("Erro ao cadastrar. Verifique os dados.");
    }
};
document.getElementById("logoutBtn").onclick = () => { signOut(auth); sessionStorage.clear(); location.reload(); };
document.getElementById("btnSettings").onclick = () => {
    window.location.hash = "#configuracoes";
    return;
    const modalCfg = document.getElementById("modalConfiguracoes");
    if(!modalCfg) return;

    // Comentario removido por encoding corrompido.
    document.getElementById("cfgNomeUsuario").value = configuracoes.nomeUsuario || "";
    document.getElementById("cfgDiaSalario").value = configuracoes.diaSalario || 5;
    document.getElementById("cfgDiaVirada").value = configuracoes.diaVirada || 1;

    // Comentario removido por encoding corrompido.
    const ref = configuracoes.referenciaMes || "atual";
    document.getElementById("refAtual").checked = (ref === "atual");
    document.getElementById("refProximo").checked = (ref === "proximo");

    modalCfg.style.display = "flex";
};
document.getElementById("btnSalvarConfig").onclick = async () => {
    // Comentario removido por encoding corrompido.
    congelarHistoricoFixas();

    // Agora lemos os novos valores dos inputs
    configuracoes.nomeUsuario = document.getElementById("cfgNomeUsuario").value;
    configuracoes.diaVirada = parseInt(document.getElementById("cfgDiaVirada").value) || 1;
    configuracoes.diaSalario = parseInt(document.getElementById("cfgDiaSalario").value) || 5;
    configuracoes.referenciaMes = document.querySelector('input[name="refMes"]:checked')?.value || "atual";

    atualizarTituloSite();
    await salvarFirebase();

    document.getElementById("modalConfiguracoes").style.display = "none";

    // Atualiza a interface
    carregarAno();
    renderPaginaGastos();
};
document.getElementById("btnFecharConfig").onclick = () => document.getElementById("modalConfiguracoes").style.display = "none";
document.getElementById("btnGerenciarCategorias").onclick = abrirGerenciadorCategorias;
document.getElementById("btnGerenciarCartoes").onclick = abrirGerenciadorCartoes;
document.getElementById("btnFecharModal").onclick = () => { fecharModalNoFluxoNovo("modalCategorias"); carregarAno(); renderContasFixas(); };
document.getElementById("btnFecharCartoes").onclick = () => fecharModalNoFluxoNovo("modalCartoes");
document.getElementById("btnSalvarCartoes").onclick = async () => { await salvarFirebase(); fecharModalNoFluxoNovo("modalCartoes"); carregarAno(); rerenderRotaAtual(); };
document.getElementById("btnAddCartao").onclick = () => {
    // Comentario removido por encoding corrompido.
    cartoes.push({
        id: Date.now(),
        nome: "Novo Cartão",
        tipo: "Crédito",
        fechamento: 1,
        vencimento: 10,
        color: "#D78341"
    });
    renderCartoesModal();
};

// Adicionar Despesa Fixa Comum
document.getElementById("btnAddContaFixa").onclick = () => {
    congelarHistoricoFixas(); // Tira a foto do passado antes de mexer no futuro
    contasFixas.push({
        id: "f" + Date.now(),
        nome: "Nova Despesa",
        valor: 0,
        dia: 1,
        ativo: true,
        categoria: categorias[0].name,
        cartaoId: "",
        tipo: "fixa"
    });
    renderContasFixas();
    salvarDadosLocal();
};

// Adicionar Assinatura
document.getElementById("btnAddAssinaturaFixa").onclick = () => {
    congelarHistoricoFixas(); // Tira a foto do passado antes de mexer no futuro
    contasFixas.push({
        id: "a" + Date.now(),
        nome: "Nova Assinatura",
        valor: 0,
        dia: 1,
        ativo: true,
        categoria: "Lazer",
        cartaoId: cartoes.length > 0 ? cartoes[0].id : "",
        tipo: "assinatura"
    });
    renderContasFixas();
    salvarDadosLocal();
};

// Adicionar Nova Renda Recorrente
document.getElementById("btnAddReceitaFixa").onclick = () => {
    congelarHistoricoFixas(); // Tira a foto do passado antes de mexer no futuro
    receitasFixas.push({
        id: "r" + Date.now(),
        nome: "Nova Renda Extra",
        valor: 0,
        dia: 1,
        ativo: true
    });
    renderReceitasFixas();
    salvarDadosLocal();
    carregarAno();
};

document.getElementById("salvarNuvemBtn").onclick = salvarFirebase;
const btnSalvarNuvemFloating = document.getElementById("salvarNuvemBtnFloating");
if (btnSalvarNuvemFloating) btnSalvarNuvemFloating.onclick = salvarFirebase;
document.getElementById("headerContasFixas").onclick = () => document.getElementById("moduloContasFixas").classList.toggle("collapsed");
document.getElementById("headerReceitasFixas").onclick = () => document.getElementById("moduloReceitasFixas").classList.toggle("collapsed");
document.getElementById("showSignup").onclick = (e) => { e.preventDefault(); document.getElementById("loginActions").style.display = "none"; document.getElementById("signupActions").style.display = "block"; };
document.getElementById("showLogin").onclick = (e) => { e.preventDefault(); document.getElementById("signupActions").style.display = "none"; document.getElementById("loginActions").style.display = "block"; };
document.getElementById("btnFecharParcelaCartao").onclick = () => document.getElementById("modalParcelaCartao").style.display = "none";
document.getElementById("btnIrCalendario").onclick = () => window.location.hash = "#calendario";

// Comentario removido por encoding corrompido.
function atualizarSeletorAnos() {
    const seletores = [document.getElementById("ano"), document.getElementById("anoGastos"), document.getElementById("anoAnalise")];

    // Comentario removido por encoding corrompido.
    let anosCriados = Object.keys(dados).map(Number);

    // Comentario removido por encoding corrompido.
    const anoHoje = new Date().getFullYear();
    const proximoAno = anoHoje + 1;
    if (!anosCriados.includes(anoHoje)) anosCriados.push(anoHoje);
    if (!anosCriados.includes(proximoAno)) anosCriados.push(proximoAno);

    // 3. Ordena os anos (do menor para o maior)
    anosCriados.sort((a, b) => a - b);

    seletores.forEach(s => {
        if (!s) return;

        // Salva qual ano estava selecionado antes de limpar
        const valorAntigo = s.value;
        s.innerHTML = "";

        anosCriados.forEach(a => {
            const o = document.createElement("option");
            o.value = a;
            o.text = a;

            // Comentario removido por encoding corrompido.
            if (valorAntigo) {
                if (String(a) === String(valorAntigo)) o.selected = true;
            } else {
                if (a === anoHoje) o.selected = true;
            }

            s.appendChild(o);
        });

        // Comentario removido por encoding corrompido.
        s.onchange = () => {
            carregarAno();
            renderPaginaGastos();
            atualizarTudo(s.value);
        };
    });
}

let subtarefasModal = [];

function popularCategoriasLembreteSelect(selectId = "lemCategoria", valor = null) {
    normalizarDadosApp();
    const select = document.getElementById(selectId);
    if (!select) return;
    select.innerHTML = categoriasLembretes.map(cat => `<option value="${cat.id}">${cat.nome}</option>`).join("");
    select.value = valor || categoriasLembretes[0]?.id || "geral";
    const atualizarCor = () => {
        const categoria = getCategoriaLembrete(select.value);
        select.style.borderLeft = `5px solid ${categoria?.cor || "transparent"}`;
    };
    select.onchange = atualizarCor;
    atualizarCor();
}

function renderSubtarefasModal() {
    const lista = document.getElementById("lemSubtarefas");
    if (!lista) return;
    lista.innerHTML = subtarefasModal.map(st => `
        <label class="subtarefa-modal-item">
            <input type="checkbox" data-id="${st.id}" ${st.concluida ? "checked" : ""}>
            <span>${st.texto}</span>
            <button type="button" data-remove="${st.id}">x</button>
        </label>
    `).join("");
    lista.querySelectorAll("input[type='checkbox']").forEach(input => {
        input.onchange = () => {
            const st = subtarefasModal.find(item => String(item.id) === String(input.dataset.id));
            if (st) st.concluida = input.checked;
        };
    });
    lista.querySelectorAll("button[data-remove]").forEach(btn => {
        btn.onclick = () => {
            subtarefasModal = subtarefasModal.filter(st => String(st.id) !== String(btn.dataset.remove));
            renderSubtarefasModal();
        };
    });
}

window.alternarSubtarefaLembrete = async (lembreteId, subtarefaId, concluida) => {
    const lembrete = lembretes.find(l => String(l.id) === String(lembreteId));
    const subtarefa = lembrete?.subtarefas?.find(st => String(st.id) === String(subtarefaId));
    if (!lembrete || !subtarefa) return;
    subtarefa.concluida = concluida;
    lembrete.concluido = lembrete.subtarefas.length > 0 && lembrete.subtarefas.every(st => st.concluida);
    await salvarFirebase();
    renderLembretesHome();
    rerenderCalendarioNoShell();
};

function getTipoRecorrenciaSelecionado(container = document) {
    return container.querySelector('input[name="lemRecorrenciaTipo"]:checked')?.value || "semanal";
}

function atualizarUiRecorrenciaModal() {
    const check = document.getElementById("lemRecorrente");
    const opcoes = document.getElementById("opcoesRecorrencia");
    const dias = document.getElementById("escolhaDiasSemana");
    const intervalo = document.getElementById("lemIntervaloDias");
    if (!check || !opcoes || !dias) return;

    const ativo = check.checked;
    const tipo = getTipoRecorrenciaSelecionado();
    opcoes.style.display = ativo ? "flex" : "none";
    dias.style.display = ativo && tipo === "semanal" ? "grid" : "none";
    if (intervalo) intervalo.disabled = !ativo || tipo !== "intervalo";
}

function resetCamposLembrete() {
    lembreteEditandoId = null;
    subtarefasModal = [];
    const btnSalvar = document.getElementById("btnSalvarLembrete");
    btnSalvar.innerText = "Salvar";
    btnSalvar.disabled = false;
    const modal = document.getElementById("modalLembrete");
    const tituloModal = modal?.querySelector("h3");
    if (tituloModal) tituloModal.textContent = "Novo Lembrete";
    document.getElementById("lemTitulo").value = "";
    document.getElementById("lemData").value = "";
    document.getElementById("lemHora").value = "";
    document.getElementById("lemValor").value = "";
    document.getElementById("lemAnotacoes").value = "";
    document.getElementById("lemRecorrente").checked = false;
    const radioSemanal = document.querySelector('input[name="lemRecorrenciaTipo"][value="semanal"]');
    if (radioSemanal) radioSemanal.checked = true;
    const intervalo = document.getElementById("lemIntervaloDias");
    if (intervalo) intervalo.value = "7";
    atualizarUiRecorrenciaModal();
    document.querySelectorAll("#escolhaDiasSemana input").forEach(input => input.checked = false);
    popularCategoriasLembreteSelect();
    renderSubtarefasModal();
}

const btnAddSubtarefa = document.getElementById("btnAddSubtarefa");
if (btnAddSubtarefa) {
    btnAddSubtarefa.onclick = () => {
        const input = document.getElementById("lemNovaSubtarefa");
        const texto = input?.value.trim();
        if (!texto) return;
        subtarefasModal.push({ id: String(Date.now()), texto, concluida: false });
        input.value = "";
        renderSubtarefasModal();
    };
}

document.getElementById("lemRecorrente").onchange = atualizarUiRecorrenciaModal;
document.querySelectorAll('input[name="lemRecorrenciaTipo"]').forEach(input => {
    input.onchange = atualizarUiRecorrenciaModal;
});
document.getElementById("btnFecharLembrete").onclick = () => {
    document.getElementById("modalLembrete").style.display = "none";
    resetCamposLembrete();
};

document.getElementById("btnSalvarLembrete").onclick = async () => {
    const btnSalvar = document.getElementById("btnSalvarLembrete");
    if (btnSalvar.disabled) return;
    const titulo = document.getElementById("lemTitulo").value;
    const dataVal = document.getElementById("lemData").value;

    if (!titulo || !dataVal) {
        alert("T?tulo e Data s?o obrigat?rios.");
        return;
    }

    const recorrente = document.getElementById("lemRecorrente").checked;
    const recorrenciaTipo = recorrente ? getTipoRecorrenciaSelecionado() : "semanal";
    let diasSelecionados = Array.from(document.querySelectorAll("#escolhaDiasSemana input:checked")).map(i => parseInt(i.value));
    if (recorrente && recorrenciaTipo === "semanal" && diasSelecionados.length === 0) {
        diasSelecionados = [parseIsoData(dataVal)?.getDay() ?? 0];
    }
    const intervaloDias = recorrente && recorrenciaTipo === "intervalo"
        ? Math.max(1, parseInt(document.getElementById("lemIntervaloDias")?.value || "1", 10))
        : null;

    const lembreteExistente = lembreteEditandoId
        ? lembretes.find(item => String(item.id) === String(lembreteEditandoId))
        : null;
    if (lembreteEditandoId && !lembreteExistente) {
        alert("O lembrete original não foi encontrado. Feche o modal e tente novamente.");
        return;
    }
    const dadosLembrete = {
        // Comentario removido por encoding corrompido.
        id: String(lembreteExistente?.id || `lembrete-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
        criadoEm: lembreteExistente?.criadoEm || Date.now(),
        nome: titulo,
        data: dataVal,
        hora: document.getElementById("lemHora").value,
        valor: parseValor(document.getElementById("lemValor").value),
        categoriaId: document.getElementById("lemCategoria")?.value || categoriasLembretes[0]?.id || "geral",
        anotacoes: document.getElementById("lemAnotacoes")?.value || "",
        subtarefas: subtarefasModal,
        concluido: subtarefasModal.length > 0 && subtarefasModal.every(st => st.concluida),
        recorrente: recorrente,
        recorrenciaTipo,
        diasSemana: recorrenciaTipo === "semanal" ? diasSelecionados : [],
        intervaloDias
    };

    const estadoAnterior = lembreteExistente ? structuredClone(lembreteExistente) : null;
    if (lembreteExistente) Object.assign(lembreteExistente, dadosLembrete);
    else lembretes.push(dadosLembrete);

    const textoBotaoAnterior = lembreteExistente ? "Atualizar Lembrete" : "Salvar";
    btnSalvar.disabled = true;
    btnSalvar.innerText = "Salvando...";
    const salvou = await salvarFirebase();
    if (!salvou) {
        if (lembreteExistente && estadoAnterior) {
            const lembreteAtual = lembretes.find(item => String(item.id) === String(dadosLembrete.id));
            if (lembreteAtual) {
                Object.keys(lembreteAtual).forEach(chave => delete lembreteAtual[chave]);
                Object.assign(lembreteAtual, estadoAnterior);
            }
        } else {
            lembretes = lembretes.filter(item => String(item.id) !== String(dadosLembrete.id));
        }
        btnSalvar.disabled = false;
        btnSalvar.innerText = textoBotaoAnterior;
        alert("Não foi possível salvar o lembrete. O modal continuará aberto para você tentar novamente.");
        return;
    }

    renderLembretesHome();
    await rerenderCalendarioNoShell();

    document.getElementById("modalLembrete").style.display = "none";
    resetCamposLembrete();
};

function abrirPostit(l) {
    const antigo = document.getElementById("popupPostit");
    if(antigo) antigo.remove();
    const categoriaPostit = getCategoriaLembrete(l.categoriaId);
    const corPostit = categoriaPostit?.cor || "#f1c40f";
    const corTextoPostit = getCorTextoContraste(corPostit);
    const corLinhaPostit = corTextoPostit === "#ffffff" ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.14)";

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.id = "popupPostit";

    const textoRecorrencia = () => {
        if (!l.recorrente) return "";
        const recorrencia = normalizarRecorrenciaLembrete(l);
        if (recorrencia.recorrenciaTipo === "mensal") return `<small style="display:block; font-size:12px; opacity:0.6;">(mensalmente)</small>`;
        if (recorrencia.recorrenciaTipo === "intervalo") return `<small style="display:block; font-size:12px; opacity:0.6;">(a cada ${recorrencia.intervaloDias || 1} dias)</small>`;
        if (recorrencia.diasSemana?.length > 0) {
            const nomesDias = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
            const diasTexto = recorrencia.diasSemana.map(d => nomesDias[d]).join(", ");
            return `<small style="display:block; font-size:12px; opacity:0.6;">(toda ${diasTexto})</small>`;
        }
        return "";
    };

    const renderConteudo = (modoEdicao = false) => {
        const recorrencia = normalizarRecorrenciaLembrete(l);
        const infoRecorrencia = textoRecorrencia();

        if (!modoEdicao) {
            const linhasInfo = [
                l.data ? `<p><strong>Data:</strong> ${escapeHtml(l.data.split("-").reverse().join("/"))}</p>` : "",
                l.hora ? `<p><strong>Hora:</strong> ${escapeHtml(l.hora)}</p>` : "",
                l.valor ? `<p><strong>Valor:</strong> ${formatar(l.valor)}</p>` : "",
                l.anotacoes ? `<p>${escapeHtml(l.anotacoes)}</p>` : ""
            ].filter(Boolean).join("");
            return `
                <div class="modal-content postit-amarelo" style="padding:25px; min-width:280px; position:relative; background:${corPostit} !important; color:${corTextoPostit} !important;">
                    <span class="btn-editar-p material-icons" style="position:absolute; right:15px; top:15px; cursor:pointer; font-size:20px;">edit</span>
                    <h3 style="margin-top:0; border-bottom:1px solid ${corLinhaPostit}; padding-bottom:8px; padding-right:30px; color:${corTextoPostit};">
                        ${escapeHtml(l.nome)} ${infoRecorrencia}
                    </h3>
                    <div style="margin: 15px 0; font-size: 18px;">
                        ${linhasInfo}
                        ${l.subtarefas?.length ? `<div class="subtarefas-home postit-checklist">${l.subtarefas.map(st => `<label><input type="checkbox" class="check-subtarefa-postit" data-subtarefa-id="${st.id}" ${st.concluida ? "checked" : ""}> <span>${escapeHtml(st.texto)}</span></label>`).join("")}</div>` : ""}
                    </div>
                    <div style="display:flex; gap:10px; margin-top:20px;">
                        <button class="btn btn-excluir-p" style="flex:1; background:#e74c3c; color:white;">Apagar</button>
                        <button class="btn btn-fechar-p" style="flex:1; background:#333; color:#fff;">Fechar</button>
                    </div>
                </div>`;
        } else {
            return `
                <div class="modal-content postit-amarelo modo-edicao" style="padding:25px; min-width:280px; position:relative; background:${corPostit} !important; color:${corTextoPostit} !important;">
                    <h3 style="margin-bottom:15px; font-size:14px; opacity:0.75; text-transform:uppercase; color:${corTextoPostit};">Editando...</h3>
                    <input type="text" class="postit-edit-input edit-nome" value="${l.nome}" placeholder="T?tulo">
                    <input type="date" class="postit-edit-input edit-data" value="${l.data}">
                    <input type="time" class="postit-edit-input edit-hora" value="${l.hora || ''}">
                    <input type="text" class="postit-edit-input edit-valor" value="${l.valor || ''}" placeholder="Valor R$">
                    <div style="margin-top:15px; background: rgba(0,0,0,0.05); padding: 10px;">
                        <label style="cursor:pointer; display:flex; align-items:center; gap:8px;">
                            <input type="checkbox" class="edit-recorrente" ${recorrencia.recorrente ? 'checked' : ''}> Repetir?
                        </label>
                        <div class="edit-recorrencia-opcoes" style="display:${recorrencia.recorrente ? 'flex' : 'none'}; flex-direction:column; gap:8px; margin-top:10px;">
                            <label><input type="radio" name="postitRecorrenciaTipo" value="semanal" ${recorrencia.recorrenciaTipo === "semanal" ? "checked" : ""}> Semanalmente:</label>
                            <div class="edit-dias" style="display:${recorrencia.recorrente && recorrencia.recorrenciaTipo === "semanal" ? 'grid' : 'none'}; grid-template-columns: repeat(7, 1fr); gap:5px;">
                                ${[0,1,2,3,4,5,6].map(d => `<label style="display:flex; flex-direction:column; align-items:center; font-size:10px; cursor:pointer;"><input type="checkbox" value="${d}" ${recorrencia.diasSemana?.includes(d) ? 'checked' : ''}>${['D','S','T','Q','Q','S','S'][d]}</label>`).join('')}
                            </div>
                            <label><input type="radio" name="postitRecorrenciaTipo" value="mensal" ${recorrencia.recorrenciaTipo === "mensal" ? "checked" : ""}> Mensalmente</label>
                            <label class="recorrencia-intervalo"><input type="radio" name="postitRecorrenciaTipo" value="intervalo" ${recorrencia.recorrenciaTipo === "intervalo" ? "checked" : ""}> A cada <input type="number" class="postit-edit-input edit-intervalo-dias" min="1" value="${recorrencia.intervaloDias || 7}"> dias</label>
                        </div>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:10px; margin-top:20px;">
                        <div style="display:flex; gap:10px; width:100%;">
                            <button class="btn btn-salvar-p" style="flex:2; background:#27ae60; color:white;">Salvar</button>
                            <button class="btn btn-cancelar-p" style="flex:1; background:#999; color:white;">Voltar</button>
                        </div>
                        <button class="btn btn-excluir-p" style="width:100%; background:#e74c3c; color:white; font-size:11px; padding:5px; height:40px;">Apagar Lembrete permanentemente</button>
                    </div>
                </div>`;
        }
    };

    const attachEvents = () => {
        const btnEdit = overlay.querySelector(".btn-editar-p");
        if(btnEdit) btnEdit.onclick = () => { window.editarLembrete(l); overlay.remove(); };

        // Comentario removido por encoding corrompido.
        const btnExcluir = overlay.querySelector(".btn-excluir-p");
        if(btnExcluir) btnExcluir.onclick = async () => {
            if(confirm("Deseja apagar este lembrete permanentemente?")) {
                lembretes = lembretes.filter(x => x.id !== l.id);
                await salvarFirebase();
                renderLembretesHome();
                rerenderCalendarioNoShell();
                overlay.remove();
            }
        };

        const atualizarRecorrenciaPostit = () => {
            const checkRec = overlay.querySelector(".edit-recorrente");
            const opcoes = overlay.querySelector(".edit-recorrencia-opcoes");
            const dias = overlay.querySelector(".edit-dias");
            const intervalo = overlay.querySelector(".edit-intervalo-dias");
            const tipo = overlay.querySelector('input[name="postitRecorrenciaTipo"]:checked')?.value || "semanal";
            if (opcoes) opcoes.style.display = checkRec?.checked ? "flex" : "none";
            if (dias) dias.style.display = checkRec?.checked && tipo === "semanal" ? "grid" : "none";
            if (intervalo) intervalo.disabled = !checkRec?.checked || tipo !== "intervalo";
        };

        const checkRec = overlay.querySelector(".edit-recorrente");
        if(checkRec) checkRec.onchange = atualizarRecorrenciaPostit;
        overlay.querySelectorAll('input[name="postitRecorrenciaTipo"]').forEach(input => {
            input.onchange = atualizarRecorrenciaPostit;
        });
        atualizarRecorrenciaPostit();

        overlay.querySelectorAll(".check-subtarefa-postit").forEach(input => {
            input.onchange = async (e) => {
                const subtarefa = l.subtarefas?.find(st => String(st.id) === String(e.target.dataset.subtarefaId));
                if (!subtarefa) return;
                subtarefa.concluida = e.target.checked;
                l.concluido = l.subtarefas.length > 0 && l.subtarefas.every(st => st.concluida);
                await salvarFirebase();
                renderLembretesHome();
                if (window.location.hash === "#calendario") rerenderCalendarioNoShell();
            };
        });

        const btnSalvar = overlay.querySelector(".btn-salvar-p");
        if(btnSalvar) btnSalvar.onclick = async () => {
            l.nome = overlay.querySelector(".edit-nome").value;
            l.data = overlay.querySelector(".edit-data").value;
            l.hora = overlay.querySelector(".edit-hora").value;
            l.valor = parseValor(overlay.querySelector(".edit-valor").value);
            l.recorrente = overlay.querySelector(".edit-recorrente").checked;
            l.recorrenciaTipo = l.recorrente ? (overlay.querySelector('input[name="postitRecorrenciaTipo"]:checked')?.value || "semanal") : "semanal";
            let diasSelecionados = Array.from(overlay.querySelectorAll(".edit-dias input:checked")).map(i => parseInt(i.value));
            if (l.recorrente && l.recorrenciaTipo === "semanal" && diasSelecionados.length === 0) {
                diasSelecionados = [parseIsoData(l.data)?.getDay() ?? 0];
            }
            l.diasSemana = l.recorrenciaTipo === "semanal" ? diasSelecionados : [];
            l.intervaloDias = l.recorrente && l.recorrenciaTipo === "intervalo"
                ? Math.max(1, parseInt(overlay.querySelector(".edit-intervalo-dias")?.value || "1", 10))
                : null;
            await salvarFirebase(); renderLembretesHome();
            rerenderCalendarioNoShell();
            overlay.innerHTML = renderConteudo(false); attachEvents();
        };

        const btnCancel = overlay.querySelector(".btn-cancelar-p") || overlay.querySelector(".btn-fechar-p");
        if(btnCancel) btnCancel.onclick = () => { if(btnCancel.classList.contains('btn-cancelar-p')) { overlay.innerHTML = renderConteudo(false); attachEvents(); } else { overlay.remove(); } };
    };

    overlay.innerHTML = renderConteudo(false);
    document.body.appendChild(overlay);
    attachEvents();
    overlay.onclick = (e) => { if(e.target === overlay) overlay.remove(); };
}

// Comentario removido por encoding corrompido.

function renderCaixinhas() {
    const container = document.getElementById("listaCaixinhas");
    if (!container) return;
    container.innerHTML = "";

    if (caixinhas.length === 0) {
        container.innerHTML = "<p style='text-align:center; opacity:0.5; grid-column: 1/-1;'>Nenhuma caixinha criada.</p>";
        return;
    }

    caixinhas.forEach(cx => {
        const info = obterDadosCaixinha(cx.id);
        const metaVal = parseValor(cx.meta);
        const porcentagem = metaVal > 0 ? Math.min((info.total / metaVal) * 100, 100) : 0;

        const card = document.createElement("div");
        card.className = "caixinha-card";
        card.style.borderLeftColor = cx.cor;

        card.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 5px;">
                <h3 style="margin:0; color:var(--P02); font-size: 16px;">${cx.nome}</h3>
                <button class="btn sair" style="padding:2px 8px; font-size:10px; background: rgba(255,255,255,0.1) !important;" onclick="window.excluirCaixinha('${cx.id}')">Excluir Caixinha</button>
            </div>

            <div class="cx-container-grid">
                <div class="cx-col-dados">
                    <div class="cx-progress-wrapper">
                        <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom: 5px;">
                            <span>Saldo: <b>${formatar(info.total)}</b></span>
                            <span>${metaVal > 0 ? porcentagem.toFixed(0) + '%' : 'S/ Meta'}</span>
                        </div>
                        <div class="cx-progress-bar">
                            <div class="cx-progress-fill" style="width: ${porcentagem}%; background: ${cx.cor}"></div>
                        </div>
                        ${metaVal > 0 ? `<small style="opacity:0.5; font-size: 12px;">Meta: ${formatar(metaVal)}</small>` : ''}
                    </div>
                    <div id="chart-cx-${cx.id}" style="margin-top: auto;"></div>
                </div>

                <div class="cx-col-historico" style="display: flex; flex-direction: column; min-height: 0;">
                    <strong style="font-size:11px; opacity: 0.7; display:block; margin-bottom:10px; text-transform: uppercase;">Histórico</strong>

                    <div class="cx-history-list">
                        ${info.historico.length > 0 ? info.historico.map(h => `
                            <div class="cx-history-item ${h.tipo}">
                                <div>
                                    <span style="opacity:0.6; font-size:11px; text-transform: uppercase;">${h.dataRef}</span><br>
                                    <strong style="font-size: 12px;">${h.tipo === 'resgate' ? 'SAQUE' : h.tipo === 'rendimento' ? 'RENDIMENTO' : 'DEPÓSITO'}</strong>
                                </div>
                                <div style="display:flex; align-items:center; gap:5px;">
                                    <b style="font-size: 11px;">${formatar(h.valor)}</b>
                                    <button class="btn-del-hist" title="Excluir este lançamento" onclick="window.excluirMovimentoCaixinha('${h.ano}', ${h.mesIdx}, '${h.origem}', ${h.timestamp || 'null'}, '${h.caixinhaId || ''}', ${Number(h.valor) || 0}, '${h.tipo || ''}')">${materialIcon("close")}</button>
                                </div>
                            </div>
                        `).join('') : '<small style="opacity:0.3; text-align:center; margin-top: 20px;">Nenhum registro</small>'}
                    </div>

                    <div style="display: flex; flex-direction: column; gap: 4px; margin-top: 10px;">
                        <button class="btn" style="width:100%; font-size:12px; padding: 8px; background:var(--P05) !important;" onclick="window.abrirModalDepositoCaixinha('${cx.id}')">FAZER DEPÓSITO</button>
                        <button class="btn" style="width:100%; font-size:12px; padding: 8px; background:var(--P04) !important;" onclick="window.abrirModalResgate('${cx.id}')">RESGATAR</button>
                    </div>
                </div>
            </div>`;

        container.appendChild(card);

        // Comentario removido por encoding corrompido.
        const labelsMeses = info.dadosGrafico.map((_, i) => nomesMesesCurto[i % 12]);
        const options = {
            series: [{ name: 'Saldo', data: info.dadosGrafico }],
            chart: {
                type: 'area',
                height: 100,
                sparkline: { enabled: false },
                toolbar: { show: false },
                animations: { enabled: false }
            },
            stroke: { curve: 'smooth', width: 2 },
            colors: [cx.cor],
            fill: {
                type: 'gradient',
                gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0.1 }
            },
            xaxis: {
                categories: labelsMeses,
                labels: { show: false },
                axisBorder: { show: false },
                axisTicks: { show: false }
            },
            yaxis: { show: false },
            grid: { show: false },
            tooltip: {
                theme: 'dark',
                x: { show: true },
                y: { formatter: (val) => formatar(val) }
            }
        };
        new ApexCharts(card.querySelector(`#chart-cx-${cx.id}`), options).render();

        // Comentario removido por encoding corrompido.
        const historyDiv = card.querySelector(".cx-history-list");
        if (historyDiv) {
            historyDiv.scrollTop = historyDiv.scrollHeight;
        }
    });
}

// Comentario removido por encoding corrompido.
function obterDadosCaixinha(id) {
    let total = 0;
    let historico = [];
    let dadosGrafico = [];

    const anos = Object.keys(dados).map(Number).sort((a,b) => a - b);
    anos.forEach(ano => {
        if (!dados[ano].meses) return;
        dados[ano].meses.forEach((m, idx) => {
            // Comentario removido por encoding corrompido.
            (m.despesas || []).forEach(d => {
                if (String(d.caixinhaId) === String(id) && d.checked) {
                    total += d.valor;
                    historico.push({ dataRef: `${nomesMesesCurto[idx]}/${ano}`, valor: d.valor, tipo: 'deposito', timestamp: d.timestamp, origem: 'despesas', ano, mesIdx: idx, caixinhaId: d.caixinhaId });
                }
            });
            // B) Resgates (em empresa/rendas)
            (m.empresa || []).forEach(r => {
                if (String(r.caixinhaId) === String(id) && r.checked) {
                    total -= r.valor;
                    historico.push({ dataRef: `${nomesMesesCurto[idx]}/${ano}`, valor: r.valor, tipo: 'resgate', timestamp: r.timestamp, origem: 'empresa', ano, mesIdx: idx, caixinhaId: r.caixinhaId });
                }
            });
            // C) Movimentos Diretos (Rendimentos/Dinheiro Extra)
            (m.movimentosCaixinha || []).forEach(mov => {
                if (String(mov.caixinhaId) === String(id)) {
                    total += mov.valor;
                    historico.push({ dataRef: `${nomesMesesCurto[idx]}/${ano}`, valor: mov.valor, tipo: mov.tipo, timestamp: mov.timestamp, origem: 'movimentosCaixinha', ano, mesIdx: idx, caixinhaId: mov.caixinhaId });
                }
            });
            dadosGrafico.push(total);
        });
    });
    historico.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    return { total, historico, dadosGrafico };
}

// 2. BOTAO GUARDAR
window.abrirModalGuardar = (ano, mes) => {
    const modal = document.getElementById("modalGuardar");
    const select = document.getElementById("gdDestino");
    const inputVal = document.getElementById("gdValor");
    const mData = dados[ano].meses[mes];

    select.innerHTML = caixinhas.map(c => `<option value="${c.id}">${c.nome}</option>`).join('');

    document.getElementById("btnConfirmarGuardar").onclick = () => {
        const valor = parseValor(inputVal.value);
        if(valor <= 0) return;

        const timestamp = Date.now();
        mData.despesas.push({
            id: `cx-${timestamp}`,
            criadoEm: timestamp,
            data: isoDataMes(ano, mes, new Date().getDate()),
            dia: parseIsoData(isoDataMes(ano, mes, new Date().getDate()))?.getDate() || 1,
            nome: `DEPÓSITO: ${caixinhas.find(c => c.id == select.value).nome}`,
            valor: valor,
            checked: true,
            caixinhaId: select.value,
            timestamp
        });

        salvarDadosLocal();
        carregarAno();
        modal.style.display = "none";
    };
    modal.style.display = "flex";
};

// 3. BOTAO DEPOSITO NO CARD
window.abrirModalDepositoCaixinha = (cxId) => {
    const modal = document.getElementById("modalDepositoCaixinha");
    const selectMes = document.getElementById("dcMesDestino");
    const inputVal = document.getElementById("dcValor");
    const selectTipo = document.getElementById("dcTipo");
    const anoAt = document.getElementById("ano").value;

    selectMes.innerHTML = dados[anoAt].meses.map((m, i) => `<option value="${i}">${nomesMesesFull[i]}</option>`).join('');

    document.getElementById("btnConfirmarDepositoCx").onclick = () => {
        const valor = parseValor(inputVal.value);
        const mesIdx = selectMes.value;
        const mData = dados[anoAt].meses[mesIdx];

        if(valor <= 0) return;
        if(!mData.movimentosCaixinha) mData.movimentosCaixinha = [];

        mData.movimentosCaixinha.push({
            tipo: selectTipo.value, // deposito ou rendimento
            valor: valor,
            caixinhaId: cxId,
            timestamp: Date.now()
        });

        salvarDadosLocal();
        atualizarTudo(anoAt);
        modal.style.display = "none";
    };
    modal.style.display = "flex";
};

// 4. FUNCAO DE EXCLUIR REGISTRO DO HISTORICO
function removerPrimeiroMovimentoCaixinha(lista, matcher) {
    if (!Array.isArray(lista)) return { lista: [], removido: false };
    const index = lista.findIndex(matcher);
    if (index === -1) return { lista, removido: false };
    return { lista: lista.filter((_, idx) => idx !== index), removido: true };
}

window.excluirMovimentoCaixinha = async (ano, mesIdx, origem, timestamp, caixinhaId = "", valor = 0, tipo = "") => {
    if(!confirm("Deseja excluir este registro permanentemente?")) return;

    const timestampNumero = Number(timestamp);
    const temTimestamp = timestamp !== null && timestamp !== undefined && String(timestamp) !== "null" && Number.isFinite(timestampNumero);
    const anoAlvo = String(ano);
    const mesAlvo = Number(mesIdx);
    const arraysCaixinha = ["despesas", "empresa", "movimentosCaixinha"];
    let removeu = false;

    Object.keys(dados).forEach(anoDados => {
        (dados[anoDados]?.meses || []).forEach((m, idx) => {
            arraysCaixinha.forEach(chave => {
                if (!Array.isArray(m[chave])) return;
                const deveTentar = temTimestamp || (String(anoDados) === anoAlvo && idx === mesAlvo && chave === origem);
                if (!deveTentar) return;

                if (temTimestamp) {
                    const tamanhoAntes = m[chave].length;
                    m[chave] = m[chave].filter(item => Number(item.timestamp) !== timestampNumero);
                    if (m[chave].length !== tamanhoAntes) removeu = true;
                    return;
                }

                const resultado = removerPrimeiroMovimentoCaixinha(m[chave], item => {
                    const mesmaCaixinha = String(item.caixinhaId || "") === String(caixinhaId || "");
                    const mesmoValor = Number(item.valor || 0) === Number(valor || 0);
                    const mesmoTipo = chave !== "movimentosCaixinha" || String(item.tipo || "") === String(tipo || "");
                    return mesmaCaixinha && mesmoValor && mesmoTipo;
                });
                m[chave] = resultado.lista;
                if (resultado.removido) removeu = true;
            });
        });
    });

    if (!removeu) {
        alert("Não encontrei o lançamento original para excluir.");
        return;
    }

    const anoAtualView = document.getElementById("ano")?.value || ano;
    carregarAno();
    atualizarTudo(anoAtualView);
    if (window.location.hash === "#gastos") renderPaginaGastos();
    await salvarFirebase();

    /* removed legacy single-array delete path
        const m = dados[ano].meses[mesIdx];

        // Remove do array correto (origem pode ser 'movimentosCaixinha', 'despesas' ou 'empresa')
        if (m[origem]) {
            m[origem] = m[origem].filter(item => item.timestamp !== timestamp);
        }

        salvarDadosLocal();
        atualizarTudo(document.getElementById("ano").value);

        // Comentario removido por encoding corrompido.
        await salvarFirebase();
    */
};

window.excluirCaixinha = (id) => {
    if (confirm("Deseja apagar esta CAIXINHA inteira? \n\nOs registros feitos nos meses n\u00e3o sumir\u00e3o, mas a caixinha deixar\u00e1 de ser listada aqui.")) {
        // Remove a caixinha do array global
        caixinhas = caixinhas.filter(c => String(c.id) !== String(id));

        // Salva e atualiza a interface
        salvarDadosLocal();
        renderCaixinhas();

        // Opcional: Salva na nuvem imediatamente
        if (typeof salvarFirebase === "function") salvarFirebase();
    }
};

window.abrirModalResgate = (cxId) => {
    const modal = document.getElementById("modalResgatar");
    const selectMes = document.getElementById("rsMesDestino");
    const inputVal = document.getElementById("rsValor");
    const cxObj = caixinhas.find(c => c.id == cxId);

    // Comentario removido por encoding corrompido.
    const anoAt = document.getElementById("ano").value;
    if (!dados[anoAt]) return;

    // Preenche o select com os meses existentes para devolver o dinheiro
    selectMes.innerHTML = dados[anoAt].meses.map((m, i) =>
        `<option value="${i}">${nomesMesesFull[i]}</option>`
    ).join('');

    document.getElementById("btnConfirmarResgate").onclick = () => {
        const valor = parseValor(inputVal.value);
        const mesIdx = selectMes.value;
        const mData = dados[anoAt].meses[mesIdx];

        if(valor <= 0) { alert("Digite um valor v\u00e1lido."); return; }

        // Comentario removido por encoding corrompido.
        mData.empresa.push({
            nome: `[RESG] ${cxObj.nome}`,
            valor: valor,
            checked: true,
            caixinhaId: cxId,
            timestamp: Date.now()
        });

        salvarDadosLocal();
        carregarAno();
        modal.style.display = "none";
        inputVal.value = "";
    };
    modal.style.display = "flex";
};

// --- CONFIGURACAO DOS BOTOES DE CAIXINHA ---

const headerCaixinhas = document.getElementById("headerCaixinhas");
if (headerCaixinhas) {
    headerCaixinhas.onclick = () => {
        const mod = document.getElementById("moduloCaixinhas");
        mod.classList.toggle("collapsed");
        if (!mod.classList.contains("collapsed")) renderCaixinhas();
    };
}

const btnNovaCx = document.getElementById("btnNovaCaixinha");
if (btnNovaCx) {
    btnNovaCx.onclick = () => {
        document.getElementById("modalCaixinha").style.display = "flex";
    };
}

const btnSalvarCx = document.getElementById("btnSalvarCaixinha");
if (btnSalvarCx) {
    btnSalvarCx.onclick = () => {
        const nome = document.getElementById("cxNome").value;
        const meta = document.getElementById("cxMeta").value;
        const cor = document.getElementById("cxCor").value;

        if (!nome) { alert("D\u00ea um nome para a caixinha."); return; }

        caixinhas.push({
            id: String(Date.now()),
            nome: nome,
            meta: meta,
            cor: cor
        });

        salvarDadosLocal();
        renderCaixinhas();
        document.getElementById("modalCaixinha").style.display = "none";
        // Limpar campos
        document.getElementById("cxNome").value = "";
        document.getElementById("cxMeta").value = "";
    };
}
