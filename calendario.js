let dataFoco = new Date();
let cacheFeriados = {};
let visaoAtual = 'mensal';

async function obterFeriados(ano) {
    if (cacheFeriados[ano]) return cacheFeriados[ano];
    try {
        const response = await fetch(`https://brasilapi.com.br/api/feriados/v1/${ano}`);
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

export async function renderCalendario(state, actions) {
    const area = document.getElementById("areaCalendario");
    if (!area) return;

    const exibindoAno = dataFoco.getFullYear();
    const exibindoMes = dataFoco.getMonth();
    const feriadosDoAno = await obterFeriados(exibindoAno);
    const nomesMeses = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

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
        const isoDate = dataObj.toISOString().split('T')[0];
        const stringFeriado = `${(mes + 1).toString().padStart(2, '0')}-${dia.toString().padStart(2, '0')}`;
        const ehSemana = visaoAtual === 'semanal';

        const diaBox = document.createElement("div");
        diaBox.className = "cal-day" + (isoDate === new Date().toISOString().split('T')[0] ? " today" : "") + (feriadosDoAno.includes(stringFeriado) ? " holiday" : "");
        
        // Atributos necessários para o Drag n Drop saber para onde ir
        diaBox.setAttribute("data-date", isoDate);
        diaBox.setAttribute("data-day-index", dataObj.getDay());

        // --- 1. CLIQUE NO DIA PARA ADICIONAR LEMBRETE ---
        diaBox.onclick = (e) => {
            // Previne que o clique no dia dispare se você clicou num lembrete existente
            if(e.target !== diaBox && !e.target.classList.contains('cal-number') && !e.target.classList.contains('btn-add-ghost')) return;
            
            const campoData = document.getElementById("lemData");
            if(campoData) campoData.value = isoDate;
            if(window.resetEdicao) window.resetEdicao();
            document.getElementById("modalLembrete").style.display = "flex";
        };

        // --- 2. EVENTOS DO DRAG N DROP NO DIA (AQUI ESTAVA FALTANDO) ---
        diaBox.ondragover = (e) => {
            e.preventDefault(); // ISSO É OBRIGATÓRIO
            diaBox.classList.add('drag-over');
        };

        diaBox.ondragleave = () => {
            diaBox.classList.remove('drag-over');
        };

        diaBox.ondrop = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            diaBox.classList.remove('drag-over');
            
            const lembreteId = e.dataTransfer.getData('text/plain');
            const novaData = diaBox.getAttribute('data-date');
            const novoDiaSemana = parseInt(diaBox.getAttribute('data-day-index'));
            
            if (lembreteId && window.atualizarDataLembrete) {
                // Executa a atualização
                window.atualizarDataLembrete(lembreteId, novaData, novoDiaSemana);
            }
            return false; // Ajuda a encerrar o evento para o navegador
        };

        diaBox.innerHTML = `<div class="cal-number">${dia}</div>`;
        if (ehSemana && feriadosDoAno.includes(stringFeriado)) {
            diaBox.innerHTML += `<div class="cal-feriado-tag">Feriado</div>`;
        }

        // Função auxiliar para gerar cards
        const gerarCardHTML = (titulo, label, valor, hora, comPin = false) => {
            const prefixo = comPin ? "📌 " : "";
            if (!ehSemana) return prefixo + titulo + (valor ? `: ${valor}` : "");
            return `
                <div class="event-card-label">${label} ${hora ? '• ' + hora : ''}</div>
                <div class="event-card-title">${prefixo}${titulo}</div>
                ${valor ? `<div class="event-card-value">${valor}</div>` : ''}
            `;
        };

        // --- 3. RESTAURAÇÃO DOS EVENTOS DO SISTEMA ---
        // SALÁRIO
        if (dia === calcularDiaPagamento(state.configuracoes.diaSalario || 5, mes, ano, feriadosDoAno)) {
            diaBox.innerHTML += `<div class="cal-event event-salary">${gerarCardHTML("💸 Pagamento Salário", "Renda", state.salarioFixoBase ? `R$ ${state.salarioFixoBase.toLocaleString('pt-BR')}` : null)}</div>`;
        }

        // CARTÕES
        state.cartoes.forEach(c => {
            if (parseInt(c.fechamento) === dia) diaBox.innerHTML += `<div class="cal-event event-closing">🔒 Fech. ${c.nome}</div>`;
            if (parseInt(c.vencimento) === dia) {
                const totalV = (state.gastosDetalhes[ano] || []).filter(g => g.mes === mes && String(g.cartaoId) === String(c.id)).reduce((acc, g) => acc + g.valor, 0);
                const totalF = state.contasFixas.filter(f => f.ativo && String(f.cartaoId) === String(c.id)).reduce((acc, f) => acc + f.valor, 0);
                diaBox.innerHTML += `<div class="cal-event event-card">${gerarCardHTML(`Fatura ${c.nome}`, "Cartão", `R$ ${(totalV + totalF).toLocaleString('pt-BR')}`)}</div>`;
            }
        });

        // DESPESAS FIXAS
        state.contasFixas.forEach(f => {
            if (f.ativo && parseInt(f.dia) === dia && !f.cartaoId) {
                diaBox.innerHTML += `<div class="cal-event event-expense">${gerarCardHTML(f.nome, "Conta Fixa", `R$ ${f.valor.toLocaleString('pt-BR')}`)}</div>`;
            }
        });

        // RECEITAS FIXAS
        state.receitasFixas.forEach(r => {
            if (r.ativo && parseInt(r.dia) === dia) {
                diaBox.innerHTML += `<div class="cal-event event-income">${gerarCardHTML(r.nome, "Recebimento", `R$ ${r.valor.toLocaleString('pt-BR')}`)}</div>`;
            }
        });

        // --- 4. LEMBRETES (Com horário formatado e Drag n Drop) ---
        state.lembretes.filter(l => l.data === isoDate || (l.recorrente && l.diasSemana?.includes(dataObj.getDay()))).forEach(l => {
            const ev = document.createElement("div");
            ev.className = "cal-event event-reminder";
            ev.setAttribute("draggable", "true");

            // Formata o horário de "09:30" para "09h30"
            const horaFormatada = l.hora ? l.hora.replace(':', 'h') + ": " : "";
            
            const tituloHtml = `
                <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                    <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                        ${ehSemana ? '📌 ' : ''}${horaFormatada}${l.nome}
                    </span>
                    <span class="btn-edit-inline" style="cursor:pointer; font-size:12px; margin-left:4px;">✏️</span>
                </div>
            `;

            if (!ehSemana) {
                ev.innerHTML = tituloHtml;
            } else {
                ev.innerHTML = `
                    <div class="event-card-label">Lembrete</div>
                    <div class="event-card-title">${tituloHtml}</div>
                    ${l.valor ? `<div class="event-card-value">R$ ${l.valor.toLocaleString('pt-BR')}</div>` : ''}
                `;
            }

            // INÍCIO DO ARRASTE (DRAGSTART)
            ev.ondragstart = (e) => {
                e.dataTransfer.setData('text/plain', String(l.id));
                e.dataTransfer.effectAllowed = "move";
                ev.classList.add('dragging');
            };

            ev.ondragend = () => {
                ev.classList.remove('dragging');
            };

            // Clique normal abre o Post-it
            ev.onclick = (e) => { 
                e.stopPropagation(); 
                actions.abrirPostit(l); 
            };

            // Clique no lápis abre em modo edição direto
            const btnLapis = ev.querySelector(".btn-edit-inline");
            btnLapis.onclick = (e) => {
                e.stopPropagation();
                actions.abrirPostit(l);
                setTimeout(() => {
                    const btnEditarP = document.querySelector(".btn-editar-p");
                    if(btnEditarP) btnEditarP.click();
                }, 50);
            };

            diaBox.appendChild(ev);
        });

// --- 5. BOTÃO FANTASMA VERDE (Sempre no final do dia) ---
        const btnGhost = document.createElement("div");
        btnGhost.className = "btn-add-ghost";
        btnGhost.innerHTML = "+";
        btnGhost.title = "Adicionar lembrete";
        
        // O botão tem a mesma função de clique do dia
        btnGhost.onclick = (e) => {
            e.stopPropagation();
            const campoData = document.getElementById("lemData");
            if(campoData) campoData.value = isoDate;
            if(window.resetEdicao) window.resetEdicao();
            document.getElementById("modalLembrete").style.display = "flex";
        };

        // Adiciona ao final da lista de elementos do dia
        diaBox.appendChild(btnGhost);

        grid.appendChild(diaBox);
    });
}