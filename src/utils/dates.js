export function getMesReferenciaAtivo(configuracoes, hoje = new Date()) {
  const diaV = parseInt(configuracoes.diaVirada) || 1;
  const refMes = configuracoes.referenciaMes || "atual";
  const baseDate = new Date(hoje);

  if (refMes === "proximo") baseDate.setMonth(baseDate.getMonth() + 1);

  let mesAt = baseDate.getMonth();
  let anoAt = baseDate.getFullYear();

  if (hoje.getDate() < diaV) {
    mesAt--;
    if (mesAt < 0) {
      mesAt = 11;
      anoAt--;
    }
  }

  return { mesAt, anoAt };
}
