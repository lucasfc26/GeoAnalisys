import { useMutation } from '@tanstack/react-query';
import { FileDown, FileUp, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { errorMessage } from '@/lib/api';
import { csvBlob } from '@/lib/selectPoints';
import { changesService, type ChangeImportResult } from '@/services/changes';
import { triggerDownload } from '@/services/export';
import { fmtInt } from '@/utils/format';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { toast } from '../ui/Toaster';

const TEMPLATE_HEADERS = ['Tabela', 'ID', 'Observacao', 'Atributos Alterados', 'Valores Novos'];

function downloadTemplate() {
  const blob = csvBlob(TEMPLATE_HEADERS, [
    ['Nome da camada', 10001, 'Conferido em campo', '[situacao, numero]', '[Ativo, 70]'],
  ]);
  const href = URL.createObjectURL(blob);
  triggerDownload(href, 'modelo_alteracoes.csv');
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

const failedRows = (r: ChangeImportResult) => r.rows - r.applied - r.removed - r.unchanged;

/**
 * Importa alterações de uma planilha: grava os valores novos nos pontos (a Tabela de Alterações
 * acompanha) e acrescenta a observação; "Removido…" na observação remove o ponto. Não cria pontos.
 */
export function ChangeImportDialog({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ChangeImportResult | null>(null);

  const run = useMutation({
    mutationFn: (f: File) => changesService.import(f),
    onSuccess: (r) => {
      setResult(r);
      if (r.applied || r.removed) onImported();
      const failed = failedRows(r);
      if (failed > 0) toast.error(`${fmtInt(failed)} linha(s) não importada(s).`);
      else
        toast.success(
          `${fmtInt(r.applied)} ponto(s) atualizado(s)${r.removed ? ` e ${fmtInt(r.removed)} removido(s)` : ''}.`,
        );
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const failed = result ? failedRows(result) : 0;

  return (
    <Dialog
      open
      size="md"
      title="Importar alterações"
      description="Os valores novos são gravados nos pontos e entram na Tabela de Alterações."
      onClose={onClose}
      footer={
        <>
          <Button
            className="mr-auto"
            icon={<FileDown className="size-4" />}
            onClick={downloadTemplate}
          >
            Baixar modelo
          </Button>
          <Button onClick={onClose}>{result ? 'Fechar' : 'Cancelar'}</Button>
          <Button
            variant="primary"
            icon={<Upload className="size-4" />}
            loading={run.isPending}
            disabled={!file}
            onClick={() => file && run.mutate(file)}
          >
            Importar
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-slate-700">
        <div className="flex items-center gap-2">
          <input
            ref={input}
            type="file"
            accept=".xlsx,.xlsm,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setResult(null);
              e.target.value = '';
            }}
          />
          <Button icon={<FileUp className="size-4" />} onClick={() => input.current?.click()}>
            Escolher arquivo
          </Button>
          <span className="truncate text-xs text-slate-500">
            {file ? file.name : '.xlsx, .xlsm ou .csv'}
          </span>
        </div>

        <div className="rounded-md bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
          <p className="mb-1 font-medium text-slate-700">Colunas da planilha (1ª aba)</p>
          <ul className="list-disc space-y-0.5 pl-4">
            <li>
              <b>Tabela</b> — nome da camada (ou o nome da tabela) e <b>ID</b> — registro do ponto.
            </li>
            <li>
              <b>Observacao</b> — acrescentada à observação que o ponto já tem na tabela. Começando
              com <b>Removido</b> (ex.: <code>Removido: Duplicidade</code>), o ponto é removido e os
              atributos da linha são ignorados.
            </li>
            <li>
              <b>Atributos Alterados</b> e <b>Valores Novos</b> — listas na mesma ordem, como na
              tabela: <code>[situacao, numero]</code> e <code>[Ativo, 70]</code>. Use “;” para
              separar valores que tenham vírgula; item vazio grava vazio.
            </li>
          </ul>
          <p className="mt-1">
            Só pontos que já existem na camada: a importação altera ou remove, nunca adiciona. Ponto
            já na tabela: os atributos importados são acrescentados ou substituídos; um valor igual
            ao original tira o atributo da lista.
          </p>
        </div>

        {result && (
          <div className="rounded-md border border-slate-200 px-3 py-2 text-xs">
            <p>
              {fmtInt(result.rows)} linha(s):{' '}
              <b className="text-emerald-700">{fmtInt(result.applied)}</b> aplicada(s),{' '}
              {result.removed > 0 && (
                <>
                  <b className="text-red-700">{fmtInt(result.removed)}</b> ponto(s)
                  removido(s),{' '}
                </>
              )}
              {fmtInt(result.unchanged)} sem mudança
              {failed > 0 && (
                <>
                  , <b className="text-red-700">{fmtInt(failed)}</b> com erro
                </>
              )}
              .
            </p>
            {result.errors.length > 0 && (
              <ul className="scroll-thin mt-2 max-h-40 space-y-0.5 overflow-y-auto text-red-700">
                {result.errors.map((e) => (
                  <li key={e.line}>
                    Linha {e.line}: {e.message}
                  </li>
                ))}
                {failed > result.errors.length && (
                  <li className="text-slate-500">
                    … e mais {fmtInt(failed - result.errors.length)} linha(s).
                  </li>
                )}
              </ul>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
