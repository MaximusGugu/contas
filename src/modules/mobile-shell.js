const mobileViewport = window.matchMedia("(max-width: 900px)");
const shellStates = new WeakMap();
const icon = name => `<span class="material-icons" aria-hidden="true">${name}</span>`;

function reposicionarLembretesHome(shell, hash) {
    if (!shell || hash !== "#resumo") return;
    const lembretes = shell.querySelector("#moduloLembretesHome")
        || document.querySelector("#appShellParking #moduloLembretesHome");
    const grid = shell.querySelector(".home-dashboard-grid");
    const mount = shell.querySelector("#homeLembretesMount")
        || document.querySelector("#appShellParking #homeLembretesMount");
    if (!lembretes || !mount) return;

    if (mobileViewport.matches) {
        if (grid && lembretes.parentElement !== grid.parentElement) grid.before(lembretes);
        return;
    }

    if (lembretes.parentElement !== mount) mount.appendChild(lembretes);
    if (!shell.querySelector("#homeLembretesMount")) {
        shell.querySelector("#appShellSidebarPanel")?.appendChild(mount);
    }
}

// The mobile controls forward to the existing actions; financial state stays in main.js.
export function sincronizarMobileShell(shell, hash) {
    let state = shellStates.get(shell);
    if (!state) {
        state = { route: "", filtersOpen: false, expensesPane: "list", collapsed: new Set() };
        shellStates.set(shell, state);
        shell.insertAdjacentHTML("beforeend", `
            <div class="app-mobile-calendar-action"><button type="button" class="btn" data-mobile-reminder>${icon("add")}<span>Adicionar lembrete</span></button></div>
            <div class="app-mobile-expense-action"><button type="button" class="btn" data-mobile-expense>${icon("add")}<span>Adicionar gasto</span></button></div>
            <nav class="app-bottom-nav" aria-label="Navega\u00e7\u00e3o mobile">
                <a href="#resumo">${icon("home")}<span>In\u00edcio</span></a>
                <a href="#gastos">${icon("receipt_long")}<span>Gastos</span></a>
                <a href="#calendario">${icon("calendar_month")}<span>Calend\u00e1rio</span></a>
                <a href="#configuracoes">${icon("settings")}<span>Ajustes</span></a>
            </nav>`);
        const toolbar = document.createElement("div");
        toolbar.className = "app-mobile-tools";
        toolbar.innerHTML = `
            <button type="button" class="btn" data-mobile-filters aria-label="Filtros" aria-controls="appShellSidebarPanel" aria-expanded="false">${icon("tune")}<span>Filtros</span></button>
            <div class="app-mobile-segments" role="group" aria-label="Visualiza\u00e7\u00e3o de gastos">
                <button type="button" data-mobile-pane="list" aria-pressed="true">Lan\u00e7amentos</button>
                <button type="button" data-mobile-pane="summary" aria-pressed="false">Resumo</button>
            </div>`;
        shell.querySelector(".app-main").before(toolbar);
        shell.addEventListener("click", event => {
            if (!mobileViewport.matches) return;
            if (event.target.closest("button[data-mobile-filters]")) {
                state.filtersOpen = !state.filtersOpen;
                updateControls(shell, state);
            }
            const pane = event.target.closest("button[data-mobile-pane]");
            if (pane) {
                state.expensesPane = pane.dataset.mobilePane;
                updateControls(shell, state);
                // ApexCharts measures again when its previously hidden panel opens.
                window.dispatchEvent(new Event("resize"));
            }
            if (event.target.closest("[data-mobile-reminder]")) shell.querySelector("#btnNovoLembrete")?.click();
            if (event.target.closest("[data-mobile-expense]")) shell.querySelector("#gastosAddManual")?.click();
            const toggle = event.target.closest(".mobile-card-toggle");
            if (toggle) {
                const card = document.getElementById(toggle.getAttribute("aria-controls"));
                const collapsed = !state.collapsed.has(card.id);
                if (collapsed) state.collapsed.add(card.id);
                else state.collapsed.delete(card.id);
                card.classList.toggle("is-mobile-collapsed", collapsed);
                toggle.setAttribute("aria-expanded", String(!collapsed));
            }
            if (event.target.closest("[data-gastos-categoria], [data-gastos-cartao]")) {
                state.expensesPane = "list";
                updateControls(shell, state);
            }
            if (event.target.closest(".app-bottom-nav a")) shell.querySelector(".app-account-menu")?.removeAttribute("open");
        });
        document.addEventListener("click", event => {
            if (mobileViewport.matches && !event.target.closest(".app-account-menu")) shell.querySelector(".app-account-menu")?.removeAttribute("open");
        });
        shell.addEventListener("keydown", event => {
            if (mobileViewport.matches && event.key === "Escape") {
                state.filtersOpen = false;
                shell.querySelector(".app-account-menu")?.removeAttribute("open");
                updateControls(shell, state);
            }
        });
        mobileViewport.addEventListener("change", () => {
            shell.querySelector(".app-account-menu").open = !mobileViewport.matches;
            reposicionarLembretesHome(shell, state.route);
            updateControls(shell, state);
        });
        const updateKeyboard = () => {
            const editing = document.activeElement?.matches("input:not([type=checkbox]):not([type=radio]), textarea");
            const height = window.visualViewport?.height || window.innerHeight;
            const keyboardOpen = mobileViewport.matches && editing && height < window.innerHeight * 0.78;
            document.body.classList.toggle("mobile-keyboard-open", Boolean(keyboardOpen));
            if (keyboardOpen) document.documentElement.style.setProperty("--mobile-viewport-height", `${height}px`);
            else document.documentElement.style.removeProperty("--mobile-viewport-height");
        };
        window.visualViewport?.addEventListener("resize", updateKeyboard);
        document.addEventListener("focusout", () => requestAnimationFrame(updateKeyboard));
    }
    if (state.route !== hash) {
        state.filtersOpen = false;
        state.expensesPane = "list";
        shell.querySelector(".app-main").scrollTop = 0;
    }
    state.route = hash;
    if (hash === "#resumo") {
        reposicionarLembretesHome(shell, hash);
    }
    if (!mobileViewport.matches) shell.querySelector(".app-account-menu").open = true;
    shell.querySelectorAll(".app-bottom-nav a").forEach(link => {
        const active = link.hash === hash || (hash === "#notas" && link.hash === "#configuracoes");
        if (active) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
    });
    const value = shell.querySelector("#quickDespValor");
    if (value) value.inputMode = "decimal";
    const labels = { quickDespNome: "Nome da despesa", quickDespValor: "Valor", quickDespCategoria: "Categoria", quickDespDestino: "Forma de pagamento" };
    Object.entries(labels).forEach(([id, label]) => shell.querySelector(`#${id}`)?.setAttribute("aria-label", label));
    if (hash === "#resumo") {
        ["moduloBalancoRapidoCard", "moduloDespesaRapida", "moduloEntradasHome", "moduloLembretesHome"].forEach(id => {
            const card = shell.querySelector(`#${id}`);
            const header = card?.querySelector(":scope > .despHeader");
            const label = header?.querySelector(":scope > span");
            if (!header || !label) return;
            label.classList.add("app-card-title-label");
            if (!header.querySelector(".mobile-card-toggle")) {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "mobile-card-toggle";
                button.setAttribute("aria-controls", id);
                button.innerHTML = `<span></span>${icon("expand_more")}`;
                button.querySelector("span").textContent = label.textContent;
                header.prepend(button);
            }
            card.classList.toggle("is-mobile-collapsed", state.collapsed.has(id));
            header.querySelector(".mobile-card-toggle").setAttribute("aria-expanded", String(!state.collapsed.has(id)));
        });
    }
    updateControls(shell, state);
}

function updateControls(shell, state) {
    shell.dataset.mobileFilters = state.filtersOpen ? "open" : "closed";
    shell.dataset.mobilePane = state.expensesPane;
    shell.querySelector("[data-mobile-filters]").setAttribute("aria-expanded", String(state.filtersOpen));
    shell.querySelectorAll("[data-mobile-pane]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.mobilePane === state.expensesPane)));
}
