import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CopyPlus } from 'lucide-react';
import { useState } from 'react';
import { queryKeys, useActiveSource, useSelectedIds } from '@/hooks/useSourceData';
import { errorMessage } from '@/lib/api';
import { TEMP_SCHEMA, layersService, withTempSchema } from '@/services/layers';
import { databaseService } from '@/services/sources';
import { useAppStore } from '@/stores/appStore';
import { fmtInt } from '@/utils/format';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input, Label, Select } from '../ui/Field';
import { toast } from '../ui/Toaster';

/**
 * Copia os pontos selecionados para uma nova camada: uma tabela com a mesma estrutura da original,
 * por padrão no schema GeoAnalisysTemp (apagada ao remover a camada do mapa).
 */
export default function CopyToLayerDialog() {
  const closeDialog = useAppStore((s) => s.closeDialog);
  const addLayer = useAppStore((s) => s.addLayer);
  const { sourceId, source } = useActiveSource();
  const ids = useSelectedIds();
  const qc = useQueryClient();
  const schemas = useQuery({
    queryKey: ['db-schemas'],
    queryFn: databaseService.schemas,
    staleTime: 60_000,
  });
  const [name, setName] = useState(() => (source ? `${source.name} - seleção` : ''));
  const [schema, setSchema] = useState(TEMP_SCHEMA);

  const copy = useMutation({
    mutationFn: () => layersService.copy(sourceId!, ids, name.trim(), schema),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: queryKeys.sources });
      qc.invalidateQueries({ queryKey: ['db-schemas'] });
      addLayer(r.source.id);
      toast.success(
        `Camada "${r.source.name}" criada com ${fmtInt(r.rows)} ponto(s) (tabela ${r.source.schema}.${r.tableName}).`,
      );
      closeDialog('copyToLayer');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Dialog
      open
      size="sm"
      title="Copiar para nova camada"
      description={
        source ? `${fmtInt(ids.length)} registro(s) selecionado(s) em ${source.name}` : undefined
      }
      onClose={() => closeDialog('copyToLayer')}
      footer={
        <>
          <Button onClick={() => closeDialog('copyToLayer')}>Cancelar</Button>
          <Button
            variant="primary"
            icon={<CopyPlus className="size-4" />}
            loading={copy.isPending}
            disabled={!sourceId || !ids.length || !name.trim()}
            onClick={() => copy.mutate()}
          >
            Criar camada
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <Label htmlFor="copy-name">Nome da nova camada</Label>
          <Input
            id="copy-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && copy.mutate()}
          />
        </div>
        <div>
          <Label htmlFor="copy-schema" hint="onde a tabela é criada">
            Schema
          </Label>
          <Select id="copy-schema" value={schema} onChange={(e) => setSchema(e.target.value)}>
            {withTempSchema(schemas.data).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
        <p className="text-xs text-slate-500">
          A nova camada é uma tabela com as mesmas colunas da original, contendo só os pontos
          selecionados (mesmos IDs e atributos); a camada original não muda.{' '}
          {schema === TEMP_SCHEMA ? (
            <>
              No schema <b>{TEMP_SCHEMA}</b> ela é temporária: ao remover a camada do mapa (✕ em
              Camadas), a tabela é apagada.
            </>
          ) : (
            <>
              Em <b>{schema}</b> a tabela é permanente: remover a camada do mapa não a apaga.
            </>
          )}
        </p>
      </div>
    </Dialog>
  );
}
