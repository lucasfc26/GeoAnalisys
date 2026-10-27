/**
 * Preview do modo lista: o link exibido num frame para o registro em análise. Vem de um atributo
 * (que já contém o link), de um modelo com {coluna} no lugar dos valores dos atributos ou do Street
 * View na coordenada do ponto.
 */

export interface PreviewConfig {
  mode: 'column' | 'template' | 'streetview';
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

/** Street View sem chave de API (formato embutível) e o link equivalente para abrir no Google Maps. */
export function streetViewUrls(lat: number, lng: number): { url: string; external: string } {
  const at = `${lat},${lng}`;
  return {
    url: `https://maps.google.com/maps?layer=c&cbll=${at}&cbp=11,0,0,0,0&output=svembed`,
    external: `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${at}`,
  };
}

/**
 * Link do registro, ou o motivo de não haver um. `external` (opcional) é o link para abrir fora do
 * sistema, quando difere do exibido no frame. Nomes de atributo no modelo não diferenciam
 * maiúsculas; atributo vazio entra como texto vazio.
 */
export function previewUrl(
  cfg: PreviewConfig,
  data: Record<string, unknown>,
  coord?: { lat: number | null; lng: number | null },
): { url: string; external?: string } | { error: string } {
  if (cfg.mode === 'streetview') {
    if (coord?.lat == null || coord?.lng == null) return { error: 'O ponto não tem coordenadas.' };
    return streetViewUrls(coord.lat, coord.lng);
  }

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
