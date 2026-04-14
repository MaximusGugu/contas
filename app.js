import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { renderCalendario, calcularDiaPagamento, obterFeriados } from "./calendario.js";

const firebaseConfig = {
  apiKey: "AIzaSyBb12Oevy0LkVc876iCh-xYegQWfqCgC3I",
  authDomain: "financas-mensais-96fb1.firebaseapp.com",
  projectId: "financas-mensais-96fb1",
  storageBucket: "financas-mensais-96fb1.firebasestorage.app",
  messagingSenderId: "547572033284",
  appId: "1:547572033284:web:e7d7cab9098b90579d1251"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

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
let categorias = [{name: "Essencial", color: "#3C5558"}, {name: "Alimentação", color: "#D78341"}, {name: "Lazer", color: "#586E5F"}, {name: "Contas", color: "#e74c3c"}];
let configuracoes = { diaVirada: 1, nomeUsuario: "", referenciaMes: "atual", tema: "planetario" };
let cartoes = [];
let gastosDetalhes = {}; 
let filtrosPorMes = {};

const hoje = new Date();
const nomesMesesFull = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const nomesMesesCurto = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
let contextParcelaCartao = { mes: 0, ano: 2024 };

// ================= FUNÇÕES DE APOIO =================
// CÁLCULO DINÂMICO DE SALDO (Soma todos os depósitos e subtrai resgates)

window.abrirModalParcelamento = (mes, ano) => {
    contextParcelaCartao = { mes: parseInt(mes), ano: parseInt(ano) };
    
    const selCard = document.getElementById("pcCartao");
    const selCat = document.getElementById("pcCategoria");
    const inQtd = document.getElementById("pcQtd");
    const inNome = document.getElementById("pcNome");
    const inValor = document.getElementById("pcValorTotal");

    // 1. Limpa os inputs para o placeholder aparecer
    if(inQtd) inQtd.value = ""; 
    if(inNome) inNome.value = "";
    if(inValor) inValor.value = "";

    // 2. Preenche os dropdowns garantindo que os dados atuais do sistema entrem
    selCard.innerHTML = cartoes.map(c => `<option value="${c.id}">${c.nome}</option>`).join('');
    selCat.innerHTML = categorias.map(c => `<option value="${c.name}">${c.name}</option>`).join('');

    // 3. Aplica a lógica de cores dinâmicas
    const atualizarCores = () => {
        const corCard = cartoes.find(c => String(c.id) === String(selCard.value))?.color || "transparent";
        const corCat = categorias.find(c => c.name === selCat.value)?.color || "transparent";
        selCard.style.borderLeft = `5px solid ${corCard}`;
        selCat.style.borderLeft = `5px solid ${corCat}`;
    };

    selCard.onchange = atualizarCores;
    selCat.onchange = atualizarCores;
    atualizarCores(); // Inicia as cores

    document.getElementById("modalParcelaCartao").style.display = "flex";
};

// ATUALIZAÇÃO DO DEPÓSITO (Não cria despesa no mês)
window.abrirModalDepositoCaixinha = (cxId) => {
    const modal = document.getElementById("modalDepositoCaixinha");
    const selectMes = document.getElementById("dcMesDestino");
    const inputVal = document.getElementById("dcValor");
    const selectTipo = document.getElementById("dcTipo");
    const cxObj = caixinhas.find(c => c.id == cxId);
    const anoAt = document.getElementById("ano").value;

    selectMes.innerHTML = dados[anoAt].meses.map((m, i) => `<option value="${i}">${nomesMesesFull[i]}</option>`).join('');

    document.getElementById("btnConfirmarDepositoCx").onclick = () => {
        const valor = parseValor(inputVal.value);
        const mesIdx = selectMes.value;
        const mData = dados[anoAt].meses[mesIdx];
        const tipo = selectTipo.value;

        if(valor <= 0) return alert("Valor inválido");

        if(!mData.movimentosCaixinha) mData.movimentosCaixinha = [];
        
        mData.movimentosCaixinha.push({
            tipo: tipo, // 'deposito' ou 'rendimento'
            valor: valor,
            caixinhaId: cxId,
            timestamp: Date.now()
        });

        salvarDadosLocal();
        atualizarTudo(anoAt);
        modal.style.display = "none";
        inputVal.value = "";
    };
    modal.style.display = "flex";
};

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
    renderCalendario(
        { cartoes, contasFixas, receitasFixas, lembretes, configuracoes, gastosDetalhes }, 
        { abrirPostit }
    );
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

function aplicarTema(tema) { 
    const t = tema || "planetario";
    document.body.className = "theme-" + t; 
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
        const hoje = new Date();
        const hojeSemHoras = new Date(hoje);
        hojeSemHoras.setHours(0,0,0,0);

        const feriados = await obterFeriados(hoje.getFullYear());
        const anoSelecionado = Number(document.getElementById("ano")?.value) || hoje.getFullYear();

        const domingo = new Date(hoje);
        domingo.setDate(hoje.getDate() - hoje.getDay());
        const sabado = new Date(domingo);
        sabado.setDate(domingo.getDate() + 6);
        sabado.setHours(23,59,59,999);

        let eventosSemana = [];

        for (let dataLoop = new Date(hojeSemHoras); dataLoop <= sabado; dataLoop.setDate(dataLoop.getDate() + 1)) {
            const diaNum = dataLoop.getDate();
            const mesIdx = dataLoop.getMonth();
            const anoDoDia = dataLoop.getFullYear();
            const isoData = dataLoop.toLocaleDateString('en-CA'); 
            const mData = dados[anoDoDia]?.meses[mesIdx];

            // 1. Lembretes
            lembretes.filter(l => l.data === isoData).forEach(l => {
                eventosSemana.push({ nome: l.nome, info: l.hora || "Lembrete", valor: null, data: new Date(dataLoop), tipo: "reminder" });
            });

            // 2. Cartões (CONSULTANDO PAGAMENTO)
            cartoes.forEach(c => {
                if (parseInt(c.vencimento) === diaNum) {
                    const totalVariavel = (gastosDetalhes[anoDoDia] || [])
                        .filter(g => g.mes === mesIdx && String(g.cartaoId) === String(c.id))
                        .reduce((acc, g) => acc + g.valor, 0);
                    const totalFixoNoCard = contasFixas
                        .filter(f => f.ativo && String(f.cartaoId) === String(c.id))
                        .reduce((acc, f) => acc + f.valor, 0);
                    
                    if ((totalVariavel + totalFixoNoCard) > 0) {
                        const pago = mData?.cartoesPagos?.[c.id] === true;
                        eventosSemana.push({ 
                            nome: `Fatura: ${c.nome}`, 
                            info: pago ? "✅ PAGO" : "💳 PENDENTE", 
                            valor: totalVariavel + totalFixoNoCard, 
                            data: new Date(dataLoop), 
                            tipo: "card" 
                        });
                    }
                }
            });

            // 3. Despesas Fixas (CONSULTANDO PAGAMENTO)
            contasFixas.forEach(f => {
                if (f.ativo && parseInt(f.dia) === diaNum && !f.cartaoId) {
                    const pendente = mData?.fixasDesativadas?.[f.id] === true;
                    eventosSemana.push({ 
                        nome: f.nome, 
                        info: pendente ? "❌ PENDENTE" : "✅ PAGO", 
                        valor: f.valor, 
                        data: new Date(dataLoop), 
                        tipo: "expense" 
                    });
                }
            });

            // 4. Gastos Variáveis
            if (mData && mData.despesas) {
                mData.despesas.forEach(itemDesp => {
                    if (itemDesp.dia && parseInt(itemDesp.dia) === diaNum) {
                        eventosSemana.push({ 
                            nome: itemDesp.nome, 
                            info: itemDesp.checked ? "✅ PAGO" : "⚠️ AGUARDANDO", 
                            valor: itemDesp.valor, 
                            data: new Date(dataLoop), 
                            tipo: "expense" 
                        });
                    }
                });
            }

            // 5. Receitas
            receitasFixas.forEach(r => {
                if (r.ativo && parseInt(r.dia) === diaNum) {
                    eventosSemana.push({ nome: r.nome, info: "Recebimento", valor: r.valor, data: new Date(dataLoop), tipo: "income" });
                }
            });

            // 6. Salário
            const diaSalario = calcularDiaPagamento(configuracoes.diaSalario || 5, mesIdx, anoDoDia, feriados);
            if (diaNum === diaSalario) {
                eventosSemana.push({ nome: "Salário", info: "Dinheiro", valor: salarioFixoBase, data: new Date(dataLoop), tipo: "salary" });
            }
        }

        eventosSemana.sort((a, b) => a.data - b.data);

        let htmlFinal = "";
        if (eventosSemana.length === 0) {
            htmlFinal = `<div class="lembrete-vazio">Sem eventos para o restante da semana.</div>`;
        } else {
            eventosSemana.forEach(ev => {
                const dataFormatada = ev.data.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit' });
                const textoValor = (ev.valor !== null && ev.valor !== 0) ? ` | <b>${formatar(ev.valor)}</b>` : "";
                const isPago = ev.info.includes("✅");

                htmlFinal += `
                    <div class="item-lembrete-home agenda-tipo-${ev.tipo}" style="opacity: ${isPago ? '0.6' : '1'}">
                        <div class="info">
                            <span class="titulo" style="font-size:14px">${ev.nome}</span>
                            <span class="data" style="font-size:11px">${dataFormatada.toUpperCase()} • ${ev.info}${textoValor}</span>
                        </div>
                    </div>`;
            });
        }
        lista.innerHTML = htmlFinal;
    } catch (e) { console.error(e); }
}

function getMesReferenciaAtivo() {
    const diaV = parseInt(configuracoes.diaVirada) || 1;
    const refMes = configuracoes.referenciaMes || "atual";
    let baseDate = new Date();
    if (refMes === "proximo") baseDate.setMonth(baseDate.getMonth() + 1);
    let mesAt = baseDate.getMonth();
    let anoAt = baseDate.getFullYear();
    if (new Date().getDate() < diaV) { mesAt--; if (mesAt < 0) { mesAt = 11; anoAt--; } }
    return { mesAt, anoAt };
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

// ================= CRIPTOGRAFIA =================
const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function encryptData(obj, senha) {
  const dadosBytes = encoder.encode(JSON.stringify(obj));
  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(senha), "PBKDF2", false, ["deriveKey"]);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" }, keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, dadosBytes);
  return { encrypted: btoa(String.fromCharCode(...new Uint8Array(encrypted))), iv: btoa(String.fromCharCode(...iv)), salt: btoa(String.fromCharCode(...salt)) };
}

async function decryptData(encryptedObj, senha) {
  try {
    const iv = Uint8Array.from(atob(encryptedObj.iv), c => c.charCodeAt(0));
    const salt = Uint8Array.from(atob(encryptedObj.salt), c => c.charCodeAt(0));
    const data = Uint8Array.from(atob(encryptedObj.encrypted), c => c.charCodeAt(0));
    const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(senha), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" }, keyMaterial, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    return JSON.parse(decoder.decode(decrypted));
  } catch (e) { throw new Error("Senha incorreta."); }
}

// ================= UTILITÁRIOS =================
function formatar(v) { return "R$ " + (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function parseValor(v) { if (!v) return 0; if (typeof v === 'number') return v; let str = v.toString(); if (str.includes('.') && str.includes(',')) str = str.replace(/\./g, '').replace(',', '.'); else str = str.replace(',', '.'); const limpo = str.replace(/[^\d.]/g, ""); return parseFloat(limpo) || 0; }

function controleAvisoPendente(mostrar) {
    const aviso = document.getElementById("statusAlteracao");
    if (aviso) {
        aviso.style.display = mostrar ? "inline-block" : "none";
    }
}

function salvarDadosLocal() {
  localStorage.setItem("financas", JSON.stringify(dados)); 
  localStorage.setItem("parcelas", JSON.stringify(parcelasMemoria));
  localStorage.setItem("contasFixas", JSON.stringify(contasFixas)); 
  localStorage.setItem("receitasFixas", JSON.stringify(receitasFixas));
  localStorage.setItem("salarioFixoBase", JSON.stringify(salarioFixoBase)); 
  localStorage.setItem("categorias", JSON.stringify(categorias));
  localStorage.setItem("configuracoes", JSON.stringify(configuracoes)); 
  localStorage.setItem("cartoes", JSON.stringify(cartoes));
  localStorage.setItem("gastosDetalhes", JSON.stringify(gastosDetalhes));
  localStorage.setItem("caixinhas", JSON.stringify(caixinhas));
}

async function salvarFirebase() {
  if (!usuarioLogado || !senhaDoUsuario) return;
  try {
    const btn = document.getElementById("salvarNuvemBtn"); 
    btn.innerText = "⌛ SALVANDO...";
    
    const pacote = await encryptData({ 
        dados, 
        parcelasMemoria, 
        lembretes, 
        contasFixas, 
        receitasFixas, 
        salarioFixoBase, 
        categorias, 
        configuracoes, 
        cartoes, 
        gastosDetalhes,
        caixinhas 
    }, senhaDoUsuario);

    await setDoc(doc(db, "financas", usuarioLogado.uid), pacote);
    
    // Sucesso: Desliga o aviso e atualiza o botão
    controleAvisoPendente(false);
    btn.innerText = "✅ SALVO NA NUVEM"; 
    salvarDadosLocal();
    
    setTimeout(() => { if(btn) btn.innerText = "☁️ SALVAR"; }, 2000);
  } catch (e) { 
      console.error("Erro ao salvar:", e);
      btn.innerText = "❌ ERRO AO SALVAR";
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
                  listaCartoesDiv.innerHTML = "<small style='display:block;margin-bottom:8px;opacity:0.6'>PAGAMENTO DE CARTÕES:</small>";
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
                          itemC.querySelector(".check-cartao").onclick = (e) => { e.stopPropagation(); m.cartoesPagos[cid] = e.target.checked; controleAvisoPendente(true); atualizarTudo(ano); salvarFirebase(); renderLembretesHome(); renderCalendario({dados, cartoes, contasFixas, receitasFixas, lembretes, configuracoes, gastosDetalhes, salarioFixoBase}, { abrirPostit }); };
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
  renderCaixinhas(); // <--- CRUCIAL: RECONECTA AS CAIXINHAS
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

// Substitua a função carregarAno inteira (para incluir a chamada acima):
function carregarAno() {
  const sel = document.getElementById("ano"); 
  const ano = sel ? sel.value : hoje.getFullYear(); 
  if (!dados[ano]) dados[ano] = { meses: [] };
  
  const area = document.getElementById("areaAno"); 
  if(!area) return;
  area.innerHTML = ""; 
  mesesDOM = [];
  
  const container = document.createElement("div"); 
  area.appendChild(container);
  
  const addBox = document.createElement("div"); 
  addBox.className = "addMesBox";
  const btnAdd = document.createElement("button"); 
  btnAdd.innerText = "+ ADICIONAR MÊS";
  
  btnAdd.onclick = () => {
    let anoNum = Number(ano); 
    if (!dados[anoNum]) dados[anoNum] = { meses: [] };
    const n = { 
        despesas: [], 
        empresa: [], 
        salario: salarioFixoBase, 
        conta: 0, 
        contaManual: false,
        fixasDesativadas: {},   
        receitasDesativadas: {} 
    };
    dados[anoNum].meses.push(n); 
    carregarAno();
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
          renderCalendario({dados, cartoes, contasFixas, receitasFixas, lembretes, configuracoes, gastosDetalhes, salarioFixoBase}, { abrirPostit });
          carregarAno();
      };
      aplicarComportamentoInput(tr.querySelector(".valor-fixa-mes"), () => valorExibir, (v) => {
          data.fixasEditadas[f.id] = v; 
          controleAvisoPendente(true);
          atualizarTudo(ano);
          renderLembretesHome();
          renderCalendario({dados, cartoes, contasFixas, receitasFixas, lembretes, configuracoes, gastosDetalhes, salarioFixoBase}, { abrirPostit });
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
          renderCalendario({dados, cartoes, contasFixas, receitasFixas, lembretes, configuracoes, gastosDetalhes, salarioFixoBase}, { abrirPostit });
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

        const filtroAtual = filtrosPorMes[m] || "todos";
        let gastosManuais = (gastosDetalhes[anoView] || []).filter(g => g.mes === m);
        const listaBaseFixas = mData.fixasSnapshot ? mData.fixasSnapshot : contasFixas;
        let gastosFixos = listaBaseFixas.filter(f => f.ativo && f.cartaoId);

        if(filtroAtual !== "todos") {
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
                        <option value="todos">Todos os Cartões</option>
                        ${cartoes.map(c => `<option value="${c.id}" ${filtroAtual == c.id ? 'selected' : ''}>${c.nome}</option>`).join('')}
                    </select>
                </div>
                <div id="chart-pizza-${m}" style="display:flex; justify-content:center; margin: 15px 0;"></div>
                <table class="tabela-gastos">
                    <thead>
                        <tr>
                            <th style="width:1%"></th>
                            <th>Gasto</th>
                            <th>Categoria</th>
                            <th>Cartão</th>
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
                            <td><select id="add-card-${m}" class="inputPadrao">${cartoes.map(c => `<option value="${c.id}">${c.nome}</option>`).join('')}</select></td>
                            <td><input type="text" placeholder="0,00" id="add-val-${m}" class="inputPadrao" style="text-align:right;"></td>
                            <td><button class="btn" id="btn-add-${m}">+</button></td>
                        </tr>
                    </tfoot>
                </table>
                <div class="resumo-gastos-inferior" style="margin-bottom: 15px;">
                    <div class="barra-resumo credito"><span>Crédito (Fixo+Var):</span> <span>${formatar(tCr)}</span></div>
                    <div class="barra-resumo debito"><span>Débito (Fixo+Var):</span> <span>${formatar(tDb)}</span></div>
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
                const desativada = mData.fixasDesativadas[g.id] === true;
                const catCor = categorias.find(c => c.name === g.categoria)?.color || "#888";
                tr.style.opacity = desativada ? "0.3" : "1";
                tr.innerHTML = `<td><input type="checkbox" ${!desativada ? 'checked' : ''}></td><td style="font-style:italic;">${g.nome}</td><td><span class="badge" style="border:1px solid ${catCor}; color:${catCor}">${g.categoria}</span></td><td>💳 ${cartoes.find(c => c.id == g.cartaoId)?.nome}</td><td style="text-align:right;">${formatar(g.valor)}</td><td>⚙️</td>`;
                tr.querySelector("input").onchange = async (e) => { mData.fixasDesativadas[g.id] = !e.target.checked; await salvarFirebase(); renderPaginaGastos(); atualizarTudo(anoView); };
                tbody.appendChild(tr);
            });
        }

        // GASTOS MANUAIS
        gastosManuais.forEach(g => {
            const tr = document.createElement("tr");
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
            gastosDetalhes[anoView].push({ mes: m, nome: n, valor: v, categoria: mesBox.querySelector(`#add-cat-${m}`).value, cartaoId: mesBox.querySelector(`#add-card-${m}`).value });
            await salvarFirebase(); renderPaginaGastos(); carregarAno();
        };

        mesBox.querySelector(`#btn-add-${m}`).onclick = btnAddAction;

        // --- ADICIONADO: ENTER NO CAMPO VALOR ---
        mesBox.querySelector(`#add-val-${m}`).onkeydown = (e) => {
            if (e.key === "Enter") btnAddAction();
        };

        if(isOpen) renderPizza(m, [...gastosFixos, ...gastosManuais]);
    }
}

document.getElementById("btnNovoLembreteHome").onclick = (e) => {
    e.stopPropagation(); // Evita fechar o acordeon se houver um clique pai
    if(window.resetEdicao) window.resetEdicao();
    document.getElementById("lemData").value = new Date().toLocaleDateString('en-CA'); // Preenche com a data de hoje
    document.getElementById("modalLembrete").style.display = "flex";
};

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
    idEditando = null;
    document.getElementById("btnSalvarLembrete").innerText = "Salvar";
    // Limpa os campos para um novo lembrete
    document.getElementById("lemTitulo").value = "";
    document.getElementById("lemValor").value = "";
    document.getElementById("lemHora").value = "";
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
            configuracoes = res.configuracoes || configuracoes; 
            cartoes = res.cartoes || []; 
            gastosDetalhes = res.gastosDetalhes || {};
            caixinhas = res.caixinhas || []; // <--- CARREGANDO CAIXINHAS

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

document.getElementById("exportarTudoBtn").onclick = () => { const b = { dados, parcelasMemoria, lembretes, contasFixas, receitasFixas, salarioFixoBase, categorias, configuracoes, cartoes, gastosDetalhes }; const blob = new Blob([JSON.stringify(b, null, 2)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `backup.json`; a.click(); };

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
        configuracoes = res.configuracoes || configuracoes; 
        cartoes = res.cartoes || []; 
        gastosDetalhes = res.gastosDetalhes || {}; 
        caixinhas = res.caixinhas || []; // ADICIONE ESTA LINHA
        
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
        "#calendario": "viewCalendario"
    };

    // 1. Esconder todas as seções e remover o estado ativo do menu
    Object.values(views).forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = "none";
    });

    ["navResumo", "navGastos", "navCalendario"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove("active");
    });

    // 2. Mostrar a seção atual
    const currentViewId = views[hash] || "viewResumo";
    const currentViewEl = document.getElementById(currentViewId);
    if (currentViewEl) currentViewEl.style.display = "block";
    
    // 3. Lógica específica de inicialização de cada aba
    if (hash === "#resumo" || hash === "") {
        document.getElementById("navResumo").classList.add("active");
        atualizarSaudacao(); // Atualiza Bom dia/Boa tarde...
        carregarAno();       // Renderiza os cards dos meses na Home
    } 
    else if (hash === "#gastos") {
        document.getElementById("navGastos").classList.add("active");
        renderPaginaGastos(); // Renderiza as tabelas de gastos detalhados
    } 
    else if (hash === "#calendario") {
        document.getElementById("navCalendario").classList.add("active");
        
        // Chamada assíncrona do calendário (espera a API de feriados)
        await renderCalendario(
            { dados, cartoes, contasFixas, receitasFixas, lembretes, configuracoes, gastosDetalhes, salarioFixoBase }, 
            { abrirPostit }
        );
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
[document.getElementById("navResumo"), document.getElementById("navGastos"), document.getElementById("navCalendario")].forEach(link => {
    link.onclick = (e) => {
        // O navegador já mudará o hash pelo href, o evento hashchange cuidará do resto
    };
});

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
    const seletores = [document.getElementById("ano"), document.getElementById("anoGastos")];
    
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
        };
    });
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
    
    // Limpeza do Modal
    document.getElementById("modalLembrete").style.display = "none";
    document.getElementById("lemTitulo").value = "";
    document.getElementById("lemData").value = "";
    document.getElementById("lemHora").value = "";
    document.getElementById("lemValor").value = "";
    document.getElementById("lemRecorrente").checked = false;
    document.getElementById("escolhaDiasSemana").style.display = "none";

    // Recarrega o calendário se estiver visível
    renderCalendario(
        { dados, cartoes, contasFixas, receitasFixas, lembretes, configuracoes, gastosDetalhes, salarioFixoBase }, 
        { abrirPostit }
    );
};

function abrirPostit(l) {
    const antigo = document.getElementById("popupPostit");
    if(antigo) antigo.remove();

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
                <div class="modal-content postit-amarelo" style="padding:25px; min-width:280px; position:relative;">
                    <span class="btn-editar-p" style="position:absolute; right:15px; top:15px; cursor:pointer; font-size:20px;">✏️</span>
                    <h3 style="margin-top:0; border-bottom:1px solid rgba(0,0,0,0.1); padding-bottom:8px; padding-right:30px;">
                        ${l.nome} ${infoRecorrencia}
                    </h3>
                    <div style="margin: 15px 0; font-size: 18px;">
                        <p>📅 <strong>Data:</strong> ${l.data.split('-').reverse().join('/')}</p>
                        <p>⏰ <strong>Hora:</strong> ${l.hora || '---'}</p>
                        <p>💰 <strong>Valor:</strong> ${l.valor ? formatar(l.valor) : '---'}</p>
                    </div>
                    <div style="display:flex; gap:10px; margin-top:20px;">
                        <button class="btn btn-excluir-p" style="flex:1; background:#e74c3c; color:white;">Apagar</button>
                        <button class="btn btn-fechar-p" style="flex:1; background:#333; color:#fff;">Fechar</button>
                    </div>
                </div>`;
        } else {
            return `
                <div class="modal-content postit-amarelo modo-edicao" style="padding:25px; min-width:280px; position:relative;">
                    <h3 style="margin-bottom:15px; font-size:14px; opacity:0.5; text-transform:uppercase;">Editando...</h3>
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
        if(btnEdit) btnEdit.onclick = () => { overlay.innerHTML = renderConteudo(true); attachEvents(); };
        
        // Evento de exclusão (funciona nos dois modos agora)
        const btnExcluir = overlay.querySelector(".btn-excluir-p");
        if(btnExcluir) btnExcluir.onclick = async () => { 
            if(confirm("Deseja apagar este lembrete permanentemente?")) { 
                lembretes = lembretes.filter(x => x.id !== l.id); 
                await salvarFirebase(); 
                renderLembretesHome(); 
                renderCalendario(
                    { dados, cartoes, contasFixas, receitasFixas, lembretes, configuracoes, gastosDetalhes, salarioFixoBase }, 
                    { abrirPostit }
                );
                overlay.remove(); 
            } 
        };

        const checkRec = overlay.querySelector(".edit-recorrente");
        if(checkRec) checkRec.onchange = (e) => overlay.querySelector(".edit-dias").style.display = e.target.checked ? "grid" : "none";
        
        const btnSalvar = overlay.querySelector(".btn-salvar-p");
        if(btnSalvar) btnSalvar.onclick = async () => {
            l.nome = overlay.querySelector(".edit-nome").value;
            l.data = overlay.querySelector(".edit-data").value;
            l.hora = overlay.querySelector(".edit-hora").value;
            l.valor = parseValor(overlay.querySelector(".edit-valor").value);
            l.recorrente = overlay.querySelector(".edit-recorrente").checked;
            l.diasSemana = Array.from(overlay.querySelectorAll(".edit-dias input:checked")).map(i => parseInt(i.value));
            await salvarFirebase(); renderLembretesHome();
            renderCalendario(
                { dados, cartoes, contasFixas, receitasFixas, lembretes, configuracoes, gastosDetalhes, salarioFixoBase }, 
                { abrirPostit }
            );
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
                                    <button class="btn-del-hist" title="Excluir este lançamento" onclick="window.excluirMovimentoCaixinha('${h.ano}', ${h.mesIdx}, '${h.origem}', ${h.timestamp})">✖</button>
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
                    historico.push({ dataRef: `${nomesMesesCurto[idx]}/${ano}`, valor: d.valor, tipo: 'deposito', timestamp: d.timestamp, origem: 'despesas', ano, mesIdx: idx });
                }
            });
            // B) Resgates (em empresa/rendas)
            (m.empresa || []).forEach(r => {
                if (String(r.caixinhaId) === String(id) && r.checked) {
                    total -= r.valor;
                    historico.push({ dataRef: `${nomesMesesCurto[idx]}/${ano}`, valor: r.valor, tipo: 'resgate', timestamp: r.timestamp, origem: 'empresa', ano, mesIdx: idx });
                }
            });
            // C) Movimentos Diretos (Rendimentos/Dinheiro Extra)
            (m.movimentosCaixinha || []).forEach(mov => {
                if (String(mov.caixinhaId) === String(id)) {
                    total += mov.valor;
                    historico.push({ dataRef: `${nomesMesesCurto[idx]}/${ano}`, valor: mov.valor, tipo: mov.tipo, timestamp: mov.timestamp, origem: 'movimentosCaixinha', ano, mesIdx: idx });
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

        mData.despesas.push({
            nome: `📦 DEPÓSITO: ${caixinhas.find(c => c.id == select.value).nome}`,
            valor: valor,
            checked: true,
            caixinhaId: select.value,
            timestamp: Date.now()
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
window.excluirMovimentoCaixinha = async (ano, mesIdx, origem, timestamp) => {
    if(!confirm("Deseja excluir este registro permanentemente?")) return;
    
    if(dados[ano] && dados[ano].meses[mesIdx]) {
        const m = dados[ano].meses[mesIdx];
        
        // Remove do array correto (origem pode ser 'movimentosCaixinha', 'despesas' ou 'empresa')
        if (m[origem]) {
            m[origem] = m[origem].filter(item => item.timestamp !== timestamp);
        }
        
        salvarDadosLocal();
        atualizarTudo(document.getElementById("ano").value);
        
        // Salva na nuvem a exclusão
        await salvarFirebase();
    }
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
