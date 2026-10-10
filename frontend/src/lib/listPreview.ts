/**
 * Preview do modo lista: o link exibido num frame para o registro em análise. Vem de um atributo
 * (que já contém o link) ou de um modelo com {coluna} no lugar dos valores dos atributos.
 */

export interface PreviewConfig {
  mode: 'column' | 'template';
  /** Atributo com o link (modo "column") */
  column: string;
  /** Ex.: https://site/relatorio?id={ID}&tipo={tipo_lampada} (modo "template") */
  template: string;
}

export const DEFAULT_PREVIEW: PreviewConfig = { mode: 'column', column: '', template: '' };

/** Atributos citados no modelo ({coluna}). */
export function templateColumns(template: string): string[] {
  return [...template.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1].trim());
}

/** Sem protocolo (ex.: "www.site.com/x"): assume https. */
function withScheme(url: string): string {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
}

/**
 * Link do registro, ou o motivo de não haver um. Nomes de atributo no modelo não diferenciam
 * maiúsculas; atributo vazio entra como texto vazio.
 */
export function previewUrl(
  cfg: PreviewConfig,
  data: Record<string, unknown>,
): { url: string } | { error: string } {
  const lookup = (name: string): { found: boolean; value: unknown } => {
    if (name in data) return { found: true, value: data[name] };
    const key = Object.keys(data).find((k) => k.toLowerCase() === name.toLowerCase());
    return key === undefined ? { found: false, value: null } : { found: true, value: data[key] };
  };
  const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

  if (cfg.mode === 'column') {
    if (!cfg.column) return { error: 'Escolha o atributo com o link.' };
    const v = text(lookup(cfg.column).value);
    return v ? { url: withScheme(v) } : { error: `O atributo "${cfg.column}" está vazio.` };
  }

  const template = cfg.template.trim();
  if (!template) return { error: 'Escreva o link (use {atributo} para inserir valores).' };
  const unknown = templateColumns(template).filter((c) => !lookup(c).found);
  if (unknown.length) return { error: `Atributo inexistente no link: ${unknown.join(', ')}.` };
  const url = template.replace(/\{([^{}]+)\}/g, (_, name: string) =>
    text(lookup(name.trim()).value),
  );
  return { url: withScheme(url) };
}
