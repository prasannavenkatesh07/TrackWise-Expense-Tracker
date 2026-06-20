/**
 * components/Chatbot.jsx
 *
 * TrackWise Financial Copilot — floating chat widget (Sprint 4)
 *
 * Architecture:
 * - Fixed bottom-right button toggles the chat window open/closed.
 * - messages[] holds { role: 'user'|'model', text: string } objects.
 * - On send: optimistic UI append → POST /api/chat → append AI reply.
 * - history sent to the API maps messages[] to Gemini's
 * [{ role, parts: [{ text }] }] format.
 * - react-markdown renders AI markdown (bold, lists, code) safely.
 * - useRef + useEffect keep the scroll pinned to the latest message.
 * - JWT is attached globally by AuthContext — no manual headers needed.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import {
  Bot,
  X,
  Send,
  Loader2,
  Sparkles,
  AlertCircle,
  Mic,
  MicOff
} from 'lucide-react';

// ─── Welcome message shown when the chat window first opens ───────────────────
const WELCOME_MESSAGE = {
  role: 'model',
  text: `👋 Hey! I'm your **TrackWise Copilot**. I have access to your current month's transactions, spending breakdown, and budget.\n\nAsk me anything — *"How much did I spend on food?"*, *"Am I on track this month?"*, or *"Where can I cut back?"*`,
};

// ─── Typing indicator — three bouncing dots ───────────────────────────────────
const TypingIndicator = () => (
  <div className="flex items-end gap-1 px-3.5 py-3">
    {[0, 1, 2].map((i) => (
      <span
        key={i}
        className="w-2 h-2 rounded-full bg-slate-400 dark:bg-slate-500"
        style={{
          animation: 'chatbotBounce 1.2s ease-in-out infinite',
          animationDelay: `${i * 0.18}s`,
        }}
      />
    ))}
  </div>
);

// ─── Single chat bubble (Claude's Solid Design) ───────────────────────────────
const ChatBubble = ({ role, text, isError }) => {
  const isUser = role === 'user';

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-sm px-3.5 py-2.5
                        bg-emerald-500 dark:bg-emerald-600 text-white text-sm
                        leading-relaxed shadow-sm">
          {text}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start gap-2 items-end">
      {/* Copilot avatar dot */}
      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-900/60
                      flex items-center justify-center mb-0.5">
        <Bot size={13} className="text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
      </div>

      {isError ? (
        /* Error bubble — rose-tinted */
        <div className="max-w-[80%] rounded-2xl rounded-bl-sm px-3.5 py-2.5
                        bg-rose-50 dark:bg-rose-900/20 border border-rose-200
                        dark:border-rose-800/50 text-rose-700 dark:text-rose-300
                        text-sm leading-relaxed flex items-start gap-2 shadow-sm">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
          <span>{text}</span>
        </div>
      ) : (
        /* Normal AI bubble — rendered as Markdown */
        <div className="max-w-[80%] rounded-2xl rounded-bl-sm px-3.5 py-2.5
                        bg-white dark:bg-slate-800 border border-slate-100
                        dark:border-slate-700/60 text-slate-700 dark:text-slate-200
                        text-sm leading-relaxed shadow-sm prose prose-sm dark:prose-invert
                        prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-headings:my-1
                        prose-strong:text-emerald-600 dark:prose-strong:text-emerald-400
                        max-w-none">
          <ReactMarkdown>{text}</ReactMarkdown>
        </div>
      )}
    </div>
  );
};

// ─── Main Chatbot component ───────────────────────────────────────────────────
const Chatbot = () => {
  const [isOpen,      setIsOpen]      = useState(false);
  const [messages,    setMessages]    = useState([WELCOME_MESSAGE]);
  const [input,       setInput]       = useState('');
  const [isLoading,   setIsLoading]   = useState(false);
  const [isListening, setIsListening] = useState(false);
  
  // Live Online/Offline Status state
  const [isOnline,    setIsOnline]    = useState(true);

  const scrollAnchorRef  = useRef(null); 
  const inputRef         = useRef(null); 
  const chatWindowRef    = useRef(null); 
  const statusTimeoutRef = useRef(null); // Tracks the cooldown timer

  // ✦ Listen for global event to open chatbot from mobile Navbar
  useEffect(() => {
    const handleOpen = () => setIsOpen(true);
    window.addEventListener('open-chatbot', handleOpen);
    return () => window.removeEventListener('open-chatbot', handleOpen);
  }, []);

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => {
    if (isOpen) {
      const id = setTimeout(() => inputRef.current?.focus(), 120);
      return () => clearTimeout(id);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setIsOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen]);

  // Cleanup timeout when component unmounts
  useEffect(() => {
    return () => clearTimeout(statusTimeoutRef.current);
  }, []);

  // Auto-resize textarea dynamically whenever 'input' state changes
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'; 
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 112)}px`;
    }
  }, [input]);

  // ── Voice Input Logic (Web Speech API) ───────────────────────────────────
  const toggleListening = () => {
    if (isListening) {
      setIsListening(false);
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Voice input is not supported in this browser. Please try Chrome or Edge.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onstart = () => setIsListening(true);
    
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join('');
      setInput(transcript);
    };

    recognition.onerror = (e) => {
      console.error('Speech recognition error', e);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
      inputRef.current?.focus();
    };

    recognition.start();
  };

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    const userMsg = { role: 'user', text: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    const historyForApi = [...messages, userMsg]
      .filter((m) => m.text && !m.isError) 
      .map((m) => ({
        role:  m.role,
        parts: [{ text: m.text }],
      }));

    try {
      const { data } = await axios.post('/api/chat', {
        message: trimmed,
        history: historyForApi,
      });

      if (data.success) {
        // Request succeeded — Ensure status is Online
        setIsOnline(true);
        clearTimeout(statusTimeoutRef.current);

        setMessages((prev) => [
          ...prev,
          { role: 'model', text: data.response },
        ]);
      } else {
        throw new Error(data.message || 'Unexpected response from server.');
      }
    } catch (err) {
      // Check for Token Exhaustion (429) or Server Error (500+)
      const status = err?.response?.status;
      if (status === 429 || status >= 500) {
        setIsOnline(false);
        clearTimeout(statusTimeoutRef.current);
        // Automatically reset status to online after 60 seconds
        statusTimeoutRef.current = setTimeout(() => setIsOnline(true), 60000);
      }

      const errText =
        err?.response?.data?.message ||
        err?.message ||
        'Something went wrong. Please try again.';
      setMessages((prev) => [
        ...prev,
        { role: 'model', text: errText, isError: true },
      ]);
    } finally {
      setIsLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [input, isLoading, messages]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    setMessages([WELCOME_MESSAGE]);
    setInput('');
  };

  return (
    <>
      <style>{`
        @keyframes chatbotBounce {
          0%, 60%, 100% { transform: translateY(0);    opacity: 0.5; }
          30%            { transform: translateY(-6px); opacity: 1;   }
        }
        @keyframes chatbotSlideUp {
          from { opacity: 0; transform: translateY(16px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)    scale(1);    }
        }
        .chatbot-window {
          animation: chatbotSlideUp 0.22s cubic-bezier(0.4, 0, 0.2, 1) forwards;
        }
      `}</style>

      {/* ✦ Adjusted padding for mobile compatibility */}
      <div className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-30 flex flex-col items-end gap-4">

        {/* ══════════════════════════════════════════════════════════════════
            CHAT WINDOW — CLAUDE'S SOLID DESIGN
            ══════════════════════════════════════════════════════════════════ */}
        {isOpen && (
          <div
            ref={chatWindowRef}
            /* ✦ Added mobile responsive width: calc(100vw-2rem) ensures it fits exactly on small screens */
            className="chatbot-window w-[calc(100vw-2rem)] sm:w-96 h-[500px] sm:h-[520px] flex flex-col
                       rounded-2xl shadow-2xl overflow-hidden
                       bg-slate-50 dark:bg-slate-900
                       border border-slate-200 dark:border-slate-700/60"
            role="dialog"
            aria-modal="true"
            aria-label="TrackWise Financial Copilot"
          >

            {/* ── Header ─────────────────────────────────────────────────── */}
            <header className="flex items-center gap-2.5 px-4 py-3
                               bg-white dark:bg-slate-800
                               border-b border-slate-100 dark:border-slate-700/60
                               flex-shrink-0">
              <div className="w-8 h-8 rounded-xl bg-emerald-500 dark:bg-emerald-600
                              flex items-center justify-center flex-shrink-0 shadow-sm">
                <Sparkles size={15} className="text-white" aria-hidden="true" />
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-900 dark:text-slate-100 leading-tight">
                  TrackWise Copilot
                </p>
                {/* Dynamic Online / Offline Indicator */}
                <p className={`text-[10px] font-medium leading-tight flex items-center gap-1.5 mt-0.5
                               ${isOnline ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}`}>
                  <span 
                    className={`w-1.5 h-1.5 rounded-full inline-block 
                                ${isOnline 
                                  ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse' 
                                  : 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)]'}`} 
                    aria-hidden="true" 
                  />
                  {isOnline ? 'Online' : 'Offline'}
                </p>
              </div>

              {/* Clear + Close buttons */}
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={clearChat}
                  disabled={isLoading}
                  title="Clear conversation"
                  aria-label="Clear conversation"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600
                             dark:hover:text-slate-300 hover:bg-slate-100
                             dark:hover:bg-slate-700 transition-colors
                             disabled:opacity-40 disabled:cursor-not-allowed
                             focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="none"
                    stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
                    aria-hidden="true">
                    <path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 9h8l1-9" />
                  </svg>
                </button>
                <button
                  onClick={() => setIsOpen(false)}
                  title="Close"
                  aria-label="Close chat"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600
                             dark:hover:text-slate-300 hover:bg-slate-100
                             dark:hover:bg-slate-700 transition-colors
                             focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">
                  <X size={15} aria-hidden="true" />
                </button>
              </div>
            </header>

            {/* ── Message area ───────────────────────────────────────────── */}
            <div
              className="flex-1 overflow-y-auto px-3 py-4 space-y-3
                         scrollbar-thin scrollbar-thumb-slate-200
                         dark:scrollbar-thumb-slate-700"
              aria-live="polite"
              aria-label="Conversation"
            >
              {messages.map((msg, i) => (
                <ChatBubble
                  key={i}
                  role={msg.role}
                  text={msg.text}
                  isError={msg.isError}
                />
              ))}

              {isLoading && (
                <div className="flex justify-start gap-2 items-end">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full
                                  bg-emerald-100 dark:bg-emerald-900/60
                                  flex items-center justify-center mb-0.5">
                    <Bot size={13} className="text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  </div>
                  <div className="rounded-2xl rounded-bl-sm
                                  bg-white dark:bg-slate-800
                                  border border-slate-100 dark:border-slate-700/60
                                  shadow-sm">
                    <TypingIndicator />
                  </div>
                </div>
              )}

              <div ref={scrollAnchorRef} aria-hidden="true" />
            </div>

            {/* ── Input area (Composite Layout Fix) ──────────────────────── */}
            <div className="flex-shrink-0 px-3 pb-3 pt-2
                            border-t border-slate-100 dark:border-slate-700/60
                            bg-white dark:bg-slate-800">
              <div className="flex items-end gap-2">
                
                {/* Wrapper Div providing background, borders, and rounded corners */}
                <div className="flex-1 flex items-end bg-slate-50 dark:bg-slate-900 
                                border border-slate-200 dark:border-slate-700 
                                rounded-xl focus-within:ring-2 focus-within:ring-emerald-500 
                                focus-within:border-emerald-500 overflow-hidden transition-all">
                  
                  {/* Transparent Textarea (onInput removed, handled by useEffect) */}
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={isLoading}
                    placeholder={isListening ? "Listening..." : "Ask about your spending…"}
                    rows={1}
                    maxLength={1000}
                    aria-label="Message input"
                    className="flex-1 resize-none bg-transparent px-3 py-2.5 text-sm
                               text-slate-800 dark:text-slate-200
                               placeholder:text-slate-400 dark:placeholder:text-slate-500
                               focus:outline-none border-none focus:ring-0
                               disabled:opacity-50 disabled:cursor-not-allowed
                               leading-relaxed max-h-28 overflow-y-auto
                               scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-600"
                    style={{ minHeight: '40px' }}
                  />

                  {/* Inner Action Buttons */}
                  <div className="flex items-center gap-0.5 pr-1.5 pb-1.5">
                    {/* Clear Button (Only shows if there is text) */}
                    {input.trim() && (
                      <button
                        onClick={() => setInput('')}
                        disabled={isLoading}
                        title="Clear input"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600
                                   dark:hover:text-slate-300 hover:bg-slate-200/50 
                                   dark:hover:bg-slate-700/50 transition-colors focus:outline-none"
                      >
                        <X size={15} />
                      </button>
                    )}
                    
                    {/* Voice Input Button */}
                    <button
                      onClick={toggleListening}
                      disabled={isLoading}
                      title={isListening ? "Stop listening" : "Start voice typing"}
                      className={`p-1.5 rounded-lg transition-colors focus:outline-none
                                  ${isListening 
                                    ? 'text-rose-500 bg-rose-100 dark:bg-rose-900/40 animate-pulse' 
                                    : 'text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-slate-200/50 dark:hover:bg-slate-700/50'
                                  }`}
                    >
                      {isListening ? <MicOff size={15} /> : <Mic size={15} />}
                    </button>
                  </div>
                </div>

                {/* Send Button */}
                <button
                  onClick={sendMessage}
                  disabled={isLoading || !input.trim()}
                  aria-label="Send message"
                  className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center
                             justify-center transition-all duration-200
                             focus:outline-none focus-visible:ring-2
                             focus-visible:ring-emerald-500 focus-visible:ring-offset-1
                             disabled:opacity-40 disabled:cursor-not-allowed
                             bg-emerald-500 hover:bg-emerald-600 active:scale-95
                             dark:bg-emerald-600 dark:hover:bg-emerald-700
                             text-white shadow-sm">
                  {isLoading
                    ? <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                    : <Send size={16} aria-hidden="true" />
                  }
                </button>
              </div>

              <p className="text-[10px] text-slate-400 dark:text-slate-600
                            mt-1.5 text-center select-none">
                Enter to send · Shift+Enter for new line
              </p>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            TOGGLE BUTTON — THE GLASS PILL (Idle Fade Implementation)
            ✦ added dynamic opacity: 40% when closed, 100% on hover/open
            ══════════════════════════════════════════════════════════════════ */}
        <button
          onClick={() => setIsOpen((prev) => !prev)}
          aria-label={isOpen ? 'Close AI' : 'Ask AI'}
          aria-expanded={isOpen}
          className={`hidden md:flex items-center gap-2 px-5 py-3 rounded-full
                     bg-slate-900/80 hover:bg-slate-900 dark:bg-slate-800/90 
                     dark:hover:bg-slate-700/90 text-white backdrop-blur-xl
                     shadow-[0_4px_16px_rgba(0,0,0,0.1)] hover:shadow-[0_6px_24px_rgba(0,0,0,0.15)] 
                     active:scale-95 transition-all duration-300
                     border border-white/20 dark:border-slate-600/50
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2
                     ${!isOpen ? 'opacity-40 hover:opacity-100' : 'opacity-100'}`}
        >
          {isOpen ? (
            <>
              <X size={18} aria-hidden="true" className="text-slate-300 dark:text-slate-200" />
              <span className="font-semibold text-sm tracking-wide text-white">Close</span>
            </>
          ) : (
            <>
              <Sparkles size={18} aria-hidden="true" className="text-emerald-300 dark:text-emerald-400" />
              <span className="font-semibold text-sm tracking-wide text-white">Ask AI</span>
            </>
          )}
        </button>
      </div>
    </>
  );
};

export default Chatbot;