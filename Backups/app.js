let dados = {};
let mesesDOM = [];
let chart;

// Variáveis temporárias para copiar/colar
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

// ---------------- SAVE COLLAPSE STATE ----------------
function salvarEstados() {
  const estados = mesesDOM.map(({dom}, i) => dom.classList.contains("collapsed"));
  localStorage.setItem("estadosAccordion", JSON.stringify(estados));
}

function carregarEstados() {
  const estados = JSON.parse(localStorage.getItem("estadosAccordion")||"[]");
  mesesDOM.forEach(({dom}, i) => {
    if (estados[i]) dom.classList.add("collapsed");
    else dom.classList.remove("collapsed");
  });
}

// ---------------- EXPORT ----------------
function exportarAno() {
  const ano = seletorAno.value;
  const blob = new Blob([JSON.stringify(dados[ano])], {type:"text/plain"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `ano_${ano}.txt`;
  a.click();
}

// ---------------- IMPORT ----------------
function importarAno(e) {
  const file = e.target.files[0];
  const reader = new FileReader();

  reader.onload = () => {
    dados[seletorAno.value] = JSON.parse(reader.result);
    salvarDados();
    carregarAno();
  };

  reader.readAsText(file);
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
  wrapper.id = "mainContent";

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
        + meses[meses.length - 1].empresa?.reduce((a,b)=>a+b.valor,0) || 0)
        - meses[meses.length - 1].despesas?.reduce((a,b)=>a+b.valor,0) || 0)
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
  mesHeader.innerHTML = `<span class="mesNome">${nomesMesesFull[index]} ${ano}</span>`;

  const headerRight = document.createElement("div");
  headerRight.className = "headerRight";

  const mesTotal = document.createElement("span");
  mesTotal.className = "mesTotal";
  mesTotal.innerText = "R$ 0,00";

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
  headerRight.appendChild(removeBtn);
  mesHeader.appendChild(headerRight);

  const mesBody = document.createElement("div");
  mesBody.className = "mesBody";
  mesBody.innerHTML = `
    <div class="container">
      <div class="coluna despesas">
        <h4>DESPESAS</h4>
        <div class="listaDesp"></div>
        <button class="addDesp">+</button>
        <button class="copyDesp">📝</button>
        <button class="pasteDesp">📋</button>
        <p>Total: R$ <span class="totalDespesas">0,00</span></p>
      </div>

      <div class="coluna dinheiro">
        <h4>DINHEIROS</h4>
        Salário: <input class="salario"><br>
        Conta: <input class="conta"><br>

        <h5>PLANETÁRIO</h5>
        <div class="listaEmp"></div>
        <button class="addEmp">+</button>
        <button class="copyEmp">📝</button>
        <button class="pasteEmp">📋</button>

        <p>Total: R$ <span class="totalDinheiro">0,00</span></p>
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

  data.despesas.forEach(d => criarItem(listaDesp, d, data.despesas));
  data.empresa?.forEach(d => criarItem(listaEmp, d, data.empresa));

  // copiar/colar despesas
  mesBody.querySelector(".copyDesp").onclick = () => { copiaDespesas = JSON.parse(JSON.stringify(data.despesas)); };
  mesBody.querySelector(".pasteDesp").onclick = () => {
    if(copiaDespesas) {
      copiaDespesas.forEach(d => {
        const novo = {...d}; data.despesas.push(novo); criarItem(listaDesp, novo, data.despesas);
      });
      atualizarTudo(ano);
    }
  };

  // copiar/colar empresa
  mesBody.querySelector(".copyEmp").onclick = () => { copiaEmpresa = JSON.parse(JSON.stringify(data.empresa)); };
  mesBody.querySelector(".pasteEmp").onclick = () => {
    if(copiaEmpresa) {
      copiaEmpresa.forEach(d => {
        const novo = {...d}; data.empresa.push(novo); criarItem(listaEmp, novo, data.empresa);
      });
      atualizarTudo(ano);
    }
  };

  const sal = mesBody.querySelector(".salario");
  const con = mesBody.querySelector(".conta");

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

    let despesas = data.despesas.filter(d=>d.checked).reduce((a,b)=>a+b.valor,0);
    let empresa = data.empresa?.filter(d=>d.checked).reduce((a,b)=>a+b.valor,0)||0;
    let dinheiro = data.salario + data.conta + empresa;
    let saldo = dinheiro - despesas;

    dom.querySelector(".totalDespesas").textContent = formatar(despesas);
    dom.querySelector(".totalDinheiro").textContent = formatar(dinheiro);
    dom.querySelector(".saldo").textContent = formatar(saldo);
    dom.querySelector(".mesTotal").textContent = formatar(saldo);
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

  if (chart) chart.updateSeries([{ name: "Balanço", data: valores }]);
  else {
    chart = new ApexCharts(document.querySelector("#grafico"), {
      chart: { type: "bar", height: 300 },
      series: [{ name: "Balanço", data: valores }],
      xaxis: { categories: meses.map((_, i) => nomesMesesFull[i].slice(0,3).toUpperCase()) }
    });
    chart.render();
  }
}