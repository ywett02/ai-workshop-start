// Repository text is always inserted through textContent, never interpreted as HTML.
const element = (id) => document.getElementById(id);
const form = element('scan-form');
const input = element('repository');
const submit = element('scan-button');
const scope = element('scope');
const list = element('skill-list');
const workspace = document.querySelector('.workspace');
const filter = element('filter-query');
let skills = [];
let selectedSkill = null;
let repositories = null;
let scanning = false;
const buttonSkills = new WeakMap();

function clearResults() {
  skills = [];
  selectedSkill = null;
  repositories = null;
  filter.value = '';
  element('skill-filter').hidden = true;
  element('filter-status').textContent = '';
  list.replaceChildren();
  element('skill-count').textContent = '0';
  element('repository-info').textContent = 'No repository selected';
  element('document').hidden = true;
  element('document-empty').hidden = false;
  element('warnings').hidden = true;
}

function showSkill(skill, button) {
  selectedSkill = skill;
  for (const item of list.querySelectorAll('button')) item.setAttribute('aria-current', String(item === button));
  element('document-empty').hidden = true;
  element('document').hidden = false;
  element('skill-name').textContent = skill.name;
  element('skill-repository').textContent = `${skill.repository} · ${skill.commit.slice(0, 7)}`;
  const updated = element('skill-updated');
  updated.textContent = 'Last updated: ';
  if (skill.lastUpdated) {
    const time = document.createElement('time');
    time.dateTime = skill.lastUpdated;
    time.textContent = new Intl.DateTimeFormat('en-US', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      hourCycle: 'h23', timeZone: 'UTC',
    }).format(new Date(skill.lastUpdated)) + ' UTC';
    updated.append(time);
  } else updated.append('Unknown');
  element('skill-description').textContent = skill.description;
  element('skill-path').textContent = skill.path;
  element('skill-copies').textContent = `Also in: ${skill.copies.join(', ')}`;
  element('skill-copies').hidden = skill.copies.length === 0;
  element('source-link').href = skill.link;
  element('skill-content').textContent = skill.content;
  element('skill-content').scrollTop = 0;
}

// Lowercasing can expand a character (İ → i + combining dot). Keep UTF-16
// source boundaries for every folded code unit, including partial matches.
function matchRanges(text, query) {
  if (!query) return [];
  const starts = [];
  const ends = [];
  let offset = 0;
  for (const character of text) {
    for (let i = 0; i < character.toLowerCase().length; i++) {
      starts.push(offset);
      ends.push(offset + character.length);
    }
    offset += character.length;
  }
  const lower = text.toLowerCase();
  const ranges = [];
  let match = lower.indexOf(query);
  while (match !== -1) {
    const start = starts[match];
    const end = ends[match + query.length - 1];
    const previous = ranges.at(-1);
    if (previous && start < previous.end) previous.end = Math.max(previous.end, end);
    else ranges.push({ start, end });
    match = lower.indexOf(query, match + query.length);
  }
  return ranges;
}

function highlightedText(text, query) {
  const fragment = document.createDocumentFragment();
  let start = 0;
  for (const match of matchRanges(text, query)) {
    fragment.append(document.createTextNode(text.slice(start, match.start)));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(match.start, match.end);
    fragment.append(mark);
    start = match.end;
  }
  fragment.append(document.createTextNode(text.slice(start)));
  return fragment;
}

function addSkill(skill, query, selection) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'skill-item';
  button.setAttribute('aria-current', 'false');
  const name = document.createElement('strong');
  name.append(highlightedText(skill.name, query));
  const description = document.createElement('span');
  const text = skill.description || skill.path;
  const match = matchRanges(text, query)[0]?.start ?? -1;
  // Keep a description match visible even when it is deep in a long description.
  const previewStart = Math.max(0, match - 20);
  description.append(highlightedText((previewStart ? '…' : '') + text.slice(previewStart), query));
  if (match !== -1) description.className = 'matching-description';
  button.append(name, description);
  button.addEventListener('click', () => showSkill(skill, button));
  buttonSkills.set(button, skill);
  list.append(button);
  if (skill === selection) showSkill(skill, button);
}

function renderSkills() {
  const query = filter.value.trim().toLowerCase();
  const matching = (skill) => !query ||
    skill.name.toLowerCase().includes(query) || skill.description.toLowerCase().includes(query);
  const matches = skills.filter(matching);
  const selection = matches.includes(selectedSkill) ? selectedSkill : matches[0];
  // Repositories arrive while an organization is scanned; keep keyboard focus on its skill.
  const focused = buttonSkills.get(document.activeElement);
  list.replaceChildren();
  element('skill-count').textContent = query ? `${matches.length} of ${skills.length}` : String(skills.length);
  element('filter-status').textContent = query
    ? `${matches.length} of ${skills.length} skills match.`
    : `${skills.length} ${skills.length === 1 ? 'skill' : 'skills'} available.`;
  if (repositories) {
    for (const entry of repositories) {
      const entryMatches = entry.skills.filter(matching);
      // While filtering, only repositories with matching skills keep their heading.
      if (query && !entryMatches.length) continue;
      const heading = document.createElement('h3');
      heading.className = 'repository-heading';
      heading.textContent = `${entry.repository.id} · ${entry.skills.length} ${entry.skills.length === 1 ? 'skill' : 'skills'} · ${entry.repository.commit.slice(0, 7)}`;
      list.append(heading);
      for (const skill of entryMatches) addSkill(skill, query, selection);
    }
  } else {
    for (const skill of matches) addSkill(skill, query, selection);
  }
  if (!matches.length) {
    selectedSkill = null;
    element('document').hidden = true;
    element('document-empty').hidden = false;
    const empty = document.createElement('p');
    empty.className = 'list-empty';
    empty.textContent = query ? 'No skills match your filter.'
      : scanning ? 'Skills appear here as repositories are scanned.' : 'No skills in the supported project folders.';
    list.append(empty);
  }
  if (focused) [...list.querySelectorAll('button')].find((button) => buttonSkills.get(button) === focused)?.focus();
}

function showWarnings(warnings) {
  element('warnings').textContent = `Scan warnings\n${warnings.join('\n')}`;
  element('warnings').hidden = warnings.length === 0;
}

// The server sends one JSON line per event: start, each repository as it finishes, done.
async function showOrganization(response) {
  let start = null;
  let finished = false;
  const scans = [];
  const update = () => {
    repositories = scans.flatMap((scan) => scan.result ?? []);
    // Group entries and the flattened list share order; reuse group objects so selection matches.
    skills = repositories.flatMap((entry) => entry.skills);
    const warnings = [...start.warnings, ...scans.flatMap((scan) => scan.warnings)];
    element('repository-info').textContent = `${start.organization} · ${repositories.length} of ${start.repositoryCount} repositories scanned`;
    element('skill-filter').hidden = skills.length === 0;
    showWarnings(warnings);
    const found = `${skills.length} project ${skills.length === 1 ? 'skill' : 'skills'}`;
    element('status').textContent = !finished
      ? `Exploring ${start.organization}: ${scans.length} of ${start.repositoryCount} repositories checked, ${found} so far…`
      : skills.length ? `${found} in ${start.organization}` : 'No project skills found in this organization.';
    if (finished && warnings.length) element('status').textContent += ' Results may be incomplete; see scan warnings.';
    renderSkills();
  };
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = '';
  for (;;) {
    // A broken connection rejects instead of ending; both leave the scan unfinished.
    const { value, done } = await reader.read().catch(() => ({ done: true }));
    if (done) break;
    const lines = (buffered + value).split('\n');
    buffered = lines.pop();
    for (const line of lines.filter(Boolean)) {
      const event = JSON.parse(line);
      if (event.type === 'start') start = event;
      else if (event.type === 'done') finished = true;
      else if (event.type === 'repository') {
        // Case-sensitive ID order, as in a finished scan.
        const index = scans.findIndex((scan) => scan.id > event.id);
        scans.splice(index === -1 ? scans.length : index, 0, event);
      }
    }
    if (start) update();
  }
  if (!finished) throw new Error('The organization scan stopped early; results may be incomplete. Please try again.');
}

filter.addEventListener('input', renderSkills);
element('clear-filter').addEventListener('click', () => {
  filter.value = '';
  renderSkills();
  filter.focus();
});

scope.addEventListener('change', () => {
  clearResults();
  const organization = scope.value === 'organization';
  element('target-label').textContent = organization ? 'GitHub organization' : 'GitHub repository';
  input.placeholder = organization ? 'https://github.com/JetBrains or JetBrains' : 'https://github.com/owner/repository';
  input.value = '';
  input.autocomplete = organization ? 'off' : 'url';
  submit.textContent = `Explore ${scope.value} →`;
  element('status').textContent = `Ready when you are. Enter a ${scope.value} to get started.`;
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearResults();
  submit.disabled = true;
  input.disabled = true;
  scope.disabled = true;
  submit.textContent = 'Exploring…';
  workspace.setAttribute('aria-busy', 'true');
  element('status').textContent = `Exploring ${scope.value} and reading skill files…`;
  const organization = scope.value === 'organization';
  scanning = true;
  try {
    const response = await fetch(`/api/scan?${scope.value}=${encodeURIComponent(input.value.trim())}`,
      organization ? { headers: { Accept: 'application/x-ndjson' } } : undefined);
    if (!response.ok) throw new Error((await response.json()).error || `Unable to scan this ${scope.value}.`);
    if (organization) {
      await showOrganization(response);
      return;
    }
    const result = await response.json();
    element('repository-info').textContent = `${result.repository.id} · ${result.repository.commit.slice(0, 7)}`;
    skills = result.skills;
    element('skill-filter').hidden = skills.length === 0;
    element('status').textContent = result.skills.length
      ? `${result.skills.length} project ${result.skills.length === 1 ? 'skill' : 'skills'} in ${result.repository.id}`
      : `No project skills found in this ${scope.value}.`;
    if (result.warnings.length) showWarnings(result.warnings);
    renderSkills();
  } catch (error) {
    element('status').textContent = error instanceof Error ? error.message : 'Unable to reach the local server. Please try again.';
  } finally {
    scanning = false;
    if (repositories) renderSkills();
    submit.disabled = false;
    input.disabled = false;
    scope.disabled = false;
    submit.textContent = `Explore ${scope.value} →`;
    workspace.setAttribute('aria-busy', 'false');
  }
});
