import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useMemo } from 'react';
import { errorMessage } from '@/lib/api';
import { sourcesService } from '@/services/sources';
import {
  defaultStatusRule,
  parseAttribute,
  statusAttributeError,
  statusRows,
  type StatusLayer as Layer,
  type StatusRuleState,
  type StatusValueNames,
} from '@/utils/associationStatus';
import { fmtInt } from '@/utils/format';
import { Input, Label, Select } from '../ui/Field';

/** Mesma comparação do backend: sem maiúsculas, acentos e espaços nas pontas. */
const normalize = (v: string) =>
  v
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

/**
 * Região "Status" da associação: para cada prioridade, se a divergência dela aparece, se é única e
 * qual atributo vai junto; o mesmo (sem "única") para Ponto Novo e Não Identificado; depois, os
 * nomes dos valores de cada atributo escolhido.
 */
export function StatusRulesEditor({
  labels,
  rules,
  names,
  a,
  b,
  includeUnmatchedB,
  onRule,
  onNames,
}: {
  labels: string[];
  rules: Record<string, StatusRuleState>;
  names: StatusValueNames;
  a: Layer | null;
  b: Layer | null;
  includeUnmatchedB: boolean;
  onRule: (key: string, patch: Partial<StatusRuleState>) => void;
  onNames: (attribute: string, values: Record<string, string>) => void;
}) {
  const ruleOf = (key: string) => rules[key] ?? defaultStatusRule(key);
  const rows = statusRows(labels, a?.name ?? 'A', includeUnmatchedB);
  const attributes = [
    ...new Set(
      rows.flatMap((row) => {
        const r = ruleOf(row.key);
        return r.consider && r.attribute && !statusAttributeError(r.attribute, row.sides, a, b)
          ? [r.attribute]
          : [];
      }),
    ),
  ];
  const layerOf = (side: 'A' | 'B') => (side === 'A' ? a : b);

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-600">
            <tr>
              <th className="px-2 py-1.5 font-medium">Situação</th>
              <th className="px-2 py-1.5 font-medium" title="Desmarcado: não aparece como divergência (vira Ponto Normal)">
                Gera divergência
              </th>
              <th
                className="px-2 py-1.5 font-medium"
                title="Se divergir, o Status mostra só esta prioridade"
              >
                Divergência única
              </th>
              <th className="px-2 py-1.5 font-medium">Divergência por atributo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const r = ruleOf(row.key);
              const at = parseAttribute(r.attribute);
              const error = r.consider ? statusAttributeError(r.attribute, row.sides, a, b) : null;
              const groups = row.sides.flatMap((side) => {
                const layer = layerOf(side);
                return layer ? [{ side, layer }] : [];
              });
              return (
                <tr
                  key={row.key}
                  className={i === labels.length ? 'border-t-2 border-slate-200' : 'border-t border-slate-100'}
                >
                  <td className="px-2 py-1.5 font-medium text-slate-800">
                    {row.title}
                    {row.note && <span className="block text-xs font-normal text-slate-500">{row.note}</span>}
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="checkbox"
                      checked={r.consider}
                      onChange={(e) => onRule(row.key, { consider: e.target.checked })}
                      className="accent-accent-600"
                      aria-label={`${row.title}: gera divergência`}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    {row.unique ? (
                      <input
                        type="checkbox"
                        checked={r.consider && r.unique}
                        disabled={!r.consider}
                        onChange={(e) => onRule(row.key, { unique: e.target.checked })}
                        className="accent-accent-600"
                        aria-label={`${row.title}: divergência única`}
                      />
                    ) : (
                      <span className="text-xs text-slate-400" title="Sempre aparece sozinho no Status">
                        sempre
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <Select
                      id={`as-st-${i}`}
                      aria-label={`${row.title}: atributo`}
                      className="min-w-48"
                      value={r.attribute}
                      disabled={!r.consider}
                      onChange={(e) => onRule(row.key, { attribute: e.target.value })}
                    >
                      <option value="">Nenhum</option>
                      {error && at && (
                        <option value={r.attribute}>
                          {at.column} ({layerOf(at.side)?.name ?? at.side})
                        </option>
                      )}
                      {groups.map((g) => (
                        <optgroup key={g.side} label={g.layer.name}>
                          {g.layer.columns.map((c) => (
                            <option key={c} value={`${g.side}:${c}`}>
                              {c}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </Select>
                    {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        {labels.length ? '' : 'Sem prioridades: todo par associado fica como Ponto Normal. '}
        Desmarcar "Gera divergência" faz a situação virar Ponto Normal no Status. Com divergência
        única, se a prioridade divergir o Status mostra só ela (havendo mais de uma, vale a primeira
        da lista). O atributo acrescenta o valor do ponto ao Status, por exemplo "Divergência de
        potencia Medido" ou "Ponto Novo coletado em {a?.name ?? 'A'} Estimado".
      </p>

      {attributes.map((attr) => {
        const at = parseAttribute(attr)!;
        const layer = layerOf(at.side);
        if (!layer?.columns.includes(at.column)) return null;
        return (
          <ValueNamesEditor
            key={attr}
            sourceId={layer.id}
            layerName={layer.name}
            column={at.column}
            names={names[attr] ?? {}}
            onChange={(values) => onNames(attr, values)}
          />
        );
      })}
    </div>
  );
}

function ValueNamesEditor({
  sourceId,
  layerName,
  column,
  names,
  onChange,
}: {
  sourceId: string;
  layerName: string;
  column: string;
  names: Record<string, string>;
  onChange: (names: Record<string, string>) => void;
}) {
  const distinct = useQuery({
    queryKey: ['distinct', sourceId, column],
    queryFn: () => sourcesService.distinct(sourceId, column),
  });
  // Valores que só diferem em maiúsculas/acentos são o mesmo no Status.
  const values = useMemo(() => {
    const groups = new Map<string, { value: string; count: number }>();
    for (const d of distinct.data ?? []) {
      const value = d.value?.trim() ?? '';
      const key = normalize(value);
      const g = groups.get(key);
      if (g) g.count += d.count;
      else groups.set(key, { value, count: d.count });
    }
    return [...groups.values()];
  }, [distinct.data]);
  const nameOf = (value: string) =>
    names[value] ??
    Object.entries(names).find(([v]) => normalize(v) === normalize(value))?.[1] ??
    '';

  return (
    <div className="rounded-md border border-slate-200 p-2">
      <Label hint="em branco = mantém o valor original">
        Nomes dos valores de {column} ({layerName})
      </Label>
      {distinct.isLoading ? (
        <div className="flex h-12 items-center justify-center">
          <Loader2 className="size-4 animate-spin text-slate-400" />
        </div>
      ) : distinct.isError ? (
        <p className="text-xs text-red-600">{errorMessage(distinct.error)}</p>
      ) : (
        <div className="scroll-thin grid max-h-56 gap-1.5 overflow-y-auto sm:grid-cols-2">
          {values.map(({ value, count }) => (
            <div key={value} className="flex items-center gap-2">
              <span
                className="w-36 shrink-0 truncate text-sm text-slate-700"
                title={`${value || '(vazio)'} — ${fmtInt(count)} registro(s)`}
              >
                {value || <span className="italic text-slate-400">(vazio)</span>}
              </span>
              <span className="text-xs text-slate-400">→</span>
              <Input
                aria-label={`Nome para ${value || 'vazio'}`}
                placeholder={value || '(sem valor)'}
                value={nameOf(value)}
                maxLength={200}
                onChange={(e) => {
                  const next = Object.fromEntries(
                    Object.entries(names).filter(([v]) => normalize(v) !== normalize(value)),
                  );
                  onChange({ ...next, [value]: e.target.value });
                }}
              />
            </div>
          ))}
        </div>
      )}
      {(distinct.data?.length ?? 0) >= 100 && (
        <p className="mt-1 text-xs text-slate-500">
          Mostrando os valores mais frequentes; os demais aparecem com o valor original.
        </p>
      )}
    </div>
  );
}
