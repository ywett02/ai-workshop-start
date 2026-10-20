// Repository text is always inserted through textContent, never interpreted as HTML.
const element = (id) => document.getElementById(id);
const form = element('scan-form');
const input = element('repository');
const submit = element('scan-button');
const list = element('skill-list');
const workspace = document.querySelector('.workspace');
const filter = element('filter-query');
let skills = [];
let selectedSkill = null;

function clearResults() {
  skills = [];
  selectedSkill = null;
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
  element('skill-description').textContent = skill.description;
  element('skill-path').textContent = skill.path;
  element('skill-copies').textContent = `Also in: ${skill.copies.join(', ')}`;
  element('skill-copies').hidden = skill.copies.length === 0;
  element('source-link').href = skill.link;
  element('skill-content').textContent = skill.content;
  element('skill-content').scrollTop = 0;
}

function highlightedText(text, query) {
  const fragment = document.createDocumentFragment();
  const lower = text.toLowerCase();
  let start = 0;
  let match = query ? lower.indexOf(query) : -1;
  while (match !== -1) {
    fragment.append(document.createTextNode(text.slice(start, match)));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(match, match + query.length);
    fragment.append(mark);
    start = match + query.length;
    match = lower.indexOf(query, start);
  }
  fragment.append(document.createTextNode(text.slice(start)));
  return fragment;
}

function renderSkills() {
  const query = filter.value.trim().toLowerCase();
  const matches = skills.filter((skill) => !query ||
    skill.name.toLowerCase().includes(query) || skill.description.toLowerCase().includes(query));
  const selection = matches.includes(selectedSkill) ? selectedSkill : matches[0];
  list.replaceChildren();
  element('skill-count').textContent = query ? `${matches.length} of ${skills.length}` : String(skills.length);
  element('filter-status').textContent = query
    ? `${matches.length} of ${skills.length} skills match.`
    : `${skills.length} ${skills.length === 1 ? 'skill' : 'skills'} available.`;
  for (const skill of matches) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'skill-item';
    button.setAttribute('aria-current', 'false');
    const name = document.createElement('strong');
    name.append(highlightedText(skill.name, query));
    const description = document.createElement('span');
    const text = skill.description || skill.path;
    const match = query ? text.toLowerCase().indexOf(query) : -1;
    // Keep a description match visible even when it is deep in a long description.
    const previewStart = Math.max(0, match - 20);
    description.append(highlightedText((previewStart ? '…' : '') + text.slice(previewStart), query));
    if (match !== -1) description.className = 'matching-description';
    button.append(name, description);
    button.addEventListener('click', () => showSkill(skill, button));
    list.append(button);
    if (skill === selection) showSkill(skill, button);
  }
  if (!matches.length) {
    selectedSkill = null;
    element('document').hidden = true;
    element('document-empty').hidden = false;
    const empty = document.createElement('p');
    empty.className = 'list-empty';
    empty.textContent = query ? 'No skills match your filter.' : 'No skills in the supported project folders.';
    list.append(empty);
  }
}

filter.addEventListener('input', renderSkills);
element('clear-filter').addEventListener('click', () => {
  filter.value = '';
  renderSkills();
  filter.focus();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearResults();
  submit.disabled = true;
  input.disabled = true;
  submit.textContent = 'Exploring…';
  workspace.setAttribute('aria-busy', 'true');
  element('status').textContent = 'Exploring repository and reading skill files…';
  try {
    const response = await fetch(`/api/scan?repository=${encodeURIComponent(input.value.trim())}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to scan this repository.');
    element('repository-info').textContent = `${result.repository.id} · ${result.repository.commit.slice(0, 7)}`;
    skills = result.skills;
    element('skill-filter').hidden = skills.length === 0;
    element('status').textContent = result.skills.length
      ? `${result.skills.length} project ${result.skills.length === 1 ? 'skill' : 'skills'} in ${result.repository.id}`
      : 'No project skills found in this repository.';
    if (result.warnings.length) {
      element('warnings').textContent = `Scan warnings\n${result.warnings.join('\n')}`;
      element('warnings').hidden = false;
    }
    renderSkills();
  } catch (error) {
    element('status').textContent = error instanceof Error ? error.message : 'Unable to reach the local server. Please try again.';
  } finally {
    submit.disabled = false;
    input.disabled = false;
    submit.textContent = 'Explore repository →';
    workspace.setAttribute('aria-busy', 'false');
  }
});
