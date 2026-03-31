// ================= FIREBASE =================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  onAuthStateChanged,
  GoogleAuthProvider, 
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import { 
  getFirestore, 
  doc, 
  setDoc, 
  getDoc 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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

const provider = new GoogleAuthProvider();

let usuarioLogado = null;

// ================= LOGIN =================
window.loginFirebase = async function(email, senha){
  try {
    await signInWithEmailAndPassword(auth, email, senha);
    alert("Logado!");
  } catch(e){
    alert(e.message);
  }
};

// ================= LOGOUT =================
window.logoutFirebase = async function(){
  try {
    await signOut(auth);

    // limpa dados locais
    dados = {};
    parcelasMemoria = [];
    localStorage.removeItem("financas");

    // UI
    document.getElementById("loginBox").style.display = "block";
    document.getElementById("areaAno").innerHTML = "";
    document.getElementById("grafico").innerHTML = "";

    usuarioLogado = null;

  } catch(e){
    alert(e.message);
  }
};

// ================= FIRESTORE =================
async function salvarFirebase(){
  if(!usuarioLogado) return;

  await setDoc(doc(db, "financas", usuarioLogado.uid), {
    dados,
    parcelasMemoria
  });
}

async function carregarFirebase(){
  if(!usuarioLogado) return;

  const ref = doc(db, "financas", usuarioLogado.uid);
  const snap = await getDoc(ref);

  if(snap.exists()){
    const data = snap.data();
    dados = data.dados || {};
    parcelasMemoria = data.parcelasMemoria || [];
  }
}

let dados = {};
let mesesDOM = [];
let chart;
let parcelasMemoria = [];

// copiar/colar
let copiaDespesas = null;
let copiaEmpresa = null;

const nomesMesesFull = [
  "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
  "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"
];

const seletorAno = document.getElementById("ano");
const areaAno = document.getElementById("areaAno");

// ---------------- PARCELAS -----------------

function criarParcelamento(ano, mesIndex, nome, valorTotal, parcelas) {
  const valorParcela = Number((valorTotal / parcelas).toFixed(2));

  const pacote = {
    id: Date.now(),
    nome,
    valorParcela,
    parcelas,
    inicio: mesIndex,
    ano
  };

  parcelasMemoria.push(pacote);

  aplicarParcelas();
  salvarDados();
}

function aplicarParcelas() {
  parcelasMemoria.forEach(p => {

    const meses = dados[p.ano].meses;

    for (let i = 0; i < p.parcelas; i++) {
      const index = p.inicio + i;

      if (!meses[index]) continue;

      const nomeParcela = `${p.nome} [${i+1}/${p.parcelas}]`;

      const jaExiste = meses[index].despesas.some(d => d.nome === nomeParcela);

      if (!jaExiste) {
        meses[index].despesas.push({
          nome: nomeParcela,
          valor: p.valorParcela,
          checked: true,
          parcelaId: p.id
        });
      }
    }
  });
}

// ---------------- SAVE ----------------
function salvarDados() {
  localStorage.setItem("financas", JSON.stringify(dados));
  salvarFirebase(); // 🔥 ADICIONADO
}

function carregarDados() {
  const salvo = localStorage.getItem("financas");
  if (salvo) dados = JSON.parse(salvo);
}

// ---------------- EXPORT ----------------
// Exportar apenas o ano selecionado
function exportarAno() {
  const ano = seletorAno.value;

  // Garante que sai sempre { "meses": [...] }
  const exportObj = {
    meses: dados[ano]?.meses || []
  };

  const blob = new Blob(
    [JSON.stringify(exportObj, null, 2)],
    { type: "application/json" }
  );

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `financas_${ano}.json`;
  a.click();
}

function exportarTudo() {
  const exportObj = {
    dados: dados,
    parcelasMemoria: parcelasMemoria
  };

  const blob = new Blob(
    [JSON.stringify(exportObj, null, 2)],
    { type: "application/json" }
  );

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `financas_backup.json`;
  a.click();
}

// ---------------- IMPORT ----------------
function importarAno(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();

  reader.onload = async () => {
    try {
      let importado = JSON.parse(reader.result);
      const ano = seletorAno.value;

      // BACKUP COMPLETO
      if (importado.dados) {
        dados = importado.dados;
        parcelasMemoria = importado.parcelasMemoria || [];
      } 
      // ANO ÚNICO
      else {
        if (Array.isArray(importado)) {
          importado = { meses: importado };
        }

        if (!importado.meses) {
          throw new Error("Formato inválido");
        }

        dados[ano] = importado;
      }

      aplicarParcelas();

      localStorage.setItem("financas", JSON.stringify(dados));

      if (usuarioLogado) {
        await setDoc(doc(db, "financas", usuarioLogado.uid), {
          dados,
          parcelasMemoria
        });
      }

      carregarAno();

      alert("Importado com sucesso!");

    } catch (err) {
      console.error(err);
      alert("Arquivo inválido");
    }
  };

  reader.readAsText(file);
}

// conecta o input à função de importação
document.getElementById("inputImport").addEventListener("change", importarAno);

// ---------------- COLLAPSE ----------------
function salvarEstados() {
  const estados = mesesDOM.map(({dom}) => dom.classList.contains("collapsed"));
  localStorage.setItem("estadosAccordion", JSON.stringify(estados));
}

function carregarEstados() {
  const estados = JSON.parse(localStorage.getItem("estadosAccordion")||"[]");
  mesesDOM.forEach(({dom}, i) => {
    if (estados[i]) dom.classList.add("collapsed");
  });
}

// ---------------- UTIL ----------------
function formatar(v) {
  const numero = (Number(v) || 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 2
  });

  return "R$\u00A0" + numero;
}

/* FORMATA OS VALORES */

function parseValor(v) {
  if (!v) return 0;

  // remove tudo que não for número ou vírgula
  v = v.replace(/[^\d,]/g, "");

  // se tiver mais de uma vírgula, mantém só a última
  const partes = v.split(",");
  if (partes.length > 2) {
    v = partes.slice(0, -1).join("") + "," + partes[partes.length - 1];
  }

  return Number(v.replace(",", ".")) || 0;
}

function aplicarComportamentoInput(input, getValor, setValor, ano) {

  let valorAnterior; // guarda valor antes do foco

  // ao focar → guarda o valor atual e limpa o input
  input.addEventListener("focus", () => {
    valorAnterior = input.value; // salva valor atual
    input.value = "";            // limpa para digitar
  });

  // ao sair OU apertar Enter → confirma
  function confirmar() {
    const valorDigitado = parseValor(input.value);

    if (input.value.trim() === "") {
      // se o usuário não digitou nada, volta o valor antigo
      input.value = valorAnterior;
    } else {
      // se digitou algo, salva e formata
      setValor(valorDigitado);
      input.value = formatar(valorDigitado);
    }

    atualizarTudo(ano);
  }

  input.addEventListener("blur", confirmar);

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      input.blur(); // força o blur → chama confirmar
    }
  });
}

const hoje = new Date();

let mesAtual = hoje.getMonth() + 1; // próximo mês
let anoAtual = hoje.getFullYear();

// se passar de dezembro
if (mesAtual > 11) {
  mesAtual = 0;
  anoAtual++;
}

// ---------------- INIT ----------------
carregarDados();

for (let ano = 2026; ano <= 2030; ano++) {
  if (!dados[ano]) dados[ano] = { meses: [] };

  const opt = document.createElement("option");
  opt.value = ano;
  opt.textContent = ano;
  seletorAno.appendChild(opt);
}

seletorAno.onchange = carregarAno;
carregarAno();

// ---------------- UI ----------------
function carregarAno() {
  const ano = seletorAno.value;

  areaAno.innerHTML = "";
  mesesDOM = [];

  const wrapper = document.createElement("div");

  const btnWrapper = document.createElement("div");
  btnWrapper.className = "addMesBox";

  const btn = document.createElement("button");
  btn.innerText = "+ ADICIONAR MÊS";
  btn.onclick = () => adicionarMes(ano);

  btnWrapper.appendChild(btn);
  wrapper.appendChild(btnWrapper);

  const container = document.createElement("div");
  wrapper.appendChild(container);
  areaAno.appendChild(wrapper);

  const meses = dados[ano].meses;

  for (let i = meses.length - 1; i >= 0; i--) {
    const mesDOM = criarMesDOM(ano, i, meses[i]);
    container.appendChild(mesDOM);
    mesesDOM.push({ dom: mesDOM, index: i });
  }

  atualizarTudo(ano);
  atualizarGrafico(ano);
}

// ================= EXPORTAR TUDO =================
document.getElementById("exportarTudoBtn").addEventListener("click", () => {
  if (!dados || Object.keys(dados).length === 0) {
    alert("Não há dados para exportar!");
    return;
  }

  // Estrutura compatível com o import
  const exportData = {
    dados: dados, // mantém todos os anos
    parcelasMemoria: parcelasMemoria
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `financas_backup.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
});

// ---------------- MES ----------------
function adicionarMes(ano) {
  const meses = dados[ano].meses;

  const ultimoSaldo = meses.length
    ? ((meses[meses.length - 1].salario + meses[meses.length - 1].conta
        + (meses[meses.length - 1].empresa?.reduce((a,b)=>a+b.valor,0)||0))
        - (meses[meses.length - 1].despesas?.reduce((a,b)=>a+b.valor,0)||0))
    : 0;

  dados[ano].meses.push({
    despesas: [
      { nome: "Aluguel", valor: 0, checked: true },
      { nome: "Cartão de Crédito", valor: 0, checked: true },
      { nome: "Vuon Card", valor: 0, checked: true },
      { nome: "Fort", valor: 0, checked: true },
      { nome: "Santander", valor: 0, checked: true },
      { nome: "Academia", valor: 0, checked: true }
    ],
    empresa: [],
    salario: 0,
    conta: ultimoSaldo
  });

  aplicarParcelas();
  salvarDados();
  carregarAno();
}

// ---------------- DOM ----------------
function criarMesDOM(ano, index, data) {

  const mes = document.createElement("div");
  mes.className = "mes";

  // destaque + controle aberto/fechado
  if (Number(ano) === anoAtual && index === mesAtual) {
    mes.classList.add("mesAtual");
    mes.classList.remove("collapsed"); // aberto
  } else {
    mes.classList.add("collapsed"); // fechado
  }

  const mesHeader = document.createElement("div");
  mesHeader.className = "mesHeader";

  const headerRight = document.createElement("div");

  const mesTotal = document.createElement("span");
  mesTotal.className = "mesTotal";

  const duplicarBtn = document.createElement("button");
  duplicarBtn.className = "duplicarMes";
  duplicarBtn.innerHTML = `
    <svg viewBox="0 0 24 24" width="16" height="16">
      <path d="M8 8h12v12H8zM4 4h12v2H6v10H4z"/>
    </svg>
  `;
  duplicarBtn.onclick = (e) => {
    e.stopPropagation();
    const copia = JSON.parse(JSON.stringify(data));
    dados[ano].meses.splice(index+1, 0, copia);
    salvarDados();
    carregarAno();
  };

  const removeBtn = document.createElement("button");
  removeBtn.className = "removeMes";
  removeBtn.innerText = "×";
  removeBtn.onclick = (e) => {
    e.stopPropagation();
    dados[ano].meses.splice(index,1);
    salvarDados();
    carregarAno();
  };

  headerRight.appendChild(mesTotal);
  headerRight.appendChild(duplicarBtn);
  headerRight.appendChild(removeBtn);

  mesHeader.innerHTML = `<span>${nomesMesesFull[index]} ${ano}</span>`;
  mesHeader.appendChild(headerRight);

  const mesBody = document.createElement("div");
  mesBody.className = "mesBody";

  mesBody.innerHTML = `
<div class="container">
  <div class="coluna despesas">

    <div class="topoColuna">
      <h4>DESPESAS</h4>
      <div class="acoesTopo">
        <button class="copyDesp">📝</button>
        <button class="pasteDesp">📋</button>
      </div>
    </div>

    <div class="conteudoColuna">
      <div class="listaDesp"></div>
      <div class="acoesDesp">
  <button class="addDesp">+ Despesa</button>
  <button class="addParcela">+ Parcelamento</button>
</div>
    </div>

    <p class="rodapeColuna">
      <span>Total:</span>
      <span class="valorTotal"><span class="totalDespesas">0,00</span></span>
    </p>
  </div>

  <div class="coluna dinheiro">

    <div class="topoColuna">
      <h4>DINHEIROS</h4>
      <div class="acoesTopo">
        <button class="copyEmp">📝</button>
        <button class="pasteEmp">📋</button>
      </div>
    </div>

    <div class="conteudoColuna">
      <div class="linhaInputs">
        <div class="campo">
          <label>Salário</label>
          <input class="salario">
      </div>

      <div class="campo">
        <label>Conta</label>
        <input class="conta">
      </div>
    </div>

      <h5>OUTROS</h5>
      <div class="listaEmp"></div>
      <button class="addEmp">+</button>
    </div>

    <p class="rodapeColuna">
      <span>Total:</span>
      <span class="valorTotal"><span class="totalDinheiro">0,00</span></span>
    </p>
  </div>
</div>

<div class="totalFinal">
  TOTAL: R$ <span class="saldo">0,00</span>
</div>
  `;

  mes.appendChild(mesHeader);
  mes.appendChild(mesBody);

  mesHeader.onclick = () => {
    mes.classList.toggle("collapsed");
  };

  const listaDesp = mesBody.querySelector(".listaDesp");
  const listaEmp = mesBody.querySelector(".listaEmp");

  function renderList(lista, arr) {
    lista.innerHTML = "";
    arr.forEach(d => criarItem(lista, d, arr));
  }

  renderList(listaDesp, data.despesas);
  renderList(listaEmp, data.empresa);

// adicionar despesa normal
mesBody.querySelector(".addDesp").onclick = () => {
  const novo = {nome:"",valor:0,checked:true};
  data.despesas.push(novo);

  renderList(listaDesp, data.despesas);
  atualizarTudo(ano);

  const inputs = listaDesp.querySelectorAll(".nome");
  const ultimo = inputs[inputs.length - 1];

  if (ultimo) ultimo.focus();
};

// adicionar PARCELA
mesBody.querySelector(".addParcela").onclick = () => {

  const nome = prompt("Nome da despesa:");
  if (!nome) return;

  const valorInput = prompt("Valor total:");
  if (!valorInput) return;

  const parcelasInput = prompt("Número de parcelas:");
  if (!parcelasInput) return;

  const valor = parseValor(valorInput);
  const parcelas = Number(parcelasInput);

  if (!valor || !parcelas || parcelas <= 0) {
    alert("Valores inválidos");
    return;
  }

  criarParcelamento(ano, index, nome, valor, parcelas);

  salvarDados();
  carregarAno();
};

mesBody.querySelector(".addEmp").onclick = () => {
  const novo = {nome:"",valor:0,checked:true};
  data.empresa.push(novo);

  renderList(listaEmp, data.empresa);
  atualizarTudo(ano);

  // foco automático
  const inputs = listaEmp.querySelectorAll(".nome");
  const ultimo = inputs[inputs.length - 1];

  if (ultimo) {
    ultimo.focus();
  }
};

  // copiar
  mesBody.querySelector(".copyDesp").onclick = () => {
    copiaDespesas = JSON.parse(JSON.stringify(data.despesas));
  };

  mesBody.querySelector(".copyEmp").onclick = () => {
    copiaEmpresa = JSON.parse(JSON.stringify(data.empresa));
  };

  // colar
  mesBody.querySelector(".pasteDesp").onclick = () => {
    if(copiaDespesas){
      data.despesas = JSON.parse(JSON.stringify(copiaDespesas));
      renderList(listaDesp, data.despesas);
      atualizarTudo(ano);
    }
  };

  mesBody.querySelector(".pasteEmp").onclick = () => {
    if(copiaEmpresa){
      data.empresa = JSON.parse(JSON.stringify(copiaEmpresa));
      renderList(listaEmp, data.empresa);
      atualizarTudo(ano);
    }
  };

  const sal = mesBody.querySelector(".salario");
  const con = mesBody.querySelector(".conta");

  sal.classList.add("inputPadrao");
  con.classList.add("inputPadrao");

  sal.value = formatar(data.salario);
  con.value = formatar(data.conta);

  aplicarComportamentoInput(
  sal,
  () => data.salario,
  (v) => data.salario = v,
  ano
  );

aplicarComportamentoInput(
  con,
  () => data.conta,
  (v) => data.conta = v,
  ano
  );

  return mes;
}

// ---------------- ITEM ----------------
function criarItem(lista, d, dataArray) {
  const div = document.createElement("div");
  div.className = "item";

  div.innerHTML = `
  <input type="checkbox">
  <input class="nome" placeholder="Descrição">
  <input class="valor" placeholder="0,00">
  <button>x</button>
`;
  const [check,nome,valor,btn] = div.children;
  btn.classList.add("removeItem");
  nome.classList.add("inputPadrao");
  valor.classList.add("inputPadrao");

  check.checked = d.checked;
  nome.value = d.nome;
  valor.value = formatar(d.valor);

  check.onchange = () => { d.checked = check.checked; atualizarTudo(seletorAno.value); };
  nome.oninput = () => d.nome = nome.value;
  aplicarComportamentoInput(
  valor,
  () => d.valor,
  (v) => d.valor = v,
  seletorAno.value
);

btn.onclick = () => {

  // se for parcela → remove todas
  if (d.parcelaId) {

    // remove da memória
    parcelasMemoria = parcelasMemoria.filter(p => p.id !== d.parcelaId);

    // remove de todos os meses
    dados[seletorAno.value].meses.forEach(m => {
      m.despesas = m.despesas.filter(x => x.parcelaId !== d.parcelaId);
    });

  } else {
    // comportamento normal
    const index = dataArray.indexOf(d);
    if(index > -1) dataArray.splice(index,1);
  }

  atualizarTudo(seletorAno.value);
  carregarAno();
};

lista.appendChild(div);
}

// ---------------- CALCULO ----------------
function atualizarTudo(ano) {
  mesesDOM.forEach(({dom, index}) => {
    const data = dados[ano].meses[index];

    let despesas = data.despesas
      .filter(d => d.checked)
      .reduce((a,b) => a + b.valor, 0);

    let empresa = data.empresa?.filter(d => d.checked)
      .reduce((a,b) => a + b.valor, 0) || 0;

    let dinheiro = data.salario + data.conta + empresa;
    let saldo = dinheiro - despesas;

    // elementos
    const totalDespesasEl = dom.querySelector(".totalDespesas");
    const totalDinheiroEl = dom.querySelector(".totalDinheiro");
    const saldoEl = dom.querySelector(".saldo");
    const mesTotalEl = dom.querySelector(".mesTotal");

    // valores
    totalDespesasEl.textContent = formatar(despesas);
    totalDinheiroEl.textContent = formatar(dinheiro);
    saldoEl.textContent = formatar(saldo);
    mesTotalEl.textContent = formatar(saldo);

    // cores (positivo / negativo)
if (saldo >= 0) {
  saldoEl.classList.add("positivo");
  saldoEl.classList.remove("negativo");
} else {
  saldoEl.classList.add("negativo");
  saldoEl.classList.remove("positivo");
}
  });

  salvarDados();
  salvarEstados();
  atualizarGrafico(ano);
}

// ---------------- GRAFICO ----------------
function atualizarGrafico(ano) {
  const meses = dados[ano].meses;

  const valores = meses.map(m => {
    const despesas = m.despesas.filter(d=>d.checked).reduce((a,b)=>a+b.valor,0);
    const empresa = m.empresa?.filter(d=>d.checked).reduce((a,b)=>a+b.valor,0)||0;
    return Number(((m.salario + m.conta + empresa) - despesas).toFixed(2));
  });

  if (chart) {
    chart.updateSeries([{ name: "Balanço", data: valores }]);
  } else {
    chart = new ApexCharts(document.querySelector("#grafico"), {
      chart: { type: "bar", height: 300 },
      series: [{ name: "Balanço", data: valores }],
      xaxis: { categories: meses.map((_, i) => nomesMesesFull[i].slice(0,3).toUpperCase()) },
      colors: [getComputedStyle(document.documentElement).getPropertyValue('--P03')]
    });
    chart.render();
  }
}

// LOGIN //

window.fazerLogin = function() {
  const email = document.getElementById("email").value;
  const senha = document.getElementById("senha").value;

  loginFirebase(email, senha);
};

// LOGIN COM GOOGLE
window.loginGoogle = async function(){
  try {
    await signInWithPopup(auth, provider);
  } catch(e){
    alert(e.message);
  }
};

// LOGOUT

window.logoutFirebase = async function(){
  try {
    await signOut(auth);

    // limpa dados locais
    dados = {};
    parcelasMemoria = [];
    localStorage.removeItem("financas");

    // mostra login de novo
    document.getElementById("loginBox").style.display = "block";

    // limpa tela
    document.getElementById("areaAno").innerHTML = "";
    document.getElementById("grafico").innerHTML = "";

    usuarioLogado = null;

  } catch(e){
    alert(e.message);
  }
};

// BOTÃO LOGOUT SUMIR //

document.getElementById("logoutBtn").onclick = logoutFirebase;

onAuthStateChanged(auth, async (user) => {
  const logoutBtn = document.getElementById("logoutBtn");

  if(user){
    usuarioLogado = user;

    console.log("LOGADO:", user.uid); // 👈 DEBUG

    document.getElementById("loginBox").style.display = "none";
    logoutBtn.style.display = "block";

    dados = {};
    parcelasMemoria = [];

    await carregarFirebase();

    console.log("DADOS FIREBASE:", dados); // 👈 DEBUG

    salvarDados();
    carregarAno();

  } else {
    console.log("DESLOGADO");

    usuarioLogado = null;

    document.getElementById("loginBox").style.display = "block";
    logoutBtn.style.display = "none";
  }
});

