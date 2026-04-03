import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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
    const pacote = await encryptData({ dados, parcelasMemoria, contasFixas, receitasFixas, salarioFixoBase, categorias, configuracoes, cartoes, gastosDetalhes }, senhaDoUsuario);
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

      const dTotalManuais = (m.despesas || []).filter(x => x.checked).reduce((acc, b) => acc + b.valor, 0);
      const gastosMes = (gastosDetalhes[ano] || []).filter(g => g.mes === idx);
      
      const totalCartoesCredito = gastosMes.filter(g => {
          const cObj = cartoes.find(c => c.id == g.cartaoId);
          return cObj && cObj.tipo === 'Crédito';
      }).reduce((acc, g) => acc + g.valor, 0);

      const eTotal = (m.empresa || []).filter(x => x.checked).reduce((acc, b) => acc + b.valor, 0);
      const totalDisponivel = (m.salario || 0) + (m.conta || 0) + eTotal;
      const saldoFinal = totalDisponivel - (dTotalManuais + totalCartoesCredito);
      
      m.saldoCalculadoFinal = saldoFinal; 
      saldoAcumulado = saldoFinal; 
      ehOPrimeiroMesDeTodos = false;

      if (ano === Number(anoParaVisualizar)) {
        const info = mesesDOM.find(item => item.index === idx);
        if (info) {
          const dom = info.dom;
          const listaCartoesDiv = dom.querySelector(".listaCartoesDinamica");
          if (listaCartoesDiv) {
              listaCartoesDiv.innerHTML = "";
              const crdGastos = gastosMes.filter(g => cartoes.find(c => c.id == g.cartaoId)?.tipo === 'Crédito');
              if (crdGastos.length > 0) {
                  const totaisPorCartao = {};
                  crdGastos.forEach(g => { totaisPorCartao[g.cartaoId] = (totaisPorCartao[g.cartaoId] || 0) + g.valor; });
                  listaCartoesDiv.innerHTML = "<small style='display:block;margin-bottom:5px;opacity:0.6'>RESUMO DE CARTÕES (CRÉDITO):</small>";
                  Object.keys(totaisPorCartao).forEach(cid => {
                      const cObj = cartoes.find(c => c.id == cid);
                      const itemC = document.createElement("div"); 
                      itemC.className = "item-cartao-resumo";
                      itemC.style.cursor = "pointer"; // Mostra que é clicável
                      itemC.title = "Clique para ver detalhes deste cartão";
                      itemC.innerHTML = `<span>💳 ${cObj ? cObj.nome : 'Cartão'}</span> <span>${formatar(totaisPorCartao[cid])}</span>`;

                      // LÓGICA DE NAVEGAÇÃO AO CLICAR
                      itemC.onclick = () => {
                          // 1. Seta o ano na tela de gastos
                          document.getElementById("anoGastos").value = ano;
                          
                          // 2. Define o filtro específico para aquele mês e cartão
                          filtrosPorMes[idx] = cid;
                          
                          // 3. Garante que esse mês estará aberto
                          mesesGastosAbertos.add(idx);
                          
                          // 4. Muda para a aba de Gastos Detalhados (simula o clique no menu)
                          document.getElementById("navGastos").click();
                          
                          // 5. Scroll suave até o mês clicado (opcional)
                          setTimeout(() => {
                              const mesesCards = document.querySelectorAll("#areaGastosMensais .mes");
                              if(mesesCards[idx]) {
                                  mesesCards[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
                              }
                          }, 300);
                      };

                      listaCartoesDiv.appendChild(itemC);
                  });
              }
          }

          dom.querySelector(".totalDespesas").textContent = formatar(dTotalManuais + totalCartoesCredito);
          dom.querySelector(".totalDinheiro").textContent = formatar(totalDisponivel);
          const sEl = dom.querySelector(".saldo"); 
          sEl.textContent = formatar(saldoFinal);
          sEl.className = "saldo " + (saldoFinal >= 0 ? "positivo" : "negativo");
          dom.querySelector(".mesTotal").textContent = formatar(saldoFinal);
          
          const inS = dom.querySelector("input.salario"); 
          const inC = dom.querySelector("input.conta");
          if (document.activeElement !== inS) inS.value = formatar(m.salario);
          if (document.activeElement !== inC) {
            inC.value = formatar(m.conta);
            if (m.contaManual === true) inC.classList.add("manual"); else inC.classList.remove("manual");
          }
          if (ano === anoAt && idx === mesAt) dom.classList.add("mesAtual"); else dom.classList.remove("mesAtual");
        }
      }
    });
  });

  salvarDadosLocal(pendente);
  atualizarGrafico(Number(anoParaVisualizar));
}

function atualizarGrafico(ano) {
    const ctx = document.getElementById("grafico"); 
    if (!ctx || !dados[ano] || !dados[ano].meses || dados[ano].meses.length === 0) return;

    // Pegamos a cor clara do tema para os textos (P01) e a cor de destaque para as barras (P04)
    const tColor = getComputedStyle(document.body).getPropertyValue('--P02').trim() || '#000000';
    const pColor = getComputedStyle(document.body).getPropertyValue('--P04').trim() || '#D78341';
    const bgColor = getComputedStyle(document.body).getPropertyValue('--P06').trim() || '#ffffff';

    const saldos = dados[ano].meses.map(m => parseFloat((m.saldoCalculadoFinal || 0).toFixed(2)));
    const labels = dados[ano].meses.map((_, i) => nomesMesesFull[i]);

    const options = { 
        series: [{ name: 'Saldo Final', data: saldos }], 
        chart: { 
            type: 'bar', 
            height: 250, 
            toolbar: { show: false },
            background: bgColor,
            foreColor: tColor
        }, 
        colors: [pColor], 
        xaxis: { categories: labels, labels: { style: { colors: tColor } } }, 
        yaxis: { labels: { style: { colors: tColor }, formatter: (val) => "R$ " + val.toLocaleString('pt-BR') } }, 
        grid: { borderColor: 'rgba(255,255,255,0.1)' },
        tooltip: { theme: 'dark', y: { formatter: (val) => formatar(val) } },
        dataLabels: {
            enabled: true,
            formatter: (val) => "R$ " + val.toLocaleString('pt-BR'),
            style: { fontSize: '10px', colors: [tColor] },
            offsetY: -20
        },
        plotOptions: { bar: { dataLabels: { position: 'top' }, borderRadius: 4 } },
        legend: { labels: { colors: tColor } } 
    };

    if (chartResumo) chartResumo.destroy();
    chartResumo = new ApexCharts(ctx, options); 
    chartResumo.render();
}

// ================= INTERFACE RESUMO =================
function criarItem(lista, d, dataArray, ano) {
  const div = document.createElement("div"); div.className = "item";
  div.innerHTML = `<input type="checkbox" ${d.checked?'checked':''}> <input class="nome inputPadrao" value="${d.nome}"> <input class="valor inputPadrao" value="${formatar(d.valor)}"> <button class="removeItem">×</button>`;
  const [check, nome, valor, btn] = div.children;
  check.onchange = () => { d.checked = check.checked; atualizarTudo(ano); };
  nome.onblur = () => { d.nome = nome.value; salvarDadosLocal(true); };
  aplicarComportamentoInput(valor, () => d.valor, (v) => { d.valor = v; atualizarTudo(ano); }, ano);
  btn.onclick = () => {
      if(d.parcelaId) {
          if(confirm("Deseja apagar TODAS as parcelas desta compra?")) {
              parcelasMemoria = parcelasMemoria.filter(p => p.id !== d.parcelaId);
              Object.keys(dados).forEach(a => { dados[a].meses.forEach(m => { m.despesas = m.despesas.filter(item => item.parcelaId !== d.parcelaId); }); });
              carregarAno();
          }
      } else { dataArray.splice(dataArray.indexOf(d), 1); carregarAno(); }
  };
  lista.appendChild(div);
}

function criarMesDOM(ano, index, data) {
  const mes = document.createElement("div"); mes.className = mesesAbertos.has(index) ? "mes" : "mes collapsed";
  const header = document.createElement("div"); header.className = "mesHeader";
  header.innerHTML = `<span>${nomesMesesFull[index]} ${ano}</span><div><span class="mesTotal">0,00</span><button class="duplicarMes" title="Duplicar">📑</button><button class="removeMes">×</button></div>`;
  header.onclick = () => { mes.classList.toggle("collapsed"); if(mes.classList.contains("collapsed")) mesesAbertos.delete(index); else mesesAbertos.add(index); };
  header.querySelector(".duplicarMes").onclick = (e) => { e.stopPropagation(); dados[ano].meses.splice(index + 1, 0, JSON.parse(JSON.stringify(data))); carregarAno(); };
  header.querySelector(".removeMes").onclick = (e) => { e.stopPropagation(); if(confirm("Excluir mês?")) { dados[ano].meses.splice(index, 1); carregarAno(); } };
  const body = document.createElement("div"); body.className = "mesBody";
  body.innerHTML = `<div class="container"><div class="coluna despesas"><div class="topoColuna"><h4>DESPESAS</h4></div><div class="conteudoColuna"><div class="listaDesp"></div><div class="acoesDesp" style="display:flex; gap:5px; margin-top:10px;"><button class="addDesp btn" style="font-size:11px; padding:5px 10px;">+ Despesa</button><button class="addParcela btn" style="font-size:11px; padding:5px 10px;">+ Parcela</button></div><div class="listaCartoesDinamica"></div></div><p class="rodapeColuna">Total: <span class="totalDespesas">0,00</span></p></div><div class="coluna dinheiro"><div class="topoColuna"><h4>RENDAS</h4></div><div class="conteudoColuna"><div class="linhaInputs"><div class="campo"><label>Salário</label><input type="text" class="salario inputPadrao"></div><div class="campo"><label>Conta</label><input type="text" class="conta inputPadrao"></div><button class="btn-cascata" title="Vincular meses seguintes">🔗</button></div><h5>OUTROS</h5><div class="listaEmp"></div><button class="addEmp btn" style="height:35px; cursor:pointer; width:100%; margin-top:10px;">+</button></div><p class="rodapeColuna">Total: <span class="totalDinheiro">0,00</span></p></div></div><div class="totalFinal">TOTAL: <span class="saldo">0,00</span></div>`;
  const listD = body.querySelector(".listaDesp"); const listE = body.querySelector(".listaEmp");
  data.despesas.forEach(item => criarItem(listD, item, data.despesas, ano)); (data.empresa || []).forEach(item => criarItem(listE, item, data.empresa, ano));
  const inSal = body.querySelector("input.salario"); const inCon = body.querySelector("input.conta"); const btnC = body.querySelector(".btn-cascata");
  inSal.value = formatar(data.salario || 0); inCon.value = formatar(data.conta || 0);
  aplicarComportamentoInput(inSal, () => data.salario, (v) => { data.salario = v; atualizarTudo(ano); }, ano);
  inCon.addEventListener("blur", () => { const txt = inCon.value.trim(); if (txt === "") data.contaManual = false; else { data.conta = parseValor(txt); data.contaManual = true; } atualizarTudo(ano); });
  inCon.addEventListener("keydown", (e) => { if(e.key === "Enter") inCon.blur(); });
  btnC.onclick = () => { const anosOrdenados = Object.keys(dados).map(Number).sort((a,b)=>a-b); let found = false; anosOrdenados.forEach(a => dados[a].meses.forEach((m, i) => { if(a == ano && i == index) found = true; else if(found) m.contaManual = false; })); atualizarTudo(ano); };
  body.querySelector(".addDesp").onclick = () => { data.despesas.push({nome:"", valor:0, checked:true}); carregarAno(); };
  body.querySelector(".addParcela").onclick = () => { const n = prompt("Nome:"); const vt = parseValor(prompt("Valor TOTAL:")); const np = parseInt(prompt("Parcelas:")); if(n && vt > 0 && np > 0) { parcelasMemoria.push({ id: Date.now(), nome: n, valorParcela: Number((vt / np).toFixed(2)), parcelas: np, inicio: index, ano: Number(ano) }); carregarAno(); } };
  body.querySelector(".addEmp").onclick = () => { if(!data.empresa) data.empresa=[]; data.empresa.push({nome:"", valor:0, checked:true}); carregarAno(); };
  mes.appendChild(header); mes.appendChild(body); return mes;
}

// ================= GESTÃO DE GASTOS DETALHADOS =================

function renderPaginaGastos() {
    const area = document.getElementById("areaGastosMensais"); const anoView = document.getElementById("anoGastos").value; const { mesAt, anoAt } = getMesReferenciaAtivo();
    area.innerHTML = "";
    for (let m = 0; m < 12; m++) {
        const mesBox = document.createElement("div"); const isMesAtual = (m === mesAt && Number(anoView) === anoAt); const isOpen = mesesGastosAbertos.has(m) || isMesAtual;
        mesBox.className = "mes " + (isOpen ? "" : "collapsed") + (isMesAtual ? " mesAtual" : "");
        let gastosMes = (gastosDetalhes[anoView] || []).filter(g => g.mes === m); const filtroAtual = filtrosPorMes[m] || "todos";
        if(filtroAtual !== "todos") gastosMes = gastosMes.filter(g => g.cartaoId == filtroAtual);
        const tCr = gastosMes.filter(g => cartoes.find(c => c.id == g.cartaoId)?.tipo === 'Crédito').reduce((a,b) => a + b.valor, 0);
        const tDb = gastosMes.filter(g => cartoes.find(c => c.id == g.cartaoId)?.tipo === 'Débito').reduce((a,b) => a + b.valor, 0);
        mesBox.innerHTML = `<div class="mesHeader"><span>${nomesMesesFull[m]} ${anoView}</span><span>${formatar(tCr + tDb)}</span></div><div class="mesBody"><div class="filtro-interno" style="color: var('--P02'); margin-bottom: 15px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 10px; display:flex; align-items:center; gap:10px;"><span style="font-size:12px; opacity:0.8">Exibir cartão:</span><select class="inputPadrao sel-filtro-mes" style="width:auto; height:30px; font-size:12px;"><option value="todos">Todos</option>${cartoes.map(c => `<option value="${c.id}" ${filtroAtual == c.id ? 'selected' : ''}>${c.nome}</option>`).join('')}</select></div><div id="chart-pizza-${m}" style="display:flex; justify-content:center; margin: 15px 0;"></div><table class="tabela-gastos"><thead><tr><th>Gasto</th><th>Categoria</th><th>Cartão</th><th>Valor</th><th></th></tr></thead><tbody id="tbody-gastos-${m}"></tbody><tfoot><tr><td><input type="text" placeholder="Gasto..." id="add-nome-${m}" class="inputPadrao"></td><td><select id="add-cat-${m}" class="inputPadrao">${categorias.map(c => `<option value="${c.name}">${c.name}</option>`).join('')}</select></td><td><select id="add-card-${m}" class="inputPadrao">${cartoes.map(c => `<option value="${c.id}">${c.nome}</option>`).join('')}</select></td><td><input type="text" placeholder="0,00" id="add-val-${m}" class="inputPadrao input-valor-add"></td><td><div style="display:flex; gap:5px"><button class="btn" id="btn-add-${m}">+</button><button class="btn" style="background:#8e44ad" id="btn-add-parcela-${m}">🗓️</button></div></td></tr></tfoot></table><div class="resumo-gastos-inferior"><div class="barra-resumo credito">Crédito <span>${formatar(tCr)}</span></div><div class="barra-resumo debito">Débito <span>${formatar(tDb)}</span></div><div class="barra-resumo total">TOTAL <span>${formatar(tCr + tDb)}</span></div></div></div>`;
        mesBox.querySelector(".mesHeader").onclick = () => { mesBox.classList.toggle("collapsed"); if(mesBox.classList.contains("collapsed")) mesesGastosAbertos.delete(m); else { mesesGastosAbertos.add(m); renderPizza(m, gastosMes); } };
        const selF = mesBox.querySelector(".sel-filtro-mes"); selF.onclick = (e) => e.stopPropagation(); selF.onchange = (e) => { filtrosPorMes[m] = e.target.value; renderPaginaGastos(); };
        area.appendChild(mesBox); if(isOpen) setTimeout(() => renderPizza(m, gastosMes), 50);
        const tbody = document.getElementById(`tbody-gastos-${m}`);
        gastosMes.forEach((g, idx) => {
            const tr = document.createElement("tr"); const catI = categorias.find(c => c.name === g.categoria) || {color: "#888"};
            tr.innerHTML = `<td><input type="text" class="input-tabela-edit" value="${g.nome}" data-key="nome"></td><td><select class="input-tabela-edit" data-key="categoria" style="border-left: 5px solid ${catI.color}">${categorias.map(c => `<option value="${c.name}" ${g.categoria === c.name ? 'selected' : ''}>${c.name}</option>`).join('')}</select></td><td><select class="input-tabela-edit" data-key="cartaoId">${cartoes.map(c => `<option value="${c.id}" ${g.cartaoId == c.id ? 'selected' : ''}>${c.nome}</option>`).join('')}</select></td><td><input type="text" class="input-tabela-edit" value="${formatar(g.valor)}" data-key="valor"></td><td><button class="removeItem" id="rem-${m}-${idx}">×</button></td>`;
            tr.querySelectorAll('.input-tabela-edit').forEach(input => { input.onblur = (e) => { const key = input.getAttribute('data-key'); let val = e.target.value; if(key === 'valor') val = parseValor(val); g[key] = val; salvarDadosLocal(); renderPaginaGastos(); }; if(input.tagName === 'INPUT') input.onkeydown = (e) => { if(e.key === 'Enter') input.blur(); }; });
            tr.querySelector(".removeItem").onclick = () => { if(g.parcelaId) { if(confirm("Apagar todas as parcelas?")) { Object.keys(gastosDetalhes).forEach(ano => { gastosDetalhes[ano] = gastosDetalhes[ano].filter(item => item.parcelaId !== g.parcelaId); }); salvarDadosLocal(); renderPaginaGastos(); } } else { gastosDetalhes[anoView] = gastosDetalhes[anoView].filter(item => item !== g); salvarDadosLocal(); renderPaginaGastos(); } };
            tbody.appendChild(tr);
        });
        document.getElementById(`add-val-${m}`).onkeydown = (e) => { if(e.key === 'Enter') document.getElementById(`btn-add-${m}`).click(); };
        document.getElementById(`btn-add-${m}`).onclick = () => { const n = document.getElementById(`add-nome-${m}`).value, c = document.getElementById(`add-cat-${m}`).value, crd = document.getElementById(`add-card-${m}`).value, v = parseValor(document.getElementById(`add-val-${m}`).value); if(!n || v <= 0) return; if(!gastosDetalhes[anoView]) gastosDetalhes[anoView] = []; gastosDetalhes[anoView].push({ mes: m, nome: n, valor: v, categoria: c, cartaoId: crd }); salvarDadosLocal(); renderPaginaGastos(); };
        document.getElementById(`btn-add-parcela-${m}`).onclick = () => { contextParcelaCartao = { mes: m, ano: Number(anoView) }; document.getElementById("pcNome").value = document.getElementById(`add-nome-${m}`).value; document.getElementById("pcValorTotal").value = document.getElementById(`add-val-${m}`).value; const sCard = document.getElementById("pcCartao"); sCard.innerHTML = cartoes.map(c => `<option value="${c.id}">${c.nome}</option>`).join(''); sCard.value = document.getElementById(`add-card-${m}`).value; const sCat = document.getElementById("pcCategoria"); sCat.innerHTML = categorias.map(c => `<option value="${c.name}">${c.name}</option>`).join(''); sCat.value = document.getElementById(`add-cat-${m}`).value; document.getElementById("modalParcelaCartao").style.display = "flex"; };
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
    const div = document.querySelector(`#chart-pizza-${mesIdx}`);
    if (!div || gastos.length === 0) return;

    // 1. Captura a cor do texto do tema (P08 ou P05 dependendo da sua preferência)
    const tColor = getComputedStyle(document.body).getPropertyValue('--P05').trim() || '#000000';

    const res = {};
    gastos.forEach(g => res[g.categoria] = (res[g.categoria] || 0) + g.valor);

    const options = {
        series: Object.values(res),
        labels: Object.keys(res),
        chart: { 
            type: 'donut', 
            height: 220,
            background: 'transparent' // Mantém o fundo seguindo o card
        },
        // 2. Ajusta as cores das fatias usando as cores das categorias que você já tem
        colors: Object.keys(res).map(n => (categorias.find(c => c.name === n)?.color || "#fff")),
        
        // 3. AJUSTE DA LEGENDA (Nomes abaixo do gráfico)
        legend: { 
            position: 'bottom', 
            labels: { 
                colors: ['#fff'] // <--- COR DO TEXTO DA LEGENDA
            } 
        },

        // 4. AJUSTE DOS NÚMEROS DENTRO OU SOBRE O GRÁFICO
        dataLabels: {
            style: {
                colors: ['#fff'] // Geralmente branco fica melhor dentro das cores, mas você pode usar tColor
            }
        },

        // 5. AJUSTE DO TEXTO NO CENTRO (Caso use Donut com labels centrais)
        plotOptions: {
            pie: {
                donut: {
                    labels: {
                        show: true,
                        name: { color: tColor },
                        value: { color: tColor },
                        total: { 
                            show: true, 
                            color: tColor,
                            formatter: function (w) {
                                const total = w.globals.seriesTotals.reduce((a, b) => a + b, 0);
                                return formatar(total);
                            }
                        }
                    }
                }
            }
        }
    };

    div.innerHTML = "";
    new ApexCharts(div, options).render();
}

function renderContasFixas() {
  const lista = document.getElementById("listaContasFixas"); if (!lista) return; lista.innerHTML = "";
  contasFixas.forEach((cf) => {
    const div = document.createElement("div"); div.className = "item-fixo"; div.setAttribute("data-id", cf.id);
    div.innerHTML = `<div class="drag-handle">☰</div><input type="checkbox" ${cf.ativo?'checked':''} class="check-fixo"><input type="text" class="inputPadrao" value="${cf.nome}" placeholder="Nome" style="flex:2"><input type="text" class="inputPadrao valor-fixo" value="${formatar(cf.valor)}" style="width:110px"><select class="inputPadrao cat-fixo">${categorias.map(c=>`<option value="${c.name}" ${cf.categoria===c.name?'selected':''}>${c.name}</option>`).join('')}</select><button class="removeItem">×</button>`;
    const [dr, ch, inN, inV, seC, btR] = div.children;
    ch.onchange = () => { cf.ativo = ch.checked; salvarDadosLocal(); }; inN.onblur = () => { cf.nome = inN.value; salvarDadosLocal(); };
    aplicarComportamentoInput(inV, () => cf.valor, (v) => { cf.valor = v; }); seC.onchange = () => { cf.categoria = seC.value; salvarDadosLocal(); };
    btR.onclick = () => { contasFixas = contasFixas.filter(c => c.id !== cf.id); renderContasFixas(); salvarDadosLocal(); }; lista.appendChild(div);
  });
  if(typeof Sortable !== 'undefined') Sortable.create(lista, { handle: '.drag-handle', animation: 150, onEnd: () => { const n = []; lista.querySelectorAll('.item-fixo').forEach(el => { const f = contasFixas.find(x => x.id == el.getAttribute('data-id')); if(f) n.push(f); }); contasFixas = n; salvarDadosLocal(); } });
}

function renderReceitasFixas() {
  const lista = document.getElementById("listaReceitasFixas"); if (!lista) return;
  const iS = document.getElementById("salarioFixoBase"); iS.value = formatar(salarioFixoBase);
  aplicarComportamentoInput(iS, () => salarioFixoBase, (v) => { salarioFixoBase = v; }); lista.innerHTML = "";
  receitasFixas.forEach((rf) => {
    const div = document.createElement("div"); div.className = "item-fixo";
    div.innerHTML = `<input type="checkbox" ${rf.ativo?'checked':''} class="check-rf"><input type="text" class="inputPadrao" value="${rf.nome}" style="flex:2"><input type="text" class="inputPadrao valor-rf" value="${formatar(rf.valor)}" style="width:110px"><button class="removeItem">×</button>`;
    const [ch, inN, inV, btR] = div.children;
    ch.onchange = () => { rf.ativo = ch.checked; salvarDadosLocal(); }; inN.onblur = () => { rf.nome = inN.value; salvarDadosLocal(); };
    aplicarComportamentoInput(inV, () => rf.valor, (v) => { rf.valor = v; }); btR.onclick = () => { receitasFixas = receitasFixas.filter(r => r.id !== rf.id); renderReceitasFixas(); salvarDadosLocal(); }; lista.appendChild(div);
  });
}

function renderCategoriasModal() {
    const lista = document.getElementById("listaCategoriasModal"); lista.innerHTML = "";
    categorias.forEach((cat, index) => {
      const li = document.createElement("li"); li.style.display = "flex"; li.style.gap = "10px"; li.style.padding = "8px 0"; li.style.alignItems = "center";
      li.innerHTML = `<input type="color" class="seletor-cor-quadrado" value="${cat.color}" style="width:30px; height:30px;"><input type="text" class="inputPadrao cat-name-edit" value="${cat.name}" style="flex:2"><button class="removeItem" style="width:22px;height:22px">×</button>`;
      const [col, nam, btR] = li.children;
      col.onchange = (e) => { categorias[index].color = e.target.value; salvarDadosLocal(); }; nam.onblur = (e) => { categorias[index].name = e.target.value; salvarDadosLocal(); };
      nam.onkeydown = (e) => { if(e.key === 'Enter') nam.blur(); }; btR.onclick = () => { categorias.splice(index, 1); renderCategoriasModal(); salvarDadosLocal(); }; lista.appendChild(li);
    });
}

function renderCartoesModal() {
    const lista = document.getElementById("listaCartoesModal"); lista.innerHTML = "";
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
        salarioFixoBase = res.salarioFixoBase || 0; categorias = migrarCategorias(res.categorias); configuracoes = res.configuracoes || configuracoes; cartoes = res.cartoes || []; gastosDetalhes = res.gastosDetalhes || {};
    }
    aplicarTema(configuracoes.tema);
    document.getElementById("authContainer").style.display = "none"; document.getElementById("appContainer").style.display = "block";
    const { mesAt } = getMesReferenciaAtivo(); mesesAbertos.add(mesAt); carregarAno(); renderContasFixas(); renderReceitasFixas();
    const seletorTemaFooter = document.getElementById("cfgTemaFooter");
    if(seletorTemaFooter) seletorTemaFooter.value = configuracoes.tema || "planetario";
  } else { document.getElementById("authContainer").style.display = "flex"; document.getElementById("appContainer").style.display = "none"; }
});

// EVENT LISTENERS
const seletorTemaFooter = document.getElementById("cfgTemaFooter");
if(seletorTemaFooter) {
    seletorTemaFooter.onchange = async () => {
        configuracoes.tema = seletorTemaFooter.value;
        aplicarTema(configuracoes.tema);
        const anoAtual = document.getElementById("ano").value;
        atualizarTudo(anoAtual);
        await salvarFirebase();
    };
}

document.getElementById("exportarTudoBtn").onclick = () => { const b = { dados, parcelasMemoria, contasFixas, receitasFixas, salarioFixoBase, categorias, configuracoes, cartoes, gastosDetalhes }; const blob = new Blob([JSON.stringify(b, null, 2)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `backup.json`; a.click(); };
document.getElementById("inputImport").onchange = (e) => { const r = new FileReader(); r.onload = (ev) => { const res = JSON.parse(ev.target.result); dados = res.dados || {}; parcelasMemoria = res.parcelasMemoria || []; contasFixas = res.contasFixas || []; receitasFixas = res.receitasFixas || []; salarioFixoBase = res.salarioFixoBase || 0; categorias = migrarCategorias(res.categorias); configuracoes = res.configuracoes || configuracoes; cartoes = res.cartoes || []; gastosDetalhes = res.gastosDetalhes || {}; carregarAno(); renderContasFixas(); renderReceitasFixas(); }; r.readAsText(e.target.files[0]); };
document.getElementById("btnSalvarSenha").onclick = async () => { const a = document.getElementById("pwdAntiga").value, n = document.getElementById("pwdNova").value; if(!n) return; try { const cred = EmailAuthProvider.credential(usuarioLogado.email, a); await reauthenticateWithCredential(usuarioLogado, cred); await updatePassword(usuarioLogado, n); senhaDoUsuario = n; sessionStorage.setItem("temp_key", n); alert("Sucesso!"); } catch (e) { alert("Erro!"); } };
document.getElementById("loginBtn").onclick = async () => { const e = document.getElementById("email").value, s = document.getElementById("senha").value; try { await signInWithEmailAndPassword(auth, e, s); senhaDoUsuario = s; sessionStorage.setItem("temp_key", s); } catch (err) { alert("Erro!"); } };
document.getElementById("cadastroBtn").onclick = async () => { const e = document.getElementById("email").value, s = document.getElementById("senha").value; try { await createUserWithEmailAndPassword(auth, e, s); senhaDoUsuario = s; sessionStorage.setItem("temp_key", s); await salvarFirebase(); } catch (err) { alert("Erro!"); } };
document.getElementById("logoutBtn").onclick = () => { signOut(auth); sessionStorage.clear(); location.reload(); };
document.getElementById("navResumo").onclick = (e) => { e.preventDefault(); document.getElementById("viewResumo").style.display = "block"; document.getElementById("viewGastos").style.display = "none"; document.getElementById("navResumo").className = "active"; document.getElementById("navGastos").className = ""; carregarAno(); };
document.getElementById("navGastos").onclick = (e) => { e.preventDefault(); document.getElementById("viewResumo").style.display = "none"; document.getElementById("viewGastos").style.display = "block"; document.getElementById("navResumo").className = ""; document.getElementById("navGastos").className = "active"; renderPaginaGastos(); };
document.getElementById("btnSettings").onclick = () => { 
    const modalCfg = document.getElementById("modalConfiguracoes");
    if(!modalCfg) return;
    document.getElementById("cfgNomeUsuario").value = configuracoes.nomeUsuario || ""; 
    document.getElementById("cfgDiaVirada").value = configuracoes.diaVirada || 1; 
    const ref = configuracoes.referenciaMes || "atual"; 
    document.getElementById("refAtual").checked = (ref === "atual");
    document.getElementById("refProximo").checked = (ref === "proximo");
    modalCfg.style.display = "flex"; 
};
document.getElementById("btnSalvarConfig").onclick = async () => { 
    configuracoes.nomeUsuario = document.getElementById("cfgNomeUsuario").value; 
    configuracoes.diaVirada = document.getElementById("cfgDiaVirada").value; 
    configuracoes.referenciaMes = document.querySelector('input[name="refMes"]:checked')?.value || "atual"; 
    await salvarFirebase(); document.getElementById("modalConfiguracoes").style.display = "none"; carregarAno(); renderPaginaGastos();
};
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
  dados[ano].meses.forEach((m, i) => { const mDOM = criarMesDOM(ano, i, m); container.prepend(mDOM); mesesDOM.push({ dom: mDOM, index: i }); });
  atualizarTudo(ano);
}

const s1 = document.getElementById("ano"); const s2 = document.getElementById("anoGastos");
[s1, s2].forEach(s => { if(!s) return; for (let a = 2024; a <= 2035; a++) { const o = document.createElement("option"); o.value = a; o.text = a; if(a === hoje.getFullYear()) o.selected = true; s.appendChild(o); } s.onchange = () => { carregarAno(); renderPaginaGastos(); }; });