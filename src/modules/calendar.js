let dataFoco = new Date();
let cacheFeriados = {};
let visaoAtual = 'mensal';

export async function obterFeriados(ano) {
    if (cacheFeriados[ano]) return cacheFeriados[ano];
    try {
        const response = await fetch(`https://brasilapi.com.br/api/feriados/v1/${ano}`);
        if (!response.ok) throw new Error('Falha na API');
        const dados = await response.json();
        cacheFeriados[ano] = dados.map(f => f.date.substring(5)); 
        return cacheFeriados[ano];
    } catch (e) {
        return ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'];
    }
}

export function calcularDiaPagamento(diaUtilAlvo, mes, ano, feriadosDoAno = []) {
    let diasUteisEncontrados = 0;
    let diaAtual = 1;
    while (diasUteisEncontrados < diaUtilAlvo && diaAtual <= 31) {
        let data = new Date(ano, mes, diaAtual);
        if (data.getMonth() !== mes) break;
        const ehTrabalhavel = (data.getDay() !== 0) && !feriadosDoAno.includes(`${(mes + 1).toString().padStart(2, '0')}-${diaAtual.toString().padStart(2, '0')}`);
        if (ehTrabalhavel) diasUteisEncontrados++;
        if (diasUteisEncontrados < diaUtilAlvo) diaAtual++;
    }
    return diaAtual;
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

function minutosDoHorario(hora) {
    if (!hora) return 24 * 60 + 1;
    const match = String(hora).match(/^(\d{1,2}):(\d{2})/);
    if (!match) return 24 * 60 + 1;
    return (Number(match[1]) * 60) + Number(match[2]);
}

export async function renderCalendario(state, actions) {
    const area = document.getElementById("areaCalendario");
    if (!area) return;

    const exibindoAno = dataFoco.getFullYear();
    const exibindoMes = dataFoco.getMonth();
    const feriadosDoAno = await obterFeriados(exibindoAno);
    const nomesMeses = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
    const hojeLocal = new Date().toLocaleDateString('en-CA');
    
    // Define se é visão semanal para as funções internas
    const ehSemana = visaoAtual === 'semanal';
    const viewAtiva = state.viewCalendarioAtiva || state.configuracoes?.viewsCalendario?.find(view => String(view.id) === String(state.configuracoes?.viewCalendarioAtiva)) || state.configuracoes?.viewsCalendario?.[0];
    const configExibicao = viewAtiva?.filtros || state.configuracoes?.exibicaoCalendario || {};
    const tipos = configExibicao.tipos || {};
    const categoriasLembretesFiltro = Array.isArray(configExibicao.categoriasLembretes) ? configExibicao.categoriasLembretes.map(String) : [];
    const categoriasFinanceirasFiltro = Array.isArray(configExibicao.categoriasFinanceiras) ? configExibicao.categoriasFinanceiras : [];
    const mostrarTipo = (tipo) => tipos[tipo] !== false;
    const mostrarCategoriaFinanceira = (categoria) => categoriasFinanceirasFiltro.length === 0 || categoriasFinanceirasFiltro.includes(categoria);
    const getCategoriaLembrete = (id) => (state.categoriasLembretes || []).find(cat => String(cat.id) === String(id));
    const mostrarLembrete = (l) => mostrarTipo("lembretes") && (categoriasLembretesFiltro.length === 0 || categoriasLembretesFiltro.includes(String(l.categoriaId)));

    area.innerHTML = `
        <div class="cal-top-actions">
            <div class="cal-nav-buttons">
                <button class="btn" id="btnConfigCalendario">&#9881;</button>
                <button class="btn" id="btnPrev"> < </button>
                <button class="btn" id="btnToday">Hoje</button>
                <button class="btn" id="btnNext"> > </button>
                <div class="toggle-group" style="margin-left: 10px;">
                    <button class="btn-toggle ${visaoAtual === 'mensal' ? 'active' : ''}" id="viewMensal">Mensal</button>
                    <button class="btn-toggle ${visaoAtual === 'semanal' ? 'active' : ''}" id="viewSemanal">Semanal</button>
                </div>
                <div class="toggle-group calendar-views-group" style="margin-left: 10px;">
                    ${(state.configuracoes?.viewsCalendario || []).map(view => `
                        <button class="btn-toggle ${String(view.id) === String(state.configuracoes?.viewCalendarioAtiva) ? 'active' : ''}" data-cal-view="${view.id}">${view.nome}</button>
                    `).join("")}
                    <button class="btn-toggle" id="btnAddViewCalendario">+</button>
                </div>
            </div>
            <button class="btn" id="btnNovoLembrete">+ Lembrete</button>
        </div>
        <div class="calendario-container">
            <div class="cal-header"><h2>${nomesMeses[exibindoMes]} ${exibindoAno}</h2></div>
            <div class="cal-grid ${ehSemana ? 'weekly-view' : ''}" id="calGrid"></div>
        </div>`;

    // Eventos de Navegação
    document.getElementById("btnPrev").onclick = () => { 
        if(!ehSemana) dataFoco.setMonth(exibindoMes - 1);
        else dataFoco.setDate(dataFoco.getDate() - 7);
        renderCalendario(state, actions); 
    };
    document.getElementById("btnNext").onclick = () => { 
        if(!ehSemana) dataFoco.setMonth(exibindoMes + 1);
        else dataFoco.setDate(dataFoco.getDate() + 7);
        renderCalendario(state, actions); 
    };
    document.getElementById("btnToday").onclick = () => { dataFoco = new Date(); renderCalendario(state, actions); };
    document.getElementById("viewMensal").onclick = () => { visaoAtual = 'mensal'; renderCalendario(state, actions); };
    document.getElementById("viewSemanal").onclick = () => { visaoAtual = 'semanal'; renderCalendario(state, actions); };
    document.getElementById("btnConfigCalendario").onclick = () => actions.abrirConfiguracoesCalendario?.();
    document.querySelectorAll("[data-cal-view]").forEach(btn => {
        btn.onclick = () => actions.selecionarViewCalendario?.(btn.dataset.calView);
    });
    document.getElementById("btnAddViewCalendario").onclick = () => actions.criarViewCalendario?.();
    document.getElementById("btnNovoLembrete").onclick = () => {
        if(window.resetEdicao) window.resetEdicao();
        document.getElementById("modalLembrete").style.display = "flex";
    };

    const grid = document.getElementById("calGrid");
    ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"].forEach(d => grid.innerHTML += `<div class="cal-day-name">${d}</div>`);

    // Funções Auxiliares de Formatação
    const fmt = (v) => {
        const num = parseFloat(v);
        return isNaN(num) ? "0,00" : num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    const gerarCardHTML = (titulo, label, valor, comPin = false) => {
        const prefixo = comPin ? "📌 " : "";
        return `<div class="event-card-label">${label}</div><div class="event-card-title">${prefixo}${titulo}</div>${valor ? `<div class="event-card-value">${valor}</div>` : ''}`;
    };

    // Lógica de Dias
    let diasParaRenderizar = [];
    if (!ehSemana) {
        const primeiroDiaSemana = new Date(exibindoAno, exibindoMes, 1).getDay();
        const ultimoDiaMes = new Date(exibindoAno, exibindoMes + 1, 0).getDate();
        for (let i = 0; i < primeiroDiaSemana; i++) grid.innerHTML += `<div class="cal-day other-month"></div>`;
        for (let d = 1; d <= ultimoDiaMes; d++) diasParaRenderizar.push(new Date(exibindoAno, exibindoMes, d));
    } else {
        const d = new Date(dataFoco);
        const diff = d.getDate() - d.getDay();
        const domingo = new Date(d.setDate(diff));
        for (let i = 0; i < 7; i++) {
            diasParaRenderizar.push(new Date(domingo));
            domingo.setDate(domingo.getDate() + 1);
        }
    }

    diasParaRenderizar.forEach(dataObj => {
        const dia = dataObj.getDate();
        const mes = dataObj.getMonth();
        const ano = dataObj.getFullYear();
        const isoDate = dataObj.toLocaleDateString('en-CA'); 
        const stringFeriado = `${(mes + 1).toString().padStart(2, '0')}-${dia.toString().padStart(2, '0')}`;

        const diaBox = document.createElement("div");
        diaBox.className = "cal-day" + (isoDate === hojeLocal ? " today" : "") + (feriadosDoAno.includes(stringFeriado) ? " holiday" : "");
        diaBox.innerHTML = `<div class="cal-number">${dia}</div>`;
        
        if (ehSemana && mostrarTipo("feriados") && feriadosDoAno.includes(stringFeriado)) {
            diaBox.innerHTML += `<div class="cal-feriado-tag">Feriado</div>`;
        }

        // 1. SALÁRIO
        if (mostrarTipo("salario") && dia === calcularDiaPagamento(state.configuracoes.diaSalario || 5, mes, ano, feriadosDoAno)) {
            const valSal = state.salarioFixoBase ? `R$ ${fmt(state.salarioFixoBase)}` : null;
            diaBox.innerHTML += `<div class="cal-event event-salary">${gerarCardHTML("💸 Salário", "Renda", valSal)}</div>`;
        }

        // 2. CARTÕES
        if (mostrarTipo("cartoes")) state.cartoes.forEach(c => {
            if (parseInt(c.vencimento) === dia) {
                const totalV = (state.gastosDetalhes[ano] || []).filter(g => g.mes === mes && String(g.cartaoId) === String(c.id)).reduce((acc, g) => acc + g.valor, 0);
                const totalF = state.contasFixas.filter(f => f.ativo && String(f.cartaoId) === String(c.id)).reduce((acc, f) => acc + f.valor, 0);
                
                const isPago = state.dados?.[ano]?.meses?.[mes]?.cartoesPagos?.[c.id] === true;
                const divFatura = document.createElement("div");
                divFatura.className = "cal-event event-card";
                divFatura.style.backgroundColor = c.color || 'var(--P04)';
                divFatura.style.opacity = isPago ? '0.5' : '1';
                divFatura.innerHTML = (isPago ? '✅ ' : '') + gerarCardHTML(`Fatura ${c.nome}`, "Cartão", `R$ ${fmt(totalV + totalF)}`);
                diaBox.appendChild(divFatura);
            }
        });

        // 3. FIXAS
        const mDataFix = state.dados?.[ano]?.meses?.[mes];
        const listaFixas = mDataFix?.fixasSnapshot ? mDataFix.fixasSnapshot : state.contasFixas;
        if (listaFixas) {
            listaFixas.forEach(f => {
                if (mostrarTipo("fixas") && f.ativo && parseInt(f.dia) === dia && mostrarCategoriaFinanceira(f.categoria)) {
                    const valorEfetivo = (mDataFix?.fixasEditadas?.[f.id] !== undefined) ? mDataFix.fixasEditadas[f.id] : f.valor;
                    const isPago = mDataFix?.fixasDesativadas?.[f.id] !== true;
                    const divFixo = document.createElement("div");
                    divFixo.className = "cal-event event-expense";
                    divFixo.style.opacity = isPago ? '0.6' : '1';
                    divFixo.innerHTML = (isPago ? '✅ ' : '') + gerarCardHTML(f.nome, "Fixa", `R$ ${fmt(valorEfetivo)}`);
                    diaBox.appendChild(divFixo);
                }
            });
        }

        // 4. VARIÁVEIS
        if (mDataFix && mDataFix.despesas) {
            mDataFix.despesas.forEach(d => {
                if (mostrarTipo("variaveis") && d.dia && parseInt(d.dia) === dia && mostrarCategoriaFinanceira(d.categoria)) {
                    const divVar = document.createElement("div");
                    divVar.className = "cal-event";
                    divVar.style.opacity = d.checked ? '0.5' : '1';
                    divVar.style.borderLeft = '3px solid #e67e22';
                    divVar.style.background = 'rgba(230, 126, 34, 0.1)';
                    divVar.innerHTML = (d.checked ? '✅ ' : '') + gerarCardHTML(d.nome, "Variável", `R$ ${fmt(d.valor)}`);
                    diaBox.appendChild(divVar);
                }
            });
        }

        // 5. LEMBRETES
        state.lembretes
            .filter(l => mostrarLembrete(l) && (l.data === isoDate || (l.recorrente && l.diasSemana?.includes(dataObj.getDay()))))
            .sort((a, b) => minutosDoHorario(a.hora) - minutosDoHorario(b.hora))
            .forEach(l => {
            const ev = document.createElement("div");
            ev.className = "cal-event event-reminder";
            const cat = getCategoriaLembrete(l.categoriaId);
            if (cat?.cor) {
                ev.style.backgroundColor = cat.cor;
                ev.style.borderColor = cat.cor;
                ev.style.color = getCorTextoContraste(cat.cor);
            }
            const horaFormatada = l.hora ? l.hora + ": " : "";
            const valorFmt = (l.valor && l.valor > 0) ? `R$ ${fmt(l.valor)}` : null;
            ev.innerHTML = gerarCardHTML(`${horaFormatada}${l.nome}`, "Lembrete", valorFmt, true);
            ev.onclick = (e) => { e.stopPropagation(); actions.abrirPostit(l); };
            diaBox.appendChild(ev);
        });

        // Botão Ghost
        const btnGhost = document.createElement("div");
        btnGhost.className = "btn-add-ghost"; btnGhost.innerHTML = "+";
        btnGhost.onclick = (e) => { e.stopPropagation(); if(window.resetEdicao) window.resetEdicao(); document.getElementById("lemData").value = isoDate; document.getElementById("modalLembrete").style.display = "flex"; };
        diaBox.appendChild(btnGhost);

        grid.appendChild(diaBox);
    });
}
