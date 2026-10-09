import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { queryKeys, useActiveSource, useSelectedIds, useSourceSchema } from '@/hooks/useSourceData';
import { errorMessage } from '@/lib/api';
import { pointsService } from '@/services/points';
import { sourcesService } from '@/services/sources';
import { useAppStore } from '@/stores/appStore';
import { fmtInt } from '@/utils/format';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { FieldError, Label, Select } from '../ui/Field';
import { toast } from '../ui/Toaster';
import { fromInputValue, ValueInput } from './ValueInput';

export default function BulkEditDialog() {
  const open = useAppStore((s) => s.dialogs.bulkEdit);
  const closeDialog = useAppStore((s) => s.closeDialog);
  const { sourceId } = useActiveSource();
  const schema = useSourceSchema(sourceId);
  const ids = useSelectedIds();
  const qc = useQueryClient();
  const [column, setColumn] = useState('');
  const [value, setValue] = useState('');
  const [setNull, setSetNull] = useState(false);
  const [error, setError] = useState<string>();

  const src = schema.data?.source;
  const columns = useMemo(
    () =>
      (schema.data?.columns ?? []).filter(
        (c) => !c.readOnly && ![src?.idColumn, src?.xColumn, src?.yColumn].includes(c.name),
      ),
    [schema.data, src],
  );
  const col = columns.find((c) => c.name === column);

  const suggestions = useQuery({
    queryKey: ['distinct', sourceId, column],
    queryFn: () => sourcesService.distinct(sourceId!, column),
    enabled: !!sourceId && !!col && col.kind === 'text',
    staleTime: 60_000,
  });

  const apply = useMutation({
    mutationFn: (changes: Record<string, unknown>) => pointsService.bulkUpdate(sourceId!, ids, changes),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: queryKeys.points(sourceId!) });
      toast.success(`${fmtInt(r.updated)} registro(s) atualizado(s).`);
      closeDialog('bulkEdit');
      setColumn('');
      setValue('');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (!open) return null;

  const submit = () => {
    if (!col) return setError('Escolha o campo');
    if (setNull) return apply.mutate({ [col.name]: null });
    const parsed = fromInputValue({ ...col, nullable: false, hasDefault: false }, value);
    if (parsed.error) return setError(parsed.error);
    setError(undefined);
    apply.mutate({ [col.name]: parsed.value });
  };

  return (
    <Dialog
      open
      size="sm"
      title="Edição em massa"
      description={`${fmtInt(ids.length)} registros selecionados`}
      onClose={() => closeDialog('bulkEdit')}
      footer={
        <>
          <Button onClick={() => closeDialog('bulkEdit')}>Cancelar</Button>
          <Button variant="primary" onClick={submit} loading={apply.isPending} disabled={!col}>
            Aplicar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Label htmlFor="bulk-col">Campo</Label>
          <Select
            id="bulk-col"
            value={column}
            onChange={(e) => {
              setColumn(e.target.value);
              setValue('');
              setError(undefined);
            }}
          >
            <option value="">Selecione…</option>
            {columns.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        {col && (
          <div>
            <Label htmlFor={`f-${col.name}`} hint={col.formatType}>
              Novo valor
            </Label>
            <ValueInput col={col} value={value} onChange={setValue} disabled={setNull} list="bulk-suggestions" />
            <datalist id="bulk-suggestions">
              {suggestions.data?.map((s) => s.value !== null && <option key={s.value} value={s.value} />)}
            </datalist>
            <FieldError>{error}</FieldError>
            {col.nullable && (
              <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                <input type="checkbox" checked={setNull} onChange={(e) => setSetNull(e.target.checked)} />
                Definir como vazio (NULL)
              </label>
            )}
          </div>
        )}
        <p className="rounded-md bg-slate-50 p-2 text-xs text-slate-500">
          A alteração é aplicada em uma única transação e registrada na auditoria. Coordenadas e ID não podem ser
          alterados em massa.
        </p>
      </div>
    </Dialog>
  );
}
