const DISTANCE_LABEL = { 60: '60m', 80: '80m', 100: '100m' };
const ROUND_TYPES = {
  first_run: '1. Lauf',
  second_run: '2. Lauf',
  kings_run: 'Königslauf'
};

let supabase;
let categories = [];
let participants = [];

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

  $('heats-round-select').addEventListener('change', handleRoundFilterChange);
  $('show-lineup').addEventListener('click', showStartLineup);
  $('save-lineup-times').addEventListener('click', saveLineupTimes);
  $('calculate-rankings').addEventListener('click', loadCategoryRanking);

  $('export-pdf').addEventListener('click', exportRankingsPdf);
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
  const lastName = $('reg-last-name').value.trim();
  const firstName = $('reg-first-name').value.trim();
  const gender = document.querySelector('input[name="gender"]:checked')?.value;
  const age = Number($('reg-age').value);

  if (!lastName || !firstName || !gender || !Number.isInteger(age)) {
    $('public-message').textContent = 'Bitte Nachname, Vorname, Geschlecht und Alter ausfüllen.';
    return;
  }

  if (age < 1 || age > 120) {
    $('public-message').textContent = 'Alter muss zwischen 1 und 120 liegen.';
    return;
  }

  const currentYear = new Date().getFullYear();
  const birthYear = currentYear - age;
  const autoCategoryId = await findCategoryIdByProfile(gender, age);

  const { error } = await supabase.from('participants').insert({
    last_name: lastName,
    first_name: firstName,
    gender,
    age,
    birth_year: birthYear,
    category_id: autoCategoryId
  });

  if (error) {
    $('public-message').textContent = `Anmeldung fehlgeschlagen: ${error.message}`;
    return;
  }

  $('public-registration-form').reset();
  $('public-message').textContent = 'Erfolgreich angemeldet. Die Anmeldung wurde gespeichert.';
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
  await Promise.all([loadCategories(), loadParticipants(), loadBlockedNumbers()]);
  handleRoundFilterChange();
}

async function loadParticipants() {
  const { data, error } = await supabase
    .from('participants')
    .select('id,last_name,first_name,gender,age,birth_year,start_number,category_id,created_at,categories(name,distance,min_age,max_age)')
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
    const fullName = `${p.last_name} ${p.first_name}`.toLowerCase();
    const matchSearch = !search || fullName.includes(search);
    const matchGender = !genderFilter || p.gender === genderFilter;
    return matchSearch && matchGender;
  });

  body.innerHTML = '';
  for (const p of filtered) {
    const tr = document.createElement('tr');
    const created = new Date(p.created_at).toLocaleString('de-CH');
    const age = resolveAge(p);
    const categoryLabel = p.categories
      ? `${p.categories.name} (${DISTANCE_LABEL[p.categories.distance]}, ${p.categories.min_age}-${p.categories.max_age}J)`
      : '-';

    tr.innerHTML = `
      <td>${p.start_number ?? '-'}</td>
      <td>${escapeHtml(p.last_name)}</td>
      <td>${escapeHtml(p.first_name)}</td>
      <td>${genderLabel(p.gender)}</td>
      <td>${age}J</td>
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
  const lastName = prompt('Nachname:', participant.last_name);
  if (lastName === null) return;

  const firstName = prompt('Vorname:', participant.first_name);
  if (firstName === null) return;

  const gender = prompt('Geschlecht (male/female):', participant.gender);
  if (!gender) return;

  const age = Number(prompt('Alter:', String(resolveAge(participant))));
  if (!Number.isInteger(age) || age < 1 || age > 120) return;

  const suggested = findCategoryForParticipant(gender, age)?.id ?? participant.category_id;
  const categoryInput = window.prompt(
    `Kategorie-ID setzen (aktuell: ${participant.category_id ?? 'keine'})\nVorschlag anhand Alter/Geschlecht: ${suggested ?? '-'}\nVerfügbare Kategorien:\n${categories
      .map((c) => `${c.id}: ${c.name} (${genderLabel(c.gender)}, ${DISTANCE_LABEL[c.distance]}, ${c.min_age}-${c.max_age}J)`)
      .join('\n')}`,
    suggested ?? ''
  );

  const categoryId = categoryInput ? Number(categoryInput) : null;
  const birthYear = new Date().getFullYear() - age;

  const { error } = await supabase
    .from('participants')
    .update({
      last_name: lastName.trim() || participant.last_name,
      first_name: firstName.trim() || participant.first_name,
      gender,
      age,
      birth_year: birthYear,
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
    const range = `${cat.min_age} - ${cat.max_age} Jahre`;
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
  $('category-min-age').value = cat.min_age;
  $('category-max-age').value = cat.max_age;
}

function resetCategoryForm() {
  $('category-form').reset();
  $('category-id').value = '';
}

async function saveCategory(event) {
  event.preventDefault();
  const id = $('category-id').value;
  const minAge = Number($('category-min-age').value);
  const maxAge = Number($('category-max-age').value);

  if (minAge > maxAge) {
    return setAdminMessage('Mindestalter darf nicht größer als Höchstalter sein.', true);
  }

  const payload = {
    name: $('category-name').value.trim(),
    gender: $('category-gender').value,
    distance: Number($('category-distance').value),
    min_age: minAge,
    max_age: maxAge
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
    .concat(
      categories.map(
        (c) => `<option value="${c.id}">${escapeHtml(c.name)} (${DISTANCE_LABEL[c.distance]}, ${c.min_age}-${c.max_age}J)</option>`
      )
    )
    .join('');
  $('heats-category-select').innerHTML = options;
}

function handleRoundFilterChange() {
  const isKings = $('heats-round-select').value === 'kings_run';
  $('heats-category-select').disabled = isKings;
  $('category-ranking-output').innerHTML = '';
}

async function showStartLineup() {
  const roundType = $('heats-round-select').value;
  const categoryId = Number($('heats-category-select').value);

  if (roundType !== 'kings_run' && !categoryId) {
    return setAdminMessage('Bitte zuerst eine Kategorie auswählen.', true);
  }

  const lineup = await getLineupParticipants(roundType, Number.isNaN(categoryId) ? null : categoryId);
  if (!lineup.length) {
    $('heats-output').innerHTML = '<p class="muted">Keine Teilnehmenden für diese Auswahl vorhanden.</p>';
    return setAdminMessage('Keine Teilnehmenden für diese Auswahl vorhanden.', true);
  }

  await ensureHeatAndEntries(roundType, roundType === 'kings_run' ? null : categoryId, lineup);
  await renderLineupTable(roundType, lineup);
  setAdminMessage('Startaufstellung geladen.');
}

async function getLineupParticipants(roundType, categoryId) {
  if (roundType === 'first_run') {
    const data = await getParticipantsForCategory(categoryId);
    if (!data.length) {
      setAdminMessage('Keine Teilnehmenden in dieser Kategorie gefunden. Prüfe Alter/Geschlecht und Kategorie-Bereich.', true);
      return [];
    }
    return data;
  }

  if (roundType === 'second_run') {
    const topFour = await getTopParticipantsFromFirstRun(categoryId, 4);
    return topFour;
  }

  return getKingsRunQualifiedParticipants();
}

async function getTopParticipantsFromFirstRun(categoryId, limitCount) {
  const { data: firstRunHeats, error: hError } = await supabase
    .from('heats')
    .select('id')
    .eq('round_type', 'first_run')
    .eq('category_id', categoryId);
  if (hError) {
    setAdminMessage(hError.message, true);
    return [];
  }

  const heatIds = (firstRunHeats || []).map((h) => h.id);
  if (!heatIds.length) {
    setAdminMessage('Für diese Kategorie gibt es noch keinen 1. Lauf.', true);
    return [];
  }

  const { data: results, error: rError } = await supabase
    .from('results')
    .select('participant_id,time_value,participants(id,last_name,first_name,start_number,gender,category_id)')
    .in('heat_id', heatIds)
    .order('time_value', { ascending: true });
  if (rError) {
    setAdminMessage(rError.message, true);
    return [];
  }

  const uniqueParticipants = [];
  const seen = new Set();
  for (const row of results || []) {
    if (seen.has(row.participant_id)) continue;
    seen.add(row.participant_id);
    uniqueParticipants.push(row.participants);
  }

  if (uniqueParticipants.length < limitCount) {
    setAdminMessage('Für den 2. Lauf werden genau 4 Zeiten aus dem 1. Lauf benötigt.', true);
    return [];
  }

  return uniqueParticipants.slice(0, limitCount);
}

async function getKingsRunQualifiedParticipants() {
  const { data: secondRunHeats, error: hError } = await supabase
    .from('heats')
    .select('id')
    .eq('round_type', 'second_run');

  if (hError) {
    setAdminMessage(hError.message, true);
    return [];
  }

  const heatIds = (secondRunHeats || []).map((h) => h.id);
  if (!heatIds.length) {
    setAdminMessage('Für den Königslauf braucht es Resultate aus dem 2. Lauf.', true);
    return [];
  }

  const { data: results, error: rError } = await supabase
    .from('results')
    .select('participant_id,time_value,participants(id,last_name,first_name,start_number,gender,category_id)')
    .in('heat_id', heatIds)
    .order('time_value', { ascending: true });

  if (rError) {
    setAdminMessage(rError.message, true);
    return [];
  }

  const topUnique = [];
  const seen = new Set();
  for (const row of results || []) {
    if (seen.has(row.participant_id)) continue;
    seen.add(row.participant_id);
    topUnique.push(row.participants);
    if (topUnique.length === 4) break;
  }

  if (topUnique.length < 4) {
    setAdminMessage('Für den Königslauf werden 4 verschiedene Teilnehmende mit Zeiten aus dem 2. Lauf benötigt.', true);
    return [];
  }

  return topUnique;
}

async function ensureHeatAndEntries(roundType, categoryId, lineup) {
  let query = supabase.from('heats').select('id').eq('round_type', roundType);
  query = categoryId === null ? query.is('category_id', null) : query.eq('category_id', categoryId);

  const { data: existingHeats, error: heatErr } = await query;

  if (heatErr) {
    setAdminMessage(heatErr.message, true);
    return null;
  }

  const lineupIds = lineup.map((p) => p.id);
  if (existingHeats?.length === 1) {
    const existingHeatId = existingHeats[0].id;
    const { data: currentEntries, error: entryErr } = await supabase
      .from('heat_entries')
      .select('participant_id,lane_or_position')
      .eq('heat_id', existingHeatId)
      .order('lane_or_position', { ascending: true });

    if (entryErr) {
      setAdminMessage(entryErr.message, true);
      return null;
    }

    const currentIds = (currentEntries || []).map((e) => e.participant_id);
    if (arraysEqual(currentIds, lineupIds)) {
      return existingHeatId;
    }
  }

  const heatId = await replaceWithSingleHeat(existingHeats || [], roundType, categoryId, lineup);
  return heatId;
}

async function replaceWithSingleHeat(existingHeats, roundType, categoryId, lineup) {
  const existingIds = existingHeats.map((h) => h.id);
  if (existingIds.length) {
    await supabase.from('heat_entries').delete().in('heat_id', existingIds);
    await supabase.from('results').delete().in('heat_id', existingIds);
    const { error: deleteErr } = await supabase.from('heats').delete().in('id', existingIds);
    if (deleteErr) {
      setAdminMessage(deleteErr.message, true);
      return null;
    }
  }

  const { data: insertedHeat, error: insertHeatErr } = await supabase
    .from('heats')
    .insert({ category_id: categoryId, round_type: roundType, heat_number: 1 })
    .select('id')
    .single();

  if (insertHeatErr) {
    setAdminMessage(insertHeatErr.message, true);
    return null;
  }

  const entries = lineup.map((participant, idx) => ({
    heat_id: insertedHeat.id,
    participant_id: participant.id,
    lane_or_position: idx + 1
  }));

  const { error: entryErr } = await supabase.from('heat_entries').insert(entries);
  if (entryErr) {
    setAdminMessage(entryErr.message, true);
    return null;
  }

  return insertedHeat.id;
}

async function renderLineupTable(roundType, lineup) {
  const resultMaps = await loadResultMapsForLineup(lineup.map((p) => p.id));

  const categoryTitle = roundType === 'kings_run'
    ? 'Königslauf - 4 Qualifizierte (verschiedene Personen)'
    : `${escapeHtml(selectedCategory()?.name || '')} - ${roundLabel(roundType)}`;

  const rows = lineup
    .map((p, idx) => {
      const firstValue = resultMaps.first.get(p.id) ?? '';
      const secondValue = resultMaps.second.get(p.id) ?? '';
      const kingsValue = resultMaps.kings.get(p.id) ?? '';
      return `
      <tr>
        <td>${idx + 1}</td>
        <td>${p.start_number ?? '-'}</td>
        <td>${escapeHtml(p.last_name)}</td>
        <td>${escapeHtml(p.first_name)}</td>
        <td>${genderLabel(p.gender)}</td>
        <td><input class="small-input" type="number" min="0" step="0.01" data-time-round="first_run" data-participant-id="${p.id}" value="${firstValue}" /></td>
        <td><input class="small-input" type="number" min="0" step="0.01" data-time-round="second_run" data-participant-id="${p.id}" value="${secondValue}" /></td>
        <td><input class="small-input" type="number" min="0" step="0.01" data-time-round="kings_run" data-participant-id="${p.id}" value="${kingsValue}" /></td>
      </tr>`;
    })
    .join('');

  $('heats-output').innerHTML = `
    <article class="heat-card">
      <h4>${categoryTitle}</h4>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Pos.</th>
              <th>Startnr.</th>
              <th>Nachname</th>
              <th>Vorname</th>
              <th>Geschlecht</th>
              <th>1. Laufzeit</th>
              <th>2. Laufzeit</th>
              <th>Königslauf-Zeit</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </article>
  `;
}

async function loadResultMapsForLineup(participantIds) {
  if (!participantIds.length) {
    return { first: new Map(), second: new Map(), kings: new Map() };
  }

  const { data, error } = await supabase
    .from('results')
    .select('participant_id,time_value,heats!inner(round_type)')
    .in('participant_id', participantIds)
    .in('heats.round_type', ['first_run', 'second_run', 'kings_run']);

  if (error) {
    setAdminMessage(error.message, true);
    return { first: new Map(), second: new Map(), kings: new Map() };
  }

  const maps = { first: new Map(), second: new Map(), kings: new Map() };
  for (const row of data || []) {
    const rt = row.heats.round_type;
    if (rt === 'first_run') maps.first.set(row.participant_id, row.time_value);
    if (rt === 'second_run') maps.second.set(row.participant_id, row.time_value);
    if (rt === 'kings_run') maps.kings.set(row.participant_id, row.time_value);
  }
  return maps;
}

async function saveLineupTimes() {
  const roundType = $('heats-round-select').value;
  const categoryId = roundType === 'kings_run' ? null : Number($('heats-category-select').value);
  if (roundType !== 'kings_run' && !categoryId) {
    return setAdminMessage('Bitte zuerst Kategorie und Startaufstellung wählen.', true);
  }

  const participantIds = [...new Set([...$('heats-output').querySelectorAll('input[data-participant-id]')].map((i) => Number(i.dataset.participantId)))];
  if (!participantIds.length) return setAdminMessage('Bitte zuerst Startaufstellung anzeigen.', true);

  const heatIds = await getHeatIdsForRound(roundType, categoryId);
  for (const heatId of heatIds) {
    const { error: delErr } = await supabase.from('results').delete().eq('heat_id', heatId);
    if (delErr) return setAdminMessage(delErr.message, true);
  }

  const payload = [];
  for (const participantId of participantIds) {
    const input = $('heats-output').querySelector(`input[data-time-round="${roundType}"][data-participant-id="${participantId}"]`);
    if (!input?.value) continue;
    payload.push({ participant_id: participantId, time_value: Number(input.value) });
  }

  const currentHeatId = await ensureCurrentHeat(roundType, categoryId, participantIds);
  if (!currentHeatId) return;

  if (payload.length) {
    const insertRows = payload.map((row) => ({ ...row, heat_id: currentHeatId }));
    const { error: insertErr } = await supabase.from('results').insert(insertRows);
    if (insertErr) return setAdminMessage(insertErr.message, true);
  }

  setAdminMessage('Zeiten gespeichert.');
}

async function ensureCurrentHeat(roundType, categoryId, participantIds) {
  const { data: heatData, error } = await supabase
    .from('heats')
    .select('id')
    .eq('round_type', roundType)
    .eq('heat_number', 1)
    .match(categoryId === null ? { category_id: null } : { category_id: categoryId })
    .limit(1);

  if (error) {
    setAdminMessage(error.message, true);
    return null;
  }

  if (heatData?.[0]?.id) return heatData[0].id;

  const lineup = participants.filter((p) => participantIds.includes(p.id));
  return replaceWithSingleHeat([], roundType, categoryId, lineup);
}

async function getHeatIdsForRound(roundType, categoryId) {
  const query = supabase.from('heats').select('id').eq('round_type', roundType);
  const { data, error } = await (categoryId === null ? query.is('category_id', null) : query.eq('category_id', categoryId));
  if (error) {
    setAdminMessage(error.message, true);
    return [];
  }
  return (data || []).map((h) => h.id);
}

async function loadCategoryRanking() {
  const category = selectedCategory();
  if (!category) {
    $('category-ranking-output').innerHTML = '<p class="muted">Bitte eine Kategorie auswählen.</p>';
    return;
  }

  const ranking = await buildCategoryRanking(category.id);
  if (!ranking.length) {
    $('category-ranking-output').innerHTML = '<p class="muted">Noch keine Zeiten für diese Kategorie vorhanden.</p>';
    return;
  }

  const rows = ranking
    .map(
      (row) => `
      <tr>
        <td>${row.rank}</td>
        <td>${row.start_number ?? '-'}</td>
        <td>${escapeHtml(row.last_name)}</td>
        <td>${escapeHtml(row.first_name)}</td>
        <td>${formatTime(row.first_time)}</td>
        <td>${formatTime(row.second_time)}</td>
      </tr>`
    )
    .join('');

  $('category-ranking-output').innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Rang</th><th>Startnr.</th><th>Nachname</th><th>Vorname</th><th>1. Laufzeit</th><th>2. Laufzeit</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

async function buildCategoryRanking(categoryId) {
  const { data: catParticipants, error: pError } = await supabase
    .from('participants')
    .select('id,last_name,first_name,start_number')
    .eq('category_id', categoryId);
  if (pError) {
    setAdminMessage(pError.message, true);
    return [];
  }

  if (!catParticipants?.length) return [];

  const participantIds = catParticipants.map((p) => p.id);
  const { firstTimes, secondTimes } = await loadFirstAndSecondTimes(categoryId, participantIds);

  const rankedByFirst = [...catParticipants]
    .filter((p) => Number.isFinite(firstTimes.get(p.id)))
    .sort((a, b) => firstTimes.get(a.id) - firstTimes.get(b.id));

  const topFourIds = new Set(rankedByFirst.slice(0, 4).map((p) => p.id));

  const topFour = rankedByFirst
    .slice(0, 4)
    .sort((a, b) => {
      const aSecond = secondTimes.get(a.id);
      const bSecond = secondTimes.get(b.id);
      if (Number.isFinite(aSecond) && Number.isFinite(bSecond)) return aSecond - bSecond;
      if (Number.isFinite(aSecond)) return -1;
      if (Number.isFinite(bSecond)) return 1;
      return firstTimes.get(a.id) - firstTimes.get(b.id);
    });

  const rest = [...catParticipants]
    .filter((p) => !topFourIds.has(p.id))
    .sort((a, b) => {
      const aFirst = firstTimes.get(a.id);
      const bFirst = firstTimes.get(b.id);
      if (Number.isFinite(aFirst) && Number.isFinite(bFirst)) return aFirst - bFirst;
      if (Number.isFinite(aFirst)) return -1;
      if (Number.isFinite(bFirst)) return 1;
      return a.start_number - b.start_number;
    });

  return [...topFour, ...rest].map((p, idx) => ({
    ...p,
    rank: idx + 1,
    first_time: firstTimes.get(p.id) ?? null,
    second_time: secondTimes.get(p.id) ?? null
  }));
}

async function loadFirstAndSecondTimes(categoryId, participantIds) {
  const { data: firstHeats, error: fhErr } = await supabase.from('heats').select('id').eq('round_type', 'first_run').eq('category_id', categoryId);
  if (fhErr) {
    setAdminMessage(fhErr.message, true);
    return { firstTimes: new Map(), secondTimes: new Map() };
  }

  const { data: secondHeats, error: shErr } = await supabase.from('heats').select('id').eq('round_type', 'second_run').eq('category_id', categoryId);
  if (shErr) {
    setAdminMessage(shErr.message, true);
    return { firstTimes: new Map(), secondTimes: new Map() };
  }

  const firstTimes = await loadTimesMap(firstHeats.map((h) => h.id), participantIds);
  const secondTimes = await loadTimesMap(secondHeats.map((h) => h.id), participantIds);
  return { firstTimes, secondTimes };
}

async function loadTimesMap(heatIds, participantIds) {
  const map = new Map();
  if (!heatIds.length || !participantIds.length) return map;

  const { data, error } = await supabase
    .from('results')
    .select('participant_id,time_value')
    .in('heat_id', heatIds)
    .in('participant_id', participantIds)
    .order('time_value', { ascending: true });

  if (error) {
    setAdminMessage(error.message, true);
    return map;
  }

  for (const row of data || []) {
    if (!map.has(row.participant_id)) map.set(row.participant_id, Number(row.time_value));
  }

  return map;
}

async function exportRankingsPdf() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  let y = 40;
  doc.setFontSize(16);
  doc.text('Ranglisten pro Kategorie', 40, y);
  y += 26;
  doc.setFontSize(11);

  for (const category of categories) {
    const ranking = await buildCategoryRanking(category.id);
    if (!ranking.length) continue;

    if (y > 720) {
      doc.addPage();
      y = 40;
    }

    doc.setFont(undefined, 'bold');
    doc.text(`${category.name} (${DISTANCE_LABEL[category.distance]})`, 40, y);
    y += 16;
    doc.setFont(undefined, 'normal');

    doc.text('Rang | Startnr. | Name | 1. Lauf | 2. Lauf', 50, y);
    y += 14;

    for (const row of ranking) {
      if (y > 780) {
        doc.addPage();
        y = 40;
      }
      const line = `${row.rank} | ${row.start_number ?? '-'} | ${row.last_name} ${row.first_name} | ${formatTime(row.first_time)} | ${formatTime(row.second_time)}`;
      doc.text(line, 50, y);
      y += 13;
    }

    y += 14;
  }

  doc.save(`ranglisten-${new Date().toISOString().slice(0, 10)}.pdf`);
  $('pdf-message').textContent = 'PDF mit Ranglisten wurde erzeugt und heruntergeladen.';
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function selectedCategory() {
  const categoryId = Number($('heats-category-select').value);
  return categories.find((c) => c.id === categoryId) || null;
}

function categoryById(categoryId) {
  return categories.find((c) => c.id === categoryId) || null;
}

async function findCategoryIdByProfile(gender, age) {
  const { data, error } = await supabase
    .from('categories')
    .select('id')
    .eq('gender', gender)
    .lte('min_age', age)
    .gte('max_age', age)
    .order('min_age', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    setAdminMessage(`Kategorie konnte nicht automatisch zugeordnet werden: ${error.message}`, true);
    return null;
  }

  return data?.id ?? null;
}

async function getParticipantsForCategory(categoryId) {
  const category = categoryById(categoryId);
  if (!category) {
    setAdminMessage('Die ausgewählte Kategorie wurde nicht gefunden.', true);
    return [];
  }

  const { data, error } = await supabase
    .from('participants')
    .select('id,last_name,first_name,start_number,gender,category_id,age,birth_year')
    .eq('gender', category.gender)
    .gte('age', category.min_age)
    .lte('age', category.max_age)
    .order('start_number', { ascending: true });

  if (error) {
    setAdminMessage(error.message, true);
    return [];
  }

  return data || [];
}

function findCategoryForParticipant(gender, age) {
  return categories.find((c) => c.gender === gender && age >= c.min_age && age <= c.max_age) || null;
}

function resolveAge(participant) {
  if (Number.isInteger(participant.age)) return participant.age;
  return calculateAge(participant.birth_year);
}

function roundLabel(roundType) {
  return ROUND_TYPES[roundType] || roundType;
}

function calculateAge(birthYear) {
  const currentYear = new Date().getFullYear();
  return Number.isInteger(birthYear) ? Math.max(0, currentYear - birthYear) : 0;
}

function formatTime(timeValue) {
  return Number.isFinite(Number(timeValue)) ? Number(timeValue).toFixed(2) : '-';
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
