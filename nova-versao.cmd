@echo off
rem ============================================================================================
rem  Publica uma nova versao do GeoAnalisys. Edite SO a linha abaixo e de dois cliques no arquivo.
rem ============================================================================================
set VERSAO=1.0.16

rem Etapas:
rem   1. testes (frontend e backend)
rem   2. sobe a versao em package.json, desktop/package.json e latest.json
rem   3. gera desktop\dist (win-unpacked, zip e instalador)
rem   4. cria o Release v%VERSAO% no GitHub e envia o zip (precisa do GH_TOKEN, ver abaixo)
rem   5. commit "Version %VERSAO%" e push -- e o latest.json no GitHub que dispara a atualizacao
rem
rem GH_TOKEN: token do GitHub (Settings > Developer settings > Fine-grained tokens, repositorio
rem GeoAnalisys, permissao "Contents: Read and write"). Configure uma vez so, num cmd:
rem   setx GH_TOKEN github_pat_xxxxxxxx
rem e abra um novo terminal/Explorer para valer.

setlocal
cd /d "%~dp0"
chcp 65001 >nul

if "%GH_TOKEN%"=="" (
  echo [ERRO] Variavel GH_TOKEN nao definida. Rode uma vez:  setx GH_TOKEN seu_token
  echo        e abra este arquivo de novo.
  goto :falha
)

echo.
echo  Vai publicar o GeoAnalisys %VERSAO%: testes, build, release no GitHub e push.
echo  Alteracoes pendentes que entrarao no commit:
git status --short
echo.
choice /c SN /m " Continuar"
if errorlevel 2 goto :cancelado

echo.
echo ==== 1/5 Testes ==========================================================================
call npm.cmd run test -w frontend -- --run || goto :falha
call npm.cmd run test -w backend || goto :falha

echo.
echo ==== 2/5 Versao %VERSAO% ===================================================================
call npm.cmd version %VERSAO% --no-git-tag-version --allow-same-version --workspaces=false || goto :falha
call npm.cmd --prefix desktop version %VERSAO% --no-git-tag-version --allow-same-version || goto :falha
node -e "require('fs').writeFileSync('latest.json', JSON.stringify({ version: process.argv[1], date: new Date().toLocaleDateString('sv-SE') }, null, 2) + '\n')" %VERSAO% || goto :falha
type latest.json

echo.
echo ==== 3/5 Build (desktop\dist) =============================================================
call npm.cmd run desktop:dist || goto :falha
if not exist "desktop\dist\GeoAnalisys-%VERSAO%-win.zip" (
  echo [ERRO] O build nao gerou desktop\dist\GeoAnalisys-%VERSAO%-win.zip
  goto :falha
)

echo.
echo ==== 4/5 Release v%VERSAO% no GitHub =========================================================
call npm.cmd run desktop:release || goto :falha

echo.
echo ==== 5/5 Commit e push ======================================================================
git add -A || goto :falha
git commit -m "Version %VERSAO%" || goto :falha
git push || goto :falha

echo.
echo  Pronto! GeoAnalisys %VERSAO% publicado.
echo  Quem abrir o programa vai receber a atualizacao (o GitHub pode levar ate 5 min para atualizar).
echo  Pasta para enviar manualmente: desktop\dist\win-unpacked
goto :fim

:cancelado
echo Cancelado.
goto :fim

:falha
echo.
echo  [FALHOU] Corrija o erro acima e rode de novo. Nada foi enviado para o GitHub depois da etapa
echo  que falhou (o latest.json so e enviado no push final).

:fim
echo.
pause
