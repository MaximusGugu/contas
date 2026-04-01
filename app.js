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
let dados = {};
let parcelasMemoria = [];
let mesesDOM = [];
let chart = null;
let mesesAbertos = new Set(); 
const hoje = new Date();
const nomesMesesFull = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

// ================= MOTOR DE CÁLCULO (CASCATA) =================

function atualizarTudo(anoParaVisualizar, pendente = true) {
  const anosOrdenados = Object.keys(dados).map(Number).sort((a, b) => a - b);
  let saldoAcumulado = 0;
  let ehOPrimeiroMesDeTodos = true;

  anosOrdenados.forEach(ano => {
    if (!dados[ano].meses) return;
    
    dados[ano].meses.forEach((m, idx) => {
      // Se não for manual, recebe o saldo anterior
      if (!ehOPrimeiroMesDeTodos && m.contaManual !== true) {
        m.conta = saldoAcumulado;
      }

      const dTotal = (m.despesas || []).filter(x => x.checked).reduce((acc, b) => acc + b.valor, 0);
      const eTotal = (m.empresa || []).filter(x => x.checked).reduce((acc, b) => acc + b.valor, 0);
      const totalDisponivel = (m.salario || 0) + (m.conta || 0) + eTotal;
      const saldoFinal = totalDisponivel - dTotal;

      saldoAcumulado = saldoFinal;
      ehOPrimeiroMesDeTodos = false;

      // Visual apenas para o ano selecionado
      if (ano === Number(anoParaVisualizar)) {
        const info = mesesDOM.find(item => item.index === idx);
        if (info) {
          const dom = info.dom;
          dom.querySelector(".totalDespesas").textContent = formatar(dTotal);
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
            if (m.contaManual === true) inC.classList.add("manual");
            else inC.classList.remove("manual");
          }
        }
      }
    });
  });

  salvarDadosLocal(pendente);
  atualizarGrafico(Number(anoParaVisualizar));
}

function liberarCascataFutura(anoInicial, mesIdxInicial) {
  const anosOrdenados = Object.keys(dados).map(Number).sort((a, b) => a - b);
  let encontrouAtual = false;
  anosOrdenados.forEach(ano => {
    dados[ano].meses.forEach((m, idx) => {
      if (encontrouAtual) m.contaManual = false;
      if (ano === Number(anoInicial) && idx === mesIdxInicial) encontrouAtual = true;
    });
  });
  atualizarTudo(anoInicial);
}

// ================= LÓGICA DE PARCELAS =================

function aplicarParcelas() {
  parcelasMemoria.forEach(p => {
    if (!dados[p.ano]) return;
    const meses = dados[p.ano].meses;
    for (let i = 0; i < p.parcelas; i++) {
      const idx = p.inicio + i;
      if (!meses[idx]) continue;
      const nomeP = `${p.nome} (${i+1}/${p.parcelas})`;
      // Evita duplicados
      if (!meses[idx].despesas.some(d => d.parcelaId === p.id && d.nome === nomeP)) {
        meses[idx].despesas.push({ nome: nomeP, valor: p.valorParcela, checked: true, parcelaId: p.id });
      }
    }
  });
}

// ================= INTERFACE =================

function criarMesDOM(ano, index, data) {
  const mes = document.createElement("div");
  const mesAtualIdx = hoje.getMonth(); const anoAtual = hoje.getFullYear();
  
  let estaAberto = mesesAbertos.has(index);
  if (mesesAbertos.size === 0 && Number(ano) === anoAtual && index === mesAtualIdx) {
      estaAberto = true;
      mesesAbertos.add(index);
  }

  mes.className = "mes" + (estaAberto ? "" : " collapsed");
  if (Number(ano) === anoAtual && index === mesAtualIdx) mes.classList.add("mesAtual");

  const header = document.createElement("div"); header.className = "mesHeader";
  header.innerHTML = `<span>${nomesMesesFull[index]} ${ano}</span><div><span class="mesTotal">0,00</span><button class="duplicarMes"><svg viewBox="0 0 24 24"><path d="M8 8h12v12H8zM4 4h12v2H6v10H4z"/></svg></button><button class="removeMes">×</button></div>`;
  
  header.onclick = () => {
      const isCollapsed = mes.classList.toggle("collapsed");
      if (isCollapsed) mesesAbertos.delete(index);
      else mesesAbertos.add(index);
  };
  
  header.querySelector(".duplicarMes").onclick = (e) => { 
    e.stopPropagation(); dados[ano].meses.splice(index + 1, 0, JSON.parse(JSON.stringify(data))); carregarAno();
  };
  header.querySelector(".removeMes").onclick = (e) => { 
    e.stopPropagation(); if(confirm("Excluir mês?")) { dados[ano].meses.splice(index, 1); carregarAno(); } 
  };

  const body = document.createElement("div"); body.className = "mesBody";
  body.innerHTML = `
    <div class="container">
        <div class="coluna despesas">
            <div class="topoColuna"><h4>DESPESAS</h4></div>
            <div class="conteudoColuna">
                <div class="listaDesp"></div>
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
                    <button class="btn-cascata" title="Vincular meses seguintes à cascata automática">🔗</button>
                </div>
                <h5>OUTROS</h5><div class="listaEmp"></div><button class="addEmp inputPadrao" style="height:35px; cursor:pointer">+</button>
            </div>
            <p class="rodapeColuna">Total: <span class="totalDinheiro">0,00</span></p>
        </div>
    </div>
    <div class="totalFinal">TOTAL: <span class="saldo">0,00</span></div>`;

  const listD = body.querySelector(".listaDesp"); 
  const listE = body.querySelector(".listaEmp");
  data.despesas.forEach(item => criarItem(listD, item, data.despesas, ano));
  (data.empresa || []).forEach(item => criarItem(listE, item, data.empresa, ano));

  const inSal = body.querySelector("input.salario"); 
  const inCon = body.querySelector("input.conta");
  const btnC = body.querySelector(".btn-cascata");

  inSal.value = formatar(data.salario || 0);
  inCon.value = formatar(data.conta || 0);

  aplicarComportamentoInput(inSal, () => data.salario, (v) => data.salario = v, ano);

  inCon.addEventListener("focus", () => { inCon.dataset.old = inCon.value; inCon.value = ""; });
  inCon.addEventListener("blur", () => {
    const txt = inCon.value.trim();
    if (txt === "") data.contaManual = false;
    else { data.conta = parseValor(txt); data.contaManual = true; }
    atualizarTudo(ano);
  });
  inCon.addEventListener("keydown", (e) => { if(e.key === "Enter") inCon.blur(); });

  btnC.onclick = () => liberarCascataFutura(ano, index);

  // BOTÕES DE ADIÇÃO
  body.querySelector(".addDesp").onclick = () => { 
      data.despesas.push({nome:"", valor:0, checked:true}); 
      carregarAno(); 
  };
  
  body.querySelector(".addParcela").onclick = () => {
    const nome = prompt("Nome da despesa:");
    const valorTotal = parseValor(prompt("Valor TOTAL da compra:"));
    const numParcelas = parseInt(prompt("Quantidade de parcelas:"));
    if(nome && valorTotal > 0 && numParcelas > 0) {
      const valorPorMes = Number((valorTotal / numParcelas).toFixed(2));
      parcelasMemoria.push({ 
        id: Date.now(), 
        nome: nome, 
        valorParcela: valorPorMes, 
        parcelas: numParcelas, 
        inicio: index, 
        ano: Number(ano) 
      });
      aplicarParcelas();
      carregarAno();
    }
  };

  body.querySelector(".addEmp").onclick = () => { 
      if(!data.empresa) data.empresa=[]; 
      data.empresa.push({nome:"", valor:0, checked:true}); 
      carregarAno(); 
  };
  
  mes.appendChild(header); mes.appendChild(body);
  return mes;
}

// ================= ITENS DE LISTA =================

function criarItem(lista, d, dataArray, ano) {
  const div = document.createElement("div"); div.className = "item";
  div.innerHTML = `<input type="checkbox" ${d.checked?'checked':''}> <input class="nome inputPadrao" value="${d.nome}"> <input class="valor inputPadrao" value="${formatar(d.valor)}"> <button class="removeItem">×</button>`;
  const [check, nome, valor, btn] = div.children;
  
  check.onchange = () => { d.checked = check.checked; atualizarTudo(ano); };
  nome.onblur = () => { d.nome = nome.value; salvarDadosLocal(true); };
  nome.addEventListener("keydown", (e) => { if(e.key === "Enter") nome.blur(); });
  
  aplicarComportamentoInput(valor, () => d.valor, (v) => d.valor = v, ano);
  
  btn.onclick = () => { 
    if(d.parcelaId) {
      if(confirm("Deseja excluir todas as parcelas vinculadas a este item?")) {
        parcelasMemoria = parcelasMemoria.filter(p => p.id !== d.parcelaId);
        // Limpa de todos os meses/anos
        Object.keys(dados).forEach(a => {
           if(dados[a].meses) {
             dados[a].meses.forEach(m => {
               m.despesas = m.despesas.filter(item => item.parcelaId !== d.parcelaId);
             });
           }
        });
        carregarAno();
      }
    } else { 
      dataArray.splice(dataArray.indexOf(d), 1); 
      carregarAno(); 
    }
  };
  lista.appendChild(div);
}

// ================= UTILITÁRIOS =================

function formatar(v) { return "R$ " + (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 }); }
function parseValor(v) { if (!v) return 0; const limpo = v.toString().replace(/[^\d,.-]/g, "").replace(",", "."); return Number(limpo) || 0; }

function aplicarComportamentoInput(input, getV, setV, ano) {
  input.addEventListener("focus", () => { input.dataset.old = input.value; input.value = ""; });
  input.addEventListener("blur", () => {
    if (input.value.trim() === "") { input.value = input.dataset.old; } 
    else { const v = parseValor(input.value); setV(v); input.value = formatar(v); atualizarTudo(ano); }
  });
  input.addEventListener("keydown", (e) => { if(e.key === "Enter") input.blur(); });
}

// ================= FIREBASE =================

async function salvarFirebase() {
  const btn = document.getElementById("salvarNuvemBtn");
  if (!usuarioLogado) return;
  try {
    btn.innerText = "⌛ SALVANDO..."; btn.disabled = true;
    await setDoc(doc(db, "financas", usuarioLogado.uid), { dados, parcelasMemoria });
    btn.innerText = "✅ SALVO NA NUVEM";
    salvarDadosLocal(false);
  } catch (e) { btn.innerText = "❌ ERRO"; }
  finally { setTimeout(() => { btn.innerText = "☁️ SALVAR NA NUVEM"; btn.disabled = false; }, 2000); }
}

async function carregarFirebase() {
  if (!usuarioLogado) return;
  const snap = await getDoc(doc(db, "financas", usuarioLogado.uid));
  if (snap.exists()) {
    const cloud = snap.data();
    dados = cloud.dados || {};
    parcelasMemoria = cloud.parcelasMemoria || [];
    salvarDadosLocal(false);
  }
  carregarAno();
}

// ================= AUTH / BOOT =================

onAuthStateChanged(auth, async (user) => {
  if (user) {
    usuarioLogado = user;
    document.getElementById("displayEmail").textContent = `Autenticado como ${user.email}`;
    document.getElementById("authContainer").style.display = "none";
    document.getElementById("authContainer").style.display = "none";
    document.getElementById("appContainer").style.display = "block";
    await carregarFirebase();
  } else {
    usuarioLogado = null;
    document.getElementById("authContainer").style.display = "flex";
    document.getElementById("appContainer").style.display = "none";
  }
});

document.getElementById("loginBtn").onclick = async () => {
    const e = document.getElementById("email").value;
    const s = document.getElementById("senha").value;
    try { await signInWithEmailAndPassword(auth, e, s); } catch (err) { alert("Erro login."); }
};

document.getElementById("cadastroBtn").onclick = async () => {
    const e = document.getElementById("email").value;
    const s = document.getElementById("senha").value;
    try { 
        const cred = await createUserWithEmailAndPassword(auth, e, s);
        usuarioLogado = cred.user;
        dados = {}; parcelasMemoria = [];
        await salvarFirebase();
    } catch (err) { alert("Erro cadastro."); }
};

document.getElementById("logoutBtn").onclick = () => { 
    signOut(auth); localStorage.clear(); location.reload(); 
};

document.getElementById("salvarNuvemBtn").onclick = salvarFirebase;

document.getElementById("exportarTudoBtn").onclick = () => {
    const blob = new Blob([JSON.stringify({ dados, parcelasMemoria }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `backup.json`; a.click();
};

document.getElementById("inputImport").onchange = (e) => {
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onload = (ev) => {
        try {
            const j = JSON.parse(ev.target.result);
            if(j.dados) { 
                dados = j.dados; 
                parcelasMemoria = j.parcelasMemoria || []; 
                mesesAbertos.clear();
                carregarAno(); 
                alert("Importado com sucesso!"); 
            }
        } catch(err) { alert("Erro no arquivo."); }
    };
    reader.readAsText(file);
};

// ================= SUPORTE SISTEMA =================

function carregarAno() {
  const ano = document.getElementById("ano").value;
  if (!dados[ano]) dados[ano] = { meses: [] };
  const area = document.getElementById("areaAno");
  
  // Guardar estado dos meses antes de limpar o DOM
  mesesDOM.forEach(m => {
      if (!m.dom.classList.contains("collapsed")) mesesAbertos.add(m.index);
      else mesesAbertos.delete(m.index);
  });

  area.innerHTML = ""; mesesDOM = [];
  const container = document.createElement("div"); area.appendChild(container);
  
  const addBox = document.createElement("div"); addBox.className = "addMesBox";
  const btnAdd = document.createElement("button"); 
  btnAdd.innerText = dados[ano].meses.length >= 12 ? "✨ COMEÇAR NOVO ANO" : "+ ADICIONAR MÊS";
  btnAdd.onclick = () => adicionarMes(ano);
  addBox.appendChild(btnAdd); area.prepend(addBox);

  dados[ano].meses.forEach((m, i) => {
    const mDOM = criarMesDOM(ano, i, m);
    container.prepend(mDOM);
    mesesDOM.push({ dom: mDOM, index: i });
  });
  atualizarTudo(ano, false);
}

function adicionarMes(ano) {
  let anoNum = Number(ano);
  if (!dados[anoNum]) dados[anoNum] = { meses: [] };
  if (dados[anoNum].meses.length >= 12) {
    let novoAno = anoNum + 1;
    if (!dados[novoAno]) dados[novoAno] = { meses: [] };
    dados[novoAno].meses.push({ despesas: [], empresa: [], salario: 0, conta: 0, contaManual: false });
    document.getElementById("ano").value = novoAno;
  } else {
    dados[anoNum].meses.push({ despesas: [], empresa: [], salario: 0, conta: 0, contaManual: false });
  }
  aplicarParcelas();
  carregarAno();
}

function salvarDadosLocal(pendente = true) {
  localStorage.setItem("financas", JSON.stringify(dados));
  localStorage.setItem("parcelas", JSON.stringify(parcelasMemoria));
  const a = document.getElementById("statusAlteracao");
  if(a) a.style.display = pendente ? "inline" : "none";
}

function atualizarGrafico(ano) {
  if(!dados[ano] || !dados[ano].meses) return;
  const valores = dados[ano].meses.map(m => {
    const d = (m.despesas || []).filter(x => x.checked).reduce((acc, b) => acc + b.valor, 0);
    const e = (m.empresa || []).filter(x => x.checked).reduce((acc, b) => acc + b.valor, 0);
    return Number(((m.salario + m.conta + e) - d).toFixed(2));
  });
  if (chart) chart.updateSeries([{ data: valores }]);
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

const seletorAno = document.getElementById("ano");
for (let a = 2024; a <= 2035; a++) {
  const o = document.createElement("option"); o.value = a; o.text = a;
  if(a === hoje.getFullYear()) o.selected = true;
  seletorAno.appendChild(o);
}
seletorAno.onchange = carregarAno;

document.getElementById("showSignup").onclick = (e) => { e.preventDefault(); document.getElementById("loginActions").style.display = "none"; document.getElementById("signupActions").style.display = "block"; };
document.getElementById("showLogin").onclick = (e) => { e.preventDefault(); document.getElementById("signupActions").style.display = "none"; document.getElementById("loginActions").style.display = "block"; };