const DISTANCE_LABEL = { 60: '60m', 80: '80m', 100: '100m' };
const ROUND_TYPES = {
  first_run: '1. Lauf',
  second_run: '2. Lauf',
  kings_run: 'Königslauf'
};
const ROUND_ORDER = ['first_run', 'second_run', 'kings_run'];

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
  $('assign-categories').addEventListener('click', assignParticipantsToExistingCategories);

  $('category-form').addEventListener('submit', saveCategory);
  $('category-reset').addEventListener('click', resetCategoryForm);
  $('category-has-run-2').addEventListener('change', syncCategoryRunToggles);

  $('blocked-number-form').addEventListener('submit', saveBlockedNumber);

  $('heats-round-select').addEventListener('change', handleRoundFilterChange);
  $('heats-category-select').addEventListener('change', handleRoundFilterChange);
  $('show-lineup').addEventListener('click', showStartLineup);
  $('save-lineup-times').addEventListener('click', saveLineupTimes);
  $('calculate-rankings').addEventListener('click', loadCategoryRanking);

  $('export-pdf').addEventListener('click', exportRankingsPdf);
}

function syncCategoryRunToggles() {
  const hasRun2 = $('category-has-run-2').checked;
  if (!hasRun2) {
    $('category-has-kings-run').checked = false;
  }
  $('category-has-kings-run').disabled = !hasRun2;
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
  const birthYear = Number($('reg-birth-year').value);
  const currentYear = new Date().getFullYear();

  if (!lastName || !firstName || !gender || !Number.isInteger(birthYear)) {
    $('public-message').textContent = 'Bitte Nachname, Vorname, Geschlecht und Geburtsjahr ausfüllen.';
    return;
  }

  if (birthYear < currentYear - 120 || birthYear > currentYear - 1) {
    $('public-message').textContent = `Geburtsjahr muss zwischen ${currentYear - 120} und ${currentYear - 1} liegen.`;
    return;
  }

  const age = currentYear - birthYear;
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

async function assignParticipantsToExistingCategories() {
  if (!participants.length) {
    await loadParticipants();
  }

  if (!participants.length) {
    return setAdminMessage('Keine Anmeldungen vorhanden.', true);
  }

  await withLoadingScreen('Kategorien werden automatisch zugewiesen ...', async () => {
    const updates = [];

    for (const participant of participants) {
      const age = resolveAge(participant);
      const suggestedCategory = findCategoryForParticipant(participant.gender, age);
      if (!suggestedCategory || participant.category_id === suggestedCategory.id) continue;

      updates.push(
        supabase
          .from('participants')
          .update({ category_id: suggestedCategory.id })
          .eq('id', participant.id)
      );
    }

    if (!updates.length) {
      setAdminMessage('Alle vorhandenen Anmeldungen sind bereits korrekt zugewiesen.');
      return;
    }

    const results = await Promise.all(updates);
    const failed = results.filter((result) => result.error);
    if (failed.length) {
      throw new Error(failed[0].error.message);
    }

    setAdminMessage(`${updates.length} Anmeldung(en) wurden automatisch Kategorien zugewiesen.`);
    await loadParticipants();
  });
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
  el.classList.toggle('is-error', isError);
  el.classList.toggle('is-success', !isError);
  el.textContent = message;
}

async function loadAllAdminData() {
  await Promise.all([loadCategories(), loadParticipants(), loadBlockedNumbers()]);
  handleRoundFilterChange();
}

async function loadParticipants() {
  const { data, error } = await supabase
    .from('participants')
    .select('id,last_name,first_name,gender,age,birth_year,start_number,category_id,created_at,categories(name,distance,min_age,max_age,gender_mode)')
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
      ? `${p.categories.name} (${DISTANCE_LABEL[p.categories.distance]}, ${p.categories.min_age}-${p.categories.max_age}J, ${genderModeLabel(p.categories.gender_mode)})`
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
      .map((c) => `${c.id}: ${c.name} (${genderModeLabel(c.gender_mode)}, ${DISTANCE_LABEL[c.distance]}, ${c.min_age}-${c.max_age}J)`).join('\n')}`,
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
      <td>${genderModeLabel(cat.gender_mode)}</td>
      <td>${DISTANCE_LABEL[cat.distance]}</td>
      <td>${range}</td>
      <td>${roundSummary(cat)}</td>
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
  $('category-gender-mode').value = cat.gender_mode;
  $('category-distance').value = String(cat.distance);
  $('category-min-age').value = cat.min_age;
  $('category-max-age').value = cat.max_age;
  $('category-has-run-2').checked = Boolean(cat.has_run_2);
  $('category-has-kings-run').checked = Boolean(cat.has_kings_run);
  syncCategoryRunToggles();
}

function resetCategoryForm() {
  $('category-form').reset();
  $('category-id').value = '';
  $('category-has-run-1').checked = true;
  $('category-has-run-2').checked = true;
  $('category-has-kings-run').checked = true;
  syncCategoryRunToggles();
}

async function saveCategory(event) {
  event.preventDefault();
  const id = $('category-id').value;
  const minAge = Number($('category-min-age').value);
  const maxAge = Number($('category-max-age').value);
  const hasRun2 = $('category-has-run-2').checked;
  const hasKingsRun = hasRun2 && $('category-has-kings-run').checked;

  if (minAge > maxAge) {
    return setAdminMessage('Mindestalter darf nicht größer als Höchstalter sein.', true);
  }

  const payload = {
    name: $('category-name').value.trim(),
    gender_mode: $('category-gender-mode').value,
    distance: Number($('category-distance').value),
    min_age: minAge,
    max_age: maxAge,
    has_run_1: true,
    has_run_2: hasRun2,
    has_kings_run: hasKingsRun
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
        (c) => `<option value="${c.id}">${escapeHtml(c.name)} (${DISTANCE_LABEL[c.distance]}, ${c.min_age}-${c.max_age}J, ${roundSummary(c)})</option>`
      )
    )
    .join('');
  $('heats-category-select').innerHTML = options;
  renderRoundSelectOptions();
}

function renderRoundSelectOptions() {
  const category = selectedCategory();
  const roundSelect = $('heats-round-select');
  const current = roundSelect.value;

  roundSelect.innerHTML = ROUND_ORDER
    .map((roundType) => {
      const allowed = category ? isRoundAllowedForCategory(category, roundType) : true;
      const stateText = allowed ? '' : ' (deaktiviert)';
      return `<option value="${roundType}" ${allowed ? '' : 'disabled'}>${roundLabel(roundType)}${stateText}</option>`;
    })
    .join('');

  const currentOption = [...roundSelect.options].find((option) => option.value === current && !option.disabled);
  if (currentOption) {
    roundSelect.value = current;
    return;
  }

  const firstEnabled = [...roundSelect.options].find((option) => !option.disabled);
  if (firstEnabled) {
    roundSelect.value = firstEnabled.value;
  }
}

function handleRoundFilterChange() {
  renderRoundSelectOptions();
  $('category-ranking-output').innerHTML = '';
}

async function showStartLineup() {
  const category = selectedCategory();
  const roundType = $('heats-round-select').value;

  if (!category) {
    return setAdminMessage('Bitte zuerst eine Kategorie auswählen.', true);
  }

  if (!isRoundAllowedForCategory(category, roundType)) {
    return setAdminMessage('Dieser Lauf ist für die ausgewählte Kategorie nicht aktiv.', true);
  }

  const lineup = await getLineupParticipants(roundType, category.id);
  if (!lineup.length) {
    $('heats-output').innerHTML = '<p class="muted">Keine Teilnehmenden für diese Auswahl vorhanden.</p>';
    return setAdminMessage('Keine Teilnehmenden für diese Auswahl vorhanden.', true);
  }

  await ensureHeatAndEntries(roundType, category.id, lineup);
  await renderLineupTable(roundType, category, lineup);
  setAdminMessage('Startaufstellung geladen.');
}

async function getLineupParticipants(roundType, categoryId) {
  if (roundType === 'first_run') {
    return getParticipantsForCategory(categoryId);
  }

  if (roundType === 'second_run') {
    return getTopParticipantsFromFirstRun(categoryId, 4);
  }

  return getKingsRunQualifiedParticipants(categoryId);
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

async function getKingsRunQualifiedParticipants(categoryId) {
  const { data: secondRunHeats, error: hError } = await supabase
    .from('heats')
    .select('id')
    .eq('round_type', 'second_run')
    .eq('category_id', categoryId);

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
  const { data: existingHeats, error: heatErr } = await supabase
    .from('heats')
    .select('id')
    .eq('round_type', roundType)
    .eq('category_id', categoryId);

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

async function renderLineupTable(roundType, category, lineup) {
  const resultMaps = await loadResultMapsForLineup(lineup.map((p) => p.id), category.id);

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
        ${renderTimeInputCell(category, roundType, 'first_run', p.id, firstValue)}
        ${renderTimeInputCell(category, roundType, 'second_run', p.id, secondValue)}
        ${renderTimeInputCell(category, roundType, 'kings_run', p.id, kingsValue)}
      </tr>`;
    })
    .join('');

  $('heats-output').innerHTML = `
    <article class="heat-card">
      <h4>${escapeHtml(category.name)} · ${roundLabel(roundType)}</h4>
      <p class="muted">Aktive Läufe: ${roundSummary(category)}</p>
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

function renderTimeInputCell(category, selectedRound, cellRound, participantId, value) {
  const roundEnabled = isRoundAllowedForCategory(category, cellRound);
  const editable = roundEnabled && selectedRound === cellRound;
  const disabled = !editable;
  const cssClass = disabled ? 'small-input disabled-input' : 'small-input active-input';
  const placeholder = !roundEnabled ? 'Nicht aktiv' : '';

  return `<td>
    <input
      class="${cssClass}"
      type="number"
      min="0"
      step="0.01"
      data-time-round="${cellRound}"
      data-participant-id="${participantId}"
      value="${value}"
      ${disabled ? 'disabled aria-disabled="true"' : ''}
      placeholder="${placeholder}"
    />
  </td>`;
}

async function loadResultMapsForLineup(participantIds, categoryId) {
  if (!participantIds.length) {
    return { first: new Map(), second: new Map(), kings: new Map() };
  }

  const { data, error } = await supabase
    .from('results')
    .select('participant_id,time_value,heats!inner(round_type,category_id)')
    .in('participant_id', participantIds)
    .eq('heats.category_id', categoryId)
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
  const category = selectedCategory();
  const roundType = $('heats-round-select').value;

  if (!category) {
    return setAdminMessage('Bitte zuerst Kategorie und Startaufstellung wählen.', true);
  }

  if (!isRoundAllowedForCategory(category, roundType)) {
    return setAdminMessage('Dieser Lauf ist für die Kategorie nicht erlaubt.', true);
  }

  const inputs = [...$('heats-output').querySelectorAll(`input[data-time-round="${roundType}"]`)];
  const participantIds = [...new Set(inputs.map((input) => Number(input.dataset.participantId)))];
  if (!participantIds.length) return setAdminMessage('Bitte zuerst Startaufstellung anzeigen.', true);

  const heatIds = await getHeatIdsForRound(roundType, category.id);
  for (const heatId of heatIds) {
    const { error: delErr } = await supabase.from('results').delete().eq('heat_id', heatId);
    if (delErr) return setAdminMessage(delErr.message, true);
  }

  const payload = [];
  for (const input of inputs) {
    if (!input?.value) continue;
    payload.push({ participant_id: Number(input.dataset.participantId), time_value: Number(input.value) });
  }

  const currentHeatId = await ensureCurrentHeat(roundType, category.id, participantIds);
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
    .eq('category_id', categoryId)
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
  const { data, error } = await supabase.from('heats').select('id').eq('round_type', roundType).eq('category_id', categoryId);
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

  const ranking = await buildCategoryRanking(category);
  if (!ranking.length) {
    $('category-ranking-output').innerHTML = '<p class="muted">Noch keine Zeiten für diese Kategorie vorhanden.</p>';
    return;
  }

  const secondRunActive = isRoundAllowedForCategory(category, 'second_run');
  const rows = ranking
    .map(
      (row) => `
      <tr>
        <td>${row.rank}</td>
        <td>${row.start_number ?? '-'}</td>
        <td>${escapeHtml(row.last_name)}</td>
        <td>${escapeHtml(row.first_name)}</td>
        <td>${formatTime(row.first_time)}</td>
        <td>${secondRunActive ? formatTime(row.second_time) : '-'}</td>
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

async function buildCategoryRanking(category) {
  const { data: catParticipants, error: pError } = await supabase
    .from('participants')
    .select('id,last_name,first_name,start_number')
    .eq('category_id', category.id);
  if (pError) {
    setAdminMessage(pError.message, true);
    return [];
  }

  if (!catParticipants?.length) return [];

  const participantIds = catParticipants.map((p) => p.id);
  const { firstTimes, secondTimes } = await loadFirstAndSecondTimes(category, participantIds);
  const secondRoundActive = isRoundAllowedForCategory(category, 'second_run');

  const rankedByFirst = [...catParticipants]
    .filter((p) => Number.isFinite(firstTimes.get(p.id)))
    .sort((a, b) => firstTimes.get(a.id) - firstTimes.get(b.id));

  if (!secondRoundActive) {
    return rankedByFirst.map((p, idx) => ({
      ...p,
      rank: idx + 1,
      first_time: firstTimes.get(p.id) ?? null,
      second_time: null
    }));
  }

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

async function loadFirstAndSecondTimes(category, participantIds) {
  const { data: firstHeats, error: fhErr } = await supabase.from('heats').select('id').eq('round_type', 'first_run').eq('category_id', category.id);
  if (fhErr) {
    setAdminMessage(fhErr.message, true);
    return { firstTimes: new Map(), secondTimes: new Map() };
  }

  let secondHeats = [];
  if (isRoundAllowedForCategory(category, 'second_run')) {
    const { data, error: shErr } = await supabase.from('heats').select('id').eq('round_type', 'second_run').eq('category_id', category.id);
    if (shErr) {
      setAdminMessage(shErr.message, true);
      return { firstTimes: new Map(), secondTimes: new Map() };
    }
    secondHeats = data || [];
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
    const ranking = await buildCategoryRanking(category);
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
      const secondVal = isRoundAllowedForCategory(category, 'second_run') ? formatTime(row.second_time) : '-';
      const line = `${row.rank} | ${row.start_number ?? '-'} | ${row.last_name} ${row.first_name} | ${formatTime(row.first_time)} | ${secondVal}`;
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
  const matched = categories
    .filter((category) => isGenderAllowedInCategory(category, gender) && age >= category.min_age && age <= category.max_age)
    .sort((a, b) => b.min_age - a.min_age)[0];

  if (matched) {
    return matched.id;
  }

  const { data, error } = await supabase
    .from('categories')
    .select('id,gender_mode,min_age,max_age')
    .lte('min_age', age)
    .gte('max_age', age);

  if (error) {
    setAdminMessage(`Kategorie konnte nicht automatisch zugeordnet werden: ${error.message}`, true);
    return null;
  }

  return (data || []).find((row) => isGenderAllowedInCategory(row, gender))?.id ?? null;
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
    .order('start_number', { ascending: true });

  if (error) {
    setAdminMessage(error.message, true);
    return [];
  }

  const filtered = (data || []).filter((participant) => {
    if (participant.category_id === categoryId) return true;
    if (!isGenderAllowedInCategory(category, participant.gender)) return false;

    const participantAge = resolveAge(participant);
    return participantAge >= category.min_age && participantAge <= category.max_age;
  });

  const uniqueById = new Map();
  for (const participant of filtered) {
    uniqueById.set(participant.id, participant);
  }

  return [...uniqueById.values()];
}

function findCategoryForParticipant(gender, age) {
  return categories.find((c) => isGenderAllowedInCategory(c, gender) && age >= c.min_age && age <= c.max_age) || null;
}

function isGenderAllowedInCategory(category, gender) {
  if (category.gender_mode === 'mixed') return true;
  return category.gender_mode === gender;
}

function isRoundAllowedForCategory(category, roundType) {
  if (!category) return false;
  if (roundType === 'first_run') return Boolean(category.has_run_1 ?? true);
  if (roundType === 'second_run') return Boolean(category.has_run_2);
  if (roundType === 'kings_run') return Boolean(category.has_kings_run);
  return false;
}

function roundSummary(category) {
  return ROUND_ORDER.filter((roundType) => isRoundAllowedForCategory(category, roundType)).map(roundLabel).join(', ');
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

function genderModeLabel(mode) {
  if (mode === 'male') return 'Männlich';
  if (mode === 'female') return 'Weiblich';
  if (mode === 'mixed') return 'Gemischt';
  return '-';
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

async function withLoadingScreen(_message, task) {
  try {
    return await task();
  } catch (error) {
    setAdminMessage(error.message || 'Vorgang fehlgeschlagen.', true);
    return null;
  }
}
