let dataFoco = new Date();
let cacheFeriados = {};
let visaoAtual = 'mensal';
let lembretes = [];

export async function obterFeriados(ano) {
    if (cacheFeriados[ano]) return cacheFeriados[ano];
    
    try {
        const response = await fetch(`https://brasilapi.com.br/api/feriados/v1/${ano}`);
        
        // Se a resposta não for OK, lança erro para cair no catch
        if (!response.ok) throw new Error('Falha na API');
        
        const dados = await response.json();
        cacheFeriados[ano] = dados.map(f => f.date.substring(5)); 
        return cacheFeriados[ano];
    } catch (e) {
        console.warn("Usando feriados padrão devido a erro na API");
        // Retorna lista padrão para não quebrar o código
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

const getHojeLocalISO = () => new Date().toLocaleDateString('en-CA'); 

export async function renderCalendario(state, actions) {
    const area = document.getElementById("areaCalendario");
    if (!area) return;

    const exibindoAno = dataFoco.getFullYear();
    const exibindoMes = dataFoco.getMonth();
    const feriadosDoAno = await obterFeriados(exibindoAno);
    const nomesMeses = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
    
    const hojeLocal = new Date().toLocaleDateString('en-CA');

    area.innerHTML = `
        <div class="cal-top-actions">
            <div class="cal-nav-buttons">
                <button class="btn" id="btnPrev"> < </button>
                <button class="btn" id="btnToday">Hoje</button>
                <button class="btn" id="btnNext"> > </button>
                <div class="toggle-group" style="margin-left: 10px;">
                    <button class="btn-toggle ${visaoAtual === 'mensal' ? 'active' : ''}" id="viewMensal">Mensal</button>
                    <button class="btn-toggle ${visaoAtual === 'semanal' ? 'active' : ''}" id="viewSemanal">Semanal</button>
                </div>
            </div>
            <button class="btn" id="btnNovoLembrete">+ Lembrete</button>
        </div>
        <div class="calendario-container">
            <div class="cal-header"><h2>${nomesMeses[exibindoMes]} ${exibindoAno}</h2></div>
            <div class="cal-grid ${visaoAtual === 'semanal' ? 'weekly-view' : ''}" id="calGrid"></div>
        </div>`;

    document.getElementById("btnPrev").onclick = () => { 
        if(visaoAtual === 'mensal') dataFoco.setMonth(exibindoMes - 1);
        else dataFoco.setDate(dataFoco.getDate() - 7);
        renderCalendario(state, actions); 
    };
    document.getElementById("btnNext").onclick = () => { 
        if(visaoAtual === 'mensal') dataFoco.setMonth(exibindoMes + 1);
        else dataFoco.setDate(dataFoco.getDate() + 7);
        renderCalendario(state, actions); 
    };
    document.getElementById("btnToday").onclick = () => { dataFoco = new Date(); renderCalendario(state, actions); };
    document.getElementById("viewMensal").onclick = () => { visaoAtual = 'mensal'; renderCalendario(state, actions); };
    document.getElementById("viewSemanal").onclick = () => { visaoAtual = 'semanal'; renderCalendario(state, actions); };
    document.getElementById("btnNovoLembrete").onclick = () => {
        if(window.resetEdicao) window.resetEdicao();
        document.getElementById("modalLembrete").style.display = "flex";
    };

    const grid = document.getElementById("calGrid");
    ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"].forEach(d => grid.innerHTML += `<div class="cal-day-name">${d}</div>`);

    let diasParaRenderizar = [];
    if (visaoAtual === 'mensal') {
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
        const ehSemana = visaoAtual === 'semanal';

        const diaBox = document.createElement("div");
        diaBox.className = "cal-day" + (isoDate === hojeLocal ? " today" : "") + (feriadosDoAno.includes(stringFeriado) ? " holiday" : "");
        diaBox.setAttribute("data-date", isoDate);
        diaBox.setAttribute("data-day-index", dataObj.getDay());

        diaBox.innerHTML = `<div class="cal-number">${dia}</div>`;
        if (ehSemana && feriadosDoAno.includes(stringFeriado)) {
            diaBox.innerHTML += `<div class="cal-feriado-tag">Feriado</div>`;
        }

        const gerarCardHTML = (titulo, label, valor, comPin = false) => {
            const prefixo = comPin ? "📌 " : "";
            if (!ehSemana) return prefixo + titulo + (valor ? `: ${valor}` : "");
            return `<div class="event-card-label">${label}</div><div class="event-card-title">${prefixo}${titulo}</div>${valor ? `<div class="event-card-value">${valor}</div>` : ''}`;
        };

        // --- FORMATADOR DE MOEDA COM 2 CASAS DECIMAIS ---
        const fmt = (v) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        // SALÁRIO
        if (dia === calcularDiaPagamento(state.configuracoes.diaSalario || 5, mes, ano, feriadosDoAno)) {
            const valSal = state.salarioFixoBase ? `R$ ${fmt(state.salarioFixoBase)}` : null;
            diaBox.innerHTML += `<div class="cal-event event-salary">${gerarCardHTML("💸 Salário", "Renda", valSal)}</div>`;
        }

        // CARTÕES
        state.cartoes.forEach(c => {
            if (parseInt(c.fechamento) === dia) diaBox.innerHTML += `<div class="cal-event event-closing">🔒 Fech. ${c.nome}</div>`;
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

        // DESPESAS FIXAS E ASSINATURAS
        const mDataFix = state.dados?.[ano]?.meses?.[mes];
        const listaFixas = mDataFix?.fixasSnapshot ? mDataFix.fixasSnapshot : state.contasFixas;
        if (listaFixas) {
            listaFixas.forEach(f => {
                if (f.ativo && parseInt(f.dia) === dia && mDataFix?.fixasDesativadas?.[f.id] !== true) {
                    const valorEfetivo = (mDataFix?.fixasEditadas?.[f.id] !== undefined) ? mDataFix.fixasEditadas[f.id] : f.valor;
                    const isPago = mDataFix?.fixasDesativadas?.[f.id] !== true;
                    const divFixo = document.createElement("div");
                    divFixo.className = "cal-event event-expense";
                    divFixo.style.opacity = isPago ? '0.6' : '1';
                    divFixo.innerHTML = gerarCardHTML((f.cartaoId ? "💳 " : "💸 ") + f.nome, f.cartaoId ? "Cartão" : "Dinheiro", `R$ ${fmt(valorEfetivo)}`);
                    diaBox.appendChild(divFixo);
                }
            });
        }

        // GASTOS VARIÁVEIS (Aqueles que você coloca o dia manualmente no mês)
        if (mDataFix && mDataFix.despesas) {
            mDataFix.despesas.forEach(d => {
                if (d.dia && parseInt(d.dia) === dia) {
                    const divVar = document.createElement("div");
                    divVar.className = "cal-event";
                    divVar.style.opacity = d.checked ? '0.5' : '1';
                    divVar.style.borderLeft = '3px solid #e67e22';
                    divVar.style.background = 'rgba(230, 126, 34, 0.1)';
                    divVar.style.color = 'white';
                    divVar.style.fontSize = '11px';
                    divVar.style.padding = '2px 4px';
                    divVar.style.marginBottom = '2px';
                    divVar.style.borderRadius = '4px';
                    divVar.innerHTML = (d.checked ? '✅ ' : '') + gerarCardHTML(d.nome, "Variável", `R$ ${fmt(d.valor)}`);
                    diaBox.appendChild(divVar);
                }
            });
        }

        // RECEITAS FIXAS
        state.receitasFixas.forEach(r => {
            if (r.ativo && parseInt(r.dia) === dia) {
                diaBox.innerHTML += `<div class="cal-event event-income">${gerarCardHTML(r.nome, "Recebimento", `R$ ${fmt(r.valor)}`)}</div>`;
            }
        });

        // LEMBRETES
        state.lembretes.filter(l => l.data === isoDate || (l.recorrente && l.diasSemana?.includes(dataObj.getDay()))).forEach(l => {
            const ev = document.createElement("div");
            ev.className = "cal-event event-reminder";
            ev.setAttribute("draggable", "true");
            const horaFormatada = l.hora ? l.hora.replace(':', 'h') + ": " : "";
            const tituloHtml = `<div style="display:flex; justify-content:space-between; align-items:center; width:100%;"><span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${ehSemana ? '📌 ' : ''}${horaFormatada}${l.nome}</span><span class="btn-edit-inline" style="cursor:pointer; font-size:12px; margin-left:4px;">✏️</span></div>`;
            if (!ehSemana) { ev.innerHTML = tituloHtml; } 
            else { ev.innerHTML = `<div class="event-card-label">Lembrete</div><div class="event-card-title">${tituloHtml}</div>${l.valor ? `<div class="event-card-value">R$ ${fmt(l.valor)}</div>` : ''}`; }
            ev.ondragstart = (e) => { e.dataTransfer.setData('text/plain', String(l.id)); ev.classList.add('dragging'); };
            ev.ondragend = () => { ev.classList.remove('dragging'); };
            ev.onclick = (e) => { e.stopPropagation(); actions.abrirPostit(l); };
            diaBox.appendChild(ev);
        });

        const btnGhost = document.createElement("div");
        btnGhost.className = "btn-add-ghost"; btnGhost.innerHTML = "+";
        btnGhost.onclick = (e) => { e.stopPropagation(); const campoData = document.getElementById("lemData"); if(campoData) campoData.value = isoDate; if(window.resetEdicao) window.resetEdicao(); document.getElementById("modalLembrete").style.display = "flex"; };
        diaBox.appendChild(btnGhost);
        grid.appendChild(diaBox);
    });
}