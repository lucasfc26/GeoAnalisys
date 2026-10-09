import { beforeAll, describe, expect, it, vi } from 'vitest';
import { authHeaders } from '@/lib/api';
import { boundaryStore } from '@/lib/boundaries';
import { initProjects, saveProject, type ProjectFile } from '@/lib/project';
import { useAppStore } from '@/stores/appStore';
import { useProjectStore } from '@/stores/projectStore';

vi.mock('@/services/projects', () => ({
  projectsService: { save: vi.fn().mockResolvedValue({}), list: vi.fn() },
}));

type Handler = (msg?: unknown) => unknown;
const handlers: Record<string, Handler> = {};
const writes: { file: string; data: ProjectFile }[] = [];
const bridge = {
  initial: vi.fn().mockResolvedValue(null),
  write: vi.fn(async (file: string, data: ProjectFile) => {
    writes.push({ file, data: JSON.parse(JSON.stringify(data)) });
    return { ok: true };
  }),
  activated: vi.fn(),
  flushed: vi.fn(),
  onOpen: (fn: Handler) => (handlers.open = fn),
  onNew: (fn: Handler) => (handlers.new = fn),
  onSave: (fn: Handler) => (handlers.save = fn),
  onFlush: (fn: Handler) => (handlers.flush = fn),
};

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const geo = { type: 'FeatureCollection' as const, features: [] };

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['setInterval'] });
  window.geoanalisys = { project: bridge as never };
  await initProjects();
});

describe('projetos (.proj)', () => {
  it('novo projeto copiando a configuração atual grava o arquivo com o estado e os limites', async () => {
    useAppStore.getState().addLayer('src-1');
    useAppStore.getState().setBasemap('satellite');
    useAppStore
      .getState()
      .addBoundaries([
        {
          id: 'b1',
          name: 'Bairros',
          color: '#f00',
          width: 2,
          visible: true,
          features: 0,
          bounds: null,
        },
      ]);
    await boundaryStore.set('b1', geo);
    localStorage.setItem('geoanalisys-mapmaker', JSON.stringify({ kind: 'comite', token: 'pk.x' }));

    await handlers.new({ path: 'C:/p/Um.proj', name: 'Um', id: A, copy: true });

    expect(useProjectStore.getState().project?.id).toBe(A);
    expect(authHeaders()['x-project-id']).toBe(A);
    expect(bridge.activated).toHaveBeenLastCalledWith('C:/p/Um.proj');
    const last = writes.at(-1)!;
    expect(last.file).toBe('C:/p/Um.proj');
    expect(last.data).toMatchObject({ format: 'geoanalisys-project', id: A, name: 'Um' });
    expect(last.data.state.layers?.map((l) => l.sourceId)).toEqual(['src-1']);
    expect(last.data.state.basemap).toBe('satellite');
    expect(last.data.boundaries.b1).toEqual(geo);
    // O token do Mapbox é do usuário: não vai para o arquivo.
    expect(JSON.parse(last.data.settings['geoanalisys-mapmaker'])).toEqual({ kind: 'comite' });
  });

  it('novo projeto em branco limpa camadas, limites e configurações (mantém o token)', async () => {
    await handlers.new({ path: 'C:/p/Dois.proj', name: 'Dois', id: B, copy: false });
    const s = useAppStore.getState();
    expect(s.layers).toEqual([]);
    expect(s.boundaries).toEqual([]);
    expect(s.sourceId).toBeNull();
    expect(JSON.parse(localStorage.getItem('geoanalisys-mapmaker')!)).toEqual({ token: 'pk.x' });
    expect(writes.at(-1)!.data.id).toBe(B);
  });

  it('abrir projeto salva o atual e restaura o estado do arquivo', async () => {
    useAppStore.getState().addLayer('src-2');
    const um = writes.find((w) => w.file === 'C:/p/Um.proj')!.data;
    const before = writes.length;

    await handlers.open({ path: 'C:/p/Um.proj', name: 'Um', data: um });

    expect(writes[before].file).toBe('C:/p/Dois.proj');
    expect(writes[before].data.state.layers?.map((l) => l.sourceId)).toEqual(['src-2']);
    const s = useAppStore.getState();
    expect(s.layers.map((l) => l.sourceId)).toEqual(['src-1']);
    expect(s.boundaries.map((b) => b.id)).toEqual(['b1']);
    expect(useProjectStore.getState().project).toMatchObject({ id: A, name: 'Um' });
  });

  it('salvamento automático grava só quando algo muda', async () => {
    const n = writes.length;
    await saveProject();
    expect(writes.length).toBe(n);
    useAppStore.getState().setBasemap('osm');
    await saveProject();
    expect(writes.length).toBe(n + 1);
    expect(writes.at(-1)!.data.state.basemap).toBe('osm');
  });

  it('arquivo inválido não troca o projeto', async () => {
    await handlers.open({ path: 'C:/p/x.proj', name: 'x', data: { format: 'outro' } });
    expect(useProjectStore.getState().project?.id).toBe(A);
  });
});
