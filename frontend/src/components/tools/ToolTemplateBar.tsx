import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '@/lib/api';
import {
  toolTemplatesService,
  type TemplateTool,
  type ToolTemplate,
} from '@/services/toolTemplates';
import { Button } from '../ui/Button';
import { Input, Label, Select } from '../ui/Field';
import { toast } from '../ui/Toaster';

/** Template escolhido por ferramenta (vai junto com as configurações do projeto). */
const selectedKey = (tool: TemplateTool) => `geoanalisys-tool-template:${tool}`;

function loadSelected(tool: TemplateTool) {
  try {
    return localStorage.getItem(selectedKey(tool)) ?? '';
  } catch {
    return '';
  }
}

/** JSON com as chaves em ordem, para comparar configurações. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

/**
 * Templates das configurações de uma ferramenta, salvos no banco: escolher um aplica as
 * configurações dele na janela; "Salvar" grava as atuais no template escolhido.
 */
export function ToolTemplateBar<T extends object>({
  tool,
  settings,
  onApply,
}: {
  tool: TemplateTool;
  settings: T;
  /** Configurações do template (podem faltar campos de versões antigas) */
  onApply: (saved: Partial<T>) => void;
}) {
  const qc = useQueryClient();
  const queryKey = ['tool-templates', tool] as const;
  const templates = useQuery({ queryKey, queryFn: () => toolTemplatesService.list(tool) });
  const [selected, setSelected] = useState(() => loadSelected(tool));
  const [newName, setNewName] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const template: ToolTemplate | undefined = templates.data?.find((t) => t.id === selected);
  const dirty = !!template && stable(template.settings) !== stable(settings);

  const choose = (id: string) => {
    setSelected(id);
    setConfirmDelete(false);
    setNewName(null);
    try {
      localStorage.setItem(selectedKey(tool), id);
    } catch {
      /* só nesta sessão */
    }
  };
  const pick = (id: string) => {
    choose(id);
    const t = templates.data?.find((x) => x.id === id);
    if (t) onApply(t.settings as Partial<T>);
  };

  const refresh = () => qc.invalidateQueries({ queryKey });
  const create = useMutation({
    mutationFn: (name: string) => toolTemplatesService.create({ tool, name, settings }),
    onSuccess: async (t) => {
      await refresh();
      choose(t.id);
      toast.success(`Template "${t.name}" salvo.`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const update = useMutation({
    mutationFn: () => toolTemplatesService.update(selected, { settings }),
    onSuccess: async (t) => {
      await refresh();
      toast.success(`Template "${t.name}" atualizado.`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: () => toolTemplatesService.remove(selected),
    onSuccess: async () => {
      const name = template?.name;
      await refresh();
      choose('');
      toast.success(`Template "${name}" excluído.`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-2">
      <Label htmlFor={`tpl-${tool}`} hint="configurações salvas no banco">
        Template
        {dirty && <span className="ml-1 text-amber-600">(alterado)</span>}
      </Label>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          id={`tpl-${tool}`}
          className="min-w-0 flex-1"
          value={template ? selected : ''}
          onChange={(e) => pick(e.target.value)}
          disabled={!templates.data}
        >
          <option value="">{templates.data?.length ? 'Escolha um template…' : 'Nenhum template salvo'}</option>
          {templates.data?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
        {template && (
          <Button
            size="sm"
            icon={<Save className="size-3.5" />}
            disabled={!dirty}
            loading={update.isPending}
            onClick={() => update.mutate()}
            title="Grava as configurações atuais neste template"
          >
            Salvar
          </Button>
        )}
        <Button size="sm" onClick={() => setNewName(newName === null ? '' : null)}>
          Salvar como novo…
        </Button>
        {template &&
          (confirmDelete ? (
            <Button
              size="sm"
              variant="danger"
              loading={remove.isPending}
              onClick={() => remove.mutate()}
              onBlur={() => setConfirmDelete(false)}
            >
              Confirmar exclusão
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 className="size-3.5" />}
              onClick={() => setConfirmDelete(true)}
              title="Excluir template"
              aria-label="Excluir template"
            />
          ))}
      </div>
      {newName !== null && (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (newName.trim()) create.mutate(newName.trim());
          }}
        >
          <Input
            autoFocus
            placeholder="Nome do template (ex.: Censo 2026)"
            value={newName}
            maxLength={100}
            onChange={(e) => setNewName(e.target.value)}
          />
          <Button
            type="submit"
            size="sm"
            variant="primary"
            loading={create.isPending}
            disabled={!newName.trim()}
          >
            Salvar
          </Button>
        </form>
      )}
      {templates.isError && <p className="text-xs text-red-600">{errorMessage(templates.error)}</p>}
    </div>
  );
}
