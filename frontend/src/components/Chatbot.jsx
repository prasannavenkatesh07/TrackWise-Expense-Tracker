/**
 * components/Chatbot.jsx
 *
 * Floating AI chat widget - the TrackWise Financial Copilot.
 *
 * How it works:
 *   - A fixed bottom-right button toggles the chat window open/closed.
 *   - messages[] holds { role: 'user'|'model', text, isError? } objects.
 *   - On send: append user message optimistically → POST /api/chat → append AI reply.
 *   - The history array sent to the API maps messages to Gemini's
 *     [{ role, parts: [{ text }] }] format (error messages filtered out first).
 *   - react-markdown renders the AI's response so bold, lists, and code look nice.
 *   - A scroll anchor ref + useEffect keeps the view pinned to the latest message.
 *   - JWT is attached globally by AuthContext's axios interceptor - no manual headers needed.
 *
 * The mobile "Ask AI" button in Navbar fires a global 'open-chatbot' window event
 * instead of passing a prop down - simpler than threading a callback through the layout.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import {
  Bot, X, Send, Loader2, Sparkles,
  AlertCircle, Mic, MicOff
} from 'lucide-react';

// --- Welcome message ----------------------------------------------------------
// Shown every time the chat window is opened fresh (or after clearing)
const WELCOME_MESSAGE = {
  role: 'model',
  text: `👋 Hey! I'm your TrackWise Copilot. I have access to your current month's transactions, spending breakdown, and budget.\n\n
You can ask me for insights like *"Am I on track this month?"*, or simply tell me to log an expense: *"I spent ₹150 on coffee today!"*`,
};

// --- Typing indicator ---------------------------------------------------------
// Three dots that bounce in sequence while the AI is generating a response
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

// --- Chat bubble --------------------------------------------------------------
// User messages are right-aligned emerald bubbles.
// AI messages are left-aligned white/dark bubbles with a small bot avatar dot.
// Error messages from the AI get a rose-tinted style instead of the normal one.
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
      {/* Small bot avatar dot next to every AI message */}
      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-900/60
                      flex items-center justify-center mb-0.5">
        <Bot size={13} className="text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
      </div>

      {isError ? (
        <div className="max-w-[80%] rounded-2xl rounded-bl-sm px-3.5 py-2.5
                        bg-rose-50 dark:bg-rose-900/20 border border-rose-200
                        dark:border-rose-800/50 text-rose-700 dark:text-rose-300
                        text-sm leading-relaxed flex items-start gap-2 shadow-sm">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
          <span>{text}</span>
        </div>
      ) : (
        // Using react-markdown so the AI's bold/bullet/code formatting renders properly
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

// --- Main Chatbot component ---------------------------------------------------
const Chatbot = () => {
  const [isOpen,      setIsOpen]      = useState(false);
  const [messages,    setMessages]    = useState([WELCOME_MESSAGE]);
  const [input,       setInput]       = useState('');
  const [isLoading,   setIsLoading]   = useState(false);
  const [isListening, setIsListening] = useState(false);

  // Shows "Offline" in the header when a 429/500 error comes back from the API.
  // Resets to online automatically after 60 seconds.
  const [isOnline,    setIsOnline]    = useState(true);

  const scrollAnchorRef  = useRef(null);
  const inputRef         = useRef(null);
  const chatWindowRef    = useRef(null);
  const statusTimeoutRef = useRef(null); // tracks the 60-second cooldown timer

  // Listen for the global event fired by the mobile Navbar "Ask AI" button
  useEffect(() => {
    const handleOpen = () => setIsOpen(true);
    window.addEventListener('open-chatbot', handleOpen);
    return () => window.removeEventListener('open-chatbot', handleOpen);
  }, []);

  // Keep the scroll position pinned to the bottom whenever messages change
  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Auto-focus the input box a tiny bit after the window opens
  // (the 120ms delay lets the slide-up animation finish first)
  useEffect(() => {
    if (isOpen) {
      const id = setTimeout(() => inputRef.current?.focus(), 120);
      return () => clearTimeout(id);
    }
  }, [isOpen]);

  // Let Escape close the chat window
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setIsOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen]);

  // Clean up the offline status timeout on unmount
  useEffect(() => {
    return () => clearTimeout(statusTimeoutRef.current);
  }, []);

  // Auto-resize the textarea as the user types - capped at 112px (about 4 lines)
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 112)}px`;
    }
  }, [input]);

  // --- Voice input (Web Speech API) -----------------------------------------
  // Only works in Chrome and Edge - the UI falls back gracefully in Firefox/Safari
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
    recognition.continuous    = false;
    recognition.interimResults = true;

    recognition.onstart = () => setIsListening(true);

    recognition.onresult = (event) => {
      // Join all result transcripts - interimResults gives us live partial results
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

  // --- Send message ---------------------------------------------------------
  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    // Append the user's message immediately so the UI feels responsive
    const userMsg = { role: 'user', text: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    // Build history in Gemini's format - filter out error messages since they're
    // not real model turns and would confuse the model if included
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
        setIsOnline(true);
        clearTimeout(statusTimeoutRef.current);
        setMessages((prev) => [...prev, { role: 'model', text: data.response }]);
        if (data.transactionAdded) {
          window.dispatchEvent(new Event('transaction-added'));
        }
      } else {
        throw new Error(data.message || 'Unexpected response from server.');
      }
    } catch (err) {
      // Mark as offline for 429 (rate limit) and 500+ (server error)
      // and reset back to online after 60 seconds automatically
      const status = err?.response?.status;
      if (status === 429 || status >= 500) {
        setIsOnline(false);
        clearTimeout(statusTimeoutRef.current);
        statusTimeoutRef.current = setTimeout(() => setIsOnline(true), 60000);
      }

      const errText =
        err?.response?.data?.message ||
        err?.message ||
        'Something went wrong. Please try again.';
      setMessages((prev) => [...prev, { role: 'model', text: errText, isError: true }]);
    } finally {
      setIsLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [input, isLoading, messages]);

  // Enter sends, Shift+Enter adds a new line
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
      {/* CSS animations - injected once as a style tag so we don't need a library */}
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

      {/* Anchored to the bottom-right on both mobile and desktop */}
      <div className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-30 flex flex-col items-end gap-4">

        {/* -- Chat window (only rendered when open) ------------------------ */}
        {isOpen && (
          <div
            ref={chatWindowRef}
            // calc(100vw - 2rem) makes it fit exactly on small screens without horizontal scroll
            className="chatbot-window w-[calc(100vw-2rem)] sm:w-96 h-[500px] sm:h-[520px] flex flex-col
                       rounded-2xl shadow-2xl overflow-hidden
                       bg-slate-50 dark:bg-slate-900
                       border border-slate-200 dark:border-slate-700/60"
            role="dialog"
            aria-modal="true"
            aria-label="TrackWise Financial Copilot"
          >

            {/* Header */}
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
                {/* Online/Offline status dot - goes red on 429/500 errors */}
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

              {/* Clear chat + close buttons */}
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
                  {/* Inline trash SVG - avoids adding another lucide icon import */}
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

            {/* Message area */}
            <div
              className="flex-1 overflow-y-auto px-3 py-4 space-y-3
                         scrollbar-thin scrollbar-thumb-slate-200
                         dark:scrollbar-thumb-slate-700"
              aria-live="polite"
              aria-label="Conversation"
            >
              {messages.map((msg, i) => (
                <ChatBubble key={i} role={msg.role} text={msg.text} isError={msg.isError} />
              ))}

              {/* Typing indicator shown while waiting for the AI response */}
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

              {/* Invisible anchor at the bottom - scrolled into view whenever messages update */}
              <div ref={scrollAnchorRef} aria-hidden="true" />
            </div>

            {/* Input area */}
            <div className="flex-shrink-0 px-3 pb-3 pt-2
                            border-t border-slate-100 dark:border-slate-700/60
                            bg-white dark:bg-slate-800">
              <div className="flex items-end gap-2">

                {/* Wrapper div handles the border + focus ring so the textarea can be transparent */}
                <div className="flex-1 flex items-end bg-slate-50 dark:bg-slate-900
                                border border-slate-200 dark:border-slate-700
                                rounded-xl focus-within:ring-2 focus-within:ring-emerald-500
                                focus-within:border-emerald-500 overflow-hidden transition-all">

                  {/* Textarea - height is managed by the useEffect above */}
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

                  {/* Inner buttons - clear and voice */}
                  <div className="flex items-center gap-0.5 pr-1.5 pb-1.5">
                    {/* Clear button - only visible when there's text to clear */}
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

                    {/* Voice input button - pulses red while listening */}
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

                {/* Send button */}
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

        {/* -- Toggle button (the glass pill) --------------------------------
            Fades to 40% opacity when the chat is closed so it doesn't
            compete for attention with the rest of the UI - goes to 100% on hover. */}
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