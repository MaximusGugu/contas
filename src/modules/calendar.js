let dataFoco = new Date();
let cacheFeriados = {};
let visaoAtual = "mensal";

export async function obterFeriados(ano) {
    if (cacheFeriados[ano]) return cacheFeriados[ano];
    try {
        const response = await fetch(`https://brasilapi.com.br/api/feriados/v1/${ano}`);
        if (!response.ok) throw new Error("Falha na API");
        const dados = await response.json();
        cacheFeriados[ano] = dados.map(f => f.date.substring(5));
        return cacheFeriados[ano];
    } catch (e) {
        return ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25"];
    }
}

export function calcularDiaPagamento(diaUtilAlvo, mes, ano, feriadosDoAno = []) {
    let diasUteisEncontrados = 0;
    let diaAtual = 1;
    while (diasUteisEncontrados < diaUtilAlvo && diaAtual <= 31) {
        const data = new Date(ano, mes, diaAtual);
        if (data.getMonth() !== mes) break;
        const ehTrabalhavel = data.getDay() !== 0 && !feriadosDoAno.includes(`${(mes + 1).toString().padStart(2, "0")}-${diaAtual.toString().padStart(2, "0")}`);
        if (ehTrabalhavel) diasUteisEncontrados++;
        if (diasUteisEncontrados < diaUtilAlvo) diaAtual++;
    }
    return diaAtual;
}

export function calcularDiaSalarioConfigurado(configuracoes = {}, mes, ano, feriadosDoAno = []) {
    const dia = parseInt(configuracoes.diaSalario) || 5;
    if (configuracoes.tipoDiaSalario === "corrido") {
        const ultimoDia = new Date(ano, mes + 1, 0).getDate();
        return Math.min(Math.max(dia, 1), ultimoDia);
    }
    return calcularDiaPagamento(dia, mes, ano, feriadosDoAno);
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

function corComOpacidade(cor, opacidade = 0.8) {
    const rgb = hexParaRgb(cor);
    return rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacidade})` : cor;
}

function minutosDoHorario(hora) {
    if (!hora) return 24 * 60 + 1;
    const match = String(hora).match(/^(\d{1,2}):(\d{2})/);
    if (!match) return 24 * 60 + 1;
    return (Number(match[1]) * 60) + Number(match[2]);
}

function posicionarEventoSemanal(elemento, hora, indiceSemHorario = 0, duracaoMinutos = 60, horaVirada = 21) {
    if (!elemento) return;
    elemento.classList.add("cal-week-event");
    const minutos = minutosDoHorario(hora);
    if (minutos > 24 * 60) {
        elemento.classList.add("cal-week-event-untimed");
        elemento.style.setProperty("--untimed-index", indiceSemHorario);
        elemento.style.setProperty("--untimed-top", `${24 + (indiceSemHorario * 22)}px`);
        return;
    }
    const inicio = getMinutosRelativosAoDia(minutos, horaVirada);
    const duracao = Math.max(30, Math.min(24 * 60 - inicio, Number(duracaoMinutos) || 60));
    elemento.style.setProperty("--event-ratio", inicio / (24 * 60));
    elemento.style.setProperty("--event-height-ratio", duracao / (24 * 60));
}

function formatarHorarioMinutos(minutos) {
    const total = Math.max(0, Math.min(23 * 60 + 30, Number(minutos) || 0));
    const hora = Math.floor(total / 60);
    const minuto = total % 60;
    return `${String(hora).padStart(2, "0")}:${String(minuto).padStart(2, "0")}`;
}

function normalizarHoraViradaCalendario(valor) {
    const hora = parseInt(valor);
    return Number.isFinite(hora) ? Math.max(0, Math.min(23, hora)) : 21;
}

function normalizarInicioSemanaCalendario(valor) {
    const dia = parseInt(valor);
    return Number.isFinite(dia) ? Math.max(0, Math.min(6, dia)) : 0;
}

function getMinutosRelativosAoDia(minutos, horaVirada) {
    const inicio = normalizarHoraViradaCalendario(horaVirada) * 60;
    return (Math.max(0, Math.min(24 * 60, minutos)) - inicio + (24 * 60)) % (24 * 60);
}

function obterHorarioSnapSemana(eventoMouse, diaBox) {
    const rect = diaBox.getBoundingClientRect();
    const topoAgenda = 22;
    const baseAgenda = 5;
    const horaVirada = normalizarHoraViradaCalendario(diaBox.dataset.horaVirada);
    const alturaAgenda = Math.max(1, rect.height - topoAgenda - baseAgenda);
    const y = Math.max(0, Math.min(alturaAgenda, eventoMouse.clientY - rect.top - topoAgenda));
    const minutosBrutos = (y / alturaAgenda) * (24 * 60);
    const minutosRelativos = Math.max(0, Math.min(23 * 60 + 30, Math.round(minutosBrutos / 30) * 30));
    const minutosSnap = (minutosRelativos + (horaVirada * 60)) % (24 * 60);
    return {
        minutos: minutosSnap,
        horario: formatarHorarioMinutos(minutosSnap),
        topPx: topoAgenda + ((minutosRelativos / (24 * 60)) * alturaAgenda)
    };
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

function ultimoDiaDoMes(ano, mes) {
    return new Date(Number(ano), Number(mes) + 1, 0).getDate();
}

function lembreteOcorreNaData(l, dataObj) {
    const iso = dataObj.toLocaleDateString("en-CA");
    if (l.data === iso) return true;
    if (!l.recorrente) return false;
    const dataBase = parseIsoData(l.data);
    if (!dataBase || dataObj < dataBase) return false;

    if (l.recorrenciaTipo === "mensal") {
        const diaOcorrencia = Math.min(dataBase.getDate(), ultimoDiaDoMes(dataObj.getFullYear(), dataObj.getMonth()));
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

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[ch]));
}

function formatarValor(v) {
    const num = parseFloat(v);
    return isNaN(num) ? "0,00" : num.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function montarDatasCalendario(exibindoAno, exibindoMes, ehSemana, grid, inicioSemana = 0) {
    const diasParaRenderizar = [];
    const primeiroDiaSemanaConfig = normalizarInicioSemanaCalendario(inicioSemana);
    if (!ehSemana) {
        const primeiroDiaSemana = (new Date(exibindoAno, exibindoMes, 1).getDay() - primeiroDiaSemanaConfig + 7) % 7;
        const ultimoDiaMes = new Date(exibindoAno, exibindoMes + 1, 0).getDate();
        const ultimoDiaMesAnterior = new Date(exibindoAno, exibindoMes, 0).getDate();
        for (let i = 0; i < primeiroDiaSemana; i++) {
            const diaOutroMes = ultimoDiaMesAnterior - primeiroDiaSemana + i + 1;
            grid.insertAdjacentHTML("beforeend", `<div class="cal-day other-month"><div class="cal-number">${diaOutroMes}</div></div>`);
        }
        for (let d = 1; d <= ultimoDiaMes; d++) diasParaRenderizar.push(new Date(exibindoAno, exibindoMes, d));
    } else {
        const d = new Date(dataFoco);
        const diff = (d.getDay() - primeiroDiaSemanaConfig + 7) % 7;
        const domingo = new Date(d);
        domingo.setDate(d.getDate() - diff);
        for (let i = 0; i < 7; i++) {
            diasParaRenderizar.push(new Date(domingo));
            domingo.setDate(domingo.getDate() + 1);
        }
    }
    return diasParaRenderizar;
}

function obterIntervaloSemana(inicioSemana = 0) {
    const base = new Date(dataFoco);
    const inicio = new Date(base);
    const primeiroDiaSemanaConfig = normalizarInicioSemanaCalendario(inicioSemana);
    const diff = (base.getDay() - primeiroDiaSemanaConfig + 7) % 7;
    inicio.setDate(base.getDate() - diff);
    const fim = new Date(inicio);
    fim.setDate(inicio.getDate() + 6);
    return { inicio, fim };
}

function formatarIntervaloSemana(inicio, fim, nomesMeses) {
    const mesmoMes = inicio.getMonth() === fim.getMonth() && inicio.getFullYear() === fim.getFullYear();
    const mesmoAno = inicio.getFullYear() === fim.getFullYear();
    if (mesmoMes) {
        return `${inicio.getDate()} - ${fim.getDate()} de ${nomesMeses[inicio.getMonth()].toLowerCase()} ${inicio.getFullYear()}`;
    }
    if (mesmoAno) {
        return `${inicio.getDate()} de ${nomesMeses[inicio.getMonth()].toLowerCase()} - ${fim.getDate()} de ${nomesMeses[fim.getMonth()].toLowerCase()} ${fim.getFullYear()}`;
    }
    return `${inicio.getDate()} de ${nomesMeses[inicio.getMonth()].toLowerCase()} ${inicio.getFullYear()} - ${fim.getDate()} de ${nomesMeses[fim.getMonth()].toLowerCase()} ${fim.getFullYear()}`;
}

export async function renderCalendario(state, actions = {}) {
    const area = document.getElementById("areaCalendario");
    if (!area) return;

    const exibindoAno = dataFoco.getFullYear();
    const exibindoMes = dataFoco.getMonth();
    const feriadosDoAno = await obterFeriados(exibindoAno);
    const nomesMeses = ["Janeiro", "Fevereiro", "Mar\u00e7o", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
    const nomesMesesUpper = nomesMeses.map(nome => nome.toUpperCase());
    visaoAtual = state.configuracoes?.visaoCalendario === "semanal" ? "semanal" : "mensal";
    const horaViradaCalendario = normalizarHoraViradaCalendario(state.configuracoes?.horaViradaCalendario);
    const inicioSemanaCalendario = normalizarInicioSemanaCalendario(state.configuracoes?.inicioSemanaCalendario);
    const diasSemanaBase = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "S\u00c1B"];
    const diasSemana = Array.from({ length: 7 }, (_, index) => diasSemanaBase[(inicioSemanaCalendario + index) % 7]);
    const hojeLocal = new Date().toLocaleDateString("en-CA");
    const ehSemana = visaoAtual === "semanal";
    const viewAtiva = state.viewCalendarioAtiva || state.configuracoes?.viewsCalendario?.find(view => String(view.id) === String(state.configuracoes?.viewCalendarioAtiva)) || state.configuracoes?.viewsCalendario?.[0];
    const configExibicao = viewAtiva?.filtros || state.configuracoes?.exibicaoCalendario || {};
    const tipos = configExibicao.tipos || {};
    const categoriasLembretesFiltro = Array.isArray(configExibicao.categoriasLembretes) ? configExibicao.categoriasLembretes.map(String) : [];
    const categoriasFinanceirasFiltro = Array.isArray(configExibicao.categoriasFinanceiras) ? configExibicao.categoriasFinanceiras : [];
    const mostrarTipo = (tipo) => tipos[tipo] !== false;
    const mostrarCategoriaFinanceira = (categoria) => categoriasFinanceirasFiltro.length === 0 || categoriasFinanceirasFiltro.includes(categoria);
    const getCategoriaLembrete = (id) => (state.categoriasLembretes || []).find(cat => String(cat.id) === String(id));
    const mostrarLembrete = (l) => mostrarTipo("lembretes") && (categoriasLembretesFiltro.length === 0 || categoriasLembretesFiltro.includes(String(l.categoriaId)));
    const mesAnteriorLabel = nomesMesesUpper[new Date(exibindoAno, exibindoMes - 1, 1).getMonth()];
    const mesProximoLabel = nomesMesesUpper[new Date(exibindoAno, exibindoMes + 1, 1).getMonth()];
    const { inicio: inicioSemana, fim: fimSemana } = obterIntervaloSemana(inicioSemanaCalendario);
    const labelPeriodoAtual = ehSemana ? formatarIntervaloSemana(inicioSemana, fimSemana, nomesMeses) : `${nomesMesesUpper[exibindoMes]} ${exibindoAno}`;
    const labelAnterior = ehSemana ? "ANTERIOR" : mesAnteriorLabel;
    const labelProximo = ehSemana ? "PRÓXIMA" : mesProximoLabel;
    const views = state.configuracoes?.viewsCalendario || [];
    const filtrosSidebar = [
        ["feriados", "Feriados"],
        ["salario", "Sal&aacute;rio"],
        ["receitas", "Rendas"],
        ["cartoes", "Cart&otilde;es"],
        ["fixas", "Fixas"],
        ["variaveis", "Vari&aacute;veis"],
        ["lembretes", "Lembretes"]
    ];
    const nomeExibicao = (nome) => escapeHtml(String(nome || "").replace(/\bView\b/gi, "Exibi\u00e7\u00e3o"));
    const rerenderCalendario = () => {
        if (typeof actions.rerenderCalendario === "function") return actions.rerenderCalendario();
        return renderCalendario(state, actions);
    };

    area.innerHTML = `
        <div class="app-route-fragments calendar-route-fragments">
            <section class="calendar-filter-card">
                        <header class="calendar-filter-header">
                            <span>Filtros</span>
                            <button class="btn-icon-home" id="btnConfigCalendario" type="button" title="Editar exibi&ccedil;&atilde;o ativa"><span class="material-icons">settings</span></button>
                        </header>
                        <div class="calendar-filter-body">
                            <div class="calendar-filter-grid">
                                ${filtrosSidebar.map(([tipo, label]) => `
                                    <label class="calendar-filter-check">
                                        <input type="checkbox" data-cal-filter="${tipo}" ${mostrarTipo(tipo) ? "checked" : ""}>
                                        <span>${label}</span>
                                    </label>
                                `).join("")}
                            </div>
                            <div class="calendar-view-switch">
                                <button class="btn ${visaoAtual === "mensal" ? "active" : ""}" id="viewMensal" type="button">VISÃO MENSAL</button>
                                <button class="btn ${visaoAtual === "semanal" ? "active" : ""}" id="viewSemanal" type="button">VISÃO SEMANAL</button>
                            </div>
                            <div class="calendar-saved-views">
                                <span class="calendar-saved-title">Exibi&ccedil;&otilde;es salvas</span>
                                <div class="calendar-saved-list">
                                    ${views.map((view, index) => `
                                        <div class="calendar-saved-row ${String(view.id) === String(state.configuracoes?.viewCalendarioAtiva) ? "active" : ""}">
                                            <button type="button" class="calendar-saved-select" data-cal-view="${view.id}">
                                                <span class="material-icons">${escapeHtml(view.icone || ["description", "location_on", "star"][index % 3])}</span>
                                                <span>${nomeExibicao(view.nome)}</span>
                                            </button>
                                            <button type="button" class="calendar-saved-edit" data-cal-edit-view="${view.id}" title="Editar exibi&ccedil;&atilde;o"><span class="material-icons">settings</span></button>
                                        </div>
                                    `).join("")}
                                </div>
                                <button class="calendar-new-view" id="btnAddViewCalendario" type="button">+ Nova Exibi&ccedil;&atilde;o</button>
                            </div>
                            <button class="btn calendar-new-reminder" id="btnNovoLembrete" type="button">+ LEMBRETE</button>
                        </div>
            </section>
            <div class="app-content calendar-dashboard-area">
                    <div class="app-month-nav home-month-nav calendar-month-nav">
                        <button class="btn" id="btnPrev" type="button">&lt; ${labelAnterior}</button>
                        <div class="home-current-month"><span>${labelPeriodoAtual}</span></div>
                        <button class="btn" id="btnNext" type="button">${labelProximo} &gt;</button>
                    </div>
                    <div class="calendario-container ${ehSemana ? "calendar-week-mode" : ""}">
                        <div class="cal-week-header">${diasSemana.map(d => `<div class="cal-day-name">${d}</div>`).join("")}</div>
                        <div class="cal-grid ${ehSemana ? "weekly-view" : ""}" id="calGrid"></div>
                    </div>
            </div>
        </div>`;

    const root = area.querySelector(".calendar-route-fragments");
    if (!root) return;

    root.querySelector("#btnPrev").onclick = () => {
        if (!ehSemana) dataFoco.setMonth(exibindoMes - 1);
        else dataFoco.setDate(dataFoco.getDate() - 7);
        rerenderCalendario();
    };
    root.querySelector("#btnNext").onclick = () => {
        if (!ehSemana) dataFoco.setMonth(exibindoMes + 1);
        else dataFoco.setDate(dataFoco.getDate() + 7);
        rerenderCalendario();
    };
    root.querySelector("#viewMensal").onclick = () => {
        visaoAtual = "mensal";
        if (actions.atualizarVisaoCalendario) actions.atualizarVisaoCalendario("mensal");
        else rerenderCalendario();
    };
    root.querySelector("#viewSemanal").onclick = () => {
        visaoAtual = "semanal";
        if (actions.atualizarVisaoCalendario) actions.atualizarVisaoCalendario("semanal");
        else rerenderCalendario();
    };
    root.querySelector("#btnConfigCalendario").onclick = () => actions.abrirConfiguracoesCalendario?.();
    root.querySelector("#btnAddViewCalendario").onclick = () => actions.criarViewCalendario?.();
    root.querySelector("#btnNovoLembrete").onclick = () => {
        if (window.resetEdicao) window.resetEdicao();
        const modal = document.getElementById("modalLembrete");
        if (modal) modal.style.display = "flex";
    };
    root.querySelectorAll("[data-cal-view]").forEach(btn => {
        btn.onclick = () => actions.selecionarViewCalendario?.(btn.dataset.calView);
    });
    root.querySelectorAll("[data-cal-edit-view]").forEach(btn => {
        btn.onclick = () => {
            if (actions.editarViewCalendario) actions.editarViewCalendario(btn.dataset.calEditView);
            else actions.abrirConfiguracoesCalendario?.();
        };
    });
    root.querySelectorAll("[data-cal-filter]").forEach(input => {
        input.onchange = () => {
            const tipo = input.dataset.calFilter;
            if (actions.atualizarFiltroCalendario) {
                actions.atualizarFiltroCalendario(tipo, input.checked);
            } else if (viewAtiva) {
                viewAtiva.filtros = viewAtiva.filtros || {};
                viewAtiva.filtros.tipos = { ...(viewAtiva.filtros.tipos || {}), [tipo]: input.checked };
                rerenderCalendario();
            }
        };
    });

    const grid = root.querySelector("#calGrid");
    const gerarCardHTML = (titulo, valor, extra = "") => {
        const texto = valor ? `${titulo} \u2022 ${valor}` : titulo;
        return `<div class="event-card-title">${escapeHtml(texto)}</div>${extra}`;
    };
    const diasParaRenderizar = montarDatasCalendario(exibindoAno, exibindoMes, ehSemana, grid, inicioSemanaCalendario);
    if (ehSemana) {
        const horasHtml = Array.from({ length: 24 }, (_, hora) => (
            `<span class="cal-week-hour-label ${[0, 6, 12, 18].includes((hora + horaViradaCalendario) % 24) ? "is-major" : ""}" style="--hour-ratio: ${hora / 24}">${String((hora + horaViradaCalendario) % 24).padStart(2, "0")}:00</span>`
        )).join("");
        grid.insertAdjacentHTML("afterbegin", `<div class="cal-week-hour-rail">${horasHtml}</div>`);
    }

    diasParaRenderizar.forEach(dataObj => {
        const dia = dataObj.getDate();
        const mes = dataObj.getMonth();
        const ano = dataObj.getFullYear();
        const isoDate = dataObj.toLocaleDateString("en-CA");
        const stringFeriado = `${(mes + 1).toString().padStart(2, "0")}-${dia.toString().padStart(2, "0")}`;
        const diaBox = document.createElement("div");
        diaBox.className = "cal-day" + (isoDate === hojeLocal ? " today" : "") + (feriadosDoAno.includes(stringFeriado) ? " holiday" : "");
        diaBox.dataset.horaVirada = String(horaViradaCalendario);
        diaBox.innerHTML = `<div class="cal-number">${dia}</div>`;
        if (ehSemana) {
            const linhasPrincipais = [0, 6, 12, 18].map(hora => (
                `<span class="cal-week-major-line" style="--major-ratio: ${getMinutosRelativosAoDia(hora * 60, horaViradaCalendario) / (24 * 60)}"></span>`
            )).join("");
            diaBox.insertAdjacentHTML("beforeend", `<div class="cal-week-major-lines">${linhasPrincipais}</div>`);
        }
        let indiceSemHorario = 0;
        const eventosPorHorario = new Map();
        const adicionarEventoDia = (elemento, hora = "", duracaoMinutos = 60) => {
            if (ehSemana) {
                const semHorario = minutosDoHorario(hora) > 24 * 60;
                posicionarEventoSemanal(elemento, hora, semHorario ? indiceSemHorario++ : 0, duracaoMinutos, horaViradaCalendario);
                if (!semHorario) {
                    const chaveHorario = String(minutosDoHorario(hora));
                    const grupo = eventosPorHorario.get(chaveHorario) || [];
                    grupo.push(elemento);
                    eventosPorHorario.set(chaveHorario, grupo);
                    grupo.forEach((evento, index) => {
                        evento.style.left = `calc(5px + (${index} * ((100% - 10px) / ${grupo.length})))`;
                        evento.style.right = "auto";
                        evento.style.width = `calc(((100% - 10px) / ${grupo.length}) - 3px)`;
                    });
                }
            }
            diaBox.appendChild(elemento);
        };

        if (ehSemana && mostrarTipo("feriados") && feriadosDoAno.includes(stringFeriado)) {
            diaBox.insertAdjacentHTML("beforeend", `<div class="cal-feriado-tag">Feriado</div>`);
        }

        if (mostrarTipo("salario") && dia === calcularDiaSalarioConfigurado(state.configuracoes, mes, ano, feriadosDoAno)) {
            const valSal = state.salarioFixoBase ? `R$ ${formatarValor(state.salarioFixoBase)}` : null;
            const divSalario = document.createElement("div");
            divSalario.className = "cal-event event-salary";
            divSalario.innerHTML = gerarCardHTML("Sal\u00e1rio", valSal);
            adicionarEventoDia(divSalario);
        }

        const mDataFix = state.dados?.[ano]?.meses?.[mes];
        const listaReceitas = mDataFix?.receitasSnapshot ? mDataFix.receitasSnapshot : state.receitasFixas;
        if (mostrarTipo("receitas") && listaReceitas) {
            listaReceitas.forEach(rf => {
                if (rf.ativo && parseInt(rf.dia) === dia) {
                    const desativada = mDataFix?.receitasDesativadas?.[rf.id] === true;
                    const divReceita = document.createElement("div");
                    divReceita.className = "cal-event event-salary";
                    if (desativada) divReceita.classList.add("is-paid");
                    divReceita.innerHTML = gerarCardHTML(rf.nome, `R$ ${formatarValor(rf.valor)}`);
                    adicionarEventoDia(divReceita);
                }
            });
        }

        if (mostrarTipo("cartoes")) {
            state.cartoes.forEach(c => {
                if (parseInt(c.vencimento) === dia) {
                    const totalV = (state.gastosDetalhes[ano] || []).filter(g => g.mes === mes && String(g.cartaoId) === String(c.id) && g.checked !== false).reduce((acc, g) => acc + g.valor, 0);
                    const totalF = state.contasFixas.filter(f => f.ativo && String(f.cartaoId) === String(c.id)).reduce((acc, f) => acc + f.valor, 0);
                    const isPago = state.dados?.[ano]?.meses?.[mes]?.cartoesPagos?.[c.id] === true;
                    const divFatura = document.createElement("div");
                    divFatura.className = "cal-event event-card";
                    divFatura.classList.toggle("is-paid", isPago);
                    divFatura.innerHTML = gerarCardHTML(c.nome, `R$ ${formatarValor(totalV + totalF)}`);
                    divFatura.onclick = (e) => {
                        e.stopPropagation();
                        actions.abrirGastoCalendario?.({ tipo: "manual", ano, mes, cartaoId: c.id });
                    };
                    adicionarEventoDia(divFatura);
                }
            });
        }

        const listaFixas = mDataFix?.fixasSnapshot ? mDataFix.fixasSnapshot : state.contasFixas;
        if (listaFixas) {
            listaFixas.forEach(f => {
                if (mostrarTipo("fixas") && f.ativo && parseInt(f.dia) === dia && mostrarCategoriaFinanceira(f.categoria)) {
                    const valorEfetivo = (mDataFix?.fixasEditadas?.[f.id] !== undefined) ? mDataFix.fixasEditadas[f.id] : f.valor;
                    const isPago = mDataFix?.fixasDesativadas?.[f.id] !== true;
                    const divFixo = document.createElement("div");
                    divFixo.className = "cal-event event-expense";
                    divFixo.classList.toggle("is-paid", isPago);
                    divFixo.innerHTML = gerarCardHTML(f.nome, `R$ ${formatarValor(valorEfetivo)}`);
                    divFixo.onclick = (e) => {
                        e.stopPropagation();
                        actions.abrirGastoCalendario?.({ tipo: "fixa", ano, mes, cartaoId: f.cartaoId });
                    };
                    adicionarEventoDia(divFixo);
                }
            });
        }

        if (mDataFix?.despesas) {
            mDataFix.despesas.forEach(d => {
                const dataDespesa = d.data || isoDataMes(ano, mes, d.dia || 1);
                if (mostrarTipo("variaveis") && dataDespesa === isoDate && mostrarCategoriaFinanceira(d.categoria)) {
                    const divVar = document.createElement("div");
                    divVar.className = "cal-event event-variable";
                    divVar.classList.toggle("is-paid", d.checked);
                    divVar.innerHTML = gerarCardHTML(d.nome, `R$ ${formatarValor(d.valor)}`);
                    divVar.onclick = (e) => {
                        e.stopPropagation();
                        actions.abrirGastoCalendario?.({ tipo: "importado", ano, mes });
                    };
                    adicionarEventoDia(divVar);
                }
            });
        }

        state.lembretes
            .filter(l => mostrarLembrete(l) && lembreteOcorreNaData(l, new Date(dataObj)))
            .sort((a, b) => minutosDoHorario(a.hora) - minutosDoHorario(b.hora))
            .forEach(l => {
                const ev = document.createElement("div");
                ev.className = "cal-event event-reminder";
                const cat = getCategoriaLembrete(l.categoriaId);
                if (cat?.cor) {
                    ev.style.setProperty("--lembrete-cor", cat.cor);
                    ev.style.setProperty("--lembrete-bg", corComOpacidade(cat.cor, 0.8));
                    ev.style.color = getCorTextoContraste(cat.cor);
                }
                const horaFormatada = l.hora ? `${l.hora} \u2022 ` : "";
                const valorFmt = (l.valor && l.valor > 0) ? `R$ ${formatarValor(l.valor)}` : null;
                const anotacoesHtml = ehSemana && l.anotacoes ? `<div class="event-card-notes">${escapeHtml(l.anotacoes)}</div>` : "";
                const subtarefasHtml = ehSemana && l.subtarefas?.length ? `<div class="cal-subtarefas">${l.subtarefas.map(st => `
                    <label>
                        <input type="checkbox" data-lembrete-id="${l.id}" data-subtarefa-id="${st.id}" ${st.concluida ? "checked" : ""}>
                        <span>${escapeHtml(st.texto)}</span>
                    </label>
                `).join("")}</div>` : "";
                ev.innerHTML = gerarCardHTML(`${horaFormatada}${l.nome}`, valorFmt, anotacoesHtml + subtarefasHtml);
                ev.onclick = (e) => { e.stopPropagation(); actions.abrirPostit?.(l); };
                ev.querySelectorAll(".cal-subtarefas input").forEach(input => {
                    input.onclick = (e) => e.stopPropagation();
                    input.onchange = (e) => {
                        e.stopPropagation();
                        const alternar = actions.alternarSubtarefaLembrete || window.alternarSubtarefaLembrete;
                        alternar?.(input.dataset.lembreteId, input.dataset.subtarefaId, input.checked);
                    };
                });
                adicionarEventoDia(ev, l.hora);
            });

        const btnGhost = document.createElement("div");
        btnGhost.className = "btn-add-ghost";
        btnGhost.innerHTML = "+";
        const abrirLembreteNoDia = (e, horario = "") => {
            e.stopPropagation();
            if (window.resetEdicao) window.resetEdicao();
            const dataInput = document.getElementById("lemData");
            if (dataInput) dataInput.value = isoDate;
            const horaInput = document.getElementById("lemHora");
            if (horaInput && horario) horaInput.value = horario;
            const modal = document.getElementById("modalLembrete");
            if (modal) modal.style.display = "flex";
        };
        btnGhost.onclick = (e) => abrirLembreteNoDia(e, ehSemana ? btnGhost.dataset.hora || "" : "");
        if (ehSemana) {
            btnGhost.classList.add("cal-week-add-ghost");
            btnGhost.innerHTML = `<span>+</span><strong>00:00</strong>`;
            diaBox.onmousemove = (e) => {
                if (e.target.closest(".cal-event")) return;
                const snap = obterHorarioSnapSemana(e, diaBox);
                btnGhost.dataset.hora = snap.horario;
                btnGhost.style.setProperty("--ghost-top", `${snap.topPx}px`);
                const label = btnGhost.querySelector("strong");
                if (label) label.textContent = snap.horario;
            };
            diaBox.onclick = (e) => {
                if (e.target.closest(".cal-event, .cal-feriado-tag")) return;
                const snap = obterHorarioSnapSemana(e, diaBox);
                abrirLembreteNoDia(e, snap.horario);
            };
        }
        diaBox.appendChild(btnGhost);
        grid.appendChild(diaBox);
    });

    if (!ehSemana) {
        const totalCelulas = grid.children.length;
        const alvo = totalCelulas <= 35 ? 35 : 42;
        for (let diaOutroMes = 1; grid.children.length < alvo; diaOutroMes++) {
            grid.insertAdjacentHTML("beforeend", `<div class="cal-day other-month"><div class="cal-number">${diaOutroMes}</div></div>`);
        }
    }
}
