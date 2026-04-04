// calendario.js

// Variável para controlar qual mês está sendo exibido
let dataFoco = new Date();

export function calcularDiaPagamento(diaUtilAlvo, mes, ano) {
    const feriadosFixos = [
  '01-01', // Confraternização Universal
  '02-17', // Carnaval (variável - exemplo 2026)
  '04-03', // Sexta-feira Santa (variável - 2026)
  '04-21', // Tiradentes
  '05-01', // Dia do Trabalho
  '06-04', // Corpus Christi (variável - 2026)
  '09-07', // Independência
  '10-12', // Nossa Senhora Aparecida
  '11-02', // Finados
  '11-15', // Proclamação da República
  '11-20', // Consciência Negra (nacional desde 2023)
  '12-25'  // Natal
];

    let diasUteisEncontrados = 0;
    let diaAtual = 1;

    while (diasUteisEncontrados < diaUtilAlvo && diaAtual <= 31) {
        let data = new Date(ano, mes, diaAtual);
        if (data.getMonth() !== mes) break;

        const diaDaSemana = data.getDay();
        const stringData = `${(mes + 1).toString().padStart(2, '0')}-${diaAtual.toString().padStart(2, '0')}`;
        
        // Sábado conta, Domingo e Feriado não
        const ehTrabalhavel = (diaDaSemana !== 0) && !feriadosFixos.includes(stringData);

        if (ehTrabalhavel) diasUteisEncontrados++;
        if (diasUteisEncontrados < diaUtilAlvo) diaAtual++;
    }
    return diaAtual;
}

export function renderCalendario(state, actions) {
    const area = document.getElementById("areaCalendario");
    if (!area) return;

    const hoje = new Date();
    const nomesMeses = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
    const exibindoMes = dataFoco.getMonth();
    const exibindoAno = dataFoco.getFullYear();

    area.innerHTML = `
        <div class="cal-top-actions">
            <div class="cal-nav-buttons">
                <button class="btn" id="btnPrevMonth"> < </button>
                <button class="btn" id="btnToday">Hoje</button>
                <button class="btn" id="btnNextMonth"> > </button>
            </div>
            <button class="btn" id="btnNovoLembrete">+ Lembrete</button>
        </div>
        <div class="calendario-container">
            <div class="cal-header"><h2>${nomesMeses[exibindoMes]} ${exibindoAno}</h2></div>
            <div class="cal-grid" id="calGrid"></div>
        </div>`;

    // ... (mantenha os eventos de click dos botões prev/next/today/novo que você já tem) ...
    document.getElementById("btnPrevMonth").onclick = () => { dataFoco.setMonth(dataFoco.getMonth() - 1); renderCalendario(state, actions); };
    document.getElementById("btnNextMonth").onclick = () => { dataFoco.setMonth(dataFoco.getMonth() + 1); renderCalendario(state, actions); };
    document.getElementById("btnToday").onclick = () => { dataFoco = new Date(); renderCalendario(state, actions); };
    document.getElementById("btnNovoLembrete").onclick = () => document.getElementById("modalLembrete").style.display = "flex";

    const grid = document.getElementById("calGrid");
    ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"].forEach(d => grid.innerHTML += `<div class="cal-day-name">${d}</div>`);

    const primeiroDiaSemana = new Date(exibindoAno, exibindoMes, 1).getDay();
    const ultimoDiaMes = new Date(exibindoAno, exibindoMes + 1, 0).getDate();
    for (let i = 0; i < primeiroDiaSemana; i++) grid.innerHTML += `<div class="cal-day other-month"></div>`;

    for (let dia = 1; dia <= ultimoDiaMes; dia++) {
        const diaBox = document.createElement("div");
        diaBox.title = "Adicionar lembrete"; 
        const stringData = `${(exibindoMes + 1).toString().padStart(2, '0')}-${dia.toString().padStart(2, '0')}`;
        const dataStringIso = `${exibindoAno}-${(exibindoMes + 1).toString().padStart(2, '0')}-${dia.toString().padStart(2, '0')}`;
        
        // --- NOVO: FUNÇÃO DE CLIQUE NO DIA ---
        diaBox.onclick = () => {
            const modal = document.getElementById("modalLembrete");
            const inputData = document.getElementById("lemData");
            if (modal && inputData) {
                inputData.value = dataStringIso; // Preenche a data do dia clicado
                modal.style.display = "flex";
            }
        };

        const isHoje = dia === hoje.getDate() && exibindoMes === hoje.getMonth() && exibindoAno === hoje.getFullYear();
        diaBox.className = "cal-day" + (isHoje ? " today" : "") + (['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'].includes(stringData) ? " holiday" : "");
        diaBox.innerHTML = `<div class="cal-number">${dia}</div>`;

        // 1. CARTÕES (Fechamento e Vencimento)
        state.cartoes.forEach(c => {
            // Notificação de Fechamento
            if (parseInt(c.fechamento) === dia) {
                diaBox.innerHTML += `<div class="cal-event event-closing">🔒 ${c.nome}</div>`;
            }
            // Notificação de Vencimento com VALOR
            if (parseInt(c.vencimento) === dia) {
                const totalVariavel = (state.gastosDetalhes && state.gastosDetalhes[exibindoAno] ? state.gastosDetalhes[exibindoAno] : [])
                    .filter(g => g.mes === exibindoMes && String(g.cartaoId) === String(c.id))
                    .reduce((acc, g) => acc + g.valor, 0);
                const totalFixo = state.contasFixas
                    .filter(f => f.ativo && String(f.cartaoId) === String(c.id))
                    .reduce((acc, f) => acc + f.valor, 0);
                
                const total = totalVariavel + totalFixo;
                diaBox.innerHTML += `<div class="cal-event event-card">💳 ${c.nome}: R$ ${total.toLocaleString('pt-BR', {minimumFractionDigits:2})}</div>`;
            }
        });

        // 2. DESPESAS FIXAS (Apenas se não forem no cartão)
        state.contasFixas.forEach(f => {
            if (f.ativo && parseInt(f.dia) === dia && !f.cartaoId) {
                diaBox.innerHTML += `<div class="cal-event event-expense">${f.nome}: R$ ${f.valor.toLocaleString('pt-BR', {minimumFractionDigits:2})}</div>`;
            }
        });

        // 3. RENDAS FIXAS
        state.receitasFixas.forEach(r => {
            if (r.ativo && parseInt(r.dia) === dia) {
                diaBox.innerHTML += `<div class="cal-event event-income">${r.nome}: R$ ${r.valor.toLocaleString('pt-BR', {minimumFractionDigits:2})}</div>`;
            }
        });

    // 4. LEMBRETES (NORMAIS + RECORRENTES)
            const isoData = `${exibindoAno}-${(exibindoMes + 1).toString().padStart(2, '0')}-${dia.toString().padStart(2, '0')}`;
            const dataObj = new Date(exibindoAno, exibindoMes, dia);
            const diaSemana = dataObj.getDay();

            state.lembretes.filter(l => {
                // Se for data fixa OU se for recorrente e cair no dia da semana selecionado
                return l.data === isoData || (l.recorrente && l.diasSemana && l.diasSemana.includes(diaSemana));
            }).forEach(l => {
                const ev = document.createElement("div");
                ev.className = "cal-event event-reminder";
                const textoValor = l.valor ? ` | R$ ${l.valor.toLocaleString('pt-BR')}` : "";
                ev.innerText = `📌 ${l.hora ? l.hora + ' ' : ''}${l.nome}${textoValor}`;
                ev.onclick = (e) => { e.stopPropagation(); actions.abrirPostit(l); };
                diaBox.appendChild(ev);
            });

        grid.appendChild(diaBox);
    }
}