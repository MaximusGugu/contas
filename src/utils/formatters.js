export function formatar(v) {
  return "R$ " + (Number(v) || 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export function parseValor(v) {
  if (!v) return 0;
  if (typeof v === "number") return v;

  let str = v.toString();
  if (str.includes(".") && str.includes(",")) {
    str = str.replace(/\./g, "").replace(",", ".");
  } else {
    str = str.replace(",", ".");
  }

  const limpo = str.replace(/[^\d.]/g, "");
  return parseFloat(limpo) || 0;
}
