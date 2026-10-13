import { useMutation } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '@/lib/api';
import { changesService } from '@/services/changes';
import { fmtInt } from '@/utils/format';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Label, RadioCard } from '../ui/Field';
import { toast } from '../ui/Toaster';

/** Observação de várias linhas da Tabela de Alterações: substitui ou acrescenta à existente. */
export function ChangeObservationDialog({
  ids,
  onClose,
  onSaved,
}: {
  ids: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [text, setText] = useState('');
  const [append, setAppend] = useState(true);

  const save = useMutation({
    mutationFn: () => changesService.setObservation(ids, text, append),
    onSuccess: (r) => {
      toast.success(`Observação atualizada em ${fmtInt(r.updated)} linha(s).`);
      onSaved();
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Dialog
      open
      size="sm"
      title="Editar observação"
      description={`${fmtInt(ids.length)} linha(s) selecionada(s).`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button
            variant="primary"
            icon={<Save className="size-4" />}
            loading={save.isPending}
            disabled={append && !text.trim()}
            onClick={() => save.mutate()}
          >
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <RadioCard checked={append} onChange={() => setAppend(true)}>
            Acrescentar
          </RadioCard>
          <RadioCard checked={!append} onChange={() => setAppend(false)}>
            Substituir
          </RadioCard>
        </div>
        <div>
          <Label htmlFor="co-text" hint={append ? 'separada por "; "' : 'vazio apaga'}>
            Observação
          </Label>
          <textarea
            id="co-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={2000}
            rows={3}
            autoFocus
            className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-accent-500 focus:outline-none"
          />
        </div>
      </div>
    </Dialog>
  );
}
