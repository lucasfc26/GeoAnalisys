import type { Map as MlMap } from 'maplibre-gl';

/**
 * Arrastar o mapa segurando o botão do meio (rodinha), em qualquer ferramenta — inclusive nas que
 * desligam o arraste normal (retângulo, mover/duplicar). Devolve a função que remove os eventos.
 */
export function enableMiddlePan(map: MlMap): () => void {
  const container = map.getCanvasContainer();
  let last: { x: number; y: number } | null = null;
  let cursor = '';
  let frame = 0;
  let dx = 0;
  let dy = 0;

  const flush = () => {
    frame = 0;
    if (dx || dy) map.panBy([dx, dy], { animate: false });
    dx = 0;
    dy = 0;
  };
  const move = (e: MouseEvent) => {
    if (!last) return;
    // panBy desloca o centro: arrastar para a direita = centro vai para a esquerda.
    dx -= e.clientX - last.x;
    dy -= e.clientY - last.y;
    last = { x: e.clientX, y: e.clientY };
    if (!frame) frame = requestAnimationFrame(flush);
  };
  const up = (e: MouseEvent) => {
    if (e.button !== 1 || !last) return;
    last = null;
    cancelAnimationFrame(frame);
    flush();
    map.getCanvas().style.cursor = cursor;
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
  };
  const down = (e: MouseEvent) => {
    if (e.button !== 1) return;
    // Sem o "auto-scroll" do navegador (ícone de setas do botão do meio).
    e.preventDefault();
    map.stop();
    last = { x: e.clientX, y: e.clientY };
    cursor = map.getCanvas().style.cursor;
    map.getCanvas().style.cursor = 'grabbing';
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  // No Linux o clique do meio cola a área de transferência; aqui ele só arrasta.
  const aux = (e: MouseEvent) => {
    if (e.button === 1) e.preventDefault();
  };

  container.addEventListener('mousedown', down);
  container.addEventListener('auxclick', aux);
  return () => {
    container.removeEventListener('mousedown', down);
    container.removeEventListener('auxclick', aux);
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    cancelAnimationFrame(frame);
  };
}
