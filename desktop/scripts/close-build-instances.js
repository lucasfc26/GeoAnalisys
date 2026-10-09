// Antes de gerar o instalador: fecha o GeoAnalisys aberto a partir da pasta de build (desktop/dist),
// que trava a pasta e faz o electron-builder falhar com EBUSY. O programa instalado (fora de dist)
// não é tocado.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

if (process.platform !== 'win32') process.exit(0);

const dist = path.resolve(__dirname, '..', 'dist');
const script = `
$dist = $env:GEO_DIST.TrimEnd('\\') + '\\'
$procs = Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($dist, [StringComparison]::OrdinalIgnoreCase) }
foreach ($p in $procs) { Write-Output ("{0} (PID {1})" -f $p.Name, $p.Id); Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
`;

try {
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, GEO_DIST: dist },
    encoding: 'utf8',
  }).trim();
  if (out) {
    console.log(`Fechando o GeoAnalisys aberto a partir de desktop/dist:\n${out}`);
    // Dá tempo ao Windows de liberar os arquivos antes de o build apagar a pasta.
    execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep -Seconds 2']);
  }
} catch (err) {
  console.warn('Aviso: não foi possível verificar instâncias abertas:', err.message);
}

// Restos de uma build interrompida (ex.: o computador reiniciou) ou arquivos presos pelo OneDrive/
// antivírus: apaga com novas tentativas, para o electron-builder não falhar com EBUSY.
for (const dir of ['win-unpacked', 'win-unpacked.tmp']) {
  try {
    fs.rmSync(path.join(dist, dir), { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  } catch (err) {
    console.error(
      `Não foi possível apagar desktop/dist/${dir} (${err.code}). Feche o Explorer/programas que ` +
        'estejam usando essa pasta (ou pause o OneDrive) e rode o build de novo.',
    );
    process.exit(1);
  }
}
