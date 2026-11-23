const steps = ["Perfil", "Mês de referência", "Base financeira", "Outras entradas", "Cartões", "Categorias", "Despesas fixas", "Assinaturas", "Agenda e lembretes", "Aparência", "Revisão"];
const optional = new Set([3, 4, 5, 6, 7, 8, 9]);
const escape = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const field = (label, control) => `<label class="onboarding-field"><span>${label}</span>${control}</label>`;
const input = (name, value = "", type = "text", extra = "") => `<input name="${name}" type="${type}" value="${escape(value)}" ${extra}>`;
const select = (name, options, value) => `<select name="${name}">${options.map(([id, label]) => `<option value="${escape(id)}" ${String(id) === String(value) ? "selected" : ""}>${escape(label)}</option>`).join("")}</select>`;
const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const themes = [["planetario", "Planetário"], ["noite", "Noite"], ["natureza", "Calmaria"], ["doce", "Algodão-Doce"], ["amanhecer", "Amanhecer"], ["grayscale", "Cinza"]];
const days = [["0", "Domingo"], ["1", "Segunda-feira"], ["2", "Terça-feira"], ["3", "Quarta-feira"], ["4", "Quinta-feira"], ["5", "Sexta-feira"], ["6", "Sábado"]];
const row = (type, item, state) => {
    const id = escape(item.id || (type === "category" ? item.name : ""));
    const name = field("Nome", input("nome", item.nome || item.name, "text", "required"));
    const amount = field("Valor", input("valor", item.valor ?? "", "number", 'min="0" step="0.01" required'));
    const day = field("Dia", input("dia", item.dia || 1, "number", 'min="1" max="31" required'));
    const category = field("Categoria", select("categoria", state.categorias.map(c => [c.name, c.name]), item.categoria || state.categorias[0]?.name));
    const payment = field("Pagamento", select("cartaoId", [["", "Dinheiro"], ...state.cartoes.map(c => [c.id, c.nome])], item.cartaoId || ""));
    let content = "";
    if (type === "income") content = name + amount + day;
    if (type === "card") content = name + field("Cor", input("color", item.color || "#D78341", "color")) + field("Tipo", select("tipo", [["Crédito", "Crédito"], ["Débito", "Débito"]], item.tipo || "Crédito")) + field("Fechamento", input("fechamento", item.fechamento || 1, "number", 'min="1" max="31" required')) + field("Vencimento", input("vencimento", item.vencimento || 10, "number", 'min="1" max="31" required'));
    if (type === "category") content = name + field("Cor", input("color", item.color || "#D78341", "color"));
    if (type === "fixed") content = name + amount + day + category + payment;
    return `<div class="onboarding-row" data-id="${id}" data-kind="${type}">${content}<button type="button" class="onboarding-remove" aria-label="Remover item" title="Remover item"><span class="material-icons" aria-hidden="true">close</span></button></div>`;
};

export function abrirOnboarding({ getState, commit, refresh, onTheme }) {
    document.getElementById("onboardingOverlay")?.remove();
    const overlay = document.createElement("div");
    overlay.id = "onboardingOverlay";
    overlay.className = "modal-overlay onboarding-overlay";
    overlay.innerHTML = '<div class="modal-content onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby="onboardingTitle"></div>';
    document.body.appendChild(overlay);
    const dialog = overlay.firstElementChild;
    let step = Math.min(steps.length - 1, Math.max(0, Number(getState().configuracoes.onboarding?.step) || 0));
    let saving = false;
    const render = () => {
        const state = getState();
        const config = state.configuracoes;
        const current = new Date();
        const currentMonth = state.dados?.[current.getFullYear()]?.meses?.[current.getMonth()];
        const fixed = state.contasFixas.filter(item => (item.tipo || "fixa") === "fixa");
        const subscriptions = state.contasFixas.filter(item => item.tipo === "assinatura");
        let body = "";
        if (step === 0) body = field("Nome de exibição", input("nomeUsuario", config.nomeUsuario, "text", "required"));
        if (step === 1) body = field("Referência", select("referenciaMes", [["atual", "Mês atual"], ["proximo", "Próximo mês"]], config.referenciaMes)) + field("Dia de virada do mês", input("diaVirada", config.diaVirada || 1, "number", 'min="1" max="31" required')) + '<p class="onboarding-preview" id="onboardingMonthPreview"></p>';
        if (step === 2) body = field("Salário base", input("salario", state.salarioFixoBase, "number", 'min="0" step="0.01" required')) + field("Dia de pagamento", input("diaSalario", config.diaSalario || 5, "number", 'min="1" max="31" required')) + field("Cálculo do dia", select("tipoDiaSalario", [["util", "Dia útil"], ["corrido", "Dia corrido"]], config.tipoDiaSalario)) + field("Dinheiro em conta", input("conta", currentMonth?.conta ?? 0, "number", 'min="0" step="0.01" required'));
        const groups = { 3: ["income", state.receitasFixas], 4: ["card", state.cartoes], 5: ["category", state.categorias], 6: ["fixed", fixed], 7: ["fixed", subscriptions] };
        if (groups[step]) {
            const [type, items] = groups[step];
            body = `<div class="onboarding-rows" id="onboardingRows">${items.map(item => row(type, item, state)).join("")}</div><button type="button" class="btn onboarding-add" id="onboardingAdd">+ Adicionar ${step === 3 ? "renda" : step === 4 ? "cartão" : step === 5 ? "categoria" : step === 6 ? "despesa" : "assinatura"}</button>`;
        }
        if (step === 8) {
            const category = state.categoriasLembretes.find(item => item.id === config.onboarding?.categoriaLembreteId);
            const reminder = state.lembretes.find(item => item.id === config.onboarding?.lembreteId);
            body = field("Visão do calendário", select("visaoCalendario", [["mensal", "Mensal"], ["semanal", "Semanal"]], config.visaoCalendario)) + field("Primeiro dia da semana", select("inicioSemanaCalendario", days, config.inicioSemanaCalendario ?? 0)) + field("Hora de virada do dia", select("horaViradaCalendario", Array.from({ length: 24 }, (_, hour) => [hour, `${String(hour).padStart(2, "0")}:00`]), config.horaViradaCalendario ?? 21)) + field("Lembretes na Home", select("periodoHome", [["semana", "Esta semana"], ["hoje", "Hoje"], ["proximos7", "Próximos 7 dias"], ["mes", "Este mês"]], config.exibicaoHome?.periodo?.tipo || "semana")) + field("Nova categoria de lembrete (opcional)", input("categoriaLembrete", category?.nome || "")) + field("Primeiro lembrete (opcional)", input("lembreteNome", reminder?.nome || "")) + field("Data do lembrete", input("lembreteData", reminder?.data || "", "date")) + field("Hora do lembrete", input("lembreteHora", reminder?.hora || "", "time"));
        }
        if (step === 9) body = field("Tema", select("tema", themes, config.tema));
        if (step === 10) {
            const total = list => list.reduce((sum, item) => sum + (Number(item.valor) || 0), 0);
            const date = new Date();
            const ref = new Date(date.getFullYear(), date.getMonth() + (config.referenciaMes === "proximo" ? 1 : 0) - (date.getDate() < Number(config.diaVirada || 1) ? 1 : 0), 1);
            body = `<dl class="onboarding-review"><dt>Nome</dt><dd>${escape(config.nomeUsuario)}</dd><dt>Mês exibido</dt><dd>${monthNames[ref.getMonth()]} ${ref.getFullYear()}</dd><dt>Entradas recorrentes</dt><dd>R$ ${(state.salarioFixoBase + total(state.receitasFixas)).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</dd><dt>Despesas recorrentes</dt><dd>R$ ${total(state.contasFixas).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</dd><dt>Cartões</dt><dd>${state.cartoes.length}</dd><dt>Tema</dt><dd>${escape(themes.find(([id]) => id === config.tema)?.[1] || "Planetário")}</dd></dl>`;
        }
        dialog.innerHTML = `<div class="onboarding-progress">Etapa ${step + 1} de ${steps.length}</div><progress max="${steps.length}" value="${step + 1}"></progress><h2 id="onboardingTitle">${steps[step]}</h2><form id="onboardingForm"><div class="onboarding-fields">${body}</div><p class="onboarding-error" role="alert" hidden></p><div class="onboarding-actions"><button type="button" class="btn onboarding-secondary" id="onboardingBack" ${step === 0 ? "disabled" : ""}>Voltar</button>${optional.has(step) ? '<button type="button" class="btn onboarding-secondary" id="onboardingSkip">Pular</button>' : ""}<button type="submit" class="btn onboarding-primary" id="onboardingNext">${step === 10 ? "Concluir" : "Continuar"}</button></div></form>`;
        const form = dialog.querySelector("form");
        if (step === 1) {
            const preview = () => {
                const now = new Date();
                const selected = new Date(now.getFullYear(), now.getMonth(), 1);
                if (form.elements.referenciaMes.value === "proximo") selected.setMonth(selected.getMonth() + 1);
                if (now.getDate() < Number(form.elements.diaVirada.value)) selected.setMonth(selected.getMonth() - 1);
                dialog.querySelector("#onboardingMonthPreview").textContent = `A Home abrirá em ${monthNames[selected.getMonth()]} ${selected.getFullYear()}.`;
            };
            form.elements.referenciaMes.onchange = preview;
            form.elements.diaVirada.oninput = preview;
            preview();
        }
        if (step === 9) form.elements.tema.onchange = () => onTheme(form.elements.tema.value);
        else onTheme(config.tema);
        dialog.querySelector("#onboardingAdd")?.addEventListener("click", () => {
            const [type] = groups[step];
            const defaults = type === "category" ? { name: "", color: "#D78341" } : { nome: "", valor: 0, dia: 1 };
            dialog.querySelector("#onboardingRows").insertAdjacentHTML("beforeend", row(type, defaults, getState()));
            dialog.querySelector("#onboardingRows .onboarding-row:last-child input[name=nome]")?.focus();
        });
        dialog.querySelector("#onboardingRows")?.addEventListener("click", event => event.target.closest(".onboarding-remove")?.closest(".onboarding-row")?.remove());
        dialog.querySelector("#onboardingBack").onclick = () => { step--; render(); };
        dialog.querySelector("#onboardingSkip")?.addEventListener("click", () => advance(null, true));
        form.onsubmit = event => { event.preventDefault(); if (form.reportValidity()) advance(form, false); };
        dialog.querySelector("input:not([type=hidden]),select")?.focus();
    };
    const advance = async (form, skip) => {
        if (saving) return;
        saving = true;
        dialog.querySelectorAll("button").forEach(button => { button.disabled = true; });
        const error = dialog.querySelector(".onboarding-error");
        try {
            const payload = skip ? null : Object.fromEntries(new FormData(form));
            if (!skip && step >= 3 && step <= 7) {
                payload.rows = [...dialog.querySelectorAll(".onboarding-row")].map(element => ({ id: element.dataset.id, ...Object.fromEntries([...element.querySelectorAll("input,select")].map(control => [control.name, control.value])) }));
            }
            const ok = await commit(step, payload, step === 10 ? "complete" : step + 1);
            if (!ok) throw new Error("Não foi possível salvar. Tente novamente.");
            if (step === 10) { overlay.remove(); refresh(); return; }
            step++;
            render();
        } catch (cause) {
            error.hidden = false;
            error.textContent = cause.message || "Não foi possível salvar.";
            dialog.querySelectorAll("button").forEach(button => { button.disabled = false; });
        } finally { saving = false; }
    };
    render();
}
