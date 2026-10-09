/**
 * Monta o conteúdo do programa desktop em desktop/app:
 *   app/backend/dist          ← build do backend (NestJS)
 *   app/backend/prisma        ← schema (o programa cria/atualiza as tabelas internas no banco escolhido)
 *   app/frontend/dist         ← build do frontend (servido pelo próprio backend)
 * e gera o cliente Prisma em desktop/node_modules.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const desktop = path.resolve(__dirname, '..');
const root = path.resolve(desktop, '..');
const app = path.join(desktop, 'app');

const run = (cmd, cwd) => {
  console.log(`\n> ${cmd}   (${path.relative(root, cwd) || '.'})`);
  execSync(cmd, { cwd, stdio: 'inherit', env: process.env });
};

run('npm run build -w backend', root);
run('npm run build -w frontend', root);

fs.rmSync(app, { recursive: true, force: true });
fs.cpSync(path.join(root, 'backend', 'dist'), path.join(app, 'backend', 'dist'), { recursive: true });
fs.mkdirSync(path.join(app, 'backend', 'prisma'), { recursive: true });
for (const f of ['schema.prisma', 'pre-push.sql']) {
  fs.copyFileSync(path.join(root, 'backend', 'prisma', f), path.join(app, 'backend', 'prisma', f));
}
fs.cpSync(path.join(root, 'frontend', 'dist'), path.join(app, 'frontend', 'dist'), { recursive: true });

// Cliente Prisma gerado a partir do schema copiado (fica em desktop/node_modules/.prisma).
run('npx prisma generate --schema app/backend/prisma/schema.prisma', desktop);
console.log('\nPrograma montado em desktop/app.');
