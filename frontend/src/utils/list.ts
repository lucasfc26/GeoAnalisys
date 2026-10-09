/**
 * Separa por quebra de linha, vírgula, ponto e vírgula, tabulação ou espaço e remove vazios.
 * `unique` remove repetidos (listas comparativas mantêm, pois são pareadas por posição).
 */
/**
 * Ordem de exibição escolhida pelo usuário: primeiro os nomes de `saved` que ainda existem, depois
 * os demais na ordem original (colunas novas vão para o fim).
 */
export function applyOrder(names: string[], saved: string[] | undefined): string[] {
  if (!saved?.length) return names;
  const set = new Set(names);
  const head = saved.filter((n) => set.has(n));
  const inHead = new Set(head);
  return [...head, ...names.filter((n) => !inHead.has(n))];
}

/** Move o item `from` para a posição de `to` (arrastar e soltar). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const out = [...list];
  const [it] = out.splice(from, 1);
  out.splice(to, 0, it);
  return out;
}

export function parseList(text: string, unique = true): string[] {
  const values = text.split(/[\s,;]+/).map((v) => v.trim()).filter(Boolean);
  return unique ? [...new Set(values)] : values;
}
