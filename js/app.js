const DISTANCE_LABEL = { 60: '60m', 80: '80m', 100: '100m' };

let supabase;
let categories = [];
let participants = [];
let heatsCache = [];

const $ = (id) => document.getElementById(id);

init().catch((err) => {
  console.error(err);
  setAdminMessage(`Initialisierung fehlgeschlagen: ${err.message}`, true);
});

async function init() {
  const cfgResponse = await fetch('config/public.supabase.json');
  if (!cfgResponse.ok) {
    throw new Error('Konfiguration config/public.supabase.json nicht gefunden.');
  }

  const config = await cfgResponse.json();
  if (!config?.supabaseUrl || !config?.supabaseAnonKey) {
    throw new Error('Supabase URL oder Anon Key fehlt in public.supabase.json.');
  }

  supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
  wireCommonEvents();
  await restoreSession();
}

function wireCommonEvents() {
  $('show-admin-login').addEventListener('click', () => showSection('admin-login'));
  $('back-to-public').addEventListener('click', () => showSection('public'));
  $('public-registration-form').addEventListener('submit', onPublicRegistration);

  $('admin-login-form').addEventListener('submit', onAdminLogin);
  $('admin-logout').addEventListener('click', onLogout);

  for (const btn of document.querySelectorAll('.tab-btn')) {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  }

  $('participant-search').addEventListener('input', renderParticipantsTable);
  $('participant-gender-filter').addEventListener('change', renderParticipantsTable);
  $('reload-participants').addEventListener('click', loadParticipants);

  $('category-form').addEventListener('submit', saveCategory);
  $('category-reset').addEventListener('click', resetCategoryForm);

  $('blocked-number-form').addEventListener('submit', saveBlockedNumber);

  $('generate-heats').addEventListener('click', generateHeats);
  $('load-heats').addEventListener('click', loadAndRenderHeats);

  $('export-pdf').addEventListener('click', exportHeatsAsPdf);

  $('load-results').addEventListener('click', loadResultsEditor);
  $('save-results').addEventListener('click', saveResults);
}

async function restoreSession() {
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    await enterAdminMode(data.session.user);
  } else {
    showSection('public');
  }
}

function showSection(target) {
  $('public-section').classList.toggle('hidden', target !== 'public');
  $('admin-login-section').classList.toggle('hidden', target !== 'admin-login');
  $('admin-section').classList.toggle('hidden', target !== 'admin');
}

async function onPublicRegistration(event) {
  event.preventDefault();
  const name = $('reg-name').value.trim();
  const gender = $('reg-gender').value;
  const birthYearRaw = $('reg-birth-year').value;
  const birthYear = birthYearRaw ? Number(birthYearRaw) : null;

  if (!name || !gender) {
    $('public-message').textContent = 'Bitte Name und Geschlecht ausfüllen.';
    return;
  }

  const { error } = await supabase.from('participants').insert({
    name,
    gender,
    birth_year: birthYear
  });

  if (error) {
    $('public-message').textContent = `Anmeldung fehlgeschlagen: ${error.message}`;
    return;
  }

  $('public-registration-form').reset();
  $('public-message').textContent = 'Erfolgreich angemeldet. Danke!';
}

async function onAdminLogin(event) {
  event.preventDefault();
  const email = $('admin-email').value.trim();
  const password = $('admin-password').value;

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    $('admin-login-message').textContent = `Login fehlgeschlagen: ${error.message}`;
    return;
  }

  $('admin-login-message').textContent = '';
  await enterAdminMode(data.user);
}

async function onLogout() {
  await supabase.auth.signOut();
  showSection('public');
  setAdminMessage('');
}

async function enterAdminMode(user) {
  $('admin-email-display').textContent = user.email || '';
  showSection('admin');
  activateTab('participants');
  await loadAllAdminData();
}

function activateTab(name) {
  for (const btn of document.querySelectorAll('.tab-btn')) {
    btn.classList.toggle('active', btn.dataset.tab === name);
  }
  for (const panel of document.querySelectorAll('.tab-panel')) {
    panel.classList.toggle('active', panel.id === `tab-${name}`);
  }
}

function setAdminMessage(message, isError = false) {
  const el = $('admin-message');
  el.style.color = isError ? '#c62828' : '#19593b';
  el.textContent = message;
}

async function loadAllAdminData() {
  await Promise.all([loadCategories(), loadParticipants(), loadBlockedNumbers(), loadHeatsForSelectors()]);
}

async function loadParticipants() {
  const { data, error } = await supabase
    .from('participants')
    .select('id,name,gender,start_number,birth_year,category_id,created_at,categories(name,distance)')
    .order('created_at', { ascending: false });

  if (error) return setAdminMessage(error.message, true);
  participants = data || [];
  renderParticipantsTable();
}

function renderParticipantsTable() {
  const search = $('participant-search').value.toLowerCase().trim();
  const genderFilter = $('participant-gender-filter').value;
  const body = $('participants-table-body');

  const filtered = participants.filter((p) => {
    const matchSearch = !search || p.name.toLowerCase().includes(search);
    const matchGender = !genderFilter || p.gender === genderFilter;
    return matchSearch && matchGender;
  });

  body.innerHTML = '';
  for (const p of filtered) {
    const tr = document.createElement('tr');
    const created = new Date(p.created_at).toLocaleString('de-CH');
    const categoryLabel = p.categories ? `${p.categories.name} (${DISTANCE_LABEL[p.categories.distance]})` : '-';

    tr.innerHTML = `
      <td>${escapeHtml(p.name)}</td>
      <td>${genderLabel(p.gender)}</td>
      <td>${p.start_number ?? '-'}</td>
      <td>${categoryLabel}</td>
      <td>${created}</td>
      <td>
        <button class="secondary" data-action="edit" data-id="${p.id}">Bearbeiten</button>
        <button class="danger" data-action="delete" data-id="${p.id}">Löschen</button>
      </td>
    `;

    tr.querySelector('[data-action="edit"]').addEventListener('click', () => openParticipantEdit(p));
    tr.querySelector('[data-action="delete"]').addEventListener('click', () => deleteParticipant(p.id));
    body.appendChild(tr);
  }
}

async function openParticipantEdit(participant) {
  const selected = prompt(
    `Teilnehmende bearbeiten für ${participant.name}.\n` +
      `Neuer Name (aktuell: ${participant.name}) oder leer lassen:`,
    participant.name
  );
  if (selected === null) return;

  const gender = prompt('Geschlecht (male/female):', participant.gender);
  if (!gender) return;

  const categoryInput = window.prompt(
    `Kategorie-ID setzen (aktuell: ${participant.category_id ?? 'keine'})\nVerfügbare Kategorien:\n${categories
      .map((c) => `${c.id}: ${c.name} (${genderLabel(c.gender)}, ${DISTANCE_LABEL[c.distance]})`)
      .join('\n')}`,
    participant.category_id ?? ''
  );

  const categoryId = categoryInput ? Number(categoryInput) : null;
  const { error } = await supabase
    .from('participants')
    .update({
      name: selected.trim() || participant.name,
      gender,
      category_id: Number.isNaN(categoryId) ? null : categoryId
    })
    .eq('id', participant.id);

  if (error) return setAdminMessage(`Teilnehmende konnten nicht aktualisiert werden: ${error.message}`, true);
  setAdminMessage('Teilnehmende aktualisiert.');
  await loadParticipants();
}

async function deleteParticipant(id) {
  if (!confirm('Teilnehmende wirklich löschen?')) return;
  const { error } = await supabase.from('participants').delete().eq('id', id);
  if (error) return setAdminMessage(`Löschen fehlgeschlagen: ${error.message}`, true);
  setAdminMessage('Teilnehmende gelöscht.');
  await loadParticipants();
}

async function loadCategories() {
  const { data, error } = await supabase.from('categories').select('*').order('name');
  if (error) return setAdminMessage(error.message, true);

  categories = data || [];
  const body = $('categories-table-body');
  body.innerHTML = '';

  for (const cat of categories) {
    const range = cat.min_birth_year || cat.max_birth_year ? `${cat.min_birth_year ?? '-'} - ${cat.max_birth_year ?? '-'}` : '-';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(cat.name)}</td>
      <td>${genderLabel(cat.gender)}</td>
      <td>${DISTANCE_LABEL[cat.distance]}</td>
      <td>${range}</td>
      <td>
        <button class="secondary" data-action="edit">Bearbeiten</button>
        <button class="danger" data-action="delete">Löschen</button>
      </td>
    `;

    tr.querySelector('[data-action="edit"]').addEventListener('click', () => fillCategoryForm(cat));
    tr.querySelector('[data-action="delete"]').addEventListener('click', () => deleteCategory(cat.id));
    body.appendChild(tr);
  }

  renderCategorySelectors();
}

function fillCategoryForm(cat) {
  $('category-id').value = cat.id;
  $('category-name').value = cat.name;
  $('category-gender').value = cat.gender;
  $('category-distance').value = String(cat.distance);
  $('category-min-birth-year').value = cat.min_birth_year ?? '';
  $('category-max-birth-year').value = cat.max_birth_year ?? '';
}

function resetCategoryForm() {
  $('category-form').reset();
  $('category-id').value = '';
}

async function saveCategory(event) {
  event.preventDefault();
  const id = $('category-id').value;
  const payload = {
    name: $('category-name').value.trim(),
    gender: $('category-gender').value,
    distance: Number($('category-distance').value),
    min_birth_year: $('category-min-birth-year').value ? Number($('category-min-birth-year').value) : null,
    max_birth_year: $('category-max-birth-year').value ? Number($('category-max-birth-year').value) : null
  };

  const query = id
    ? supabase.from('categories').update(payload).eq('id', Number(id))
    : supabase.from('categories').insert(payload);

  const { error } = await query;
  if (error) return setAdminMessage(`Kategorie konnte nicht gespeichert werden: ${error.message}`, true);

  resetCategoryForm();
  setAdminMessage('Kategorie gespeichert.');
  await loadCategories();
}

async function deleteCategory(id) {
  if (!confirm('Kategorie wirklich löschen?')) return;
  const { error } = await supabase.from('categories').delete().eq('id', id);
  if (error) return setAdminMessage(`Kategorie konnte nicht gelöscht werden: ${error.message}`, true);

  setAdminMessage('Kategorie gelöscht.');
  await loadCategories();
}

async function saveBlockedNumber(event) {
  event.preventDefault();
  const number = Number($('blocked-number').value);
  const reason = $('blocked-reason').value.trim() || null;
  if (!number || number < 1) return;

  const { error } = await supabase.from('blocked_start_numbers').insert({ number, reason });
  if (error) return setAdminMessage(`Startnummer konnte nicht gesperrt werden: ${error.message}`, true);

  $('blocked-number-form').reset();
  setAdminMessage('Startnummer gesperrt.');
  await loadBlockedNumbers();
}

async function loadBlockedNumbers() {
  const { data, error } = await supabase
    .from('blocked_start_numbers')
    .select('*')
    .order('number', { ascending: true });

  if (error) return setAdminMessage(error.message, true);

  const body = $('blocked-numbers-table-body');
  body.innerHTML = '';
  for (const item of data || []) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${item.number}</td>
      <td>${escapeHtml(item.reason ?? '-')}</td>
      <td>${new Date(item.created_at).toLocaleString('de-CH')}</td>
      <td><button class="danger">Entsperren</button></td>
    `;

    tr.querySelector('button').addEventListener('click', async () => {
      const { error: delError } = await supabase.from('blocked_start_numbers').delete().eq('id', item.id);
      if (delError) return setAdminMessage(`Entsperren fehlgeschlagen: ${delError.message}`, true);
      await loadBlockedNumbers();
    });

    body.appendChild(tr);
  }
}

function renderCategorySelectors() {
  const options = ['<option value="">Kategorie wählen</option>']
    .concat(categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)} (${DISTANCE_LABEL[c.distance]})</option>`))
    .join('');
  $('heats-category-select').innerHTML = options;
}

async function generateHeats() {
  const categoryId = Number($('heats-category-select').value);
  const roundNumber = Number($('heats-round-select').value);
  if (!categoryId) {
    return setAdminMessage('Bitte zuerst eine Kategorie auswählen.', true);
  }

  const { data: participantsData, error: pError } = await supabase
    .from('participants')
    .select('id,name,start_number,gender')
    .eq('category_id', categoryId)
    .order('start_number', { ascending: true });

  if (pError) return setAdminMessage(pError.message, true);
  if (!participantsData?.length) return setAdminMessage('Keine Teilnehmenden in dieser Kategorie.', true);

  const chunks = chunkForHeats(participantsData);

  const { error: deleteHeatErr } = await supabase
    .from('heats')
    .delete()
    .eq('category_id', categoryId)
    .eq('round_number', roundNumber);

  if (deleteHeatErr) return setAdminMessage(deleteHeatErr.message, true);

  for (let i = 0; i < chunks.length; i += 1) {
    const { data: heatInsert, error: heatErr } = await supabase
      .from('heats')
      .insert({
        category_id: categoryId,
        round_number: roundNumber,
        round_name: roundName(roundNumber),
        heat_number: i + 1
      })
      .select('id')
      .single();

    if (heatErr) return setAdminMessage(heatErr.message, true);

    const entries = chunks[i].map((participant, index) => ({
      heat_id: heatInsert.id,
      participant_id: participant.id,
      lane_or_position: index + 1
    }));

    const { error: entryErr } = await supabase.from('heat_entries').insert(entries);
    if (entryErr) return setAdminMessage(entryErr.message, true);
  }

  setAdminMessage('Startaufstellungen neu generiert.');
  await loadAndRenderHeats();
  await loadHeatsForSelectors();
}

function chunkForHeats(list) {
  const output = [];
  let idx = 0;
  while (idx < list.length) {
    const remaining = list.length - idx;
    let size;
    if (remaining === 5) size = 3;
    else if (remaining <= 4) size = remaining;
    else size = 4;

    output.push(list.slice(idx, idx + size));
    idx += size;
  }
  return output;
}

async function loadAndRenderHeats() {
  const categoryId = Number($('heats-category-select').value);
  if (!categoryId) return;

  const { data, error } = await supabase
    .from('heats')
    .select('id,heat_number,round_number,round_name,categories(name,distance),heat_entries(lane_or_position,participants(name,start_number,gender))')
    .eq('category_id', categoryId)
    .order('round_number')
    .order('heat_number');

  if (error) return setAdminMessage(error.message, true);

  heatsCache = data || [];
  const out = $('heats-output');
  out.innerHTML = '';

  for (const heat of heatsCache) {
    const card = document.createElement('article');
    card.className = 'heat-card';
    const items = (heat.heat_entries || [])
      .sort((a, b) => a.lane_or_position - b.lane_or_position)
      .map(
        (entry) =>
          `<li>Bahn ${entry.lane_or_position}: #${entry.participants.start_number} ${escapeHtml(entry.participants.name)} (${genderLabel(entry.participants.gender)})</li>`
      )
      .join('');

    card.innerHTML = `
      <h4>${escapeHtml(heat.categories.name)} - ${DISTANCE_LABEL[heat.categories.distance]} - ${roundName(heat.round_number)} - Lauf ${heat.heat_number}</h4>
      <ol>${items}</ol>
    `;
    out.appendChild(card);
  }
}

async function exportHeatsAsPdf() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  let y = 40;

  const { data, error } = await supabase
    .from('heats')
    .select('heat_number,round_number,categories(name,distance),heat_entries(lane_or_position,participants(name,start_number,gender))')
    .order('category_id')
    .order('round_number')
    .order('heat_number');

  if (error) {
    $('pdf-message').textContent = `PDF-Export fehlgeschlagen: ${error.message}`;
    return;
  }

  doc.setFontSize(16);
  doc.text('Startaufstellungen Sprinttag', 40, y);
  y += 30;
  doc.setFontSize(11);

  for (const heat of data || []) {
    const title = `${heat.categories.name} (${DISTANCE_LABEL[heat.categories.distance]}) - ${roundName(heat.round_number)} - Lauf ${heat.heat_number}`;
    if (y > 760) {
      doc.addPage();
      y = 40;
    }

    doc.setFont(undefined, 'bold');
    doc.text(title, 40, y);
    y += 16;
    doc.setFont(undefined, 'normal');

    for (const entry of (heat.heat_entries || []).sort((a, b) => a.lane_or_position - b.lane_or_position)) {
      const line = `Bahn ${entry.lane_or_position} | #${entry.participants.start_number} | ${entry.participants.name} | ${genderLabel(entry.participants.gender)}`;
      doc.text(line, 50, y);
      y += 14;
    }
    y += 12;
  }

  doc.save(`startaufstellungen-${new Date().toISOString().slice(0, 10)}.pdf`);
  $('pdf-message').textContent = 'PDF wurde erzeugt und heruntergeladen.';
}

async function loadHeatsForSelectors() {
  const { data, error } = await supabase
    .from('heats')
    .select('id,heat_number,round_number,categories(name,distance)')
    .order('round_number')
    .order('heat_number');

  if (error) return setAdminMessage(error.message, true);

  const select = $('results-heat-select');
  select.innerHTML = '<option value="">Lauf wählen</option>';
  for (const h of data || []) {
    const option = document.createElement('option');
    option.value = h.id;
    option.textContent = `${h.categories.name} ${DISTANCE_LABEL[h.categories.distance]} - ${roundName(h.round_number)} - Lauf ${h.heat_number}`;
    select.appendChild(option);
  }
}

async function loadResultsEditor() {
  const heatId = Number($('results-heat-select').value);
  if (!heatId) return;

  const [{ data: entries, error: entryErr }, { data: existingResults, error: resultsErr }] = await Promise.all([
    supabase
      .from('heat_entries')
      .select('participant_id,lane_or_position,participants(name,start_number)')
      .eq('heat_id', heatId)
      .order('lane_or_position'),
    supabase.from('results').select('participant_id,time_value').eq('heat_id', heatId)
  ]);

  if (entryErr || resultsErr) return setAdminMessage((entryErr || resultsErr).message, true);

  const resultMap = new Map((existingResults || []).map((r) => [r.participant_id, r.time_value]));
  const editor = $('results-editor');
  editor.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';

  const table = document.createElement('table');
  table.innerHTML = `
    <thead><tr><th>Bahn</th><th>Startnr.</th><th>Name</th><th>Zeit (s)</th></tr></thead>
    <tbody>
      ${(entries || [])
        .map(
          (entry) => `
        <tr>
          <td>${entry.lane_or_position}</td>
          <td>${entry.participants.start_number}</td>
          <td>${escapeHtml(entry.participants.name)}</td>
          <td><input class="small-input" type="number" min="0" step="0.01" data-participant-id="${entry.participant_id}" value="${resultMap.get(entry.participant_id) ?? ''}" /></td>
        </tr>`
        )
        .join('')}
    </tbody>
  `;

  wrap.appendChild(table);
  editor.appendChild(wrap);
}

async function saveResults() {
  const heatId = Number($('results-heat-select').value);
  if (!heatId) return setAdminMessage('Bitte zuerst einen Lauf auswählen.', true);

  const inputs = [...$('results-editor').querySelectorAll('input[data-participant-id]')];
  if (!inputs.length) return setAdminMessage('Bitte erst Lauf laden.', true);

  const payload = inputs
    .map((input) => ({
      heat_id: heatId,
      participant_id: Number(input.dataset.participantId),
      time_value: input.value ? Number(input.value) : null
    }))
    .filter((row) => row.time_value !== null);

  await supabase.from('results').delete().eq('heat_id', heatId);
  if (payload.length) {
    const { error } = await supabase.from('results').insert(payload);
    if (error) return setAdminMessage(`Resultate konnten nicht gespeichert werden: ${error.message}`, true);
  }

  setAdminMessage('Zeiten gespeichert.');
}

function roundName(roundNumber) {
  if (roundNumber === 1) return '1. Lauf';
  if (roundNumber === 2) return '2. Lauf';
  if (roundNumber === 99) return 'Königslauf';
  return `Runde ${roundNumber}`;
}

function genderLabel(gender) {
  return gender === 'male' ? 'Männlich' : gender === 'female' ? 'Weiblich' : '-';
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
