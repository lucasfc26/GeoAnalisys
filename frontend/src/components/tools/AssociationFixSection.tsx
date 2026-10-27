import { useQueryClient } from '@tanstack/react-query';
import { ListChecks, Magnet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { queryKeys } from '@/hooks/useSourceData';
import { errorMessage } from '@/lib/api';
import { associationService, type AssociationRequest } from '@/services/association';
import { useAssociationReviewStore } from '@/stores/associationReviewStore';
import { fmtInt } from '@/utils/format';
import { Button } from '../ui/Button';
import { Input, Label, Select } from '../ui/Field';
import { toast } from '../ui/Toaster';

const SETTINGS_KEY = 'geoanalisys-association-fix';
const MAX_DISTANCE = 5000;

interface Settings {
  /** Texto dos campos (metros) */
  minDistance: string;
  farDistance: string;
  /** Vazio = não procura pares dúbios */
  maxMargin: string;
}

const DEFAULTS: Settings = { minDistance: '10', farDistance: '10', maxMargin: '2' };

function loadSettings(): Settings {
  try {
    return {
      ...DEFAULTS,
      ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>),
    };
  } catch {
    return DEFAULTS;
  }
}

/** Número em metros (vazio = null quando `optional`), ou undefined se inválido. */
function parseMeters(s: string, optional: boolean, min = 0): number | null | undefined {
  if (!s.trim()) return optional ? null : undefined;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) && n >= min && n <= MAX_DISTANCE ? n : undefined;
}

/**
 * Ferramentas › Associar Camadas: corrigir as coordenadas (o ponto de uma camada recebe a posição
 * do ponto associado da outra, acima de uma distância) e abrir a lista de pares distantes ou dúbios.
 */
export function AssociationFixSection({
  request,
  nameA,
  nameB,
  onOpenReview,
}: {
  /** null = parâmetros da associação incompletos */
  request: AssociationRequest | null;
  nameA: string;
  nameB: string;
  /** Lista aberta sobre o mapa (a janela da associação pode fechar) */
  onOpenReview: () => void;
}) {
  const qc = useQueryClient();
  const from = useAssociationReviewStore((s) => s.from);
  const setFrom = useAssociationReviewStore((s) => s.setFrom);
  const setReview = useAssociationReviewStore((s) => s.setResult);
  const setPanelOpen = useAssociationReviewStore((s) => s.setPanelOpen);
  const [s, setS] = useState<Settings>(loadSettings);
  const patch = (p: Partial<Settings>) => setS((cur) => ({ ...cur, ...p }));
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch {
      /* sem localStorage: as escolhas valem só agora */
    }
  }, [s]);

  const minDistance = parseMeters(s.minDistance, false);
  const farDistance = parseMeters(s.farDistance, true);
  const maxMargin = parseMeters(s.maxMargin, true, -MAX_DISTANCE);
  const nameOf = (side: 'A' | 'B') => (side === 'A' ? nameA : nameB);
  const to = from === 'A' ? 'B' : 'A';

  /** Contagem antes de mover: a confirmação mostra quantos pontos e para onde */
  const [pending, setPending] = useState<{ count: number; key: string } | null>(null);
  const [busy, setBusy] = useState<'count' | 'fix' | 'review' | null>(null);
  const fixKey =
    request && minDistance != null ? JSON.stringify([request, from, minDistance]) : null;
  const confirming = !!pending && pending.key === fixKey;

  const count = async () => {
    if (!request || minDistance == null) return;
    setBusy('count');
    try {
      const res = await associationService.fixCoordinates(request, from, minDistance, true);
      if (!res.count)
        toast.info(`Nenhum par associado a mais de ${minDistance.toLocaleString('pt-BR')} m.`);
      else setPending({ count: res.count, key: fixKey! });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };
  const fix = async () => {
    if (!request || minDistance == null) return;
    setBusy('fix');
    try {
      const res = await associationService.fixCoordinates(request, from, minDistance, false);
      setPending(null);
      qc.invalidateQueries({
        queryKey: queryKeys.points(from === 'A' ? request.a.sourceId : request.b.sourceId),
      });
      toast.success(
        `${fmtInt(res.moved)} ponto(s) de ${res.nameFrom} movido(s) para a posição do ponto associado em ${res.nameTo}.`,
      );
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };
  const review = async () => {
    if (!request || farDistance === undefined || maxMargin === undefined) return;
    setBusy('review');
    try {
      const data = await associationService.review(request, { farDistance, maxMargin });
      setReview({ request, data });
      setPanelOpen(true);
      if (!data.total) toast.info('Nenhum par distante ou dúbio.');
      else onOpenReview();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const sideSelect = (id: string, value: 'A' | 'B', onChange: (v: 'A' | 'B') => void) => (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value as 'A' | 'B')}>
      <option value="A">{nameA}</option>
      <option value="B">{nameB}</option>
    </Select>
  );

  return (
    <div className="space-y-3 rounded-md border border-slate-200 p-3">
      <div className="space-y-2">
        <Label hint="o ponto da camada De recebe a coordenada do ponto associado da camada Para">
          Corrigir coordenadas
        </Label>
        <div className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_8rem_auto]">
          <div>
            <Label htmlFor="as-fix-from">De</Label>
            {sideSelect('as-fix-from', from, (v) => setFrom(v))}
          </div>
          <div>
            <Label htmlFor="as-fix-to">Para</Label>
            {sideSelect('as-fix-to', to, (v) => setFrom(v === 'A' ? 'B' : 'A'))}
          </div>
          <div>
            <Label htmlFor="as-fix-dist" hint="m">
              Acima de
            </Label>
            <Input
              id="as-fix-dist"
              type="number"
              min={0}
              max={MAX_DISTANCE}
              step="any"
              value={s.minDistance}
              onChange={(e) => patch({ minDistance: e.target.value })}
            />
          </div>
          <Button
            icon={<Magnet className="size-4" />}
            loading={busy === 'count'}
            disabled={!request || minDistance == null || !!busy || confirming}
            onClick={() => void count()}
          >
            Corrigir coordenadas
          </Button>
        </div>
        {minDistance === undefined && (
          <p className="text-xs text-red-600">
            Informe uma distância entre 0 e {fmtInt(MAX_DISTANCE)} m.
          </p>
        )}
        {confirming && (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <span className="flex-1">
              Mover <strong>{fmtInt(pending.count)}</strong> ponto(s) de{' '}
              <strong>{nameOf(from)}</strong> para a posição do ponto associado em{' '}
              <strong>{nameOf(to)}</strong> (pares a mais de {minDistance!.toLocaleString('pt-BR')}{' '}
              m)? Fica registrado em Alterações.
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy === 'fix'}
              onClick={() => setPending(null)}
            >
              Cancelar
            </Button>
            <Button size="sm" variant="primary" loading={busy === 'fix'} onClick={() => void fix()}>
              Mover {fmtInt(pending.count)}
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-slate-100 pt-3">
        <Label hint="veja no mapa todos de uma vez ou um a um, e ajuste cada um">
          Revisar pares
        </Label>
        <div className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <div>
            <Label htmlFor="as-rev-far" hint="m; vazio = não">
              Distantes: acima de
            </Label>
            <Input
              id="as-rev-far"
              type="number"
              min={0}
              max={MAX_DISTANCE}
              step="any"
              value={s.farDistance}
              onChange={(e) => patch({ farDistance: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="as-rev-margin" hint="m; vazio = não">
              Dúbios: margem abaixo de
            </Label>
            <Input
              id="as-rev-margin"
              type="number"
              step="any"
              value={s.maxMargin}
              onChange={(e) => patch({ maxMargin: e.target.value })}
            />
          </div>
          <Button
            icon={<ListChecks className="size-4" />}
            loading={busy === 'review'}
            disabled={
              !request ||
              farDistance === undefined ||
              maxMargin === undefined ||
              (farDistance === null && maxMargin === null) ||
              !!busy
            }
            onClick={() => void review()}
          >
            Abrir lista
          </Button>
        </div>
        {(farDistance === undefined || maxMargin === undefined) && (
          <p className="text-xs text-red-600">Valores em metros inválidos.</p>
        )}
        <p className="text-xs text-slate-500">
          Margem = quanto o segundo melhor candidato (de qualquer um dos dois pontos) custa a mais
          que o par escolhido. Margem pequena: a escolha foi apertada; negativa: um dos pontos tinha
          um par mais barato, deixado de lado para associar melhor o conjunto.
        </p>
      </div>
    </div>
  );
}
