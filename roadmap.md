# Roadmap — Sistema GIS de Pontos com UTM

## 1. Visão geral

Construir uma aplicação web inspirada em ferramentas GIS/QGIS para visualizar, selecionar, consultar e editar pontos georreferenciados armazenados em um banco de dados local.

O sistema deverá:

- Ler tabelas de um banco de dados local contendo coordenadas `UTMX` e `UTMY`.
- Permitir selecionar a tabela/campos utilizados como fonte dos pontos.
- Converter coordenadas UTM para latitude/longitude.
- Exibir os pontos sobre mapas do Google.
- Permitir seleção individual ou múltipla de pontos.
- Permitir seleção de uma região no mapa.
- Exibir os dados dos pontos selecionados em um painel lateral direito.
- Suportar múltiplos registros na mesma coordenada.
- Permitir criar, editar e excluir pontos/registros.
- Exportar os dados para CSV e XLSX.
- Manter a interface responsiva e preparada para grandes volumes de dados.

---

# 2. Stack tecnológica

## Frontend

- TypeScript
- React
- Tailwind CSS
- Vite
- Google Maps JavaScript API
- TanStack Query
- Zustand ou Context API
- Lazy Loading / Code Splitting

## Backend

- TypeScript
- NestJS
- Prisma ORM
- REST API
- Class Validator
- Swagger/OpenAPI
- Lazy Loading de relacionamentos e dados pesados

## Banco de dados

Arquitetura inicialmente preparada para banco de dados local, com possibilidade de suportar:

- PostgreSQL + PostGIS — recomendado
- PostgreSQL sem PostGIS
- MySQL
- SQL Server

O banco deve manter as coordenadas originais `UTMX` e `UTMY`, além da referência espacial utilizada para interpretação dessas coordenadas.

## Exportação

- CSV
- XLSX
- Streaming para grandes volumes

## Infraestrutura

- Docker
- Docker Compose
- Nginx
- Variáveis de ambiente
- Logs estruturados

---

# 3. Arquitetura geral

```text
┌─────────────────────────────────────────────────────────┐
│                    FRONTEND                            │
│                  React + TS                            │
│                                                         │
│  ┌───────────────┐      ┌───────────────────────────┐  │
│  │ Barra lateral │      │                           │  │
│  │ / Ferramentas │      │       Google Maps         │  │
│  │               │      │                           │  │
│  │ • Selecionar  │      │      ● ● ● ●              │  │
│  │ • Região      │      │        ●                   │  │
│  │ • Adicionar   │      │   ● ●                     │  │
│  │ • Editar      │      │                           │  │
│  │ • Excluir     │      │                           │  │
│  └───────────────┘      └───────────────────────────┘  │
│                                      │                  │
│                                      ▼                  │
│                         ┌───────────────────────────┐  │
│                         │ Painel de informações     │  │
│                         │                           │  │
│                         │ Registro 1  < >           │  │
│                         │ Registro 2  < >           │  │
│                         └───────────────────────────┘  │
└──────────────────────────────┬─────────────────────────┘
                               │ REST
                               ▼
┌─────────────────────────────────────────────────────────┐
│                    NESTJS API                           │
│                                                         │
│  Maps │ Points │ Tables │ Selection │ Import │ Export │
└──────────────────────────────┬─────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────┐
│                    PRISMA ORM                           │
└──────────────────────────────┬─────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────┐
│                  BANCO LOCAL                            │
│                                                         │
│  Tabelas com UTMX / UTMY + demais informações          │
└─────────────────────────────────────────────────────────┘
```

---

# 4. Estrutura funcional da aplicação

## Layout principal

A aplicação deverá utilizar um layout GIS de três áreas:

### 4.1 Toolbar

Localizada no topo ou lateral.

Ferramentas:

- Selecionar ponto
- Seleção múltipla
- Seleção por retângulo
- Seleção por polígono
- Limpar seleção
- Adicionar ponto
- Editar ponto
- Excluir ponto
- Centralizar mapa
- Zoom
- Exportar
- Atualizar dados

### 4.2 Área do mapa

Responsável pela renderização do Google Maps.

Deve suportar:

- Markers
- Marker clusters
- Zoom
- Pan
- Seleção
- Polígonos
- Retângulos
- Highlight dos pontos selecionados
- Tooltip
- InfoWindow
- Pontos sobrepostos

### 4.3 Painel direito

Exibe informações dos pontos selecionados.

Exemplo:

```text
┌─────────────────────────────────────┐
│ Ponto selecionado                   │
├─────────────────────────────────────┤
│ Coordenadas                         │
│ UTM X: 543210.32                    │
│ UTM Y: 7890123.54                   │
│                                     │
│ Registros nesta coordenada: 3       │
│                                     │
│ [Registro 1]                  >     │
│ [Registro 2]                  >     │
│ [Registro 3]                  >     │
├─────────────────────────────────────┤
│ Informações                         │
│                                     │
│ ID: 10293                           │
│ Nome: Exemplo                       │
│ Status: Ativo                       │
│ Tipo: Cliente                       │
│                                     │
│ [Editar] [Excluir]                  │
└─────────────────────────────────────┘
```

---

# 5. Fase 1 — Setup do projeto

## Frontend

- [ ] Criar projeto React + TypeScript + Vite
- [ ] Configurar Tailwind CSS
- [ ] Configurar ESLint
- [ ] Configurar Prettier
- [ ] Criar aliases de importação
- [ ] Configurar TanStack Query
- [ ] Configurar gerenciamento de estado
- [ ] Configurar lazy loading de páginas/componentes
- [ ] Criar estrutura de componentes
- [ ] Configurar variáveis de ambiente

Estrutura sugerida:

```text
frontend/
├── src/
│   ├── components/
│   │   ├── layout/
│   │   ├── map/
│   │   ├── points/
│   │   ├── tables/
│   │   ├── forms/
│   │   └── export/
│   ├── pages/
│   ├── hooks/
│   ├── services/
│   ├── stores/
│   ├── types/
│   ├── utils/
│   └── lib/
├── public/
└── package.json
```

## Backend

- [ ] Criar projeto NestJS
- [ ] Configurar Prisma ORM
- [ ] Configurar Swagger
- [ ] Configurar validação
- [ ] Configurar CORS
- [ ] Configurar tratamento global de erros
- [ ] Configurar logging
- [ ] Configurar variáveis de ambiente

Estrutura:

```text
backend/
├── src/
│   ├── modules/
│   │   ├── maps/
│   │   ├── points/
│   │   ├── tables/
│   │   ├── selection/
│   │   ├── import/
│   │   └── export/
│   ├── common/
│   ├── prisma/
│   └── main.ts
├── prisma/
└── package.json
```

---

# 6. Fase 2 — Modelo de dados

## Entidades principais

### DataSource

Representa uma fonte/tabela disponível para visualização.

Campos sugeridos:

```text
id
name
database
schema
tableName
xColumn
yColumn
coordinateSystem
createdAt
updatedAt
```

### Point

Representação normalizada de um ponto.

```text
id
sourceId
externalId
utmX
utmY
latitude
longitude
zone
hemisphere
createdAt
updatedAt
```

### PointData

Dados adicionais provenientes da tabela original.

Dependendo da estrutura do banco, pode ser:

- JSON
- campos normalizados
- referência para o registro original

### CoordinateSystem

Deve identificar corretamente:

- EPSG
- Zona UTM
- Hemisfério
- Datum

Exemplo:

```text
EPSG:31983
SIRGAS 2000 / UTM zone 23S
```

**Importante:** não assumir automaticamente a zona UTM apenas olhando os valores. A configuração do sistema de coordenadas deverá ser explícita ou definida pelo usuário.

---

# 7. Fase 3 — Conexão com banco local

## Objetivo

Permitir que o sistema descubra tabelas existentes no banco.

Funcionalidades:

- [ ] Listar databases
- [ ] Listar schemas
- [ ] Listar tabelas
- [ ] Listar colunas
- [ ] Identificar colunas numéricas
- [ ] Selecionar coluna UTMX
- [ ] Selecionar coluna UTMY
- [ ] Configurar EPSG
- [ ] Testar leitura
- [ ] Pré-visualizar registros

Tela:

```text
Banco de dados

Database: [___________]

Schema:   [___________]

Tabela:   [clientes_______]

Coordenada X:
[utm_x ▼]

Coordenada Y:
[utm_y ▼]

Sistema:
[EPSG:31983 ▼]

[ Testar ] [ Carregar mapa ]
```

---

# 8. Fase 4 — Conversão UTM → WGS84

O Google Maps trabalha com latitude/longitude.

Fluxo:

```text
UTMX + UTMY
     │
     ▼
EPSG / Datum / Zona
     │
     ▼
Transformação CRS
     │
     ▼
Latitude + Longitude
     │
     ▼
Google Maps
```

A transformação deverá ser feita com uma biblioteca especializada em coordenadas, evitando implementar fórmulas manualmente.

Requisitos:

- [ ] Validar coordenadas
- [ ] Validar zona UTM
- [ ] Validar hemisfério
- [ ] Validar EPSG
- [ ] Converter UTM para WGS84
- [ ] Armazenar coordenadas convertidas quando fizer sentido
- [ ] Manter sempre UTM original

---

# 9. Fase 5 — Google Maps

## Integração

- [ ] Criar Google Cloud Project
- [ ] Ativar Maps JavaScript API
- [ ] Configurar API Key
- [ ] Restringir API Key por domínio
- [ ] Criar componente `MapView`

## Funcionalidades

- [ ] Renderizar mapa
- [ ] Centralizar mapa automaticamente
- [ ] Zoom inicial baseado nos pontos
- [ ] Renderizar markers
- [ ] Clusterização
- [ ] Tooltip
- [ ] Seleção
- [ ] Highlight
- [ ] Atualização dinâmica dos markers

---

# 10. Fase 6 — Renderização eficiente de pontos

Para grandes volumes de dados, não carregar todos os registros completos de uma vez.

## Estratégia

```text
Mapa
 │
 ├── viewport
 │      │
 │      ▼
 │   API /points?bbox=...
 │      │
 │      ▼
 │   Banco
 │      │
 │      ▼
 │   somente pontos visíveis
```

A API deverá aceitar filtros geográficos:

```http
GET /points?minLat=-3.8&maxLat=-3.6&minLng=-38.6&maxLng=-38.4
```

Ou, preferencialmente, uma representação de bounding box.

## Lazy Loading

- [ ] Carregar pontos apenas da região visível
- [ ] Recarregar ao alterar viewport
- [ ] Debounce de movimentação do mapa
- [ ] Evitar chamadas duplicadas
- [ ] Cache dos dados
- [ ] Paginação
- [ ] Clusterização
- [ ] Carregar informações completas apenas após seleção

---

# 11. Fase 7 — Seleção individual

Ao clicar em um marker:

```text
Marker
  │
  ▼
API consulta registros
  │
  ▼
Quantidade de registros
  │
  ├── 1 registro
  │      ▼
  │   Mostrar detalhes
  │
  └── >1 registro
         ▼
      Mostrar lista
```

Exemplo:

```text
3 registros encontrados

┌─────────────────────────┐
│ Registro #1023       >  │
├─────────────────────────┤
│ Registro #1098       >  │
├─────────────────────────┤
│ Registro #1150       >  │
└─────────────────────────┘
```

A seta permite navegar entre os registros.

---

# 12. Fase 8 — Pontos sobrepostos

Quando múltiplos registros possuem exatamente a mesma coordenada:

```text
          ●
          │
     ┌────┴────┐
     │         │
 Registro 1  Registro 2
```

O sistema deverá:

- [ ] Detectar coordenadas duplicadas
- [ ] Agrupar registros
- [ ] Exibir indicador de quantidade
- [ ] Permitir abrir grupo
- [ ] Navegar entre registros
- [ ] Editar registros individualmente
- [ ] Excluir registros individualmente

---

# 13. Fase 9 — Seleção múltipla

Implementar diferentes métodos.

## Clique individual

```text
Click → adiciona/remover ponto da seleção
```

## Ctrl + clique

Permitir selecionar vários pontos manualmente.

## Retângulo

```text
┌───────────────────────┐
│ ●       ●             │
│                       │
│     ●       ●         │
└───────────────────────┘
```

Selecionar todos os pontos dentro da região.

## Polígono

```text
      ●
    /   \
   ●     ●
   |     |
   ●-----●
```

Selecionar pontos dentro do polígono.

## Resultado

Após seleção:

```text
12 pontos selecionados

[Editar em massa]
[Excluir]
[Exportar selecionados]
[Limpar seleção]
```

---

# 14. Fase 10 — Painel lateral

O painel direito deverá ser dinâmico.

Estados:

```text
Nenhuma seleção
        │
        ▼
1 ponto selecionado
        │
        ▼
Múltiplos registros
        │
        ▼
Múltiplos pontos
```

## Para um registro

Mostrar todos os campos disponíveis.

## Para múltiplos pontos

Mostrar resumo:

```text
Selecionados: 27

Tipos:
Cliente: 18
Fornecedor: 6
Outros: 3
```

---

# 15. Fase 11 — CRUD de pontos

## Criar

Permitir adicionar ponto:

```text
Adicionar ponto

UTM X: [________]
UTM Y: [________]

Sistema:
[EPSG:31983]

Nome: [________]
Tipo: [________]
Status: [________]

[Salvar]
```

Também deverá existir a opção:

```text
Adicionar ponto pelo mapa
```

Nesse caso:

```text
Clique no mapa
      ↓
Latitude/Longitude
      ↓
Conversão para UTM
      ↓
Formulário
      ↓
Salvar
```

---

# 16. Fase 12 — Edição

Ao editar:

- [ ] Carregar dados completos
- [ ] Editar atributos
- [ ] Alterar coordenadas
- [ ] Recalcular latitude/longitude
- [ ] Validar dados
- [ ] Salvar
- [ ] Atualizar marker

---

# 17. Fase 13 — Exclusão

Excluir individualmente:

```text
[Excluir ponto]
      ↓
Confirmação
      ↓
DELETE /points/:id
      ↓
Atualizar mapa
```

Excluir múltiplos:

```text
27 pontos selecionados

[Excluir selecionados]
```

Adicionar confirmação obrigatória.

---

# 18. Fase 14 — Edição em massa

Possibilidade futura/recomendada:

```text
15 pontos selecionados

Campo:
Status

Novo valor:
[Ativo]

[Aplicar]
```

Backend:

```http
PATCH /points/bulk
```

Deve utilizar transação do Prisma.

---

# 19. Fase 15 — API REST

## Tables

```http
GET    /tables
GET    /tables/:id
GET    /tables/:id/schema
GET    /tables/:id/preview
```

## Points

```http
GET    /points
GET    /points/:id
POST   /points
PATCH  /points/:id
DELETE /points/:id
```

## Geospatial

```http
GET /points/bbox
POST /points/selection
```

## Bulk

```http
PATCH  /points/bulk
DELETE /points/bulk
```

## Export

```http
GET /export/csv
GET /export/xlsx
```

---

# 20. Fase 16 — Filtros

Filtros deverão poder ser aplicados antes e depois da seleção.

Exemplos:

```text
Nome contém: [________]

Status:
☑ Ativo
☐ Inativo

Tipo:
☑ Cliente
☑ Fornecedor

Data:
[01/01/2026] até [30/09/2026]
```

A API deverá permitir filtros dinâmicos sem permitir SQL Injection.

---

# 21. Fase 17 — Busca

Busca textual:

```text
Pesquisar:
[123456____________]
```

Possibilidades:

- ID
- Nome
- Código
- CPF/CNPJ
- Endereço
- Campos configuráveis

Ao encontrar:

```text
Resultado
     ↓
Centralizar mapa
     ↓
Highlight marker
     ↓
Abrir painel
```

---

# 22. Fase 18 — Exportação CSV

Exportação:

```text
Exportar

○ Todos os registros
○ Registros filtrados
○ Registros selecionados

Formato:
● CSV
○ XLSX

[Exportar]
```

CSV deverá considerar:

- UTF-8
- Cabeçalho
- Delimitador configurável
- Escape de campos
- Datas
- Coordenadas

---

# 23. Fase 19 — Exportação XLSX

Gerar:

```text
pontos.xlsx

├── Pontos
├── Informações
└── Metadados
```

Colunas:

```text
ID
UTMX
UTMY
Latitude
Longitude
Nome
Tipo
Status
...
```

Para grandes volumes, gerar o arquivo no backend e utilizar streaming/download.

---

# 24. Fase 20 — Performance

## Frontend

- [ ] React.lazy
- [ ] Suspense
- [ ] Lazy loading de painéis
- [ ] Virtualização de listas
- [ ] Memoização
- [ ] Debounce
- [ ] Cache com TanStack Query
- [ ] Evitar renderização de markers desnecessários

## Backend

- [ ] Paginação
- [ ] Query otimizada
- [ ] Seleção apenas dos campos necessários
- [ ] Índices
- [ ] Cache quando necessário
- [ ] Streaming para exportação

## Banco

Criar índices para:

```text
UTMX
UTMY
ID
campos utilizados nos filtros
```

Se PostgreSQL + PostGIS for utilizado:

```text
GIST / SP-GiST
```

para dados geoespaciais.

---

# 25. Fase 21 — Segurança

- [ ] Sanitização de filtros
- [ ] Validação DTO
- [ ] Controle de acesso
- [ ] Rate limiting
- [ ] Proteção das credenciais do banco
- [ ] API Key do Google restrita
- [ ] Logs de alterações
- [ ] Auditoria
- [ ] Confirmação para exclusões

Nunca expor:

```text
DATABASE_URL
Google API Key privada
credenciais do banco
```

no frontend.

---

# 26. Fase 22 — Auditoria

Registrar alterações:

```text
AuditLog

id
userId
action
entity
entityId
oldValue
newValue
createdAt
```

Exemplo:

```text
Usuário alterou:

Status:
"Inativo" → "Ativo"

Coordenada:
543210.32 → 543211.91
```

---

# 27. Fase 23 — Interface

## Design

Estilo profissional de software GIS.

### Desktop

```text
┌────────────────────────────────────────────────────────────┐
│ Toolbar                                                    │
├─────────────┬────────────────────────────────┬─────────────┤
│ Ferramentas │                                │ Informações │
│             │                                │             │
│ Selecionar  │            MAPA                │ Registro    │
│ Região      │                                │             │
│ Adicionar   │        ●     ●                 │ Campos      │
│ Editar      │    ●       ●                   │             │
│ Excluir     │                                │             │
│ Exportar    │             ●                  │             │
│             │                                │             │
└─────────────┴────────────────────────────────┴─────────────┘
```

## Tailwind

Utilizar:

- cards
- borders
- shadows discretas
- estados hover
- estados selected
- tooltips
- drawers
- dialogs
- skeleton loading

---

# 28. Fase 24 — Responsividade

Desktop será a prioridade.

Em telas menores:

```text
Mapa
  ↓
Painel lateral vira drawer
```

Ferramentas:

```text
Toolbar desktop
        ↓
Bottom toolbar mobile
```

---

# 29. Fase 25 — Tratamento de erros

Implementar estados:

- Loading
- Empty
- Error
- Offline
- Timeout
- Invalid coordinates
- Invalid CRS
- Database unavailable
- Google Maps unavailable

Exemplo:

```text
Não foi possível carregar os pontos.

[ Tentar novamente ]
```

---

# 30. Fase 26 — Testes

## Frontend

- [ ] Vitest
- [ ] React Testing Library
- [ ] Testes de componentes
- [ ] Testes de seleção
- [ ] Testes de filtros

## Backend

- [ ] Jest
- [ ] Testes unitários
- [ ] Testes de integração
- [ ] Testes dos endpoints
- [ ] Testes de validação

## E2E

- [ ] Playwright

Cenário principal:

```text
Abrir sistema
   ↓
Selecionar tabela
   ↓
Configurar UTM
   ↓
Carregar mapa
   ↓
Selecionar ponto
   ↓
Abrir informações
   ↓
Editar
   ↓
Salvar
   ↓
Selecionar região
   ↓
Exportar XLSX
```

---

# 31. Fase 27 — Docker

Estrutura:

```text
docker-compose.yml

services:

  frontend
  backend
  database
```

Exemplo:

```text
┌───────────────┐
│    Nginx      │
└───────┬───────┘
        │
 ┌──────┴───────┐
 │              │
 ▼              ▼
Frontend      Backend
                │
                ▼
             Database
```

---

# 32. Fase 28 — Observabilidade

- [ ] Logs
- [ ] Health check
- [ ] Métricas
- [ ] Monitoramento de API
- [ ] Monitoramento do banco
- [ ] Monitoramento de exportações
- [ ] Registro de erros

Endpoints:

```http
GET /health
GET /health/database
```

---

# 33. Fase 29 — MVP

A primeira versão deve conter somente o necessário para validar o produto.

## MVP obrigatório

- [ ] Conectar ao banco
- [ ] Listar tabelas
- [ ] Configurar UTMX
- [ ] Configurar UTMY
- [ ] Configurar EPSG
- [ ] Converter coordenadas
- [ ] Mostrar pontos no Google Maps
- [ ] Clicar em ponto
- [ ] Mostrar dados
- [ ] Suportar múltiplos registros na mesma coordenada
- [ ] Selecionar múltiplos pontos
- [ ] Selecionar região
- [ ] Adicionar ponto
- [ ] Editar ponto
- [ ] Excluir ponto
- [ ] Exportar CSV
- [ ] Exportar XLSX

---

# 34. Fase 30 — Pós-MVP

Funcionalidades futuras:

- [ ] PostGIS
- [ ] Importação de Shapefile
- [ ] GeoJSON
- [ ] KML/KMZ
- [ ] Camadas
- [ ] Heatmap
- [ ] Clustering avançado
- [ ] Medição de distância
- [ ] Medição de área
- [ ] Desenho de polígonos
- [ ] Buffer geográfico
- [ ] Geocodificação
- [ ] Reverse geocoding
- [ ] Street View
- [ ] Histórico
- [ ] Undo/Redo
- [ ] Edição em massa avançada
- [ ] Usuários e permissões
- [ ] Multi-tenant
- [ ] Dashboards
- [ ] Relatórios
- [ ] Importação de Excel
- [ ] Sincronização com bancos externos

---

# 35. Ordem recomendada de desenvolvimento

```text
1. Setup
   ↓
2. Banco + Prisma
   ↓
3. API NestJS
   ↓
4. Leitura de tabelas
   ↓
5. Conversão UTM
   ↓
6. Google Maps
   ↓
7. Renderização dos pontos
   ↓
8. Seleção individual
   ↓
9. Painel lateral
   ↓
10. Pontos sobrepostos
   ↓
11. Seleção múltipla
   ↓
12. Seleção por região
   ↓
13. CRUD
   ↓
14. Filtros
   ↓
15. Exportação CSV
   ↓
16. Exportação XLSX
   ↓
17. Performance
   ↓
18. Testes
   ↓
19. Docker
   ↓
20. Deploy
```

---

# 36. Arquitetura final sugerida

```text
                    GOOGLE MAPS
                         ▲
                         │
                         │
┌────────────────────────┴────────────────────────┐
│                 React + TypeScript              │
│                                                 │
│ MapView │ Toolbar │ Selection │ DataPanel      │
│                                                 │
│ TanStack Query + Zustand + Tailwind             │
└────────────────────────┬────────────────────────┘
                         │
                       REST
                         │
┌────────────────────────▼────────────────────────┐
│                    NestJS                       │
│                                                 │
│ Tables │ Points │ Selection │ Export │ Maps     │
│                                                 │
│ Validation │ Auth │ Audit │ Logging             │
└────────────────────────┬────────────────────────┘
                         │
                      Prisma
                         │
┌────────────────────────▼────────────────────────┐
│                  PostgreSQL                     │
│                                                 │
│ UTM X │ UTM Y │ Dados │ Índices │ PostGIS*     │
└─────────────────────────────────────────────────┘

* PostGIS recomendado para evolução geoespacial.
```

---

# 37. Critérios de conclusão

O MVP será considerado concluído quando for possível:

1. Abrir o sistema.
2. Selecionar uma tabela do banco local.
3. Informar quais colunas representam UTMX e UTMY.
4. Informar o sistema de referência espacial.
5. Carregar os pontos no Google Maps.
6. Clicar em qualquer ponto.
7. Visualizar os dados correspondentes no painel direito.
8. Identificar quando existem vários registros na mesma coordenada.
9. Navegar entre os registros sobrepostos.
10. Selecionar vários pontos.
11. Selecionar pontos através de uma região.
12. Adicionar novos pontos.
13. Editar pontos existentes.
14. Excluir pontos.
15. Filtrar dados.
16. Exportar os dados para CSV.
17. Exportar os dados para XLSX.
18. Trabalhar com carregamento sob demanda para evitar carregar grandes tabelas inteiras no frontend.
19. Manter as coordenadas UTM originais.
20. Manter o sistema preparado para evolução para PostGIS e funcionalidades GIS mais avançadas.

---

# 38. Observação técnica importante

O sistema não deve tratar simplesmente `UTMX` e `UTMY` como latitude e longitude.

A interpretação correta depende do sistema de referência espacial, incluindo:

- Datum
- Zona UTM
- Hemisfério
- EPSG

Por isso, a configuração do CRS deve fazer parte da definição da fonte de dados.

Para uma arquitetura GIS mais robusta e escalável, a evolução natural é utilizar **PostgreSQL + PostGIS**, mantendo `UTMX`/`UTMY` como dados originais e uma coluna espacial para consultas geográficas e índices espaciais.

O Google Maps deverá ser utilizado principalmente como camada de visualização, enquanto a lógica de dados, seleção, edição, filtros e consultas espaciais permanecerá sob controle da aplicação.
