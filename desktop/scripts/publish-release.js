/**
 * Publica a versão para a atualização automática: cria o Release v<versão> no GitHub e envia
 * dist/GeoAnalisys-<versão>-win.zip (gerado pelo `npm run desktop:dist`).
 *
 * Precisa de um token do GitHub com permissão de escrita em Contents no repositório:
 *   set GH_TOKEN=github_pat_...   (cmd)   |   $env:GH_TOKEN="github_pat_..."   (PowerShell)
 *
 * Depois de publicar, faça commit/push do latest.json com a mesma versão: é ele que avisa os
 * programas abertos que há atualização (por isso o release precisa existir antes).
 */
const fs = require('fs');
const https = require('https');
const path = require('path');

const REPO = 'lucasfc26/GeoAnalisys';
const desktop = path.resolve(__dirname, '..');
const { version } = require(path.join(desktop, 'package.json'));
const tag = `v${version}`;
const zipName = `GeoAnalisys-${version}-win.zip`;
const zipPath = path.join(desktop, 'dist', zipName);
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const ATTEMPTS = 3;

function fail(msg) {
  console.error(`\n${msg}`);
  process.exit(1);
}

/** Mensagem do erro com a causa de rede (o "fetch failed" sozinho não diz nada). */
const describe = (err) => [err?.message, err?.cause?.code, err?.cause?.message].filter(Boolean).join(' — ');

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'geoanalisys-release',
};

async function gh(url, opts = {}) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${url}`, { ...opts, headers: { ...headers, ...opts.headers } });
  if (!res.ok && res.status !== 404) fail(`GitHub respondeu ${res.status}: ${await res.text()}`);
  return res.status === 404 || res.status === 204 ? null : res.json();
}

/** Envia o zip em streaming (sem o limite de tempo do fetch), mostrando o progresso. */
function upload(uploadUrl) {
  const size = fs.statSync(zipPath).size;
  return new Promise((resolve, reject) => {
    const req = https.request(
      uploadUrl,
      { method: 'POST', headers: { ...headers, 'Content-Type': 'application/zip', 'Content-Length': size } },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () =>
          res.statusCode < 300 ? resolve() : reject(new Error(`GitHub respondeu ${res.statusCode}: ${body}`)),
        );
      },
    );
    req.on('error', reject);
    let sent = 0;
    let last = 0;
    const file = fs.createReadStream(zipPath);
    file.on('data', (chunk) => {
      sent += chunk.length;
      if (Date.now() - last > 1000 || sent === size) {
        last = Date.now();
        process.stdout.write(`\r  ${((100 * sent) / size).toFixed(0).padStart(3)}%  ${(sent / 1048576).toFixed(0)} de ${(size / 1048576).toFixed(0)} MB`);
      }
    });
    file.on('error', reject);
    file.pipe(req);
  });
}

(async () => {
  if (!token) fail('Defina a variável GH_TOKEN com um token do GitHub (permissão Contents: Read and write).');
  if (!fs.existsSync(zipPath)) fail(`Não encontrei ${path.relative(desktop, zipPath)}. Rode antes: npm run desktop:dist`);

  const latest = JSON.parse(fs.readFileSync(path.join(desktop, '..', 'latest.json'), 'utf8'));
  if (latest.version !== version) {
    console.warn(`Aviso: latest.json está em ${latest.version}, o programa em ${version}. Atualize o latest.json.`);
  }

  for (let attempt = 1; ; attempt++) {
    try {
      let release = await gh(`/releases/tags/${tag}`);
      if (!release) {
        console.log(`Criando o release ${tag}…`);
        release = await gh('/releases', {
          method: 'POST',
          body: JSON.stringify({ tag_name: tag, name: `GeoAnalisys ${version}`, target_commitish: 'main' }),
        });
      }
      // Zip de uma tentativa anterior (completo ou interrompido): substitui.
      const old = release.assets.find((a) => a.name === zipName);
      if (old) await gh(`/releases/assets/${old.id}`, { method: 'DELETE' });

      console.log(`Enviando ${zipName}${attempt > 1 ? ` (tentativa ${attempt} de ${ATTEMPTS})` : ''}…`);
      await upload(release.upload_url.replace(/\{.*\}$/, `?name=${encodeURIComponent(zipName)}`));
      break;
    } catch (err) {
      console.error(`\nFalha no envio: ${describe(err)}`);
      if (attempt >= ATTEMPTS) fail('Não foi possível enviar o zip. Verifique a conexão (proxy/VPN) e rode de novo.');
      if (/certificate/i.test(describe(err))) fail('Certificado da rede não reconhecido: rode com node --use-system-ca (Node 22.15+).');
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  console.log(`\n\nPublicado: https://github.com/${REPO}/releases/tag/${tag}`);
})().catch((err) => fail(describe(err) || String(err)));
