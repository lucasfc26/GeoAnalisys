# GeoAnalisys — programa desktop (Windows)

Empacota o sistema (frontend + backend) num programa instalável. Cada pessoa usa o **próprio
PostgreSQL**: ao abrir, informa servidor, porta, usuário e senha, escolhe o banco e o programa:

1. cria/atualiza as tabelas internas do sistema (schema `gis_app`) nesse banco — nunca apaga dados;
2. sobe o servidor do sistema só para a própria máquina (`http://127.0.0.1:47800`);
3. abre o sistema numa janela. Menu **Arquivo › Trocar banco de dados** volta à tela de conexão.

As conexões ficam salvas por usuário do Windows; a senha só é guardada se marcado "Lembrar a senha"
(criptografada pelo Windows).

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
