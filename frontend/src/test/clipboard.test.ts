import { describe, expect, it } from 'vitest';
import { toHtmlTable, toTsv } from '@/lib/clipboard';

describe('copiar para o Excel', () => {
  const headers = ['ID', 'setor', 'potencia', 'obs'];
  const rows = [
    [1, '261160605000123', 1.5, 'a\tb'],
    [2, '007', null, 'diz "oi"'],
  ];

  it('TSV com cabeçalho, vírgula decimal e aspas quando preciso', () => {
    expect(toTsv(headers, rows)).toBe(
      'ID\tsetor\tpotencia\tobs\r\n' +
        '1\t261160605000123\t1,5\t"a\tb"\r\n' +
        '2\t007\t\t"diz ""oi"""\r\n',
    );
  });

  it('HTML: números com x:num e textos como texto (mantém zeros e códigos longos)', () => {
    const html = toHtmlTable(headers, rows);
    expect(html).toContain('<th>setor</th>');
    expect(html).toContain('<td x:num="1.5">1,5</td>');
    expect(html).toContain(`<td style="mso-number-format:'\\@'">007</td>`);
    expect(html).toContain('diz &quot;oi&quot;');
  });
});
