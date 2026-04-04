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

    const hoje = new Date(); // Data real de hoje (para marcar o dia atual)
    const nomesMeses = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

    const exibindoMes = dataFoco.getMonth();
    const exibindoAno = dataFoco.getFullYear();

    area.innerHTML = `
        <div class="cal-top-actions">
            <div class="cal-nav-buttons">
                <button class="btn" id="btnPrevMonth"> <small>< Anterior</small> </button>
                <button class="btn" id="btnToday">Hoje</button>
                <button class="btn" id="btnNextMonth"><small> Próximo > </small> </button>
            </div>
            <button class="btn" id="btnNovoLembrete">+ Lembrete</button>
        </div>
        <div class="calendario-container">
            <div class="cal-header">
                <h2>${nomesMeses[exibindoMes]} ${exibindoAno}</h2>
            </div>
            <div class="cal-grid" id="calGrid"></div>
        </div>`;

    // Eventos dos botões de navegação
    document.getElementById("btnPrevMonth").onclick = () => {
        dataFoco.setMonth(dataFoco.getMonth() - 1);
        renderCalendario(state, actions);
    };

    document.getElementById("btnNextMonth").onclick = () => {
        dataFoco.setMonth(dataFoco.getMonth() + 1);
        renderCalendario(state, actions);
    };

    document.getElementById("btnToday").onclick = () => {
        dataFoco = new Date();
        renderCalendario(state, actions);
    };

    document.getElementById("btnNovoLembrete").onclick = () => document.getElementById("modalLembrete").style.display = "flex";

    const grid = document.getElementById("calGrid");
    ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"].forEach(d => grid.innerHTML += `<div class="cal-day-name">${d}</div>`);

    const primeiroDiaSemana = new Date(exibindoAno, exibindoMes, 1).getDay();
    const ultimoDiaMes = new Date(exibindoAno, exibindoMes + 1, 0).getDate();

    // Preencher dias vazios do mês anterior
    for (let i = 0; i < primeiroDiaSemana; i++) {
        grid.innerHTML += `<div class="cal-day other-month"></div>`;
    }

    // Gerar os dias do mês
    for (let dia = 1; dia <= ultimoDiaMes; dia++) {
        const diaBox = document.createElement("div");
        
        // Verifica se é o dia atual (hoje)
        const isHoje = dia === hoje.getDate() && exibindoMes === hoje.getMonth() && exibindoAno === hoje.getFullYear();
        diaBox.className = "cal-day" + (isHoje ? " today" : "");
        
        diaBox.innerHTML = `<div class="cal-number">${dia}</div>`;
        
        const dataStringIso = `${exibindoAno}-${(exibindoMes + 1).toString().padStart(2, '0')}-${dia.toString().padStart(2, '0')}`;

        // Eventos de Cartão
        state.cartoes.forEach(c => {
            if (parseInt(c.vencimento) === dia) {
                diaBox.innerHTML += `<div class="cal-event event-card">💳 ${c.nome}</div>`;
            }
        });

        // Contas Fixas
        state.contasFixas.forEach(f => {
            if (f.ativo && parseInt(f.dia) === dia) {
                diaBox.innerHTML += `<div class="cal-event event-expense">${f.nome}</div>`;
            }
        });

        // Pagamento de Salário
        const diaPagamento = calcularDiaPagamento(state.configuracoes.diaSalario || 5, exibindoMes, exibindoAno);
        if (dia === diaPagamento) {
            diaBox.innerHTML += `<div class="cal-event event-salary">💰 Salário</div>`;
        }

        // Lembretes
        state.lembretes.filter(l => l.data === dataStringIso).forEach(l => {
            const ev = document.createElement("div");
            ev.className = "cal-event event-reminder";
            ev.innerText = `📌 ${l.hora ? l.hora + ' - ' : ''}${l.nome}`;
            ev.onclick = (e) => { e.stopPropagation(); actions.abrirPostit(l); };
            diaBox.appendChild(ev);
        });

        grid.appendChild(diaBox);
    }
}