// Repository text is always inserted through textContent, never interpreted as HTML.
const element = (id) => document.getElementById(id);
const form = element('scan-form');
const input = element('repository');
const submit = element('scan-button');
const list = element('skill-list');
const workspace = document.querySelector('.workspace');

function clearResults() {
  list.replaceChildren();
  element('skill-count').textContent = '0';
  element('repository-info').textContent = 'No repository selected';
  element('document').hidden = true;
  element('document-empty').hidden = false;
  element('warnings').hidden = true;
}

function showSkill(skill, button) {
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
    element('skill-count').textContent = String(result.skills.length);
    element('status').textContent = result.skills.length
      ? `${result.skills.length} project ${result.skills.length === 1 ? 'skill' : 'skills'} in ${result.repository.id}`
      : 'No project skills found in this repository.';
    if (result.warnings.length) {
      element('warnings').textContent = `Scan warnings\n${result.warnings.join('\n')}`;
      element('warnings').hidden = false;
    }
    for (const skill of result.skills) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'skill-item';
      button.setAttribute('aria-current', 'false');
      const name = document.createElement('strong');
      name.textContent = skill.name;
      const description = document.createElement('span');
      description.textContent = skill.description || skill.path;
      button.append(name, description);
      button.addEventListener('click', () => showSkill(skill, button));
      list.append(button);
    }
    if (result.skills.length) showSkill(result.skills[0], list.firstElementChild);
    else {
      const empty = document.createElement('p');
      empty.className = 'list-empty';
      empty.textContent = 'No skills in the supported project folders.';
      list.append(empty);
    }
  } catch (error) {
    element('status').textContent = error instanceof Error ? error.message : 'Unable to reach the local server. Please try again.';
  } finally {
    submit.disabled = false;
    input.disabled = false;
    submit.textContent = 'Explore repository →';
    workspace.setAttribute('aria-busy', 'false');
  }
});
