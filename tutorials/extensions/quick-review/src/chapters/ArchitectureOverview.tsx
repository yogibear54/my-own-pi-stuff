import React from 'react';
import { FilesCovered } from '../components/FilesCovered';
import { ChapterNavigation } from '../components/ChapterNavigation';
import { CodeBlock } from '../components/CodeBlock';

// Quiz Component
function Quiz({ question, options, correctIndex, explanation }: {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}) {
  const [selected, setSelected] = React.useState<number | null>(null);
  const [revealed, setRevealed] = React.useState(false);

  return (
    <div className="quiz-container">
      <div className="quiz-question">{question}</div>
      <div className="quiz-options">
        {options.map((option, idx) => (
          <button
            key={idx}
            className={`quiz-option ${selected === idx ? 'selected' : ''} ${
              revealed && idx === correctIndex ? 'correct' : ''
            } ${revealed && selected === idx && idx !== correctIndex ? 'incorrect' : ''}`}
            onClick={() => { setSelected(idx); setRevealed(true); }}
            disabled={revealed}
          >
            <span className="quiz-option-letter">{String.fromCharCode(65 + idx)}</span>
            <span className="quiz-option-text">{option}</span>
          </button>
        ))}
      </div>
      {revealed && (
        <div className={`quiz-explanation ${selected === correctIndex ? 'correct' : 'incorrect'}`}>
          <strong>{selected === correctIndex ? '✓ Correct!' : '✗ Incorrect'}</strong>
          <p>{explanation}</p>
        </div>
      )}
    </div>
  );
}

// Architecture Diagram Component
function ArchitectureDiagram() {
  return (
    <div className="diagram-container">
      <svg viewBox="0 0 800 500" className="architecture-diagram">
        {/* Background */}
        <rect x="0" y="0" width="800" height="500" fill="#f8f9fa" rx="8" />
        
        {/* User Layer */}
        <rect x="300" y="20" width="200" height="50" fill="#228be6" rx="25" />
        <text x="400" y="52" textAnchor="middle" fill="white" fontSize="14" fontWeight="600">User</text>
        
        {/* Arrow User -> Command */}
        <path d="M400 70 L400 95" stroke="#868e96" strokeWidth="2" markerEnd="url(#arrowhead)" />
        <text x="420" y="88" fill="#495057" fontSize="11">/quick-review</text>
        
        {/* pi Agent Layer */}
        <rect x="150" y="110" width="500" height="140" fill="none" stroke="#228be6" strokeWidth="2" strokeDasharray="5,5" rx="8" />
        <text x="170" y="135" fill="#228be6" fontSize="12" fontWeight="600">pi Extension System</text>
        
        {/* ExtensionAPI Box */}
        <rect x="180" y="150" width="200" height="80" fill="#e7f5ff" stroke="#228be6" rx="6" />
        <text x="280" y="175" textAnchor="middle" fill="#1c7ed6" fontSize="12" fontWeight="600">ExtensionAPI</text>
        <text x="280" y="195" textAnchor="middle" fill="#495057" fontSize="10">registerCommand()</text>
        <text x="280" y="212" textAnchor="middle" fill="#495057" fontSize="10">setModel()</text>
        
        {/* Command Handler Box */}
        <rect x="420" y="150" width="200" height="80" fill="#fff9db" stroke="#fab005" rx="6" />
        <text x="520" y="175" textAnchor="middle" fill="#e67700" fontSize="12" fontWeight="600">Command Handler</text>
        <text x="520" y="195" textAnchor="middle" fill="#495057" fontSize="10">Argument Parsing</text>
        <text x="520" y="212" textAnchor="middle" fill="#495057" fontSize="10">Model Selection</text>
        
        {/* showModelPicker Box */}
        <rect x="420" y="260" width="200" height="60" fill="#ebfbee" stroke="#40c057" rx="6" />
        <text x="520" y="288" textAnchor="middle" fill="#2b8a3e" fontSize="12" fontWeight="600">showModelPicker()</text>
        <text x="520" y="305" textAnchor="middle" fill="#495057" fontSize="10">Custom TUI Component</text>
        
        {/* Arrows */}
        <path d="M380 190 L420 190" stroke="#495057" strokeWidth="1.5" />
        <path d="M520 230 L520 260" stroke="#495057" strokeWidth="1.5" />
        
        {/* Arrow to AI */}
        <path d="M400 250 L400 320" stroke="#868e96" strokeWidth="2" markerEnd="url(#arrowhead)" />
        <text x="420" y="290" fill="#495057" fontSize="11">sendUserMessage()</text>
        
        {/* AI Layer */}
        <rect x="250" y="340" width="300" height="80" fill="#f1f3f5" stroke="#868e96" rx="8" />
        <text x="400" y="375" textAnchor="middle" fill="#212529" fontSize="14" fontWeight="600">AI Model</text>
        <text x="400" y="398" textAnchor="middle" fill="#495057" fontSize="11">Code Analysis & Review</text>
        
        {/* Arrow for response */}
        <path d="M400 420 L400 455" stroke="#868e96" strokeWidth="2" markerEnd="url(#arrowhead)" />
        <text x="420" y="442" fill="#495057" fontSize="11">Review Results</text>
        
        {/* Output */}
        <rect x="300" y="465" width="200" height="30" fill="#40c057" rx="15" />
        <text x="400" y="485" textAnchor="middle" fill="white" fontSize="12" fontWeight="600">Review Output</text>
        
        {/* Arrowhead definition */}
        <defs>
          <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="#868e96" />
          </marker>
        </defs>
      </svg>
    </div>
  );
}

// Data Flow Diagram
function DataFlowDiagram() {
  return (
    <div className="diagram-container">
      <svg viewBox="0 0 700 400" className="dataflow-diagram">
        <rect x="0" y="0" width="700" height="400" fill="#f8f9fa" rx="8" />
        
        {/* Step 1: User Input */}
        <rect x="50" y="40" width="140" height="60" fill="#e7f5ff" stroke="#228be6" rx="6" />
        <text x="120" y="65" textAnchor="middle" fill="#1c7ed6" fontSize="11" fontWeight="600">1. User Input</text>
        <text x="120" y="82" textAnchor="middle" fill="#495057" fontSize="9">/quick-review</text>
        <text x="120" y="95" textAnchor="middle" fill="#495057" fontSize="9">--model X file</text>
        
        {/* Arrow */}
        <path d="M190 70 L220 70" stroke="#868e96" strokeWidth="2" markerEnd="url(#arrowhead)" />
        
        {/* Step 2: Parse Args */}
        <rect x="230" y="40" width="140" height="60" fill="#fff9db" stroke="#fab005" rx="6" />
        <text x="300" y="65" textAnchor="middle" fill="#e67700" fontSize="11" fontWeight="600">2. Parse Args</text>
        <text x="300" y="82" textAnchor="middle" fill="#495057" fontSize="9">modelId, provider</text>
        <text x="300" y="95" textAnchor="middle" fill="#495057" fontSize="9">paths[]</text>
        
        {/* Arrow */}
        <path d="M370 70 L400 70" stroke="#868e96" strokeWidth="2" markerEnd="url(#arrowhead)" />
        
        {/* Step 3: Model Selection */}
        <rect x="410" y="40" width="140" height="60" fill="#ebfbee" stroke="#40c057" rx="6" />
        <text x="480" y="65" textAnchor="middle" fill="#2b8a3e" fontSize="11" fontWeight="600">3. Model Select</text>
        <text x="480" y="82" textAnchor="middle" fill="#495057" fontSize="9">Registry lookup</text>
        <text x="480" y="95" textAnchor="middle" fill="#495057" fontSize="9">Switch model</text>
        
        {/* Step 4: Build Prompt - Right side */}
        <rect x="230" y="160" width="140" height="60" fill="#f8f9fa" stroke="#868e96" rx="6" />
        <text x="300" y="185" textAnchor="middle" fill="#212529" fontSize="11" fontWeight="600">4. Build Prompt</text>
        <text x="300" y="202" textAnchor="middle" fill="#495057" fontSize="9">REVIEW_PROMPT</text>
        <text x="300" y="215" textAnchor="middle" fill="#495057" fontSize="9">+ target path</text>
        
        {/* Arrow from Model Selection down */}
        <path d="M480 100 L480 160 L300 160" stroke="#868e96" strokeWidth="2" markerEnd="url(#arrowhead)" />
        
        {/* Step 5: Send to AI */}
        <rect x="230" y="280" width="140" height="60" fill="#fce8ff" stroke="#be4bdb" rx="6" />
        <text x="300" y="305" textAnchor="middle" fill="#862e9c" fontSize="11" fontWeight="600">5. Send Message</text>
        <text x="300" y="322" textAnchor="middle" fill="#495057" fontSize="9">pi.sendUserMessage()</text>
        <text x="300" y="335" textAnchor="middle" fill="#495057" fontSize="9">fullPrompt</text>
        
        {/* Arrow down */}
        <path d="M300 220 L300 280" stroke="#868e96" strokeWidth="2" markerEnd="url(#arrowhead)" />
        
        {/* Step 6: AI Response */}
        <rect x="410" y="280" width="140" height="60" fill="#fff5f5" stroke="#fa5252" rx="6" />
        <text x="480" y="305" textAnchor="middle" fill="#c92a2a" fontSize="11" fontWeight="600">6. AI Response</text>
        <text x="480" y="322" textAnchor="middle" fill="#495057" fontSize="9">Code Review</text>
        <text x="480" y="335" textAnchor="middle" fill="#495057" fontSize="9">Results</text>
        
        {/* Arrow right */}
        <path d="M370 310 L410 310" stroke="#868e96" strokeWidth="2" markerEnd="url(#arrowhead)" />
        
        {/* Arrowhead definition */}
        <defs>
          <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="#868e96" />
          </marker>
        </defs>
      </svg>
    </div>
  );
}

export function ArchitectureOverview() {
  return (
    <article className="chapter-content">
      <header className="chapter-header">
        <p className="chapter-eyebrow">Chapter 1</p>
        <h1 className="chapter-heading">Architecture Overview</h1>
        <p className="chapter-description">
          In this chapter, we'll explore the architecture of the quick-review extension — a 
          powerful code review tool that integrates directly into the pi coding agent. You'll 
          discover how a seemingly simple command hides sophisticated patterns for argument 
          parsing, model selection, and AI integration. By the end, you'll understand not just 
          <em>what</em> the code does, but <em>why</em> it was designed this way.
        </p>
      </header>

      <FilesCovered files={['extensions/quick-review.ts']} />

      {/* High-Level Architecture */}
      <section className="section">
        <h2 className="section-title">High-Level Architecture</h2>
        <div className="section-content">
          <p>
            The quick-review extension follows a <strong>plugin architecture</strong> pattern. 
            Think of it like a feature plugin in VS Code or a middleware in Express — it extends 
            the base system with new capabilities without modifying the core.
          </p>
          <p style={{ marginTop: '12px' }}>
            The entire extension lives in a single file (~218 lines), which might seem unusual 
            if you're coming from a world of multi-file modules. This is a deliberate choice: 
            <strong> simplicity over complexity</strong>. Extensions in pi are meant to be focused, 
            composable, and easy to share.
          </p>
          
          <ArchitectureDiagram />
          
          <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', marginTop: '8px', textAlign: 'center' }}>
            <em>Figure 1: The quick-review extension architecture showing user interaction flow</em>
          </p>
        </div>
      </section>

      {/* Design Philosophy */}
      <section className="section">
        <h2 className="section-title">Design Philosophy: Why Single File?</h2>
        <div className="section-content">
          <p>
            You might wonder: <em>"Why not split this into multiple files?"</em> It's a fair question. 
            In enterprise JavaScript, we've been trained to think bigger = better. But for pi 
            extensions, the philosophy is different:
          </p>
          
          <div className="info-box" style={{ background: 'var(--color-accent-bg)', padding: '16px', borderRadius: '8px', margin: '16px 0', borderLeft: '4px solid var(--color-accent)' }}>
            <strong>💡 Key Insight:</strong> Extensions should be <em>self-contained units</em> that 
            you can drop into any pi installation. A single file is the ultimate portability.
          </div>

          <p><strong>Benefits of single-file design:</strong></p>
          <ul style={{ marginLeft: '24px', marginTop: '12px' }}>
            <li><strong>Easy distribution</strong> — Share one file, not a folder structure</li>
            <li><strong>Zero configuration</strong> — No build step, no dependencies to manage</li>
            <li><strong>Clear ownership</strong> — One place to look for bugs</li>
            <li><strong>Atomic updates</strong> — Update everything at once</li>
          </ul>

          <p style={{ marginTop: '16px' }}>
            <strong>Trade-offs to consider:</strong> For larger extensions (thousands of lines), 
            you'd want to split things. But for focused utilities like code review, a single file 
            is the right tool for the job.
          </p>
        </div>
      </section>

      {/* Core Components */}
      <section className="section">
        <h2 className="section-title">Core Components</h2>
        <div className="section-content">
          <p>
            The extension is composed of three main building blocks:
          </p>

          {/* Component 1 */}
          <div style={{ marginTop: '24px', padding: '20px', background: 'var(--color-bg-secondary)', borderRadius: '8px' }}>
            <h3 style={{ color: 'var(--color-accent)', marginBottom: '12px', fontSize: '1rem' }}>
              1. Entry Point Function: <code>reviewExtension()</code>
            </h3>
            <p>
              This is the bridge between pi and your extension. When pi loads your extension, 
              it calls this function with an <code>ExtensionAPI</code> instance — your gateway 
              to everything pi offers.
            </p>
          </div>

          {/* Component 2 */}
          <div style={{ marginTop: '16px', padding: '20px', background: 'var(--color-bg-secondary)', borderRadius: '8px' }}>
            <h3 style={{ color: 'var(--color-success)', marginBottom: '12px', fontSize: '1rem' }}>
              2. Command Handler: The <code>handler</code> callback
            </h3>
            <p>
              Inside the command registration, the handler is where the magic happens. It's an 
              async function that receives user arguments and context, then orchestrates the 
              entire review workflow.
            </p>
          </div>

          {/* Component 3 */}
          <div style={{ marginTop: '16px', padding: '20px', background: 'var(--color-bg-secondary)', borderRadius: '8px' }}>
            <h3 style={{ color: 'var(--color-warning)', marginBottom: '12px', fontSize: '1rem' }}>
              3. Model Picker: <code>showModelPicker()</code>
            </h3>
            <p>
              This is a custom TUI (Text User Interface) component built using pi's TUI primitives. 
              It creates an interactive search interface for selecting AI models — something the 
              built-in pickers don't offer.
            </p>
          </div>
        </div>
      </section>

      {/* Deep Code Analysis */}
      <section className="section">
        <h2 className="section-title">Deep Dive: The Entry Point Pattern</h2>
        <div className="section-content">
          <p>
            Let's examine the entry point in detail. Understanding this pattern is crucial — 
            it's the foundation for all pi extensions.
          </p>

          <CodeBlock
            filename="extensions/quick-review.ts (lines 1-15)"
            code={`/**
 * Review Command Extension
 *
 * Registers a /quick-review command that performs code reviews
 * in the current pi session. Analyzes code for bugs, security
 * issues, and error handling gaps.
 */

// Type imports - erased at compile time, purely for development
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { Model } from "@mariozechner/pi-ai";`}
          />

          <p style={{ marginTop: '16px' }}>
            <strong>Notice the <code>import type</code> syntax?</strong> This is a TypeScript 3.8+ feature 
            that's especially important for extensions. Unlike regular imports, type imports are 
            completely erased during compilation. Your bundle ships no type information — it's only 
            there to help you write correct code during development.
          </p>

          <div className="info-box" style={{ background: '#fff9db', padding: '16px', borderRadius: '8px', margin: '16px 0', borderLeft: '4px solid var(--color-warning)' }}>
            <strong>🔍 TypeScript Tip:</strong> For JavaScript developers new to TypeScript: 
            type imports are purely for compile-time type checking and provide 
            information — it provides zero runtime overhead.
          </div>

          <CodeBlock
            filename="extensions/quick-review.ts (lines 28-34)"
            code={`// Default export - the entry point pi expects
export default function reviewExtension(pi: ExtensionAPI) {
    // Register our command with pi's command system
    pi.registerCommand("quick-review", {
        description: "Review code for bugs, security issues...",
        handler: async (args, ctx) => {
            // Command implementation...
        },
    });
}`}
          />

          <p style={{ marginTop: '16px' }}>
            <strong>Why <code>default export</code>?</strong> This is a convention that allows pi to 
            dynamically import your extension:
          </p>

          <CodeBlock
            filename="How pi discovers extensions"
            code={`// Simplified view of how pi loads extensions
const extension = await import('./extensions/quick-review');
extension.default(pi); // Call the default export with ExtensionAPI`}
          />

          <p style={{ marginTop: '16px' }}>
            This pattern is common in many ecosystems — Express plugins, VS Code extensions, 
            webpack loaders — because it provides a clean, consistent interface.
          </p>
        </div>
      </section>

      {/* The Constant: REVIEW_PROMPT */}
      <section className="section">
        <h2 className="section-title">The Constant: REVIEW_PROMPT</h2>
        <div className="section-content">
          <p>
            Before the main function, you'll find a constant that defines the AI's behavior:
          </p>

          <CodeBlock
            filename="extensions/quick-review.ts (lines 18-26)"
            code={`const REVIEW_PROMPT = \`You are a code reviewer. Your task is to 
analyze the provided code for:

1. **Bugs and Logic Errors**: Look for off-by-one errors, 
   race conditions, infinite loops...

2. **Security Issues**: Identify injection vulnerabilities...

3. **Error Handling Gaps**: Look for missing try-catch blocks...

Report each issue with:
  - File path and line number
  - Severity (critical / high / medium / low)
  - Suggested fix
\`;`}
          />

          <p style={{ marginTop: '16px' }}>
            <strong>Why a constant instead of inline string?</strong> Several reasons:
          </p>
          <ul style={{ marginLeft: '24px', marginTop: '12px' }}>
            <li><strong>Separation of concerns</strong> — Prompts can be modified without touching logic</li>
            <li><strong>Documentation</strong> — The constant name documents intent</li>
            <li><strong>Potential for externalization</strong> — Could be loaded from config file later</li>
            <li><strong>IDE support</strong> — Easier to reference and reuse</li>
          </ul>
        </div>
      </section>

      {/* Data Flow Section */}
      <section className="section">
        <h2 className="section-title">Data Flow Analysis</h2>
        <div className="section-content">
          <p>
            Understanding how data moves through the extension is key to debugging and extending it. 
            Let's trace the journey from user input to AI response.
          </p>

          <DataFlowDiagram />
          
          <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', marginTop: '8px', marginBottom: '16px', textAlign: 'center' }}>
            <em>Figure 2: Data flow through the quick-review extension</em>
          </p>

          <h3 style={{ fontSize: '1rem', marginTop: '24px', marginBottom: '12px' }}>Step-by-Step Breakdown</h3>

          <p><strong>Step 1: User Input</strong></p>
          <p style={{ marginLeft: '16px', color: 'var(--color-text-secondary)' }}>
            User types <code>/quick-review src/app.ts</code> or <code>/quick-review --model claude-sonnet-4 file</code>. 
            This string is passed to the handler as the <code>args</code> parameter.
          </p>

          <p style={{ marginTop: '16px' }}><strong>Step 2: Argument Parsing</strong></p>
          <p style={{ marginLeft: '16px', color: 'var(--color-text-secondary)' }}>
            The code splits the string and identifies three things: the model ID, the provider, 
            and the target paths. This is manual parsing — we'll see why shortly.
          </p>

          <p style={{ marginTop: '16px' }}><strong>Step 3: Model Selection</strong></p>
          <p style={{ marginLeft: '16px', color: 'var(--color-text-secondary)' }}>
            If flags are provided, the model is looked up directly. If not, the user is shown 
            a picker to choose. This decision point is crucial — it affects UX significantly.
          </p>

          <p style={{ marginTop: '16px' }}><strong>Step 4: Prompt Construction</strong></p>
          <p style={{ marginLeft: '16px', color: 'var(--color-text-secondary)' }}>
            The constant <code>REVIEW_PROMPT</code> is concatenated with the target path. 
            This creates the full instruction set for the AI.
          </p>

          <p style={{ marginTop: '16px' }}><strong>Step 5: Send to AI</strong></p>
          <p style={{ marginLeft: '16px', color: 'var(--color-text-secondary)' }}>
            <code>pi.sendUserMessage(fullPrompt)</code> hands control to the AI. The extension 
            waits for the AI to process and respond.
          </p>

          <p style={{ marginTop: '16px' }}><strong>Step 6: Response</strong></p>
          <p style={{ marginLeft: '16px', color: 'var(--color-text-secondary)' }}>
            The AI generates a code review based on its instructions. This appears in the 
            user's terminal as the final output.
          </p>
        </div>
      </section>

      {/* Argument Parsing Deep Dive */}
      <section className="section">
        <h2 className="section-title">Deep Dive: Argument Parsing Strategy</h2>
        <div className="section-content">
          <p>
            The extension uses manual argument parsing rather than a library like 
            <code>yargs</code> or <code>commander</code>. Let's examine why and how:
          </p>

          <CodeBlock
            filename="extensions/quick-review.ts (lines 36-50)"
            code={`const argParts = args.trim().split(/\s+/);

// Parse optional flags
let modelId: string | undefined;
let provider: string | undefined;
const paths: string[] = [];

for (let i = 0; i < argParts.length; i++) {
    const part = argParts[i];
    if (part === "--model" && i + 1 < argParts.length) {
        modelId = argParts[++i];  // Consume next token
    } else if (part === "--provider" && i + 1 < argParts.length) {
        provider = argParts[++i];
    } else if (!part.startsWith("--")) {
        paths.push(part);
    }
}`}
          />

          <p style={{ marginTop: '16px' }}>
            <strong>Why manual parsing?</strong> For a few flags with simple needs, a library 
            would be overkill. The code is readable, handles the specific use case, and has 
            no external dependencies.
          </p>

          <div className="info-box" style={{ background: '#fce8ff', padding: '16px', borderRadius: '8px', margin: '16px 0', borderLeft: '4px solid #be4bdb' }}>
            <strong>💭 Design Decision:</strong> In production code, you'd consider a library 
            if: (1) you have 5+ complex flags, (2) you need validation/schemas, or (3) you 
            need auto-generated help. For simple cases, manual parsing is perfectly fine.
          </div>

          <p><strong>Key TypeScript patterns used:</strong></p>
          <ul style={{ marginLeft: '24px', marginTop: '12px' }}>
            <li><code>string | undefined</code> — The model ID may or may not exist</li>
            <li><code>string[]</code> — Multiple paths are supported</li>
            <li><code>++i</code> — Consume the next token when parsing flag values</li>
          </ul>
        </div>
      </section>

      {/* Fallback Chain Pattern */}
      <section className="section">
        <h2 className="section-title">The Fallback Chain Pattern</h2>
        <div className="section-content">
          <p>
            One of the most interesting patterns in this code is the fallback chain for model selection:
          </p>

          <CodeBlock
            filename="extensions/quick-review.ts (lines 53-56)"
            code={`let targetModel = modelId
    ? ctx.modelRegistry.find(
        provider || originalModel?.provider || "anthropic",
        modelId
    )
    : undefined;`}
          />

          <p style={{ marginTop: '16px' }}>
            <strong>What this does:</strong> When looking up a model, we try multiple providers 
            in order:
          </p>
          <ol style={{ marginLeft: '24px', marginTop: '12px' }}>
            <li>Use the explicitly provided <code>provider</code></li>
            <li>If not provided, use the current model's provider</li>
            <li>If no current model, default to <code>"anthropic"</code></li>
          </ol>

          <div className="info-box" style={{ background: '#ebfbee', padding: '16px', borderRadius: '8px', margin: '16px 0', borderLeft: '4px solid var(--color-success)' }}>
            <strong>✨ TypeScript Feature:</strong> The <code>?.</code> (optional chaining) and 
            <code>||</code> (nullish coalescing alternative) here prevent errors when 
            <code>originalModel</code> is undefined.
          </div>

          <p style={{ marginTop: '16px' }}>
            <strong>Why this pattern?</strong> It provides sensible defaults while respecting 
            user choices. If someone says <code>--model claude-sonnet-4</code> without a provider, 
            we try their current provider first (probably what they want), then fall back to anthropic.
          </p>
        </div>
      </section>

      {/* Cross-References */}
      <section className="section">
        <h2 className="section-title">Cross-Chapter References</h2>
        <div className="section-content">
          <p>
            This architecture connects to several other concepts explored in later chapters:
          </p>
          
          <div style={{ display: 'grid', gap: '12px', marginTop: '16px' }}>
            <a href="#" onClick={(e) => { e.preventDefault(); }} style={{ 
              display: 'block', 
              padding: '16px', 
              background: 'var(--color-bg-secondary)', 
              borderRadius: '8px',
              border: '1px solid var(--color-border)'
            }}>
              <strong style={{ color: 'var(--color-accent)' }}>Key Modules →</strong>
              <span style={{ color: 'var(--color-text-secondary)' }}> Deep dive into <code>reviewExtension()</code> and <code>showModelPicker()</code> functions</span>
            </a>
            
            <a href="#" onClick={(e) => { e.preventDefault(); }} style={{ 
              display: 'block', 
              padding: '16px', 
              background: 'var(--color-bg-secondary)', 
              borderRadius: '8px',
              border: '1px solid var(--color-border)'
            }}>
              <strong style={{ color: 'var(--color-accent)' }}>Data Flow →</strong>
              <span style={{ color: 'var(--color-text-secondary)' }}> Detailed analysis of the user-to-AI pipeline</span>
            </a>
            
            <a href="#" onClick={(e) => { e.preventDefault(); }} style={{ 
              display: 'block', 
              padding: '16px', 
              background: 'var(--color-bg-secondary)', 
              borderRadius: '8px',
              border: '1px solid var(--color-border)'
            }}>
              <strong style={{ color: 'var(--color-accent)' }}>TypeScript Patterns →</strong>
              <span style={{ color: 'var(--color-text-secondary)' }}> Understanding <code>import type</code>, generics, and type safety</span>
            </a>
            
            <a href="#" onClick={(e) => { e.preventDefault(); }} style={{ 
              display: 'block', 
              padding: '16px', 
              background: 'var(--color-bg-secondary)', 
              borderRadius: '8px',
              border: '1px solid var(--color-border)'
            }}>
              <strong style={{ color: 'var(--color-accent)' }}>Configuration & Entry Points →</strong>
              <span style={{ color: 'var(--color-text-secondary)' }}> How extensions are discovered and registered</span>
            </a>
          </div>
        </div>
      </section>

      {/* Quiz Section */}
      <section className="section">
        <h2 className="section-title">Knowledge Check</h2>
        <div className="section-content">
          <p>
            Test your understanding of the quick-review extension architecture with these questions:
          </p>

          <div style={{ marginTop: '24px' }}>
            <Quiz
              question="Why does the extension use 'import type' instead of regular imports for types?"
              options={[
                "It's faster at runtime because types are optimized",
                "Type imports are erased at compile time, reducing bundle size",
                "Regular imports don't work in TypeScript",
                "It's required by the pi extension system"
              ]}
              correctIndex={1}
              explanation="Type imports (<code>import type</code>) are completely removed during TypeScript compilation. They exist only during development for type checking and provide zero runtime overhead. This is ideal for extension authors who want type safety without shipping type information to users."
            />
          </div>

          <div style={{ marginTop: '24px' }}>
            <Quiz
              question="What is the purpose of the 'default export' in the extension pattern?"
              options={[
                "It marks the most important function in the file",
                "It allows pi to dynamically import the extension",
                "It's required by JavaScript for all modules",
                "It prevents other modules from importing the extension"
              ]}
              correctIndex={1}
              explanation="The default export is pi's entry point convention. When pi loads your extension file, it imports the default export and calls it with the ExtensionAPI instance. This pattern enables dynamic loading and keeps the interface simple and consistent across all extensions."
            />
          </div>

          <div style={{ marginTop: '24px' }}>
            <Quiz
              question="In the fallback chain pattern, what happens if no 'provider' is specified?"
              options={[
                "The code throws an error immediately",
                "It tries to use 'originalModel.provider', or defaults to 'anthropic'",
                "It prompts the user to select a provider",
                "It searches all available providers for the model"
              ]}
              correctIndex={1}
              explanation="The fallback chain <code>provider || originalModel?.provider || 'anthropic'</code> tries each option in sequence. First it checks if a provider was explicitly provided. If not, it uses the current model (if any). If there's no current model, it defaults to 'anthropic'. This provides sensible defaults while respecting user choices."
            />
          </div>

          <div style={{ marginTop: '24px' }}>
            <Quiz
              question="What is the main advantage of the single-file extension design?"
              options={[
                "Better performance due to fewer file operations",
                "Portability — share one file instead of a folder structure",
                "TypeScript works better with single files",
                "It allows faster hot reloading"
              ]}
              correctIndex={1}
              explanation="Single-file extensions offer maximum portability. You can share, copy, and install a single file without managing a folder structure. For focused utilities like code review, this simplicity is a feature, not a limitation. It also means zero configuration — just place the file and pi loads it."
            />
          </div>
        </div>
      </section>

      {/* Key Takeaways */}
      <section className="section">
        <h2 className="section-title">Key Takeaways</h2>
        <div className="section-content">
          <div style={{ 
            background: 'var(--color-accent-bg)', 
            padding: '24px', 
            borderRadius: '8px',
            border: '1px solid var(--color-accent)'
          }}>
            <ul style={{ marginLeft: '24px', lineHeight: '2' }}>
              <li><strong>Plugin Architecture:</strong> Extensions extend pi without modifying core code</li>
              <li><strong>Default Export:</strong> The entry point convention for discovery and loading</li>
              <li><strong>Type-Only Imports:</strong> Type safety without runtime overhead</li>
              <li><strong>Single File:</strong> Maximum portability for focused utilities</li>
              <li><strong>Fallback Chains:</strong> Sensible defaults with graceful degradation</li>
              <li><strong>Manual Parsing:</strong> Simple needs don't require library overhead</li>
            </ul>
          </div>
          
          <p style={{ marginTop: '24px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
            Ready to dive deeper? Continue to <strong>Key Modules</strong> to explore the two main 
            functions in detail.
          </p>
        </div>
      </section>

      <ChapterNavigation chapterId="architecture-overview" />
    </article>
  );
}
