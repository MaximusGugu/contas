export function aplicarTema(tema) {
  const temaAtivo = tema || "planetario";
  document.body.className = "theme-" + temaAtivo;
}
