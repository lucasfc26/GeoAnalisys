import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { queryKeys, useActiveSource, useSourceSchema } from '@/hooks/useSourceData';
import { errorMessage } from '@/lib/api';
import { pointsService } from '@/services/points';
import { useAppStore } from '@/stores/appStore';
import type { ColumnMeta, PointRecord } from '@/types';
import { coordKey } from '@/utils/format';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { FieldError, Label } from '../ui/Field';
import { ErrorState, SkeletonList } from '../ui/States';
import { toast } from '../ui/Toaster';
import { fromInputValue, toInputValue, ValueInput } from './ValueInput';

export default function PointFormDialog() {
  const form = useAppStore((s) => s.dialogs.form);
  const closeDialog = useAppStore((s) => s.closeDialog);
  const setSelection = useAppStore((s) => s.setSelection);
  const focusMap = useAppStore((s) => s.focusMap);
  const { sourceId } = useActiveSource();
  const schema = useSourceSchema(sourceId);
  const qc = useQueryClient();
  const editId = form?.mode === 'edit' ? form.id : null;

  const record = useQuery({
    queryKey: queryKeys.record(sourceId ?? '', editId ?? ''),
    queryFn: () => pointsService.get(sourceId!, editId!),
    enabled: !!sourceId && !!editId,
  });

  const [values, setValues] = useState<Record<string, string>>({});
  const [initial, setInitial] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [fieldFilter, setFieldFilter] = useState('');
  /** Motivo da inclusão (vai para a Tabela de Alterações) */
  const [observation, setObservation] = useState('');

  const cols = useMemo(() => schema.data?.columns ?? [], [schema.data]);
  const src = schema.data?.source;
  const crs = schema.data?.crs;

  useEffect(() => {
    if (!form || !schema.data) return;
    const base: Record<string, string> = {};
    const data = form.mode === 'edit' ? record.data?.data : form.initial;
    if (form.mode === 'edit' && !record.data) return;
    for (const c of schema.data.columns) base[c.name] = toInputValue(c, data?.[c.name]);
    setValues(base);
    setInitial(base);
    setErrors({});
    setFieldFilter('');
    setObservation('');
  }, [form, schema.data, record.data]);

  const editable = useMemo(
    () => cols.filter((c) => !c.readOnly && c.name !== src?.xColumn && c.name !== src?.yColumn),
    [cols, src],
  );
  const shown = useMemo(() => {
    const f = fieldFilter.trim().toLowerCase();
    return editable.filter((c) => !f || c.name.toLowerCase().includes(f));
  }, [editable, fieldFilter]);

  const save = useMutation({
    mutationFn: async (payload: Record<string, unknown>) =>
      editId
        ? pointsService.update(sourceId!, editId, payload)
        : pointsService.create(sourceId!, payload, observation.trim()),
    onSuccess: (rec: PointRecord) => {
      qc.invalidateQueries({ queryKey: queryKeys.points(sourceId!) });
      if (rec.x !== null && rec.y !== null && rec.lat !== null && rec.lng !== null) {
        setSelection([
          {
            key: coordKey(rec.x, rec.y),
            x: rec.x,
            y: rec.y,
            lat: rec.lat,
            lng: rec.lng,
            ids: [rec.id],
          },
        ]);
        if (!editId) focusMap({ center: { lat: rec.lat, lng: rec.lng } });
      }
      toast.success(editId ? 'Registro atualizado.' : `Ponto #${rec.id} criado.`);
      closeDialog('form');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (!form) return null;

  const submit = () => {
    const errs: Record<string, string> = {};
    const payload: Record<string, unknown> = {};
    const consider: ColumnMeta[] = cols.filter(
      (c) => !c.readOnly && !(editId && c.name === src?.idColumn),
    );
    for (const c of consider) {
      const raw = values[c.name] ?? '';
      if (editId && raw === initial[c.name]) continue;
      const isCoord = c.name === src?.xColumn || c.name === src?.yColumn;
      if (isCoord && !raw.trim()) {
        errs[c.name] = 'Coordenada obrigatória';
        continue;
      }
      if (!editId && c.name === src?.idColumn && !raw.trim()) continue; // gerado automaticamente
      if (!editId && !raw.trim() && !isCoord) continue;
      const parsed = fromInputValue(isCoord ? { ...c, kind: 'number' } : c, raw);
      if (parsed.error) errs[c.name] = parsed.error;
      else payload[c.name] = parsed.value;
    }
    if (!editId && !observation.trim()) errs.__observation = 'Informe o motivo da inclusão';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    if (editId && !Object.keys(payload).length) {
      toast.info('Nenhuma alteração.');
      closeDialog('form');
      return;
    }
    save.mutate(payload);
  };

  const loading = schema.isLoading || (editId && record.isLoading);
  const loadError = schema.error ?? record.error;
  const xCol = cols.find((c) => c.name === src?.xColumn);
  const yCol = cols.find((c) => c.name === src?.yColumn);
  const isUtm = crs?.kind === 'utm';

  return (
    <Dialog
      open
      size="lg"
      title={editId ? `Editar registro #${editId}` : 'Adicionar ponto'}
      description={crs ? `${crs.code} · ${crs.name}` : undefined}
      onClose={() => closeDialog('form')}
      footer={
        <>
          <Button onClick={() => closeDialog('form')}>Cancelar</Button>
          <Button variant="primary" onClick={submit} loading={save.isPending} disabled={!!loading}>
            Salvar
          </Button>
        </>
      }
    >
      {loading ? (
        <SkeletonList rows={6} />
      ) : loadError ? (
        <ErrorState error={loadError} />
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="space-y-5"
        >
          {!editId && (
            <div>
              <Label htmlFor="f-observation" hint="Tabela de Alterações">
                Observação (motivo da inclusão) <span className="text-red-500">*</span>
              </Label>
              <textarea
                id="f-observation"
                value={observation}
                onChange={(e) => setObservation(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="Ex.: Ponto novo encontrado em campo"
                className="block w-full resize-y rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-accent-500 focus:outline-none"
              />
              <FieldError>{errors.__observation}</FieldError>
            </div>
          )}
          <fieldset className="grid gap-3 rounded-lg border border-amber-200 bg-amber-50/50 p-3 sm:grid-cols-2">
            <legend className="px-1 text-xs font-semibold text-amber-800">
              Coordenadas ({crs?.code})
            </legend>
            {[xCol, yCol].map(
              (c, i) =>
                c && (
                  <div key={c.name}>
                    <Label htmlFor={`f-${c.name}`} hint={c.name}>
                      {isUtm
                        ? i === 0
                          ? 'UTM X (Leste)'
                          : 'UTM Y (Norte)'
                        : i === 0
                          ? 'X / Longitude'
                          : 'Y / Latitude'}
                    </Label>
                    <ValueInput
                      col={{ ...c, kind: 'number' }}
                      value={values[c.name] ?? ''}
                      onChange={(v) => setValues((s) => ({ ...s, [c.name]: v }))}
                    />
                    <FieldError>{errors[c.name]}</FieldError>
                  </div>
                ),
            )}
            <p className="text-xs text-slate-500 sm:col-span-2">
              Latitude/longitude são recalculadas a partir das coordenadas originais
              {src?.geometryColumn
                ? ` e a coluna "${src.geometryColumn}" é atualizada automaticamente`
                : ''}
              .
            </p>
          </fieldset>

          <div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-700">
                Atributos ({editable.length})
              </h3>
              {editable.length > 8 && (
                <div className="relative w-56">
                  <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    value={fieldFilter}
                    onChange={(e) => setFieldFilter(e.target.value)}
                    placeholder="Filtrar campos…"
                    className="h-8 w-full rounded-md border border-slate-200 pr-2 pl-7 text-xs focus:border-accent-500 focus:outline-none"
                  />
                </div>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {shown.map((c) => {
                const isId = c.name === src?.idColumn;
                return (
                  <div key={c.name}>
                    <Label htmlFor={`f-${c.name}`} hint={c.formatType}>
                      {c.name}
                      {!c.nullable && !c.hasDefault && !isId && (
                        <span className="text-red-500"> *</span>
                      )}
                    </Label>
                    <ValueInput
                      col={c}
                      value={values[c.name] ?? ''}
                      onChange={(v) => setValues((s) => ({ ...s, [c.name]: v }))}
                      disabled={isId && !!editId}
                      placeholder={isId && !editId ? 'automático' : undefined}
                    />
                    <FieldError>{errors[c.name]}</FieldError>
                  </div>
                );
              })}
            </div>
          </div>
          <button type="submit" hidden />
        </form>
      )}
    </Dialog>
  );
}
