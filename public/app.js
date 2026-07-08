const pdfInput = document.getElementById('pdfFileName');
const loadSectionsBtn = document.getElementById('loadSectionsBtn');
const extractBtn = document.getElementById('extractBtn');
const providerSelect = document.getElementById('providerSelect');
const modelSelect = document.getElementById('modelSelect');
const sectionSelect = document.getElementById('sectionSelect');
const statusEl = document.getElementById('status');
const sectionStatusEl = document.getElementById('sectionStatus');
const resultsEl = document.getElementById('results');

const modelOptions = {
  gemini: [
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { value: 'gemini-2o', label: 'Gemini 2o' },
    { value: 'gemini-1.0', label: 'Gemini 1.0' },
  ],
  openai: [
    { value: 'gpt-4o-mini', label: 'OpenAI GPT-4o Mini' },
    { value: 'gpt-4.1-mini', label: 'OpenAI GPT-4.1 Mini' },
    { value: 'gpt-4.1', label: 'OpenAI GPT-4.1' },
  ],
};

const updateModelOptions = () => {
  const provider = providerSelect?.value || 'gemini';
  const options = modelOptions[provider] || modelOptions.gemini;
  if (!modelSelect) return;
  modelSelect.innerHTML = options
    .map((option) => `<option value="${option.value}">${option.label}</option>`)
    .join('');
};

providerSelect?.addEventListener('change', updateModelOptions);
updateModelOptions();

let currentFile = null;
const STORAGE_KEY = 'pdf-extracted-results';

const saveResultsToSession = (data) => {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    console.warn('Failed to save results to session storage:', error);
  }
};

const loadResultsFromSession = () => {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn('Failed to load results from session storage:', error);
    return null;
  }
};

const escapeHtml = (value) => {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const formatBlock = (block) => {
  const text = escapeHtml(block.text_content || '');
  switch (block.type) {
    case 'latex':
      return `<div class="block latex"><code>${text}</code></div>`;
    case 'table':
      if (!Array.isArray(block.table_data)) {
        return `<div class="block">${text}</div>`;
      }
      const rows = block.table_data
        .map((row) =>
          `<tr>${row
            .map((cell) => `<td>${escapeHtml(cell ?? '')}</td>`)
            .join('')}</tr>`
        )
        .join('');
      return `<div class="block table"><table>${rows}</table></div>`;
    case 'image_placeholder':
      return `<div class="block">📷 ${escapeHtml(block.image_reference_tag || 'Image placeholder')}</div>`;
    default:
      return `<div class="block">${text}</div>`;
  }
};

const renderBlocks = (blocks) => {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return '<div class="block">No content.</div>';
  }
  return blocks.map(formatBlock).join('');
};

const renderOption = (option) => {
  const label = option.key || option.label || '';
  const content = Array.isArray(option.content)
    ? option.content.map(formatBlock).join('')
    : escapeHtml(option.content || '');
  return `<div class="details-card"><strong>${escapeHtml(label)}.</strong> ${content}</div>`;
};

const renderQuestion = (question, index) => {
  const body = renderBlocks(question.question_body || []);
  const optionsHtml = Array.isArray(question.options)
    ? question.options.map(renderOption).join('')
    : '';
  const explanation = renderBlocks(question.explanation || []);

  return `
    <div class="question-card">
      <div class="question-number">${escapeHtml(question.question_number || `Q${index + 1}`)}</div>
      ${body}
      ${optionsHtml ? `<div class="details-card">${optionsHtml}</div>` : ''}
      <div class="meta-row">
        <span class="tag">Answer: ${escapeHtml(question.answer_key || 'N/A')}</span>
        <span>${escapeHtml(question.question_type || 'Unknown type')}</span>
      </div>
      ${explanation ? `<div class="details-card"><strong>Explanation</strong>${explanation}</div>` : ''}
    </div>
  `;
};

const renderOutput = (data) => {
  const title = escapeHtml(data.paper_title || 'Untitled paper');
  const clusters = Array.isArray(data.question_clusters) ? data.question_clusters : [];

  if (clusters.length === 0) {
    return `<div class="question-card">No questions were found in the extracted result.</div>`;
  }

  return `
    <div class="question-cluster">
      <h2>${title}</h2>
      ${clusters
        .map((cluster, clusterIndex) => {
          const questions = Array.isArray(cluster.sub_questions) ? cluster.sub_questions : [];
          return `
            <div class="question-cluster">
              <div class="meta-row">
                <span class="tag">Cluster ${clusterIndex + 1}</span>
                <span>${cluster.has_shared_context ? 'Shared context enabled' : 'No shared context'}</span>
              </div>
              ${cluster.shared_context_blocks && cluster.shared_context_blocks.length > 0
                ? `<div class="details-card"><strong>Shared Context</strong>${renderBlocks(cluster.shared_context_blocks)}</div>`
                : ''}
              ${questions.map(renderQuestion).join('')}
            </div>
          `;
        })
        .join('')}
    </div>
  `;
};

const setStatus = (message, isError = false) => {
  statusEl.textContent = message;
  statusEl.style.color = isError ? 'var(--danger)' : 'var(--muted)';
};

const setSectionStatus = (message, isError = false) => {
  sectionStatusEl.textContent = message;
  sectionStatusEl.style.color = isError ? 'var(--danger)' : 'var(--muted)';
};

loadSectionsBtn.addEventListener('click', async () => {
  const file = pdfInput.files && pdfInput.files[0];
  if (!file) {
    setSectionStatus('Choose a PDF file first.', true);
    return;
  }

  currentFile = file;
  setSectionStatus('Loading sections…');
  sectionSelect.disabled = true;

  try {
    const form = new FormData();
    form.append('pdfFile', file, file.name);
    if (providerSelect && providerSelect.value) {
      form.append('provider', providerSelect.value);
    }
    if (modelSelect && modelSelect.value) {
      form.append('model', modelSelect.value);
    }

    const response = await fetch('/api/extract-sections', {
      method: 'POST',
      body: form,
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Failed to load sections.');
    }

    const sections = payload.sections || [];
    
    // Clear and repopulate dropdown
    sectionSelect.innerHTML = '<option value="">-- All Sections --</option>';
    sections.forEach((section) => {
      const option = document.createElement('option');
      option.value = section.name;
      option.textContent = section.name;
      sectionSelect.appendChild(option);
    });

    sectionSelect.disabled = false;
    setSectionStatus(`Loaded ${sections.length} section(s).`);
  } catch (error) {
    setSectionStatus(error.message || 'Failed to load sections.', true);
    sectionSelect.disabled = true;
  }
});

extractBtn.addEventListener('click', async () => {
  const file = pdfInput.files && pdfInput.files[0];
  if (!file) {
    setStatus('Choose a PDF file to upload.', true);
    return;
  }

  const selectedSection = sectionSelect.value || undefined;
  setStatus(`Extracting questions${selectedSection ? ` from \"${selectedSection}\"` : ''}…`);
  resultsEl.innerHTML = '';

  try {
    const form = new FormData();
    form.append('pdfFile', file, file.name);
    if (selectedSection) {
      form.append('section', selectedSection);
    }
    if (providerSelect && providerSelect.value) {
      form.append('provider', providerSelect.value);
    }
    if (modelSelect && modelSelect.value) {
      form.append('model', modelSelect.value);
    }

    const response = await fetch('/api/extract-blocks', {
      method: 'POST',
      body: form,
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Extraction failed.');
    }

    resultsEl.innerHTML = renderOutput(payload.data);
    saveResultsToSession(payload.data);
    setStatus('Extraction complete.');
  } catch (error) {
    resultsEl.innerHTML = '';
    setStatus(error.message || 'Unknown error occurred.', true);
  }
});

const persistedResults = loadResultsFromSession();
if (persistedResults) {
  resultsEl.innerHTML = renderOutput(persistedResults);
  setStatus('Restored previous extraction from this tab.');
}

