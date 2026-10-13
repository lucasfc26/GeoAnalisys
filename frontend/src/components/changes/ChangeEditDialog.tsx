import { useMutation } from '@tanstack/react-query';
import { Plus, Save, Undo2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSourceSchema } from '@/hooks/useSourceData';
import { errorMessage } from '@/lib/api';
import { changesService, type ChangeRow } from '@/services/changes';
import { fmtChangeValue } from '@/utils/changes';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input, Label, Select } from '../ui/Field';
import { toast } from '../ui/Toaster';

interface Field {
  attr: string;
  /** Valor da 1ª versão (só para os atributos já alterados) */
  old?: unknown;
  initial: string;
  value: string;
  /** Atributo incluído agora (gravado mesmo vazio) */
  added?: boolean;
}

/**
 * Edita uma linha da Tabela de Alterações: a observação e os valores novos dos atributos (gravados no
 * ponto). Um valor que volta ao original tira o atributo da lista.
 */
export function ChangeEditDialog({
  row,
  onClose,
  onSaved,
}: {
  row: ChangeRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const removed = row.action === 'DELETE';
  const schema = useSourceSchema(removed ? null : row.sourceId);
  const [observation, setObservation] = useState(row.observation ?? '');
  const [fields, setFields] = useState<Field[]>(() =>
    row.attributes.map((attr, i) => {
      const v = fmtChangeValue(row.newValues[i]);
      return { attr, old: row.oldValues[i], initial: v, value: v };
    }),
  );
  const [adding, setAdding] = useState('');

  const addable = useMemo(() => {
    const s = schema.data;
    if (!s) return [];
    const listed = new Set(fields.map((f) => f.attr));
    return s.columns
      .filter(
        (c) =>
          !c.readOnly &&
          c.kind !== 'geometry' &&
          c.name !== s.source.idColumn &&
          !listed.has(c.name),
      )
      .map((c) => c.name);
  }, [schema.data, fields]);

  const values: Record<string, unknown> = {};
  for (const f of fields) if (f.added || f.value !== f.initial) values[f.attr] = f.value;
  const obsChanged = observation.trim() !== (row.observation ?? '').trim();
  const dirty = obsChanged || Object.keys(values).length > 0;

  const save = useMutation({
    mutationFn: () =>
      changesService.edit(row.id, {
        ...(obsChanged ? { observation: observation.trim() || null } : {}),
        ...(Object.keys(values).length ? { values } : {}),
      }),
    onSuccess: (r) => {
      toast.success(r ? 'Alteração atualizada.' : 'O ponto voltou ao original: saiu da tabela.');
      onSaved();
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const setValue = (attr: string, value: string) =>
    setFields((fs) => fs.map((f) => (f.attr === attr ? { ...f, value } : f)));

  return (
    <Dialog
      open
      size="md"
      title={`Editar alteração — ${row.sourceName} ${row.recordId}`}
      description={
        removed
          ? 'O ponto foi removido: só a observação pode ser editada.'
          : 'Os valores novos são gravados no ponto. Um valor igual ao original tira o atributo da lista.'
      }
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button
            variant="primary"
            icon={<Save className="size-4" />}
            loading={save.isPending}
            disabled={!dirty}
            onClick={() => save.mutate()}
          >
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Label htmlFor="ce-obs">Observação</Label>
          <textarea
            id="ce-obs"
            value={observation}
            onChange={(e) => setObservation(e.target.value)}
            maxLength={2000}
            rows={2}
            className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-accent-500 focus:outline-none"
          />
        </div>

        {!removed && (
          <div>
            <Label>Atributos alterados</Label>
            {fields.length ? (
              <table className="w-full text-left text-xs">
                <thead className="text-slate-500">
                  <tr>
                    <th className="py-1 pr-2 font-medium">Atributo</th>
                    <th className="py-1 pr-2 font-medium">Valor old</th>
                    <th className="py-1 pr-2 font-medium">Valor new</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {fields.map((f) => {
                    const known = f.old !== undefined;
                    const oldText = known ? fmtChangeValue(f.old) : '';
                    return (
                      <tr key={f.attr}>
                        <td className="py-1 pr-2 font-mono">{f.attr}</td>
                        <td className="py-1 pr-2 font-mono text-slate-500">
                          {known ? oldText || '(vazio)' : '—'}
                        </td>
                        <td className="py-1 pr-2">
                          <Input
                            value={f.value}
                            onChange={(e) => setValue(f.attr, e.target.value)}
                            className="h-7 font-mono text-xs"
                            aria-label={`Valor novo de ${f.attr}`}
                          />
                        </td>
                        <td className="py-1 whitespace-nowrap">
                          {known ? (
                            <button
                              type="button"
                              title="Voltar ao valor original"
                              onClick={() => setValue(f.attr, oldText)}
                              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                            >
                              <Undo2 className="size-3.5" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              title="Não alterar"
                              onClick={() => setFields((fs) => fs.filter((x) => x.attr !== f.attr))}
                              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                            >
                              <X className="size-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="text-xs text-slate-500">Nenhum atributo alterado.</p>
            )}
            <div className="mt-2 flex gap-2">
              <Select
                value={adding}
                onChange={(e) => setAdding(e.target.value)}
                disabled={!addable.length}
                className="h-8 flex-1 text-xs"
                aria-label="Atributo a alterar"
              >
                <option value="">
                  {schema.isLoading ? 'Carregando colunas…' : 'Alterar outro atributo…'}
                </option>
                {addable.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                className="h-8"
                icon={<Plus className="size-3.5" />}
                disabled={!adding}
                onClick={() => {
                  setFields((fs) => [...fs, { attr: adding, initial: '', value: '', added: true }]);
                  setAdding('');
                }}
              >
                Adicionar
              </Button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
