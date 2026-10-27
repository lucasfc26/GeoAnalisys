import type { PreviewConfig } from '@/lib/listPreview';
import type { ColumnMeta } from '@/types';

/** Escolha do link do preview: atributo que já contém o link, modelo com {atributo} ou Street View. */
export function PreviewSettings({
  name,
  columns,
  cfg,
  onChange,
}: {
  /** Nome do grupo de rádios (único na tela) */
  name: string;
  columns: ColumnMeta[];
  cfg: PreviewConfig;
  onChange: (patch: Partial<PreviewConfig>) => void;
}) {
  return (
    <div className="space-y-1.5 rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
      <label className="flex items-center gap-2">
        <input
          type="radio"
          name={name}
          checked={cfg.mode === 'column'}
          onChange={() => onChange({ mode: 'column' })}
          className="accent-accent-600"
        />
        <span className="w-28 shrink-0">Atributo com o link</span>
        <select
          value={cfg.column}
          onChange={(e) => onChange({ mode: 'column', column: e.target.value })}
          className="h-6 min-w-0 flex-1 rounded border border-slate-300 bg-white px-1 text-[11px]"
          aria-label="Atributo com o link"
        >
          <option value="">— escolha —</option>
          {columns.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2">
        <input
          type="radio"
          name={name}
          checked={cfg.mode === 'template'}
          onChange={() => onChange({ mode: 'template' })}
          className="accent-accent-600"
        />
        <span className="w-28 shrink-0">Montar o link</span>
        <select
          value=""
          onChange={(e) =>
            e.target.value &&
            onChange({ mode: 'template', template: `${cfg.template}{${e.target.value}}` })
          }
          className="h-6 min-w-0 flex-1 rounded border border-dashed border-slate-300 bg-white px-1 text-[11px] text-slate-600"
          aria-label="Inserir atributo no link"
        >
          <option value="">+ inserir atributo</option>
          {columns.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {cfg.mode === 'template' && (
        <>
          <input
            value={cfg.template}
            onChange={(e) => onChange({ template: e.target.value })}
            placeholder="https://site.com/relatorio?id={ID}"
            className="block h-7 w-full rounded border border-slate-300 bg-white px-1.5 font-mono text-[11px]"
            aria-label="Modelo do link"
          />
          <p className="text-[11px] text-slate-400">
            {'{atributo}'} é trocado pelo valor do ponto em análise.
          </p>
        </>
      )}
      <label className="flex items-center gap-2">
        <input
          type="radio"
          name={name}
          checked={cfg.mode === 'streetview'}
          onChange={() => onChange({ mode: 'streetview' })}
          className="accent-accent-600"
        />
        <span>Street View na coordenada do ponto</span>
      </label>
    </div>
  );
}
