import { api, qs } from '@/lib/api';

/** Ferramentas com templates de configuração */
export type TemplateTool = 'association' | 'duplicates' | 'attribute-distance' | 'comparison';

export interface ToolTemplate {
  id: string;
  tool: TemplateTool;
  name: string;
  /** Configurações da janela, como ela as guarda */
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export const toolTemplatesService = {
  list: (tool: TemplateTool) => api.get<ToolTemplate[]>(`/tool-templates${qs({ tool })}`),
  create: (t: { tool: TemplateTool; name: string; settings: object }) =>
    api.post<ToolTemplate>('/tool-templates', t),
  update: (id: string, patch: { name?: string; settings?: object }) =>
    api.patch<ToolTemplate>(`/tool-templates/${id}`, patch),
  remove: (id: string) => api.delete<{ deleted: boolean }>(`/tool-templates/${id}`),
};
