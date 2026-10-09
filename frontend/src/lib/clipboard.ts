/**
 * Copiar registros para colar no Excel (cabeçalho + valores), como uma cópia entre planilhas.
 * Vai para a área de transferência em dois formatos:
 *  - text/plain: TSV (tab entre colunas), números com vírgula decimal (Excel em PT-BR);
 *  - text/html: tabela que o Excel prefere ao colar — texto marcado como texto (mantém zeros à
 *    esquerda e códigos longos) e números com o valor exato em x:num (independe da vírgula/ponto).
 */

type Cell = unknown;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)?)?$/;

function text(v: Cell): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v).replace('.', ',');
  if (typeof v === 'boolean') return v ? 'VERDADEIRO' : 'FALSO';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

const tsvCell = (v: Cell) => {
  const s = text(v);
  return /[\t\r\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function htmlCell(v: Cell): string {
  if (typeof v === 'number' && Number.isFinite(v)) return `<td x:num="${v}">${esc(text(v))}</td>`;
  const s = text(v);
  // Datas ISO ficam para o Excel interpretar; o resto entra como texto (formato @).
  if (typeof v === 'string' && !ISO_DATE.test(v.trim()))
    return `<td style="mso-number-format:'\\@'">${esc(s)}</td>`;
  return `<td>${esc(s)}</td>`;
}

export function toTsv(headers: string[], rows: Cell[][]): string {
  return [headers, ...rows].map((r) => r.map(tsvCell).join('\t')).join('\r\n') + '\r\n';
}

export function toHtmlTable(headers: string[], rows: Cell[][]): string {
  const head = `<tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>`;
  const body = rows.map((r) => `<tr>${r.map(htmlCell).join('')}</tr>`).join('');
  return (
    `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head>` +
    `<body><table>${head}${body}</table></body></html>`
  );
}

/**
 * Copia a tabela produzida por `load` (assíncrono). O ClipboardItem com promessa mantém o gesto
 * do usuário (Ctrl+C) enquanto os dados chegam; sem suporte, cai no writeText.
 */
export async function copyTable(
  load: () => Promise<{ headers: string[]; rows: Cell[][] }>,
): Promise<number> {
  let count = 0;
  const data = load().then((t) => {
    count = t.rows.length;
    return t;
  });
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': data.then(
            (t) => new Blob([toTsv(t.headers, t.rows)], { type: 'text/plain' }),
          ),
          'text/html': data.then(
            (t) => new Blob([toHtmlTable(t.headers, t.rows)], { type: 'text/html' }),
          ),
        }),
      ]);
      return count;
    } catch (err) {
      // Erro ao carregar os dados: propaga; erro do navegador: tenta o writeText.
      await data;
      if (!navigator.clipboard?.writeText) throw err;
    }
  }
  const t = await data;
  await navigator.clipboard.writeText(toTsv(t.headers, t.rows));
  return t.rows.length;
}
