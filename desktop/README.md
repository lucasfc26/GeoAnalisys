# GeoAnalisys — programa desktop (Windows)

Empacota o sistema (frontend + backend) num programa instalável. Cada pessoa usa o **próprio
PostgreSQL**: ao abrir, informa servidor, porta, usuário e senha, escolhe o banco e o programa:

1. cria/atualiza as tabelas internas do sistema (schema `gis_app`) nesse banco — nunca apaga dados;
2. sobe o servidor do sistema só para a própria máquina (`http://127.0.0.1:47800`);
3. abre o sistema numa janela. Menu **Arquivo › Trocar banco de dados** volta à tela de conexão.

As conexões ficam salvas por usuário do Windows; a senha só é guardada se marcado "Lembrar a senha"
(criptografada pelo Windows).

## Projetos

Menu **Arquivo › Novo Projeto / Abrir Projeto / Projetos Recentes / Salvar Projeto** (Ctrl+N, Ctrl+O,
Ctrl+S). Cada projeto é um arquivo `<nome>.proj` (JSON) com camadas, filtros, simbologia e rótulos,
limites (com as geometrias), mapas de fundo, configurações das janelas e a posição do mapa. O projeto
aberto é salvo automaticamente a cada alteração e reaberto ao iniciar o programa.

No banco, cada projeto fica em `gis_app.projetos` (id, nome, criação e atualização) e a Tabela de
Alterações (`gis_app.alteracoes.project_id`) é separada por projeto: a janela mostra e limpa só as
alterações do projeto aberto. Alterações feitas sem projeto aberto ficam com `project_id` nulo.

## Requisitos em cada computador

- PostgreSQL instalado (PostGIS opcional), com as tabelas de dados no banco escolhido.
- Internet para os mapas de fundo (OpenStreetMap, satélite Esri ou um mapa XYZ adicionado por URL) —
  nenhum precisa de chave. Sem internet, use o fundo "Sem fundo".

## Gerar o instalador

Na raiz do projeto (a primeira vez, `npm install` dentro de `desktop/`):

```
npm run desktop:dist
```

Gera `desktop/dist/GeoAnalisys Setup <versão>.exe` (instalação por usuário, sem precisar de admin).
Para testar sem instalar: `npm run desktop`.

Antes de gerar, o build fecha automaticamente o GeoAnalisys que estiver aberto a partir de
`desktop/dist` (`scripts/close-build-instances.js`); a pasta é apagada e recriada a cada build. O
programa instalado no computador não é fechado.

O instalador não é assinado digitalmente: o Windows (SmartScreen) mostra um aviso na primeira
execução ("Mais informações › Executar assim mesmo"). Para distribuir sem o aviso é preciso um
certificado de assinatura de código.

## Atualização automática

Ao abrir, o programa (instalado ou a pasta `win-unpacked`) lê o
[`latest.json`](../latest.json) do repositório público. Se a versão for maior que a dele:

1. baixa `GeoAnalisys-<versão>-win.zip` do Release `v<versão>` no GitHub e extrai ao lado da pasta
   do programa (`<pasta>.update`), mostrando o progresso numa janela;
2. abre o exe novo dessa pasta, que espera o antigo fechar, copia os arquivos por cima da pasta
   antiga e reabre o programa já atualizado (a pasta `.update` é apagada em seguida).

Não precisa de admin: só de permissão de escrita na pasta do programa. Sem internet, com o GitHub
bloqueado ou sem o release publicado, o programa abre normalmente na versão atual. Falhas ficam em
`%APPDATA%\GeoAnalisys\atualizacao.log`. Para desativar: variável `GEOANALISYS_NO_UPDATE=1`.

### Publicar uma versão

1. Suba a versão em `package.json`, `desktop/package.json` e `latest.json`.
2. `npm run desktop:dist` — gera também `desktop/dist/GeoAnalisys-<versão>-win.zip`.
3. `npm run desktop:release` com `GH_TOKEN` definido (token do GitHub com *Contents: Read and write*
   no repositório) — cria o Release `v<versão>` e envia o zip. Também dá para criar o release pelo
   site do GitHub e anexar o zip com esse nome.
4. Só então faça commit/push do `latest.json`: é ele que dispara a atualização nos computadores.
