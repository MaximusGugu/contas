export function aplicarTema(tema) {
  const temaAtivo = tema || "planetario";
  Array.from(document.body.classList).forEach((classe) => {
    if (classe.startsWith("theme-")) document.body.classList.remove(classe);
  });
  document.body.classList.add("theme-" + temaAtivo);
}
