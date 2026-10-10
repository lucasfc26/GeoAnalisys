import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Replace } from 'lucide-react';
import { useState } from 'react';
import { queryKeys } from '@/hooks/useSourceData';
import { useDebounce } from '@/hooks/useDebounce';
import { errorMessage } from '@/lib/api';
import { pointsService } from '@/services/points';
import { sourcesService } from '@/services/sources';
import type { ColumnMeta, FilterDef } from '@/types';
import { fmtInt } from '@/utils/format';
import { Button } from '../ui/Button';
import { FieldError, Label, Select } from '../ui/Field';
import { toast } from '../ui/Toaster';
import { fromInputValue, ValueInput } from './ValueInput';

/**
 * Substituição: grava o mesmo valor em um atributo de todos os registros que atendem às condições
 * do diálogo de Filtros (as que estão na tela, mesmo antes de Aplicar).
 */
export function FilterReplaceSection({
  sourceId,
  filters,
  columns,
  blocked,
}: {
  sourceId: string;
  filters: FilterDef[];
  columns: ColumnMeta[];
  /** ID e X/Y: não podem ser alterados em massa */
  blocked: (string | null | undefined)[];
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [column, setColumn] = useState('');
  const [value, setValue] = useState('');
  const [setNull, setSetNull] = useState(false);
  const [ackedKey, setAckedKey] = useState<string | null>(null);
  const [error, setError] = useState<string>();

  const editable = columns.filter((c) => !c.readOnly && c.kind !== 'geometry' && !blocked.includes(c.name));
  const col = editable.find((c) => c.name === column);
  const debounced = useDebounce(filters, 400);
  const count = useQuery({
    queryKey: [...queryKeys.points(sourceId), 'count', debounced],
    queryFn: ({ signal }) => pointsService.count(sourceId, debounced, signal),
    enabled: open,
  });
  const suggestions = useQuery({
    queryKey: ['distinct', sourceId, column],
    queryFn: () => sourcesService.distinct(sourceId, column),
    enabled: open && !!col && col.kind === 'text',
    staleTime: 60_000,
  });
  const total = count.data;
  const settled = debounced === filters && !count.isFetching;
  /** A confirmação vale só para este atributo, estas condições e esta quantidade */
  const ackKey = JSON.stringify([column, total, filters]);
  const ack = ackedKey === ackKey;

  const replace = useMutation({
    mutationFn: (changes: Record<string, unknown>) => pointsService.replace(sourceId, filters, changes),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: queryKeys.points(sourceId) });
      qc.invalidateQueries({ queryKey: ['distinct', sourceId] });
      toast.success(`${fmtInt(r.updated)} registro(s) atualizado(s).`);
      setAckedKey(null);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const submit = () => {
    if (!col) return setError('Escolha o atributo');
    if (setNull) return replace.mutate({ [col.name]: null });
    const parsed = fromInputValue({ ...col, nullable: false, hasDefault: false }, value);
    if (parsed.error) return setError(parsed.error);
    setError(undefined);
    replace.mutate({ [col.name]: parsed.value });
  };

  return (
    <div className="rounded-lg border border-slate-200">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-slate-800 hover:bg-slate-50"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        <Replace className="size-4 text-accent-600" />
        Substituição
        <span className="font-normal text-slate-500">
          altera um atributo de todos os registros filtrados
        </span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-slate-200 p-3">
          <p className="text-xs text-slate-500">
            {filters.length
              ? 'Vale para os registros que atendem às condições acima (mesmo antes de Aplicar), com ou sem coordenada.'
              : 'Sem condições: vale para todos os registros da camada.'}{' '}
            {count.isError ? (
              <span className="text-red-600">Não foi possível contar os registros.</span>
            ) : total === undefined ? (
              'Contando…'
            ) : (
              <strong className="text-slate-800">{fmtInt(total)} registro(s).</strong>
            )}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="replace-col">Atributo</Label>
              <Select
                id="replace-col"
                value={column}
                onChange={(e) => {
                  setColumn(e.target.value);
                  setValue('');
                  setSetNull(false);
                  setError(undefined);
                }}
              >
                <option value="">Selecione…</option>
                {editable.map((c) => (
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
                <ValueInput
                  col={col}
                  value={value}
                  onChange={(v) => {
                    setValue(v);
                    setError(undefined);
                  }}
                  disabled={setNull}
                  list="replace-suggestions"
                />
                <datalist id="replace-suggestions">
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
          </div>
          {col && !!total && (
            <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
              <input
                type="checkbox"
                checked={ack}
                onChange={(e) => setAckedKey(e.target.checked ? ackKey : null)}
              />
              Confirmo a alteração de "{col.name}" em {fmtInt(total)} registro(s)
            </label>
          )}
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              Uma única transação, registrada na auditoria e na Tabela de Alterações.
            </p>
            <Button
              variant="primary"
              icon={<Replace className="size-4" />}
              onClick={submit}
              loading={replace.isPending}
              disabled={!col || !total || !ack || !settled}
            >
              Substituir
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
