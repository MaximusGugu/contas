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

let contasFixas = [];
let receitasFixas = [];
let salarioFixoBase = 0;
let categorias = [{name: "Essencial", color: "#3C5558"}, {name: "Alimentação", color: "#D78341"}, {name: "Lazer", color: "#586E5F"}, {name: "Contas", color: "#e74c3c"}];
let configuracoes = { diaVirada: 1, nomeUsuario: "", referenciaMes: "atual", tema: "planetario" };
let cartoes = [];
let gastosDetalhes = {}; 
let filtrosPorMes = {};

let historicoChatIA = []; // Armazena a memória da conversa

const hoje = new Date();
const nomesMesesFull = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const nomesMesesCurto = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
let contextParcelaCartao = { mes: 0, ano: 2024 };

// ================= FUNÇÕES DE APOIO =================
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
    // Usamos o mês e ano real de hoje como limite para o passado
    const hoje = new Date();
    const mesAtualReal = hoje.getMonth();
    const anoAtualReal = hoje.getFullYear();
    
    const anos = Object.keys(dados).map(Number).sort((a, b) => a - b);
    
    anos.forEach(ano => {
        if (!dados[ano].meses) return;
        dados[ano].meses.forEach((m, idx) => {
            // Se o mês/ano for estritamente anterior ao mês atual real
            if (ano < anoAtualReal || (ano === anoAtualReal && idx < mesAtualReal)) {
                // Se esse mês ainda não tem uma "foto" do passado, tiramos uma agora
                // com os dados atuais (antes de serem alterados)
                if (!m.fixasSnapshot) {
                    m.fixasSnapshot = JSON.parse(JSON.stringify(contasFixas));
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
        const feriados = await obterFeriados(hoje.getFullYear());
        const anoSelecionado = Number(document.getElementById("ano")?.value) || hoje.getFullYear();

        const domingo = new Date(hoje);
        domingo.setDate(hoje.getDate() - hoje.getDay());
        domingo.setHours(0,0,0,0);

        const sabado = new Date(domingo);
        sabado.setDate(domingo.getDate() + 6);
        sabado.setHours(23,59,59,999);

        let eventosSemana = [];

        for (let d = new Date(domingo); d <= sabado; d.setDate(d.getDate() + 1)) {
            const diaNum = d.getDate();
            const mesIdx = d.getMonth();
            const anoDoDia = d.getFullYear();
            const isoData = d.toLocaleDateString('en-CA'); 

            lembretes.filter(l => l.data === isoData).forEach(l => {
                eventosSemana.push({ nome: l.nome, info: l.hora || "Lembrete", valor: null, data: new Date(d), tipo: "reminder" });
            });

            cartoes.forEach(c => {
                if (parseInt(c.vencimento) === diaNum) {
                    const totalVariavel = (gastosDetalhes[anoSelecionado] || [])
                        .filter(g => g.mes === mesIdx && String(g.cartaoId) === String(c.id))
                        .reduce((acc, g) => acc + g.valor, 0);
                    const totalFixoNoCard = contasFixas
                        .filter(f => f.ativo && String(f.cartaoId) === String(c.id))
                        .reduce((acc, f) => acc + f.valor, 0);
                    
                    if ((totalVariavel + totalFixoNoCard) > 0) {
                        eventosSemana.push({ nome: `Fatura: ${c.nome}`, info: "Cartão", valor: totalVariavel + totalFixoNoCard, data: new Date(d), tipo: "card" });
                    }
                }
            });

            contasFixas.forEach(f => {
                if (f.ativo && parseInt(f.dia) === diaNum && !f.cartaoId) {
                    eventosSemana.push({ nome: f.nome, info: "Despesa Fixa", valor: f.valor, data: new Date(d), tipo: "expense" });
                }
            });

            receitasFixas.forEach(r => {
                if (r.ativo && parseInt(r.dia) === diaNum) {
                    eventosSemana.push({ nome: r.nome, info: "Recebimento", valor: r.valor, data: new Date(d), tipo: "income" });
                }
            });

            const diaSalario = calcularDiaPagamento(configuracoes.diaSalario || 5, mesIdx, anoDoDia, feriados);
            if (diaNum === diaSalario) {
                eventosSemana.push({ nome: "Pagamento Salário", info: "Dinheiro", valor: salarioFixoBase, data: new Date(d), tipo: "salary" });
            }
        }

        eventosSemana.sort((a, b) => a.data - b.data);

        let htmlFinal = "";
        if (eventosSemana.length === 0) {
            htmlFinal = `<div class="lembrete-vazio">Nada para esta semana.</div>`;
        } else {
            eventosSemana.forEach(ev => {
                const dataFormatada = ev.data.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit' });
                const textoValor = (ev.valor !== null && ev.valor !== 0) ? ` | <b>${formatar(ev.valor)}</b>` : "";
                htmlFinal += `
                    <div class="item-lembrete-home agenda-tipo-${ev.tipo}">
                        <div class="info">
                            <span class="titulo" style="font-size:14px">${ev.nome}</span>
                            <span class="data" style="font-size:11px">${dataFormatada.toUpperCase()} • ${ev.info}${textoValor}</span>
                        </div>
                    </div>`;
            });
        }

        lista.innerHTML = htmlFinal;
        setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
        }, 300);

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

function salvarDadosLocal(pendente = true) {
  localStorage.setItem("financas", JSON.stringify(dados)); 
  localStorage.setItem("parcelas", JSON.stringify(parcelasMemoria));
  localStorage.setItem("contasFixas", JSON.stringify(contasFixas)); 
  localStorage.setItem("receitasFixas", JSON.stringify(receitasFixas));
  localStorage.setItem("salarioFixoBase", JSON.stringify(salarioFixoBase)); 
  localStorage.setItem("categorias", JSON.stringify(categorias));
  localStorage.setItem("configuracoes", JSON.stringify(configuracoes)); 
  localStorage.setItem("cartoes", JSON.stringify(cartoes));
  localStorage.setItem("gastosDetalhes", JSON.stringify(gastosDetalhes));
  const a = document.getElementById("statusAlteracao"); 
  if(a) a.style.display = pendente ? "inline" : "none";
}

async function salvarFirebase() {
  if (!usuarioLogado || !senhaDoUsuario) return;
  try {
    const btn = document.getElementById("salvarNuvemBtn"); 
    btn.innerText = "⌛ SALVANDO...";
    const pacote = await encryptData({ dados, parcelasMemoria, lembretes, contasFixas, receitasFixas, salarioFixoBase, categorias, configuracoes, cartoes, gastosDetalhes }, senhaDoUsuario);
    await setDoc(doc(db, "financas", usuarioLogado.uid), pacote);
    btn.innerText = "✅ SALVO NA NUVEM"; 
    salvarDadosLocal(false);
    setTimeout(() => { if(btn) btn.innerText = "☁️ SALVAR"; }, 2000);
  } catch (e) { console.error(e); }
}

function aplicarComportamentoInput(input, getV, setV, anoVinculado = null) {
  if (!input) return;
  input.addEventListener("focus", () => { input.dataset.old = input.value; input.value = ""; });
  input.addEventListener("blur", () => {
    const txt = input.value.trim();
    if (txt === "") input.value = input.dataset.old;
    else { const v = parseValor(txt); setV(v); input.value = formatar(v); if (anoVinculado) atualizarTudo(anoVinculado); else salvarDadosLocal(); }
  });
  input.addEventListener("keydown", (e) => { if(e.key === "Enter") input.blur(); });
}

// ================= MOTOR DE CÁLCULO =================
function atualizarTudo(anoParaVisualizar, pendente = true) {
  const { mesAt, anoAt } = getMesReferenciaAtivo();
  const anosOrdenados = Object.keys(dados).map(Number).sort((a, b) => a - b);
  
  let saldoAcumulado = 0; 
  let ehOPrimeiroMesDeTodos = true;

  anosOrdenados.forEach(ano => {
    if (!dados[ano] || !dados[ano].meses) return;
    dados[ano].meses.forEach((m, idx) => {
      if (!m.fixasDesativadas) m.fixasDesativadas = {};
      if (!ehOPrimeiroMesDeTodos && m.contaManual !== true) m.conta = saldoAcumulado;

      const dManuaisHome = (m.despesas || []).filter(x => x.checked).reduce((acc, b) => acc + b.valor, 0);
      const gastosDetalhados = (gastosDetalhes[ano] || []).filter(g => g.mes === idx);
      
      const tCrVariavel = gastosDetalhados.filter(g => cartoes.find(c => c.id == g.cartaoId)?.tipo === 'Crédito').reduce((acc, g) => acc + g.valor, 0);
      const tDbVariavel = gastosDetalhados.filter(g => cartoes.find(c => c.id == g.cartaoId)?.tipo === 'Débito').reduce((acc, g) => acc + g.valor, 0);

      const listaBaseFixas = m.fixasSnapshot ? m.fixasSnapshot : contasFixas;
      const fixasAtivas = listaBaseFixas.filter(f => f.ativo && !m.fixasDesativadas[f.id]);
      const fixasNoCard = fixasAtivas.filter(f => f.cartaoId).reduce((acc, f) => acc + f.valor, 0);
      const fixasNoDinheiro = fixasAtivas.filter(f => !f.cartaoId).reduce((acc, f) => acc + f.valor, 0);

      const eTotal = (m.empresa || []).filter(x => x.checked).reduce((acc, b) => acc + b.valor, 0);
      const tDisp = (m.salario || 0) + (m.conta || 0) + eTotal;
      
      const totalGastoMes = dManuaisHome + tCrVariavel + tDbVariavel + fixasNoCard + fixasNoDinheiro;
      const saldoFinal = tDisp - totalGastoMes;
      
      m.saldoCalculadoFinal = saldoFinal; 
      saldoAcumulado = saldoFinal; 
      ehOPrimeiroMesDeTodos = false;

      // ATUALIZAÇÃO APENAS DA HOME (RESUMO)
      if (ano === Number(anoParaVisualizar)) {
        const infoHome = mesesDOM.find(item => item.index === idx);
        if (infoHome) {
          const dom = infoHome.dom;
          const listaCartoesDiv = dom.querySelector(".listaCartoesDinamica");
          if (listaCartoesDiv) {
              listaCartoesDiv.innerHTML = "";
              const totaisPorCartao = {};
              gastosDetalhados.filter(g => cartoes.find(c => c.id == g.cartaoId)?.tipo === 'Crédito')
                               .forEach(g => { totaisPorCartao[g.cartaoId] = (totaisPorCartao[g.cartaoId] || 0) + g.valor; });
              fixasAtivas.filter(f => f.cartaoId)
                         .forEach(f => { totaisPorCartao[f.cartaoId] = (totaisPorCartao[f.cartaoId] || 0) + f.valor; });

              if (Object.keys(totaisPorCartao).length > 0) {
                  listaCartoesDiv.innerHTML = "<small style='display:block;margin-bottom:5px;opacity:0.6'>RESUMO DE CARTÕES (CRÉDITO):</small>";
                  Object.keys(totaisPorCartao).forEach(cid => {
                      const cObj = cartoes.find(c => c.id == cid);
                        if (cObj) {
                            const itemC = document.createElement("div"); 
                            itemC.className = "item-cartao-resumo";
                            itemC.style.cursor = "pointer";
                            
                            // Cor do cartão vinda do cadastro
                            const corCard = cObj.color || 'var(--P04)';
                            itemC.style.borderLeft = `4px solid ${corCard}`;

                            // EFEITO HOVER DINÂMICO VIA JS
                            itemC.onmouseenter = () => {
                                itemC.style.backgroundColor = corCard + "33"; // Adiciona transparência (33 em hex é ~20%)
                                itemC.style.transform = "translateX(5px)";
                            };
                            itemC.onmouseleave = () => {
                                itemC.style.backgroundColor = ""; // Volta ao padrão do CSS
                                itemC.style.transform = "";
                            };

                            itemC.innerHTML = `<span>💳 ${cObj.nome}</span> <span>${formatar(totaisPorCartao[cid])}</span>`;
                            itemC.onclick = () => { 
                                document.getElementById("anoGastos").value = ano; 
                                mesesGastosAbertos.clear();
                                mesesGastosAbertos.add(idx); 
                                filtrosPorMes[idx] = cid; 
                                window.scrollTargetMes = idx;
                                window.location.hash = "#gastos";
                            };
                            listaCartoesDiv.appendChild(itemC);
                        }
                  });
              }
          }
          dom.querySelector(".totalDespesas").textContent = formatar(totalGastoMes);
          dom.querySelector(".totalDinheiro").textContent = formatar(tDisp);
          const sEl = dom.querySelector(".saldo"); 
          sEl.textContent = formatar(saldoFinal);
          sEl.className = "saldo " + (saldoFinal >= 0 ? "positivo" : "negativo");
          dom.querySelector(".mesTotal").textContent = formatar(saldoFinal);
          
          const inS = dom.querySelector("input.salario"); 
          const inC = dom.querySelector("input.conta");
          if (document.activeElement !== inS) inS.value = formatar(m.salario);
          if (document.activeElement !== inC) { 
              inC.value = formatar(m.conta); 
              if (m.contaManual === true) inC.classList.add("manual"); 
              else inC.classList.remove("manual"); 
          }
          if (ano === anoAt && idx === mesAt) dom.classList.add("mesAtual"); else dom.classList.remove("mesAtual");
        }
      }
    });
  });

  salvarDadosLocal(pendente); 
  atualizarGrafico(Number(anoParaVisualizar));
  renderLembretesHome(); // Essa chamada aqui deve ser a última
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
  tr.innerHTML = `
    <td style="width: 1%;"><input type="checkbox" ${d.checked?'checked':''}></td>
    <td><input class="input-tabela-edit" value="${d.nome}" placeholder="Nome..."></td>
    <td style="width: fit-content;"><input class="input-tabela-edit valor" value="${formatar(d.valor)}" style="text-align:right;"></td>
    <td style="width: fit-content;"><button class="removeItem">×</button></td>
  `;
  
  const [tdCheck, tdNome, tdValor, tdBtn] = tr.children;
  const check = tdCheck.querySelector("input");
  const nome = tdNome.querySelector("input");
  const valor = tdValor.querySelector("input");
  const btn = tdBtn.querySelector("button");

  check.onchange = () => { d.checked = check.checked; atualizarTudo(ano); };
  nome.onblur = () => { d.nome = nome.value; salvarDadosLocal(true); };
  aplicarComportamentoInput(valor, () => d.valor, (v) => { d.valor = v; atualizarTudo(ano); }, ano);
  
  btn.onclick = () => {
      if(d.parcelaId) {
          if(confirm("Deseja apagar TODAS as parcelas desta compra?")) {
              parcelasMemoria = parcelasMemoria.filter(p => p.id !== d.parcelaId);
              aplicarParcelas(); carregarAno();
          }
      } else { dataArray.splice(dataArray.indexOf(d), 1); carregarAno(); }
  };
  lista.appendChild(tr);
}

function criarMesDOM(ano, index, data) {
  const mes = document.createElement("div"); mes.className = mesesAbertos.has(index) ? "mes" : "mes collapsed";
  const header = document.createElement("div"); header.className = "mesHeader";
  header.innerHTML = `<span>${nomesMesesFull[index]} ${ano}</span><div><span class="mesTotal">0,00</span><button class="duplicarMes" title="Duplicar">📑</button><button class="removeMes">×</button></div>`;
  header.onclick = () => { mes.classList.toggle("collapsed"); if(mes.classList.contains("collapsed")) mesesAbertos.delete(index); else mesesAbertos.add(index); };
  header.querySelector(".removeMes").onclick = (e) => { e.stopPropagation(); if(confirm("Apagar mês?")) { dados[ano].meses.splice(index, 1); carregarAno(); } };
  header.querySelector(".duplicarMes").onclick = (e) => { e.stopPropagation(); const clone = JSON.parse(JSON.stringify(data)); dados[ano].meses.push(clone); carregarAno(); };
  
  const body = document.createElement("div"); body.className = "mesBody";
  body.innerHTML = `
    <div class="container">
        <div class="coluna despesas">
            <div class="topoColuna"><h4>DESPESAS</h4></div>
            <div class="conteudoColuna">
                <table class="tabela-gastos">
                    <thead>
                        <tr>
                            <th></th>
                            <th>Item</th>
                            <th style="text-align:right;">Valor</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody class="listaDesp"></tbody>
                </table>
                <div class="area-acoes-despesa" style="margin-top:15px; padding-top:15px; border-top:1px dashed rgba(255,255,255,0.1);">
                    <button class="btn btn-show-quick-add" style="width:100%;">+ ADICIONAR DESPESA</button>
                    <div class="form-rapido-despesa" style="display:none;">
                        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:5px; margin-bottom:5px;">
                            <input type="text" class="inputPadrao quick-nome" placeholder="O que comprou?">
                            <input type="text" class="inputPadrao quick-valor" placeholder="R$ 0,00">
                            <select class="inputPadrao quick-cat">
                                ${categorias.map(c => `<option value="${c.name}">${c.name}</option>`).join('')}
                            </select>
                            <select class="inputPadrao quick-card">
                                <option value="dinheiro">💵 Dinheiro</option>
                                ${cartoes.map(c => `<option value="${c.id}">💳 ${c.nome}</option>`).join('')}
                            </select>
                        </div>
                        <div style="display:flex; justify-content:center; flex-direction:column; align-items:center; gap:5px;">
                            <button class="btn btn-quick-add" style="width:100%; height:35px; font-size:20px; margin-top: 5px;">Adicionar</button>
                            <button class="btn-cancelar-quick">Cancelar</button>
                        </div>
                    </div>
                </div>
                <div class="area-acoes-parcelamento" style="margin-top:10px;">
                    <button class="btn btn-show-quick-parcela" style="width:100%;">+ PARCELAR COMPRA</button>
                    <div class="form-rapido-parcela" style="display:none; padding: 10px; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; margin-top: 5px;">
                        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:5px; margin-bottom:5px;">
                            <input type="text" class="inputPadrao qp-nome" placeholder="O que parcelou?">
                            <input type="text" class="inputPadrao qp-valor" placeholder="Valor Total R$">
                            <input type="number" class="inputPadrao qp-qtd" placeholder="Vezes (Ex: 10)">
                            <select class="inputPadrao qp-cat">
                                ${categorias.map(c => `<option value="${c.name}">${c.name}</option>`).join('')}
                            </select>
                            <select class="inputPadrao qp-card" style="grid-column: span 2;">
                                <option value="dinheiro">💵 Dinheiro (Parcela fixa mensal)</option>
                                ${cartoes.map(c => `<option value="${c.id}">💳 ${c.nome}</option>`).join('')}
                            </select>
                        </div>
                        <div style="display:flex; justify-content:center; flex-direction:column; align-items:center; gap:5px;">
                            <button class="btn btn-quick-p-add" style="width:100%; height:35px; background: #8e44ad !important; color: white;">Confirmar Parcelas</button>
                            <button class="btn-cancelar-p-quick" style="background:none; border:none; color:var(--P04); font-size:10px; cursor:pointer;">Cancelar</button>
                        </div>
                    </div>
                </div>
                <div class="listaCartoesDinamica"></div>
            </div>
            <p class="rodapeColuna">Total: <span class="totalDespesas">0,00</span></p>
        </div>
        <div class="coluna dinheiro">
            <div class="topoColuna"><h4>RENDAS</h4></div>
            <div class="conteudoColuna">
                <div class="linhaInputs">
                    <div class="campo"><label>Salário</label><input type="text" class="salario inputPadrao"></div>
                    <div class="campo"><label>Conta</label><input type="text" class="conta inputPadrao"></div>
                    <button class="btn-cascata" title="Vincular meses seguintes">🔗</button>
                </div>
                <h5>OUTROS</h5>
                <table class="tabela-gastos">
                    <thead>
                        <tr>
                            <th></th>
                            <th>Origem</th>
                            <th style="text-align:right;">Valor</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody class="listaEmp"></tbody>
                </table>
                <button class="addEmp btn" style="width:100%; margin-top:10px;">+ ADICIONAR RENDA</button>
            </div>
            <p class="rodapeColuna">Total: <span class="totalDinheiro">0,00</span></p>
        </div>
    </div>
    <div class="totalFinal">TOTAL: <span class="saldo">0,00</span></div>`;

  const listD = body.querySelector(".listaDesp"); 
  const listE = body.querySelector(".listaEmp");

  // 1. PRIMEIRO: EXIBIR RENDAS FIXAS SINCRONIZADAS NO TOPO
  receitasFixas.filter(rf => rf.ativo).forEach(rf => {
      if (!data.receitasDesativadas) data.receitasDesativadas = {};
      const tr = document.createElement("tr");
      const desativada = data.receitasDesativadas[rf.id] === true;
      tr.style.opacity = desativada ? "0.3" : "1";
      tr.innerHTML = `
        <td style="width: 1%;"><input type="checkbox" ${!desativada ? 'checked' : ''}></td>
        <td style="font-style: italic; font-size:12px; color: #2ecc71;">${rf.nome} <small>(fixo)</small></td>
        <td style="text-align:right; opacity: 0.7; font-size:12px;">${formatar(rf.valor)}</td>
        <td></td>
      `;
      tr.querySelector("input").onchange = (e) => {
          data.receitasDesativadas[rf.id] = !e.target.checked;
          atualizarTudo(ano);
          tr.style.opacity = e.target.checked ? "1" : "0.3";
      };
      listE.appendChild(tr);
  });

  // 2. DEPOIS: EXIBIR RENDAS MANUAIS
  (data.empresa || []).forEach(item => criarItem(listE, item, data.empresa, ano));

    // 3. PRIMEIRO: EXIBIR DESPESAS FIXAS SINCRONIZADAS NO TOPO (SEM CARTÃO)
    // AJUSTE: Agora ele olha se o mês está congelado (Snapshot) ou se usa a lista global
    const listaParaRenderizar = data.fixasSnapshot ? data.fixasSnapshot : contasFixas;

    listaParaRenderizar.filter(f => f.ativo && !f.cartaoId).forEach(f => {
        if (!data.fixasDesativadas) data.fixasDesativadas = {};
        const tr = document.createElement("tr");
        const desativada = data.fixasDesativadas[f.id] === true;
        tr.style.opacity = desativada ? "0.3" : "1";
        tr.innerHTML = `
            <td style="width: 1%;"><input type="checkbox" ${!desativada ? 'checked' : ''}></td>
            <td style="font-style: italic; font-size:12px; opacity: 0.7;">${f.nome} <small>(fixo)</small></td>
            <td style="text-align:right; opacity: 0.7; font-size:12px;">${formatar(f.valor)}</td>
            <td></td>
        `;
        tr.querySelector("input").onchange = (e) => {
            data.fixasDesativadas[f.id] = !e.target.checked;
            atualizarTudo(ano);
            tr.style.opacity = e.target.checked ? "1" : "0.3";
        };
        listD.appendChild(tr);
    });

  // 4. DEPOIS: EXIBIR DESPESAS MANUAIS
  data.despesas.forEach(item => criarItem(listD, item, data.despesas, ano));

  const inS = body.querySelector("input.salario"); 
  const inC = body.querySelector("input.conta"); 
  const btnC = body.querySelector(".btn-cascata");
  
  inS.value = formatar(data.salario || 0); inC.value = formatar(data.conta || 0);
  aplicarComportamentoInput(inS, () => data.salario, (v) => { data.salario = v; atualizarTudo(ano); }, ano);
  
  inC.addEventListener("blur", () => { 
      const txt = inC.value.trim(); 
      if (txt === "") data.contaManual = false; 
      else { data.conta = parseValor(txt); data.contaManual = true; } 
      atualizarTudo(ano); 
  });
  
  inC.addEventListener("keydown", (e) => { if(e.key === "Enter") inC.blur(); });
  
  btnC.onclick = () => { 
      const anos = Object.keys(dados).map(Number).sort((a,b)=>a-b); 
      let found = false; 
      anos.forEach(a => dados[a].meses.forEach((m, i) => { 
          if(a == ano && i == index) found = true; 
          else if(found) m.contaManual = false; 
      })); 
      atualizarTudo(ano); 
  };

  // LOGICA FORMULARIOS RÁPIDOS (DESPESA E PARCELAMENTO)
  const btnShow = body.querySelector(".btn-show-quick-add");
  const formQuick = body.querySelector(".form-rapido-despesa");
  const btnCancel = body.querySelector(".btn-cancelar-quick");
  const btnAddFinal = body.querySelector(".btn-quick-add");

  btnShow.onclick = () => { btnShow.style.display = "none"; formQuick.style.display = "block"; body.querySelector(".quick-nome").focus(); };
  btnCancel.onclick = () => { btnShow.style.display = "block"; formQuick.style.display = "none"; };

  btnAddFinal.onclick = async () => {
      const nome = body.querySelector(".quick-nome").value;
      const valorRaw = body.querySelector(".quick-valor").value;
      const valor = parseValor(valorRaw);
      const categoria = body.querySelector(".quick-cat").value;
      const cartaoId = body.querySelector(".quick-card").value;
      if (!nome || valor <= 0) { alert("Preencha nome e valor."); return; }

      if (cartaoId === "dinheiro") {
          const novoItem = { nome: nome, valor: valor, checked: true, categoria: categoria };
          data.despesas.push(novoItem);
          criarItem(listD, novoItem, data.despesas, ano);
      } else {
          if (!gastosDetalhes[ano]) gastosDetalhes[ano] = [];
          gastosDetalhes[ano].push({ mes: index, nome: nome, valor: valor, categoria: categoria, cartaoId: cartaoId });
      }
      salvarDadosLocal(); atualizarTudo(ano);
      formQuick.style.display = "none"; btnShow.style.display = "block";
      const textoOriginal = btnShow.innerText; btnShow.innerText = "✅ Adicionado!"; btnShow.style.backgroundColor = "#27ae60";
      setTimeout(() => { btnShow.innerText = textoOriginal; btnShow.style.backgroundColor = ""; }, 2000);
  };

  const btnShowP = body.querySelector(".btn-show-quick-parcela");
  const formQuickP = body.querySelector(".form-rapido-parcela");
  const btnCancelP = body.querySelector(".btn-cancelar-p-quick");
  const btnAddFinalP = body.querySelector(".btn-quick-p-add");

  btnShowP.onclick = () => { btnShowP.style.display = "none"; formQuickP.style.display = "block"; body.querySelector(".qp-nome").focus(); };
  btnCancelP.onclick = () => { btnShowP.style.display = "block"; formQuickP.style.display = "none"; };

  btnAddFinalP.onclick = async () => {
      const nome = body.querySelector(".qp-nome").value;
      const valorTotal = parseValor(body.querySelector(".qp-valor").value);
      const qtd = parseInt(body.querySelector(".qp-qtd").value);
      const categoria = body.querySelector(".qp-cat").value;
      const cartaoId = body.querySelector(".qp-card").value;
      if (!nome || valorTotal <= 0 || !qtd) { alert("Dados inválidos."); return; }
      const valorParcela = Number((valorTotal / qtd).toFixed(2));
      const pId = Date.now();
      if (cartaoId === "dinheiro") {
          parcelasMemoria.push({ id: pId, nome: nome, valorParcela: valorParcela, parcelas: qtd, inicio: index, ano: Number(ano), categoria: categoria });
      } else {
          let mesC = index, anoC = Number(ano);
          for (let i = 1; i <= qtd; i++) {
              if (!gastosDetalhes[anoC]) gastosDetalhes[anoC] = [];
              gastosDetalhes[anoC].push({ mes: mesC, nome: `${nome} (${i}/${qtd})`, valor: valorParcela, categoria: categoria, cartaoId: cartaoId, parcelaId: pId });
              mesC++; if (mesC > 11) { mesC = 0; anoC++; }
          }
      }
      salvarDadosLocal(); await salvarFirebase();
      formQuickP.style.display = "none"; btnShowP.style.display = "block";
      const txtOrig = btnShowP.innerText; btnShowP.innerText = "✅ Parcelas Criadas!"; btnShowP.style.backgroundColor = "#27ae60";
      setTimeout(() => { btnShowP.innerText = txtOrig; btnShowP.style.backgroundColor = ""; carregarAno(); }, 2000);
  };
  
  body.querySelector(".addEmp").onclick = () => { if(!data.empresa) data.empresa=[]; data.empresa.push({nome:"", valor:0, checked:true}); carregarAno(); };
  mes.appendChild(header); mes.appendChild(body); 
  return mes;
}

// ================= GESTÃO DE GASTOS DETALHADOS =================

function renderPaginaGastos() {
    const area = document.getElementById("areaGastosMensais"); 
    const anoView = document.getElementById("anoGastos").value; 
    const { mesAt, anoAt } = getMesReferenciaAtivo();
    
    // Abre o mês atual por padrão se nada estiver aberto
    if (mesesGastosAbertos.size === 0 && Number(anoView) === anoAt && !window.scrollTargetMes) {
        mesesGastosAbertos.add(mesAt);
    }

    area.innerHTML = "";

    for (let m = 0; m < 12; m++) {
        const mData = dados[anoView]?.meses[m];
        if (!mData) continue;
        if (!mData.fixasDesativadas) mData.fixasDesativadas = {};

        const mesBox = document.createElement("div"); 
        mesBox.setAttribute("data-mes-idx", m);
        mesBox.id = `box-gastos-mes-${m}`;
        
        const isMesAtual = (m === mesAt && Number(anoView) === anoAt); 
        const isOpen = mesesGastosAbertos.has(m);

        mesBox.className = "mes " + (isOpen ? "" : "collapsed") + (isMesAtual ? " mesAtual" : "");

        const filtroAtual = filtrosPorMes[m] || "todos";
        let gastosManuais = (gastosDetalhes[anoView] || []).filter(g => g.mes === m);
        
        // Verifica se usa a lista global ou o Snapshot (histórico congelado)
        const listaBaseFixas = mData.fixasSnapshot ? mData.fixasSnapshot : contasFixas;
        let gastosFixos = listaBaseFixas.filter(f => f.ativo && f.cartaoId);

        if(filtroAtual !== "todos") {
            gastosManuais = gastosManuais.filter(g => g.cartaoId == filtroAtual);
            gastosFixos = gastosFixos.filter(f => f.cartaoId == filtroAtual);
        }

        const tCr = gastosManuais.filter(g => cartoes.find(c => c.id == g.cartaoId)?.tipo === 'Crédito').reduce((a,b) => a + b.valor, 0) +
                    gastosFixos.filter(f => !mData.fixasDesativadas[f.id]).reduce((a,b) => a + b.valor, 0);
        const tDb = gastosManuais.filter(g => cartoes.find(c => c.id == g.cartaoId)?.tipo === 'Débito').reduce((a,b) => a + b.valor, 0);

        mesBox.innerHTML = `
            <div class="mesHeader">
                <span>${nomesMesesFull[m]} ${anoView}</span>
                <span>${formatar(tCr + tDb)}</span>
            </div>
            <div class="mesBody">
                <div class="filtro-interno" style="margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <span style="font-size:12px; opacity:0.8">Exibir cartão:</span>
                        <select class="inputPadrao sel-filtro-mes" style="width:auto; height:30px; font-size:12px;">
                            <option value="todos">Todos</option>
                            ${cartoes.map(c => `<option value="${c.id}" ${filtroAtual == c.id ? 'selected' : ''}>${c.nome}</option>`).join('')}
                        </select>
                    </div>
                </div>
                <div id="chart-pizza-${m}" style="display:flex; justify-content:center; margin: 15px 0;"></div>
                <table class="tabela-gastos">
                    <thead>
                        <tr>
                            <th style="width:1%"></th>
                            <th>Gasto</th>
                            <th style="cursor:pointer" onclick="document.getElementById('modalCategorias').style.display='flex'; renderCategoriasModal();">Categoria ✏️</th>
                            <th>Cartão</th>
                            <th>Valor</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody id="tbody-gastos-${m}"></tbody>
                    <tfoot>
                        <tr>
                            <td></td>
                            <td><input type="text" placeholder="Gasto..." id="add-nome-${m}" class="inputPadrao"></td>
                            <td><select id="add-cat-${m}" class="inputPadrao">${categorias.map(c => `<option value="${c.name}">${c.name}</option>`).join('')}</select></td>
                            <td><select id="add-card-${m}" class="inputPadrao">${cartoes.map(c => `<option value="${c.id}">${c.nome}</option>`).join('')}</select></td>
                            <td><input type="text" placeholder="0,00" id="add-val-${m}" class="inputPadrao input-valor-add"></td>
                            <td><button class="btn" id="btn-add-${m}" style="width:40px">+</button></td>
                        </tr>
                    </tfoot>
                </table>
                <div style="display: flex; justify-content: center; margin-bottom: 15px;">
                    <button class="btn" style="background: var(--P05); width: auto; font-size: 11px; padding: 10px 20px;" id="btn-add-parcela-${m}">
                        + NOVO PARCELAMENTO
                    </button>
                </div>
                <div class="resumo-gastos-inferior">
                    <div class="barra-resumo credito">Crédito <span>${formatar(tCr)}</span></div>
                    <div class="barra-resumo debito">Débito <span>${formatar(tDb)}</span></div>
                    <div class="barra-resumo total">TOTAL <span>${formatar(tCr + tDb)}</span></div>
                </div>
            </div>`;

        // Evento do Accordion (Abrir/Fechar Mês)
        mesBox.querySelector(".mesHeader").onclick = () => { 
            mesBox.classList.toggle("collapsed"); 
            if(mesBox.classList.contains("collapsed")) mesesGastosAbertos.delete(m); 
            else { mesesGastosAbertos.add(m); renderPizza(m, [...gastosFixos, ...gastosManuais]); } 
        };

        const selF = mesBox.querySelector(".sel-filtro-mes"); 
        selF.onclick = (e) => e.stopPropagation(); 
        selF.onchange = (e) => { filtrosPorMes[m] = e.target.value; renderPaginaGastos(); };

        area.appendChild(mesBox); 
        if(isOpen) setTimeout(() => renderPizza(m, [...gastosFixos, ...gastosManuais]), 50);

        const tbody = document.getElementById(`tbody-gastos-${m}`);

        // 1. RENDERIZAR GASTOS FIXOS (SINCRONIZADOS)
        gastosFixos.forEach(g => {
            const tr = document.createElement("tr");
            const desativada = mData.fixasDesativadas[g.id] === true;
            tr.style.opacity = desativada ? "0.3" : "0.8";
            const catI = categorias.find(c => c.name === g.categoria) || {color: "#888"};
            const cardN = cartoes.find(c => c.id == g.cartaoId)?.nome || "Cartão";
            tr.innerHTML = `
                <td><input type="checkbox" ${!desativada ? 'checked' : ''}></td>
                <td style="font-style: italic;">${g.nome}</td>
                <td><span class="badge" style="border: 1px solid ${catI.color}; color: ${catI.color}">${g.categoria}</span></td>
                <td>💳 ${cardN}</td>
                <td>${formatar(g.valor)}</td>
                <td title="Configuração Global">⚙️</td>`;
            tr.querySelector("input").onchange = (e) => {
                mData.fixasDesativadas[g.id] = !e.target.checked;
                atualizarTudo(anoView);
                renderPaginaGastos();
            };
            tbody.appendChild(tr);
        });

        // 2. RENDERIZAR GASTOS MANUAIS (VARIÁVEIS)
        gastosManuais.forEach((g) => {
            const tr = document.createElement("tr"); 
            const catCor = categorias.find(c => c.name === g.categoria)?.color || "transparent";
            const cardCor = cartoes.find(c => String(c.id) === String(g.cartaoId))?.color || "transparent";

            tr.innerHTML = `
                <td></td>
                <td><input type="text" class="input-tabela-edit nome" value="${g.nome}"></td>
                <td><select class="input-tabela-edit cat" style="border-left: 5px solid ${catCor}">${categorias.map(c => `<option value="${c.name}" ${g.categoria === c.name ? 'selected' : ''}>${c.name}</option>`).join('')}</select></td>
                <td><select class="input-tabela-edit card" style="border-left: 5px solid ${cardCor}">${cartoes.map(c => `<option value="${c.id}" ${g.cartaoId == c.id ? 'selected' : ''}>${c.nome}</option>`).join('')}</select></td>
                <td><input type="text" class="input-tabela-edit valor" value="${formatar(g.valor)}"></td>
                <td><button class="removeItem">×</button></td>`;
            
            const inVal = tr.querySelector(".valor");
            inVal.onfocus = () => { inVal.dataset.old = inVal.value; inVal.value = ""; };
            inVal.onblur = (e) => {
                const txt = e.target.value.trim();
                if (txt !== "") g.valor = parseValor(txt);
                inVal.value = formatar(g.valor);
                salvarDadosLocal(); atualizarTudo(anoView);
            };
            inVal.onkeydown = (ev) => { if(ev.key === "Enter") inVal.blur(); };

            tr.querySelector(".nome").onblur = (e) => { g.nome = e.target.value; salvarDadosLocal(); };
            tr.querySelector(".cat").onchange = (e) => { g.categoria = e.target.value; salvarDadosLocal(); renderPaginaGastos(); };
            tr.querySelector(".card").onchange = (e) => { g.cartaoId = e.target.value; salvarDadosLocal(); atualizarTudo(anoView); renderPaginaGastos(); };

            // BOTÃO REMOVER COM EXCLUSÃO EM CADEIA PARA PARCELAS
            tr.querySelector(".removeItem").onclick = () => {
                if (g.parcelaId) {
                    if (confirm("Deseja remover TODAS as parcelas desta compra?")) {
                        gastosDetalhes[anoView] = gastosDetalhes[anoView].filter(item => item.parcelaId !== g.parcelaId);
                    } else return;
                } else {
                    const idxGlobal = gastosDetalhes[anoView].indexOf(g);
                    if (idxGlobal > -1) gastosDetalhes[anoView].splice(idxGlobal, 1);
                }
                salvarDadosLocal(); atualizarTudo(anoView); renderPaginaGastos();
            };
            tbody.appendChild(tr);
        });

        // 3. CONFIGURAÇÃO DOS BOTÕES DE AÇÃO DO MÊS (ADICIONAR / PARCELAR)
        const addValInput = document.getElementById(`add-val-${m}`);
        addValInput.onfocus = () => { addValInput.value = ""; };
        addValInput.onblur = () => { if(addValInput.value.trim() !== "") addValInput.value = formatar(parseValor(addValInput.value)); };
        addValInput.onkeydown = (ev) => { if(ev.key === "Enter") document.getElementById(`btn-add-${m}`).click(); };

        document.getElementById(`btn-add-${m}`).onclick = () => { 
            const n = document.getElementById(`add-nome-${m}`).value, 
                  v = parseValor(document.getElementById(`add-val-${m}`).value); 
            if(!n || v <= 0) return; 
            if(!gastosDetalhes[anoView]) gastosDetalhes[anoView] = []; 
            gastosDetalhes[anoView].push({ 
                mes: m, nome: n, valor: v, 
                categoria: document.getElementById(`add-cat-${m}`).value, 
                cartaoId: document.getElementById(`add-card-${m}`).value 
            }); 
            salvarDadosLocal(); atualizarTudo(anoView); renderPaginaGastos(); 
        };

        document.getElementById(`btn-add-parcela-${m}`).onclick = () => { 
            contextParcelaCartao = { mes: m, ano: Number(anoView) }; 
            document.getElementById("pcNome").value = document.getElementById(`add-nome-${m}`).value; 
            document.getElementById("pcValorTotal").value = document.getElementById(`add-val-${m}`).value; 
            document.getElementById("pcCartao").innerHTML = cartoes.map(c => `<option value="${c.id}">${c.nome}</option>`).join(''); 
            document.getElementById("pcCartao").value = document.getElementById(`add-card-${m}`).value; 
            document.getElementById("pcCategoria").innerHTML = categorias.map(c => `<option value="${c.name}">${c.name}</option>`).join(''); 
            document.getElementById("pcCategoria").value = document.getElementById(`add-cat-${m}`).value; 
            document.getElementById("modalParcelaCartao").style.display = "flex"; 
        };
    }

    // Scroll automático se houver um alvo (clique vindo da Home)
    if (window.scrollTargetMes !== undefined) {
        const targetEl = document.getElementById(`box-gastos-mes-${window.scrollTargetMes}`);
        if (targetEl) {
            setTimeout(() => {
                targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                window.scrollTargetMes = undefined;
            }, 100);
        }
    }
}

document.getElementById("btnSalvarParcelaCartao").onclick = () => {
    const nome = document.getElementById("pcNome").value;
    const cartaoId = document.getElementById("pcCartao").value;
    const categoria = document.getElementById("pcCategoria").value;
    const total = parseValor(document.getElementById("pcValorTotal").value);
    const qtd = parseInt(document.getElementById("pcQtd").value);
    
    // Gera um ID único para este grupo de parcelas
    const pId = Date.now(); 

    if(!nome || total <= 0 || qtd <= 0) {
        alert("Preencha todos os campos corretamente.");
        return;
    }

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
            parcelaId: pId // OBRIGATÓRIO para a exclusão em cadeia
        });

        mesC++;
        if(mesC > 11) { mesC = 0; anoC++; }
    }

    document.getElementById("modalParcelaCartao").style.display = "none";
    salvarDadosLocal();
    atualizarTudo(contextParcelaCartao.ano);
    renderPaginaGastos();
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
                <td><button class="removeItem">×</button></td>
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
      <td><button class="removeItem">×</button></td>
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
      li.innerHTML = `<input type="color" class="seletor-cor-quadrado" value="${cat.color}" style="width:30px; height:30px;"><input type="text" class="inputPadrao cat-name-edit" value="${cat.name}" style="flex:2"><button class="removeItem" style="width:22px;height:22px">×</button>`;
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
    const lista = document.getElementById("listaCartoesModal"); if(!lista) return; lista.innerHTML = "";
    cartoes.forEach((c, index) => {
        const div = document.createElement("div"); div.className = "item";
        div.style.marginBottom = "10px";
        div.innerHTML = `
            <input type="color" class="seletor-cor-quadrado" value="${c.color || '#D78341'}" style="width:40px; height:40px; padding:0; border:none;">
            <input type="text" class="inputPadrao" value="${c.nome}" style="flex:2" placeholder="Nome do Cartão">
            <select class="inputPadrao" style="width:100px">
                <option value="Crédito" ${c.tipo=='Crédito'?'selected':''}>Crédito</option>
                <option value="Débito" ${c.tipo=='Débito'?'selected':''}>Débito</option>
            </select>
            <input type="number" class="inputPadrao" value="${c.vencimento}" style="width:50px" title="Vencimento">
            <button class="removeItem">×</button>`;
            
        const [iCol, iN, sT, iV, bR] = div.children;
        iCol.onchange = (e) => { cartoes[index].color = e.target.value; salvarDadosLocal(); };
        iN.onblur = (e) => { cartoes[index].nome = e.target.value; salvarDadosLocal(); };
        sT.onchange = (e) => { cartoes[index].tipo = e.target.value; salvarDadosLocal(); };
        iV.onblur = (e) => { cartoes[index].vencimento = parseInt(e.target.value); salvarDadosLocal(); };
        bR.onclick = () => { cartoes.splice(index, 1); renderCartoesModal(); salvarDadosLocal(); };
        lista.appendChild(div);
    });
}

onAuthStateChanged(auth, async (user) => {
if (user) {
    usuarioLogado = user; 
    document.getElementById("displayEmail").textContent = user.email;
    
    // Recupera a senha do armazenamento caso a página tenha sido recarregada
    if (!senhaDoUsuario) {
        senhaDoUsuario = sessionStorage.getItem("temp_key") || "";
    }

    const snap = await getDoc(doc(db, "financas", user.uid));
    if (snap.exists()) {
        try {
            // Só tenta descriptografar se houver uma senha na memória
            if (!senhaDoUsuario) throw new Error("Senha ausente");

            const res = await decryptData(snap.data(), senhaDoUsuario);
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
            atualizarSeletorAnos();
            aplicarParcelas();
        } catch (err) {
            console.error("Erro na descriptografia:", err);
            alert("Sua sessão expirou ou a chave de segurança é inválida. Por favor, faça login novamente.");
            signOut(auth);
            return;
        }
    }
    atualizarSaudacao();
    aplicarTema(configuracoes.tema);
    atualizarTituloSite();
    document.getElementById("authContainer").style.display = "none"; document.getElementById("appContainer").style.display = "block";
    const { mesAt } = getMesReferenciaAtivo(); mesesAbertos.add(mesAt); carregarAno(); renderContasFixas(); renderReceitasFixas(); renderLembretesHome(); roteador();
    const seletorTemaFooter = document.getElementById("cfgTemaFooter");
    if(seletorTemaFooter) seletorTemaFooter.value = configuracoes.tema || "planetario";
  } else { document.getElementById("authContainer").style.display = "flex"; document.getElementById("appContainer").style.display = "none"; }
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
        lembretes = res.lembretes || []; // Adicionado aqui
        contasFixas = res.contasFixas || []; 
        receitasFixas = res.receitasFixas || []; 
        salarioFixoBase = res.salarioFixoBase || 0; 
        categorias = migrarCategorias(res.categorias); 
        configuracoes = res.configuracoes || configuracoes; 
        cartoes = res.cartoes || []; 
        gastosDetalhes = res.gastosDetalhes || {}; 
        atualizarSeletorAnos();
        carregarAno(); 
        renderContasFixas(); 
        renderReceitasFixas(); 
        renderLembretesHome(); // Adicionado aqui
        renderPaginaGastos();
        aplicarTema(configuracoes.tema);
        atualizarVisibilidadeBotaoIA();
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
            { cartoes, contasFixas, receitasFixas, lembretes, configuracoes, gastosDetalhes }, 
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
document.getElementById("cadastroBtn").onclick = async () => { const e = document.getElementById("email").value, s = document.getElementById("senha").value; try { await createUserWithEmailAndPassword(auth, e, s); senhaDoUsuario = s; sessionStorage.setItem("temp_key", s); await salvarFirebase(); } catch (err) { alert("Erro cadastro"); } };
document.getElementById("logoutBtn").onclick = () => { signOut(auth); sessionStorage.clear(); location.reload(); };
document.getElementById("btnSettings").onclick = () => { const modalCfg = document.getElementById("modalConfiguracoes"); if(!modalCfg) return; document.getElementById("cfgApiKey").value = configuracoes.geminiKey || ""; document.getElementById("cfgNomeUsuario").value = configuracoes.nomeUsuario || ""; document.getElementById("cfgDiaVirada").value = configuracoes.diaVirada || 1; const ref = configuracoes.referenciaMes || "atual"; document.getElementById("refAtual").checked = (ref === "atual"); document.getElementById("refProximo").checked = (ref === "proximo"); modalCfg.style.display = "flex"; };
document.getElementById("btnSalvarConfig").onclick = async () => { configuracoes.nomeUsuario = document.getElementById("cfgNomeUsuario").value; configuracoes.diaVirada = document.getElementById("cfgDiaVirada").value;
configuracoes.diaSalario = document.getElementById("cfgDiaSalario").value; 
configuracoes.geminiKey = document.getElementById("cfgApiKey").value;
configuracoes.referenciaMes = document.querySelector('input[name="refMes"]:checked')?.value || "atual"; atualizarTituloSite(); await salvarFirebase(); document.getElementById("modalConfiguracoes").style.display = "none"; carregarAno(); renderPaginaGastos();

    configuracoes.geminiKey = document.getElementById("cfgApiKey").value;
    
    // Se ele preencheu a chave, resetamos o status de desativado
    if (configuracoes.geminiKey.trim() !== "") {
        configuracoes.assistenteDesativado = false;
    }

    atualizarVisibilidadeBotaoIA(); // Atualiza o botão na hora
    atualizarTituloSite(); 
    await salvarFirebase(); 
    document.getElementById("modalConfiguracoes").style.display = "none"; 
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
    // Adiciona o campo color ao novo objeto
    cartoes.push({ id: Date.now(), nome: "", tipo: "Crédito", vencimento: 10, color: "#D78341" }); 
    renderCartoesModal(); 
};

// Adicionar Despesa Fixa Comum
document.getElementById("btnAddContaFixa").onclick = () => { 
    contasFixas.push({ 
        id: Date.now(), 
        nome: "", 
        valor: 0, 
        dia: 1,
        ativo: true, 
        categoria: categorias[0].name,
        cartaoId: "",
        tipo: "fixa" // Diferencial
    }); 
    renderContasFixas(); 
};

// Adicionar Assinatura
document.getElementById("btnAddAssinaturaFixa").onclick = () => { 
    contasFixas.push({ 
        id: Date.now(), 
        nome: "", 
        valor: 0, 
        dia: 1,
        ativo: true, 
        categoria: "Lazer", // Sugestão padrão
        cartaoId: cartoes.length > 0 ? cartoes[0].id : "", // Assinatura geralmente tem cartão
        tipo: "assinatura" // Diferencial
    }); 
    renderContasFixas(); 
};

document.getElementById("salvarNuvemBtn").onclick = salvarFirebase;
document.getElementById("headerContasFixas").onclick = () => document.getElementById("moduloContasFixas").classList.toggle("collapsed");
document.getElementById("headerReceitasFixas").onclick = () => document.getElementById("moduloReceitasFixas").classList.toggle("collapsed");
document.getElementById("showSignup").onclick = (e) => { e.preventDefault(); document.getElementById("loginActions").style.display = "none"; document.getElementById("signupActions").style.display = "block"; };
document.getElementById("showLogin").onclick = (e) => { e.preventDefault(); document.getElementById("signupActions").style.display = "none"; document.getElementById("loginActions").style.display = "block"; };
document.getElementById("btnFecharParcelaCartao").onclick = () => document.getElementById("modalParcelaCartao").style.display = "none";
document.getElementById("btnIrCalendario").onclick = () => window.location.hash = "#calendario";

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
    
    // CRIAR MÊS LIMPO (Itens fixos são calculados via atualizarTudo, não copiados aqui)
    const n = { 
        despesas: [], 
        empresa: [], 
        salario: salarioFixoBase, 
        conta: 0, 
        contaManual: false,
        fixasDesativadas: {},   // Controle individual de despesas
        receitasDesativadas: {} // Controle individual de rendas
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
    renderCalendario({cartoes, contasFixas, receitasFixas, lembretes, configuracoes, gastosDetalhes}, { abrirPostit });
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
                renderCalendario({cartoes, contasFixas, receitasFixas, lembretes, configuracoes, gastosDetalhes}, { abrirPostit }); 
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
            renderCalendario({cartoes, contasFixas, receitasFixas, lembretes, configuracoes, gastosDetalhes}, { abrirPostit });
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

// FUNÇÕES DE IA

async function conversarComIA(pergunta) {
    const apiKey = configuracoes.geminiKey;
    if (!apiKey) return "Erro: API Key não encontrada.";

    const anoView = document.getElementById("ano")?.value || new Date().getFullYear();
    const hojeData = new Date();
    const dataISO = hojeData.toISOString().split('T')[0];

    // Contexto fixo que vai em todas as mensagens
    const contextoApp = {
        usuario: configuracoes.nomeUsuario,
        dataHoje: dataISO,
        diaSemana: hojeData.toLocaleDateString('pt-BR', {weekday: 'long'}),
        anoVisualizado: anoView,
        cartoes: cartoes.map(c => ({ id: c.id, nome: c.nome })),
        categorias: categorias.map(c => c.name)
    };

    const instrucaoSistema = `Você é o assistente do app "Contas Mensais". 
    Hoje é ${contextoApp.diaSemana}, dia ${contextoApp.dataHoje}.
    Dados do App: ${JSON.stringify(contextoApp)}.

    REGRAS:
    1. Se o usuário confirmar dados faltantes de um lembrete ou gasto, retorne o JSON de ação.
    2. ADD_REMINDER: Precisa de Nome e Data (YYYY-MM-DD). Hora e Valor são opcionais.
    3. ADD_EXPENSE: Precisa de Nome, Valor, Cartão (use o ID do contexto) e Mês (0-11).
    4. Mantenha o contexto: se o usuário disse "Dentista" na mensagem anterior e agora disse "às 9h", ele ainda está falando do Dentista.
    5. RESPOSTA JSON: Se for executar a ação, responda APENAS o JSON, sem texto antes ou depois.`;

    // Adiciona a pergunta atual ao histórico
    historicoChatIA.push({ role: "user", parts: [{ text: pergunta }] });

    // Prepara o corpo da requisição com as instruções de sistema e o histórico
    const corpoRequisicao = {
        contents: [
            { role: "user", parts: [{ text: instrucaoSistema }] }, // Instrução base
            ...historicoChatIA // Memória da conversa
        ],
        generationConfig: { temperature: 0.7 }
    };

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(corpoRequisicao)
        });

        const data = await response.json();
        if (data.error) return `Erro: ${data.error.message}`;

        let text = data.candidates[0].content.parts[0].text;

        // Adiciona a resposta da IA ao histórico para a próxima rodada
        historicoChatIA.push({ role: "model", parts: [{ text: text }] });

        // Limita o histórico para não ficar pesado (últimas 10 mensagens)
        if (historicoChatIA.length > 10) historicoChatIA.shift();

// Processa JSON se existir (limpando Markdown se necessário)
        if (text.includes('"action"')) {
            try {
                // Remove blocos de código markdown (```json ... ```)
                let jsonLimpo = text.replace(/```json|```/g, "").trim();
                
                // Tenta encontrar o conteúdo entre as chaves { }
                const inicio = jsonLimpo.indexOf('{');
                const fim = jsonLimpo.lastIndexOf('}');
                
                if (inicio !== -1 && fim !== -1) {
                    jsonLimpo = jsonLimpo.substring(inicio, fim + 1);
                    const acao = JSON.parse(jsonLimpo);
                    return await processarAcaoIA(acao);
                }
            } catch (e) {
                console.error("Falha ao processar comando da IA:", e);
            }
        }

        return text;
    } catch (e) {
        return "Erro de conexão com o Gemini.";
    }
}

async function processarAcaoIA(comando) {
    const anoView = document.getElementById("ano")?.value || new Date().getFullYear();
    historicoChatIA.push({ role: "model", parts: [{ text: `Ação executada: ${comando.action}` }] });


    if (comando.action === "ADD_REMINDER") {
        const novoLembrete = {
            id: Date.now(),
            nome: comando.data.nome,
            data: comando.data.data,
            hora: comando.data.hora || "",
            valor: comando.data.valor || 0,
            recorrente: false,
            diasSemana: []
        };
        lembretes.push(novoLembrete);
        await salvarFirebase();
        renderLembretesHome();
        // Atualiza calendário se estiver nele
        if(window.location.hash === "#calendario") {
            renderCalendario({cartoes, contasFixas, receitasFixas, lembretes, configuracoes, gastosDetalhes}, { abrirPostit });
        }
        return `✅ Lembrete **${comando.data.nome}** agendado para ${comando.data.data}!`;
    }

    if (comando.action === "ADD_EXPENSE") {
        if (!gastosDetalhes[anoView]) gastosDetalhes[anoView] = [];
        
        const novoGasto = {
            mes: comando.data.mes,
            nome: comando.data.nome,
            valor: comando.data.valor,
            categoria: comando.data.categoria || categorias[0].name,
            cartaoId: comando.data.cartaoId
        };
        
        gastosDetalhes[anoView].push(novoGasto);
        await salvarFirebase();
        atualizarTudo(anoView);
        
        // Se estiver na tela de gastos, re-renderiza
        if(window.location.hash === "#gastos") renderPaginaGastos();
        
        const nomeMes = nomesMesesFull[comando.data.mes];
        return `✅ Gasto de **${formatar(comando.data.valor)}** em **${comando.data.nome}** registrado em ${nomeMes}!`;

    }

    return "Ação não reconhecida.";
}

function atualizarVisibilidadeBotaoIA() {
    const btn = document.getElementById("btnAbrirChatIA");
    const temChave = configuracoes.geminiKey && configuracoes.geminiKey.trim() !== "";
    
    // Mostra o botão se: tiver chave OU se a pessoa ainda não clicou em "Recusar"
    if (temChave || configuracoes.assistenteDesativado !== true) {
        btn.style.display = "block";
    } else {
        btn.style.display = "none";
    }
}

// ================= GESTÃO DA IA (MEMÓRIA E EVENTOS) =================

// LÓGICA DE ABERTURA DO ASSISTENTE
document.getElementById("btnAbrirChatIA").onclick = () => {
    const temChave = configuracoes.geminiKey && configuracoes.geminiKey.trim() !== "";

    if (!temChave) {
        // Se não configurou a chave, abre o tutorial
        document.getElementById("modalConfigIA").style.display = "flex";
    } else {
        const chat = document.getElementById("modalChatIA");
        // Se for fechar a janela, limpamos a memória para a próxima conversa ser limpa
        if (chat.style.display === "flex") {
            chat.style.display = "none";
            historicoChatIA = []; // SUGESTÃO 3: Limpa o contexto ao fechar
        } else {
            chat.style.display = "flex";
            document.getElementById("inputChatIA").focus();
        }
    }
};

// BOTÃO FECHAR (O "X" dentro da janelinha)
// Se você tiver um botão de fechar no HTML, chame essa função:
window.fecharWidgetIA = function() {
    document.getElementById("modalChatIA").style.display = "none";
    historicoChatIA = []; // Limpa a memória ao fechar no X também
};

// BOTÃO RECUSAR NO TUTORIAL
document.getElementById("btnRecusarIA").onclick = async () => {
    configuracoes.assistenteDesativado = true; // Salva a escolha de esconder
    document.getElementById("modalConfigIA").style.display = "none";
    atualizarVisibilidadeBotaoIA();
    await salvarFirebase(); // Sincroniza com a nuvem
};

// BOTÃO ACEITAR E SALVAR CHAVE
document.getElementById("btnAceitarIA").onclick = async () => {
    const novaChave = document.getElementById("inputApiKeyIA").value.trim();
    if (novaChave.length < 10) {
        alert("Por favor, insira uma API Key válida.");
        return;
    }

    configuracoes.assistenteDesativado = false; 
    configuracoes.geminiKey = novaChave;
    await salvarFirebase(); 
    document.getElementById("modalConfigIA").style.display = "none";
    document.getElementById("modalChatIA").style.display = "flex";
    document.getElementById("inputChatIA").focus();
    
    const windowChat = document.getElementById("chatWindow");
    windowChat.innerHTML += `<div class="msg-ia">Chave configurada com sucesso! Como posso analisar suas contas hoje?</div>`;
};

// FUNÇÃO CENTRAL DE ENVIAR MENSAGEM
async function enviarMensagemIA() {
    const input = document.getElementById("inputChatIA");
    const windowChat = document.getElementById("chatWindow");
    const texto = input.value.trim();

    if (!texto) return;

    // 1. Mostrar mensagem do usuário
   windowChat.innerHTML += `<div class="msg-user">${formatarMarkdown(texto)}</div>`;
    input.value = "";
    windowChat.scrollTop = windowChat.scrollHeight;

    // 2. Mostrar indicador de "Pensando..."
    const loadingId = "loading-" + Date.now();
    windowChat.innerHTML += `
        <div class="msg-ia loading-msg" id="${loadingId}">
            <div class="typing-dots">
                <div class="dot"></div>
                <div class="dot"></div>
                <div class="dot"></div>
            </div>
        </div>`;
    windowChat.scrollTop = windowChat.scrollHeight;

    // 3. Chamar a IA (com histórico/memória)
    try {
        const resposta = await conversarComIA(texto);
        
        // 4. Remover o loading e mostrar a resposta real
        const loadingEl = document.getElementById(loadingId);
        if (loadingEl) loadingEl.remove();

        windowChat.innerHTML += `<div class="msg-ia">${formatarMarkdown(resposta)}</div>`;
    } catch (error) {
        const loadingEl = document.getElementById(loadingId);
        if (loadingEl) loadingEl.innerHTML = "Erro ao obter resposta.";
    }

    windowChat.scrollTop = windowChat.scrollHeight;
}

function formatarMarkdown(texto) {
    // Substitui **texto** por <b>texto</b>
    return texto.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
}

// EVENTO DE CLIQUE NO BOTÃO ENVIAR
document.getElementById("btnEnviarIA").onclick = enviarMensagemIA;

// EVENTO DE ENTER NO CAMPO DE TEXTO
document.getElementById("inputChatIA").onkeydown = (e) => {
    if (e.key === "Enter") {
        e.preventDefault(); 
        enviarMensagemIA();
    }
};