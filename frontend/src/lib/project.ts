import { toast } from '@/components/ui/Toaster';
import { errorMessage } from '@/lib/api';
import { projectsService } from '@/services/projects';
import { PROJECT_KEYS, projectStateOf, useAppStore, type ProjectState } from '@/stores/appStore';
import { useProjectStore, type OpenProject } from '@/stores/projectStore';
import type { LatLng } from '@/types';
import { boundaryStore, type GeoCollection } from './boundaries';

/**
 * Projetos do programa desktop: arquivo <nome>.proj (JSON) com camadas, filtros, simbologia, limites
 * (com as geometrias), mapas de fundo, configurações das janelas e a posição do mapa. O menu Arquivo
 * (processo principal do Electron) escolhe os arquivos; aqui o conteúdo é montado e aplicado.
 * O projeto aberto é salvo automaticamente a cada alteração. No navegador (sem o programa), nada muda.
 */

const FORMAT = 'geoanalisys-project';
const VERSION = 1;
const AUTOSAVE_MS = 2000;
/** Configurações guardadas fora do store (localStorage): criação de mapas, colunas do modo lista… */
const SETTINGS_PREFIX = 'geoanalisys-';
/** Token do Mapbox (criação de mapas): é do usuário, não vai para o arquivo. */
const MAPMAKER_KEY = 'geoanalisys-mapmaker';

export interface ProjectView {
  center: LatLng;
  zoom: number;
}

export interface ProjectFile {
  format: typeof FORMAT;
  version: number;
  id: string;
  name: string;
  createdAt: string;
  savedAt: string;
  state: Partial<ProjectState>;
  /** Geometrias dos limites, por id */
  boundaries: Record<string, GeoCollection>;
  /** Chaves do localStorage (geoanalisys-*) */
  settings: Record<string, string>;
  view: ProjectView | null;
}

interface DesktopProjectBridge {
  initial: () => Promise<{ path: string; name: string; data: ProjectFile } | null>;
  write: (file: string, data: ProjectFile) => Promise<{ ok: boolean; error?: string }>;
  activated: (file: string | null) => void;
  flushed: () => void;
  onOpen: (fn: (msg: { path: string; name: string; data: ProjectFile }) => void) => void;
  onNew: (fn: (msg: { path: string; name: string; id: string; copy: boolean }) => void) => void;
  onSave: (fn: () => void) => void;
  onFlush: (fn: () => void) => void;
}

declare global {
  interface Window {
    geoanalisys?: {
      project?: DesktopProjectBridge;
      /** Menus Ferramentas e Sobre do programa desktop */
      tools?: { onOpen: (fn: (name: string) => void) => void };
      /** Menu Exibir: alternar partes da tela e informar o que está visível */
      view?: {
        onToggle: (fn: (part: string) => void) => void;
        state: (state: { layers: boolean; maps: boolean; info: boolean }) => void;
      };
      /** Caminho no disco de um arquivo escolhido (null se não houver) */
      files?: { pathOf: (file: File) => string | null };
    };
  }
}

const bridge = (): DesktopProjectBridge | undefined => window.geoanalisys?.project;

// ------------------------------------------------------------------ posição do mapa

let viewGetter: (() => ProjectView | null) | null = null;

/** O mapa informa como ler a posição atual (null ao desmontar). */
export function setProjectViewGetter(fn: (() => ProjectView | null) | null) {
  viewGetter = fn;
}

// ------------------------------------------------------------------ configurações (localStorage)

function readSettings(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(SETTINGS_PREFIX)) continue;
      const v = localStorage.getItem(k);
      if (v !== null) out[k] = k === MAPMAKER_KEY ? withoutToken(v) : v;
    }
  } catch {
    /* sem localStorage */
  }
  return out;
}

function withoutToken(raw: string): string {
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    delete o.token;
    return JSON.stringify(o);
  } catch {
    return raw;
  }
}

/** Troca as configurações pelas do projeto, mantendo o token do Mapbox do usuário. */
function writeSettings(settings: Record<string, string>) {
  try {
    let token: unknown;
    try {
      token = (JSON.parse(localStorage.getItem(MAPMAKER_KEY) ?? '{}') as { token?: unknown }).token;
    } catch {
      /* configuração ilegível */
    }
    const old: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(SETTINGS_PREFIX)) old.push(k);
    }
    old.forEach((k) => localStorage.removeItem(k));
    for (const [k, v] of Object.entries(settings)) {
      if (!k.startsWith(SETTINGS_PREFIX) || typeof v !== 'string') continue;
      localStorage.setItem(k, v);
    }
    if (token) {
      let o: Record<string, unknown> = {};
      try {
        o = JSON.parse(localStorage.getItem(MAPMAKER_KEY) ?? '{}') as Record<string, unknown>;
      } catch {
        /* recomeça */
      }
      localStorage.setItem(MAPMAKER_KEY, JSON.stringify({ ...o, token }));
    }
  } catch {
    /* sem localStorage: as configurações valem só nesta sessão */
  }
}

// ------------------------------------------------------------------ montar / aplicar

async function buildFile(p: OpenProject): Promise<ProjectFile> {
  const state = projectStateOf(useAppStore.getState());
  const boundaries: Record<string, GeoCollection> = {};
  for (const b of state.boundaries ?? []) {
    const data = await boundaryStore.get(b.id);
    if (data) boundaries[b.id] = data;
  }
  return {
    format: FORMAT,
    version: VERSION,
    id: p.id,
    name: p.name,
    createdAt: p.createdAt,
    savedAt: new Date().toISOString(),
    state,
    boundaries,
    settings: readSettings(),
    view: viewGetter?.() ?? null,
  };
}

/** Substitui o estado do sistema pelo do projeto (`null` = projeto em branco). */
async function applyFile(
  file: Pick<ProjectFile, 'state' | 'boundaries' | 'settings' | 'view'> | null,
) {
  for (const [id, data] of Object.entries(file?.boundaries ?? {})) {
    await boundaryStore.set(id, data);
  }
  writeSettings(file?.settings ?? {});
  const initial = useAppStore.getInitialState();
  const state = file?.state ?? {};
  const view = file?.view;
  useAppStore.setState({
    ...projectStateOf(initial),
    // Só as chaves conhecidas (arquivo de versão mais nova pode ter outras).
    ...projectStateOf(Object.fromEntries(PROJECT_KEYS.map((k) => [k, state[k]]))),
    selection: {},
    primaryIds: null,
    activeKey: null,
    activeRecordId: null,
    transform: null,
    listWindows: [],
    searchWindows: [],
    dialogs: initial.dialogs,
    focus: view ? { center: view.center, zoom: view.zoom, nonce: Date.now() } : null,
  });
}

// ------------------------------------------------------------------ salvar

/** Estado já gravado no arquivo (a posição do mapa sozinha não dispara o salvamento). */
let savedFingerprint = '';
let queue: Promise<unknown> = Promise.resolve();
let lastError: string | null = null;

const fingerprint = (p: OpenProject) =>
  JSON.stringify([p.path, projectStateOf(useAppStore.getState()), readSettings()]);

/** Grava o projeto aberto (`force`: mesmo sem alterações, ex.: Ctrl+S e ao fechar). */
export function saveProject(force = false): Promise<void> {
  const run = async () => {
    const b = bridge();
    const p = useProjectStore.getState().project;
    if (!b || !p) return;
    const fp = fingerprint(p);
    if (!force && fp === savedFingerprint) return;
    const r = await b.write(p.path, await buildFile(p));
    if (!r.ok) {
      // Mostra o erro uma vez (o salvamento automático tenta de novo).
      if (r.error !== lastError) toast.error(`Não foi possível salvar o projeto: ${r.error}`);
      lastError = r.error ?? '';
      return;
    }
    lastError = null;
    savedFingerprint = fp;
    projectsService.save(p.id, p.name, true).catch(() => undefined);
  };
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}

/** Passa a usar o projeto: cabeçalho da API, título da janela, recentes e registro no banco. */
function activate(p: OpenProject) {
  useProjectStore.setState({ project: p });
  savedFingerprint = fingerprint(p);
  bridge()?.activated(p.path);
}

const isUuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

async function openFile(path: string, name: string, data: ProjectFile) {
  if (data?.format !== FORMAT || !isUuid(data.id)) {
    toast.error(`"${name}" não é um projeto válido do GeoAnalisys.`);
    return false;
  }
  await applyFile(data);
  activate({ id: data.id.toLowerCase(), name, path, createdAt: data.createdAt ?? data.savedAt });
  await projectsService
    .save(data.id, name, false)
    .catch((err) =>
      toast.error(`Projeto aberto, mas não registrado no banco: ${errorMessage(err)}`),
    );
  return true;
}

// ------------------------------------------------------------------ início

/**
 * Chamado antes de montar a tela: reabre o último projeto (programa desktop) e liga o menu Arquivo
 * e o salvamento automático. No navegador não faz nada.
 */
export async function initProjects() {
  const b = bridge();
  if (!b) return;

  try {
    const initial = await b.initial();
    if (initial) await openFile(initial.path, initial.name, initial.data);
  } catch {
    /* começa sem projeto */
  }

  b.onOpen(async ({ path, name, data }) => {
    await saveProject(true);
    if (await openFile(path, name, data)) toast.success(`Projeto "${name}" aberto.`);
  });

  b.onNew(async ({ path, name, id, copy }) => {
    await saveProject(true);
    if (!copy) await applyFile(null);
    activate({ id, name, path, createdAt: new Date().toISOString() });
    try {
      await projectsService.save(id, name, true);
    } catch (err) {
      toast.error(`Projeto criado, mas não registrado no banco: ${errorMessage(err)}`);
    }
    await saveProject(true);
    toast.success(`Projeto "${name}" criado.`);
  });

  b.onSave(() => {
    if (!useProjectStore.getState().project) {
      toast.info('Nenhum projeto aberto — use Arquivo > Novo Projeto.');
      return;
    }
    saveProject(true).then(() => !lastError && toast.success('Projeto salvo.'));
  });

  b.onFlush(() => {
    saveProject(true).finally(() => b.flushed());
  });

  setInterval(() => void saveProject(false), AUTOSAVE_MS);
}
