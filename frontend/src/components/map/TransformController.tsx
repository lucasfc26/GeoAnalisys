import { useQueryClient } from '@tanstack/react-query';
import type { MapMouseEvent } from 'maplibre-gl';
import { Check, Copy, Move, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { queryKeys, useSelectedIds } from '@/hooks/useSourceData';
import { errorMessage } from '@/lib/api';
import { eventLatLng, useMap } from '@/lib/mapContext';
import { pointsService } from '@/services/points';
import { useAppStore } from '@/stores/appStore';
import type { LatLng } from '@/types';
import { fmtInt } from '@/utils/format';
import { distanceM, fmtDistance } from '@/utils/geo';
import { Button } from '../ui/Button';
import { toast } from '../ui/Toaster';
import { worldScaleOf, worldX, worldY, type PointsOverlayApi } from './pointsOverlay';

/** Raio (px) para "pegar" um ponto selecionado com o mouse. */
const HIT_PX = 10;

interface Offset {
  dLat: number;
  dLng: number;
}

const ZERO: Offset = { dLat: 0, dLng: 0 };

/**
 * Mover/duplicar a seleção: arraste um ponto selecionado (ou clique no destino) para posicionar
 * a prévia e confirme. O deslocamento é aplicado igualmente a todos os registros selecionados.
 */
export function TransformController({
  overlay,
  sourceId,
}: {
  overlay: RefObject<PointsOverlayApi | null>;
  sourceId: string | null;
}) {
  const map = useMap();
  const mode = useAppStore((s) => s.transform);
  const selection = useAppStore((s) => s.selection);
  const setTransform = useAppStore((s) => s.setTransform);
  const setSelection = useAppStore((s) => s.setSelection);
  const ids = useSelectedIds();
  const qc = useQueryClient();
  const groups = useMemo(() => Object.values(selection), [selection]);
  const [offset, setOffset] = useState<Offset>(ZERO);
  const [anchor, setAnchor] = useState<LatLng | null>(null);
  const [saving, setSaving] = useState(false);
  const [observation, setObservation] = useState('');
  const state = useRef({ offset, anchor, groups });
  state.current = { offset, anchor, groups };

  // Nova seleção ou novo modo: recomeça do zero.
  useEffect(() => {
    setOffset(ZERO);
    setAnchor(groups[0] ? { lat: groups[0].lat, lng: groups[0].lng } : null);
  }, [mode, groups]);

  // Prévia no canvas.
  useEffect(() => {
    const o = overlay.current;
    if (!o) return;
    o.setGhost(mode && anchor && groups.length ? { points: groups, anchor, ...offset } : null);
  }, [overlay, mode, anchor, groups, offset]);
  useEffect(() => () => overlay.current?.setGhost(null), [overlay]);

  // Arraste / clique no destino.
  useEffect(() => {
    if (!map || !mode) return;
    let drag: { start: LatLng; base: Offset } | null = null;
    let hovering = false;
    let suppressClick = false;
    const canvas = map.getCanvas();

    /** Sobre um ponto selecionado: o arraste move os pontos (não o mapa). */
    const setGrab = (on: boolean) => {
      hovering = on;
      if (on) map.dragPan.disable();
      else map.dragPan.enable();
      canvas.style.cursor = on ? 'move' : 'crosshair';
    };
    canvas.style.cursor = 'crosshair';

    /** Ponto selecionado (na posição atual da prévia) sob o mouse. */
    const hit = (ll: LatLng): LatLng | null => {
      const s = worldScaleOf(map.getZoom());
      const { offset: o, groups: gs } = state.current;
      const mx = worldX(ll.lng);
      const my = worldY(ll.lat);
      let best: LatLng | null = null;
      let bestD = HIT_PX * HIT_PX;
      for (const g of gs) {
        let dx = worldX(g.lng + o.dLng) - mx;
        if (dx > 128) dx -= 256;
        else if (dx < -128) dx += 256;
        const dy = worldY(g.lat + o.dLat) - my;
        const d = (dx * dx + dy * dy) * s * s;
        if (d <= bestD) {
          bestD = d;
          best = g;
        }
      }
      return best;
    };

    const down = (e: MapMouseEvent) => {
      if ((e.originalEvent as MouseEvent).button !== 0) return; // botão do meio arrasta o mapa
      const ll = eventLatLng(e);
      const g = hit(ll);
      if (!g) return;
      suppressClick = true;
      drag = { start: ll, base: state.current.offset };
      setAnchor({ lat: g.lat, lng: g.lng });
    };
    let frame = 0;
    let last: LatLng | null = null;
    const move = (e: MapMouseEvent) => {
      last = eventLatLng(e);
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const ll = last;
        if (!ll) return;
        if (drag) {
          const { start, base } = drag;
          setOffset({ dLat: base.dLat + ll.lat - start.lat, dLng: base.dLng + ll.lng - start.lng });
        } else {
          const over = !!hit(ll);
          if (over !== hovering) setGrab(over);
        }
      });
    };
    const end = () => {
      drag = null;
    };
    const click = (e: MapMouseEvent) => {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      const ll = eventLatLng(e);
      const a = state.current.anchor;
      if (a) setOffset({ dLat: ll.lat - a.lat, dLng: ll.lng - a.lng });
    };
    map.on('mousedown', down);
    map.on('mousemove', move);
    map.on('mouseup', end);
    map.on('click', click);
    window.addEventListener('mouseup', end);

    return () => {
      cancelAnimationFrame(frame);
      map.off('mousedown', down);
      map.off('mousemove', move);
      map.off('mouseup', end);
      map.off('click', click);
      window.removeEventListener('mouseup', end);
      // Cursor e arraste voltam ao comportamento da ferramenta atual (MapView reaplica).
      map.dragPan.enable();
      canvas.style.cursor = '';
    };
  }, [map, mode]);

  const moved = offset.dLat !== 0 || offset.dLng !== 0;
  // Duplicar é uma inclusão: exige o motivo (Tabela de Alterações).
  const canConfirm =
    !!sourceId &&
    !!anchor &&
    ids.length > 0 &&
    (moved || mode === 'copy') &&
    (mode !== 'copy' || !!observation.trim()) &&
    !saving;

  const confirm = useCallback(async () => {
    if (!canConfirm || !mode) return;
    const from = anchor!;
    const to = { lat: from.lat + offset.dLat, lng: from.lng + offset.dLng };
    setSaving(true);
    try {
      const res = await pointsService.translate(
        sourceId!,
        ids,
        mode,
        from,
        to,
        mode === 'copy' ? observation.trim() : undefined,
      );
      setObservation('');
      setSelection(
        res.groups.map(({ key, x, y, lat, lng, ids }) => ({ key, x, y, lat, lng, ids })),
      );
      setTransform(null);
      qc.invalidateQueries({ queryKey: queryKeys.points(sourceId!) });
      toast.success(
        mode === 'move'
          ? `${fmtInt(res.count)} registro(s) movido(s).`
          : `${fmtInt(res.count)} cópia(s) criada(s) e selecionada(s).`,
      );
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }, [
    canConfirm,
    mode,
    anchor,
    offset,
    sourceId,
    ids,
    observation,
    setSelection,
    setTransform,
    qc,
  ]);

  // Enter confirma (Esc é tratado nos atalhos globais).
  useEffect(() => {
    if (!mode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || (e.target as HTMLElement).closest('input, textarea, select, button'))
        return;
      e.preventDefault();
      void confirm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, confirm]);

  if (!mode) return null;
  const n = ids.length;
  const dist =
    anchor && moved
      ? distanceM(anchor, { lat: anchor.lat + offset.dLat, lng: anchor.lng + offset.dLng })
      : 0;

  return (
    <div className="absolute top-14 left-1/2 z-20 flex max-w-[95%] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-lg max-sm:top-24">
      {mode === 'move' ? (
        <Move className="size-4 text-amber-600" />
      ) : (
        <Copy className="size-4 text-amber-600" />
      )}
      <span>
        {mode === 'move' ? 'Mover' : 'Duplicar'} <b>{fmtInt(n)}</b> registro(s)
        {moved ? (
          <>
            {' '}
            · deslocamento ≈ <b>{fmtDistance(dist)}</b>
          </>
        ) : (
          <span className="text-slate-500">
            {mode === 'copy' ? ' na mesma posição' : ' — arraste para o destino'}
          </span>
        )}
      </span>
      {mode === 'copy' && (
        <input
          value={observation}
          onChange={(e) => setObservation(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void confirm()}
          maxLength={500}
          placeholder="Observação (motivo da inclusão) *"
          aria-label="Observação (motivo da inclusão)"
          className="h-7 w-56 rounded-md border border-slate-300 px-2 text-xs focus:border-accent-500 focus:outline-none"
        />
      )}
      <div className="flex gap-1.5">
        {moved && (
          <Button size="sm" variant="ghost" onClick={() => setOffset(ZERO)} disabled={saving}>
            Desfazer
          </Button>
        )}
        <Button
          size="sm"
          icon={<X className="size-3.5" />}
          onClick={() => setTransform(null)}
          disabled={saving}
        >
          Cancelar
        </Button>
        <Button
          size="sm"
          variant="primary"
          icon={<Check className="size-3.5" />}
          onClick={confirm}
          loading={saving}
          disabled={!canConfirm}
        >
          Confirmar
        </Button>
      </div>
    </div>
  );
}
