import { FilesCovered } from '../components/FilesCovered';
import { ChapterNavigation } from '../components/ChapterNavigation';
import { CodeBlock } from '../components/CodeBlock';

export function KeyModules() {
  return (
    <article className="chapter-content">
      <header className="chapter-header">
        <p className="chapter-eyebrow">Chapter 2</p>
        <h1 className="chapter-heading">Key Modules</h1>
        <p className="chapter-description">
          This chapter takes a deep dive into the core building blocks of the quick-review 
          extension. We'll examine each major function and module, explaining not just what 
          the code does, but why it was designed that way. By the end, you'll have a thorough 
          understanding of how the extension orchestrates command registration, model selection, 
          and AI communication.
        </p>
      </header>

      <FilesCovered files={['extensions/quick-review.ts']} />

      {/* Architecture Diagram */}
      <section className="section">
        <h2 className="section-title">Extension Architecture at a Glance</h2>
        <div className="section-content">
          <p>Before diving into individual modules, let's visualize how the pieces fit together:</p>
          <div className="diagram-container">
            <svg viewBox="0 0 600 400" className="architecture-diagram">
              {/* Background */}
              <rect width="600" height="400" fill="#f8f9fa" rx="8"/>
              
              {/* User Input */}
              <rect x="220" y="20" width="160" height="40" fill="#e3f2fd" stroke="#1976d2" strokeWidth="2" rx="6"/>
              <text x="300" y="45" textAnchor="middle" fontFamily="Source Code Pro, monospace" fontSize="14" fill="#1976d2">User: /quick-review</text>
              
              {/* Arrow */}
              <path d="M300 65 L300 85" stroke="#666" strokeWidth="2" markerEnd="url(#arrowhead)"/>
              
              {/* Extension API */}
              <rect x="150" y="95" width="300" height="50" fill="#fff3e0" stroke="#f57c00" strokeWidth="2" rx="6"/>
              <text x="300" y="115" textAnchor="middle" fontFamily="Source Code Pro, monospace" fontSize="12" fill="#e65100">pi ExtensionAPI</text>
              <text x="300" y="132" textAnchor="middle" fontFamily="Source Code Pro, monospace" fontSize="11" fill="#666">ctx.ui · ctx.model · ctx.modelRegistry</text>
              
              {/* reviewExtension */}
              <rect x="40" y="170" width="180" height="80" fill="#e8f5e9" stroke="#388e3c" strokeWidth="2" rx="6"/>
              <text x="130" y="195" textAnchor="middle" fontFamily="Source Code Pro, monospace" fontSize="13" fill="#2e7d32" fontWeight="bold">reviewExtension()</text>
              <text x="130" y="215" textAnchor="middle" fontFamily="Noto Sans, sans-serif" fontSize="10" fill="#555">• Register command</text>
              <text x="130" y="230" textAnchor="middle" fontFamily="Noto Sans, sans-serif" fontSize="10" fill="#555">• Parse arguments</text>
              <text x="130" y="245" textAnchor="middle" fontFamily="Noto Sans, sans-serif" fontSize="10" fill="#555">• Select model</text>
              
              {/* showModelPicker */}
              <rect x="380" y="170" width="180" height="80" fill="#fce4ec" stroke="#c2185b" strokeWidth="2" rx="6"/>
              <text x="470" y="195" textAnchor="middle" fontFamily="Source Code Pro, monospace" fontSize="13" fill="#ad1457" fontWeight="bold">showModelPicker()</text>
              <text x="470" y="215" textAnchor="middle" fontFamily="Noto Sans, sans-serif" fontSize="10" fill="#555">• Search UI</text>
              <text x="470" y="230" textAnchor="middle" fontFamily="Noto Sans, sans-serif" fontSize="10" fill="#555">• Keyboard nav</text>
              <text x="470" y="245" textAnchor="middle" fontFamily="Noto Sans, sans-serif" fontSize="10" fill="#555">• Return selection</text>
              
              {/* Arrows to modules */}
              <path d="M300 150 L220 170" stroke="#666" strokeWidth="1.5" strokeDasharray="4,2"/>
              <path d="M300 150 L380 170" stroke="#666" strokeWidth="1.5" strokeDasharray="4,2"/>
              
              {/* Arrowhead marker */}
              <defs>
                <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                  <polygon points="0 0, 10 3.5, 0 7" fill="#666"/>
                </marker>
              </defs>
              
              {/* REVIEW_PROMPT */}
              <rect x="40" y="280" width="160" height="45" fill="#f3e5f5" stroke="#7b1fa2" strokeWidth="2" rx="6"/>
              <text x="120" y="305" textAnchor="middle" fontFamily="Source Code Pro, monospace" fontSize="13" fill="#7b1fa2" fontWeight="bold">REVIEW_PROMPT</text>
              <text x="120" y="320" textAnchor="middle" fontFamily="Noto Sans, sans-serif" fontSize="10" fill="#555">Template string</text>
              
              {/* Arrow down */}
              <path d="M300 155 L300 270" stroke="#666" strokeWidth="1.5" markerEnd="url(#arrowhead)"/>
              
              {/* AI Integration */}
              <rect x="150" y="295" width="300" height="55" fill="#e1f5fe" stroke="#0288d1" strokeWidth="2" rx="6"/>
              <text x="300" y="318" textAnchor="middle" fontFamily="Source Code Pro, monospace" fontSize="13" fill="#0277bd" fontWeight="bold">AI Code Review</text>
              <text x="300" y="338" textAnchor="middle" fontFamily="Noto Sans, sans-serif" fontSize="11" fill="#555">pi.sendUserMessage(prompt)</text>
              
              {/* Arrow to AI */}
              <path d="M300 355 L300 375" stroke="#666" strokeWidth="2" markerEnd="url(#arrowhead)"/>
              
              {/* Final Output */}
              <rect x="200" y="380" width="200" height="15" fill="#fff8e1" stroke="#f9a825" strokeWidth="2" rx="4"/>
              <text x="300" y="391" textAnchor="middle" fontFamily="Noto Sans, sans-serif" fontSize="11" fill="#f57f17">Structured Review Report</text>
            </svg>
          </div>
          <p className="diagram-caption">
            <strong>Figure 1:</strong> Data flow through the quick-review extension, from user command to AI-generated review.
          </p>
        </div>
      </section>

      {/* REVIEW_PROMPT Constant */}
      <section className="section">
        <h2 className="section-title">The Foundation: REVIEW_PROMPT</h2>
        <div className="section-content">
          <p>
            The extension begins with a constant string that serves as the instruction template 
            sent to the AI. This might seem like a simple variable, but it demonstrates an 
            important pattern for prompt engineering.
          </p>
          <CodeBlock
            filename="extensions/quick-review.ts (lines 1-26)"
            code={`const REVIEW_PROMPT = \`You are a code reviewer. Your task is to analyze 
the provided code for:

1. **Bugs and Logic Errors**: Look for off-by-one errors, race 
   conditions, infinite loops, null dereferences...

2. **Security Issues**: Identify injection vulnerabilities 
   (SQL, command, XSS), authentication flaws...

3. **Error Handling Gaps**: Look for missing try-catch blocks, 
   unhandled promise rejections...

Instructions:
- Read the file(s) using the read tool.
- Report each issue with file path, line number, severity, 
  and suggested fix.
- If no issues found, clearly state it.\`;`}
          />
          
          <h3 className="subsection-title">Why a Template Literal?</h3>
          <p>
            Using a template literal (backticks) instead of a regular string offers several 
            advantages for prompt engineering:
          </p>
          <ul className="content-list">
            <li><strong>Multiline strings</strong> — No need for ugly concatenation or escape characters</li>
            <li><strong>Readability</strong> — The structure is clear at a glance</li>
            <li><strong>Future extensibility</strong> — Easy to inject dynamic values using <code>{'$'}{'{variable}'}</code> syntax</li>
          </ul>
          
          <div className="info-box">
            <p className="info-title">💡 TypeScript Insight for JS Developers</p>
            <p>
              Notice there's no type annotation on <code>REVIEW_PROMPT</code>. TypeScript 
              infers it as <code>string</code> automatically. Explicit types are most useful 
              for function parameters and return types where the compiler needs help validating.
            </p>
          </div>
        </div>
      </section>

      {/* Main Entry Point */}
      <section className="section">
        <h2 className="section-title">Main Entry Point: reviewExtension</h2>
        <div className="section-content">
          <p>
            The <code>reviewExtension</code> function is the heart of the extension. It's a 
            default export, meaning pi discovers and loads it automatically. Let's examine 
            it section by section.
          </p>

          <h3 className="subsection-title">Function Signature</h3>
          <CodeBlock
            filename="Function Declaration"
            code={`export default function reviewExtension(pi: ExtensionAPI) {`}
          />
          <p>
            The <code>export default</code> pattern tells JavaScript/TypeScript: "When someone 
            imports this module, give them this function." Pi's extension loader uses this to 
            automatically discover and initialize your extension.
          </p>
          <p>
            The <code>pi: ExtensionAPI</code> parameter is where the magic happens. This is 
            your connection to the pi agent—it provides access to everything the extension 
            needs: registering commands, accessing models, and communicating with the AI.
          </p>

          <h3 className="subsection-title">Command Registration</h3>
          <CodeBlock
            filename="Command Registration"
            code={`pi.registerCommand("quick-review", {
  description: "Review code for bugs, security issues, and error handling gaps",
  handler: async (args, ctx) => {
    // ... implementation
  },
});`}
          />
          <p>
            <code>registerCommand</code> is how extensions add slash commands to pi. Think of 
            it as telling pi: "When the user types <code>/quick-review</code>, run this function."
          </p>
          <ul className="content-list">
            <li><code>"quick-review"</code> — The command name (without the slash)</li>
            <li><code>description</code> — Shown in help text and autocomplete</li>
            <li><code>handler</code> — The async function executed when the command runs</li>
          </ul>

          <h3 className="subsection-title">Argument Parsing</h3>
          <CodeBlock
            filename="Argument Parsing Logic (lines 37-51)"
            code={`const argParts = args.trim().split(/\s+/);

// Parse optional flags
let modelId: string | undefined;
let provider: string | undefined;
const paths: string[] = [];

for (let i = 0; i < argParts.length; i++) {
  const part = argParts[i];
  if (part === "--model" && i + 1 < argParts.length) {
    modelId = argParts[++i];  // Consume next arg as model ID
  } else if (part === "--provider" && i + 1 < argParts.length) {
    provider = argParts[++i]; // Consume next arg as provider
  } else if (!part.startsWith("--")) {
    paths.push(part);
  }
}`}
          />
          
          <p>This manual parsing approach was chosen over using a library for simplicity:</p>
          <div className="comparison-grid">
            <div className="comparison-item">
              <h4>Manual Parsing (Used Here)</h4>
              <ul>
                <li>✓ Zero dependencies</li>
                <li>✓ Full control over behavior</li>
                <li>✓ ~15 lines of code</li>
                <li>✗ Edge cases require care</li>
              </ul>
            </div>
            <div className="comparison-item">
              <h4>Library (e.g., yargs)</h4>
              <ul>
                <li>✓ Battle-tested</li>
                <li>✓ Automatic help generation</li>
                <li>✓ Validation built-in</li>
                <li>✗ Adds bundle size</li>
                <li>✗ Overkill for simple flags</li>
              </ul>
            </div>
          </div>
          
          <div className="info-box">
            <p className="info-title">💡 The <code>++i</code> Trick</p>
            <p>
              Notice <code>argParts[++i]</code> instead of <code>argParts[i + 1]</code>. The 
              pre-increment operator increments <code>i</code> <em>before</em> using it as an 
              index. This consumes both the flag and its value in one step, preventing the 
              next iteration from processing the value as a new argument.
            </p>
          </div>
        </div>
      </section>

      {/* Model Selection Logic */}
      <section className="section">
        <h2 className="section-title">Model Selection: The Brain of the Extension</h2>
        <div className="section-content">
          <p>
            One of the most interesting parts of this extension is its model selection logic. 
            It needs to handle three scenarios gracefully:
          </p>
          <ul className="content-list">
            <li><strong>Explicit model</strong> — User specifies <code>--model claude-sonnet-4</code></li>
            <li><strong>Provider preference</strong> — User specifies <code>--provider anthropic</code></li>
            <li><strong>Interactive selection</strong> — No flags; let user choose</li>
          </ul>

          <h3 className="subsection-title">Fallback Chain Pattern</h3>
          <CodeBlock
            filename="Model Resolution (lines 53-72)"
            code={`if (modelId || provider) {
  let targetModel = modelId
    ? ctx.modelRegistry.find(
        provider || originalModel?.provider || "anthropic", 
        modelId
      )
    : undefined;

  if (!targetModel && provider && !modelId) {
    // Provider only: find first available from that provider
    const available = await ctx.modelRegistry.getAvailable();
    targetModel = available.find(m => m.provider === provider);
  }
  
  // Attempt to switch...
}`}
          />
          
          <p>
            The fallback chain <code>provider || originalModel?.provider || "anthropic"</code> 
            is a common pattern in TypeScript for providing sensible defaults:
          </p>
          <ol className="content-list">
            <li>Use explicitly provided provider</li>
            <li>If none, use the current model's provider</li>
            <li>If still none, default to "anthropic"</li>
          </ol>

          <h3 className="subsection-title">The Optional Chaining Operator</h3>
          <p>
            Notice <code>originalModel?.provider</code>. This is TypeScript's optional chaining, 
            which safely accesses nested properties that might be undefined.
          </p>
          <CodeBlock
            filename="Optional Chaining Comparison"
            code={`// Without optional chaining (potentially crashes)
const p = originalModel.provider;  // TypeError if originalModel is undefined

// With optional chaining (safe)
const p = originalModel?.provider;  // Returns undefined if originalModel is null/undefined

// Chaining works too
const name = originalModel?.info?.name ?? "Unknown";`}
          />
          
          <div className="info-box">
            <p className="info-title">💡 JavaScript Equivalent</p>
            <p>
              Optional chaining (<code>?.</code>) is syntactic sugar for: 
              <code>originalModel != null ? originalModel.provider : undefined</code>. 
              It was added in ES2020 and works in modern Node.js/JavaScript.
            </p>
          </div>
        </div>
      </section>

      {/* showModelPicker */}
      <section className="section">
        <h2 className="section-title">The Model Picker: showModelPicker</h2>
        <div className="section-content">
          <p>
            When no flags are provided, the extension falls back to an interactive TUI for 
            model selection. This is the most complex part of the extension—it builds a 
            custom UI using pi's low-level TUI primitives.
          </p>

          <h3 className="subsection-title">Function Signature and Return Type</h3>
          <CodeBlock
            filename="Async Function with Generic Return"
            code={`async function showModelPicker(
  ctx: { ui: any; theme: any },
  available: Model[]
): Promise<Model | null> {
  return ctx.ui.custom<Model | null>((tui, theme, _keybindings, done) => {
    // TUI implementation...
  });
}`}
          />
          
          <p>This signature demonstrates several TypeScript patterns:</p>
          <ul className="content-list">
            <li><strong>Destructured context</strong> — <code>{`{ ui: any; theme: any }`}</code> extracts only what's needed</li>
            <li><strong>Generic type parameter</strong> — <code>{`Promise<Model | null>`}</code> tells callers exactly what to expect</li>
            <li><strong>Intersection type</strong> — <code>ctx.ui.custom&lt;Model | null&gt;</code> combines the generic with the TUI API</li>
          </ul>

          <h3 className="subsection-title">Building the TUI</h3>
          <CodeBlock
            filename="TUI Component Composition (lines 155-191)"
            code={`// Create container
const container = new Container();

// Build select items from models
const items = available.map(model => ({
  value: \`\${model.provider}/\${model.id}\`,
  label: \`\${model.provider}/\${model.id}\`,
  description: model.name || undefined,
}));

// Create select list and input
const selectList = new SelectList(items, 12, selectListTheme);
const searchInput = new Input("", searchStyle, searchBgStyle);

// Assemble the UI
container.addChild(headerText);
container.addChild(spacer);
container.addChild(searchContainer);  // Label + Input
container.addChild(spacer);
container.addChild(selectList);
container.addChild(spacer);
container.addChild(instructionsText);`}
          />
          
          <p>
            This follows the <strong>Composite Pattern</strong>—individual components 
            (<code>Text</code>, <code>Input</code>, <code>SelectList</code>) are composed 
            into a larger <code>Container</code> that manages them as a unit.
          </p>

          <h3 className="subsection-title">Event Handling</h3>
          <CodeBlock
            filename="Input Routing (lines 195-217)"
            code={`function handleInput(data: string) {
  // Handle escape
  if (matchesKey(data, Key.escape)) {
    done(null);
    return;
  }

  // Handle enter to select
  if (matchesKey(data, Key.enter)) {
    const selected = selectList.getSelectedItem();
    if (selected) {
      const selectedModel = available.find(
        m => \`\${m.provider}/\${m.id}\` === selected.value
      );
      done(selectedModel || null);
    }
    return;
  }

  // Route up/down to select list
  if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
    selectList.handleInput(data);
    tui.requestRender();
    return;
  }

  // Everything else goes to search
  searchInput.handleInput(data);
  selectList.setFilter(searchInput.getValue());
  tui.requestRender();
}`}
          />
          
          <p>
            The <code>handleInput</code> function routes keyboard events to the appropriate 
            handler. This <strong>Router Pattern</strong> is common in UI frameworks:
          </p>
          <ol className="content-list">
            <li>Check for special keys first (Escape, Enter)</li>
            <li>Handle navigation keys (Up, Down)</li>
            <li>Pass everything else to search input</li>
          </ol>
          
          <div className="info-box">
            <p className="info-title">💡 Why Return an Object?</p>
            <p>
              The function returns <code>{`{ render, invalidate, handleInput }`}</code> rather 
              than a class instance. This is a <strong>functional approach</strong> common in 
              React and modern TypeScript—create the object once, let pi call its methods as 
              needed. It's simpler than maintaining class state.
            </p>
          </div>
        </div>
      </section>

      {/* Data Flow Diagram */}
      <section className="section">
        <h2 className="section-title">Data Flow Through the Extension</h2>
        <div className="section-content">
          <p>Let's trace how data moves through the extension with a concrete example:</p>
          
          <div className="diagram-container">
            <svg viewBox="0 0 650 320" className="data-flow-diagram">
              {/* Background */}
              <rect width="650" height="320" fill="#fafafa" rx="8"/>
              
              {/* User Input Box */}
              <rect x="20" y="30" width="610" height="50" fill="#e8f5e9" stroke="#4caf50" strokeWidth="2" rx="6"/>
              <text x="35" y="50" fontFamily="Source Code Pro" fontSize="12" fill="#2e7d32" fontWeight="bold">INPUT:</text>
              <text x="100" y="50" fontFamily="Source Code Pro" fontSize="12" fill="#333">/quick-review --model claude-sonnet-4 src/app.ts</text>
              <text x="35" y="68" fontFamily="Noto Sans" fontSize="10" fill="#666">args = "--model claude-sonnet-4 src/app.ts"</text>
              
              {/* Arrow */}
              <path d="M325 85 L325 105" stroke="#666" strokeWidth="2" markerEnd="url(#arrowhead2)"/>
              
              {/* Parse Results */}
              <rect x="120" y="115" width="410" height="70" fill="#fff3e0" stroke="#ff9800" strokeWidth="2" rx="6"/>
              <text x="140" y="135" fontFamily="Noto Sans" fontSize="11" fontWeight="bold" fill="#e65100">After Parsing:</text>
              <text x="160" y="155" fontFamily="Source Code Pro" fontSize="11" fill="#333">modelId: "claude-sonnet-4"</text>
              <text x="160" y="172" fontFamily="Source Code Pro" fontSize="11" fill="#333">provider: undefined</text>
              <text x="400" y="155" fontFamily="Source Code Pro" fontSize="11" fill="#333">paths: ["src/app.ts"]</text>
              
              {/* Arrow */}
              <path d="M325 195 L325 215" stroke="#666" strokeWidth="2" markerEnd="url(#arrowhead2)"/>
              
              {/* Model Lookup */}
              <rect x="180" y="225" width="290" height="45" fill="#e3f2fd" stroke="#2196f3" strokeWidth="2" rx="6"/>
              <text x="325" y="250" textAnchor="middle" fontFamily="Source Code Pro" fontSize="12" fill="#1565c0" fontWeight="bold">modelRegistry.find("anthropic", "claude-sonnet-4")</text>
              
              {/* Arrow */}
              <path d="M325 280 L325 300" stroke="#666" strokeWidth="2" markerEnd="url(#arrowhead2)"/>
              
              {/* Final */}
              <rect x="250" y="305" width="150" height="12" fill="#fce4ec" stroke="#e91e63" strokeWidth="1" rx="3"/>
              <text x="325" y="314" textAnchor="middle" fontFamily="Source Code Pro" fontSize="10" fill="#c2185b">targetModel: Model | undefined</text>
              
              {/* Arrowhead def */}
              <defs>
                <marker id="arrowhead2" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                  <polygon points="0 0, 10 3.5, 0 7" fill="#666"/>
                </marker>
              </defs>
            </svg>
          </div>
          <p className="diagram-caption">
            <strong>Figure 2:</strong> Data transformation from raw user input to resolved model.
          </p>
        </div>
      </section>

      {/* Summary */}
      <section className="section">
        <h2 className="section-title">Chapter Summary</h2>
        <div className="section-content">
          <p>In this chapter, we explored the key modules that power the quick-review extension:</p>
          
          <div className="summary-grid">
            <div className="summary-card">
              <h4>REVIEW_PROMPT</h4>
              <p>A template literal defining the AI's code review instructions. Uses backticks for readability and future extensibility.</p>
            </div>
            <div className="summary-card">
              <h4>reviewExtension()</h4>
              <p>The default export entry point. Registers the command, parses arguments, handles model selection, and sends prompts to the AI.</p>
            </div>
            <div className="summary-card">
              <h4>showModelPicker()</h4>
              <p>An async function returning a custom TUI component. Uses the Composite pattern to assemble Input, SelectList, and Container.</p>
            </div>
          </div>
          
          <p>Key TypeScript patterns observed:</p>
          <ul className="content-list">
            <li><code>import type</code> for compile-time-only type imports</li>
            <li><code>Promise&lt;T&gt;</code> generic for async return types</li>
            <li><code>?.</code> optional chaining for safe property access</li>
            <li><code>??</code> nullish coalescing for default values</li>
            <li>Destructuring for cleaner parameter handling</li>
          </ul>
        </div>
      </section>

      {/* Quiz */}
      <section className="section quiz-section">
        <h2 className="section-title">Knowledge Check</h2>
        <div className="section-content">
          <p>Test your understanding of the key modules with these questions:</p>
          
          <div className="quiz-question">
            <p className="quiz-prompt"><strong>Q1:</strong> Why does the extension use <code>export default</code> for the main function?</p>
            <div className="quiz-options">
              <label className="quiz-option">
                <input type="radio" name="q1" value="a" />
                <span>To make the function available globally</span>
              </label>
              <label className="quiz-option">
                <input type="radio" name="q1" value="b" />
                <span>So pi's extension loader can automatically discover and import it</span>
              </label>
              <label className="quiz-option">
                <input type="radio" name="q1" value="c" />
                <span>To prevent name collisions with other extensions</span>
              </label>
              <label className="quiz-option">
                <input type="radio" name="q1" value="d" />
                <span>It provides better performance than named exports</span>
              </label>
            </div>
            <details className="quiz-explanation">
              <summary>Show Answer</summary>
              <p><strong>Answer: B</strong></p>
              <p>Pi's extension loader discovers extensions by importing their default export. When you install an extension, pi looks for <code>import default from 'extension-name'</code>. Named exports (<code>export function reviewExtension</code>) would require explicit imports and wouldn't be auto-discovered.</p>
            </details>
          </div>

          <div className="quiz-question">
            <p className="quiz-prompt"><strong>Q2:</strong> What does <code>argParts[++i]</code> do that <code>argParts[i + 1]</code> cannot?</p>
            <div className="quiz-options">
              <label className="quiz-option">
                <input type="radio" name="q2" value="a" />
                <span>Returns the same value, just faster</span>
              </label>
              <label className="quiz-option">
                <input type="radio" name="q2" value="b" />
                <span>Both reads the next element AND increments i to skip it in the next loop iteration</span>
              </label>
              <label className="quiz-option">
                <input type="radio" name="q2" value="c" />
                <span>Converts the argument to a number</span>
              </label>
              <label className="quiz-option">
                <input type="radio" name="q2" value="d" />
                <span>Throws an error if the next element doesn't exist</span>
              </label>
            </div>
            <details className="quiz-explanation">
              <summary>Show Answer</summary>
              <p><strong>Answer: B</strong></p>
              <p>The pre-increment <code>++i</code> increments <code>i</code> <em>before</em> using it. So when <code>i = 0</code> and we encounter <code>--model</code>, <code>argParts[++i]</code> returns <code>argParts[1]</code> (the model ID) AND increments <code>i</code> to 1. The loop then continues from <code>i = 1</code>, effectively skipping the model ID without processing it as a separate argument.</p>
              <p>With <code>argParts[i + 1]</code>, <code>i</code> would still be 0 when the loop continues, causing the model ID to be processed again as a path.</p>
            </details>
          </div>

          <div className="quiz-question">
            <p className="quiz-prompt"><strong>Q3:</strong> What is the purpose of the <code>done</code> callback in <code>ctx.ui.custom&lt;T&gt;</code>?</p>
            <div className="quiz-options">
              <label className="quiz-option">
                <input type="radio" name="q3" value="a" />
                <span>To mark the TUI component as invalid for re-rendering</span>
              </label>
              <label className="quiz-option">
                <input type="radio" name="q3" value="b" />
                <span>To return a value and close the custom UI</span>
              </label>
              <label className="quiz-option">
                <input type="radio" name="q3" value="c" />
                <span>To handle errors during TUI rendering</span>
              </label>
              <label className="quiz-option">
                <input type="radio" name="q3" value="d" />
                <span>To register additional keyboard shortcuts</span>
              </label>
            </div>
            <details className="quiz-explanation">
              <summary>Show Answer</summary>
              <p><strong>Answer: B</strong></p>
              <p>The <code>done(value)</code> callback signals that the user has finished interacting with the custom UI. It closes the TUI and returns <code>value</code> as the Promise resolution. In our model picker, calling <code>done(selectedModel)</code> returns the chosen model, while <code>done(null)</code> indicates cancellation (Escape key).</p>
              <p>This is similar to how callbacks like <code>resolve</code> work in Promise constructors, but it's scoped specifically to UI interaction completion.</p>
            </details>
          </div>

          <div className="quiz-question">
            <p className="quiz-prompt"><strong>Q4:</strong> Which TypeScript feature allows safely accessing <code>originalModel?.provider</code> even when <code>originalModel</code> might be <code>undefined</code>?</p>
            <div className="quiz-options">
              <label className="quiz-option">
                <input type="radio" name="q4" value="a" />
                <span>Type guards</span>
              </label>
              <label className="quiz-option">
                <input type="radio" name="q4" value="b" />
                <span>Non-null assertions</span>
              </label>
              <label className="quiz-option">
                <input type="radio" name="q4" value="c" />
                <span>Optional chaining</span>
              </label>
              <label className="quiz-option">
                <input type="radio" name="q4" value="d" />
                <span>Intersection types</span>
              </label>
            </div>
            <details className="quiz-explanation">
              <summary>Show Answer</summary>
              <p><strong>Answer: C</strong></p>
              <p><strong>Optional chaining</strong> (<code>?.</code>) short-circuits and returns <code>undefined</code> if the left side is <code>null</code> or <code>undefined</code>. It's equivalent to: <code>originalModel != null ? originalModel.provider : undefined</code></p>
              <p>Type guards (A) require <code>if</code> statements. Non-null assertions (B) (<code>!</code>) tell TypeScript "trust me, this isn't null" without runtime safety. Intersection types (D) combine multiple types but don't help with null safety.</p>
            </details>
          </div>
        </div>
      </section>

      <ChapterNavigation chapterId="key-modules" />
    </article>
  );
}
