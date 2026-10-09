// Tela de conexão: conexões salvas, listagem dos bancos e abertura do sistema.
const $ = (id) => document.getElementById(id);
const fields = ['host', 'port', 'user', 'password', 'database'];
let busy = false;

function status(msg, error = false) {
  $('status').textContent = msg || '';
  $('status').className = error ? 'error' : '';
}

function setBusy(on) {
  busy = on;
  $('list').disabled = on;
  $('open').disabled = on;
}

function current() {
  const c = Object.fromEntries(fields.map((f) => [f, $(f).value.trim()]));
  c.password = $('password').value; // a senha não é aparada
  c.port = Number(c.port) || 5432;
  c.savePassword = $('savePassword').checked;
  return c;
}

function fill(c) {
  $('host').value = c.host || 'localhost';
  $('port').value = c.port || 5432;
  $('user').value = c.user || '';
  $('password').value = c.password || '';
  $('database').value = c.database || '';
  $('savePassword').checked = !!c.hasPassword;
  status(c.hasPassword ? '' : 'Informe a senha.');
  (c.hasPassword ? $('open') : $('password')).focus();
}

async function loadSaved() {
  const { connections, last } = await window.geoanalisys.saved();
  const ul = $('saved');
  ul.innerHTML = '';
  $('saved-empty').style.display = connections.length ? 'none' : 'block';
  for (const c of connections) {
    const key = `${c.user}@${c.host}:${c.port}/${c.database}`;
    const li = document.createElement('li');
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'pick';
    pick.innerHTML = `<b></b> <small></small>`;
    pick.querySelector('b').textContent = c.database;
    pick.querySelector('small').textContent = `${c.user}@${c.host}:${c.port}`;
    pick.onclick = () => fill(c);
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'del';
    del.title = 'Remover conexão salva';
    del.textContent = '×';
    del.onclick = async () => {
      await window.geoanalisys.removeSaved(key);
      loadSaved();
    };
    li.append(pick, del);
    ul.append(li);
    if (key === last) fill(c);
  }
}

$('list').onclick = async () => {
  if (busy) return;
  setBusy(true);
  status('Conectando…');
  const r = await window.geoanalisys.databases(current());
  setBusy(false);
  if (!r.ok) return status(r.error, true);
  $('databases').innerHTML = r.databases.map((d) => `<option value="${d.replace(/"/g, '&quot;')}"></option>`).join('');
  status(`${r.databases.length} banco(s) encontrado(s). Escolha um em "Banco de dados".`);
  if (!$('database').value && r.databases.length) $('database').value = r.databases[0];
  $('database').focus();
};

$('form').onsubmit = async (e) => {
  e.preventDefault();
  if (busy) return;
  const c = current();
  if (!c.database) return status('Escolha o banco de dados.', true);
  setBusy(true);
  status('Conectando…');
  const r = await window.geoanalisys.open(c);
  if (!r.ok) {
    setBusy(false);
    status(r.error, true);
  }
};

window.geoanalisys.onStatus((msg) => status(msg));
loadSaved();
