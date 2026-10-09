# GeoAnalisys

Aplicação web estilo GIS para visualizar, selecionar, consultar, editar e exportar pontos com coordenadas
UTM armazenados no PostgreSQL local, exibidos sobre mapas de fundo gratuitos (MapLibre GL).

- **Backend:** NestJS 11 + Prisma 6 + proj4 + ExcelJS (`backend/`)
- **Frontend:** React 19 + Vite + Tailwind 4 + TanStack Query + Zustand + MapLibre GL (`frontend/`)
- Sem Docker: tudo roda com `npm run dev` / `npm run start`.

## Requisitos

- Node.js 20+ (testado com 24)
- PostgreSQL local (PostGIS opcional; se existir, a coluna `geom` pode ser mantida sincronizada)

## Configuração

1. **Banco** — `backend/.env`:

   ```env
   DATABASE_URL="postgresql://postgres:SENHA@localhost:5432/postgres?schema=gis_app"
   ```

   O schema `gis_app` guarda somente as tabelas internas (fontes de dados configuradas e auditoria).
   Ele é criado automaticamente. **As suas tabelas (ex.: `public."Censo_Atual"`) não são alteradas pela
   sincronização do Prisma** — elas são lidas por SQL parametrizado, a partir das colunas que você escolhe na tela.

2. **Mapas de fundo** — nenhuma chave é necessária. Já vêm prontos: **OpenStreetMap**, **Satélite (Esri)**,
   **Satélite + rótulos (Esri)** e **Sem fundo**. Em "Adicionar mapa por URL (XYZ)" você cola uma URL de tiles
   no mesmo formato do QGIS (`{z}`, `{x}`, `{y}`, `{-y}`, `{s}`, `{q}`). Use apenas serviços cujos termos permitam
   esse acesso (Google e Bing, por exemplo, não liberam o uso direto dos tiles fora das APIs oficiais).

3. Instale as dependências (uma vez, na raiz):

   ```bash
   npm install
   ```

## Execução

| Comando         | O que faz                                                                                   | Abrir                     |
| --------------- | ------------------------------------------------------------------------------------------- | ------------------------- |
| `npm run dev`   | API com hot reload (porta 3000) + Vite (porta 5173, com proxy `/api`)                        | http://localhost:5173     |
| `npm run start` | Compila backend e frontend e sobe um único servidor que serve a API e a interface            | http://localhost:3000     |
| `npm test`      | Testes unitários (Jest no backend, Vitest no frontend)                                      |                           |

No PowerShell com execução de scripts bloqueada (erro "npm.ps1 não pode ser carregado"), use `npm.cmd run dev` /
`npm.cmd run start`, ou dê dois cliques em `dev.cmd` / `start.cmd` na raiz do projeto.

Swagger/OpenAPI: http://localhost:3000/api/docs · Health: `/api/health` e `/api/health/database`.

## Primeiro uso

1. Abra o sistema → a janela **Fontes de dados** aparece.
2. Escolha schema e tabela; informe as colunas **X (UTM Leste)**, **Y (UTM Norte)** e **ID**.
3. Escolha o **sistema de referência (EPSG)** — a zona UTM/hemisfério nunca são adivinhados.
4. Clique em **Testar**: mostra quantas coordenadas são válidas, a extensão em lat/lng, avisos (ID não
   único, falta de índice) e uma prévia convertida.
5. **Salvar e carregar mapa**.

> Na tabela `Censo_Atual`, as colunas `latitude`/`longitude` contêm valores UTM (≈568649 / 9436907).
> Use X = `latitude`, Y = `longitude`, EPSG:31984 (SIRGAS 2000 / UTM 24S), ID = `ID`, geometria = `geom`.

## Funcionalidades

- Descoberta de schemas, tabelas e colunas (numéricas destacadas); tabelas sem chave primária são suportadas.
- Conversão UTM → WGS84 com proj4 (SIRGAS 2000, SAD69, Córrego Alegre, WGS 84, todas as zonas, ou proj4 personalizado).
- **Várias camadas no mapa** (painel "Camadas" estilo QGIS): visibilidade, ordem, zoom na camada e **camada ativa**
  (alvo de seleção, filtros, busca, edição e exportação — troque pelo nome no painel, pela barra superior ou clicando
  num ponto da camada). Os filtros ficam guardados por camada.
- **Estilo por categoria**: escolha a coluna (ex.: `medicao`) e defina cor, tamanho e visibilidade de cada valor
  (ex.: Sim/Não), com contagem por valor; ou símbolo único com cor/tamanho/opacidade.
- **Rótulos** com expressão no estilo QGIS — `"ID" || ' ' || "tipo_lampada" || ' ' || "potencia" || ' ' || "medicao"`
  → `999999 LD 100 Não` — com prévia, tamanho, cor, negrito, contorno e zoom mínimo; rótulos sobrepostos são omitidos.
  A expressão é validada e convertida em SQL parametrizado (sem injeção).
- **Desempenho**: cada camada é baixada uma vez só com ID, posição, categoria e rótulo (`/api/points/layer`, formato
  colunar + gzip) e desenhada em um único canvas. Fica em cache na memória e no IndexedDB; ao reabrir, o servidor só
  confirma a versão (contadores do PostgreSQL) e nada é baixado se a tabela não mudou. Os demais campos só são lidos do
  banco ao abrir os detalhes de um ponto. Tabelas acima de 300.000 pontos (`LAYER_MAX_POINTS`) usam o modo por viewport
  (`/api/points/bbox`) com clusters calculados no banco.
- Pontos sobrepostos: número no marcador, lista de registros da coordenada e navegação `< >`.
- Seleção: clique, Ctrl/Shift + clique, ferramenta de seleção múltipla, retângulo e polígono (no backend).
- Painel direito: detalhes de todos os campos, histórico de alterações; resumo por categoria e lista virtualizada para seleções grandes.
- CRUD: adicionar por formulário ou clicando no mapa (lat/lng → UTM), editar (recalcula lat/lng e atualiza `geom`), excluir com confirmação.
- Edição e exclusão em massa em transação.
- Filtros dinâmicos (sem SQL injection: colunas validadas pelo catálogo, valores sempre parametrizados).
- Busca por ID, rótulo e colunas configuráveis → centraliza, destaca e abre o painel.
- Exportação CSV (UTF-8, BOM, delimitador e separador decimal configuráveis) e XLSX (abas Pontos, Informações, Metadados) em streaming.
- Auditoria de todas as alterações (`gis_app.audit_log`), logs estruturados (`LOG_JSON=true`), rate limit, token opcional (`API_TOKEN`).
- Botão de criação de índices em X/Y e ID (recomendado para tabelas grandes como `Base Unificada`).

### Atalhos

`N` navegar · `S` selecionar · `M` seleção múltipla · `R` retângulo · `P` polígono · `A` adicionar ·
`E` editar · `Del` excluir · `C` centralizar · `+`/`-` zoom · `Esc` limpar seleção

## Estrutura

```text
backend/
  prisma/schema.prisma          DataSource e AuditLog (schema gis_app)
  src/common/                   SQL seguro, filtros, geometria, erros, logs, guard
  src/modules/maps/             catálogo de CRS e conversões
  src/modules/tables/           descoberta do banco e fontes de dados
  src/modules/points/           bbox/clusters, CRUD, bulk, busca, resumo
  src/modules/selection/        seleção por polígono/retângulo
  src/modules/export/           CSV/XLSX em streaming
  src/modules/audit/            auditoria
  src/modules/health/           health checks
frontend/src/
  components/{layout,map,points,tables,forms,export,ui}
  hooks/ services/ stores/ types/ utils/ lib/ pages/
```

## Fora do escopo desta versão (pós-MVP do roadmap)

Docker/Nginx (substituídos por `npm run start`), importação (Shapefile/KML/Excel), heatmap,
medições, usuários/permissões completos e testes E2E automatizados no repositório.


npm.cmd run start