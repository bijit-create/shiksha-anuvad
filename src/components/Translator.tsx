import React, { useState } from 'react';
import { 
  Languages, 
  BookOpen, 
  GraduationCap, 
  FileText, 
  Send, 
  Copy, 
  Check, 
  RotateCcw,
  Loader2,
  AlertCircle,
  Sparkles,
  Lightbulb,
  BrainCircuit,
  ListChecks,
  FileSpreadsheet,
  Upload,
  Sigma,
  ChevronDown,
  Info
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import * as XLSX from 'xlsx';
import { GradeLevel, Subject, TranslationRequest, ContentAnalysis } from '../types';
import { translateContent, analyzeContent } from '../services/geminiService';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// remark-math understands $...$ and $$...$$ natively. Our server emits
// math wrapped in \( ... \) and \[ ... \] (preserved for copy/export),
// so we swap the delimiters only when handing off to ReactMarkdown.
function prepareMathForRender(text: string): string {
  if (!text) return text;
  return text
    .replace(/\\\[([\s\S]+?)\\\]/g, (_m, body) => `$$${body}$$`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_m, body) => `$${body}$`);
}

const GRADES: GradeLevel[] = [
  'KG', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 
  'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 
  'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'
];

const SUBJECTS: Subject[] = [
  'Mathematics', 'Science', 'Social Science', 'English', 
  'Environmental Studies', 'Physics', 'Chemistry', 'Biology', 
  'History', 'Geography', 'Economics', 'Political Science'
];

const CONTENT_TYPES = ['Question', 'Paragraph', 'MCQ', 'Statement'] as const;

export default function Translator() {
  const [input, setInput] = useState('');
  const [grade, setGrade] = useState<GradeLevel>('Grade 6');
  const [subject, setSubject] = useState<Subject>('Science');
  const [contentType, setContentType] = useState<typeof CONTENT_TYPES[number]>('Paragraph');
  
  const [output, setOutput] = useState('');
  const [explanation, setExplanation] = useState('');
  const [analysis, setAnalysis] = useState<ContentAnalysis | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Excel Mode States
  const [mode, setMode] = useState<'text' | 'excel'>('text');
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [excelFileBuffer, setExcelFileBuffer] = useState<ArrayBuffer | null>(null);
  const [headerRowIndex, setHeaderRowIndex] = useState<number>(1);
  const [startRowIndex, setStartRowIndex] = useState<number>(2);
  const [endRowIndex, setEndRowIndex] = useState<number>(2);
  const [dataRowCount, setDataRowCount] = useState<number>(0);
  const [excelColumns, setExcelColumns] = useState<string[]>([]);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [excelProgress, setExcelProgress] = useState<{ current: number, total: number } | null>(null);
  const [isExcelTranslating, setIsExcelTranslating] = useState(false);

  // LaTeX Formatting Guide
  const [showLatexGuide, setShowLatexGuide] = useState(false);

  const handleTranslate = async () => {
    if (!input.trim()) return;
    
    setIsLoading(true);
    setError(null);
    try {
      const result = await translateContent({
        content: input,
        grade,
        subject,
        contentType
      });
      setOutput(result.translatedText);
      setExplanation(result.explanation || '');
      
      // Automatically trigger analysis for longer content
      if (input.length > 50) {
        handleAnalyze();
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAnalyze = async () => {
    if (!input.trim()) return;
    setIsAnalyzing(true);
    try {
      const result = await analyzeContent({
        content: input,
        grade,
        subject,
        contentType
      });
      setAnalysis(result);
    } catch (err) {
      console.error(err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const reset = () => {
    setInput('');
    setOutput('');
    setExplanation('');
    setAnalysis(null);
    setError(null);
  };

  const parseExcel = (buffer: ArrayBuffer, headerRow: number) => {
    try {
      const data = new Uint8Array(buffer);
      const wb = XLSX.read(data, { type: 'array' });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      
      const aoa = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: "" });
      
      const headers = (aoa[headerRow - 1] || []).map(String).filter(Boolean);
      setExcelColumns(headers);
      
      const dataRows = aoa.slice(headerRow).filter(row => row.length > 0);
      setDataRowCount(dataRows.length);
      setStartRowIndex(headerRow + 1);
      setEndRowIndex(aoa.length);
      setSelectedColumns([]);
    } catch (err) {
      console.error("Error parsing Excel:", err);
      setError("Failed to parse Excel file. Please ensure it's a valid .xlsx or .xls file.");
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setExcelFile(file);
    setHeaderRowIndex(1);
    
    const reader = new FileReader();
    reader.onload = (evt) => {
      const buffer = evt.target?.result as ArrayBuffer;
      setExcelFileBuffer(buffer);
      parseExcel(buffer, 1);
    };
    reader.readAsArrayBuffer(file);
  };

  const handleHeaderRowChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    if (isNaN(val) || val < 1) return;
    setHeaderRowIndex(val);
    if (excelFileBuffer) {
      parseExcel(excelFileBuffer, val);
    }
  };

  const toggleColumn = (col: string) => {
    setSelectedColumns(prev => 
      prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]
    );
  };

  const handleExcelTranslate = async () => {
    if (!excelFileBuffer || selectedColumns.length === 0) return;
    
    setIsExcelTranslating(true);
    setError(null);
    
    try {
      const data = new Uint8Array(excelFileBuffer);
      const wb = XLSX.read(data, { type: 'array' });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      
      const aoa = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: "" });
      const headerRowIdx = headerRowIndex - 1;
      const originalHeaders = [...(aoa[headerRowIdx] || [])];
      
      const translateIndices = selectedColumns
        .map(col => originalHeaders.indexOf(col))
        .filter(idx => idx !== -1)
        .sort((a, b) => a - b);
        
      const startIdx = Math.max(headerRowIdx + 1, startRowIndex - 1);
      const endIdx = Math.min(endRowIndex, aoa.length);
      const rowsToTranslate = endIdx - startIdx;
      setExcelProgress({ current: 0, total: rowsToTranslate });
      
      let currentProgress = 0;
      
      for (let r = 0; r < aoa.length; r++) {
        if (r === headerRowIdx) {
          // Header row
          for (let i = translateIndices.length - 1; i >= 0; i--) {
            const origIdx = translateIndices[i];
            aoa[r].splice(origIdx + 1, 0, `${originalHeaders[origIdx]} (Hindi)`);
          }
          continue;
        }
        
        const row = aoa[r] || [];
        
        // If this is a row we need to translate
        if (r >= startIdx && r < endIdx) {
          // Build row context object from original row BEFORE splicing
          const rowContextObj: Record<string, any> = {};
          for (let c = 0; c < originalHeaders.length; c++) {
            if (row[c] !== undefined && row[c] !== "") {
              rowContextObj[originalHeaders[c]] = row[c];
            }
          }
          const rowContextStr = JSON.stringify(rowContextObj);
          
          // Splice empty cells for new columns
          for (let i = translateIndices.length - 1; i >= 0; i--) {
            const origIdx = translateIndices[i];
            row.splice(origIdx + 1, 0, ""); 
          }
          
          // Translate
          for (let i = 0; i < translateIndices.length; i++) {
            const origIdx = translateIndices[i];
            const currentOrigIdx = origIdx + i;
            const targetIdx = currentOrigIdx + 1;
            
            const content = row[currentOrigIdx];
            const columnName = originalHeaders[origIdx];

            if (content && typeof content === 'string' && content.trim()) {
              try {
                const result = await translateContent({
                  content,
                  grade,
                  subject,
                  contentType: columnName,
                  additionalContext: rowContextStr
                });
                row[targetIdx] = result.translatedText;
                // Add a small delay between requests to help avoid rate limits
                await new Promise(resolve => setTimeout(resolve, 1500));
              } catch (err) {
                console.error(`Error translating row ${r}, col ${currentOrigIdx}:`, err);
                row[targetIdx] = "Translation Error";
              }
            }
          }
          
          currentProgress++;
          setExcelProgress({ current: currentProgress, total: rowsToTranslate });
        } else {
          // Not translating this row, just splice empty cells to maintain alignment
          for (let i = translateIndices.length - 1; i >= 0; i--) {
            const origIdx = translateIndices[i];
            row.splice(origIdx + 1, 0, ""); 
          }
        }
        
        aoa[r] = row;
      }
      
      const newWs = XLSX.utils.aoa_to_sheet(aoa);
      const newWb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(newWb, newWs, "Translated");
      XLSX.writeFile(newWb, `Translated_${excelFile?.name || 'document.xlsx'}`);
      
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred during Excel translation');
    } finally {
      setIsExcelTranslating(false);
      setExcelProgress(null);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-8">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-200 pb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 flex items-center gap-3">
            <Languages className="w-8 h-8 text-indigo-600" />
            Shiksha Anuvad
          </h1>
          <p className="text-zinc-500 mt-1">Contextual NCERT-aligned English to Hindi Translator</p>
        </div>
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-zinc-400">
          <span className="px-2 py-1 bg-zinc-100 rounded">v1.0</span>
          <span className="px-2 py-1 bg-indigo-50 text-indigo-600 rounded">AI Powered</span>
        </div>
      </header>

      {/* Controls */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-white p-4 rounded-2xl shadow-sm border border-zinc-100">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-zinc-500 flex items-center gap-2">
            <GraduationCap className="w-3.5 h-3.5" /> GRADE LEVEL
          </label>
          <select 
            value={grade}
            onChange={(e) => setGrade(e.target.value as GradeLevel)}
            className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
          >
            {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-zinc-500 flex items-center gap-2">
            <BookOpen className="w-3.5 h-3.5" /> SUBJECT
          </label>
          <select 
            value={subject}
            onChange={(e) => setSubject(e.target.value as Subject)}
            className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
          >
            {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-zinc-500 flex items-center gap-2">
            <FileText className="w-3.5 h-3.5" /> CONTENT TYPE
          </label>
          <select 
            value={contentType}
            onChange={(e) => setContentType(e.target.value as any)}
            className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
          >
            {CONTENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      {/* Mode Toggle */}
      <div className="flex justify-center gap-4">
        <button 
          onClick={() => setMode('text')}
          className={cn("px-6 py-2.5 rounded-xl font-semibold text-sm transition-all flex items-center gap-2", mode === 'text' ? "bg-indigo-600 text-white shadow-md shadow-indigo-200" : "bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-50")}
        >
          <FileText className="w-4 h-4" />
          Text Translation
        </button>
        <button 
          onClick={() => setMode('excel')}
          className={cn("px-6 py-2.5 rounded-xl font-semibold text-sm transition-all flex items-center gap-2", mode === 'excel' ? "bg-indigo-600 text-white shadow-md shadow-indigo-200" : "bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-50")}
        >
          <FileSpreadsheet className="w-4 h-4" />
          Excel Upload
        </button>
      </div>

      {/* Translation Area */}
      {mode === 'text' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Input */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-zinc-700 uppercase tracking-wide">English Content</h2>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowLatexGuide(v => !v)}
                className="text-zinc-500 hover:text-indigo-600 transition-colors flex items-center gap-1 text-xs font-bold uppercase tracking-wider"
                title="How to format math with LaTeX"
                aria-expanded={showLatexGuide}
              >
                <Sigma className="w-3.5 h-3.5" />
                Math Format
                <ChevronDown className={cn("w-3 h-3 transition-transform", showLatexGuide && "rotate-180")} />
              </button>
               <button
                onClick={handleAnalyze}
                disabled={isAnalyzing || !input.trim()}
                className="text-indigo-600 hover:text-indigo-700 disabled:text-zinc-300 transition-colors flex items-center gap-1 text-xs font-bold uppercase tracking-wider"
                title="Smart Analysis"
              >
                {isAnalyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                Analyze
              </button>
              <button
                onClick={reset}
                className="text-zinc-400 hover:text-zinc-600 transition-colors"
                title="Clear all"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
          </div>

          {showLatexGuide && (
            <div className="bg-indigo-50/60 border border-indigo-100 rounded-2xl p-5 space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-white rounded-lg shadow-sm shrink-0">
                  <Info className="w-4 h-4 text-indigo-600" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-indigo-900">LaTeX Math Formatting Guide</h3>
                  <p className="text-xs text-indigo-800/80 leading-relaxed">
                    Every math expression in the Hindi output is wrapped in{' '}
                    <code className="px-1.5 py-0.5 bg-white border border-indigo-200 rounded text-[11px] font-mono text-indigo-700">{'\\( expression \\)'}</code>{' '}
                    inline delimiters. The preview below renders it as typeset math, and the <strong>Copy</strong> button gives you the raw LaTeX source — safe to paste into any NCERT/Markdown/LaTeX pipeline.
                  </p>
                </div>
              </div>

              <div>
                <h4 className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider mb-2">Output Source (what Copy gives you)</h4>
                <div className="bg-white border border-indigo-200 rounded-lg p-3 font-mono text-xs text-zinc-800 break-words">
                  {'रिक्त स्थानों की पूर्ति कीजिए: व्यंजक \\(343b^{3} - 588b^{2} + 336b - 64\\) का गुणनखंडन...'}
                </div>
              </div>

              <div>
                <h4 className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider mb-2">Rendered Preview</h4>
                <div className="bg-white border border-indigo-200 rounded-lg p-3 text-sm text-zinc-800 break-words font-hindi markdown-body">
                  <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                    {prepareMathForRender('रिक्त स्थानों की पूर्ति कीजिए: व्यंजक \\(343b^{3} - 588b^{2} + 336b - 64\\) का गुणनखंडन...')}
                  </ReactMarkdown>
                </div>
              </div>

              <div>
                <h4 className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider mb-2">Common LaTeX Notations</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[
                    { label: 'Fraction', code: '\\frac{a}{b}', render: 'a/b' },
                    { label: 'Square root', code: '\\sqrt{x}', render: '√x' },
                    { label: 'Nth root', code: '\\sqrt[n]{x}', render: 'ⁿ√x' },
                    { label: 'Power / Exponent', code: 'x^{2}', render: 'x²' },
                    { label: 'Subscript', code: 'x_{i}', render: 'xᵢ' },
                    { label: 'Multiply', code: 'a \\times b', render: 'a × b' },
                    { label: 'Divide', code: 'a \\div b', render: 'a ÷ b' },
                    { label: 'Not equal / Approx', code: 'a \\neq b,\\ a \\approx b', render: '≠, ≈' },
                    { label: 'Less / Greater equal', code: 'a \\leq b,\\ a \\geq b', render: '≤, ≥' },
                    { label: 'Greek letters', code: '\\pi,\\ \\theta,\\ \\alpha', render: 'π, θ, α' },
                    { label: 'Summation', code: '\\sum_{i=1}^{n} x_i', render: '∑ xᵢ' },
                    { label: 'Integral', code: '\\int_{0}^{1} f(x)\\,dx', render: '∫ f(x) dx' },
                    { label: 'Infinity', code: '\\infty', render: '∞' },
                    { label: 'Units (text in math)', code: '5\\,\\text{cm}', render: '5 cm' },
                  ].map(({ label, code, render }) => (
                    <div key={label} className="flex items-center justify-between gap-3 bg-white border border-indigo-100 rounded-lg px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">{label}</div>
                        <code className="text-[11px] font-mono text-indigo-700 break-all">{code}</code>
                      </div>
                      <span className="text-xs text-zinc-600 shrink-0 font-medium">{render}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-start gap-2 text-[11px] text-indigo-800/80 leading-relaxed border-t border-indigo-100 pt-3">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-indigo-600" />
                <span>
                  Rendered output uses KaTeX. Copy output preserves the <code className="px-1 py-0.5 bg-white border border-indigo-200 rounded font-mono text-indigo-700">{'\\( ... \\)'}</code> delimiters, so any NCERT / Markdown / LaTeX pipeline downstream re-renders the math correctly.
                </span>
              </div>
            </div>
          )}

          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste your educational content here (questions, paragraphs, etc.)..."
            className="w-full h-[400px] bg-white border border-zinc-200 rounded-2xl p-6 text-zinc-800 placeholder:text-zinc-300 focus:ring-2 focus:ring-indigo-500 outline-none transition-all resize-none shadow-sm"
          />
          <button
            onClick={handleTranslate}
            disabled={isLoading || !input.trim()}
            className={cn(
              "w-full py-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-indigo-200/50",
              isLoading || !input.trim() 
                ? "bg-zinc-100 text-zinc-400 cursor-not-allowed" 
                : "bg-indigo-600 text-white hover:bg-indigo-700 active:scale-[0.98]"
            )}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Translating...
              </>
            ) : (
              <>
                <Send className="w-5 h-5" />
                Translate to Hindi
              </>
            )}
          </button>
        </div>

        {/* Output */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-zinc-700 uppercase tracking-wide">Hindi Translation</h2>
            {output && (
              <button 
                onClick={copyToClipboard}
                className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700 transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied!' : 'Copy'}
              </button>
            )}
          </div>
          
          <div className={cn(
            "w-full h-[400px] bg-white border border-zinc-200 rounded-2xl p-6 overflow-y-auto shadow-sm relative",
            !output && !isLoading && "flex items-center justify-center text-zinc-300 italic"
          )}>
            {isLoading ? (
              <div className="flex flex-col items-center justify-center h-full space-y-4 text-zinc-400">
                <Loader2 className="w-10 h-10 animate-spin text-indigo-500" />
                <p className="text-sm font-medium animate-pulse">Crafting contextual translation...</p>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center h-full space-y-3 text-red-500 text-center p-4">
                <AlertCircle className="w-10 h-10" />
                <p className="text-sm font-medium">{error}</p>
                <button 
                  onClick={handleTranslate}
                  className="text-xs font-bold underline uppercase tracking-wider"
                >
                  Try Again
                </button>
              </div>
            ) : output ? (
              <div className="markdown-body font-hindi text-lg">
                <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                  {prepareMathForRender(output)}
                </ReactMarkdown>
              </div>
            ) : (
              "Translated content will appear here..."
            )}
          </div>

          {/* Explanation / Insights */}
          {explanation && !isLoading && (
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 space-y-2">
              <h3 className="text-xs font-bold text-amber-700 uppercase tracking-wider flex items-center gap-2">
                <AlertCircle className="w-3.5 h-3.5" /> Translation Insights
              </h3>
              <p className="text-sm text-amber-800 leading-relaxed italic">
                {explanation}
              </p>
            </div>
          )}
        </div>
      </div>
      ) : (
        <div className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-zinc-100 space-y-8 max-w-3xl mx-auto">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-zinc-700 uppercase tracking-wide flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-indigo-600" />
              Batch Excel Translation
            </h2>
          </div>
          
          {!excelFile ? (
            <div className="border-2 border-dashed border-zinc-300 rounded-2xl p-12 flex flex-col items-center justify-center text-center hover:bg-zinc-50 hover:border-indigo-300 transition-colors cursor-pointer relative group">
              <input 
                type="file" 
                accept=".xlsx, .xls" 
                onChange={handleFileUpload} 
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <Upload className="w-8 h-8 text-indigo-600" />
              </div>
              <p className="text-base font-bold text-zinc-800">Click or drag Excel file to upload</p>
              <p className="text-sm text-zinc-500 mt-2">Supports .xlsx and .xls formats</p>
            </div>
          ) : (
            <div className="space-y-8">
              <div className="flex items-center justify-between p-4 bg-zinc-50 rounded-xl border border-zinc-200">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-white rounded-lg shadow-sm">
                    <FileSpreadsheet className="w-6 h-6 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-zinc-800">{excelFile.name}</p>
                    <p className="text-xs font-medium text-zinc-500 mt-0.5">{dataRowCount} rows detected</p>
                  </div>
                </div>
                <button 
                  onClick={() => {
                    setExcelFile(null);
                    setExcelFileBuffer(null);
                    setHeaderRowIndex(1);
                    setDataRowCount(0);
                    setExcelColumns([]);
                    setSelectedColumns([]);
                    setExcelProgress(null);
                    setError(null);
                  }}
                  className="text-xs font-bold text-red-600 hover:text-red-700 uppercase tracking-wider px-3 py-1.5 hover:bg-red-50 rounded-lg transition-colors"
                >
                  Remove
                </button>
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-bold text-zinc-700 uppercase tracking-wide">Row Configuration</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-zinc-50 p-4 rounded-xl border border-zinc-200">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-zinc-700">Header Row</label>
                    <input 
                      type="number" 
                      min="1" 
                      value={headerRowIndex}
                      onChange={handleHeaderRowChange}
                      className="w-full bg-white border border-zinc-300 rounded-lg px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-zinc-700">Start Row</label>
                    <input 
                      type="number" 
                      min={headerRowIndex + 1} 
                      value={startRowIndex}
                      onChange={(e) => setStartRowIndex(parseInt(e.target.value) || headerRowIndex + 1)}
                      className="w-full bg-white border border-zinc-300 rounded-lg px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-zinc-700">End Row</label>
                    <input 
                      type="number" 
                      min={startRowIndex} 
                      value={endRowIndex}
                      onChange={(e) => setEndRowIndex(parseInt(e.target.value) || startRowIndex)}
                      className="w-full bg-white border border-zinc-300 rounded-lg px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                  </div>
                </div>
              </div>

              {error && (
                <div className="p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3 text-red-600">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                  <p className="text-sm font-medium">{error}</p>
                </div>
              )}

              {excelColumns.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-zinc-700 uppercase tracking-wide">Select Columns to Translate</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {excelColumns.map(col => (
                      <label key={col} className={cn(
                        "flex items-center gap-3 p-3 border rounded-xl cursor-pointer transition-all",
                        selectedColumns.includes(col) 
                          ? "border-indigo-600 bg-indigo-50/50" 
                          : "border-zinc-200 hover:bg-zinc-50 hover:border-zinc-300"
                      )}>
                        <input 
                          type="checkbox" 
                          checked={selectedColumns.includes(col)}
                          onChange={() => toggleColumn(col)}
                          className="w-4 h-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="text-sm font-medium text-zinc-800 truncate" title={col}>{col}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-4 border-t border-zinc-100 space-y-4">
                <button
                  onClick={handleExcelTranslate}
                  disabled={isExcelTranslating || selectedColumns.length === 0}
                  className={cn(
                    "w-full py-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg",
                    isExcelTranslating || selectedColumns.length === 0 
                      ? "bg-zinc-100 text-zinc-400 cursor-not-allowed shadow-none" 
                      : "bg-indigo-600 text-white hover:bg-indigo-700 active:scale-[0.98] shadow-indigo-200/50"
                  )}
                >
                  {isExcelTranslating ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Translating... {excelProgress ? `(${excelProgress.current}/${excelProgress.total})` : ''}
                    </>
                  ) : (
                    <>
                      <Send className="w-5 h-5" />
                      Translate & Download Excel
                    </>
                  )}
                </button>

                {excelProgress && (
                  <div className="space-y-2 animate-in fade-in duration-300">
                    <div className="flex justify-between text-xs font-bold text-zinc-500 uppercase tracking-wider">
                      <span>Translation Progress</span>
                      <span className="text-indigo-600">{Math.round((excelProgress.current / excelProgress.total) * 100)}%</span>
                    </div>
                    <div className="w-full bg-zinc-100 rounded-full h-2.5 overflow-hidden">
                      <div 
                        className="bg-indigo-600 h-full rounded-full transition-all duration-300 ease-out" 
                        style={{ width: `${(excelProgress.current / excelProgress.total) * 100}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Smart Analysis Section */}
      {mode === 'text' && analysis && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="bg-white p-5 rounded-2xl border border-zinc-100 shadow-sm space-y-3">
            <h3 className="text-xs font-bold text-indigo-600 uppercase tracking-widest flex items-center gap-2">
              <BrainCircuit className="w-4 h-4" /> Key Concepts
            </h3>
            <ul className="space-y-2">
              {analysis.keyConcepts.map((concept, i) => (
                <li key={i} className="text-sm text-zinc-600 flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1.5 shrink-0" />
                  {concept}
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-zinc-100 shadow-sm space-y-3 lg:col-span-2">
            <h3 className="text-xs font-bold text-emerald-600 uppercase tracking-widest flex items-center gap-2">
              <ListChecks className="w-4 h-4" /> Vocabulary Focus
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {analysis.vocabulary.map((vocab, i) => (
                <div key={i} className="p-3 bg-emerald-50/50 rounded-xl border border-emerald-100/50">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-bold text-zinc-800">{vocab.english}</span>
                    <span className="text-sm font-hindi font-bold text-emerald-700">{vocab.hindi}</span>
                  </div>
                  <p className="text-[11px] text-zinc-500 leading-tight">{vocab.definition}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-zinc-100 shadow-sm space-y-3">
            <h3 className="text-xs font-bold text-amber-600 uppercase tracking-widest flex items-center gap-2">
              <Lightbulb className="w-4 h-4" /> NCERT Alignment
            </h3>
            <p className="text-sm text-zinc-600 leading-relaxed">
              {analysis.ncertAlignment}
            </p>
            {analysis.suggestedActivities && analysis.suggestedActivities.length > 0 && (
              <div className="pt-2 border-t border-zinc-50">
                <span className="text-[10px] font-bold text-zinc-400 uppercase">Activity Idea:</span>
                <p className="text-xs text-zinc-500 mt-1 italic">{analysis.suggestedActivities[0]}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Footer Info */}
      <footer className="pt-8 border-t border-zinc-200">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-zinc-500 uppercase">Contextual Accuracy</h4>
            <p className="text-xs text-zinc-400">Our AI model prioritizes pedagogical intent over literal translation, ensuring concepts are explained as they would be in a native Hindi classroom.</p>
          </div>
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-zinc-500 uppercase">NCERT Standards</h4>
            <p className="text-xs text-zinc-400">Vocabulary is cross-referenced with NCERT Hindi medium textbooks to ensure students are familiar with the academic terms used.</p>
          </div>
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-zinc-500 uppercase">Grade Adaptation</h4>
            <p className="text-xs text-zinc-400">Complexity scales dynamically from Grade 1 to 12, adjusting sentence structure and terminology density accordingly.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
