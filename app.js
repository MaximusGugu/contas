import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { renderCalendario, calcularDiaPagamento } from "./calendario.js";

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

const hoje = new Date();
const nomesMesesFull = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
let contextParcelaCartao = { mes: 0, ano: 2024 };

// ================= FUNÇÕES DE APOIO =================
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

function renderLembretesHome() {
    const lista = document.getElementById("listaLembretesHome");
    if (!lista) return;
    lista.innerHTML = "";

    const hojeSimples = new Date().toISOString().split('T')[0];

    // Filtra lembretes de hoje em diante e ordena por data
    const proximos = lembretes
        .filter(l => l.data >= hojeSimples)
        .sort((a, b) => a.data.localeCompare(b.data))
        .slice(0, 3); // Mostra apenas os 3 primeiros

    if (proximos.length === 0) {
        lista.innerHTML = `<div class="lembrete-vazio">Nenhum lembrete próximo...</div>`;
        return;
    }

    proximos.forEach(l => {
        const dataBr = l.data.split('-').reverse().join('/');
        const div = document.createElement("div");
        div.className = "item-lembrete-home";
        div.innerHTML = `
            <div class="info">
                <span class="titulo">${l.nome}</span>
                <span class="data">📅 ${dataBr} ${l.hora ? ' às ' + l.hora : ''}</span>
            </div>
            <button class="btn-postit" style="background:none; color:var(--P04); font-size:18px;"> </button>
        `;
        div.onclick = () => abrirPostit(l);
        lista.appendChild(div);
    });
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
    setTimeout(() => { if(btn) btn.innerText = "☁️ SALVAR NA NUVEM"; }, 2000);
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
      if (!ehOPrimeiroMesDeTodos && m.contaManual !== true) {
          m.conta = saldoAcumulado;
      }
const dManuais = (m.despesas || []).filter(x => x.checked).reduce((acc, b) => acc + b.valor, 0);
      const gastosMes = (gastosDetalhes[ano] || []).filter(g => g.mes === idx);
      const tCr = gastosMes.filter(g => cartoes.find(c => c.id == g.cartaoId)?.tipo === 'Crédito').reduce((acc, g) => acc + g.valor, 0);
      const fixasNoCard = contasFixas.filter(f => f.ativo && f.cartaoId).reduce((acc, f) => acc + f.valor, 0);
      const eTotal = (m.empresa || []).filter(x => x.checked).reduce((acc, b) => acc + b.valor, 0);
      const tDisp = (m.salario || 0) + (m.conta || 0) + eTotal;
      const saldoFinal = tDisp - (dManuais + tCr + fixasNoCard);
      m.saldoCalculadoFinal = saldoFinal; 
      saldoAcumulado = saldoFinal; ehOPrimeiroMesDeTodos = false;

      if (ano === Number(anoParaVisualizar)) {
        const info = mesesDOM.find(item => item.index === idx);
        if (info) {
          const dom = info.dom;
          const listaCartoesDiv = dom.querySelector(".listaCartoesDinamica");
          if (listaCartoesDiv) {
              listaCartoesDiv.innerHTML = "";
              
              // 1. Pega gastos variáveis do mês que são crédito
              const crdGastosVariaveis = gastosMes.filter(g => cartoes.find(c => c.id == g.cartaoId)?.tipo === 'Crédito');
              
              // 2. Pega despesas fixas que estão em algum cartão
              const crdGastosFixos = contasFixas.filter(f => f.ativo && f.cartaoId);

              const totaisPorCartao = {};

              // Somar variáveis
              crdGastosVariaveis.forEach(g => { 
                  totaisPorCartao[g.cartaoId] = (totaisPorCartao[g.cartaoId] || 0) + g.valor; 
              });

              // Somar fixas
              crdGastosFixos.forEach(f => {
                  totaisPorCartao[f.cartaoId] = (totaisPorCartao[f.cartaoId] || 0) + f.valor;
              });

              if (Object.keys(totaisPorCartao).length > 0) {
                  listaCartoesDiv.innerHTML = "<small style='display:block;margin-bottom:5px;opacity:0.6'>RESUMO DE CARTÕES (CRÉDITO):</small>";
                  Object.keys(totaisPorCartao).forEach(cid => {
                      const cObj = cartoes.find(c => c.id == cid);
                      if (!cObj) return; // Pula se o cartão foi excluído
                      
                      const itemC = document.createElement("div"); 
                      itemC.className = "item-cartao-resumo";
                      itemC.style.cursor = "pointer";
                      itemC.innerHTML = `<span>💳 ${cObj.nome}</span> <span>${formatar(totaisPorCartao[cid])}</span>`;
                      itemC.onclick = () => { 
                          document.getElementById("anoGastos").value = ano; 
                          filtrosPorMes[idx] = cid; 
                          mesesGastosAbertos.add(idx); 
                          window.location.hash = "#gastos";
                      };
                      listaCartoesDiv.appendChild(itemC);
                  });
              }
          }
          dom.querySelector(".totalDespesas").textContent = formatar(dManuais + tCr + fixasNoCard);
          dom.querySelector(".totalDinheiro").textContent = formatar(tDisp);
          const sEl = dom.querySelector(".saldo"); 
          sEl.textContent = formatar(saldoFinal);
          sEl.className = "saldo " + (saldoFinal >= 0 ? "positivo" : "negativo");
          dom.querySelector(".mesTotal").textContent = formatar(saldoFinal);
          const inS = dom.querySelector("input.salario"); 
          const inC = dom.querySelector("input.conta");
          if (document.activeElement !== inS) inS.value = formatar(m.salario);
          if (document.activeElement !== inC) { inC.value = formatar(m.conta); if (m.contaManual === true) inC.classList.add("manual"); else inC.classList.remove("manual"); }
          if (ano === anoAt && idx === mesAt) dom.classList.add("mesAtual"); else dom.classList.remove("mesAtual");
        }
      }
    });
  });
  salvarDadosLocal(pendente); atualizarGrafico(Number(anoParaVisualizar));
}

function atualizarGrafico(ano) {
    const ctx = document.getElementById("grafico"); 
    if (!ctx || !dados[ano] || !dados[ano].meses || dados[ano].meses.length === 0) return;
    const tempElement = document.createElement("div");
    tempElement.className = "texto-claro"; tempElement.style.display = "none";
    document.body.appendChild(tempElement);
    const tColor = getComputedStyle(tempElement).color || '#000000';
    document.body.removeChild(tempElement);
    const pColor = getComputedStyle(document.body).getPropertyValue('--P04').trim() || '#D78341';
    const bgColor = getComputedStyle(document.body).getPropertyValue('--P06').trim() || '#ffffff';
    const saldos = dados[ano].meses.map(m => parseFloat((m.saldoCalculadoFinal || 0).toFixed(2)));
    const labels = dados[ano].meses.map((_, i) => nomesMesesFull[i]);
    const options = { series: [{ name: 'Saldo Final', data: saldos }], chart: { type: 'bar', height: 250, toolbar: { show: false }, background: bgColor, foreColor: tColor }, colors: [pColor], xaxis: { categories: labels }, yaxis: { labels: { formatter: (val) => "R$ " + val.toLocaleString('pt-BR') } }, grid: { borderColor: 'rgba(255,255,255,0.1)' }, tooltip: { theme: 'dark' }, dataLabels: { enabled: true, formatter: (val) => "R$ " + val.toLocaleString('pt-BR'), style: { fontSize: '10px' }, offsetY: -20 }, plotOptions: { bar: { dataLabels: { position: 'top' }, borderRadius: 4 } } };
    if (chartResumo) chartResumo.destroy();
    chartResumo = new ApexCharts(ctx, options); chartResumo.render();
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
                <div class="acoesDesp">
                    <button class="addDesp btn">+ Despesa</button>
                    <button class="addParcela btn">+ Parcela</button>
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
                <button class="addEmp btn" style="width:100%; margin-top:10px;">+</button>
            </div>
            <p class="rodapeColuna">Total: <span class="totalDinheiro">0,00</span></p>
        </div>
    </div>
    <div class="totalFinal">TOTAL: <span class="saldo">0,00</span></div>`;
  const listD = body.querySelector(".listaDesp"); const listE = body.querySelector(".listaEmp");
  data.despesas.forEach(item => criarItem(listD, item, data.despesas, ano)); (data.empresa || []).forEach(item => criarItem(listE, item, data.empresa, ano));
  const inS = body.querySelector("input.salario"); const inC = body.querySelector("input.conta"); const btnC = body.querySelector(".btn-cascata");
  inS.value = formatar(data.salario || 0); inC.value = formatar(data.conta || 0);
  aplicarComportamentoInput(inS, () => data.salario, (v) => { data.salario = v; atualizarTudo(ano); }, ano);
  inC.addEventListener("blur", () => { const txt = inC.value.trim(); if (txt === "") data.contaManual = false; else { data.conta = parseValor(txt); data.contaManual = true; } atualizarTudo(ano); });
  inC.addEventListener("keydown", (e) => { if(e.key === "Enter") inC.blur(); });
  btnC.onclick = () => { const anos = Object.keys(dados).map(Number).sort((a,b)=>a-b); let found = false; anos.forEach(a => dados[a].meses.forEach((m, i) => { if(a == ano && i == index) found = true; else if(found) m.contaManual = false; })); atualizarTudo(ano); };
  body.querySelector(".addDesp").onclick = () => { data.despesas.push({nome:"", valor:0, checked:true}); carregarAno(); };
  
  // BOTÃO PARCELA DA HOME CORRIGIDO
  body.querySelector(".addParcela").onclick = () => { 
      const n = prompt("Nome da despesa:"); 
      const vt = parseValor(prompt("Valor TOTAL da compra:")); 
      const np = parseInt(prompt("Quantidade de parcelas:")); 
      if(n && vt > 0 && np > 0) { 
          parcelasMemoria.push({ 
              id: Date.now(), 
              nome: n, 
              valorParcela: Number((vt / np).toFixed(2)), 
              parcelas: np, 
              inicio: index, 
              ano: Number(ano) 
          }); 
          aplicarParcelas(); 
          carregarAno(); 
      } 
  };
  
  body.querySelector(".addEmp").onclick = () => { if(!data.empresa) data.empresa=[]; data.empresa.push({nome:"", valor:0, checked:true}); carregarAno(); };
  mes.appendChild(header); mes.appendChild(body); return mes;
}

// ================= GESTÃO DE GASTOS DETALHADOS =================

function renderPaginaGastos() {
    const area = document.getElementById("areaGastosMensais"); 
    const anoView = document.getElementById("anoGastos").value; 
    const { mesAt, anoAt } = getMesReferenciaAtivo();
    area.innerHTML = "";

    for (let m = 0; m < 12; m++) {
        const mesBox = document.createElement("div"); 
        const isMesAtual = (m === mesAt && Number(anoView) === anoAt); 
        const isOpen = mesesGastosAbertos.has(m) || isMesAtual;
        mesBox.className = "mes " + (isOpen ? "" : "collapsed") + (isMesAtual ? " mesAtual" : "");

        // --- LÓGICA DE GASTOS ---
        const filtroAtual = filtrosPorMes[m] || "todos";
        
        // 1. Gastos Manuais (Detalhes)
        let gastosManuais = (gastosDetalhes[anoView] || []).filter(g => g.mes === m);
        
        // 2. Gastos Fixos vindos das Configurações (apenas os que têm cartão)
        let gastosFixos = contasFixas.filter(f => f.ativo && f.cartaoId);

        // Aplicar Filtro de Cartão em ambos
        if(filtroAtual !== "todos") {
            gastosManuais = gastosManuais.filter(g => g.cartaoId == filtroAtual);
            gastosFixos = gastosFixos.filter(f => f.cartaoId == filtroAtual);
        }

        // Calcular Totais (Fixos + Manuais)
        const todosGastos = [...gastosFixos, ...gastosManuais];
        const tCr = todosGastos.filter(g => cartoes.find(c => c.id == g.cartaoId)?.tipo === 'Crédito').reduce((a,b) => a + b.valor, 0);
        const tDb = todosGastos.filter(g => cartoes.find(c => c.id == g.cartaoId)?.tipo === 'Débito').reduce((a,b) => a + b.valor, 0);

        mesBox.innerHTML = `
            <div class="mesHeader">
                <span>${nomesMesesFull[m]} ${anoView}</span>
                <span>${formatar(tCr + tDb)}</span>
            </div>
            <div class="mesBody">
                <div class="filtro-interno">
                    <span style="font-size:12px; opacity:0.8">Exibir cartão:</span>
                    <select class="inputPadrao sel-filtro-mes" style="width:auto; height:30px; font-size:12px;">
                        <option value="todos">Todos</option>
                        ${cartoes.map(c => `<option value="${c.id}" ${filtroAtual == c.id ? 'selected' : ''}>${c.nome}</option>`).join('')}
                    </select>
                </div>
                <div id="chart-pizza-${m}" style="display:flex; justify-content:center; margin: 15px 0;"></div>
                <table class="tabela-gastos">
                    <thead>
                        <tr>
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
                            <td><input type="text" placeholder="Gasto..." id="add-nome-${m}" class="inputPadrao"></td>
                            <td><select id="add-cat-${m}" class="inputPadrao">${categorias.map(c => `<option value="${c.name}">${c.name}</option>`).join('')}</select></td>
                            <td><select id="add-card-${m}" class="inputPadrao">${cartoes.map(c => `<option value="${c.id}">${c.nome}</option>`).join('')}</select></td>
                            <td><input type="text" placeholder="0,00" id="add-val-${m}" class="inputPadrao input-valor-add"></td>
                            <td>
                                <div style="display:flex; gap:5px">
                                    <button class="btn" id="btn-add-${m}">+</button>
                                    <button class="btn" style="background:#8e44ad" id="btn-add-parcela-${m}">🗓️</button>
                                </div>
                            </td>
                        </tr>
                    </tfoot>
                </table>
                <div class="resumo-gastos-inferior">
                    <div class="barra-resumo credito">Crédito <span>${formatar(tCr)}</span></div>
                    <div class="barra-resumo debito">Débito <span>${formatar(tDb)}</span></div>
                    <div class="barra-resumo total">TOTAL <span>${formatar(tCr + tDb)}</span></div>
                </div>
            </div>`;

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

        // --- RENDERIZAR GASTOS FIXOS (SINCRONIZADOS) ---
        if (gastosFixos.length > 0) {
            const trHeader = document.createElement("tr");
            trHeader.innerHTML = `<td colspan="5" style="background: rgba(255,255,255,0.05); font-size: 10px; font-weight: bold; color: var(--P04); padding: 5px 12px;">DESPESAS FIXAS SINCRONIZADAS</td>`;
            tbody.appendChild(trHeader);

            gastosFixos.forEach(g => {
                const tr = document.createElement("tr");
                tr.style.opacity = "0.8"; // Diferenciar visualmente
                const catI = categorias.find(c => c.name === g.categoria) || {color: "#888"};
                const cardN = cartoes.find(c => c.id == g.cartaoId)?.nome || "Cartão";
                
                tr.innerHTML = `
                    <td style="font-style: italic;">${g.nome}</td>
                    <td><span class="badge" style="border: 1px solid ${catI.color}; color: ${catI.color}">${g.categoria}</span></td>
                    <td>💳 ${cardN}</td>
                    <td>${formatar(g.valor)}</td>
                    <td title="Gerenciado em 'Resumo'">⚙️</td>
                `;
                tbody.appendChild(tr);
            });

            const trSpacer = document.createElement("tr");
            trSpacer.innerHTML = `<td colspan="5" style="background: rgba(255,255,255,0.05); font-size: 10px; font-weight: bold; color: var(--P04); padding: 5px 12px;">GASTOS DO MÊS</td>`;
            tbody.appendChild(trSpacer);
        }

        // --- RENDERIZAR GASTOS MANUAIS ---
        gastosManuais.forEach((g, idx) => {
            const tr = document.createElement("tr"); 
            const catI = categorias.find(c => c.name === g.categoria) || {color: "#888"};
            tr.innerHTML = `
                <td><input type="text" class="input-tabela-edit" value="${g.nome}" data-key="nome"></td>
                <td><select class="input-tabela-edit" data-key="categoria" style="border-left: 5px solid ${catI.color}">${categorias.map(c => `<option value="${c.name}" ${g.categoria === c.name ? 'selected' : ''}>${c.name}</option>`).join('')}</select></td>
                <td><select class="input-tabela-edit" data-key="cartaoId">${cartoes.map(c => `<option value="${c.id}" ${g.cartaoId == c.id ? 'selected' : ''}>${c.nome}</option>`).join('')}</select></td>
                <td><input type="text" class="input-tabela-edit" value="${formatar(g.valor)}" data-key="valor"></td>
                <td><button class="removeItem" id="rem-${m}-${idx}">×</button></td>`;
            
            tr.querySelectorAll('.input-tabela-edit').forEach(input => { 
                input.onblur = (e) => { 
                    const key = input.getAttribute('data-key'); 
                    let val = e.target.value; 
                    if(key === 'valor') val = parseValor(val); 
                    g[key] = val; 
                    salvarDadosLocal(); 
                    renderPaginaGastos(); 
                }; 
                if(input.tagName === 'INPUT') input.onkeydown = (e) => { if(e.key === 'Enter') input.blur(); }; 
            });

            tr.querySelector(".removeItem").onclick = () => { 
                if(g.parcelaId) { 
                    if(confirm("Apagar todas as parcelas?")) { 
                        Object.keys(gastosDetalhes).forEach(ano => { gastosDetalhes[ano] = gastosDetalhes[ano].filter(item => item.parcelaId !== g.parcelaId); }); 
                        salvarDadosLocal(); 
                        renderPaginaGastos(); 
                    } 
                } else { 
                    gastosDetalhes[anoView] = gastosDetalhes[anoView].filter(item => item !== g); 
                    salvarDadosLocal(); 
                    renderPaginaGastos(); 
                } 
            };
            tbody.appendChild(tr);
        });

        // Configuração dos botões de Adicionar...
        document.getElementById(`btn-add-${m}`).onclick = () => { 
            const n = document.getElementById(`add-nome-${m}`).value, 
                  c = document.getElementById(`add-cat-${m}`).value, 
                  crd = document.getElementById(`add-card-${m}`).value, 
                  v = parseValor(document.getElementById(`add-val-${m}`).value); 
            if(!n || v <= 0) return; 
            if(!gastosDetalhes[anoView]) gastosDetalhes[anoView] = []; 
            gastosDetalhes[anoView].push({ mes: m, nome: n, valor: v, categoria: c, cartaoId: crd }); 
            salvarDadosLocal(); 
            renderPaginaGastos(); 
        };

        document.getElementById(`btn-add-parcela-${m}`).onclick = () => { 
            contextParcelaCartao = { mes: m, ano: Number(anoView) }; 
            document.getElementById("pcNome").value = document.getElementById(`add-nome-${m}`).value; 
            document.getElementById("pcValorTotal").value = document.getElementById(`add-val-${m}`).value; 
            const sCard = document.getElementById("pcCartao"); 
            sCard.innerHTML = cartoes.map(c => `<option value="${c.id}">${c.nome}</option>`).join(''); 
            sCard.value = document.getElementById(`add-card-${m}`).value; 
            const sCat = document.getElementById("pcCategoria"); 
            sCat.innerHTML = categorias.map(c => `<option value="${c.name}">${c.name}</option>`).join(''); 
            sCat.value = document.getElementById(`add-cat-${m}`).value; 
            document.getElementById("modalParcelaCartao").style.display = "flex"; 
        };
    }
}

document.getElementById("btnSalvarParcelaCartao").onclick = () => {
    const nome = document.getElementById("pcNome").value, cartaoId = document.getElementById("pcCartao").value, categoria = document.getElementById("pcCategoria").value, total = parseValor(document.getElementById("pcValorTotal").value), qtd = parseInt(document.getElementById("pcQtd").value), pId = Date.now();
    if(!nome || total <= 0 || qtd <= 0) return;
    const valP = Number((total / qtd).toFixed(2)); let mesC = contextParcelaCartao.mes, anoC = contextParcelaCartao.ano;
    for(let i = 1; i <= qtd; i++) { if(!gastosDetalhes[anoC]) gastosDetalhes[anoC] = []; gastosDetalhes[anoC].push({ mes: mesC, nome: `${nome} (${i}/${qtd})`, valor: valP, categoria: categoria, cartaoId: cartaoId, parcelaId: pId }); mesC++; if(mesC > 11) { mesC = 0; anoC++; } }
    document.getElementById("modalParcelaCartao").style.display = "none"; salvarDadosLocal(); renderPaginaGastos();
};

function renderPizza(mesIdx, gastos) {
    const div = document.querySelector(`#chart-pizza-${mesIdx}`); if (!div || gastos.length === 0) return;
    const tColor = getComputedStyle(document.body).getPropertyValue('--P02').trim() || '#000000';
    const res = {}; gastos.forEach(g => res[g.categoria] = (res[g.categoria] || 0) + g.valor);
    const options = { series: Object.values(res), labels: Object.keys(res), chart: { type: 'donut', height: 220, background: 'transparent' }, colors: Object.keys(res).map(n => (categorias.find(c => c.name === n)?.color || "#888")), legend: { position: 'bottom', labels: { colors: tColor } }, plotOptions: { pie: { donut: { labels: { show: true, name: { color: tColor }, value: { color: tColor } } } } } };
    div.innerHTML = ""; new ApexCharts(div, options).render();
}

function renderContasFixas() {
  const container = document.getElementById("listaContasFixas"); 
  if (!container) return; 
  
  // Criamos a estrutura da tabela
  container.innerHTML = `
    <table class="tabela-gastos">
      <thead>
        <tr>
          <th style="width: 1%;"></th>
          <th style="width: 1%;">ok</th>
          <th>Nome da Despesa</th>
          <th style="width: 80px;">Dia</th>
          <th style="width: 150px;">Valor</th>
          <th style="width: 150px;">Categoria</th>
          <th style="width: 150px;">Cartão</th>
          <th style="width: 1%;"></th>
        </tr>
      </thead>
      <tbody id="tbodyFixas"></tbody>
    </table>
  `;

  const tbody = document.getElementById("tbodyFixas");

  contasFixas.forEach((cf) => {
    const tr = document.createElement("tr"); 
    tr.setAttribute("data-id", cf.id);
    
    tr.innerHTML = `
      <td class="drag-handle" style="cursor:grab; text-align:center; opacity:0.5;">☰</td>
      <td><input type="checkbox" ${cf.ativo?'checked':''} class="check-fixo"></td>
      <td><input type="text" class="input-tabela-edit" value="${cf.nome}" placeholder="Nome"></td>
      <td><input type="number" class="input-tabela-edit" value="${cf.dia||1}" title="Dia"></td>
      <td><input type="text" class="input-tabela-edit valor-fixo" value="${formatar(cf.valor)}"></td>
      <td>
        <select class="input-tabela-edit cat-fixo">
            ${categorias.map(c=>`<option value="${c.name}" ${cf.categoria===c.name?'selected':''}>${c.name}</option>`).join('')}
        </select>
      </td>
      <td>
        <select class="input-tabela-edit card-fixo">
            <option value="">💳 S/ Card</option>
            ${cartoes.filter(c=>c.tipo==='Crédito').map(c=>`<option value="${c.id}" ${String(cf.cartaoId) === String(c.id) ? 'selected' : ''}>${c.nome}</option>`).join('')}
        </select>
      </td>
      <td><button class="removeItem">×</button></td>`;

    const [tdDrag, tdCheck, tdNome, tdDia, tdVal, tdCat, tdCard, tdBtn] = tr.children;

    tdCheck.querySelector("input").onchange = (e) => { cf.ativo = e.target.checked; salvarDadosLocal(); }; 
    tdNome.querySelector("input").onblur = (e) => { cf.nome = e.target.value; salvarDadosLocal(); };
    tdDia.querySelector("input").onblur = (e) => { cf.dia = parseInt(e.target.value) || 1; salvarDadosLocal(); };
    
    aplicarComportamentoInput(tdVal.querySelector("input"), () => cf.valor, (v) => { cf.valor = v; }); 
    
    tdCat.querySelector("select").onchange = (e) => { cf.categoria = e.target.value; salvarDadosLocal(); };
    tdCard.querySelector("select").onchange = (e) => { cf.cartaoId = e.target.value; salvarDadosLocal(); };

    tdBtn.querySelector("button").onclick = () => { 
        contasFixas = contasFixas.filter(c => c.id !== cf.id); 
        renderContasFixas(); 
        salvarDadosLocal(); 
    };
    
    tbody.appendChild(tr);
  });

  // Inicializa o arrastar e soltar no corpo da tabela
  if(typeof Sortable !== 'undefined') {
    Sortable.create(tbody, { 
        handle: '.drag-handle', 
        animation: 150, 
          onEnd: () => { 
                      const novoArrayOrdenado = []; 
                      tbody.querySelectorAll('tr').forEach(el => { 
                          const idNoHtml = el.getAttribute('data-id');
                          // Buscamos o item comparando como String para não haver erro de tipo
                          const itemEncontrado = contasFixas.find(x => String(x.id) === idNoHtml); 
                          if(itemEncontrado) novoArrayOrdenado.push(itemEncontrado); 
                      }); 
                      contasFixas = novoArrayOrdenado; 
                      salvarDadosLocal(); 

                      // IMPORTANTÍSSIMO: Recarregar o ano para refletir a nova ordem nos meses
                      const anoAtual = document.getElementById("ano").value;
                      carregarAno(); 
                  }
    });
  }
}

function renderReceitasFixas() {
  const lista = document.getElementById("listaReceitasFixas"); if (!lista) return;
  const iS = document.getElementById("salarioFixoBase"); 
  iS.value = formatar(salarioFixoBase);
  aplicarComportamentoInput(iS, () => salarioFixoBase, (v) => { salarioFixoBase = v; }); 
  
  lista.innerHTML = "";
  receitasFixas.forEach((rf) => {
    const div = document.createElement("div"); div.className = "item-fixo";
    // HTML simplificado: Checkbox, Nome, Valor e Botão Remover
    div.innerHTML = `<input type="checkbox" ${rf.ativo?'checked':''} class="check-rf"><input type="text" class="inputPadrao" value="${rf.nome}" placeholder="Nome da Renda" style="flex:2"><input type="text" class="inputPadrao valor-rf" value="${formatar(rf.valor)}" style="width:110px"><button class="removeItem">×</button>`;
    
    const [ch, inN, inV, btR] = div.children;
    ch.onchange = () => { rf.ativo = ch.checked; salvarDadosLocal(); }; 
    inN.onblur = () => { rf.nome = inN.value; salvarDadosLocal(); };
    aplicarComportamentoInput(inV, () => rf.valor, (v) => { rf.valor = v; }); 
    btR.onclick = () => { receitasFixas = receitasFixas.filter(r => r.id !== rf.id); renderReceitasFixas(); salvarDadosLocal(); }; 
    lista.appendChild(div);
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
        div.innerHTML = `<input type="text" class="inputPadrao" value="${c.nome}" style="flex:2"><select class="inputPadrao" style="width:100px"><option value="Crédito" ${c.tipo=='Crédito'?'selected':''}>Crédito</option><option value="Débito" ${c.tipo=='Débito'?'selected':''}>Débito</option></select><input type="number" class="inputPadrao" value="${c.vencimento}" style="width:60px"><button class="removeItem">×</button>`;
        const [iN, sT, iV, bR] = div.children;
        iN.onblur = (e) => { cartoes[index].nome = e.target.value; salvarDadosLocal(); }; sT.onchange = (e) => { cartoes[index].tipo = e.target.value; salvarDadosLocal(); }; iV.onblur = (e) => { cartoes[index].vencimento = e.target.value; salvarDadosLocal(); };
        bR.onclick = () => { cartoes.splice(index, 1); renderCartoesModal(); salvarDadosLocal(); }; lista.appendChild(div);
    });
}

onAuthStateChanged(auth, async (user) => {
  if (user) {
    usuarioLogado = user; document.getElementById("displayEmail").textContent = user.email;
    const snap = await getDoc(doc(db, "financas", user.uid));
    if (snap.exists()) {
        const res = await decryptData(snap.data(), senhaDoUsuario);
        dados = res.dados || {}; parcelasMemoria = res.parcelasMemoria || []; contasFixas = res.contasFixas || []; receitasFixas = res.receitasFixas || [];
        lembretes = res.lembretes || [];
        salarioFixoBase = res.salarioFixoBase || 0; categorias = migrarCategorias(res.categorias); configuracoes = res.configuracoes || configuracoes; cartoes = res.cartoes || []; gastosDetalhes = res.gastosDetalhes || {};
        aplicarParcelas();
    }
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
        
        carregarAno(); 
        renderContasFixas(); 
        renderReceitasFixas(); 
        renderLembretesHome(); // Adicionado aqui
        renderPaginaGastos();
        aplicarTema(configuracoes.tema);
        alert("Backup carregado com sucesso!");
    }; 
    r.readAsText(e.target.files[0]); 
};

// Função central de navegação
function roteador() {
    const hash = window.location.hash || "#resumo"; 

    const views = {
        "#resumo": "viewResumo",
        "#gastos": "viewGastos",
        "#calendario": "viewCalendario"
    };

    // Esconder todas e remover active
    Object.values(views).forEach(id => document.getElementById(id).style.display = "none");
    ["navResumo", "navGastos", "navCalendario"].forEach(id => document.getElementById(id).classList.remove("active"));

    // Mostrar atual
    const currentView = views[hash] || "viewResumo";
    document.getElementById(currentView).style.display = "block";
    
    // Marcar link como ativo
    if (hash === "#resumo") {
        document.getElementById("navResumo").classList.add("active");
        carregarAno();
    } else if (hash === "#gastos") {
        document.getElementById("navGastos").classList.add("active");
        renderPaginaGastos();
    } else if (hash === "#calendario") {
        document.getElementById("navCalendario").classList.add("active");
        renderCalendario({cartoes, contasFixas, receitasFixas, lembretes, configuracoes}, { abrirPostit });
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

document.getElementById("btnSalvarSenha").onclick = async () => { const a = document.getElementById("pwdAntiga").value, n = document.getElementById("pwdNova").value; if(!n) return; try { const cred = EmailAuthProvider.credential(usuarioLogado.email, a); await reauthenticateWithCredential(usuarioLogado, cred); await updatePassword(usuarioLogado, n); senhaDoUsuario = n; sessionStorage.setItem("temp_key", n); alert("Sucesso!"); } catch (e) { alert("Erro!"); } };
document.getElementById("loginBtn").onclick = async () => { const e = document.getElementById("email").value, s = document.getElementById("senha").value; try { await signInWithEmailAndPassword(auth, e, s); senhaDoUsuario = s; sessionStorage.setItem("temp_key", s); } catch (err) { alert("Erro login"); } };
document.getElementById("cadastroBtn").onclick = async () => { const e = document.getElementById("email").value, s = document.getElementById("senha").value; try { await createUserWithEmailAndPassword(auth, e, s); senhaDoUsuario = s; sessionStorage.setItem("temp_key", s); await salvarFirebase(); } catch (err) { alert("Erro cadastro"); } };
document.getElementById("logoutBtn").onclick = () => { signOut(auth); sessionStorage.clear(); location.reload(); };
document.getElementById("btnSettings").onclick = () => { const modalCfg = document.getElementById("modalConfiguracoes"); if(!modalCfg) return; document.getElementById("cfgNomeUsuario").value = configuracoes.nomeUsuario || ""; document.getElementById("cfgDiaVirada").value = configuracoes.diaVirada || 1; const ref = configuracoes.referenciaMes || "atual"; document.getElementById("refAtual").checked = (ref === "atual"); document.getElementById("refProximo").checked = (ref === "proximo"); modalCfg.style.display = "flex"; };
document.getElementById("btnSalvarConfig").onclick = async () => { configuracoes.nomeUsuario = document.getElementById("cfgNomeUsuario").value; configuracoes.diaVirada = document.getElementById("cfgDiaVirada").value;
configuracoes.diaSalario = document.getElementById("cfgDiaSalario").value; 
configuracoes.referenciaMes = document.querySelector('input[name="refMes"]:checked')?.value || "atual"; atualizarTituloSite(); await salvarFirebase(); document.getElementById("modalConfiguracoes").style.display = "none"; carregarAno(); renderPaginaGastos(); };
document.getElementById("btnFecharConfig").onclick = () => document.getElementById("modalConfiguracoes").style.display = "none";
document.getElementById("btnGerenciarCategorias").onclick = () => { document.getElementById("modalCategorias").style.display = "flex"; renderCategoriasModal(); };
document.getElementById("btnGerenciarCartoes").onclick = () => { document.getElementById("modalCartoes").style.display = "flex"; renderCartoesModal(); };
document.getElementById("btnFecharModal").onclick = () => { document.getElementById("modalCategorias").style.display = "none"; carregarAno(); renderContasFixas(); };
document.getElementById("btnFecharCartoes").onclick = () => document.getElementById("modalCartoes").style.display = "none";
document.getElementById("btnSalvarCartoes").onclick = async () => { await salvarFirebase(); document.getElementById("modalCartoes").style.display = "none"; carregarAno(); renderPaginaGastos(); };
document.getElementById("btnAddCartao").onclick = () => { cartoes.push({ id: Date.now(), nome: "", tipo: "Crédito", vencimento: 10 }); renderCartoesModal(); };
document.getElementById("btnAddContaFixa").onclick = () => { contasFixas.push({ id: Date.now(), nome: "", valor: 0, ativo: true, categoria: categorias[0].name }); renderContasFixas(); };
document.getElementById("btnAddReceitaFixa").onclick = () => { receitasFixas.push({ id: Date.now(), nome: "", valor: 0, ativo: true }); renderReceitasFixas(); };
document.getElementById("salvarNuvemBtn").onclick = salvarFirebase;
document.getElementById("headerContasFixas").onclick = () => document.getElementById("moduloContasFixas").classList.toggle("collapsed");
document.getElementById("headerReceitasFixas").onclick = () => document.getElementById("moduloReceitasFixas").classList.toggle("collapsed");
document.getElementById("showSignup").onclick = (e) => { e.preventDefault(); document.getElementById("loginActions").style.display = "none"; document.getElementById("signupActions").style.display = "block"; };
document.getElementById("showLogin").onclick = (e) => { e.preventDefault(); document.getElementById("signupActions").style.display = "none"; document.getElementById("loginActions").style.display = "block"; };
document.getElementById("btnFecharParcelaCartao").onclick = () => document.getElementById("modalParcelaCartao").style.display = "none";
document.getElementById("btnIrCalendario").onclick = () => window.location.hash = "#calendario";

function carregarAno() {
  const sel = document.getElementById("ano"); const ano = sel ? sel.value : hoje.getFullYear(); if (!dados[ano]) dados[ano] = { meses: [] };
  const area = document.getElementById("areaAno"); if(!area) return;
  area.innerHTML = ""; mesesDOM = [];
  const container = document.createElement("div"); area.appendChild(container);
  const addBox = document.createElement("div"); addBox.className = "addMesBox";
  const btnAdd = document.createElement("button"); btnAdd.innerText = "+ ADICIONAR MÊS";
  btnAdd.onclick = () => {
    let anoNum = Number(ano); if (!dados[anoNum]) dados[anoNum] = { meses: [] };
    const n = { despesas: [], empresa: [], salario: salarioFixoBase, conta: 0, contaManual: false };
    contasFixas.forEach(cf => { if (cf.ativo) n.despesas.push({ nome: cf.nome, valor: cf.valor || 0, checked: true, categoria: cf.categoria }); });
    receitasFixas.forEach(rf => { if (rf.ativo) n.empresa.push({ nome: rf.nome, valor: rf.valor || 0, checked: true }); });
    dados[anoNum].meses.push(n); carregarAno();
  };
  addBox.appendChild(btnAdd); area.prepend(addBox);
  
  // APLICAR PARCELAS ANTES DE RENDERIZAR
  aplicarParcelas();

  dados[ano].meses.forEach((m, i) => { const mDOM = criarMesDOM(ano, i, m); container.prepend(mDOM); mesesDOM.push({ dom: mDOM, index: i }); });
  atualizarTudo(ano);
}

const s1 = document.getElementById("ano"); const s2 = document.getElementById("anoGastos");
[s1, s2].forEach(s => { if(!s) return; for (let a = 2024; a <= 2035; a++) { const o = document.createElement("option"); o.value = a; o.text = a; if(a === hoje.getFullYear()) o.selected = true; s.appendChild(o); } s.onchange = () => { carregarAno(); renderPaginaGastos(); }; });
document.getElementById("btnSalvarLembrete").onclick = async () => {
    const l = { id: Date.now(), nome: document.getElementById("lemTitulo").value, data: document.getElementById("lemData").value, hora: document.getElementById("lemHora").value };
    lembretes.push(l);
    await salvarFirebase();
    renderLembretesHome();
    roteador();
    document.getElementById("modalLembrete").style.display = "none";
    if(document.getElementById("viewCalendario").style.display === "block") renderCalendario({cartoes, contasFixas, receitasFixas, lembretes, configuracoes}, { abrirPostit });
};


function abrirPostit(l) {
    const overlay = document.createElement("div"); 
    overlay.className = "modal-overlay"; 
    overlay.id = "popupPostit";
    overlay.innerHTML = `<div class="modal-content postit-amarelo" style="background:#f1c40f; color:#000; padding:20px; border-radius:5px; min-width:250px;"><h3 style="margin-top:0; border-bottom:1px solid rgba(0,0,0,0.1); padding-bottom:5px;">${l.nome}</h3><p style="margin: 10px 0 5px 0;"><strong>📅 Data:</strong> ${l.data}</p><p style="margin: 0 0 20px 0;"><strong>⏰ Hora:</strong> ${l.hora || 'Não definida'}</p><div style="display:flex; gap:10px;"><button class="btn sair" id="btnDelPostit" style="flex:1">Excluir</button><button class="btn" onclick="this.closest('.modal-overlay').remove()" style="flex:1; background:#333; color:#fff;">Fechar</button></div></div>`;
    document.body.appendChild(overlay);
    document.getElementById("btnDelPostit").onclick = async () => { 
        if(confirm("Excluir este lembrete?")) {
            lembretes = lembretes.filter(x => x.id !== l.id); 
            await salvarFirebase(); 
            renderCalendario({cartoes, contasFixas, receitasFixas, lembretes, configuracoes}, { abrirPostit }); 
            overlay.remove(); 
        }
    };
}