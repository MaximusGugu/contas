import { auth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from "./firebase/auth.js";
import { db, doc, setDoc, getDoc } from "./firebase/firestore.js";
import { encryptData, decryptData } from "./crypto/crypto.js";
import { formatar, parseValor } from "./utils/formatters.js";
import { nomesMesesFull, nomesMesesCurto, categoriasPadrao, configuracoesPadrao } from "./state/state.js";
import { saveLocalSnapshot } from "./state/storage.js";
import { getMesReferenciaAtivo as calcularMesReferenciaAtivo } from "./utils/dates.js";
import { renderCalendario, calcularDiaPagamento, obterFeriados } from "./modules/calendar.js";
import { aplicarTema } from "./modules/themes.js";

// ================= VARIÁVEIS GLOBAIS =================
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

const VERSAO_ATUAL_APP = "4.0";
const coresCategoriasLembretes = ["#D78341", "#3C5558", "#586E5F", "#8E6F3E", "#7A4E7A"];
const tiposExibicaoPadrao = {
    feriados: true,
    salario: true,
    cartoes: true,
    fixas: true,
    variaveis: true,
    lembretes: true
};

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
        categoriasFinanceiras: Array.isArray(cfg.categoriasFinanceiras) ? cfg.categoriasFinanceiras : []
    };
}

function criarViewCalendarioPadrao() {
    return { id: "view-1", nome: "View 1", filtros: normalizarConfigExibicao({ tipos: tiposExibicaoPadrao }) };
}

function normalizarViewsCalendario(lista) {
    const views = Array.isArray(lista) && lista.length ? lista : [criarViewCalendarioPadrao()];
    return views.map((view, index) => ({
        id: String(view.id || `view-${index + 1}`),
        nome: view.nome || `View ${index + 1}`,
        filtros: normalizarConfigExibicao(view.filtros || view)
    }));
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
        exibicaoCalendario: normalizarConfigExibicao(configuracoes?.exibicaoCalendario),
        exibicaoHome: normalizarConfigExibicao(configuracoes?.exibicaoHome)
    };

    const categoriaDefault = categoriasLembretes[0]?.id || "geral";
    lembretes = (Array.isArray(lembretes) ? lembretes : []).map((l) => {
        const subtarefas = Array.isArray(l.subtarefas) ? l.subtarefas.map((s, idx) => ({
            id: String(s.id || `${l.id || Date.now()}-sub-${idx}`),
            texto: s.texto || s.nome || "",
            concluida: s.concluida === true
        })).filter(s => s.texto.trim() !== "") : [];
        const concluido = subtarefas.length > 0 ? subtarefas.every(s => s.concluida) : l.concluido === true;
        return {
            ...l,
            categoriaId: String(l.categoriaId || categoriaDefault),
            anotacoes: l.anotacoes || "",
            subtarefas,
            concluido
        };
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
    return { dados, cartoes, contasFixas, receitasFixas, lembretes, configuracoes, gastosDetalhes, salarioFixoBase, categoriasLembretes, viewCalendarioAtiva: getViewCalendarioAtiva() };
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

// ================= FUNÇÕES DE APOIO =================
// CÁLCULO DINÂMICO DE SALDO (Soma todos os depósitos e subtrai resgates)

// ATUALIZAÇÃO DO DEPÓSITO (Não cria despesa no mês)
window.atualizarDataLembrete = async (id, novaData, novoDiaSemana) => {
    // 1. Acha o lembrete na lista (importante converter ID para String na comparação)
    const index = lembretes.findIndex(l => String(l.id) === String(id));
    if (index === -1) return;

    // 2. Atualiza a data e a recorrência
    if (lembretes[index].recorrente) {
        lembretes[index].diasSemana = [novoDiaSemana];
    }
    lembretes[index].data = novaData;

    // 3. Salva no Firebase
    await salvarFirebase();
    renderLembretesHome();
    
    // 4. Força o calendário a redesenhar para o lembrete "pular" de dia
    renderCalendario(getEstadoCalendario(), { abrirPostit, abrirConfiguracoesCalendario, criarViewCalendario, selecionarViewCalendario });
};

function congelarHistoricoFixas() {
    // IMPORTANTE: Agora usamos a lógica das suas configurações
    const { mesAt, anoAt } = getMesReferenciaAtivo();
    
    const anos = Object.keys(dados).map(Number).sort((a, b) => a - b);
    
    anos.forEach(ano => {
        if (!dados[ano] || !dados[ano].meses) return;
        dados[ano].meses.forEach((m, idx) => {
            
            // LÓGICA DE COMPARAÇÃO:
            // Se o ano for menor que o ano ativo OU
            // Se o ano for o mesmo, mas o índice do mês for menor que o mês ativo definido nas configurações
            if (ano < anoAt || (ano === anoAt && idx < mesAt)) {
                
                // Tira print das Despesas Fixas e Assinaturas se ainda não existir
                if (!m.fixasSnapshot) {
                    m.fixasSnapshot = JSON.parse(JSON.stringify(contasFixas));
                }
                
                // Tira print das Rendas Recorrentes se ainda não existir
                if (!m.receitasSnapshot) {
                    m.receitasSnapshot = JSON.parse(JSON.stringify(receitasFixas));
                }
                
                // Tira print do Salário Base (Padrão) da época
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
        // Muda o texto dentro da página (H1)
        if (tituloEl) tituloEl.innerText = "CONTAS DE " + nomeUpper;
        // Muda o nome na aba do navegador (Title)
        document.title = "Contas de " + configuracoes.nomeUsuario;
    } else {
        // Volta para o padrão se não houver nome
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

        const domingo = new Date(hojeSemHoras);
        domingo.setDate(hojeSemHoras.getDate() - hojeSemHoras.getDay());
        const sabado = new Date(domingo);
        sabado.setDate(domingo.getDate() + 6);
        sabado.setHours(23,59,59,999);

        let eventosSemana = [];
        const feriadosPorAno = {};
        const feriadosDoAno = async (ano) => {
            if (!feriadosPorAno[ano]) feriadosPorAno[ano] = await obterFeriados(ano);
            return feriadosPorAno[ano];
        };
        const pushEvento = (data, nome, info, valor, tipo, pago = false, extra = {}) => {
            eventosSemana.push({ nome, info, valor, data: new Date(data), tipo, pago, ...extra });
        };

        for (let dataLoop = new Date(hojeSemHoras); dataLoop <= sabado; dataLoop.setDate(dataLoop.getDate() + 1)) {
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

            if (diaNum === calcularDiaPagamento(configuracoes.diaSalario || 5, mesIdx, anoDoDia, feriados)) {
                pushEvento(dataLoop, "Salario", "Renda", salarioFixoBase || 0, "salario");
            }

            cartoes.forEach(c => {
                if (parseInt(c.vencimento) === diaNum) {
                    const totalV = (gastosDetalhes[anoDoDia] || []).filter(g => g.mes === mesIdx && String(g.cartaoId) === String(c.id)).reduce((acc, g) => acc + g.valor, 0);
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
                if (d.dia && parseInt(d.dia) === diaNum) {
                    pushEvento(dataLoop, d.nome, "Variavel", d.valor, "variaveis", d.checked, { categoria: d.categoria });
                }
            });

            lembretes.filter(l => l.data === isoData || (l.recorrente && l.diasSemana?.includes(dataLoop.getDay()))).forEach(l => {
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
            lista.innerHTML = `<div class="lembrete-vazio">Sem eventos para o restante da semana.</div>`;
            if (window.location.hash === "#resumo" || !window.location.hash) requestAnimationFrame(renderBalancoRapido);
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
            return `
                <div class="item-lembrete-home agenda-tipo-${ev.tipo}" data-tipo="${ev.tipo}" data-lembrete-id="${ev.lembreteId || ""}" style="opacity: ${ev.pago ? '0.6' : '1'}; ${corLembrete ? `--lembrete-cor:${corLembrete}; border-left:4px solid ${corLembrete};` : ""}">
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
                if (window.location.hash === "#calendario") renderCalendario(getEstadoCalendario(), { abrirPostit, abrirConfiguracoesCalendario, criarViewCalendario, selecionarViewCalendario });
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
        if (window.location.hash === "#resumo" || !window.location.hash) requestAnimationFrame(renderBalancoRapido);
    } catch (e) { console.error(e); }
}

function getMesReferenciaAtivo() {
    return calcularMesReferenciaAtivo(configuracoes);
}

function migrarCategorias(lista) {
    if(!lista || !Array.isArray(lista)) return categorias;
    return lista.map(c => (typeof c === 'string' ? { name: c, color: "#D78341" } : c));
}

// SAUDAÇÃO DINÂMICA //

function atualizarSaudacao() {
    const el = document.getElementById("saudacaoDinamica");
    if (!el) return;

    const agora = new Date();
    const hora = agora.getHours();
    let saudacao = "";

    if (hora >= 6 && hora < 12) saudacao = "Bom dia";
    else if (hora >= 12 && hora < 18) saudacao = "Boa tarde";
    else saudacao = "Boa noite";

    const opcoes = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
    
    // 1. Gera a data por extenso
    let dataExtenso = agora.toLocaleDateString('pt-BR', opcoes);
    
    // 2. CORREÇÃO AQUI: Força tudo para minúsculo
    dataExtenso = dataExtenso.toLowerCase();

    // 3. Monta o HTML (Mantendo o "H" de "Hoje" maiúsculo para iniciar a frase corretamente)
    el.innerHTML = `${saudacao}! Hoje é ${dataExtenso}. <span style="opacity: 0.7; font-weight: normal;">Aqui está o seu resumo:</span>`;
}

// ================= UTILITÁRIOS =================
function controleAvisoPendente(mostrar) {
    const aviso = document.getElementById("statusAlteracao");
    if (aviso) {
        aviso.style.display = mostrar ? "inline-block" : "none";
    }
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

async function salvarFirebase() {
  if (!usuarioLogado || !senhaDoUsuario) return;
  try {
    normalizarDadosApp();
    const btn = document.getElementById("salvarNuvemBtn"); 
    if (btn) btn.innerText = "SALVANDO...";
    
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
    
    // Sucesso: Desliga o aviso e atualiza o botão
    controleAvisoPendente(false);
    if (btn) btn.innerText = "SALVO NA NUVEM"; 
    salvarDadosLocal();
    
    setTimeout(() => { if(btn) btn.innerText = "☁️ SALVAR"; }, 2000);
  } catch (e) { 
      console.error("Erro ao salvar:", e);
      const btn = document.getElementById("salvarNuvemBtn");
      if (btn) btn.innerText = "ERRO AO SALVAR";
  }
}

function aplicarComportamentoInput(input, getV, setV, anoVinculado = null) {
  if (!input) return;

  // Ao clicar: limpa o valor para facilitar a digitação
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

// ================= MOTOR DE CÁLCULO =================
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
      const gastosDetalhados = (gastosDetalhes[ano] || []).filter(g => g.mes === idx);
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
                  listaCartoesDiv.innerHTML = "<div style='display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; gap:8px;'><small style='opacity:0.6'>PAGAMENTO DE CARTÕES:</small><button type='button' class='btn-mini-gerenciar btn-edit-cartoes-home' title='Editar cartões'>⚙</button></div>";
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
                          itemC.innerHTML = `<div style="display:flex; align-items:center;"><input type="checkbox" class="check-cartao" ${pago ? 'checked' : ''}><span class="txt-cartao">💳 ${cObj.nome}</span></div><span>${formatar(totaisPorCartao[cid])}</span>`;
                          itemC.querySelector(".check-cartao").onclick = (e) => { e.stopPropagation(); m.cartoesPagos[cid] = e.target.checked; controleAvisoPendente(true); atualizarTudo(ano); salvarFirebase(); renderLembretesHome(); renderCalendario(getEstadoCalendario(), { abrirPostit, abrirConfiguracoesCalendario, criarViewCalendario, selecionarViewCalendario }); };
                          itemC.onclick = () => { document.getElementById("anoGastos").value = ano; mesesGastosAbertos.clear(); mesesGastosAbertos.add(idx); filtrosPorMes[idx] = cid; window.location.hash = "#gastos"; };
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
  popularControlesDespesaRapida();
  renderCaixinhas(); // <--- CRUCIAL: RECONECTA AS CAIXINHAS
}

function processarAutoCobranca() {
    const agora = new Date();
    const diaHoje = agora.getDate();
    const mesHoje = agora.getMonth();
    const anoHoje = agora.getFullYear();

    // Verificamos se o ano e o mês real de hoje existem nos seus dados
    if (dados[anoHoje] && dados[anoHoje].meses[mesHoje]) {
        const m = dados[anoHoje].meses[mesHoje];
        
        // Inicializa o controle de desativação se não existir
        if (!m.fixasDesativadas) m.fixasDesativadas = {};

        // Varre todas as suas despesas fixas (assinaturas, contas, etc)
        contasFixas.forEach(f => {
            const diaVencimento = parseInt(f.dia) || 1;

            // REGRA: Se o dia de hoje é MENOR que o dia do vencimento, 
            // a conta ainda não "caiu" no mundo real.
            if (diaHoje < diaVencimento) {
                // Marcar como desativada (unchecked) para sair do cálculo do saldo e cartão
                m.fixasDesativadas[f.id] = true;
            } else {
                // Se já chegou o dia ou passou, ela deve estar ativa (checked)
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

    // Cores dinâmicas
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
                        // Verifica se o ano/mês da barra é futuro
                        const ehFuturo = (Number(ano) > anoReal) || (Number(ano) === anoReal && dataPointIndex > mesReal);
                        return ehFuturo ? "Previsão: " : "Saldo: ";
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
        .filter(g => g.mes === mes)
        .reduce((acc, g) => acc + (Number(g.valor) || 0), 0);
    const totalFixo = listaFixas
        .filter(f => f.ativo && f.cartaoId)
        .reduce((acc, f) => acc + ((mData?.fixasEditadas?.[f.id] !== undefined) ? mData.fixasEditadas[f.id] : f.valor), 0);
    return totalVariavel + totalFixo;
}

function montarHtmlUltimasEntradasRapidas(itens) {
    return itens.length ? itens.map(item => `
        <div class="ultima-entrada">
            <span>${item.nome || "Despesa"}</span>
            <strong>${formatar(item.valor || 0)}</strong>
        </div>
    `).join("") : `<div class="lembrete-vazio">Nenhuma despesa recente.</div>`;
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

    const maximoInicial = Math.min(itensOrdenados.length, 12);
    if (maximoInicial === 0) {
        ultimasEl.innerHTML = montarHtmlUltimasEntradasRapidas([]);
        return;
    }

    const cardLembretes = document.getElementById("moduloLembretesHome");
    const cardBalanco = document.getElementById("moduloBalancoRapido");
    const alturaAlvo = medirAlturaNaturalCard(cardLembretes) || cardLembretes?.offsetHeight || 0;
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
    if (!ctx) return;

    const { mesAt, anoAt } = getMesReferenciaAtivo();
    const pontos = [-3, -2, -1, 0].map(offset => {
        const data = new Date(anoAt, mesAt + offset, 1);
        const ano = data.getFullYear();
        const mes = data.getMonth();
        return { label: nomesMesesCurto[mes], saldo: Number(dados?.[ano]?.meses?.[mes]?.saldoCalculadoFinal || 0) };
    });

    if (chartBalancoRapido) chartBalancoRapido.destroy();
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

    const mesAtual = dados?.[anoAt]?.meses?.[mesAt];
    const saldoEl = document.getElementById("saldoAtualRapido");
    const cartoesEl = document.getElementById("totalCartoesRapido");
    if (saldoEl) saldoEl.textContent = formatar(mesAtual?.saldoCalculadoFinal || 0);
    if (cartoesEl) cartoesEl.textContent = formatar(obterTotalCartoesMes(anoAt, mesAt));

    const ultimas = [];
    Object.values(dados).forEach(anoData => {
        (anoData.meses || []).forEach(mesData => {
            (mesData.despesas || []).forEach(d => ultimas.push({ nome: d.nome, valor: d.valor, quando: d.criadoEm || d.id || 0 }));
        });
    });
    Object.values(gastosDetalhes).forEach(lista => {
        (lista || []).forEach(g => ultimas.push({ nome: g.nome, valor: g.valor, quando: g.criadoEm || g.id || 0 }));
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
    if (selCategoria) selCategoria.innerHTML = categorias.map(c => `<option value="${c.name}">${c.name}</option>`).join("");
    if (selCartao) selCartao.innerHTML = cartoes.map(c => `<option value="${c.id}">${c.nome}</option>`).join("");
    if (destino && selCartao) selCartao.style.display = destino.value === "cartao" ? "block" : "none";
}

function abrirModalExibicao(escopo, modo = "editar") {
    normalizarDadosApp();
    const editandoCalendario = escopo === "calendario";
    const viewAtiva = editandoCalendario ? getViewCalendarioAtiva() : null;
    const nomePadraoView = editandoCalendario && modo === "criar" ? `View ${configuracoes.viewsCalendario.length + 1}` : viewAtiva?.nome;
    const chave = escopo === "home" ? "exibicaoHome" : "viewsCalendario";
    const titulo = escopo === "home" ? "Exibicao da home" : (modo === "criar" ? "Nova view do calendario" : "Editar view do calendario");
    const cfg = editandoCalendario
        ? normalizarConfigExibicao(modo === "criar" ? criarViewCalendarioPadrao().filtros : viewAtiva?.filtros)
        : normalizarConfigExibicao(configuracoes.exibicaoHome);
    const antigo = document.getElementById("modalExibicaoEventos");
    if (antigo) antigo.remove();

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.id = "modalExibicaoEventos";
    const tipos = [
        ["feriados", "Feriados"],
        ["salario", "Salario"],
        ["cartoes", "Cartoes"],
        ["fixas", "Fixas"],
        ["variaveis", "Variaveis"],
        ["lembretes", "Lembretes"]
    ];
    overlay.innerHTML = `
        <div class="modal-content" style="max-width:520px;">
            <h3>${titulo}</h3>
            ${editandoCalendario ? `<input type="text" id="nomeViewCalendario" class="inputPadrao" value="${nomePadraoView}" placeholder="Nome da view" style="margin-bottom:10px;">` : ""}
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
                        <button type="button" class="btn-mini-gerenciar btn-edit-cat-lembrete" data-edit-cat-lembrete="${cat.id}" title="Editar categoria">⚙</button>
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
                renderCalendario(getEstadoCalendario(), { abrirPostit, abrirConfiguracoesCalendario, criarViewCalendario, selecionarViewCalendario });
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
                renderCalendario(getEstadoCalendario(), { abrirPostit, abrirConfiguracoesCalendario, criarViewCalendario, selecionarViewCalendario });
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
                <button type="button" class="btn-mini-gerenciar btn-edit-cat-lembrete" data-edit-cat-lembrete="${nova.id}" title="Editar categoria">⚙</button>
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
            configuracoes.exibicaoHome = filtros;
        } else if (modo === "criar") {
            const novaView = {
                id: `view-${Date.now()}`,
                nome: overlay.querySelector("#nomeViewCalendario")?.value.trim() || `View ${configuracoes.viewsCalendario.length + 1}`,
                filtros
            };
            configuracoes.viewsCalendario.push(novaView);
            configuracoes.viewCalendarioAtiva = novaView.id;
        } else {
            const view = getViewCalendarioAtiva();
            view.nome = overlay.querySelector("#nomeViewCalendario")?.value.trim() || view.nome;
            view.filtros = filtros;
        }
        await salvarFirebase();
        overlay.remove();
        if (escopo === "home") renderLembretesHome();
        else renderCalendario(getEstadoCalendario(), { abrirPostit, abrirConfiguracoesCalendario, criarViewCalendario, selecionarViewCalendario });
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
    renderCalendario(getEstadoCalendario(), { abrirPostit, abrirConfiguracoesCalendario, criarViewCalendario, selecionarViewCalendario });
}

const btnConfigLembretesHome = document.getElementById("btnConfigLembretesHome");
if (btnConfigLembretesHome) btnConfigLembretesHome.onclick = () => abrirModalExibicao("home");

// Substitua a função carregarAno inteira (para incluir a chamada acima):
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
  btnAdd.innerText = anoCompleto ? "+ ADICIONAR ANO" : "+ ADICIONAR MÊS";

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

// ================= FUNÇÃO PARCELAS (HOME) =================
function aplicarParcelas() {
    // Primeiro, removemos parcelas antigas para evitar duplicação antes de reaplicar
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
function criarItem(lista, d, dataArray, ano) {
  const tr = document.createElement("tr");
  // Aplica a classe inicial se já estiver marcado
  if (d.checked) tr.classList.add("item-pago");

  tr.innerHTML = `
    <td style="width: 1%;"><input type="checkbox" ${d.checked?'checked':''}></td>
    <td><input class="input-tabela-edit" value="${d.nome}" placeholder="Nome..."></td>
    <td style="width: fit-content;"><input class="input-tabela-edit valor" value="${formatar(d.valor)}" style="text-align:right;"></td>
    <td style="width: fit-content;"><button class="removeItem">✖</button></td>
  `;
  
  const [tdCheck, tdNome, tdValor, tdBtn] = tr.children;
  const check = tdCheck.querySelector("input");
  const nome = tdNome.querySelector("input");
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
        <button class="duplicarMes" title="Duplicar">📑</button>
        <button class="removeMes" title="Excluir mês">✖</button>
    </div>`;
  
  header.onclick = () => { 
      mes.classList.toggle("collapsed"); 
      if(mes.classList.contains("collapsed")) mesesAbertos.delete(index); 
      else mesesAbertos.add(index); 
  };

  header.querySelector(".removeMes").onclick = (e) => { 
      e.stopPropagation(); 
      if(confirm("Apagar mês?")) { dados[ano].meses.splice(index, 1); carregarAno(); } 
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
                    <thead><tr><th></th><th>Item</th><th style="text-align:right;">Valor</th><th></th></tr></thead>
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
                                <option value="">💵 Dinheiro (Home)</option>
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
                    <button class="btn-cascata" title="Ativar Cascata">🔗</button>
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
        <button class="btn" style="margin-left:20px; background:var(--P05) !important;" onclick="window.abrirModalGuardar(${ano}, ${index})">📦 GUARDAR</button>
    </div>`;

  // --- LÓGICA DO FORMULÁRIO RÁPIDO ATUALIZADA ---
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
          if (cardId !== "") {
              // Se escolheu um cartão, envia para os Gastos Detalhados
              if(!gastosDetalhes[ano]) gastosDetalhes[ano] = [];
              gastosDetalhes[ano].push({
                  mes: index,
                  nome: n,
                  valor: v,
                  categoria: cat,
                  cartaoId: cardId
              });
          } else {
              // Se deixou "Dinheiro", adiciona na lista simples da Home
              data.despesas.push({ nome: n, valor: v, checked: true });
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
        <td style="text-align:right;">
            <input class="input-tabela-edit valor-fixa-mes" value="${formatar(valorExibir)}" style="text-align:right;">
        </td>
        <td></td>`;
      tr.querySelector("input").onchange = (e) => {
          data.fixasDesativadas[f.id] = !e.target.checked;
          atualizarTudo(ano);
          renderLembretesHome(); 
          renderCalendario(getEstadoCalendario(), { abrirPostit, abrirConfiguracoesCalendario, criarViewCalendario, selecionarViewCalendario });
          carregarAno();
      };
      aplicarComportamentoInput(tr.querySelector(".valor-fixa-mes"), () => valorExibir, (v) => {
          data.fixasEditadas[f.id] = v; 
          controleAvisoPendente(true);
          atualizarTudo(ano);
          renderLembretesHome();
          renderCalendario(getEstadoCalendario(), { abrirPostit, abrirConfiguracoesCalendario, criarViewCalendario, selecionarViewCalendario });
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
          renderCalendario(getEstadoCalendario(), { abrirPostit, abrirConfiguracoesCalendario, criarViewCalendario, selecionarViewCalendario });
          carregarAno();
      };
      listE.appendChild(tr);
  });

  (data.empresa || []).forEach(item => criarItem(listE, item, data.empresa, ano));
  (data.despesas || []).forEach(item => criarItem(listD, item, data.despesas, ano));

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

// ================= GESTÃO DE GASTOS DETALHADOS =================

function abrirGerenciadorCategorias() {
    document.getElementById("modalCategorias").style.display = "flex";
    renderCategoriasModal();
}

function abrirGerenciadorCartoes() {
    document.getElementById("modalCartoes").style.display = "flex";
    renderCartoesModal();
}

function garantirIdentidadeGasto(g) {
    if (!g.id) g.id = `${g.mes ?? "m"}-${g.cartaoId ?? "card"}-${g.parcelaId ?? "manual"}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (!g.criadoEm) g.criadoEm = Date.now();
    return g;
}

function abrirEditorDespesaFixaGlobal(fixaId, anoView) {
    const fixa = contasFixas.find(f => String(f.id) === String(fixaId));
    if (!fixa) {
        alert("Essa despesa pertence a um snapshot antigo e não pode ser editada globalmente.");
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
            <div class="campo" style="margin-top:10px;"><label>Cartão</label><select id="editFixaCartao" class="inputPadrao"><option value="">Dinheiro</option>${cartoes.map(c => `<option value="${c.id}" ${String(fixa.cartaoId) === String(c.id) ? 'selected' : ''}>${c.nome}</option>`).join('')}</select></div>
            <div style="display:flex; gap:10px; margin-top:20px;">
                <button class="btn" id="btnSalvarEditFixaGlobal" style="flex:1">Salvar</button>
                <button class="btn sair" id="btnFecharEditFixaGlobal" style="flex:1">Cancelar</button>
            </div>
        </div>`;

    modal.style.display = "flex";
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
            <td colspan="6" class="cartao-accordion-cell" style="--cartao-cor:${cartao?.color || 'var(--P04)'};">
                <div class="cartao-accordion-row">
                    <strong class="cartao-accordion-nome">${cartao?.nome || 'Cartão'}</strong>
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

function renderPaginaGastos() {
    const area = document.getElementById("areaGastosMensais"); 
    const anoView = document.getElementById("anoGastos").value; 
    const { mesAt, anoAt } = getMesReferenciaAtivo();
    
    if (mesesGastosAbertos.size === 0 && Number(anoView) === anoAt && !window.scrollTargetMes) {
        mesesGastosAbertos.add(mesAt);
    }

    area.innerHTML = "";

    for (let m = 11; m >= 0; m--) {
        const mData = dados[anoView]?.meses[m];
        if (!mData) continue;
        if (!mData.fixasDesativadas) mData.fixasDesativadas = {};

        const mesBox = document.createElement("div"); 
        mesBox.id = `box-gastos-mes-${m}`;
        const isOpen = mesesGastosAbertos.has(m);
        const isMesAtual = (m === mesAt && Number(anoView) === anoAt);
        mesBox.className = "mes " + (isOpen ? "" : "collapsed") + (isMesAtual ? " mesAtual" : "");

        const filtroAtual = filtrosPorMes[m] || "agrupados";
        const cartaoAddSelecionado = (filtroAtual !== "todos" && filtroAtual !== "agrupados") ? String(filtroAtual) : null;
        let gastosManuais = (gastosDetalhes[anoView] || []).filter(g => g.mes === m).map(garantirIdentidadeGasto).sort((a, b) => (a.criadoEm || 0) - (b.criadoEm || 0));
        const listaBaseFixas = mData.fixasSnapshot ? mData.fixasSnapshot : contasFixas;
        let gastosFixos = listaBaseFixas.filter(f => f.ativo && f.cartaoId);

        if(filtroAtual !== "todos" && filtroAtual !== "agrupados") {
            gastosManuais = gastosManuais.filter(g => g.cartaoId == filtroAtual);
            gastosFixos = gastosFixos.filter(f => f.cartaoId == filtroAtual);
        }

        const tCr = gastosManuais.filter(g => cartoes.find(c => c.id == g.cartaoId)?.tipo === 'Crédito').reduce((a,b) => a + b.valor, 0) +
                    gastosFixos.filter(f => !mData.fixasDesativadas[f.id] && cartoes.find(c => c.id == f.cartaoId)?.tipo === 'Crédito').reduce((a,b) => a + b.valor, 0);
        
        const tDb = gastosManuais.filter(g => cartoes.find(c => c.id == g.cartaoId)?.tipo === 'Débito').reduce((a,b) => a + b.valor, 0) +
                    gastosFixos.filter(f => !mData.fixasDesativadas[f.id] && cartoes.find(c => c.id == f.cartaoId)?.tipo === 'Débito').reduce((a,b) => a + b.valor, 0);

        mesBox.innerHTML = `
            <div class="mesHeader">
                <span>${nomesMesesFull[m]} ${anoView}</span>
                <span>${formatar(tCr + tDb)}</span>
            </div>
            <div class="mesBody">
                <div class="filtro-interno" style="margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
                    <select class="inputPadrao sel-filtro-mes" style="width:auto; height:30px; font-size:12px;">
                        <option value="agrupados" ${filtroAtual === "agrupados" ? "selected" : ""}>Agrupar por cartão</option>
                        <option value="todos" ${filtroAtual === "todos" ? "selected" : ""}>Todos os Cartões</option>
                        ${cartoes.map(c => `<option value="${c.id}" ${filtroAtual == c.id ? 'selected' : ''}>${c.nome}</option>`).join('')}
                    </select>
                </div>
                <div id="chart-pizza-${m}" style="display:flex; justify-content:center; margin: 15px 0;"></div>
                <table class="tabela-gastos">
                    <thead>
                        <tr>
                            <th style="width:1%"></th>
                            <th>Gasto</th>
                            <th>Categoria <button type="button" class="btn-mini-gerenciar btn-edit-categorias-gastos" title="Editar categorias">⚙</button></th>
                            <th>Cartão <button type="button" class="btn-mini-gerenciar btn-edit-cartoes-gastos" title="Editar cartões">⚙</button></th>
                            <th style="text-align:right;">Valor</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody id="tbody-gastos-${m}"></tbody>
                    <tfoot>
                        <tr>
                            <td></td>
                            <td><input type="text" placeholder="Novo gasto..." id="add-nome-${m}" class="inputPadrao"></td>
                            <td><select id="add-cat-${m}" class="inputPadrao">${categorias.map(c => `<option value="${c.name}">${c.name}</option>`).join('')}</select></td>
                            <td><select id="add-card-${m}" class="inputPadrao">${cartoes.map(c => `<option value="${c.id}" ${cartaoAddSelecionado === String(c.id) ? 'selected' : ''}>${c.nome}</option>`).join('')}</select></td>
                            <td><input type="text" placeholder="0,00" id="add-val-${m}" class="inputPadrao" style="text-align:right;"></td>
                            <td><button class="btn" id="btn-add-${m}">+</button></td>
                        </tr>
                    </tfoot>
                </table>
                <div class="resumo-gastos-inferior" style="margin-bottom: 15px;">
                    <div class="barra-resumo credito"><span>Crédito (Fixo+Var):</span> <span>${formatar(tCr)}</span></div>
                    <div class="barra-resumo total"><span>Total do Mês:</span> <span>${formatar(tCr + tDb)}</span></div>
                </div>
                <div style="display: flex; justify-content: center; margin-bottom: 15px;">
                    <button class="btn" style="background: var(--P05)" id="btn-add-parcela-${m}">+ NOVO PARCELAMENTO</button>
                </div>
            </div>`;

        area.appendChild(mesBox);
        const tbody = document.getElementById(`tbody-gastos-${m}`);

        // FIXAS SINCRONIZADAS
        if (gastosFixos.length > 0) {
            const trH = document.createElement("tr");
            trH.innerHTML = `<td colspan="6" style="background:rgba(255,255,255,0.05); font-size:10px; color:var(--P04); padding:5px 12px;">FIXAS SINCRONIZADAS</td>`;
            tbody.appendChild(trH);
            gastosFixos.forEach(g => {
                const tr = document.createElement("tr");
                tr.dataset.cardId = String(g.cartaoId);
                const desativada = mData.fixasDesativadas[g.id] === true;
                const catCor = categorias.find(c => c.name === g.categoria)?.color || "#888";
                tr.style.opacity = desativada ? "0.3" : "1";
                tr.innerHTML = `<td><input type="checkbox" ${!desativada ? 'checked' : ''}></td><td style="font-style:italic;">${g.nome}</td><td><span class="badge" style="border:1px solid ${catCor}; color:${catCor}">${g.categoria}</span></td><td>💳 ${cartoes.find(c => c.id == g.cartaoId)?.nome}</td><td style="text-align:right;">${formatar(g.valor)}</td><td><button class="btn-gear-fixa" title="Editar despesa fixa globalmente">⚙</button></td>`;
                tr.querySelector("input").onchange = async (e) => { mData.fixasDesativadas[g.id] = !e.target.checked; await salvarFirebase(); renderPaginaGastos(); atualizarTudo(anoView); };
                tr.querySelector(".btn-gear-fixa").onclick = () => abrirEditorDespesaFixaGlobal(g.id, anoView);
                tbody.appendChild(tr);
            });
        }

        // GASTOS MANUAIS
        gastosManuais.forEach(g => {
            const tr = document.createElement("tr");
            tr.dataset.cardId = String(g.cartaoId);
            const catCor = categorias.find(c => c.name === g.categoria)?.color || "transparent";
            const cardCor = cartoes.find(c => String(c.id) === String(g.cartaoId))?.color || "transparent";
            tr.innerHTML = `<td></td><td><input type="text" class="input-tabela-edit nome-edit" value="${g.nome}"></td><td><select class="input-tabela-edit cat-edit" style="border-left: 5px solid ${catCor}">${categorias.map(c => `<option value="${c.name}" ${g.categoria === c.name ? 'selected' : ''}>${c.name}</option>`).join('')}</select></td><td><select class="input-tabela-edit card-edit" style="border-left: 5px solid ${cardCor}">${cartoes.map(c => `<option value="${c.id}" ${String(g.cartaoId) === String(c.id) ? 'selected' : ''}>${c.nome}</option>`).join('')}</select></td><td><input type="text" class="input-tabela-edit valor-edit" value="${formatar(g.valor)}" style="text-align:right;"></td><td><button class="removeItem">✖</button></td>`;
            const inNome = tr.querySelector(".nome-edit");
            const selCat = tr.querySelector(".cat-edit");
            const selCard = tr.querySelector(".card-edit");
            const inVal = tr.querySelector(".valor-edit");
            inNome.onblur = async () => { g.nome = inNome.value; await salvarFirebase(); };
            selCat.onchange = async (e) => { g.categoria = e.target.value; await salvarFirebase(); renderPizza(m, [...gastosFixos, ...gastosManuais]); renderPaginaGastos(); };
            selCard.onchange = async (e) => { g.cartaoId = e.target.value; await salvarFirebase(); atualizarTudo(anoView); renderPaginaGastos(); };
            aplicarComportamentoInput(inVal, () => g.valor, async (v) => { g.valor = v; await salvarFirebase(); atualizarTudo(anoView); renderPaginaGastos(); }, anoView);
            tr.querySelector(".removeItem").onclick = async () => { if (g.parcelaId && confirm("Deseja apagar TODAS as parcelas deste gasto?")) { gastosDetalhes[anoView] = gastosDetalhes[anoView].filter(item => item.parcelaId !== g.parcelaId); } else if(!g.parcelaId) { gastosDetalhes[anoView].splice(gastosDetalhes[anoView].indexOf(g), 1); } await salvarFirebase(); renderPaginaGastos(); carregarAno(); };
            tbody.appendChild(tr);
        });

        if (filtroAtual === "agrupados") {
            const totaisAgrupados = {};
            gastosFixos.forEach(f => {
                if (!mData.fixasDesativadas[f.id]) totaisAgrupados[f.cartaoId] = (totaisAgrupados[f.cartaoId] || 0) + ((mData.fixasEditadas?.[f.id] !== undefined) ? mData.fixasEditadas[f.id] : f.valor);
            });
            gastosManuais.forEach(g => {
                totaisAgrupados[g.cartaoId] = (totaisAgrupados[g.cartaoId] || 0) + g.valor;
            });
            Array.from(tbody.querySelectorAll('tr:not([data-card-id])')).forEach(row => row.remove());
            agruparLinhasGastosPorCartao(tbody, totaisAgrupados);
        }

        // Eventos
        mesBox.querySelector(".mesHeader").onclick = () => { mesBox.classList.toggle("collapsed"); if(!mesBox.classList.contains("collapsed")) { mesesGastosAbertos.add(m); renderPizza(m, [...gastosFixos, ...gastosManuais]); } else mesesGastosAbertos.delete(m); };
        mesBox.querySelector(".sel-filtro-mes").onchange = (e) => { filtrosPorMes[m] = e.target.value; renderPaginaGastos(); };
        mesBox.querySelector(`#btn-add-parcela-${m}`).onclick = () => window.abrirModalParcelamento(m, anoView);
        
        // --- FUNÇÃO DE ADICIONAR ---
        const btnAddAction = async () => {
            const n = mesBox.querySelector(`#add-nome-${m}`).value;
            const v = parseValor(mesBox.querySelector(`#add-val-${m}`).value);
            if(!n || v <= 0) return alert("Preencha corretamente");
            if(!gastosDetalhes[anoView]) gastosDetalhes[anoView] = [];
            gastosDetalhes[anoView].push({ id: Date.now() + "-" + Math.random().toString(36).slice(2, 8), criadoEm: Date.now(), mes: m, nome: n, valor: v, categoria: mesBox.querySelector(`#add-cat-${m}`).value, cartaoId: mesBox.querySelector(`#add-card-${m}`).value });
            await salvarFirebase(); renderPaginaGastos(); carregarAno();
        };

        mesBox.querySelector(`#btn-add-${m}`).onclick = btnAddAction;
        mesBox.querySelectorAll(".btn-edit-categorias-gastos").forEach(btn => btn.onclick = abrirGerenciadorCategorias);
        mesBox.querySelectorAll(".btn-edit-cartoes-gastos").forEach(btn => btn.onclick = abrirGerenciadorCartoes);

        // --- ADICIONADO: ENTER NO CAMPO VALOR ---
        mesBox.querySelector(`#add-val-${m}`).onkeydown = (e) => {
            if (e.key === "Enter") btnAddAction();
        };

        if(isOpen) renderPizza(m, [...gastosFixos, ...gastosManuais]);
    }
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

document.getElementById("btnSalvarParcelaCartao").onclick = () => {
    const nome = document.getElementById("pcNome").value;
    const cartaoId = document.getElementById("pcCartao").value;
    const categoria = document.getElementById("pcCategoria").value;
    const total = parseValor(document.getElementById("pcValorTotal").value);
    const qtdInput = document.getElementById("pcQtd");
    const qtd = parseInt(qtdInput.value);
    
    // --- FEEDBACK DE VALIDAÇÃO ---
    if (!nome) return alert("Por favor, dê um nome para a compra.");
    if (total <= 0) return alert("O valor total deve ser maior que zero.");
    if (!qtd || qtd < 1) return alert("Preencha o número de parcelas.");
    
    const pId = Date.now(); 
    const valP = Number((total / qtd).toFixed(2));
    let mesC = contextParcelaCartao.mes;
    let anoC = contextParcelaCartao.ano;

    for(let i = 1; i <= qtd; i++) {
        if(!gastosDetalhes[anoC]) gastosDetalhes[anoC] = [];
        
        gastosDetalhes[anoC].push({
            mes: mesC,
            nome: `${nome} (${i}/${qtd})`,
            valor: valP,
            categoria: categoria,
            cartaoId: cartaoId,
            parcelaId: pId 
        });

        mesC++;
        if(mesC > 11) { mesC = 0; anoC++; }
    }

    document.getElementById("modalParcelaCartao").style.display = "none";
    salvarDadosLocal();
    atualizarTudo(contextParcelaCartao.ano);
    
    // Se estiver na tela de gastos, renderiza ela. Se não, a Home já foi atualizada pelo atualizarTudo.
    if (window.location.hash === "#gastos") renderPaginaGastos();
};

// FUNÇÃO UNIFICADA PARA O MODAL DE PARCELAMENTO
window.abrirModalParcelamento = (mes, ano) => {
    // Define para qual mês a conta vai
    contextParcelaCartao = { mes: parseInt(mes), ano: parseInt(ano) };
    
    const selCard = document.getElementById("pcCartao");
    const selCat = document.getElementById("pcCategoria");
    const inQtd = document.getElementById("pcQtd");
    const inNome = document.getElementById("pcNome");
    const inValor = document.getElementById("pcValorTotal");

    // 1. Limpa os campos para o placeholder aparecer
    if(inQtd) inQtd.value = ""; 
    if(inNome) inNome.value = "";
    if(inValor) inValor.value = "";

    // 2. Preenche as listas de Cartões e Categorias
    selCard.innerHTML = cartoes.map(c => `<option value="${c.id}">${c.nome}</option>`).join('');
    selCat.innerHTML = categorias.map(c => `<option value="${c.name}">${c.name}</option>`).join('');

    // 3. Lógica das bordas coloridas
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
    document.getElementById("modalParcelaCartao").style.display = "flex";
};

function renderPizza(mesIdx, gastos) {
    const div = document.querySelector(`#chart-pizza-${mesIdx}`); if (!div || gastos.length === 0) return;
    const tColor = getComputedStyle(document.body).getPropertyValue('--P02').trim() || '#000000';
    const res = {}; gastos.forEach(g => res[g.categoria] = (res[g.categoria] || 0) + g.valor);
    const options = { series: Object.values(res), labels: Object.keys(res), chart: { type: 'donut', height: 220, background: 'transparent' }, colors: Object.keys(res).map(n => (categorias.find(c => c.name === n)?.color || "#888")), legend: { position: 'bottom', labels: { colors: tColor } }, plotOptions: { pie: { donut: { labels: { show: true, name: { color: tColor }, value: { color: tColor } } } } } };
    div.innerHTML = ""; new ApexCharts(div, options).render();
}

// --- VARIÁVEL GLOBAL DE CONTROLE DE EDIÇÃO ---
let idEditando = null; 

// Função para limpar o estado de edição quando clicar no calendário
window.resetEdicao = () => {
    resetCamposLembrete();
};

// --- FUNÇÃO PARA CARREGAR DADOS NO MODAL ---
window.editarLembrete = (l) => {
    idEditando = l.id; // Salva o ID que estamos editando
    
    const modal = document.getElementById("modalLembrete");
    if (!modal) return;

    modal.style.display = "flex";
    
    // Preenche os campos
    document.getElementById("lemTitulo").value = l.nome;
    document.getElementById("lemData").value = l.data;
    document.getElementById("lemHora").value = l.hora || "";
    document.getElementById("lemValor").value = l.valor || "";
    document.getElementById("lemAnotacoes").value = l.anotacoes || "";
    subtarefasModal = Array.isArray(l.subtarefas) ? structuredClone(l.subtarefas) : [];
    popularCategoriasLembreteSelect("lemCategoria", l.categoriaId);
    renderSubtarefasModal();
    document.getElementById("lemRecorrente").checked = l.recorrente;
    
    const divDias = document.getElementById("escolhaDiasSemana");
    divDias.style.display = l.recorrente ? "grid" : "none";
    
    // Marca os dias da semana
    divDias.querySelectorAll("input").forEach(input => {
        input.checked = l.diasSemana ? l.diasSemana.includes(parseInt(input.value)) : false;
    });

    // Muda o texto do botão para avisar que é edição
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
                <td class="drag-handle">☰</td>
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
                        <option value="">💵 Dinheiro</option>
                        ${cartoes.map(c => `<option value="${c.id}" ${String(cf.cartaoId) === String(c.id) ? 'selected' : ''}>${c.nome}</option>`).join('')}
                    </select>
                </td>
                <td><button class="removeItem">✖</button></td>
            `;

            // --- LÓGICA DOS INPUTS ---

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
                // GARANTE A FORMATAÇÃO R$ AO SAIR
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

            // Categorias e Cartões
            tr.querySelector(".cat").onchange = (e) => {
                cf.categoria = e.target.value;
                tr.querySelector(".cat").style.borderLeft = `5px solid ${categorias.find(c => c.name === e.target.value).color}`;
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
      <td><button class="removeItem">✖</button></td>
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

function renderCategoriasModal() {
    const lista = document.getElementById("listaCategoriasModal"); if(!lista) return; lista.innerHTML = "";
    categorias.forEach((cat, index) => {
      const li = document.createElement("li"); li.style.display = "flex"; li.style.gap = "10px"; li.style.padding = "8px 0"; li.style.alignItems = "center";
      li.innerHTML = `<input type="color" class="seletor-cor-quadrado" value="${cat.color}" style="width:30px; height:30px;"><input type="text" class="inputPadrao cat-name-edit" value="${cat.name}" style="flex:2"><button class="removeItem" style="width:22px;height:22px">✖</button>`;
      const [col, nam, btR] = li.children;
      col.onchange = (e) => { categorias[index].color = e.target.value; salvarDadosLocal(); }; nam.onblur = (e) => { categorias[index].name = e.target.value; salvarDadosLocal(); };
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
            <input type="text" class="inputPadrao" value="${c.nome}" style="flex:2" placeholder="Nome do Cartão">
            <select class="inputPadrao" style="width:100px">
                <option value="Crédito" ${c.tipo=='Crédito'?'selected':''}>Crédito</option>
                <option value="Débito" ${c.tipo=='Débito'?'selected':''}>Débito</option>
            </select>
            <div class="campo" style="width:100px">
                <small style="font-size:9px; opacity:0.7">Fech.</small>
                <input type="number" class="inputPadrao input-fechamento" value="${c.fechamento || 1}" title="Dia de Fechamento" min="1" max="31">
            </div>
            <div class="campo" style="width:100px">
                <small style="font-size:9px; opacity:0.7">Venc.</small>
                <input type="number" class="inputPadrao input-vencimento" value="${c.vencimento}" title="Dia de Vencimento" min="1" max="31">
            </div>
            <button class="removeItem">✖</button>`;
            
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

onAuthStateChanged(auth, async (user) => {
if (user) {
    usuarioLogado = user; 
    document.getElementById("displayEmail").textContent = user.email;
    
    // Recupera a senha da sessão para descriptografia
    if (!senhaDoUsuario) {
        senhaDoUsuario = sessionStorage.getItem("temp_key") || "";
    }

    const snap = await getDoc(doc(db, "financas", user.uid));
    if (snap.exists()) {
        try {
            // Só tenta descriptografar se houver uma senha na memória
            if (!senhaDoUsuario) throw new Error("Senha ausente");

            const res = await decryptData(snap.data(), senhaDoUsuario);
            
            // ATRIBUIÇÃO DAS VARIÁVEIS DO BANCO PARA A MEMÓRIA DO APP
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

            // INICIALIZAÇÃO DA INTERFACE COM OS DADOS CARREGADOS
            atualizarSeletorAnos();
            aplicarParcelas();
            renderCaixinhas(); // <--- RENDERIZANDO CAIXINHAS
        } catch (err) {
            console.error("Erro na descriptografia:", err);
            alert("Sua sessão expirou ou a chave de segurança é inválida. Por favor, faça login novamente.");
            signOut(auth);
            return;
        }
    }

    // CONFIGURAÇÕES VISUAIS E ESTADOS INICIAIS
    atualizarSaudacao();
    aplicarTema(configuracoes.tema);
    atualizarTituloSite();
    
    document.getElementById("authContainer").style.display = "none"; 
    document.getElementById("appContainer").style.display = "block";
    
    const { mesAt } = getMesReferenciaAtivo(); 
    mesesAbertos.add(mesAt); 
    
    // RENDERIZAÇÃO DOS MÓDULOS DA HOME
    carregarAno(); 
    renderContasFixas(); 
    renderReceitasFixas();
    renderLembretesHome(); 
    if (configuracoes.notasVistasVersao !== VERSAO_ATUAL_APP) {
        window.location.hash = "#notas";
    }
    roteador();

    const seletorTemaFooter = document.getElementById("cfgTemaFooter");
    if(seletorTemaFooter) seletorTemaFooter.value = configuracoes.tema || "planetario";

  } else { 
      // Caso não haja usuário logado
      document.getElementById("authContainer").style.display = "flex"; 
      document.getElementById("appContainer").style.display = "none"; 
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
        const nome = nomeEl?.value.trim();
        const valor = parseValor(valorEl?.value || "");
        if (!nome || valor <= 0) {
            alert("Informe nome e valor da despesa.");
            return;
        }
        const { mesAt, anoAt } = getMesReferenciaAtivo();
        if (!dados[anoAt]) dados[anoAt] = { meses: [] };
        while (dados[anoAt].meses.length <= mesAt) dados[anoAt].meses.push({ despesas: [], empresa: [], cartoesPagos: {}, fixasDesativadas: {}, receitasDesativadas: {}, fixasEditadas: {} });
        const criadoEm = Date.now();
        if (destinoEl?.value === "cartao") {
            if (!cartaoEl?.value) {
                alert("Selecione um cartao.");
                return;
            }
            if (!gastosDetalhes[anoAt]) gastosDetalhes[anoAt] = [];
            gastosDetalhes[anoAt].push({
                id: criadoEm,
                criadoEm,
                nome,
                valor,
                categoria: categoriaEl?.value || "Essencial",
                cartaoId: cartaoEl.value,
                mes: mesAt
            });
        } else {
            dados[anoAt].meses[mesAt].despesas.push({
                id: criadoEm,
                criadoEm,
                nome,
                valor,
                categoria: categoriaEl?.value || "Essencial",
                dia: new Date().getDate(),
                checked: true
            });
        }
        if (nomeEl) nomeEl.value = "";
        if (valorEl) valorEl.value = "";
        await salvarFirebase();
        carregarAno();
        renderPaginaGastos();
        renderBalancoRapido();
    };
}

document.getElementById("exportarTudoBtn").onclick = () => { normalizarDadosApp(); const b = { dados, parcelasMemoria, lembretes, contasFixas, receitasFixas, salarioFixoBase, categorias, categoriasLembretes, configuracoes, cartoes, gastosDetalhes, caixinhas }; const blob = new Blob([JSON.stringify(b, null, 2)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `backup.json`; a.click(); };

document.getElementById("inputImport").onchange = (e) => { 
    const r = new FileReader(); 
    r.onload = (ev) => { 
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
        alert("Backup carregado com sucesso!");
    }; 
    r.readAsText(e.target.files[0]); 
};

// Função central de navegação
// FUNÇÃO CENTRAL DE NAVEGAÇÃO
async function roteador() {
    const hash = window.location.hash || "#resumo"; 

    const views = {
        "#resumo": "viewResumo",
        "#gastos": "viewGastos",
        "#calendario": "viewCalendario",
        "#analise": "viewAnalise",
        "#notas": "viewNotas"
    };

    // 1. Esconder todas as seções e remover o estado ativo do menu
    Object.values(views).forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = "none";
    });

    ["navResumo", "navGastos", "navCalendario", "navAnalise"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove("active");
    });

    // 2. Mostrar a seção atual
    const currentViewId = views[hash] || "viewResumo";
    const currentViewEl = document.getElementById(currentViewId);
    if (currentViewEl) currentViewEl.style.display = "block";
    
    // 3. Lógica específica de inicialização de cada aba
    if (hash === "#resumo" || hash === "") {
        document.getElementById("navResumo")?.classList.add("active");
        atualizarSaudacao(); // Atualiza Bom dia/Boa tarde...
        carregarAno();       // Renderiza os cards dos meses na Home
    } 
    else if (hash === "#gastos") {
        document.getElementById("navGastos")?.classList.add("active");
        renderPaginaGastos(); // Renderiza as tabelas de gastos detalhados
    } 
    else if (hash === "#calendario") {
        document.getElementById("navCalendario")?.classList.add("active");
        
        // Chamada assíncrona do calendário (espera a API de feriados)
        await renderCalendario(
            getEstadoCalendario(), 
            { abrirPostit, abrirConfiguracoesCalendario, criarViewCalendario, selecionarViewCalendario }
        );
    }
    else if (hash === "#analise") {
        document.getElementById("navAnalise")?.classList.add("active");
        const anoAnalise = document.getElementById("anoAnalise")?.value || document.getElementById("ano")?.value || hoje.getFullYear();
        atualizarTudo(anoAnalise);
        atualizarGrafico(Number(anoAnalise));
    }
}

window.addEventListener("hashchange", roteador);

// Remover os .onclick vazios e garantir que o roteador rode ao carregar
window.addEventListener("load", () => {
    if (usuarioLogado) roteador();
});

// Escuta quando o usuário muda o hash (clica no menu ou usa o botão voltar)
window.addEventListener("hashchange", roteador);

// Atualiza os cliques do menu para não recarregar a página
[document.getElementById("navResumo"), document.getElementById("navGastos"), document.getElementById("navCalendario"), document.getElementById("navAnalise")].forEach(link => {
    if (!link) return;
    link.onclick = (e) => {
        // O navegador já mudará o hash pelo href, o evento hashchange cuidará do resto
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

document.getElementById("btnSalvarSenha").onclick = async () => { 
    const a = document.getElementById("pwdAntiga").value;
    const n = document.getElementById("pwdNova").value; 
    
    if(!a || !n) {
        alert("Preencha a senha antiga e a nova senha.");
        return;
    }

    try { 
        // 1. Reautentica o usuário para ter permissão de trocar a senha
        const cred = EmailAuthProvider.credential(usuarioLogado.email, a); 
        await reauthenticateWithCredential(usuarioLogado, cred); 
        
        // 2. Atualiza a senha no Firebase Auth
        await updatePassword(usuarioLogado, n); 
        
        // 3. Atualiza a chave de criptografia na memória e na sessão
        senhaDoUsuario = n; 
        sessionStorage.setItem("temp_key", n); 
        
        // 4. Salva os dados novamente na nuvem usando a NOVA SENHA
        await salvarFirebase(); 
        
        alert("Senha e criptografia atualizadas com sucesso!"); 
        document.getElementById("pwdAntiga").value = "";
        document.getElementById("pwdNova").value = "";
    } catch (e) { 
        console.error("Erro detalhado:", e);
        alert("Erro: Verifique se a senha antiga está correta ou se a nova tem pelo menos 6 caracteres."); 
    } 
}; // <-- Aqui estava o erro: precisava fechar a função

document.getElementById("loginBtn").onclick = async () => { const e = document.getElementById("email").value, s = document.getElementById("senha").value; try { await signInWithEmailAndPassword(auth, e, s); senhaDoUsuario = s; sessionStorage.setItem("temp_key", s); } catch (err) { alert("Erro login"); } };
document.getElementById("cadastroBtn").onclick = async () => { 
    const n = document.getElementById("cadastroNome").value.trim();
    const e = document.getElementById("email").value;
    const s = document.getElementById("senha").value; 

    if (!n) {
        alert("Por favor, preencha seu nome.");
        return;
    }

    try { 
        await createUserWithEmailAndPassword(auth, e, s); 
        senhaDoUsuario = s; 
        sessionStorage.setItem("temp_key", s); 
        
        // Define o nome de exibição nas configurações e atualiza o site
        configuracoes.nomeUsuario = n;
        atualizarTituloSite();
        
        await salvarFirebase(); 
    } catch (err) { 
        alert("Erro ao cadastrar. Verifique os dados."); 
    } 
};
document.getElementById("logoutBtn").onclick = () => { signOut(auth); sessionStorage.clear(); location.reload(); };
document.getElementById("btnSettings").onclick = () => { 
    const modalCfg = document.getElementById("modalConfiguracoes"); 
    if(!modalCfg) return; 
    
    // Preenche os campos de texto com o que está na memória
    document.getElementById("cfgNomeUsuario").value = configuracoes.nomeUsuario || ""; 
    document.getElementById("cfgDiaSalario").value = configuracoes.diaSalario || 5;
    document.getElementById("cfgDiaVirada").value = configuracoes.diaVirada || 1; 
    
    // Ajusta os botões de rádio (Mês Atual / Próximo Mês)
    const ref = configuracoes.referenciaMes || "atual"; 
    document.getElementById("refAtual").checked = (ref === "atual"); 
    document.getElementById("refProximo").checked = (ref === "proximo"); 
    
    modalCfg.style.display = "flex"; 
};
document.getElementById("btnSalvarConfig").onclick = async () => { 
    // Primeiro, congelamos o que virou "passado" com base na configuração antiga
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
document.getElementById("btnGerenciarCategorias").onclick = () => { document.getElementById("modalCategorias").style.display = "flex"; renderCategoriasModal(); };
document.getElementById("btnGerenciarCartoes").onclick = () => { document.getElementById("modalCartoes").style.display = "flex"; renderCartoesModal(); };
document.getElementById("btnFecharModal").onclick = () => { document.getElementById("modalCategorias").style.display = "none"; carregarAno(); renderContasFixas(); };
document.getElementById("btnFecharCartoes").onclick = () => document.getElementById("modalCartoes").style.display = "none";
document.getElementById("btnSalvarCartoes").onclick = async () => { await salvarFirebase(); document.getElementById("modalCartoes").style.display = "none"; carregarAno(); renderPaginaGastos(); };
document.getElementById("btnAddCartao").onclick = () => { 
    // Adicionado fechamento: 1 como padrão
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
document.getElementById("headerContasFixas").onclick = () => document.getElementById("moduloContasFixas").classList.toggle("collapsed");
document.getElementById("headerReceitasFixas").onclick = () => document.getElementById("moduloReceitasFixas").classList.toggle("collapsed");
document.getElementById("showSignup").onclick = (e) => { e.preventDefault(); document.getElementById("loginActions").style.display = "none"; document.getElementById("signupActions").style.display = "block"; };
document.getElementById("showLogin").onclick = (e) => { e.preventDefault(); document.getElementById("signupActions").style.display = "none"; document.getElementById("loginActions").style.display = "block"; };
document.getElementById("btnFecharParcelaCartao").onclick = () => document.getElementById("modalParcelaCartao").style.display = "none";
document.getElementById("btnIrCalendario").onclick = () => window.location.hash = "#calendario";

// FUNÇÃO PARA ATUALIZAR OS SELETORES DE ANO DINAMICAMENTE
function atualizarSeletorAnos() {
    const seletores = [document.getElementById("ano"), document.getElementById("anoGastos"), document.getElementById("anoAnalise")];
    
    // 1. Pega as chaves do objeto 'dados' (que são os anos criados)
    let anosCriados = Object.keys(dados).map(Number);
    
    // 2. Garante o ano atual e o próximo ano na lista para expansão
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
            
            // Se for o ano que já estava ou o ano atual (caso seja a primeira carga)
            if (valorAntigo) {
                if (String(a) === String(valorAntigo)) o.selected = true;
            } else {
                if (a === anoHoje) o.selected = true;
            }
            
            s.appendChild(o);
        });

        // Reaplica o evento de mudança
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

function resetCamposLembrete() {
    idEditando = null;
    subtarefasModal = [];
    document.getElementById("btnSalvarLembrete").innerText = "Salvar";
    document.getElementById("lemTitulo").value = "";
    document.getElementById("lemData").value = "";
    document.getElementById("lemHora").value = "";
    document.getElementById("lemValor").value = "";
    document.getElementById("lemAnotacoes").value = "";
    document.getElementById("lemRecorrente").checked = false;
    document.getElementById("escolhaDiasSemana").style.display = "none";
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

// Exibe/Esconde dias da semana no modal
document.getElementById("lemRecorrente").onchange = (e) => {
    document.getElementById("escolhaDiasSemana").style.display = e.target.checked ? "grid" : "none";
};

document.getElementById("btnSalvarLembrete").onclick = async () => {
    const titulo = document.getElementById("lemTitulo").value;
    const dataVal = document.getElementById("lemData").value;

    if (!titulo || !dataVal) {
        alert("Título e Data são obrigatórios.");
        return;
    }

    // Se estivermos editando, removemos o antigo da lista antes de adicionar o novo
    if (idEditando) {
        lembretes = lembretes.filter(x => x.id !== idEditando);
    }

    const recorrente = document.getElementById("lemRecorrente").checked;
    const diasSelecionados = Array.from(document.querySelectorAll("#escolhaDiasSemana input:checked")).map(i => parseInt(i.value));

    const novoLembrete = { 
        id: idEditando || Date.now(), // Mantém o ID se for edição, senão cria um novo
        nome: titulo, 
        data: dataVal, 
        hora: document.getElementById("lemHora").value,
        valor: parseValor(document.getElementById("lemValor").value),
        categoriaId: document.getElementById("lemCategoria")?.value || categoriasLembretes[0]?.id || "geral",
        anotacoes: document.getElementById("lemAnotacoes")?.value || "",
        subtarefas: subtarefasModal,
        concluido: subtarefasModal.length > 0 && subtarefasModal.every(st => st.concluida),
        recorrente: recorrente,
        diasSemana: diasSelecionados
    };
    
    lembretes.push(novoLembrete);
    
    // Reseta o estado de edição
    idEditando = null;
    document.getElementById("btnSalvarLembrete").innerText = "Salvar";

    // Salva e atualiza tudo
    await salvarFirebase();
    renderLembretesHome();
    
    document.getElementById("modalLembrete").style.display = "none";
    resetCamposLembrete();

    // Recarrega o calendário se estiver visível
    renderCalendario(
        getEstadoCalendario(), 
        { abrirPostit, abrirConfiguracoesCalendario, criarViewCalendario, selecionarViewCalendario }
    );
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

    const renderConteudo = (modoEdicao = false) => {
        let infoRecorrencia = "";
        if (l.recorrente && l.diasSemana?.length > 0) {
            const nomesDias = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
            const diasTexto = l.diasSemana.map(d => nomesDias[d]).join(", ");
            infoRecorrencia = `<small style="display:block; font-size:12px; opacity:0.6;">(toda ${diasTexto})</small>`;
        }

        if (!modoEdicao) {
            return `
                <div class="modal-content postit-amarelo" style="padding:25px; min-width:280px; position:relative; background:${corPostit} !important; color:${corTextoPostit} !important;">
                    <span class="btn-editar-p" style="position:absolute; right:15px; top:15px; cursor:pointer; font-size:20px;">✏️</span>
                    <h3 style="margin-top:0; border-bottom:1px solid ${corLinhaPostit}; padding-bottom:8px; padding-right:30px; color:${corTextoPostit};">
                        ${l.nome} ${infoRecorrencia}
                    </h3>
                    <div style="margin: 15px 0; font-size: 18px;">
                        <p>📅 <strong>Data:</strong> ${l.data.split('-').reverse().join('/')}</p>
                        <p>⏰ <strong>Hora:</strong> ${l.hora || '---'}</p>
                        <p>💰 <strong>Valor:</strong> ${l.valor ? formatar(l.valor) : '---'}</p>
                        ${l.anotacoes ? `<p><strong>Anotações:</strong> ${l.anotacoes}</p>` : ""}
                        ${l.subtarefas?.length ? `<div class="subtarefas-home postit-checklist">${l.subtarefas.map(st => `<label><input type="checkbox" class="check-subtarefa-postit" data-subtarefa-id="${st.id}" ${st.concluida ? "checked" : ""}> <span>${st.texto}</span></label>`).join("")}</div>` : ""}
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
                    <input type="text" class="postit-edit-input edit-nome" value="${l.nome}" placeholder="Título">
                    <input type="date" class="postit-edit-input edit-data" value="${l.data}">
                    <input type="time" class="postit-edit-input edit-hora" value="${l.hora || ''}">
                    <input type="text" class="postit-edit-input edit-valor" value="${l.valor || ''}" placeholder="Valor R$">
                    <div style="margin-top:15px; background: rgba(0,0,0,0.05); padding: 10px;">
                        <label style="cursor:pointer; display:flex; align-items:center; gap:8px;">
                            <input type="checkbox" class="edit-recorrente" ${l.recorrente ? 'checked' : ''}> Repetir semanalmente?
                        </label>
                        <div class="edit-dias" style="display:${l.recorrente ? 'grid' : 'none'}; grid-template-columns: repeat(7, 1fr); gap:5px; margin-top:10px;">
                            ${[0,1,2,3,4,5,6].map(d => `<label style="display:flex; flex-direction:column; align-items:center; font-size:10px; cursor:pointer;"><input type="checkbox" value="${d}" ${l.diasSemana?.includes(d) ? 'checked' : ''}>${['D','S','T','Q','Q','S','S'][d]}</label>`).join('')}
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
        
        // Evento de exclusão (funciona nos dois modos agora)
        const btnExcluir = overlay.querySelector(".btn-excluir-p");
        if(btnExcluir) btnExcluir.onclick = async () => { 
            if(confirm("Deseja apagar este lembrete permanentemente?")) { 
                lembretes = lembretes.filter(x => x.id !== l.id); 
                await salvarFirebase(); 
                renderLembretesHome(); 
                renderCalendario(getEstadoCalendario(), { abrirPostit, abrirConfiguracoesCalendario, criarViewCalendario, selecionarViewCalendario });
                overlay.remove(); 
            } 
        };

        const checkRec = overlay.querySelector(".edit-recorrente");
        if(checkRec) checkRec.onchange = (e) => overlay.querySelector(".edit-dias").style.display = e.target.checked ? "grid" : "none";

        overlay.querySelectorAll(".check-subtarefa-postit").forEach(input => {
            input.onchange = async (e) => {
                const subtarefa = l.subtarefas?.find(st => String(st.id) === String(e.target.dataset.subtarefaId));
                if (!subtarefa) return;
                subtarefa.concluida = e.target.checked;
                l.concluido = l.subtarefas.length > 0 && l.subtarefas.every(st => st.concluida);
                await salvarFirebase();
                renderLembretesHome();
                if (window.location.hash === "#calendario") renderCalendario(getEstadoCalendario(), { abrirPostit, abrirConfiguracoesCalendario, criarViewCalendario, selecionarViewCalendario });
            };
        });
        
        const btnSalvar = overlay.querySelector(".btn-salvar-p");
        if(btnSalvar) btnSalvar.onclick = async () => {
            l.nome = overlay.querySelector(".edit-nome").value;
            l.data = overlay.querySelector(".edit-data").value;
            l.hora = overlay.querySelector(".edit-hora").value;
            l.valor = parseValor(overlay.querySelector(".edit-valor").value);
            l.recorrente = overlay.querySelector(".edit-recorrente").checked;
            l.diasSemana = Array.from(overlay.querySelectorAll(".edit-dias input:checked")).map(i => parseInt(i.value));
            await salvarFirebase(); renderLembretesHome();
            renderCalendario(getEstadoCalendario(), { abrirPostit, abrirConfiguracoesCalendario, criarViewCalendario, selecionarViewCalendario });
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

// --- FUNÇÕES DE CAIXINHA (GARANTIR ESCOPO GLOBAL) ---

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
                <!-- COLUNA 1: DADOS E GRÁFICO -->
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

                <!-- COLUNA 2: HISTÓRICO ESTILO AGENDA -->
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
                                    <button class="btn-del-hist" title="Excluir este lançamento" onclick="window.excluirMovimentoCaixinha('${h.ano}', ${h.mesIdx}, '${h.origem}', ${h.timestamp || 'null'}, '${h.caixinhaId || ''}', ${Number(h.valor) || 0}, '${h.tipo || ''}')">✖</button>
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
        
        // Configuração do Gráfico de Área (Mês a Mês)
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

        // Faz o scroll do histórico começar sempre no final (lançamentos recentes)
        const historyDiv = card.querySelector(".cx-history-list");
        if (historyDiv) {
            historyDiv.scrollTop = historyDiv.scrollHeight;
        }
    });
}

// 1. CÁLCULO DA CAIXINHA (Lê de 3 lugares diferentes agora)
function obterDadosCaixinha(id) {
    let total = 0;
    let historico = [];
    let dadosGrafico = []; 

    const anos = Object.keys(dados).map(Number).sort((a,b) => a - b);
    anos.forEach(ano => {
        if (!dados[ano].meses) return;
        dados[ano].meses.forEach((m, idx) => {
            // A) Depósitos (em despesas)
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

// 2. BOTÃO GUARDAR (Afeta o Mês)
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
            nome: `📦 DEPÓSITO: ${caixinhas.find(c => c.id == select.value).nome}`,
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

// 3. BOTÃO DEPÓSITO NO CARD (Não afeta o mês)
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

// 4. FUNÇÃO DE EXCLUIR REGISTRO DO HISTÓRICO
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
        alert("NÃ£o encontrei o lanÃ§amento original para excluir.");
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
        
        // Salva na nuvem a exclusão
        await salvarFirebase();
    */
};

window.excluirCaixinha = (id) => {
    if (confirm("Deseja apagar esta CAIXINHA inteira? \n\nOs registros feitos nos meses não sumirão, mas a caixinha deixará de ser listada aqui.")) {
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

    // Pega o ano que está selecionado na tela no momento
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

        if(valor <= 0) { alert("Digite um valor válido."); return; }

        // Adiciona como uma "Renda" (empresa) no mês para o saldo subir
        mData.empresa.push({
            nome: `💰 [RESG] ${cxObj.nome}`,
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

// --- CONFIGURAÇÃO DOS BOTÕES DE CAIXINHA ---

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
        
        if (!nome) { alert("Dê um nome para a caixinha."); return; }

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

