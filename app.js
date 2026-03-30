let dados = {};
let mesesDOM = [];
let chart;

// copiar/colar
let copiaDespesas = null;
let copiaEmpresa = null;

const nomesMesesFull = [
  "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
  "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"
];

const seletorAno = document.getElementById("ano");
const areaAno = document.getElementById("areaAno");

// ---------------- SAVE ----------------
function salvarDados() {
  localStorage.setItem("financas", JSON.stringify(dados));
}

function carregarDados() {
  const salvo = localStorage.getItem("financas");
  if (salvo) dados = JSON.parse(salvo);
}

// ---------------- EXPORT ----------------
function exportarAno() {
  const ano = seletorAno.value;

  const blob = new Blob(
    [JSON.stringify(dados[ano], null, 2)],
    { type: "application/json" }
  );

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `financas_${ano}.json`;
  a.click();
}

// ---------------- IMPORT ----------------
function importarAno(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();

  reader.onload = () => {
    try {
      dados[seletorAno.value] = JSON.parse(reader.result);
      salvarDados();
      carregarAno();
    } catch {
      alert("Arquivo inválido");
    }
  };

  reader.readAsText(file);
}

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
  return (Number(v)||0).toLocaleString("pt-BR",{minimumFractionDigits:2});
}

function parseValor(v) {
  return Number(v.replace(/\./g,"").replace(",", "."))||0;
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

  carregarEstados();
  atualizarTudo(ano);
  atualizarGrafico(ano);
}

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
      { nome: "Aluguel", valor: 1519, checked: true },
      { nome: "Crédito Nubank", valor: 0, checked: true },
      { nome: "Crédito Planetário", valor: 0, checked: true },
      { nome: "Fort", valor: 1000, checked: true },
      { nome: "Santander", valor: 385.25, checked: true },
      { nome: "DAS", valor: 81.90, checked: true },
      { nome: "Academia", valor: 130, checked: true }
    ],
    empresa: [],
    salario: 3902.29,
    conta: ultimoSaldo
  });

  salvarDados();
  carregarAno();
}

// ---------------- DOM ----------------
function criarMesDOM(ano, index, data) {

  const mes = document.createElement("div");
  mes.className = "mes";

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
  duplicarBtn.title = "Duplicar mês";
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
  removeBtn.title = "Remover mês";
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
        <button class="copyDesp" title="Copiar">📝</button>
        <button class="pasteDesp" title="Colar">📋</button>
      </div>
    </div>

    <div class="conteudoColuna">
      <div class="listaDesp"></div>
      <button class="addDesp" title="Adicionar">+</button>
    </div>

    <p class="rodapeColuna">
      Total: R$ <span class="totalDespesas">0,00</span>
    </p>
  </div>

  <div class="coluna dinheiro">

    <div class="topoColuna">
      <h4>DINHEIROS</h4>
      <div class="acoesTopo">
        <button class="copyEmp" title="Copiar">📝</button>
        <button class="pasteEmp" title="Colar">📋</button>
      </div>
    </div>

    <div class="conteudoColuna">
      Salário: <input class="salario"><br>
      Conta: <input class="conta"><br>

      <h5>OUTROS</h5>
      <div class="listaEmp"></div>
      <button class="addEmp">+</button>
    </div>

    <p class="rodapeColuna">
      Total: R$ <span class="totalDinheiro">0,00</span>
    </p>
  </div>
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
    salvarEstados();
  };

  const listaDesp = mesBody.querySelector(".listaDesp");
  const listaEmp = mesBody.querySelector(".listaEmp");

  function renderList(lista, arr) {
    lista.innerHTML = "";
    arr.forEach(d => criarItem(lista, d, arr));
  }

  renderList(listaDesp, data.despesas);
  renderList(listaEmp, data.empresa);

  // adicionar
  mesBody.querySelector(".addDesp").onclick = () => {
    const novo = {nome:"",valor:0,checked:false};
    data.despesas.push(novo);
    renderList(listaDesp, data.despesas);
    atualizarTudo(ano);
  };

  mesBody.querySelector(".addEmp").onclick = () => {
    const novo = {nome:"",valor:0,checked:false};
    data.empresa.push(novo);
    renderList(listaEmp, data.empresa);
    atualizarTudo(ano);
  };

  // copiar
  mesBody.querySelector(".copyDesp").onclick = () => {
    copiaDespesas = JSON.parse(JSON.stringify(data.despesas));
  };

  mesBody.querySelector(".copyEmp").onclick = () => {
    copiaEmpresa = JSON.parse(JSON.stringify(data.empresa));
  };

  // colar (SUBSTITUI)
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

  sal.oninput = e => { data.salario = parseValor(e.target.value); atualizarTudo(ano); };
  con.oninput = e => { data.conta = parseValor(e.target.value); atualizarTudo(ano); };

  return mes;
}

// ---------------- ITEM ----------------
function criarItem(lista, d, dataArray) {
  const div = document.createElement("div");
  div.className = "item";

  div.innerHTML = `<input type="checkbox"><input class="nome"><input class="valor"><button>x</button>`;
  const [check,nome,valor,btn] = div.children;
  btn.classList.add("removeItem");
  nome.classList.add("inputPadrao");
  valor.classList.add("inputPadrao");

  check.checked = d.checked;
  nome.value = d.nome;
  valor.value = formatar(d.valor);

  check.onchange = () => { d.checked = check.checked; atualizarTudo(seletorAno.value); };
  nome.oninput = () => d.nome = nome.value;
  valor.oninput = e => { d.valor = parseValor(e.target.value); atualizarTudo(seletorAno.value); };

  btn.onclick = () => {
    const index = dataArray.indexOf(d);
    if(index > -1) dataArray.splice(index,1);
    lista.removeChild(div);
    atualizarTudo(seletorAno.value);
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