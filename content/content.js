// LeetCode Correct Submission Analyzer - Content Script

let lastAnalyzedCode = null;
let lastAnalysisResult = '';
let currentPort = null;
let activeTab = '1';
let tabContents = {
  '1': '',
  '2': '',
  '3': ''
};

// Initialize components when page loads
init();

function init() {
  injectDrawer();
  injectFloatingTrigger();
  startObserver();
}

// 1. Inject the Slide-out Drawer Panel into the page body
function injectDrawer() {
  if (document.getElementById('leetcode-ai-drawer-container')) return;

  const drawerContainer = document.createElement('div');
  drawerContainer.id = 'leetcode-ai-drawer-container';
  drawerContainer.innerHTML = `
    <div id="leetcode-ai-drawer" class="leetcode-ai-drawer">
      <div class="leetcode-ai-drawer-header">
        <h2>LeetCode <span class="accent">Code Review</span></h2>
        <button id="leetcode-ai-close-btn" class="leetcode-ai-drawer-close">&times;</button>
      </div>
      <div class="leetcode-ai-tabs">
        <button class="leetcode-ai-tab-btn active" data-tab="1">Complexity</button>
        <button class="leetcode-ai-tab-btn" data-tab="2">Variations</button>
        <button class="leetcode-ai-tab-btn" data-tab="3">Optimizations</button>
      </div>
      <div class="leetcode-ai-drawer-body" id="leetcode-ai-drawer-body">
        <div class="leetcode-ai-loading-container" id="leetcode-ai-loading">
          <div class="leetcode-ai-spinner"></div>
          <p>Analyzing code structure & complexity...</p>
        </div>
        <div class="leetcode-ai-content hidden" id="leetcode-ai-content">
          <div class="leetcode-ai-tab-panel active" id="leetcode-ai-tab-panel-1"></div>
          <div class="leetcode-ai-tab-panel" id="leetcode-ai-tab-panel-2"></div>
          <div class="leetcode-ai-tab-panel" id="leetcode-ai-tab-panel-3"></div>
        </div>
      </div>
      <div class="leetcode-ai-drawer-footer">
        Created by <a href="https://github.com/Mr-Smarty-331/" target="_blank" class="leetcode-ai-credit-link">Amartya Raj</a>
      </div>
    </div>
  `;
  document.body.appendChild(drawerContainer);

  // Close button action
  document.getElementById('leetcode-ai-close-btn').addEventListener('click', closeDrawer);

  // Tab switching click action
  const tabButtons = drawerContainer.querySelectorAll('.leetcode-ai-tab-btn');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const selectedTab = btn.getAttribute('data-tab');
      switchTab(selectedTab);
    });
  });

  // Copy code block button action (delegated at drawer level)
  drawerContainer.addEventListener('click', (e) => {
    if (e.target && e.target.classList.contains('leetcode-ai-copy-btn')) {
      const btn = e.target;
      const wrapper = btn.closest('.leetcode-ai-code-wrapper');
      if (wrapper) {
        const codeEl = wrapper.querySelector('pre code');
        if (codeEl) {
          navigator.clipboard.writeText(codeEl.textContent)
            .then(() => {
              const originalText = btn.textContent;
              btn.textContent = 'Copied!';
              btn.style.color = '#2cbb5d';
              btn.style.borderColor = '#2cbb5d';
              setTimeout(() => {
                btn.textContent = originalText;
                btn.style.color = '';
                btn.style.borderColor = '';
              }, 2000);
            })
            .catch(err => {
              console.error('Failed to copy: ', err);
            });
        }
      }
    }
  });
}

// 2. Inject a Floating Trigger Button as a fail-safe
function injectFloatingTrigger() {
  if (document.getElementById('leetcode-ai-floating-btn')) return;

  const floatingBtn = document.createElement('button');
  floatingBtn.id = 'leetcode-ai-floating-btn';
  floatingBtn.className = 'leetcode-ai-floating-trigger';
  floatingBtn.innerHTML = `
    <span>Analysis</span>
  `;
  document.body.appendChild(floatingBtn);

  floatingBtn.addEventListener('click', () => triggerAnalysis());
}

// 3. Monitor the DOM for Accepted Submissions and inject Inline Buttons
function startObserver() {
  const observer = new MutationObserver(() => {
    detectAndInjectInlineBtn();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// Check for the "Accepted" tag or container and inject the button inline
function detectAndInjectInlineBtn() {
  // Try to find common LeetCode success containers/headers:
  // - "Accepted" text or success alert
  // - elements with tag containing class text-success or text-emerald-500
  const successSelectors = [
    '.text-success', 
    '.text-emerald-500', 
    '[data-e2e-locator="submission-result"]',
    '.success__3ebe' // LeetCode legacy layout
  ];

  for (const selector of successSelectors) {
    const elements = document.querySelectorAll(selector);
    for (const el of elements) {
      if (el.textContent.includes('Accepted') || el.textContent.includes('Success')) {
        // Find parent container to inject our button next to it
        const parent = el.parentElement;
        if (parent && !parent.querySelector('.leetcode-ai-btn')) {
          const inlineBtn = document.createElement('button');
          inlineBtn.className = 'leetcode-ai-btn';
          inlineBtn.innerHTML = `
            <svg viewBox="0 0 24 24">
              <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/>
            </svg>
            <span>Analyze with AI</span>
          `;
          inlineBtn.addEventListener('click', () => triggerAnalysis());
          // Insert after or inside parent
          parent.appendChild(inlineBtn);
        }
      }
    }
  }
}

// 4. Trigger the submission analysis
async function triggerAnalysis() {
  const code = scrapeSubmittedCode() || '';
  const problemTitle = getProblemTitle();
  const language = detectLanguage();

  openDrawer();

  // If we already have a cached analysis for this exact code, load it instantly
  if (lastAnalyzedCode === code && lastAnalysisResult) {
    showCachedResult();
    return;
  }

  // Clear previous output and show loading spinner
  const contentDiv = document.getElementById('leetcode-ai-content');
  const loadingDiv = document.getElementById('leetcode-ai-loading');
  
  // Clear tab contents
  document.getElementById('leetcode-ai-tab-panel-1').innerHTML = '';
  document.getElementById('leetcode-ai-tab-panel-2').innerHTML = '';
  document.getElementById('leetcode-ai-tab-panel-3').innerHTML = '';
  
  contentDiv.classList.add('hidden');
  loadingDiv.classList.remove('hidden');

  lastAnalysisResult = '';
  lastAnalyzedCode = code;
  tabContents = { '1': '', '2': '', '3': '' };
  
  // Reset to default tab
  switchTab('1');

  // Disconnect existing streaming ports if any
  if (currentPort) {
    currentPort.disconnect();
  }

  // Establish connection to service worker
  currentPort = chrome.runtime.connect({ name: 'leetcode-analysis-stream' });

  currentPort.onMessage.addListener((msg) => {
    if (msg.type === 'chunk') {
      loadingDiv.classList.add('hidden');
      contentDiv.classList.remove('hidden');
      
      lastAnalysisResult += msg.text;
      updateDrawerContent(lastAnalysisResult);
      scrollToBottomIfNeeded();
    } else if (msg.type === 'done') {
      currentPort.disconnect();
      currentPort = null;
    } else if (msg.type === 'error') {
      showError(msg.error);
      currentPort.disconnect();
      currentPort = null;
    }
  });

  currentPort.postMessage({
    type: 'START_ANALYSIS',
    payload: { problemTitle, code, language }
  });
}

// 5. DOM Scraping Helpers
function getProblemTitle() {
  // Fallback 1: Extract from document title
  if (document.title) {
    const titleParts = document.title.split(' - LeetCode');
    if (titleParts.length > 0 && titleParts[0]) {
      return titleParts[0].trim();
    }
  }
  
  // Fallback 2: Look for title in problem description header
  const titleEl = document.querySelector('[data-cy="question-title"]') || document.querySelector('.text-title-large');
  if (titleEl) {
    return titleEl.textContent.trim();
  }

  return 'LeetCode Problem';
}

function scrapeSubmittedCode() {
  // Fallback 1: Active submission details code editor
  const detailMonaco = document.querySelector('.monaco-editor');
  if (detailMonaco) {
    const lines = detailMonaco.querySelectorAll('.view-line');
    if (lines && lines.length > 0) {
      return Array.from(lines).map(l => l.textContent).join('\n');
    }
  }
  
  // Fallback 2: LeetCode submission detail static code block container
  const codeContainers = document.querySelectorAll('pre, code');
  for (const container of codeContainers) {
    // Make sure we get something that looks like multi-line code
    const text = container.textContent.trim();
    if (text.split('\n').length > 3) {
      return text;
    }
  }

  // Fallback 3: General Monaco view lines (active editor code)
  const generalLines = document.querySelectorAll('.view-line');
  if (generalLines && generalLines.length > 0) {
    return Array.from(generalLines).map(l => l.textContent).join('\n');
  }

  return null;
}

function detectLanguage() {
  // Look for LeetCode's active editor language selector
  const langTrigger = document.querySelector('[data-e2e-locator="console-lang-select"]') || 
                      document.querySelector('.ant-select-selection-item');
  if (langTrigger) {
    const text = langTrigger.textContent.trim().toLowerCase();
    if (text) return text;
  }

  // Look for static submission language details on the page
  const badgeSelector = '.text-xs.text-label-3'; // LeetCode stats labels
  const elements = document.querySelectorAll(badgeSelector);
  for (const el of elements) {
    if (el.textContent.includes('Language')) {
      const nextEl = el.nextElementSibling;
      if (nextEl) return nextEl.textContent.trim().toLowerCase();
    }
  }

  // Fallback: look for generic class names in pre blocks (e.g. language-cpp, language-python)
  const codeEl = document.querySelector('code[class*="language-"]');
  if (codeEl) {
    const match = codeEl.className.match(/language-(\w+)/);
    if (match) return match[1];
  }

  return 'javascript'; // Default fallback
}

// 6. UI Control Helpers
function openDrawer() {
  const drawer = document.getElementById('leetcode-ai-drawer');
  if (drawer) drawer.classList.add('open');
}

function closeDrawer() {
  const drawer = document.getElementById('leetcode-ai-drawer');
  if (drawer) drawer.classList.remove('open');
  if (currentPort) {
    currentPort.disconnect();
    currentPort = null;
  }
}

function showCachedResult() {
  const contentDiv = document.getElementById('leetcode-ai-content');
  const loadingDiv = document.getElementById('leetcode-ai-loading');
  loadingDiv.classList.add('hidden');
  contentDiv.classList.remove('hidden');
  
  updateDrawerContent(lastAnalysisResult);
}

function showError(errMessage) {
  const contentDiv = document.getElementById('leetcode-ai-content');
  const loadingDiv = document.getElementById('leetcode-ai-loading');
  loadingDiv.classList.add('hidden');
  contentDiv.classList.remove('hidden');
  contentDiv.innerHTML = `
    <div class="leetcode-ai-error-box">
      <strong>Analysis Failed</strong>
      <p>${errMessage}</p>
      <p style="margin-top: 8px; font-size: 11px;">Please make sure your AI credentials are set correctly in the extension popup menu.</p>
    </div>
  `;
}

function scrollToBottomIfNeeded() {
  const body = document.getElementById('leetcode-ai-drawer-body');
  if (body) {
    const threshold = 100;
    const isNearBottom = body.scrollHeight - body.clientHeight - body.scrollTop < threshold;
    if (isNearBottom) {
      body.scrollTop = body.scrollHeight;
    }
  }
}

// Tab Support Utilities
function switchTab(tabNumber) {
  activeTab = tabNumber;
  const drawer = document.getElementById('leetcode-ai-drawer');
  if (!drawer) return;

  const buttons = drawer.querySelectorAll('.leetcode-ai-tab-btn');
  buttons.forEach(btn => {
    if (btn.getAttribute('data-tab') === tabNumber) {
      btn.classList.add('active');
      btn.classList.remove('has-new');
    } else {
      btn.classList.remove('active');
    }
  });

  const panels = drawer.querySelectorAll('.leetcode-ai-tab-panel');
  panels.forEach(panel => {
    if (panel.id === `leetcode-ai-tab-panel-${tabNumber}`) {
      panel.classList.add('active');
    } else {
      panel.classList.remove('active');
    }
  });
}

function extractComplexityStats(text) {
  let timeStr = '...';
  let spaceStr = '...';

  // Approach 1: Look for "Time Complexity" followed by an O(...) notation within 50 characters
  // E.g. "Time Complexity of O(n^2)", "Time Complexity: O(n^2)"
  const timeRegex = /Time Complexity[^\n]{0,50}?\b([Oo]\([^)]+\))/i;
  const spaceRegex = /Space Complexity[^\n]{0,50}?\b([Oo]\([^)]+\))/i;

  const timeMatch = text.match(timeRegex);
  const spaceMatch = text.match(spaceRegex);

  if (timeMatch) {
    timeStr = timeMatch[1].trim();
  } else {
    // Approach 2 Fallback: Check standard colon patterns
    const timeFallbackRegex = /(?:Time Complexity|Time)\s*(?:\*+)?\s*:?\s*(?:\*+)?\s*([Oo]\([^)]+\)|`[Oo]\([^)]+\)`)/i;
    const timeFallbackMatch = text.match(timeFallbackRegex);
    if (timeFallbackMatch) {
      timeStr = timeFallbackMatch[1].replace(/`/g, '').trim();
    }
  }

  if (spaceMatch) {
    spaceStr = spaceMatch[1].trim();
  } else {
    // Approach 2 Fallback: Check standard colon patterns
    const spaceFallbackRegex = /(?:Space Complexity|Space)\s*(?:\*+)?\s*:?\s*(?:\*+)?\s*([Oo]\([^)]+\)|`[Oo]\([^)]+\)`)/i;
    const spaceFallbackMatch = text.match(spaceFallbackRegex);
    if (spaceFallbackMatch) {
      spaceStr = spaceFallbackMatch[1].replace(/`/g, '').trim();
    }
  }

  return { timeStr, spaceStr };
}

function updateDrawerContent(text) {
  const sections = splitContentByTabs(text);
  
  tabContents['1'] = sections.tab1;
  tabContents['2'] = sections.tab2;
  tabContents['3'] = sections.tab3;

  const panel1 = document.getElementById('leetcode-ai-tab-panel-1');
  const panel2 = document.getElementById('leetcode-ai-tab-panel-2');
  const panel3 = document.getElementById('leetcode-ai-tab-panel-3');

  // Extract complexity and generate stats badges
  const stats = extractComplexityStats(sections.tab1);
  const badgesHtml = `
    <div class="leetcode-ai-complexity-badges">
      <div class="leetcode-ai-complexity-card">
        <div class="leetcode-ai-complexity-label">Time Complexity</div>
        <div class="leetcode-ai-complexity-value">${stats.timeStr}</div>
      </div>
      <div class="leetcode-ai-complexity-card">
        <div class="leetcode-ai-complexity-label">Space Complexity</div>
        <div class="leetcode-ai-complexity-value">${stats.spaceStr}</div>
      </div>
    </div>
  `;
  const html1 = badgesHtml + parseMarkdown(sections.tab1);
  const html2 = parseMarkdown(sections.tab2);
  const html3 = parseMarkdown(sections.tab3);

  if (panel1.innerHTML !== html1) {
    panel1.innerHTML = html1;
  }
  
  if (panel2.innerHTML !== html2) {
    const prevHtml = panel2.innerHTML;
    panel2.innerHTML = html2 || '<p style="color: #888; font-style: italic;">Parsing alternative variations...</p>';
    if (html2 && activeTab !== '2' && prevHtml !== panel2.innerHTML) {
      showTabNotification('2');
    }
  }

  if (panel3.innerHTML !== html3) {
    const prevHtml = panel3.innerHTML;
    panel3.innerHTML = html3 || '<p style="color: #888; font-style: italic;">Parsing steps to optimize...</p>';
    if (html3 && activeTab !== '3' && prevHtml !== panel3.innerHTML) {
      showTabNotification('3');
    }
  }
}

function showTabNotification(tabNumber) {
  const btn = document.querySelector(`.leetcode-ai-tab-btn[data-tab="${tabNumber}"]`);
  if (btn && !btn.classList.contains('active')) {
    btn.classList.add('has-new');
  }
}

function splitContentByTabs(rawText) {
  const sections = { tab1: '', tab2: '', tab3: '' };

  const header1 = "### 1. Current Code Complexity Analysis";
  const header2 = "### 2. Possible Variations (Brute, Better, Optimal)";
  const header3 = "### 3. Steps to Optimizing the Current Code";

  const idx1 = rawText.indexOf(header1);
  const idx2 = rawText.indexOf(header2);
  const idx3 = rawText.indexOf(header3);

  let start1 = idx1 !== -1 ? idx1 : 0;
  let start2 = idx2 !== -1 ? idx2 : rawText.length;
  let start3 = idx3 !== -1 ? idx3 : rawText.length;

  if (idx1 !== -1) {
    sections.tab1 = rawText.substring(start1 + header1.length, start2).trim();
  } else {
    sections.tab1 = rawText; // Stream fallback before headers form
  }

  if (idx2 !== -1) {
    sections.tab2 = rawText.substring(start2 + header2.length, start3).trim();
  }

  if (idx3 !== -1) {
    sections.tab3 = rawText.substring(start3 + header3.length).trim();
  }

  return sections;
}

// 7. Lightweight Markdown Parser (bypasses CSP & requires no external dependencies)
function parseMarkdown(md) {
  if (!md) return '';

  // Escape HTML to prevent XSS injection from AI results
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Fenced Code blocks: ```lang ... ```
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
    const displayLang = lang || 'code';
    return `
      <div class="leetcode-ai-code-wrapper">
        <div class="leetcode-ai-code-header">
          <span class="leetcode-ai-code-lang">${displayLang}</span>
          <button class="leetcode-ai-copy-btn">Copy</button>
        </div>
        <pre class="code-block"><code>${code.trim()}</code></pre>
      </div>
    `;
  });

  // Inline Code: `code`
  html = html.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');

  // Headings (H1-H6)
  html = html.replace(/^(#{1,6})\s+(.*?)$/gm, (match, hashes, title) => {
    const level = hashes.length;
    return `<h${level}>${title}</h${level}>`;
  });

  // Bold: **text**
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Lists: - item, * item, or + item
  html = html.replace(/^\s*[-*+]\s+(.*?)$/gm, '<li>$1</li>');
  
  // Wrap li clusters in ul
  html = html.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');
  html = html.replace(/<\/ul>\s*<ul>/g, ''); // Join adjacent ul lists

  // Break lines / double newlines to paragraphs
  const blocks = html.split('\n\n');
  html = blocks.map(block => {
    block = block.trim();
    if (!block) return '';
    if (block.startsWith('<h') || block.startsWith('<pre') || block.startsWith('<ul') || block.startsWith('<li')) {
      return block;
    }
    return `<p>${block}</p>`;
  }).join('');

  return html;
}
