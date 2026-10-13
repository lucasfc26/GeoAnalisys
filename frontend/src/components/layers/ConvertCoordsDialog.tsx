import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight } from 'lucide-react';
import { queryKeys } from '@/hooks/useSourceData';
import { errorMessage } from '@/lib/api';
import { TEMP_SCHEMA, layersService } from '@/services/layers';
import { useAppStore } from '@/stores/appStore';
import { fmtInt } from '@/utils/format';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { ErrorState, SkeletonList } from '../ui/States';
import { toast } from '../ui/Toaster';

const FIELD_LABEL: Record<string, string> = {
  latitude: 'Latitude',
  longitude: 'Longitude',
  utm_x: 'UTM X',
  utm_y: 'UTM Y',
  utm_zona: 'Zona UTM',
};

/**
 * Camadas › Converter coordenadas: grava na tabela da camada as coordenadas no "outro" sistema
 * (camada em lat/long → UTM X/Y e zona; camada UTM → latitude/longitude), para todos os registros.
 */
export default function ConvertCoordsDialog() {
  const target = useAppStore((s) => s.dialogs.convertCoords);
  const closeDialog = useAppStore((s) => s.closeDialog);
  const sourceId = target?.sourceId ?? '';
  const qc = useQueryClient();
  const plan = useQuery({
    queryKey: ['convert-coords', sourceId],
    queryFn: () => layersService.conversionPlan(sourceId),
    enabled: !!sourceId,
  });

  const run = useMutation({
    mutationFn: () => layersService.convertCoordinates(sourceId),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: queryKeys.sources });
      qc.invalidateQueries({ queryKey: queryKeys.schema(sourceId) });
      qc.invalidateQueries({ queryKey: queryKeys.points(sourceId) });
      const missing = r.rows - r.converted;
      toast.success(
        `Coordenadas convertidas em ${fmtInt(r.converted)} de ${fmtInt(r.rows)} registro(s) — colunas ${r.columns.join(', ')}.`,
      );
      if (missing > 0)
        toast.info(`${fmtInt(missing)} registro(s) sem coordenada válida ficaram vazios.`);
      if (r.repointed) toast.info('A camada passou a usar as colunas decimais como X/Y.');
      closeDialog('convertCoords');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const p = plan.data;
  const isTemp = p?.source.schema === TEMP_SCHEMA;
  return (
    <Dialog
      open
      title="Converter coordenadas (lat/long ↔ UTM)"
      description={p ? `Camada "${p.source.name}" — ${p.crs.code} (${p.crs.name})` : undefined}
      onClose={() => closeDialog('convertCoords')}
      footer={
        <>
          <Button onClick={() => closeDialog('convertCoords')}>Cancelar</Button>
          <Button
            variant="primary"
            icon={<ArrowLeftRight className="size-4" />}
            onClick={() => run.mutate()}
            loading={run.isPending}
            disabled={!p}
          >
            Converter e gravar
          </Button>
        </>
      }
    >
      {plan.isLoading ? (
        <SkeletonList rows={3} />
      ) : plan.isError ? (
        <ErrorState error={plan.error} onRetry={() => plan.refetch()} />
      ) : p ? (
        <div className="space-y-3 text-sm text-slate-700">
          <p>
            {p.crs.kind === 'geographic'
              ? 'A camada está em latitude/longitude: cada ponto recebe UTM X, UTM Y e a zona UTM dele (SIRGAS 2000).'
              : p.crs.kind === 'utm'
                ? 'A camada está em UTM: cada ponto recebe latitude e longitude em graus decimais (WGS 84 / SIRGAS 2000).'
                : 'Cada ponto recebe latitude/longitude e UTM X/Y com a zona.'}
          </p>
          <ul className="space-y-1 rounded-md border border-slate-200 p-3 text-xs">
            {p.columns.map((c) => (
              <li key={c.name} className="flex items-center justify-between gap-2">
                <span>
                  <b>{FIELD_LABEL[c.field] ?? c.field}</b> → coluna{' '}
                  <code className="rounded bg-slate-100 px-1">{c.name}</code>
                </span>
                <span className={c.exists ? 'text-amber-700' : 'text-emerald-700'}>
                  {c.exists ? 'já existe: será sobrescrita' : 'nova coluna'}
                </span>
              </li>
            ))}
          </ul>
          {p.repointXY && (
            <p className="text-xs text-slate-600">
              As colunas de X/Y atuais têm texto (ex.: 3º 50' 37" S). Elas são mantidas, e a camada
              passa a usar as colunas decimais de longitude/latitude como X/Y.
            </p>
          )}
          {!isTemp && (
            <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800">
              Atenção: a tabela {p.source.schema} é permanente — as colunas são criadas/alteradas
              diretamente no banco.
            </p>
          )}
          <p className="text-xs text-slate-500">
            Os valores são calculados agora; ao mover ou editar pontos depois, rode a conversão de
            novo para atualizá-los.
          </p>
        </div>
      ) : null}
    </Dialog>
  );
}
