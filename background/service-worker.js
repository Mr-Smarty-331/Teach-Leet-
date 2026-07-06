// Service Worker for LeetCode Correct Submission Analyzer

// Listen for connection tests from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TEST_CONNECTION') {
    handleTestConnection(message.config)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep channel open for async response
  }
});

// Listen for streaming analysis requests
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'leetcode-analysis-stream') {
    port.onMessage.addListener(async (msg) => {
      if (msg.type === 'START_ANALYSIS') {
        try {
          const config = await chrome.storage.local.get(['provider', 'apiKey', 'customUrl', 'model']);
          if (!config.provider) {
            port.postMessage({ type: 'error', error: 'No provider configured. Please open the extension options.' });
            return;
          }

          const provider = config.provider;
          const apiKey = config.apiKey || '';
          const customUrl = config.customUrl || '';
          const model = config.model || '';

          const systemPrompt = "You are an expert algorithm designer and code reviewer. Think carefully and answer in a highly instructive, informative, and correct way. Analyze the submitted code for the specified LeetCode problem. Focus on providing accurate Big O analysis, comparing it against alternative approaches, and detailing steps for optimization.";
          
          const userPrompt = `Please analyze the following LeetCode submission.

Problem: ${msg.payload.problemTitle}
Submitted Code:
\`\`\`${msg.payload.language || 'javascript'}
${msg.payload.code || '// (Editor is empty)'}
\`\`\`

Please format your response in clean markdown using EXACTLY these three sections:

### 1. Current Code Complexity Analysis
Provide the Time Complexity and Space Complexity of the submitted code in Big O notation, along with a clear, concise explanation of why they apply.

### 2. Possible Variations (Brute, Better, Optimal)
Detail the different approaches possible for this problem:
- **Brute Force**: Explain the brute force concept and its Big O complexity.
- **Better**: Explain intermediate approaches and their complexities.
- **Optimal**: Describe the most optimal approach and its complexity.
Clearly state and highlight which approach represents the **Most Optimal Approach**.

### 3. Steps to Optimizing the Current Code
Outline a step-by-step guideline on how to transition from the current implementation to the most optimal approach. Focus strictly on explaining the logical algorithmic steps, data structures, and methodology to optimize. Do NOT write or provide any code snippets, template code, or programming block code in this section.

Formatting Constraint:
- Do NOT use sub-bullets, nested lists (like +, *, or indentation), or nested bullet points. Every list item or bullet point must be a single, flat, self-contained list item containing all of its description inline. E.g. format as a flat list: \`- **Title**: Explanations here...\`.
- Do NOT use LaTeX mathematical formatting, delimiters (e.g. do NOT use $ or $$), or LaTeX-specific math backslash keywords/symbols (e.g. do NOT use \\log, \\cdot, \\approx, \\le, \\ge, \\times).
- Always represent all Big-O complexities and mathematical symbols in plain standard text (e.g. write "O(N^3 log K)" or "log(K)" or "O(N log N)" using clean alphanumeric characters and normal brackets).`;

          await streamAIResponse(provider, apiKey, customUrl, model, systemPrompt, userPrompt, port);
        } catch (err) {
          port.postMessage({ type: 'error', error: err.message });
        }
      }
    });
  }
});

// Helper: Test connection to AI providers
async function handleTestConnection(config) {
  const { provider, apiKey, customUrl, model } = config;
  const testPrompt = "Respond with only one word: 'Connected'.";

  if (provider === 'gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: testPrompt }] }]
      })
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error?.message || `HTTP ${response.status}`);
    }
    return { success: true };
  } 
  
  if (provider === 'openai') {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: testPrompt }],
        max_tokens: 10
      })
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error?.message || `HTTP ${response.status}`);
    }
    return { success: true };
  } 
  
  if (provider === 'groq') {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: testPrompt }],
        max_tokens: 10
      })
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error?.message || `HTTP ${response.status}`);
    }
    return { success: true };
  }
  
  if (provider === 'anthropic') {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'dangerously-allow-developer-user-agent-sharing': 'true'
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: testPrompt }],
        max_tokens: 10
      })
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error?.message || `HTTP ${response.status}`);
    }
    return { success: true };
  } 
  
  if (provider === 'custom') {
    const url = `${customUrl.replace(/\/$/, '')}/chat/completions`;
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    const response = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: testPrompt }],
        max_tokens: 10
      })
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return { success: true };
  }

  throw new Error('Unknown AI provider.');
}

// Helper: Stream response from selected AI provider
async function streamAIResponse(provider, apiKey, customUrl, model, systemPrompt, userPrompt, port) {
  if (provider === 'gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }
        ],
        generationConfig: {
          maxOutputTokens: 4096
        }
      })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error?.message || `HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      
      // Gemini streams return JSON objects inside an array block.
      // E.g., [ { ... }, { ... } ]
      // We parse the chunks by looking for valid JSON objects within the stream.
      // Often the API streams individual JSON objects separated by comma/brackets.
      // Let's extract blocks enclosed in curly braces.
      let openBraces = 0;
      let startIdx = -1;

      for (let i = 0; i < buffer.length; i++) {
        if (buffer[i] === '{') {
          if (openBraces === 0) startIdx = i;
          openBraces++;
        } else if (buffer[i] === '}') {
          openBraces--;
          if (openBraces === 0 && startIdx !== -1) {
            const jsonStr = buffer.substring(startIdx, i + 1);
            try {
              const jsonObj = JSON.parse(jsonStr);
              const text = jsonObj.candidates?.[0]?.content?.parts?.[0]?.text;
              if (text) {
                port.postMessage({ type: 'chunk', text });
              }
            } catch (e) {
              // Incomplete/nested json parse failure, wait for more data
            }
            buffer = buffer.substring(i + 1);
            i = -1; // Reset loop for new buffer
            startIdx = -1;
          }
        }
      }
    }
    
    port.postMessage({ type: 'done' });
  } 
  
  else if (provider === 'openai' || provider === 'custom' || provider === 'groq') {
    const url = provider === 'openai' 
      ? 'https://api.openai.com/v1/chat/completions'
      : provider === 'groq'
      ? 'https://api.groq.com/openai/v1/chat/completions'
      : `${customUrl.replace(/\/$/, '')}/chat/completions`;

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 4096,
        stream: true
      })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error?.message || `HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Save incomplete line in buffer

      for (const line of lines) {
        const cleaned = line.trim();
        if (!cleaned) continue;
        if (cleaned === 'data: [DONE]') continue;
        if (cleaned.startsWith('data: ')) {
          try {
            const parsed = JSON.parse(cleaned.substring(6));
            const text = parsed.choices?.[0]?.delta?.content;
            if (text) {
              port.postMessage({ type: 'chunk', text });
            }
          } catch (e) {
            // parsing error or incomplete JSON
          }
        }
      }
    }
    
    port.postMessage({ type: 'done' });
  } 
  
  else if (provider === 'anthropic') {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'dangerously-allow-developer-user-agent-sharing': 'true'
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: `${systemPrompt}\n\n${userPrompt}` }],
        max_tokens: 4000,
        stream: true
      })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error?.message || `HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      let currentEvent = '';

      for (const line of lines) {
        const cleaned = line.trim();
        if (!cleaned) continue;

        if (cleaned.startsWith('event: ')) {
          currentEvent = cleaned.substring(7);
        } else if (cleaned.startsWith('data: ')) {
          const dataStr = cleaned.substring(6);
          try {
            const parsed = JSON.parse(dataStr);
            if (currentEvent === 'content_block_delta' && parsed.delta?.text) {
              port.postMessage({ type: 'chunk', text: parsed.delta.text });
            }
          } catch (e) {
            // parse failure
          }
        }
      }
    }
    
    port.postMessage({ type: 'done' });
  } 
  
  else {
    throw new Error('Unsupported AI provider configuration.');
  }
}
