// ================= CONFIGURAÇÃO FIREBASE =================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { 
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, 
  onAuthStateChanged, signOut 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
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
let senhaDoUsuario = ""; 
let dados = {};
let parcelasMemoria = [];
let mesesDOM = [];
let chart = null;
const hoje = new Date();

const nomesMesesFull = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const seletorAno = document.getElementById("ano");
const areaAno = document.getElementById("areaAno");

// ================= CRIPTOGRAFIA =================
const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function encryptData(obj, senha) {
  const dadosBytes = encoder.encode(JSON.stringify(obj));
  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(senha), "PBKDF2", false, ["deriveKey"]);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" },
    keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, dadosBytes);
  return {
    encrypted: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
    iv: btoa(String.fromCharCode(...iv)),
    salt: btoa(String.fromCharCode(...salt))
  };
}

async function decryptData(encryptedObj, senha) {
  try {
    const iv = Uint8Array.from(atob(encryptedObj.iv), c => c.charCodeAt(0));
    const salt = Uint8Array.from(atob(encryptedObj.salt), c => c.charCodeAt(0));
    const data = Uint8Array.from(atob(encryptedObj.encrypted), c => c.charCodeAt(0));
    const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(senha), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" },
      keyMaterial, { name: "AES-GCM", length: 256 }, false, ["decrypt"]
    );
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    return JSON.parse(decoder.decode(decrypted));
  } catch (e) { throw new Error("Senha incorreta."); }
}

// ================= FIREBASE =================
async function salvarFirebase() {
  if (!usuarioLogado || !senhaDoUsuario) return;
  try {
    const btn = document.getElementById("salvarNuvemBtn");
    btn.innerText = "⌛ SALVANDO...";
    const pacote = await encryptData({ dados, parcelasMemoria }, senhaDoUsuario);
    await setDoc(doc(db, "financas", usuarioLogado.uid), pacote);
    btn.innerText = "✅ SALVO NA NUVEM";
    setTimeout(() => btn.innerText = "☁️ SALVAR NA NUVEM", 2000);
  } catch (e) { console.error("Erro ao salvar!"); }
}

async function carregarFirebase(senha) {
  if (!usuarioLogado) return;
  try {
    const snap = await getDoc(doc(db, "financas", usuarioLogado.uid));
    if (snap.exists() && snap.data().encrypted) {
      const res = await decryptData(snap.data(), senha);
      dados = res.dados || {};
      parcelasMemoria = res.parcelasMemoria || [];
      localStorage.setItem("financas", JSON.stringify(dados));
    }
  } catch (e) { alert("Erro de descriptografia."); }
  carregarAno();
}

// ================= IMPORT / EXPORT =================
window.exportarTudo = function() {
  const blob = new Blob([JSON.stringify({ dados, parcelasMemoria }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `backup_financas.json`;
  a.click();
};

window.importarDados = function(e) {
  const arquivo = e.target.files[0];
  if (!arquivo) return;
  const leitor = new FileReader();
  leitor.onload = async (event) => {
    try {
      const json = JSON.parse(event.target.result);
      if (json.dados) {
        dados = json.dados;
        parcelasMemoria = json.parcelasMemoria || [];
      } else if (json.meses) {
          const anoAlvo = seletorAno.value;
          dados[anoAlvo] = { meses: json.meses };
      }
      salvarDadosLocal();
      carregarAno();
      alert("Importado com sucesso! Clique em SALVAR NA NUVEM.");
    } catch (err) { alert("Erro ao ler JSON."); }
  };
  leitor.readAsText(arquivo);
};

// ================= AUTH =================
window.loginFirebase = async function(email, senha) {
  try {
    const cred = await signInWithEmailAndPassword(auth, email, senha);
    usuarioLogado = cred.user;
    senhaDoUsuario = senha;
    await carregarFirebase(senha);
  } catch (e) { alert("Erro no login."); }
};

window.cadastrarFirebase = async function(email, senha) {
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, senha);
    usuarioLogado = cred.user;
    senhaDoUsuario = senha;
    dados = {}; parcelasMemoria = [];
    await salvarFirebase();
    carregarAno();
  } catch (e) { alert("Erro no cadastro."); }
};

window.logoutFirebase = async function() {
  await signOut(auth);
  usuarioLogado = null; senhaDoUsuario = ""; dados = {}; parcelasMemoria = [];
  localStorage.clear();
  location.reload();
};

// ================= LÓGICA DE DADOS =================
function salvarDadosLocal() {
  localStorage.setItem("financas", JSON.stringify(dados));
}

function aplicarParcelas() {
  parcelasMemoria.forEach(p => {
    if (!dados[p.ano]) return;
    const meses = dados[p.ano].meses;
    for (let i = 0; i < p.parcelas; i++) {
      const idx = p.inicio + i;
      if (!meses[idx]) continue;
      const nomeP = `${p.nome} [${i+1}/${p.parcelas}]`;
      if (!meses[idx].despesas.some(d => d.nome === nomeP)) {
        meses[idx].despesas.push({ nome: nomeP, valor: p.valorParcela, checked: true, parcelaId: p.id });
      }
    }
  });
}

function carregarAno() {
  const ano = seletorAno.value;
  if (!dados[ano]) dados[ano] = { meses: [] };
  areaAno.innerHTML = "";
  mesesDOM = [];
  
  const addBox = document.createElement("div"); 
  addBox.className = "addMesBox";
  const btnAdd = document.createElement("button"); 
  
  // LOGICA DO BOTÃO MUDAR PARA NOVO ANO
  const isYearFull = dados[ano].meses.length >= 12;
  btnAdd.innerText = isYearFull ? "COMEÇAR NOVO ANO" : "+ ADICIONAR MÊS";
  
  btnAdd.onclick = () => adicionarMes(ano);
  addBox.appendChild(btnAdd); 
  areaAno.appendChild(addBox);
  
  const container = document.createElement("div"); 
  areaAno.appendChild(container);
  
  const meses = dados[ano].meses;
  for (let i = meses.length - 1; i >= 0; i--) {
    const mDOM = criarMesDOM(ano, i, meses[i]);
    container.appendChild(mDOM); 
    mesesDOM.push({ dom: mDOM, index: i });
  }
  atualizarTudo(ano);
}

function adicionarMes(ano) {
  let anoAtual = Number(ano);
  let meses = dados[anoAtual].meses;

  // LÓGICA PARA NOVO ANO
  if (meses.length >= 12) {
    let novoAno = anoAtual + 1;
    if (!dados[novoAno]) dados[novoAno] = { meses: [] };
    
    // Pega saldo de Dezembro do ano anterior
    const mDez = meses[11];
    const d = mDez.despesas.filter(x => x.checked).reduce((a, b) => a + b.valor, 0);
    const e = (mDez.empresa || []).filter(x => x.checked).reduce((a, b) => a + b.valor, 0);
    const saldoDez = (mDez.salario + mDez.conta + e) - d;

    // Cria Janeiro no novo ano
    dados[novoAno].meses.push({ despesas: [{ nome: "Aluguel", valor: 0, checked: true }], empresa: [], salario: 0, conta: saldoDez });
    
    // Atualiza o seletor visualmente
    seletorAno.value = novoAno;
    salvarDadosLocal();
    carregarAno(); // Recarrega agora no novo ano
    return;
  }

  // Lógica normal de adicionar mês no mesmo ano
  let saldoAnterior = 0;
  if (meses.length > 0) {
    const m = meses[meses.length - 1];
    const d = m.despesas.filter(x => x.checked).reduce((a, b) => a + b.valor, 0);
    const e = (m.empresa || []).filter(x => x.checked).reduce((a, b) => a + b.valor, 0);
    saldoAnterior = (m.salario + m.conta + e) - d;
  }
  meses.push({ despesas: [{ nome: "Aluguel", valor: 0, checked: true }], empresa: [], salario: 0, conta: saldoAnterior });
  aplicarParcelas();
  salvarDadosLocal(); 
  carregarAno();
}

function criarMesDOM(ano, index, data) {
  const mes = document.createElement("div");
  let mesAlvo = (hoje.getMonth() + 1) % 12;
  let anoAlvo = hoje.getMonth() === 11 ? hoje.getFullYear() + 1 : hoje.getFullYear();
  mes.className = "mes" + (Number(ano) === anoAlvo && index === mesAlvo ? " mesAtual" : " collapsed");

  const header = document.createElement("div");
  header.className = "mesHeader";
  header.innerHTML = `<span>${nomesMesesFull[index]} ${ano}</span><div><span class="mesTotal">0,00</span><button class="duplicarMes"><svg viewBox="0 0 24 24"><path d="M8 8h12v12H8zM4 4h12v2H6v10H4z"/></svg></button><button class="removeMes">×</button></div>`;
  
  header.onclick = () => mes.classList.toggle("collapsed");
  
  header.querySelector(".duplicarMes").onclick = (e) => { 
    e.stopPropagation(); 
    dados[ano].meses.splice(index + 1, 0, JSON.parse(JSON.stringify(data)));
    salvarDadosLocal(); carregarAno();
  };

  header.querySelector(".removeMes").onclick = (e) => { 
    e.stopPropagation(); 
    if(confirm("Excluir?")) { dados[ano].meses.splice(index, 1); salvarDadosLocal(); carregarAno(); } 
  };

  const body = document.createElement("div");
  body.className = "mesBody";
  body.innerHTML = `
    <div class="container">
        <div class="coluna despesas">
            <div class="topoColuna"><h4>DESPESAS</h4></div>
            <div class="conteudoColuna"><div class="listaDesp"></div>
                <div class="acoesDesp">
                    <button class="addDesp">+ Despesa</button>
                    <button class="addParcela">+ Parcela</button>
                </div>
            </div>
            <p class="rodapeColuna">Total: <span class="totalDespesas">0,00</span></p>
        </div>
        <div class="coluna dinheiro">
            <div class="topoColuna"><h4>DINHEIROS</h4></div>
            <div class="conteudoColuna">
                <div class="linhaInputs">
                    <div class="campo"><label>Salário</label><input type="text" class="salario inputPadrao"></div>
                    <div class="campo"><label>Conta</label><input type="text" class="conta inputPadrao"></div>
                </div>
                <h5>OUTROS</h5>
                <div class="listaEmp"></div>
                <button class="addEmp inputPadrao" style="height:35px; cursor:pointer">+</button>
            </div>
            <p class="rodapeColuna">Total: <span class="totalDinheiro">0,00</span></p>
        </div>
    </div>
    <div class="totalFinal">TOTAL: <span class="saldo">0,00</span></div>`;

  const listD = body.querySelector(".listaDesp");
  const listE = body.querySelector(".listaEmp");

  const renderItems = () => {
    listD.innerHTML = "";
    listE.innerHTML = "";
    data.despesas.forEach(item => criarItem(listD, item, data.despesas, ano));
    (data.empresa || []).forEach(item => criarItem(listE, item, data.empresa, ano));
  };
  renderItems();

  const inSal = body.querySelector("input.salario"); 
  const inCon = body.querySelector("input.conta");
  inSal.value = formatar(data.salario || 0); inCon.value = formatar(data.conta || 0);
  aplicarComportamentoInput(inSal, () => data.salario, (v) => data.salario = v, ano);
  aplicarComportamentoInput(inCon, () => data.conta, (v) => data.conta = v, ano);

  // CORREÇÃO: ADICIONAR SEM FECHAR
  body.querySelector(".addDesp").onclick = () => { 
    const novo = {nome:"", valor:0, checked:true};
    data.despesas.push(novo); 
    criarItem(listD, novo, data.despesas, ano);
    atualizarTudo(ano);
  };
  
  body.querySelector(".addParcela").onclick = () => {
    const nome = prompt("Nome:"); const valor = parseValor(prompt("Valor Total:")); const num = parseInt(prompt("Parcelas:"));
    if(nome && valor > 0 && num > 0) {
      parcelasMemoria.push({ id: Date.now(), nome, valorParcela: Number((valor/num).toFixed(2)), parcelas: num, inicio: index, ano: Number(ano) });
      aplicarParcelas(); salvarDadosLocal(); carregarAno();
    }
  };

  body.querySelector(".addEmp").onclick = () => { 
    if(!data.empresa) data.empresa=[]; 
    const novo = {nome:"", valor:0, checked:true};
    data.empresa.push(novo); 
    criarItem(listE, novo, data.empresa, ano);
    atualizarTudo(ano);
  };
  
  mes.appendChild(header); mes.appendChild(body);
  return mes;
}

function criarItem(lista, d, dataArray, ano) {
  const div = document.createElement("div"); div.className = "item";
  div.innerHTML = `<input type="checkbox" ${d.checked?'checked':''}> <input class="nome inputPadrao" value="${d.nome}"> <input class="valor inputPadrao" value="${formatar(d.valor)}"> <button class="removeItem">×</button>`;
  const [check, nome, valor, btn] = div.children;
  check.onchange = () => { d.checked = check.checked; atualizarTudo(ano); };
  nome.onblur = () => { d.nome = nome.value; salvarDadosLocal(); };
  aplicarComportamentoInput(valor, () => d.valor, (v) => d.valor = v, ano);
  btn.onclick = () => { 
    if(d.parcelaId) {
      parcelasMemoria = parcelasMemoria.filter(p => p.id !== d.parcelaId);
      dados[seletorAno.value].meses.forEach(m => m.despesas = m.despesas.filter(x => x.parcelaId !== d.parcelaId));
      carregarAno(); // Aqui precisa recarregar tudo pois afeta vários meses
    } else { 
      dataArray.splice(dataArray.indexOf(d), 1); 
      div.remove(); // Remove apenas o elemento visual
      atualizarTudo(ano); 
    }
    salvarDadosLocal();
  };
  lista.appendChild(div);
}

// ================= UTILITÁRIOS =================
function formatar(v) { return "R$ " + (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 }); }
function parseValor(v) { if (!v) return 0; const limpo = v.toString().replace(/[^\d,.-]/g, "").replace(",", "."); return Number(limpo) || 0; }

function aplicarComportamentoInput(input, getV, setV, ano) {
  let vAnt = "";
  input.addEventListener("focus", () => { vAnt = input.value; input.value = ""; });
  input.addEventListener("blur", () => {
    if (input.value.trim() === "") { input.value = vAnt; } 
    else { const v = parseValor(input.value); setV(v); input.value = formatar(v); atualizarTudo(ano); }
  });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
}

function atualizarTudo(ano) {
  if (!mesesDOM.length) return;
  mesesDOM.forEach(({dom, index}) => {
    const data = dados[ano].meses[index]; if(!data) return;
    const desp = data.despesas.filter(d => d.checked).reduce((a, b) => a + b.valor, 0);
    const empr = (data.empresa || []).filter(d => d.checked).reduce((a, b) => a + b.valor, 0);
    const totalD = (Number(data.salario) || 0) + (Number(data.conta) || 0) + empr;
    const saldo = totalD - desp;
    dom.querySelector(".totalDespesas").textContent = formatar(desp);
    dom.querySelector(".totalDinheiro").textContent = formatar(totalD);
    const sEl = dom.querySelector(".saldo"); sEl.textContent = formatar(saldo);
    sEl.className = "saldo " + (saldo >= 0 ? "positivo" : "negativo");
    dom.querySelector(".mesTotal").textContent = formatar(saldo);
  });
  salvarDadosLocal();
  atualizarGrafico(ano);
}

function atualizarGrafico(ano) {
  if(!dados[ano] || !dados[ano].meses.length) return;
  const valores = dados[ano].meses.map(m => {
    const d = m.despesas.filter(x => x.checked).reduce((a, b) => a + b.valor, 0);
    const e = (m.empresa || []).filter(x => x.checked).reduce((a, b) => a + b.valor, 0);
    return Number(((m.salario + m.conta + e) - d).toFixed(2));
  });
  if (chart) { chart.updateSeries([{ data: valores }]); } 
  else {
    chart = new ApexCharts(document.querySelector("#grafico"), {
      chart: { type: "bar", height: 280, toolbar:{show:false} },
      series: [{ name: "Saldo", data: valores }],
      xaxis: { categories: nomesMesesFull.map(n => n.slice(0,3).toUpperCase()) },
      colors: ['#3C5558']
    });
    chart.render();
  }
}

// ================= INIT & EVENTOS =================
const salvo = localStorage.getItem("financas"); if (salvo) dados = JSON.parse(salvo);

for (let a = 2024; a <= 2035; a++) {
  const opt = document.createElement("option"); opt.value = a; opt.textContent = a;
  if(a === hoje.getFullYear()) opt.selected = true;
  seletorAno.appendChild(opt);
}

onAuthStateChanged(auth, (user) => {
  const authCont = document.getElementById("authContainer");
  const appCont = document.getElementById("appContainer");
  if (user) {
    usuarioLogado = user;
    authCont.style.display = "none";
    appCont.style.display = "block";
    carregarAno(); 
  } else {
    usuarioLogado = null;
    authCont.style.display = "flex";
    appCont.style.display = "none";
  }
});

document.getElementById("loginBtn").onclick = () => loginFirebase(document.getElementById("email").value, document.getElementById("senha").value);
document.getElementById("cadastroBtn").onclick = () => cadastrarFirebase(document.getElementById("email").value, document.getElementById("senha").value);
document.getElementById("logoutBtn").onclick = logoutFirebase;
document.getElementById("salvarNuvemBtn").onclick = salvarFirebase;
document.getElementById("exportarTudoBtn").onclick = exportarTudo;
document.getElementById("inputImport").onchange = importarDados;
seletorAno.onchange = carregarAno;

document.getElementById("showSignup").onclick = (e) => {
  e.preventDefault();
  document.getElementById("loginActions").style.display = "none";
  document.getElementById("signupActions").style.display = "block";
};
document.getElementById("showLogin").onclick = (e) => {
  e.preventDefault();
  document.getElementById("signupActions").style.display = "none";
  document.getElementById("loginActions").style.display = "block";
};