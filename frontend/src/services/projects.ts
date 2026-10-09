import { api } from '@/lib/api';

export interface ProjectRow {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export const projectsService = {
  list: () => api.get<ProjectRow[]>('/projects'),
  /**
   * Registra o projeto em gis_app.projetos. `touch` = salvamento: atualiza a data de atualização
   * (ao só abrir, a data fica como está).
   */
  save: (id: string, name: string, touch: boolean) =>
    api.put<ProjectRow>(`/projects/${id}`, { name, touch }),
};
