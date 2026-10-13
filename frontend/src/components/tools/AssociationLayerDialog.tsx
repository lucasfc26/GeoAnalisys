import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Layers } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { queryKeys, useSources } from '@/hooks/useSourceData';
import { errorMessage } from '@/lib/api';
import {
  associationService,
  type AssociationLayerResult,
  type AssociationLayerTarget,
  type AssociationRequest,
} from '@/services/association';
import { TEMP_SCHEMA } from '@/services/layers';
import { useAppStore } from '@/stores/appStore';
import { fmtInt } from '@/utils/format';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input, Label, RadioCard, Select } from '../ui/Field';
import { toast } from '../ui/Toaster';

const SETTINGS_KEY = 'geoanalisys-association-layer';

interface Settings {
  mode: 'create' | 'replace';
  replaceId: string;
  adjustColumns: boolean;
  /** Gravar também as coordenadas convertidas (UTM X/Y e zona) */
  convertCoordinates: boolean;
}

function loadSettings(): Partial<Settings> {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>;
  } catch {
    return {};
  }
}

/** "a, b, c e mais 4" */
const nameList = (names: string[], max = 8) =>
  names.length > max
    ? `${names.slice(0, max).join(', ')} e mais ${fmtInt(names.length - max)}`
    : names.join(', ');

function report(r: AssociationLayerResult, created: boolean) {
  toast.success(
    created
      ? `Camada "${r.source.name}" criada com ${fmtInt(r.rows)} linha(s) (tabela ${r.schema}.${r.tableName}).`
      : `Camada "${r.source.name}" substituída: ${fmtInt(r.rows)} linha(s) gravada(s) em ${r.schema}.${r.tableName}.`,
  );
  const notes = [
    r.added.length && `Colunas acrescentadas: ${nameList(r.added)}.`,
    r.removed.length && `Colunas apagadas: ${nameList(r.removed)}.`,
    r.ignored.length &&
      `Colunas do resultado não gravadas (não existem na tabela): ${nameList(r.ignored)}.`,
    r.empty.length && `Colunas da tabela que ficaram vazias: ${nameList(r.empty)}.`,
  ].filter((n): n is string => !!n);
  if (notes.length) toast.info(notes.join(' '));
  const bad = Object.entries(r.invalid);
  if (bad.length) {
    toast.info(
      `Valores que não cabiam no tipo da coluna ficaram vazios: ${bad.map(([c, n]) => `${c} (${fmtInt(n)})`).join(', ')}.`,
    );
  }
}

/**
 * Grava o resultado completo da associação como camada temporária em GeoAnalisysTemp: uma nova ou
 * substituindo os registros de uma que já existe (com ou sem ajustar as colunas ao resultado).
 */
export function AssociationLayerDialog({
  request,
  nameA,
  nameB,
  onClose,
}: {
  request: AssociationRequest;
  nameA: string;
  nameB: string;
  onClose: () => void;
}) {
  const addLayer = useAppStore((s) => s.addLayer);
  const qc = useQueryClient();
  const sources = useSources();
  const candidates = useMemo(
    () =>
      (sources.data ?? []).filter(
        (x) =>
          x.schema === TEMP_SCHEMA && x.id !== request.a.sourceId && x.id !== request.b.sourceId,
      ),
    [sources.data, request.a.sourceId, request.b.sourceId],
  );

  const [s, setS] = useState<Settings>(() => {
    const saved = loadSettings();
    return {
      mode: saved.mode ?? 'create',
      replaceId: saved.replaceId ?? '',
      adjustColumns: saved.adjustColumns ?? true,
      convertCoordinates: saved.convertCoordinates ?? true,
    };
  });
  const patch = (p: Partial<Settings>) => setS((cur) => ({ ...cur, ...p }));
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch {
      /* sem localStorage: as escolhas valem só agora */
    }
  }, [s]);
  const [name, setName] = useState(() => `Associação ${nameA} x ${nameB}`.slice(0, 120));

  const mode = candidates.length ? s.mode : 'create';
  const replaced = candidates.find((x) => x.id === s.replaceId) ?? candidates[0];
  const target: AssociationLayerTarget | null =
    mode === 'create'
      ? name.trim()
        ? { mode: 'create', name: name.trim(), convertCoordinates: s.convertCoordinates }
        : null
      : replaced
        ? {
            mode: 'replace',
            sourceId: replaced.id,
            adjustColumns: s.adjustColumns,
            convertCoordinates: s.convertCoordinates,
          }
        : null;

  const save = useMutation({
    mutationFn: (t: AssociationLayerTarget) => associationService.toLayer(request, t),
    onSuccess: async (r, t) => {
      await qc.invalidateQueries({ queryKey: queryKeys.sources });
      qc.invalidateQueries({ queryKey: queryKeys.schema(r.source.id) });
      qc.invalidateQueries({ queryKey: queryKeys.points(r.source.id) });
      qc.invalidateQueries({ queryKey: ['db-schemas'] });
      addLayer(r.source.id);
      report(r, t.mode === 'create');
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Dialog
      open
      size="sm"
      title="Camada temporária"
      description={`Grava o resultado completo da associação no schema ${TEMP_SCHEMA}.`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button
            variant="primary"
            icon={<Layers className="size-4" />}
            loading={save.isPending}
            disabled={!target}
            onClick={() => target && save.mutate(target)}
          >
            {mode === 'create' ? 'Criar camada' : 'Substituir camada'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <RadioCard checked={mode === 'create'} onChange={() => patch({ mode: 'create' })}>
            Criar camada nova
          </RadioCard>
          <RadioCard
            checked={mode === 'replace'}
            disabled={!candidates.length}
            onChange={() => patch({ mode: 'replace' })}
          >
            Substituir existente
          </RadioCard>
        </div>

        {mode === 'create' ? (
          <>
            <div>
              <Label htmlFor="al-name">Nome da nova camada</Label>
              <Input
                id="al-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && target && save.mutate(target)}
              />
            </div>
            <p className="text-xs text-slate-500">
              A tabela terá as colunas escolhidas em "Colunas do arquivo", um ID automático e a
              longitude/latitude de cada linha (do ponto de A ou, sem ele, do ponto de B). Ao
              remover a camada do mapa (✕ em Camadas), a tabela é apagada.
            </p>
          </>
        ) : (
          <>
            <div>
              <Label htmlFor="al-replace" hint={TEMP_SCHEMA}>
                Camada a substituir
              </Label>
              <Select
                id="al-replace"
                value={replaced?.id ?? ''}
                onChange={(e) => patch({ replaceId: e.target.value })}
                disabled={!candidates.length}
              >
                {!candidates.length && <option value="">Nenhuma camada temporária</option>}
                {candidates.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} ({x.tableName})
                  </option>
                ))}
              </Select>
            </div>
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={s.adjustColumns}
                onChange={(e) => patch({ adjustColumns: e.target.checked })}
                className="mt-0.5 accent-accent-600"
              />
              <span>
                Ajustar as colunas ao novo resultado
                <span className="block text-xs text-slate-500">
                  {s.adjustColumns
                    ? 'Acrescenta as colunas novas do resultado e apaga as que ele não tem.'
                    : 'Mantém as colunas da tabela: grava só os valores das colunas que já existem; as demais ficam vazias.'}
                </span>
              </span>
            </label>
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Todos os registros de <b>{replaced?.name ?? 'camada'}</b> são apagados (TRUNCATE)
              antes de gravar o resultado. ID, coordenadas e a configuração da camada são mantidos.
            </p>
          </>
        )}

        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={s.convertCoordinates}
            onChange={(e) => patch({ convertCoordinates: e.target.checked })}
            className="mt-0.5 accent-accent-600"
          />
          <span>
            Gravar também as coordenadas convertidas
            <span className="block text-xs text-slate-500">
              {mode === 'create'
                ? 'Além de longitude/latitude, grava UTM X, UTM Y e a zona UTM de cada ponto (utm_x, utm_y, utm_zona).'
                : 'Depois de gravar, preenche as colunas convertidas da camada (lat/long ↔ UTM).'}
            </span>
          </span>
        </label>
      </div>
    </Dialog>
  );
}
