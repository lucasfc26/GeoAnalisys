/**
 * Janelas flutuantes destacadas em janelas próprias do sistema (podem ir para outro monitor). O
 * conteúdo continua sendo desenhado pelo React da janela principal (portal), então o estado é o
 * mesmo; aqui ficam as janelas abertas, para teclado e buscas por id alcançarem todas.
 */

/** Prefixo do nome das janelas: o programa desktop só deixa abrir janelas com ele. */
export const PANEL_WINDOW_PREFIX = 'geoanalisys-panel-';

const popups = new Set<Window>();
const keyHandlers = new Set<(e: KeyboardEvent) => void>();

let seq = 0;

/** Copia os estilos da janela principal (folhas carregadas e <style> do Vite) para a nova. */
function copyStyles(target: Document) {
  for (const node of document.head.querySelectorAll('link[rel="stylesheet"], style')) {
    if (node instanceof HTMLLinkElement) {
      const link = target.createElement('link');
      link.rel = 'stylesheet';
      link.href = node.href;
      target.head.appendChild(link);
    } else {
      const style = target.createElement('style');
      style.textContent = node.textContent;
      target.head.appendChild(style);
    }
  }
}

/**
 * Abre uma janela do sistema do tamanho do painel (`rect`, na tela da janela principal), na mesma
 * posição ou em `at` (coordenadas da tela, ex.: onde o painel foi solto), e devolve o elemento
 * onde desenhar. null = bloqueada (programa desktop antigo ou navegador sem permissão de pop-up).
 */
export function openPanelWindow(
  rect: DOMRect,
  title: string,
  at?: { x: number; y: number },
): { win: Window; root: HTMLElement } | null {
  const chromeTop = window.outerHeight - window.innerHeight;
  const left = at ? at.x : window.screenX + rect.left;
  const top = at ? at.y : window.screenY + chromeTop + rect.top;
  const features = [
    'popup=yes',
    `width=${Math.max(Math.round(rect.width), 320)}`,
    `height=${Math.max(Math.round(rect.height), 240)}`,
    `left=${Math.round(left)}`,
    `top=${Math.round(top)}`,
  ].join(',');
  const win = window.open('', `${PANEL_WINDOW_PREFIX}${++seq}`, features);
  if (!win) return null;
  const doc = win.document;
  doc.title = title;
  copyStyles(doc);
  doc.documentElement.lang = document.documentElement.lang;
  doc.body.style.margin = '0';
  const root = doc.createElement('div');
  root.style.height = '100vh';
  doc.body.appendChild(root);
  popups.add(win);
  for (const h of keyHandlers) win.addEventListener('keydown', h);
  return { win, root };
}

/** Fecha a janela destacada (se ainda estiver aberta) e a esquece. */
export function closePanelWindow(win: Window) {
  for (const h of keyHandlers) win.removeEventListener('keydown', h);
  popups.delete(win);
  if (!win.closed) win.close();
}

/** keydown na janela principal e em todas as destacadas (inclusive as abertas depois). */
export function onAnyKeydown(handler: (e: KeyboardEvent) => void): () => void {
  keyHandlers.add(handler);
  window.addEventListener('keydown', handler);
  for (const w of popups) w.addEventListener('keydown', handler);
  return () => {
    keyHandlers.delete(handler);
    window.removeEventListener('keydown', handler);
    for (const w of popups) w.removeEventListener('keydown', handler);
  };
}

/** getElementById na janela principal ou em alguma destacada. */
export function findElementById(id: string): HTMLElement | null {
  const here = document.getElementById(id);
  if (here) return here;
  for (const w of popups) {
    const el = w.closed ? null : w.document.getElementById(id);
    if (el) return el;
  }
  return null;
}

// Ao fechar/recarregar a janela principal, as destacadas vão junto.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    for (const w of [...popups]) closePanelWindow(w);
  });
}
