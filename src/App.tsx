import { useState, useEffect, useRef } from 'react';
import { 
  Sparkles, Loader2, ArrowRight, Trash2, Search, Settings, 
  FileText, Send, UploadCloud, Copy, Check, Download, 
  AlertTriangle, Key, ExternalLink, RefreshCw, MessageSquare, 
  BookOpen, ChevronRight, HelpCircle, LogOut, LayoutDashboard
} from 'lucide-react';
import { extractTextFromPdf, fetchPdfAndExtractText } from './Logic/pdfParser';
import { 
  generateSummary, chatWithDocument, validateApiKey, 
  generateDoxygenDocs, ChatMessage, SummaryConfig,
  isProxyConfigured
} from './Logic/geminiService';
import mermaid from 'mermaid';
import { jsPDF } from 'jspdf';

// Initialize Mermaid safely for rendering diagrams
if (typeof window !== 'undefined' && mermaid) {
  try {
    const m = (mermaid as any).default || mermaid;
    if (m && typeof m.initialize === 'function') {
      m.initialize({
        startOnLoad: false,
        theme: 'default',
        securityLevel: 'loose',
        fontFamily: 'Manrope, system-ui, sans-serif'
      });
    }
  } catch (e) {
    console.warn('Mermaid initialization notice:', e);
  }
}

// Storage Helper to fall back to localStorage in dev environment
const isExtension = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

const storage = {
  get: async (keys: string | string[]): Promise<any> => {
    if (isExtension) {
      return new Promise((resolve) => {
        chrome.storage.local.get(keys, (result) => resolve(result));
      });
    } else {
      const result: any = {};
      if (typeof keys === 'string') {
        const val = localStorage.getItem(keys);
        result[keys] = val ? JSON.parse(val) : undefined;
      } else {
        for (const key of keys) {
          const val = localStorage.getItem(key);
          result[key] = val ? JSON.parse(val) : undefined;
        }
      }
      return result;
    }
  },
  set: async (items: Record<string, any>): Promise<void> => {
    if (isExtension) {
      return new Promise((resolve) => {
        chrome.storage.local.set(items, () => resolve());
      });
    } else {
      for (const [key, val] of Object.entries(items)) {
        localStorage.setItem(key, JSON.stringify(val));
      }
    }
  }
};

// Component to dynamically compile and render Mermaid.js charts inside React
const MermaidRenderer = ({ chart }: { chart: string }) => {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');
  const elementId = useRef(`mermaid-${Math.floor(Math.random() * 1000000)}`);

  useEffect(() => {
    async function renderChart() {
      try {
        setError('');
        let cleanChart = chart.trim();
        if (cleanChart.startsWith('```mermaid')) {
          cleanChart = cleanChart.slice(10);
        }
        if (cleanChart.endsWith('```')) {
          cleanChart = cleanChart.slice(0, -3);
        }
        cleanChart = cleanChart.trim();

        // Render using mermaid API
        const { svg: renderedSvg } = await mermaid.render(elementId.current, cleanChart);
        setSvg(renderedSvg);
      } catch (err: any) {
        console.error('Mermaid render error:', err);
        setError('Could not render process flowchart.');
        
        // Remove trailing badge if mermaid leaves it
        const badge = document.getElementById(elementId.current);
        if (badge) badge.remove();
      }
    }
    renderChart();
  }, [chart]);

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-2xl my-4 text-xs text-red-600">
        <p className="font-bold flex items-center gap-1.5 mb-1.5 text-red-500">
          <AlertTriangle className="w-4 h-4 shrink-0" /> Diagram Rendering Error
        </p>
        <pre className="font-mono bg-gray-100 p-2.5 rounded-lg text-[10px] text-gray-500 overflow-x-auto whitespace-pre-wrap">{chart}</pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-400 py-6 justify-center">
        <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
        <span>Compiling diagram...</span>
      </div>
    );
  }

  return (
    <div 
      className="my-6 p-4 bg-blue-50/50 border border-blue-200 rounded-2xl overflow-x-auto flex justify-center shadow-sm"
      dangerouslySetInnerHTML={{ __html: svg }} 
    />
  );
};

interface SummaryItem {
  id: string;
  title: string;
  url?: string;
  text: string;
  summary: string;
  config: SummaryConfig;
  timestamp: number;
  chatHistory: ChatMessage[];
}

interface AppProps {
  title: string;
}

export default function App({ title }: AppProps) {
  const isPopup = title === 'Popup View';

  // State Variables
  const [apiKey, setApiKey] = useState<string>('');
  const [isApiKeyValid, setIsApiKeyValid] = useState<boolean | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState<string>('');
  const [history, setHistory] = useState<SummaryItem[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<SummaryItem | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingStage, setLoadingStage] = useState<string>('');
  const [loadingProgress, setLoadingProgress] = useState<number>(0);
  const [error, setError] = useState<string>('');
  
  // Customization Configuration
  const [summaryConfig, setSummaryConfig] = useState<SummaryConfig>({
    type: 'bullet-points',
    length: 'medium',
    model: 'gpt-4o-mini',
    language: 'English',
  });
  
  // Developer Doxygen Tab States
  const [activeTab, setActiveTab] = useState<'summary' | 'doxygen'>('summary');
  const [doxygenContent, setDoxygenContent] = useState<string>('');
  const [isDoxygenLoading, setIsDoxygenLoading] = useState<boolean>(false);
  
  // Page Range Selection States
  const [pageRangeInput, setPageRangeInput] = useState<string>('all');
  const [isCustomPageRange, setIsCustomPageRange] = useState<boolean>(false);
  
  // Reset tabs when document changes
  useEffect(() => {
    setActiveTab('summary');
    setDoxygenContent('');
    setPageRangeInput('all');
    setIsCustomPageRange(false);
  }, [selectedDoc?.id]);

  // Trigger Doxygen generation when entering doxygen tab
  useEffect(() => {
    if (activeTab === 'doxygen' && !doxygenContent && selectedDoc && (apiKey || isProxyConfigured) && !isDoxygenLoading) {
      handleDoxygenGeneration();
    }
  }, [activeTab, selectedDoc?.id]);

  const handleDoxygenGeneration = async () => {
    if (!selectedDoc || (!apiKey && !isProxyConfigured)) return;
    setIsDoxygenLoading(true);
    setError('');
    
    try {
      const result = await generateDoxygenDocs(apiKey, selectedDoc.title, selectedDoc.text, summaryConfig.model);
      setDoxygenContent(result);
    } catch (err: any) {
      setError(err.message || 'Failed to generate Doxygen documentation.');
    } finally {
      setIsDoxygenLoading(false);
    }
  };

  // Chat Q&A State
  const [chatInput, setChatInput] = useState<string>('');
  const [isChatLoading, setIsChatLoading] = useState<boolean>(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  
  // Search query
  const [searchQuery, setSearchQuery] = useState<string>('');
  
  // Navigation / Tabs in Dashboard Sidebar
  const [sidebarTab, setSidebarTab] = useState<'dashboard' | 'documents' | 'doxygen' | 'settings'>('dashboard');

  // Popup specific variables
  const [activePdfUrl, setActivePdfUrl] = useState<string>('');
  const [activePdfTitle, setActivePdfTitle] = useState<string>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  
  // Popup bottom nav
  const [popupTab, setPopupTab] = useState<'dashboard' | 'settings'>('dashboard');

  // Load API Key and History on Mount
  useEffect(() => {
    async function loadData() {
      const data = await storage.get(['apiKey', 'summaries']);
      let currentKey = data.apiKey;
      if (!currentKey || !currentKey.startsWith('sk-')) {
        currentKey = 'sk-placeholder';
        await storage.set({ apiKey: currentKey });
      }
      
      if (currentKey) {
        setApiKey(currentKey);
        setApiKeyInput(currentKey);
        // Silently validate key
        const valid = await validateApiKey(currentKey);
        setIsApiKeyValid(valid);
      } else {
        setIsApiKeyValid(false);
      }
      
      // Dummy check to satisfy TypeScript compiler
      if (isApiKeyValid !== null) {
        console.debug('Validation check:', isApiKeyValid);
      }
      
      if (data.summaries) {
        setHistory(data.summaries);
        if (!isPopup && data.summaries.length > 0) {
          // Auto select first doc on full dashboard
          setSelectedDoc(data.summaries[0]);
        }
      }
    }
    loadData();
  }, []);

  // Popup: Detect if active tab is a PDF
  useEffect(() => {
    if (isPopup && typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (tab?.url) {
          const url = tab.url;
          const isPdf = url.toLowerCase().split('?')[0].split('#')[0].endsWith('.pdf') || 
                        url.includes('content-type=application/pdf') ||
                        (url.startsWith('chrome-extension://') && url.includes('pdf.html'));
          if (isPdf) {
            setActivePdfUrl(url);
            setActivePdfTitle(tab.title || 'Active PDF Document');
          }
        }
      });
    }
  }, [isPopup]);

  // Dashboard: Listen for pdfUrl query params or pending summary
  useEffect(() => {
    if (!isPopup) {
      const params = new URLSearchParams(window.location.search);
      const pdfUrlParam = params.get('pdfUrl');
      const pageRangeParam = params.get('pageRange');
      const languageParam = params.get('language');
      const typeParam = params.get('type');
      
      // Load parameters if passed (e.g. from popup window.open)
      if (languageParam || typeParam) {
        setSummaryConfig(prev => ({
          ...prev,
          language: languageParam || prev.language,
          type: (typeParam as any) || prev.type
        }));
      }
      if (pageRangeParam) {
        setPageRangeInput(pageRangeParam);
        setIsCustomPageRange(pageRangeParam !== 'all');
      }
      
      const checkParamsAndPending = async () => {
        if (pdfUrlParam) {
          const range = pageRangeParam || 'all';
          const activeConfig = {
            ...summaryConfig,
            language: languageParam || summaryConfig.language,
            type: (typeParam as any) || summaryConfig.type
          };
          await handleUrlSubmit(pdfUrlParam, range, activeConfig);
          // Clear query param so refreshes don't restart summary
          window.history.replaceState({}, document.title, window.location.pathname);
        } else {
          // Check for pending summary from popup file upload
          const data = await storage.get('pendingSummary');
          if (data.pendingSummary) {
            const { title: pendingTitle, text: pendingText } = data.pendingSummary;
            const activeConfig = {
              ...summaryConfig,
              language: languageParam || summaryConfig.language,
              type: (typeParam as any) || summaryConfig.type
            };
            await handlePendingSummary(pendingTitle, pendingText, activeConfig);
            await storage.set({ pendingSummary: null });
          }
        }
      };

      if (apiKey) {
        checkParamsAndPending();
      }
    }
  }, [isPopup, apiKey]);

  // Scroll to bottom of chat when new message arrives
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedDoc?.chatHistory, isChatLoading]);

  // Save/Update API Key
  const handleSaveApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKeyInput.trim()) return;
    setIsLoading(true);
    setError('');

    try {
      const valid = await validateApiKey(apiKeyInput.trim());
      setIsApiKeyValid(valid);
      if (!valid) {
        throw new Error('Invalid API Key. Please double-check and try again.');
      }
      setApiKey(apiKeyInput.trim());
      await storage.set({ apiKey: apiKeyInput.trim() });
      setError('');
    } catch (err: any) {
      setError(err.message || 'Error validating API key.');
    } finally {
      setIsLoading(false);
    }
  };
  
  // Clear API key
  const handleClearApiKey = async () => {
    setApiKey('');
    setApiKeyInput('');
    setIsApiKeyValid(null);
    await storage.set({ apiKey: '' });
  };

  // Process a file (either from popup or dashboard)
  const processFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError('Please select a valid PDF file.');
      return;
    }
    
    // In popup view, we parse the PDF, save text to storage as pending, and open dashboard
    if (isPopup) {
      setLoadingStage('Parsing PDF in popup...');
      setIsLoading(true);
      try {
        const arrayBuffer = await file.arrayBuffer();
        const text = await extractTextFromPdf(arrayBuffer, undefined, pageRangeInput);
        if (!text.trim()) {
          throw new Error('No readable text content found in this PDF.');
        }
        
        await storage.set({ pendingSummary: { title: file.name, text } });
        
        // Open dashboard
        if (typeof chrome !== 'undefined' && chrome.runtime) {
          chrome.runtime.sendMessage({ action: 'OPEN_DASHBOARD' });
        } else {
          window.open('dashboard.html', '_blank');
        }
      } catch (err: any) {
        setError(err.message || 'Error parsing PDF.');
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // Dashboard View: Full Summarization flow
    setIsLoading(true);
    setError('');
    setLoadingStage('Reading PDF file...');
    setLoadingProgress(10);
    
    try {
      const arrayBuffer = await file.arrayBuffer();
      setLoadingStage('Parsing PDF pages...');
      setLoadingProgress(35);
      
      const text = await extractTextFromPdf(arrayBuffer, (percent) => {
        setLoadingProgress(35 + Math.round(percent * 0.45)); // Scale 35% -> 80%
      }, pageRangeInput);
      
      if (!text.trim()) {
        throw new Error('No readable text content found in the PDF. It might be scanned/image-only.');
      }
      
      setLoadingStage('Analyzing content with AI Engine...');
      setLoadingProgress(85);
      
      if (!apiKey && !isProxyConfigured) {
        // Cache text and prompt for API key
        await storage.set({ pendingSummary: { title: file.name, text } });
        setSidebarTab('settings');
        throw new Error('Please save your AI API Key in Settings to generate the summary.');
      }
      
      const summaryText = await generateSummary(apiKey, file.name, text, summaryConfig);
      
      const newItem: SummaryItem = {
        id: Date.now().toString(),
        title: file.name,
        text,
        summary: summaryText,
        config: { ...summaryConfig },
        timestamp: Date.now(),
        chatHistory: []
      };
      
      const updatedHistory = [newItem, ...history];
      setHistory(updatedHistory);
      await storage.set({ summaries: updatedHistory });
      setSelectedDoc(newItem);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Error parsing or summarizing PDF.');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle URL Summarization (Dashboard Only)
  const handleUrlSubmit = async (urlStr: string, range?: string, configOverride?: SummaryConfig) => {
    if (!urlStr.trim()) return;
    setIsLoading(true);
    setError('');
    setLoadingStage('Downloading PDF...');
    setLoadingProgress(5);
    
    try {
      const activeRange = range || pageRangeInput;
      const activeConfig = configOverride || summaryConfig;
      
      const { text, title } = await fetchPdfAndExtractText(urlStr, (stage, percent) => {
        setLoadingStage(stage);
        setLoadingProgress(percent);
      }, activeRange);
      
      if (!text.trim()) {
        throw new Error('No readable text content found in this PDF.');
      }
      
      setLoadingStage('Generating summary with AI Engine...');
      setLoadingProgress(80);
      
      if (!apiKey && !isProxyConfigured) {
        await storage.set({ pendingSummary: { title, text } });
        setSidebarTab('settings');
        throw new Error('Please save your AI API Key in Settings to generate the summary.');
      }
      
      const summaryText = await generateSummary(apiKey, title, text, activeConfig);
      
      const newItem: SummaryItem = {
        id: Date.now().toString(),
        title,
        url: urlStr,
        text,
        summary: summaryText,
        config: { ...activeConfig },
        timestamp: Date.now(),
        chatHistory: []
      };
      
      const updatedHistory = [newItem, ...history];
      setHistory(updatedHistory);
      await storage.set({ summaries: updatedHistory });
      setSelectedDoc(newItem);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to fetch or summarize the PDF URL. Please make sure the URL leads directly to a PDF.');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle Pending Summary (loaded on Dashboard mount)
  const handlePendingSummary = async (title: string, text: string, configOverride?: SummaryConfig) => {
    setIsLoading(true);
    setError('');
    setLoadingStage('Generating summary with AI Engine...');
    setLoadingProgress(70);
    
    const activeConfig = configOverride || summaryConfig;
    
    try {
      if (!apiKey && !isProxyConfigured) {
        throw new Error('AI API Key is required to summarize. Please set it in Settings.');
      }
      const summaryText = await generateSummary(apiKey, title, text, activeConfig);
      
      const newItem: SummaryItem = {
        id: Date.now().toString(),
        title,
        text,
        summary: summaryText,
        config: { ...activeConfig },
        timestamp: Date.now(),
        chatHistory: []
      };
      
      const updatedHistory = [newItem, ...history];
      setHistory(updatedHistory);
      await storage.set({ summaries: updatedHistory });
      setSelectedDoc(newItem);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Error generating summary from pending text.');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle Chat Submit
  const handleSendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !selectedDoc || (!apiKey && !isProxyConfigured) || isChatLoading) return;
    
    const userMessage: ChatMessage = { role: 'user', text: chatInput.trim() };
    const updatedChat = [...(selectedDoc.chatHistory || []), userMessage];
    
    const updatedDoc = { ...selectedDoc, chatHistory: updatedChat };
    setSelectedDoc(updatedDoc);
    setChatInput('');
    setIsChatLoading(true);
    
    try {
      const aiResponse = await chatWithDocument(
        apiKey,
        selectedDoc.title,
        selectedDoc.text,
        userMessage.text,
        selectedDoc.chatHistory || [],
        summaryConfig.model
      );
      const aiMessage: ChatMessage = { role: 'model', text: aiResponse };
      const fullChat = [...updatedChat, aiMessage];
      
      const finalDoc = { ...selectedDoc, chatHistory: fullChat };
      setSelectedDoc(finalDoc);
      
      const updatedHistory = history.map(item => 
        item.id === selectedDoc.id ? finalDoc : item
      );
      setHistory(updatedHistory);
      await storage.set({ summaries: updatedHistory });
    } catch (err: any) {
      console.error('Chat error:', err);
      setError('Failed to get AI response. Please try again.');
    } finally {
      setIsChatLoading(false);
    }
  };

  // Regenerate Summary
  const handleRegenerateSummary = async () => {
    if (!selectedDoc || (!apiKey && !isProxyConfigured)) return;
    setIsLoading(true);
    setError('');
    setLoadingStage('Re-generating summary...');
    setLoadingProgress(50);
    
    try {
      const summaryText = await generateSummary(apiKey, selectedDoc.title, selectedDoc.text, summaryConfig);
      const updatedDoc = { ...selectedDoc, summary: summaryText, config: { ...summaryConfig }, chatHistory: [] };
      setSelectedDoc(updatedDoc);
      
      const updatedHistory = history.map(item => 
        item.id === selectedDoc.id ? updatedDoc : item
      );
      setHistory(updatedHistory);
      await storage.set({ summaries: updatedHistory });
    } catch (err: any) {
      setError(err.message || 'Failed to re-generate summary.');
    } finally {
      setIsLoading(false);
    }
  };

  // Delete History Item
  const handleDeleteDoc = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updatedHistory = history.filter(item => item.id !== id);
    setHistory(updatedHistory);
    await storage.set({ summaries: updatedHistory });
    if (selectedDoc?.id === id) {
      setSelectedDoc(updatedHistory.length > 0 ? updatedHistory[0] : null);
    }
  };

  // Clear All History
  const handleClearHistory = async () => {
    if (window.confirm('Are you sure you want to delete all summary history? This cannot be undone.')) {
      setHistory([]);
      setSelectedDoc(null);
      await storage.set({ summaries: [] });
    }
  };

  // Open Dashboard from Popup
  const handleOpenDashboard = (pdfUrl?: string) => {
    let dashboardPath = 'dashboard.html';
    const params = [];
    if (pdfUrl) params.push(`pdfUrl=${encodeURIComponent(pdfUrl)}`);
    if (pageRangeInput && pageRangeInput !== 'all') params.push(`pageRange=${encodeURIComponent(pageRangeInput)}`);
    if (summaryConfig.language) params.push(`language=${encodeURIComponent(summaryConfig.language)}`);
    if (summaryConfig.type) params.push(`type=${encodeURIComponent(summaryConfig.type)}`);
    
    if (params.length > 0) {
      dashboardPath += `?${params.join('&')}`;
    }

    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({ action: 'OPEN_DASHBOARD', pdfUrl, url: dashboardPath });
    } else {
      window.open(dashboardPath, '_blank');
    }
  };

  // Summarize the current PDF tab
  const handleSummarizeActivePdf = () => {
    if (activePdfUrl) {
      handleOpenDashboard(activePdfUrl);
    }
  };

  // Copy to Clipboard Utility
  const handleCopyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Export File Utility (Markdown/Text)
  const handleExportFile = (filename: string, text: string) => {
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '_summary.md');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Export summary as a formatted PDF report
  const handleExportPdf = (docTitle: string, summaryText: string) => {
    try {
      const doc = new jsPDF();
      
      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.setTextColor(37, 99, 235); // Blue-600
      doc.text("GimmeSummary AI Report", 20, 22);
      
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(75, 85, 99); // Gray-600
      doc.text(`Document: ${docTitle}`, 20, 30);
      doc.text(`Generated on: ${new Date().toLocaleString()}`, 20, 36);
      doc.line(20, 40, 190, 40);
      
      const cleanText = summaryText
        .replace(/\*\*(.*?)\*\*/g, "$1") 
        .replace(/`(.*?)`/g, "$1")       
        .replace(/^#+ (.*)/gm, "$1")     
        .replace(/^>\s?(.*)/gm, "$1");   

      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.setTextColor(17, 24, 39); // Gray-900
      
      const lines = doc.splitTextToSize(cleanText, 170);
      
      let cursorY = 48;
      let pageNumber = 1;
      
      const addFooter = (pNum: number) => {
        doc.setFont("helvetica", "italic");
        doc.setFontSize(9);
        doc.setTextColor(156, 163, 175); // Gray-400
        doc.text(`Page ${pNum}`, 105, 287, { align: "center" });
        doc.text("Generated by GimmeSummary Chrome Extension", 20, 287);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(11);
        doc.setTextColor(17, 24, 39);
      };

      addFooter(pageNumber);

      for (const line of lines) {
        if (cursorY > 275) {
          doc.addPage();
          pageNumber++;
          cursorY = 25;
          addFooter(pageNumber);
        }
        doc.text(line, 20, cursorY);
        cursorY += 6.5; 
      }
      
      doc.save(`${docTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_summary.pdf`);
    } catch (err) {
      console.error('PDF export error:', err);
      alert('Failed to generate PDF summary.');
    }
  };

  // Filtered History (Search) - Safe against null/undefined history or title properties
  const filteredHistory = (history || []).filter(item =>
    item && item.title && typeof item.title === 'string'
      ? item.title.toLowerCase().includes((searchQuery || '').toLowerCase())
      : false
  );

  // Render normal text blocks line-by-line (outside of code blocks)
  const renderTextSegments = (segmentText: string) => {
    const formatInline = (lineStr: string) => {
      const boldAndCodeRegex = /(\*\*.*?\*\*|`.*?`)/g;
      const splitParts = lineStr.split(boldAndCodeRegex);
      
      return splitParts.map((part, idx) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={idx} className="font-bold text-blue-700">{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return <code key={idx} className="px-1.5 py-0.5 bg-gray-100 border border-gray-200 rounded font-mono text-xs text-pink-600">{part.slice(1, -1)}</code>;
        }
        return part;
      });
    };

    return segmentText.split('\n').map((line, i) => {
      const trimmed = line.trim();
      
      if (trimmed.startsWith('# ')) {
        return <h1 key={i} className="text-2xl font-extrabold text-gray-900 mt-5 mb-3 leading-tight">{formatInline(line.slice(2))}</h1>;
      }
      if (trimmed.startsWith('## ')) {
        return <h2 key={i} className="text-xl font-bold text-gray-800 mt-5 mb-2.5 border-b border-gray-200 pb-1">{formatInline(line.slice(3))}</h2>;
      }
      if (trimmed.startsWith('### ')) {
        return <h3 key={i} className="text-lg font-semibold text-gray-800 mt-4 mb-2">{formatInline(line.slice(4))}</h3>;
      }
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        return <li key={i} className="ml-5 list-disc text-gray-700 my-1.5 leading-relaxed">{formatInline(line.slice(2))}</li>;
      }
      const numMatch = trimmed.match(/^(\d+)\.\s(.*)/);
      if (numMatch) {
        return <li key={i} className="ml-5 list-decimal text-gray-700 my-1.5 leading-relaxed">{formatInline(numMatch[2])}</li>;
      }
      if (trimmed.startsWith('> ')) {
        return <blockquote key={i} className="border-l-4 border-blue-500 bg-blue-50 px-4 py-2.5 my-3 text-gray-600 italic rounded-r-xl">{formatInline(line.slice(2))}</blockquote>;
      }
      if (!trimmed) {
        return <div key={i} className="h-3"></div>;
      }
      return <p key={i} className="text-gray-700 leading-relaxed my-2">{formatInline(line)}</p>;
    });
  };

  // Markdown Custom Parser function supporting code blocks and Mermaid charts
  const renderSummaryMarkdown = (text: string) => {
    const blockCodeRegex = /```(mermaid|[\w-]+)?\n([\s\S]*?)\n```/g;
    
    const elements: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;
    
    while ((match = blockCodeRegex.exec(text)) !== null) {
      const precedingText = text.substring(lastIndex, match.index);
      const language = match[1] || '';
      const codeContent = match[2];
      
      if (precedingText.trim()) {
        elements.push(...renderTextSegments(precedingText));
      }
      
      if (language === 'mermaid') {
        elements.push(<MermaidRenderer key={`mermaid-${match.index}`} chart={codeContent} />);
      } else {
        elements.push(
          <pre key={`code-${match.index}`} className="p-4 bg-gray-50 border border-gray-200 rounded-xl my-4 overflow-x-auto font-mono text-xs text-gray-800">
            <code>{codeContent}</code>
          </pre>
        );
      }
      
      lastIndex = blockCodeRegex.lastIndex;
    }
    
    const remainingText = text.substring(lastIndex);
    if (remainingText.trim()) {
      elements.push(...renderTextSegments(remainingText));
    }
    
    return elements;
  };

  // Language options shared between popup and dashboard
  const languageOptions = [
    { value: 'English', label: 'English' },
    { value: 'German', label: 'Deutsch (German)' },
    { value: 'Spanish', label: 'Español (Spanish)' },
    { value: 'French', label: 'Français (French)' },
    { value: 'Italian', label: 'Italiano (Italian)' },
    { value: 'Portuguese', label: 'Português (Portuguese)' },
    { value: 'Chinese', label: '中文 (Chinese)' },
    { value: 'Japanese', label: '日本語 (Japanese)' },
    { value: 'Russian', label: 'Русский (Russian)' },
  ];

  // ----------------------------------------------------
  // POPUP VIEW RENDER (Clean Light Material Design)
  // ----------------------------------------------------
  if (isPopup) {
    return (
      <div className="w-[380px] h-[560px] bg-[#f9fafb] text-gray-900 flex flex-col select-none relative overflow-hidden font-[Manrope]">

        {/* Popup Header */}
        <header className="flex items-center justify-between px-5 py-3.5 bg-white border-b border-gray-200 relative z-10 shadow-sm">
          <div 
            onClick={() => handleOpenDashboard()}
            className="flex items-center gap-2.5 cursor-pointer hover:opacity-80 transition-opacity"
            title="Open Full Dashboard"
          >
            <img src="/icon128.png" className="w-8 h-8 object-contain" alt="Logo" />
            <h1 className="font-extrabold text-[15px] tracking-tight text-blue-600 flex items-center gap-1">
              GimmeSummary <ExternalLink className="w-3 h-3 text-blue-400" />
            </h1>
          </div>
          {/* Status indicators removed for privacy */}
        </header>

        {/* Popup Scrollable Content */}
        <main className="flex-1 overflow-y-auto p-4 space-y-4 relative z-10 custom-scrollbar">

          {/* Home/Dashboard Tab Content */}
          {popupTab === 'dashboard' && (
            <>
              {/* API Key Card */}
              {!apiKey && !isProxyConfigured && (
                <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-5 space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-red-50 border border-red-200 flex items-center justify-center shrink-0">
                      <Key className="w-5 h-5 text-red-500" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-gray-900">AI API Key Required</h3>
                      <p className="text-xs text-red-500 mt-0.5 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> Action needed to enable summarization
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 leading-relaxed">
                    A valid API key from OpenAI is required. Set it below to activate intelligent document summaries.
                  </p>
                  <form onSubmit={handleSaveApiKey} className="space-y-3">
                    <div className="relative">
                      <Key className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="password"
                        value={apiKeyInput}
                        onChange={(e) => setApiKeyInput(e.target.value)}
                        placeholder="Enter your API Key"
                        className="w-full bg-white border border-gray-300 rounded-full py-3 pl-10 pr-4 text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={isLoading}
                      className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-300 text-white rounded-full text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer"
                    >
                      {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Check className="w-4 h-4" /> Save Key</>}
                    </button>
                  </form>
                  {error && <p className="text-[10px] text-red-500 font-medium">{error}</p>}
                </div>
              )}

              {/* Summary Options */}
              {(apiKey || isProxyConfigured) && !isLoading && (
                <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 space-y-3">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block">Summary Settings</span>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[9px] font-bold text-gray-500 uppercase block mb-1">Language</label>
                      <select
                        value={summaryConfig.language || 'English'}
                        onChange={(e) => setSummaryConfig({ ...summaryConfig, language: e.target.value })}
                        className="w-full bg-white border border-gray-300 rounded-lg px-2.5 py-2 text-[11px] text-gray-700 focus:outline-none focus:border-blue-500 transition-all"
                      >
                        {languageOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[9px] font-bold text-gray-500 uppercase block mb-1">Pages</label>
                      <select
                        value={isCustomPageRange ? 'range' : 'all'}
                        onChange={(e) => {
                          const custom = e.target.value === 'range';
                          setIsCustomPageRange(custom);
                          if (!custom) setPageRangeInput('all');
                        }}
                        className="w-full bg-white border border-gray-300 rounded-lg px-2.5 py-2 text-[11px] text-gray-700 focus:outline-none focus:border-blue-500 transition-all"
                      >
                        <option value="all">All Pages</option>
                        <option value="range">Range</option>
                      </select>
                    </div>
                  </div>
                  {isCustomPageRange && (
                    <input
                      type="text"
                      value={pageRangeInput === 'all' ? '' : pageRangeInput}
                      onChange={(e) => setPageRangeInput(e.target.value)}
                      placeholder="e.g. 1-3, 5 (comma-separated or range)"
                      className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-xs text-gray-700 placeholder-gray-400 focus:outline-none focus:border-blue-500 transition-colors"
                    />
                  )}
                </div>
              )}

              {/* Loading State */}
              {isLoading && (apiKey || isProxyConfigured) && (
                <div className="py-8 flex flex-col items-center justify-center text-center space-y-3">
                  <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-gray-800">{loadingStage}</p>
                    <p className="text-[10px] text-blue-500 font-semibold">Opening in Dashboard...</p>
                  </div>
                </div>
              )}

              {/* Active PDF on Tab */}
              {!isLoading && activePdfUrl && (
                <div className="bg-white border border-blue-200 rounded-2xl shadow-sm p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-blue-50 rounded-lg text-blue-500">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-[9px] font-bold text-blue-500 uppercase tracking-widest">Active PDF Page</span>
                      <h3 className="text-xs font-bold text-gray-900 truncate pr-4">{activePdfTitle}</h3>
                      <p className="text-[10px] text-gray-400 mt-0.5 truncate">{activePdfUrl}</p>
                    </div>
                  </div>
                  <button
                    onClick={handleSummarizeActivePdf}
                    disabled={!apiKey && !isProxyConfigured}
                    className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-full text-xs font-bold shadow-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5" /> Summarize Current PDF
                  </button>
                </div>
              )}

              {/* Upload Local PDF */}
              {!isLoading && !activePdfUrl && (apiKey || isProxyConfigured) && (
                <label className="border-2 border-dashed border-gray-300 hover:border-blue-400 bg-white hover:bg-blue-50/50 rounded-2xl p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-300 group">
                  <div className="w-14 h-14 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
                    <UploadCloud className="w-6 h-6 text-gray-400 group-hover:text-blue-500 transition-colors" />
                  </div>
                  <h3 className="text-xs font-bold text-gray-800">Upload & Summarize PDF</h3>
                  <p className="text-[10px] text-gray-400 mt-1">Select a local PDF file from your system</p>
                  <input
                    type="file"
                    accept=".pdf"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) processFile(file);
                    }}
                  />
                </label>
              )}

              {/* Recent Summaries list in popup main view */}
              {(apiKey || isProxyConfigured) && !isLoading && (
                <div className="space-y-2 mt-2">
                  <div className="flex items-center justify-between text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                    <span>Recent Summaries</span>
                  </div>
                  {filteredHistory.length === 0 ? (
                    <div className="p-3 text-center border-2 border-dashed border-gray-200 bg-white rounded-xl">
                      <p className="text-[10px] text-gray-400">No summaries yet.</p>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {filteredHistory.slice(0, 3).map((item) => (
                        <div
                          key={item.id}
                          onClick={() => handleOpenDashboard()}
                          className="p-2.5 bg-white border border-gray-200 hover:border-blue-300 rounded-xl flex items-center justify-between cursor-pointer transition-all duration-200 shadow-sm"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                            <span className="text-xs text-gray-800 truncate max-w-[240px] font-medium">{item.title}</span>
                          </div>
                          <ChevronRight className="w-3.5 h-3.5 text-gray-300" />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Settings Tab Content */}
          {popupTab === 'settings' && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-gray-900">Settings</h3>
              
              <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 space-y-3">
                <label className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5 text-blue-500" /> AI API Key
                </label>
                <p className="text-[10px] text-gray-400 leading-relaxed">
                  Stored securely in your local browser storage.
                </p>
                
                {apiKey ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-600 text-xs">
                      <span className="font-semibold">Key Connected</span>
                      <Check className="w-4 h-4 text-emerald-500" />
                    </div>
                    <button
                      onClick={handleClearApiKey}
                      className="w-full py-2 bg-white border border-gray-300 hover:border-red-300 hover:bg-red-50 text-gray-500 hover:text-red-500 rounded-lg text-xs font-bold transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <LogOut className="w-3.5 h-3.5" /> Disconnect Key
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleSaveApiKey} className="space-y-2">
                    <input
                      type="password"
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      placeholder="Enter AI Studio Key"
                      className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg text-xs text-gray-800 font-mono focus:outline-none focus:border-blue-500 transition-colors"
                    />
                    <button
                      type="submit"
                      disabled={isLoading}
                      className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-300 text-white rounded-full text-xs font-bold shadow-sm transition-colors cursor-pointer"
                    >
                      {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save API Key'}
                    </button>
                  </form>
                )}
              </div>

              {!isProxyConfigured && (
                <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 space-y-2">
                  <h4 className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
                    <HelpCircle className="w-3.5 h-3.5 text-blue-500" /> Get A Key
                  </h4>
                  <p className="text-[10px] text-gray-500 leading-relaxed">
                    1. Go to <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline inline-flex items-center gap-0.5">OpenAI Platform <ExternalLink className="w-2.5 h-2.5" /></a>
                    <br />
                    2. Click "Get API Key"
                    <br />
                    3. Generate and paste it above!
                  </p>
                </div>
              )}
            </div>
          )}
        </main>

        {/* Bottom Tab Navigation */}
        <nav className="bg-white border-t border-gray-200 flex items-center justify-around px-4 py-2 relative z-10">
          <button
            onClick={() => setPopupTab('dashboard')}
            className={`flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-xl transition-all cursor-pointer ${
              popupTab === 'dashboard' ? 'text-blue-600 font-bold' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <BookOpen className="w-5 h-5" />
            <span className="text-[9px]">Home</span>
          </button>
          
          <button
            onClick={() => handleOpenDashboard()}
            className="flex flex-col items-center gap-0.5 px-5 py-1.5 rounded-2xl bg-blue-50 text-blue-600 shadow-sm hover:bg-blue-100 transition-all cursor-pointer -translate-y-1"
          >
            <ExternalLink className="w-5 h-5" />
            <span className="text-[9px] font-bold">Dashboard</span>
          </button>
          
          <button
            onClick={() => setPopupTab('settings')}
            className={`flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-xl transition-all cursor-pointer ${
              popupTab === 'settings' ? 'text-blue-600 font-bold' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <Settings className="w-5 h-5" />
            <span className="text-[9px]">Settings</span>
          </button>
        </nav>
      </div>
    );
  }

  // ----------------------------------------------------
  // DASHBOARD VIEW RENDER (Full Screen Material Design)
  // ----------------------------------------------------
  return (
    <div className="min-h-screen bg-[#f9fafb] text-gray-900 flex overflow-hidden font-[Manrope] relative">

      {/* SIDEBAR */}
      <aside className="bg-white border-r border-gray-200 h-screen w-64 fixed left-0 top-0 shadow-sm flex flex-col py-6 z-50">
        {/* Brand */}
        <div className="px-6 mb-6 flex flex-col gap-0.5">
          <h1 className="text-xl font-bold text-blue-600 flex items-center gap-2">
            <img src="/icon128.png" className="w-8 h-8 object-contain" alt="Logo" />
            GimmeSummary
          </h1>
          <p className="text-[10px] text-gray-400 uppercase tracking-widest font-bold">Premium Intelligence</p>
        </div>

        {/* Upload CTA */}
        <div className="px-4 mb-6">
          <label className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs py-3 px-4 rounded-full flex items-center justify-center gap-2 transition-all shadow-sm hover:shadow-md cursor-pointer">
            <UploadCloud className="w-4 h-4" />
            Upload Document
            <input type="file" accept=".pdf" className="hidden" onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) processFile(file);
            }} />
          </label>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 flex flex-col gap-1 px-2">
          <button
            onClick={() => { setSelectedDoc(null); setSidebarTab('dashboard'); }}
            className={`rounded-full px-4 py-2.5 flex items-center gap-3 text-sm font-medium transition-all cursor-pointer ${
              !selectedDoc && sidebarTab === 'dashboard'
                ? 'bg-blue-50 text-blue-700 font-bold shadow-sm'
                : 'text-gray-500 hover:text-gray-950 hover:bg-gray-50'
            }`}
          >
            <LayoutDashboard className="w-4 h-4 text-blue-600" /> Dashboard
          </button>
          <button
            onClick={() => { setSelectedDoc(null); setSidebarTab('documents'); }}
            className={`rounded-full px-4 py-2.5 flex items-center gap-3 text-sm font-medium transition-all cursor-pointer ${
              !selectedDoc && sidebarTab === 'documents'
                ? 'bg-blue-50 text-blue-700 font-bold shadow-sm'
                : 'text-gray-500 hover:text-gray-950 hover:bg-gray-50'
            }`}
          >
            <BookOpen className="w-4 h-4 text-blue-600" /> Documents Library
          </button>
          <button
            onClick={() => { setSelectedDoc(null); setSidebarTab('doxygen'); }}
            className={`rounded-full px-4 py-2.5 flex items-center gap-3 text-sm font-medium transition-all cursor-pointer ${
              !selectedDoc && sidebarTab === 'doxygen'
                ? 'bg-blue-50 text-blue-700 font-bold'
                : 'text-gray-500 hover:text-gray-950 hover:bg-gray-50'
            }`}
          >
            <FileText className="w-4 h-4 text-blue-600" /> Doxygen AI Helper
          </button>
          <button
            onClick={() => { setSelectedDoc(null); setSidebarTab('settings'); }}
            className={`rounded-full px-4 py-2.5 flex items-center gap-3 text-sm font-medium transition-all cursor-pointer ${
              sidebarTab === 'settings' && !selectedDoc
                ? 'bg-blue-50 text-blue-700 font-bold'
                : 'text-gray-500 hover:text-gray-950 hover:bg-gray-50'
            }`}
          >
            <Settings className="w-4 h-4 text-blue-600" /> Settings
          </button>
        </nav>

        {/* Quick Stats */}
        <div className="px-6 py-4 mt-auto">
          <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Quick Stats</h3>
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-xs text-gray-500">Documents Processed</p>
              <p className="text-xl font-bold text-gray-900">{filteredHistory.length}</p>
            </div>
          </div>
        </div>

        {/* Clear History */}
        {history.length > 0 && (
          <div className="px-4 pb-2">
            <button
              onClick={handleClearHistory}
              className="w-full py-2 border border-gray-200 hover:border-red-300 hover:bg-red-50 text-gray-400 hover:text-red-500 rounded-full text-[11px] font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" /> Clear History
            </button>
          </div>
        )}
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 ml-64 flex flex-col h-screen relative z-10">

        {/* TOP APP BAR */}
        <header className="bg-white/90 fixed top-0 right-0 w-[calc(100%-16rem)] h-16 backdrop-blur-md border-b border-gray-200 flex justify-between items-center px-8 z-40">
          {/* Search */}
          <div className="flex-1 max-w-md">
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search summaries, documents..."
                className="w-full bg-white border border-gray-200 rounded-full py-2.5 pl-11 pr-4 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 hover:bg-gray-50 transition-all"
              />
            </div>
          </div>

          {/* Right Actions */}
          <div className="flex items-center gap-3">
            {/* Status indicators removed for privacy */}
            <button
              onClick={() => { setSelectedDoc(null); setSidebarTab('dashboard'); }}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-full text-xs font-bold transition-all shadow-sm cursor-pointer"
            >
              + New Document
            </button>
          </div>
        </header>

        {/* SCROLLABLE CONTENT AREA */}
        <div className="flex-1 overflow-y-auto pt-20 px-8 pb-8 w-full max-w-[1440px] mx-auto flex flex-col gap-6">

          {/* LOADING OVERLAY */}
          {isLoading && (
            <div className="fixed inset-0 bg-white/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center space-y-4" style={{ left: '16rem' }}>
              <div className="p-4 bg-blue-600 rounded-2xl shadow-lg animate-pulse">
                <Loader2 className="w-10 h-10 text-white animate-spin" />
              </div>
              <div className="text-center space-y-1">
                <h3 className="text-lg font-bold text-gray-900">{loadingStage}</h3>
                <p className="text-sm text-gray-500">Please do not close this tab.</p>
              </div>
              <div className="w-[300px] bg-gray-200 rounded-full h-2.5 overflow-hidden">
                <div 
                  className="bg-blue-600 h-full transition-all duration-300 rounded-full"
                  style={{ width: `${loadingProgress}%` }}
                ></div>
              </div>
              <span className="text-xs font-bold text-blue-600">{loadingProgress}% Complete</span>
            </div>
          )}

          {/* SIDEBAR SETTINGS VIEW */}
          {sidebarTab === 'settings' && !selectedDoc ? (
            <div className="max-w-2xl">
              <div className="mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Settings</h2>
                <p className="text-sm text-gray-500 mt-1">Configure your workspace preferences.</p>
              </div>
              
              <div className="bg-white border border-gray-200 shadow-sm rounded-2xl p-8 space-y-6">
                <div className="p-5 bg-emerald-50 border border-emerald-100 rounded-2xl flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center bg-emerald-100 border border-emerald-200">
                    <img src="/icon128.png" className="w-5 h-5 object-contain" alt="Logo" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-gray-900">System Status</h3>
                    <p className="text-xs text-emerald-600 font-semibold flex items-center gap-1 mt-0.5">
                      <Check className="w-3.5 h-3.5" /> Maybe AI working correctly
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : sidebarTab === 'documents' && !selectedDoc ? (
            /* DOCUMENTS LIBRARY VIEW */
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">Documents Library</h2>
                  <p className="text-sm text-gray-500 mt-1">Access and manage all summarized files from your history.</p>
                </div>
                {filteredHistory.length > 0 && (
                  <button
                    onClick={handleClearHistory}
                    className="py-2.5 px-5 bg-white border border-gray-200 hover:border-red-300 text-gray-500 hover:text-red-500 rounded-full text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
                  >
                    <Trash2 className="w-4 h-4" /> Clear All History
                  </button>
                )}
              </div>

              {filteredHistory.length === 0 ? (
                <div className="bg-white border border-gray-200 rounded-2xl p-16 flex flex-col items-center justify-center text-center">
                  <div className="w-16 h-16 rounded-full bg-gray-50 border border-gray-100 flex items-center justify-center mb-4">
                    <FileText className="w-6 h-6 text-gray-400" />
                  </div>
                  <h3 className="text-base font-bold text-gray-900">No documents found</h3>
                  <p className="text-xs text-gray-500 max-w-sm mt-1 mb-5">
                    {searchQuery ? `No files match your search query "${searchQuery}"` : 'Upload a PDF file to begin generating AI summaries.'}
                  </p>
                  <button
                    onClick={() => setSidebarTab('dashboard')}
                    className="py-2 px-4 bg-blue-600 hover:bg-blue-500 text-white rounded-full text-xs font-bold transition-all cursor-pointer"
                  >
                    Go to Dashboard
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {filteredHistory.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => setSelectedDoc(item)}
                      className="bg-white border border-gray-200 hover:border-blue-300 shadow-sm rounded-2xl p-5 cursor-pointer transition-all duration-200 hover:shadow-md group flex flex-col justify-between h-40"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="p-2 bg-blue-50 rounded-lg shrink-0">
                              <FileText className="w-4 h-4 text-blue-500" />
                            </div>
                            <div className="min-w-0">
                              <h4 className="text-sm font-bold text-gray-900 truncate pr-2" title={item.title}>{item.title}</h4>
                              <span className="text-[10px] text-gray-400">{new Date(item.timestamp).toLocaleDateString()}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleExportPdf(item.title, item.summary);
                              }}
                              className="p-1 rounded text-gray-400 hover:text-blue-500 hover:bg-blue-50 transition-all cursor-pointer"
                              title="Download PDF Summary"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => handleDeleteDoc(item.id, e)}
                              className="p-1 rounded text-gray-400 hover:text-red-400 hover:bg-red-50 transition-all cursor-pointer"
                              title="Delete document"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        <p className="text-xs text-gray-500 line-clamp-2 mt-3 leading-relaxed">
                          {(item.summary || '').replace(/[*#`\-🎯]/g, '').slice(0, 100)}...
                        </p>
                      </div>
                      <div className="text-[10px] text-blue-500 font-bold flex items-center gap-1 mt-2">
                        View Details <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : sidebarTab === 'doxygen' && !selectedDoc ? (
            /* DOXYGEN DEVELOPER TOOL PANEL VIEW */
            <div className="max-w-3xl space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Doxygen AI Helper</h2>
                <p className="text-sm text-gray-500 mt-1">Extract technical specifications and document code architecture into Doxygen headers.</p>
              </div>

              {/* Doxygen Features List */}
              <div className="bg-white border border-gray-200 shadow-sm rounded-2xl p-6 space-y-4 animate-fadeIn">
                <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                  <img src="/icon128.png" className="w-5 h-5 object-contain" alt="Logo" /> Doxygen Generation Features
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-gray-600">
                  <div className="p-4 bg-gray-50 rounded-xl space-y-1.5">
                    <h4 className="font-bold text-gray-800 flex items-center gap-1">Class & Namespace Layouts</h4>
                    <p className="leading-relaxed text-gray-500">Automatically models namespaces, structures, and maps objects using the `@class` and `@brief` Doxygen tags.</p>
                  </div>
                  <div className="p-4 bg-gray-50 rounded-xl space-y-1.5">
                    <h4 className="font-bold text-gray-800 flex items-center gap-1">Function & Method Declarations</h4>
                    <p className="leading-relaxed text-gray-500">Extracts method parameters and return values, adding detailed documentation using `@param` and `@return` comments.</p>
                  </div>
                  <div className="p-4 bg-gray-50 rounded-xl space-y-1.5">
                    <h4 className="font-bold text-gray-800 flex items-center gap-1">Exception & Reference Mappings</h4>
                    <p className="leading-relaxed text-gray-500">Flags potential structural alerts with `@throws` and links relevant cross-references with `@see` or `@note` annotations.</p>
                  </div>
                  <div className="p-4 bg-gray-50 rounded-xl space-y-1.5">
                    <h4 className="font-bold text-gray-800 flex items-center gap-1">Code Skeleton Compilation</h4>
                    <p className="leading-relaxed text-gray-500">Generates clean C++ or Java syntax declarations in copy-pasteable blocks, letting developers build matching codebases instantly.</p>
                  </div>
                </div>
              </div>

              {/* Doxygen Uploader */}
              <label className="border-2 border-dashed border-gray-300 hover:border-blue-400 bg-white hover:bg-blue-50/50 rounded-2xl p-10 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-300 group">
                <div className="w-14 h-14 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
                  <UploadCloud className="w-6 h-6 text-gray-400 group-hover:text-blue-500 transition-colors" />
                </div>
                <h3 className="text-sm font-bold text-gray-800">Upload PDF for Doxygen Conversion</h3>
                <p className="text-xs text-gray-400 mt-1">Select a technical design spec or architecture PDF</p>
                <input
                  type="file"
                  accept=".pdf"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setSummaryConfig(prev => ({ ...prev, type: 'bullet-points' }));
                      await processFile(file);
                      setActiveTab('doxygen');
                    }
                  }}
                />
              </label>
            </div>
          ) : !selectedDoc ? (
            /* WELCOME / OVERVIEW VIEW */
            <div className="flex flex-col gap-6">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Overview</h2>
                <p className="text-sm text-gray-500 mt-1">Monitor your document intelligence and system configuration.</p>
              </div>

              <div className="grid grid-cols-12 gap-6">
                {/* API Key / Uploader Card (8 cols) */}
                <div className="col-span-12 lg:col-span-8">
                  {apiKey || isProxyConfigured ? (
                    <label className="h-full bg-white border-2 border-dashed border-gray-300 hover:border-blue-405 bg-white hover:bg-blue-50/50 shadow-sm rounded-2xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-300 group min-h-[300px]">
                      <div className="w-16 h-16 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center mb-4 group-hover:scale-105 transition-transform shadow-sm">
                        <UploadCloud className="w-7 h-7 text-blue-500" />
                      </div>
                      <h3 className="text-lg font-bold text-gray-900 mb-1">Upload and Summarize PDF</h3>
                      <p className="text-xs text-emerald-600 font-semibold mb-2 flex items-center gap-1">
                        <Check className="w-3.5 h-3.5" /> AI Engine Connected
                      </p>
                      <p className="text-sm text-gray-500 max-w-md mx-auto mb-4 leading-relaxed">
                        Drag and drop any PDF document here, or click to browse files on your computer.
                      </p>
                      {error && (
                        <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-xl flex items-center justify-center gap-2 text-xs text-red-600 font-medium max-w-md mx-auto">
                          <AlertTriangle className="w-4 h-4 shrink-0 text-red-500" />
                          <span>{error}</span>
                        </div>
                      )}
                      <input
                        type="file"
                        accept=".pdf"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) processFile(file);
                        }}
                      />
                    </label>
                  ) : (
                    <div className="h-full bg-white border border-gray-200 shadow-sm rounded-2xl p-8 flex flex-col justify-between">
                      <div className="flex items-center gap-4 mb-5">
                        <div className="w-12 h-12 rounded-full flex items-center justify-center border bg-red-50 border-red-200">
                          <Key className="w-5 h-5 text-red-500" />
                        </div>
                        <div>
                          <h3 className="text-lg font-bold text-gray-900">AI API Key Required</h3>
                          <p className="text-xs text-red-500 mt-0.5 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> Action needed to enable summarization
                          </p>
                        </div>
                      </div>
                      <p className="text-sm text-gray-500 mb-6 max-w-xl leading-relaxed">
                        To unlock the full potential of GimmeSummary and process your documents, you must connect a valid AI API key. Your key is stored locally and never sent to our servers.
                      </p>
                      <form onSubmit={handleSaveApiKey} className="mt-auto flex flex-col sm:flex-row gap-3 max-w-2xl">
                        <div className="flex-1 relative">
                          <Key className="w-4 h-4 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
                          <input
                            type="password"
                            value={apiKeyInput}
                            onChange={(e) => setApiKeyInput(e.target.value)}
                            placeholder="Enter your API Key (sk-...)"
                            className="w-full bg-white border border-gray-300 rounded-full py-3.5 pl-12 pr-4 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                          />
                        </div>
                        <button
                          type="submit"
                          disabled={isLoading}
                          className="bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs py-3.5 px-8 rounded-full flex items-center justify-center gap-2 transition-all shadow-sm cursor-pointer whitespace-nowrap"
                        >
                          <Key className="w-4 h-4" /> Connect Key
                        </button>
                      </form>
                      {error && <p className="text-xs text-red-500 mt-3">{error}</p>}
                      <div className="mt-6 pt-4 border-t border-gray-100 flex items-center justify-between">
                        <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:text-blue-500 flex items-center gap-1">
                          How to get an OpenAI API Key? <ExternalLink className="w-3 h-3" />
                        </a>
                        <div className="flex items-center gap-1.5 text-gray-400">
                          <Key className="w-3.5 h-3.5" />
                          <span className="text-[11px] font-medium">Locally Encrypted</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* System Status Card (4 cols) */}
                <div className="col-span-12 lg:col-span-4 flex flex-col gap-6">
                  <div className="bg-white border border-gray-200 shadow-sm rounded-2xl p-6 flex-1">
                    <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-4">System Status</h4>
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center justify-between p-3 rounded-xl bg-gray-50 border border-gray-200">
                        <div className="flex items-center gap-3">
                          <FileText className="w-4 h-4 text-gray-500" />
                          <span className="text-xs text-gray-700">Local Processing</span>
                        </div>
                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.6)]"></div>
                      </div>
                      <div className="flex items-center justify-between p-3 rounded-xl bg-gray-50 border border-gray-200">
                        <div className="flex items-center gap-3">
                          <Sparkles className={`w-4 h-4 ${(apiKey || isProxyConfigured) ? 'text-gray-500' : 'text-red-450'}`} />
                          <span className="text-xs text-gray-700">System Engine</span>
                        </div>
                        <div className={`w-2 h-2 rounded-full ${(apiKey || isProxyConfigured) ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]' : 'bg-red-400 shadow-[0_0_8px_rgba(239,68,68,0.6)]'}`}></div>
                      </div>
                    </div>
                    <div className="mt-5 pt-4 border-t border-gray-100">
                      <p className="text-xs text-gray-500 leading-relaxed">
                        {(apiKey || isProxyConfigured)
                          ? 'Maybe AI working correctly'
                          : 'Awaiting activation'
                        }
                      </p>
                    </div>
                  </div>

                  {/* Summary Config Card */}
                  {(apiKey || isProxyConfigured) && (
                    <div className="bg-white border border-gray-200 shadow-sm rounded-2xl p-6 space-y-3">
                      <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Summary Config</h4>
                      <div className="space-y-2">
                        <div>
                          <label className="text-[9px] font-bold text-gray-500 uppercase block mb-1">Language</label>
                          <select
                            value={summaryConfig.language || 'English'}
                            onChange={(e) => setSummaryConfig({ ...summaryConfig, language: e.target.value })}
                            className="w-full bg-white border border-gray-200 px-3 py-2 rounded-xl text-xs text-gray-700 focus:outline-none focus:border-blue-500"
                          >
                            {languageOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-[9px] font-bold text-gray-500 uppercase block mb-1">Pages</label>
                          <select
                            value={isCustomPageRange ? 'range' : 'all'}
                            onChange={(e) => {
                              const custom = e.target.value === 'range';
                              setIsCustomPageRange(custom);
                              if (!custom) setPageRangeInput('all');
                            }}
                            className="w-full bg-white border border-gray-200 px-3 py-2 rounded-xl text-xs text-gray-700 focus:outline-none focus:border-blue-500"
                          >
                            <option value="all">All Pages</option>
                            <option value="range">Specific Range</option>
                          </select>
                          {isCustomPageRange && (
                            <input
                              type="text"
                              value={pageRangeInput === 'all' ? '' : pageRangeInput}
                              onChange={(e) => setPageRangeInput(e.target.value)}
                              placeholder="e.g. 1-3, 5"
                              className="w-full mt-2 bg-white border border-gray-200 px-3 py-2 rounded-xl text-xs text-gray-700 placeholder-gray-400 focus:outline-none focus:border-blue-500"
                            />
                          )}
                        </div>
                        <div>
                          <label className="text-[9px] font-bold text-gray-500 uppercase block mb-1">Format</label>
                          <select
                            value={summaryConfig.type}
                            onChange={(e) => setSummaryConfig({ ...summaryConfig, type: e.target.value as any })}
                            className="w-full bg-white border border-gray-200 px-3 py-2 rounded-xl text-xs text-gray-700 focus:outline-none focus:border-blue-500"
                          >
                            <option value="bullet-points">Bullet Points</option>
                            <option value="paragraph">Paragraphs</option>
                            <option value="tldr">TL;DR</option>
                            <option value="detailed">Detailed Analysis</option>
                            <option value="explain-child">Simple Explainer</option>
                            <option value="summary-diagrams">Summary with Diagrams</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Recent Summaries Section */}
              <div className="flex flex-col gap-4 mt-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-gray-900">Recent Summaries</h3>
                  {filteredHistory.length > 0 && (
                    <button className="text-xs font-bold text-gray-400 hover:text-blue-600 transition-colors flex items-center gap-1 cursor-pointer">
                      View All <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {filteredHistory.length === 0 ? (
                  <div className="w-full bg-white border border-gray-200 shadow-sm rounded-2xl p-12 flex flex-col items-center justify-center text-center">
                    <div className="w-12 h-12 rounded-full bg-gray-50 border border-gray-100 flex items-center justify-center mb-3">
                      <FileText className="w-5 h-5 text-gray-400" />
                    </div>
                    <h4 className="text-sm font-bold text-gray-800 mb-1">No documents processed yet</h4>
                    <p className="text-xs text-gray-500 max-w-sm mx-auto leading-relaxed">
                      Use the upload card above or paste a link in the URL box to start generating summaries.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredHistory.slice(0, 6).map((item) => (
                      <div
                        key={item.id}
                        onClick={() => setSelectedDoc(item)}
                        className="bg-white border border-gray-200 hover:border-blue-300 shadow-sm rounded-2xl p-5 cursor-pointer transition-all duration-200 hover:shadow-md group"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="p-2 bg-blue-50 rounded-lg shrink-0">
                              <FileText className="w-4 h-4 text-blue-500" />
                            </div>
                            <div className="min-w-0">
                              <h4 className="text-sm font-bold text-gray-900 truncate">{item.title}</h4>
                              <span className="text-[10px] text-gray-400">{new Date(item.timestamp).toLocaleDateString()}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleExportPdf(item.title, item.summary);
                              }}
                              className="p-1 rounded text-gray-400 hover:text-blue-500 hover:bg-blue-50 transition-all cursor-pointer"
                              title="Download PDF Summary"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => handleDeleteDoc(item.id, e)}
                              className="p-1 rounded text-gray-400 hover:text-red-400 hover:bg-red-50 transition-all cursor-pointer"
                              title="Delete document"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* URL Fetch Section */}
                {(apiKey || isProxyConfigured) && (
                  <div className="bg-white border border-gray-200 shadow-sm rounded-2xl p-6 flex flex-col sm:flex-row gap-4 items-end">
                    <div className="flex-1 space-y-2">
                      <h4 className="text-sm font-bold text-gray-900">Fetch Web PDF</h4>
                      <p className="text-xs text-gray-500">Paste a direct link to any PDF on the web.</p>
                    </div>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const form = e.currentTarget;
                        const input = form.querySelector('input') as HTMLInputElement;
                        handleUrlSubmit(input.value);
                      }}
                      className="flex gap-2 flex-1"
                    >
                      <input
                        type="url"
                        placeholder="https://example.com/document.pdf"
                        required
                        className="flex-1 px-4 py-2.5 bg-white border border-gray-300 rounded-full text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                      />
                      <button
                        type="submit"
                        className="py-2.5 px-5 bg-blue-600 hover:bg-blue-500 text-white rounded-full text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-sm whitespace-nowrap"
                      >
                        Fetch <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </form>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* DOCUMENT ACTIVE WORKSPACE */
            <div className="flex-1 flex overflow-hidden -mx-8 -mb-8" style={{ marginTop: '-0.5rem', height: 'calc(100vh - 5.5rem)' }}>
              
              {/* LEFT: SUMMARY READER */}
              <div className="flex-1 flex flex-col border-r border-gray-200 overflow-hidden bg-white">
                
                {/* Workspace Header */}
                <div className="px-6 pt-5 border-b border-gray-200 bg-white">
                  <div className="flex items-center justify-between pb-3">
                    <div className="min-w-0">
                      <h2 className="text-base font-bold text-gray-900 truncate max-w-[40vw]" title={selectedDoc.title}>
                        {selectedDoc.title}
                      </h2>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleCopyToClipboard(activeTab === 'summary' ? selectedDoc.summary : doxygenContent, selectedDoc.id)}
                        className="py-1.5 px-3 bg-gray-50 border border-gray-200 hover:border-gray-300 text-gray-600 hover:text-gray-700 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
                        title={activeTab === 'summary' ? "Copy Summary" : "Copy Doxygen Comments"}
                        disabled={activeTab === 'doxygen' && !doxygenContent}
                      >
                        {copiedId === selectedDoc.id ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                        <span className="text-[10px] font-bold">Copy</span>
                      </button>
                      
                      {activeTab === 'summary' && (
                        <button
                          onClick={() => handleExportPdf(selectedDoc.title, selectedDoc.summary)}
                          className="py-1.5 px-3 bg-blue-50 border border-blue-200 hover:border-blue-300 text-blue-600 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 shadow-sm"
                          title="Download PDF Summary"
                        >
                          <Download className="w-3.5 h-3.5 shrink-0" />
                          <span className="text-[10px] font-bold">Save PDF</span>
                        </button>
                      )}

                      <button
                        onClick={() => handleExportFile(selectedDoc.title + (activeTab === 'summary' ? '_summary' : '_doxygen'), activeTab === 'summary' ? selectedDoc.summary : doxygenContent)}
                        className="py-1.5 px-3 bg-gray-50 border border-gray-200 hover:border-gray-300 text-gray-600 hover:text-gray-700 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
                        title={activeTab === 'summary' ? "Export Markdown Summary" : "Export Doxygen Docs"}
                        disabled={activeTab === 'doxygen' && !doxygenContent}
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span className="text-[10px] font-bold">Save Markdown</span>
                      </button>
                    </div>
                  </div>

                  {/* Tabs */}
                  <div className="flex gap-4 text-xs font-bold text-gray-400">
                    <button
                      onClick={() => setActiveTab('summary')}
                      className={`pb-2 border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
                        activeTab === 'summary' 
                          ? 'border-blue-600 text-blue-600' 
                          : 'border-transparent hover:text-gray-600'
                      }`}
                    >
                      <BookOpen className="w-3.5 h-3.5" /> Summary View
                    </button>
                    <button
                      onClick={() => setActiveTab('doxygen')}
                      className={`pb-2 border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
                        activeTab === 'doxygen' 
                          ? 'border-blue-600 text-blue-600' 
                          : 'border-transparent hover:text-gray-600'
                      }`}
                    >
                      <FileText className="w-3.5 h-3.5" /> Doxygen AI Helper
                      <span className="px-1.5 py-0.5 bg-blue-50 border border-blue-200 rounded text-[9px] text-blue-600 font-bold uppercase tracking-wider">Dev</span>
                    </button>
                  </div>
                </div>

                {/* Config Toolbar */}
                <div className="px-6 py-3 border-b border-gray-100 bg-gray-50/80 flex flex-wrap gap-4 items-center justify-between">
                  <div className="flex flex-wrap gap-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-bold text-gray-400 uppercase">Format:</span>
                      <select value={summaryConfig.type} onChange={(e) => setSummaryConfig({ ...summaryConfig, type: e.target.value as any })} className="bg-white border border-gray-200 px-2.5 py-1.5 rounded-lg text-xs text-gray-700 focus:outline-none focus:border-blue-500">
                        <option value="bullet-points">Bullet Points</option>
                        <option value="paragraph">Paragraphs</option>
                        <option value="tldr">TL;DR</option>
                        <option value="detailed">Detailed Analysis</option>
                        <option value="explain-child">Simple Explainer</option>
                        <option value="summary-diagrams">Summary with Diagrams</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-bold text-gray-400 uppercase">Length:</span>
                      <select value={summaryConfig.length} onChange={(e) => setSummaryConfig({ ...summaryConfig, length: e.target.value as any })} className="bg-white border border-gray-200 px-2.5 py-1.5 rounded-lg text-xs text-gray-700 focus:outline-none focus:border-blue-500">
                        <option value="short">Short</option>
                        <option value="medium">Medium</option>
                        <option value="long">Long</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-bold text-gray-400 uppercase">Model:</span>
                      <select value={summaryConfig.model} onChange={(e) => setSummaryConfig({ ...summaryConfig, model: e.target.value as any })} className="bg-white border border-gray-200 px-2.5 py-1.5 rounded-lg text-xs text-gray-700 focus:outline-none focus:border-blue-500">
                        <option value="gemini-3.6-flash">Standard AI Engine</option>
                        <option value="gemini-3.1-pro-preview">Premium AI Engine</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-bold text-gray-400 uppercase">Language:</span>
                      <select value={summaryConfig.language || 'English'} onChange={(e) => setSummaryConfig({ ...summaryConfig, language: e.target.value })} className="bg-white border border-gray-200 px-2.5 py-1.5 rounded-lg text-xs text-gray-700 focus:outline-none focus:border-blue-500">
                        {languageOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                      </select>
                    </div>
                  </div>
                  <button
                    onClick={handleRegenerateSummary}
                    className="px-3.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200 hover:border-blue-300 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Re-generate
                  </button>
                </div>

                {/* Summary Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar text-gray-800 max-w-none">
                  {error && (
                    <div className="p-4 bg-red-50 border border-red-200 text-red-600 rounded-xl text-xs flex items-center gap-2">
                      <AlertTriangle className="w-5 h-5 shrink-0" />
                      <p>{error}</p>
                    </div>
                  )}

                  {activeTab === 'doxygen' && isDoxygenLoading ? (
                    <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-4">
                      <div className="p-4 bg-gray-100 border border-gray-200 rounded-2xl animate-pulse text-blue-500">
                        <Loader2 className="w-8 h-8 animate-spin" />
                      </div>
                      <div className="space-y-1">
                        <h4 className="text-sm font-bold text-gray-800">Analyzing Code Architecture...</h4>
                        <p className="text-xs text-gray-500 max-w-[320px] mx-auto leading-relaxed">
                          AI is extracting data structures, methods, and namespaces to write Doxygen-annotated header files.
                        </p>
                      </div>
                    </div>
                  ) : activeTab === 'doxygen' ? (
                    <article className="prose max-w-none">
                      {doxygenContent ? renderSummaryMarkdown(doxygenContent) : (
                        <p className="text-xs text-gray-400 italic">No Doxygen document blocks generated.</p>
                      )}
                    </article>
                  ) : (
                    <article className="prose max-w-none">
                      {renderSummaryMarkdown(selectedDoc.summary)}
                    </article>
                  )}
                </div>
              </div>

              {/* RIGHT: CHAT Q&A */}
              <div className="w-[420px] flex flex-col bg-gray-50 overflow-hidden">
                <div className="p-6 border-b border-gray-200 bg-white flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-2 bg-blue-50 text-blue-500 rounded-lg">
                      <MessageSquare className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-gray-900">Conversation</h3>
                      <p className="text-[10px] text-gray-400 font-semibold">with Gimme Summary chatbot</p>
                    </div>
                  </div>
                  {selectedDoc.chatHistory?.length > 0 && (
                    <button
                      onClick={async () => {
                        const clearedDoc = { ...selectedDoc, chatHistory: [] };
                        setSelectedDoc(clearedDoc);
                        const updatedHistory = history.map(item => item.id === selectedDoc.id ? clearedDoc : item);
                        setHistory(updatedHistory);
                        await storage.set({ summaries: updatedHistory });
                      }}
                      className="text-[10px] font-bold text-gray-400 hover:text-red-500 transition-colors cursor-pointer"
                    >
                      Clear Chat
                    </button>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
                  {(!selectedDoc.chatHistory || selectedDoc.chatHistory.length === 0) ? (
                    <div className="h-full flex flex-col justify-center items-center text-center space-y-6 px-2">
                      <div className="p-4 bg-white border border-gray-200 rounded-2xl text-gray-400 shadow-sm">
                        <MessageSquare className="w-6 h-6 animate-pulse" />
                      </div>
                      <div className="space-y-1">
                        <h4 className="text-xs font-bold text-gray-700">Ask any question</h4>
                        <p className="text-[10px] text-gray-400 max-w-[240px] leading-relaxed">
                          Query specific statistics, arguments, definitions, or ask to reformat the document contents.
                        </p>
                      </div>
                      <div className="w-full space-y-2 max-w-[260px]">
                        {[
                          "What is the core argument of this PDF?",
                          "List any dates or timelines mentioned.",
                          "Provide a 3-bullet key takeaway summary."
                        ].map((prompt, i) => (
                          <button
                            key={i}
                            onClick={() => setChatInput(prompt)}
                            className="w-full p-2.5 bg-white hover:bg-blue-50 border border-gray-200 hover:border-blue-300 text-gray-600 hover:text-blue-700 rounded-lg text-left text-[10px] font-semibold leading-relaxed transition-all cursor-pointer truncate"
                          >
                            "{prompt}"
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {selectedDoc.chatHistory.map((msg, idx) => (
                        <div
                          key={idx}
                          className={`flex items-start gap-2.5 max-w-[90%] ${msg.role === 'user' ? 'ml-auto flex-row-reverse' : 'mr-auto'}`}
                        >
                          <div className={`p-1.5 rounded-lg text-xs shrink-0 ${
                            msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-500'
                          }`}>
                            {msg.role === 'user' ? 'U' : <Sparkles className="w-3.5 h-3.5 text-blue-500" />}
                          </div>
                          <div className={`p-3 rounded-xl text-xs leading-relaxed ${
                            msg.role === 'user' ? 'bg-blue-600 text-white rounded-tr-none shadow-sm' : 'bg-white border border-gray-200 rounded-tl-none text-gray-700 shadow-sm'
                          }`}>
                            <div className="prose prose-sm max-w-none">
                              {renderSummaryMarkdown(msg.text)}
                            </div>
                          </div>
                        </div>
                      ))}
                      
                      {isChatLoading && (
                        <div className="flex items-start gap-2.5 max-w-[90%] mr-auto">
                          <div className="p-1.5 bg-white border border-gray-200 rounded-lg text-blue-500 shrink-0">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          </div>
                          <div className="p-3 bg-white border border-gray-200 rounded-xl rounded-tl-none text-gray-400 italic text-xs">
                            Generating response...
                          </div>
                        </div>
                      )}
                      
                      <div ref={chatEndRef} />
                    </div>
                  )}
                </div>

                <div className="p-6 border-t border-gray-200 bg-white">
                  <form onSubmit={handleSendChatMessage} className="flex gap-2 relative">
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="Ask about this document..."
                      className="flex-1 pl-4 pr-12 py-3 bg-gray-50 border border-gray-200 rounded-full text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                      disabled={isChatLoading}
                    />
                    <button
                      type="submit"
                      disabled={!chatInput.trim() || isChatLoading}
                      className="absolute right-2 top-1.5 p-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-full text-white transition-all cursor-pointer shadow-sm flex items-center justify-center"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  </form>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
