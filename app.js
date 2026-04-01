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
let senhaDoUsuario = sessionStorage.getItem("temp_key") || ""; 
let dados = {};
let parcelasMemoria = [];
let mesesDOM = [];
let chart = null;
let mesesAbertos = new Set(); 
let contasFixas = JSON.parse(localStorage.getItem("contasFixas")) || [];
let categorias = JSON.parse(localStorage.getItem("categorias")) || ["Essencial", "Alimentação", "Cartões", "Contas"];
let sortableFixas = null; // Instância global do Sortable

const hoje = new Date();
const nomesMesesFull = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

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

// ================= MOTOR DE CÁLCULO =================

function atualizarTudo(anoParaVisualizar, pendente = true) {
  const anosOrdenados = Object.keys(dados).map(Number).sort((a, b) => a - b);
  let saldoAcumulado = 0;
  let ehOPrimeiroMesDeTodos = true;

  anosOrdenados.forEach(ano => {
    if (!dados[ano].meses) return;
    dados[ano].meses.forEach((m, idx) => {
      if (!ehOPrimeiroMesDeTodos && m.contaManual !== true) m.conta = saldoAcumulado;
      const dTotal = (m.despesas || []).filter(x => x.checked).reduce((acc, b) => acc + b.valor, 0);
      const eTotal = (m.empresa || []).filter(x => x.checked).reduce((acc, b) => acc + b.valor, 0);
      const totalDisponivel = (m.salario || 0) + (m.conta || 0) + eTotal;
      const saldoFinal = totalDisponivel - dTotal;
      saldoAcumulado = saldoFinal;
      ehOPrimeiroMesDeTodos = false;

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

function aplicarParcelas() {
  parcelasMemoria.forEach(p => {
    if (!dados[p.ano]) return;
    const meses = dados[p.ano].meses;
    for (let i = 0; i < p.parcelas; i++) {
      const idx = p.inicio + i;
      if (!meses[idx]) continue;
      const nomeP = `${p.nome} (${i+1}/${p.parcelas})`;
      if (!meses[idx].despesas.some(d => d.parcelaId === p.id && d.nome === nomeP)) {
        meses[idx].despesas.push({ nome: nomeP, valor: p.valorParcela, checked: true, parcelaId: p.id });
      }
    }
  });
}

function adicionarMes(ano) {
  let anoNum = Number(ano);
  if (!dados[anoNum]) dados[anoNum] = { meses: [] };
  const mesesArray = dados[anoNum].meses;
  const novoMesIndice = mesesArray.length;

  let novoMes = { despesas: [], empresa: [], salario: 0, conta: 0, contaManual: false };

  contasFixas.forEach(cf => {
    if (cf.ativo) {
      let deveAdicionar = false;
      const intervalo = parseInt(cf.intervalo) || 1;
      if (cf.frequencia === "mensal") deveAdicionar = true;
      else if (cf.frequencia === "bimestral") deveAdicionar = (novoMesIndice % 2 === 0);
      else if (cf.frequencia === "anual") deveAdicionar = (novoMesIndice === 0);
      else if (cf.frequencia === "personalizado") deveAdicionar = (novoMesIndice % intervalo === 0);

      if (deveAdicionar) {
        novoMes.despesas.push({ nome: cf.nome, valor: cf.valor || 0, checked: true, categoria: cf.categoria });
      }
    }
  });

  if (mesesArray.length >= 12) {
    let novoAnoNum = anoNum + 1;
    if (!dados[novoAnoNum]) dados[novoAnoNum] = { meses: [] };
    dados[novoAnoNum].meses.push(novoMes);
    seletorAno.value = novoAnoNum;
  } else {
    mesesArray.push(novoMes);
  }
  aplicarParcelas();
  carregarAno();
}

// ================= GESTÃO DE CONTAS FIXAS (FIXED DRAG & DROP) =================

function renderContasFixas() {
  const lista = document.getElementById("listaContasFixas");
  if (!lista) return;

  // Destruir instância anterior do Sortable antes de recriar o HTML
  if (sortableFixas) {
    sortableFixas.destroy();
    sortableFixas = null;
  }

  lista.innerHTML = "";

  contasFixas.forEach((cf) => {
    // IMPORTANTE: Garantir que cada item tenha um ID único para o Sortable
    if (!cf.id) cf.id = Date.now() + Math.random();

    const div = document.createElement("div");
    div.className = "item item-fixo";
    div.setAttribute("data-id", cf.id);
    
    div.innerHTML = `
      <div class="drag-handle">☰</div>
      <input type="checkbox" ${cf.ativo ? 'checked' : ''} class="check-fixo">
      <input type="text" class="inputPadrao nome-fixo" value="${cf.nome}" placeholder="Nome" style="flex:2">
      <input type="text" class="inputPadrao valor-fixo" value="${cf.valor > 0 ? formatar(cf.valor) : ''}" placeholder="Valor" style="width:110px">
      <select class="inputPadrao cat-fixo" style="width:110px">
        ${categorias.map(c => `<option value="${c}" ${cf.categoria === c ? 'selected' : ''}>${c}</option>`).join('')}
      </select>
      <select class="inputPadrao freq-fixo" style="width:110px">
        <option value="mensal" ${cf.frequencia === 'mensal' ? 'selected' : ''}>Mensal</option>
        <option value="bimestral" ${cf.frequencia === 'bimestral' ? 'selected' : ''}>Bimestral</option>
        <option value="anual" ${cf.frequencia === 'anual' ? 'selected' : ''}>Anual</option>
        <option value="personalizado" ${cf.frequencia === 'personalizado' ? 'selected' : ''}>A cada X meses</option>
      </select>
      ${cf.frequencia === 'personalizado' ? `<input type="number" class="inputPadrao int-fixo" value="${cf.intervalo || 2}" style="width:50px">` : ''}
      <button class="removeItem">×</button>
    `;

    // Eventos usando seletores de classe para evitar erros de índice
    div.querySelector('.check-fixo').onchange = (e) => { cf.ativo = e.target.checked; salvarDadosLocal(); };
    div.querySelector('.nome-fixo').onblur = (e) => { cf.nome = e.target.value; salvarDadosLocal(); };
    div.querySelector('.valor-fixo').onblur = (e) => { cf.valor = parseValor(e.target.value); e.target.value = formatar(cf.valor); salvarDadosLocal(); };
    div.querySelector('.cat-fixo').onchange = (e) => { cf.categoria = e.target.value; salvarDadosLocal(); };
    div.querySelector('.freq-fixo').onchange = (e) => { cf.frequencia = e.target.value; renderContasFixas(); salvarDadosLocal(); };
    
    if (cf.frequencia === 'personalizado') {
        div.querySelector('.int-fixo').onblur = (e) => { cf.intervalo = e.target.value; salvarDadosLocal(); };
    }

    div.querySelector('.removeItem').onclick = () => { 
      contasFixas = contasFixas.filter(c => c.id !== cf.id); 
      renderContasFixas(); 
      salvarDadosLocal(); 
    };

    lista.appendChild(div);
  });

  // Inicializar Sortable com uma pequena espera para garantir o DOM
  setTimeout(() => {
    sortableFixas = Sortable.create(lista, {
      handle: '.drag-handle',
      animation: 150,
      ghostClass: 'sortable-ghost',
      onEnd: () => {
        const novaOrdem = [];
        lista.querySelectorAll('.item-fixo').forEach(itemDOM => {
          const id = itemDOM.getAttribute("data-id");
          const conta = contasFixas.find(c => c.id.toString() === id);
          if (conta) novaOrdem.push(conta);
        });
        contasFixas = novaOrdem;
        salvarDadosLocal();
      }
    });
  }, 10);
}

// ================= INTERFACE DOM MESES =================

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
  header.querySelector(".duplicarMes").onclick = (e) => { e.stopPropagation(); dados[ano].meses.splice(index + 1, 0, JSON.parse(JSON.stringify(data))); carregarAno(); };
  header.querySelector(".removeMes").onclick = (e) => { e.stopPropagation(); if(confirm("Excluir mês?")) { dados[ano].meses.splice(index, 1); carregarAno(); } };

  const body = document.createElement("div"); body.className = "mesBody";
  body.innerHTML = `
    <div class="container">
        <div class="coluna despesas">
            <div class="topoColuna"><h4>DESPESAS</h4></div>
            <div class="conteudoColuna"><div class="listaDesp"></div><div class="acoesDesp"><button class="addDesp">+ Despesa</button><button class="addParcela">+ Parcela</button></div></div>
            <p class="rodapeColuna">Total: <span class="totalDespesas">0,00</span></p>
        </div>
        <div class="coluna dinheiro">
            <div class="topoColuna"><h4>DINHEIROS</h4></div>
            <div class="conteudoColuna"><div class="linhaInputs"><div class="campo"><label>Salário</label><input type="text" class="salario inputPadrao"></div><div class="campo"><label>Conta</label><input type="text" class="conta inputPadrao"></div><button class="btn-cascata" title="Vincular meses seguintes">🔗</button></div><h5>OUTROS</h5><div class="listaEmp"></div><button class="addEmp inputPadrao" style="height:35px; cursor:pointer">+</button></div>
            <p class="rodapeColuna">Total: <span class="totalDinheiro">0,00</span></p>
        </div>
    </div><div class="totalFinal">TOTAL: <span class="saldo">0,00</span></div>`;

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
  body.querySelector(".addDesp").onclick = () => { data.despesas.push({nome:"", valor:0, checked:true}); carregarAno(); };
  body.querySelector(".addParcela").onclick = () => {
    const nome = prompt("Nome da despesa:");
    const valorTotal = parseValor(prompt("Valor TOTAL da compra:"));
    const numParcelas = parseInt(prompt("Quantidade de parcelas:"));
    if(nome && valorTotal > 0 && numParcelas > 0) {
      parcelasMemoria.push({ id: Date.now(), nome: nome, valorParcela: Number((valorTotal / numParcelas).toFixed(2)), parcelas: numParcelas, inicio: index, ano: Number(ano) });
      aplicarParcelas(); carregarAno();
    }
  };
  body.querySelector(".addEmp").onclick = () => { if(!data.empresa) data.empresa=[]; data.empresa.push({nome:"", valor:0, checked:true}); carregarAno(); };
  mes.appendChild(header); mes.appendChild(body);
  return mes;
}

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
      if(confirm("Deseja excluir todas as parcelas vinculadas?")) {
        parcelasMemoria = parcelasMemoria.filter(p => p.id !== d.parcelaId);
        Object.keys(dados).forEach(a => { if(dados[a].meses) dados[a].meses.forEach(m => { m.despesas = m.despesas.filter(item => item.parcelaId !== d.parcelaId); }); });
        carregarAno();
      }
    } else { dataArray.splice(dataArray.indexOf(d), 1); carregarAno(); }
  };
  lista.appendChild(div);
}

// ================= CATEGORIAS MODAL =================

function renderCategoriasModal() {
  const lista = document.getElementById("listaCategoriasModal");
  if (!lista) return;
  lista.innerHTML = "";
  categorias.forEach((cat, index) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${cat}</span><div><button class="btn-acao-lista" onclick="renomearCategoria(${index})">✏️</button><button class="btn-acao-lista btn-excluir-modal" onclick="removerCategoria(${index})">×</button></div>`;
    lista.appendChild(li);
  });
}

window.removerCategoria = (index) => { if (confirm(`Excluir categoria?`)) { categorias.splice(index, 1); renderCategoriasModal(); salvarDadosLocal(); } };
window.renomearCategoria = (index) => { const novo = prompt("Novo nome:", categorias[index]); if (novo) { categorias[index] = novo; renderCategoriasModal(); salvarDadosLocal(); } };

// ================= FIREBASE E PERSISTÊNCIA =================

function salvarDadosLocal(pendente = true) {
  localStorage.setItem("financas", JSON.stringify(dados));
  localStorage.setItem("parcelas", JSON.stringify(parcelasMemoria));
  localStorage.setItem("contasFixas", JSON.stringify(contasFixas));
  localStorage.setItem("categorias", JSON.stringify(categorias));
  const a = document.getElementById("statusAlteracao");
  if(a) a.style.display = pendente ? "inline" : "none";
}

async function salvarFirebase() {
  const btn = document.getElementById("salvarNuvemBtn");
  if (!usuarioLogado || !senhaDoUsuario) return alert("Erro: Senha não encontrada.");
  try {
    btn.innerText = "⌛ SALVANDO..."; btn.disabled = true;
    const pacote = await encryptData({ dados, parcelasMemoria, contasFixas, categorias }, senhaDoUsuario);
    await setDoc(doc(db, "financas", usuarioLogado.uid), pacote);
    btn.innerText = "✅ SALVO NA NUVEM";
    salvarDadosLocal(false);
  } catch (e) { btn.innerText = "❌ ERRO"; }
  finally { setTimeout(() => { btn.innerText = "☁️ SALVAR NA NUVEM"; btn.disabled = false; }, 2000); }
}

async function carregarFirebase(senha) {
  if (!usuarioLogado) return;
  try {
    const snap = await getDoc(doc(db, "financas", usuarioLogado.uid));
    if (snap.exists()) {
      const res = await decryptData(snap.data(), senha);
      dados = res.dados || {};
      parcelasMemoria = res.parcelasMemoria || [];
      contasFixas = res.contasFixas || [];
      categorias = res.categorias || ["Essencial", "Alimentação", "Cartões", "Contas"];
      salvarDadosLocal(false);
    }
  } catch (e) { alert("Senha incorreta."); }
  carregarAno();
  renderContasFixas();
}

onAuthStateChanged(auth, async (user) => {
  if (user) {
    usuarioLogado = user;
    document.getElementById("displayEmail").textContent = `Autenticado como ${user.email}`;
    document.getElementById("authContainer").style.display = "none";
    document.getElementById("appContainer").style.display = "block";
    if (senhaDoUsuario) await carregarFirebase(senhaDoUsuario);
    else carregarAno();
  } else {
    usuarioLogado = null;
    document.getElementById("authContainer").style.display = "flex";
    document.getElementById("appContainer").style.display = "none";
  }
});

// ================= UTILITÁRIOS E EVENTOS =================

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

document.getElementById("loginBtn").onclick = async () => {
    const e = document.getElementById("email").value;
    const s = document.getElementById("senha").value;
    try { 
        await signInWithEmailAndPassword(auth, e, s); 
        senhaDoUsuario = s;
        sessionStorage.setItem("temp_key", s);
    } catch (err) { alert("Erro login."); }
};

document.getElementById("cadastroBtn").onclick = async () => {
    const e = document.getElementById("email").value;
    const s = document.getElementById("senha").value;
    try { 
        await createUserWithEmailAndPassword(auth, e, s);
        senhaDoUsuario = s;
        sessionStorage.setItem("temp_key", s);
        dados = {}; parcelasMemoria = []; contasFixas = [];
        await salvarFirebase();
    } catch (err) { alert("Erro cadastro."); }
};

document.getElementById("logoutBtn").onclick = () => { signOut(auth); localStorage.clear(); sessionStorage.clear(); location.reload(); };
document.getElementById("salvarNuvemBtn").onclick = salvarFirebase;
document.getElementById("exportarTudoBtn").onclick = () => {
    const blob = new Blob([JSON.stringify({ dados, parcelasMemoria, contasFixas, categorias }, null, 2)], { type: "application/json" });
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
                dados = j.dados; parcelasMemoria = j.parcelasMemoria || []; 
                contasFixas = j.contasFixas || []; categorias = j.categorias || categorias;
                mesesAbertos.clear(); carregarAno(); renderContasFixas(); alert("Importado!"); 
            }
        } catch(err) { alert("Erro no arquivo."); }
    };
    reader.readAsText(file);
};

document.getElementById("btnAddContaFixa").onclick = () => {
  contasFixas.push({ id: Date.now(), nome: "", valor: 0, ativo: true, categoria: categorias[0], frequencia: "mensal", intervalo: 1 });
  renderContasFixas();
};

document.getElementById("btnGerenciarCategorias").onclick = () => { document.getElementById("modalCategorias").style.display = "flex"; renderCategoriasModal(); };
document.getElementById("btnFecharModal").onclick = () => { document.getElementById("modalCategorias").style.display = "none"; renderContasFixas(); };
document.getElementById("btnAddCategoria").onclick = () => {
  const input = document.getElementById("novaCategoriaNome");
  const nome = input.value.trim();
  if (nome && !categorias.includes(nome)) { categorias.push(nome); input.value = ""; renderCategoriasModal(); salvarDadosLocal(); }
};
document.getElementById("headerContasFixas").onclick = () => { document.getElementById("moduloContasFixas").classList.toggle("collapsed"); };

function carregarAno() {
  const ano = document.getElementById("ano").value;
  if (!dados[ano]) dados[ano] = { meses: [] };
  const area = document.getElementById("areaAno");
  mesesDOM.forEach(m => { if (!m.dom.classList.contains("collapsed")) mesesAbertos.add(m.index); else mesesAbertos.delete(m.index); });
  area.innerHTML = ""; mesesDOM = [];
  const container = document.createElement("div"); area.appendChild(container);
  const addBox = document.createElement("div"); addBox.className = "addMesBox";
  const btnAdd = document.createElement("button"); 
  btnAdd.innerText = dados[ano].meses.length >= 12 ? "✨ COMEÇAR NOVO ANO" : "+ ADICIONAR MÊS";
  btnAdd.onclick = () => adicionarMes(ano);
  addBox.appendChild(btnAdd); area.prepend(addBox);
  dados[ano].meses.forEach((m, i) => { const mDOM = criarMesDOM(ano, i, m); container.prepend(mDOM); mesesDOM.push({ dom: mDOM, index: i }); });
  atualizarTudo(ano, false);
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