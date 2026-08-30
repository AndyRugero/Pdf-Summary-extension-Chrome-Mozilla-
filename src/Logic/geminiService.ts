export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export interface SummaryConfig {
  type: 'bullet-points' | 'paragraph' | 'tldr' | 'detailed' | 'explain-child' | 'summary-diagrams';
  length: 'short' | 'medium' | 'long';
  model: 'gpt-4o-mini' | 'gpt-4o';
  language: string;
}

// Configure proxy URL (defaults to your Cloudflare Worker domain name)
export const PROXY_URL: string = "https://plain-silence-5065.andruge70.workers.dev"; 
export const isProxyConfigured = true; 

// Helper to determine the target API URL (direct OpenAI or via proxy)
const getApiUrl = (path: string): string => {
  if (isProxyConfigured && PROXY_URL) {
    const base = PROXY_URL.endsWith('/') ? PROXY_URL.slice(0, -1) : PROXY_URL;
    return `${base}${path}`;
  }
  return `https://api.openai.com${path}`;
};

/**
 * Validates the OpenAI API key by fetching available models.
 */
export async function validateApiKey(apiKey: string): Promise<boolean> {
  if (isProxyConfigured) return true; // Bypass key checks when proxy is active
  if (!apiKey.trim()) return false;
  if (!apiKey.startsWith('sk-')) return false; // Must be a valid OpenAI key format
  
  try {
    const response = await fetch(getApiUrl('/v1/models'), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });
    
    return response.ok;
  } catch (error) {
    console.error('OpenAI API key validation error:', error);
    return false;
  }
}

/**
 * Generates a summary for the given document text using OpenAI Chat Completions.
 */
export async function generateSummary(
  apiKey: string,
  docTitle: string,
  docText: string,
  config: SummaryConfig
): Promise<string> {
  let model = config.model || 'gpt-4o-mini';
  if (!model.startsWith('gpt-')) {
    model = 'gpt-4o-mini';
  }

  let instructions = '';
  switch (config.type) {
    case 'bullet-points':
      instructions = 'Extract the key points of this document as structured bullet points. Organize them with clear, bold headers.';
      break;
    case 'paragraph':
      instructions = 'Provide a cohesive, well-written narrative summary in standard paragraphs.';
      break;
    case 'tldr':
      instructions = 'Provide a very short TL;DR summary (1-3 sentences) followed by exactly 3 bulleted key takeaways.';
      break;
    case 'detailed':
      instructions = 'Provide a comprehensive, detailed executive summary. Break it down by analyzing all major sections, arguments, methodologies, and conclusions.';
      break;
    case 'explain-child':
      instructions = 'Explain the content of this document in extremely simple terms, with analogies, as if you are explaining it to a 10-year-old child.';
      break;
    case 'summary-diagrams':
      instructions = 'Provide a structured summary of the document. Most importantly, identify any key cycles, procedures, timelines, workflows, or system architectures described in the text, and map them out visually. Generate a detailed flowchart representing this cycle/flow using Mermaid.js syntax inside a ```mermaid ... ``` code block. Keep node names short and readable, and ensure the syntax is valid.';
      break;
  }
  
  switch (config.length) {
    case 'short':
      instructions += ' Keep the summary brief, concise, and focused only on the absolute essentials.';
      break;
    case 'medium':
      instructions += ' Provide a balanced, moderately detailed summary.';
      break;
    case 'long':
      instructions += ' Provide an in-depth and thorough explanation, capturing all key details, data, and context.';
      break;
  }

  const targetLanguage = config.language || 'English';
  const lernzielTitle = targetLanguage.toLowerCase() === 'german' ? '🎯 Lernziele' : '🎯 Learning Objectives';
  
  const prompt = `You are an expert document summarizer. Summarize the document titled "${docTitle}".
Below is the instruction for how to summarize:
${instructions}

IMPORTANT: Write the summary entirely in ${targetLanguage}.

In addition to your summary, ALWAYS include a dedicated section at the beginning of the summary titled "## ${lernzielTitle}". In this section, extract 3-5 core learning goals or takeaways that a reader should understand after reading this document, formatted as a neat bulleted list.

Write the summary using clean, readable Markdown syntax. Use bold text, bullet points, headers, and tables where appropriate to maximize readability.

Here is the document content:
---
${docText}
---`;

  try {
    const response = await fetch(getApiUrl('/v1/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const errMsg = errData.error?.message || `HTTP error ${response.status}`;
      throw new Error(`OpenAI API Error: ${errMsg}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || 'No response generated.';
  } catch (err: any) {
    console.error('OpenAI Summary error:', err);
    throw err;
  }
}

/**
 * Conducts a chat Q&A session relative to the document text.
 */
export async function chatWithDocument(
  apiKey: string,
  docTitle: string,
  docText: string,
  question: string,
  history: any[],
  model: 'gpt-4o-mini' | 'gpt-4o' = 'gpt-4o-mini'
): Promise<string> {
  const systemInstruction = `You are an interactive AI assistant helping a user query a document they uploaded.
The document is titled: "${docTitle}".

Use the document text below to accurately and concisely answer the user's questions. 
If the answer cannot be found or inferred from the document text, clarify that, but still try to be helpful based on general knowledge if appropriate, while clearly drawing the distinction.

Use Markdown for formatting.

Here is the document text:
---
${docText}
---`;

  const messages: any[] = [
    { role: 'system', content: systemInstruction }
  ];
  
  for (const msg of history) {
    messages.push({
      role: msg.role === 'model' || msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.text || msg.content || ''
    });
  }
  
  messages.push({
    role: 'user',
    content: question
  });

  try {
    const response = await fetch(getApiUrl('/v1/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        temperature: 0.3
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const errMsg = errData.error?.message || `HTTP error ${response.status}`;
      throw new Error(`OpenAI API Error: ${errMsg}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || 'No response generated.';
  } catch (err: any) {
    console.error('OpenAI Chat error:', err);
    throw err;
  }
}

/**
 * Generates class header declarations with full Doxygen documentation comments.
 */
export async function generateDoxygenDocs(
  apiKey: string,
  docTitle: string,
  docText: string,
  model: 'gpt-4o-mini' | 'gpt-4o' = 'gpt-4o-mini'
): Promise<string> {
  const prompt = `You are an expert software documentation engineer. Analyze the technical aspects of the document titled "${docTitle}".
Extract all key classes, namespaces, modules, functions, parameters, or data structures discussed in this document.
Generate complete, syntactically clean header declarations (in C++ or Java syntax as appropriate) complete with Doxygen documentation comments for all modules.
Use proper Doxygen annotations:
- @class to document a class
- @brief for a short description
- @param for method parameters
- @return for return values
- @throws or @exception for exceptions
- @see or @note for additional references

Form the response as copy-pasteable Markdown code blocks. Do not add general conversational text, just output the C++/Java header file declarations with their complete Doxygen comment blocks.

Here is the document content:
---
${docText}
---`;

  try {
    const response = await fetch(getApiUrl('/v1/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const errMsg = errData.error?.message || `HTTP error ${response.status}`;
      throw new Error(`OpenAI API Error: ${errMsg}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || 'No response generated.';
  } catch (err: any) {
    console.error('OpenAI Doxygen error:', err);
    throw err;
  }
}
