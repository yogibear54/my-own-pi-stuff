import { FilesCovered } from '../components/FilesCovered';
import { ChapterNavigation } from '../components/ChapterNavigation';
import { CodeBlock } from '../components/CodeBlock';

export function ConfigurationEntry() {
  return (
    <article className="chapter-content">
      <header className="chapter-header">
        <p className="chapter-eyebrow">Chapter 5</p>
        <h1 className="chapter-heading">Configuration & Entry Points</h1>
        <p className="chapter-description">
          This chapter explores how the quick-review extension hooks into the pi coding agent. 
          We'll dissect the entry point pattern, command registration system, and the extension 
          context that enables communication between your extension and pi. By the end, you'll 
          understand not just how to create extensions, but why these patterns exist and how 
          they enable the plugin architecture that makes pi extensible.
        </p>
      </header>

      <FilesCovered files={['extensions/quick-review.ts']} />

      {/* Diagram: Extension Loading Flow */}
      <section className="section">
        <h2 className="section-title">How pi Discovers and Loads Extensions</h2>
        <div className="section-content">
          <p>Before diving into code, let's understand the lifecycle of an extension:</p>
        </div>
        <div className="diagram-container">
          <svg viewBox="0 0 700 320" xmlns="http://www.w3.org/2000/svg" className="architecture-diagram">
            <defs>
              <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="#6b7280" />
              </marker>
            </defs>
            
            {/* pi Core */}
            <rect x="250" y="20" width="200" height="60" rx="8" fill="#f3f4f6" stroke="#374151" strokeWidth="2"/>
            <text x="350" y="55" textAnchor="middle" fontFamily="Source Code Pro" fontSize="14" fill="#111827">pi Agent Core</text>
            
            {/* Arrow down */}
            <line x1="350" y1="80" x2="350" y2="110" stroke="#6b7280" strokeWidth="2" markerEnd="url(#arrowhead)"/>
            <text x="370" y="98" fontFamily="Noto Sans" fontSize="11" fill="#6b7280">import default export</text>
            
            {/* Extension Loader */}
            <rect x="250" y="110" width="200" height="50" rx="8" fill="#dbeafe" stroke="#2563eb" strokeWidth="2"/>
            <text x="350" y="140" textAnchor="middle" fontFamily="Source Code Pro" fontSize="13" fill="#1e40af">ExtensionLoader</text>
            
            {/* Arrow down */}
            <line x1="350" y1="160" x2="350" y2="190" stroke="#6b7280" strokeWidth="2" markerEnd="url(#arrowhead)"/>
            
            {/* Extension Instance */}
            <rect x="200" y="190" width="300" height="110" rx="8" fill="#ecfdf5" stroke="#059669" strokeWidth="2"/>
            <text x="350" y="215" textAnchor="middle" fontFamily="Source Code Pro" fontSize="13" fill="#047857">ExtensionAPI</text>
            
            {/* Extension internals */}
            <rect x="220" y="230" width="260" height="55" rx="4" fill="#f9fafb" stroke="#d1d5db" strokeWidth="1"/>
            <text x="240" y="252" fontFamily="Source Code Pro" fontSize="11" fill="#374151">registerCommand(name, config)</text>
            <text x="240" y="270" fontFamily="Source Code Pro" fontSize="11" fill="#374151">setModel(model)</text>
            <text x="240" y="288" fontFamily="Source Code Pro" fontSize="11" fill="#374151">sendUserMessage(msg)</text>
            
            {/* Context side */}
            <rect x="520" y="190" width="140" height="110" rx="8" fill="#fef3c7" stroke="#d97706" strokeWidth="2"/>
            <text x="590" y="215" textAnchor="middle" fontFamily="Source Code Pro" fontSize="12" fill="#92400e">Handler Context</text>
            <text x="535" y="240" fontFamily="Source Code Pro" fontSize="10" fill="#78350f">ctx.ui</text>
            <text x="535" y="256" fontFamily="Source Code Pro" fontSize="10" fill="#78350f">ctx.model</text>
            <text x="535" y="272" fontFamily="Source Code Pro" fontSize="10" fill="#78350f">ctx.modelRegistry</text>
            <text x="535" y="288" fontFamily="Source Code Pro" fontSize="10" fill="#78350f">ctx.workingDir</text>
            
            {/* Arrow from extension to context */}
            <line x1="500" y1="245" x2="515" y2="245" stroke="#6b7280" strokeWidth="1.5" markerEnd="url(#arrowhead)"/>
          </svg>
          <p className="diagram-caption">Figure 1: Extension loading lifecycle from pi core to registered commands</p>
        </div>
        
        <div className="section-content">
          <p>
            Think of pi's extension system like a <strong>hotel concierge service</strong>. When you (pi) 
            start up, you don't know which services guests (extensions) will need. Instead of hardcoding 
            every possible service, you provide a standardized interface: "If you need anything, ask me 
            via this ExtensionAPI, and I'll handle it."
          </p>
          <p>
            Extensions work the same way—they don't get direct access to pi's internals. Instead, they 
            receive a standardized API object and use it to register their capabilities.
          </p>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">The Default Export Entry Point</h2>
        <div className="section-content">
          <p>
            Every pi extension must export exactly one thing as its default export: a function that 
            receives the ExtensionAPI. This is the <strong>entrance contract</strong> between pi and your 
            extension.
          </p>
        </div>
        <CodeBlock
          filename="extensions/quick-review.ts (lines 1-7)"
          code={`/**
 * Review Command Extension
 *
 * Registers a /quick-review command that performs code reviews in the current pi session.
 * Analyzes code for bugs, security issues, and error handling gaps.
 *
 * Usage:
 *   /quick-review <file-or-directory>          # Review a specific file or directory
 *   /quick-review --model claude-sonnet-4 file   # Use specific model (skips prompt)
 *   /quick-review --provider anthropic file      # Use specific provider (skips prompt)
 */`}
        />
        <div className="section-content">
          <p>
            The JSDoc comment serves as documentation that pi might display in help menus. Notice the 
            <strong> usage examples</strong>—these teach users how to invoke the extension without 
            requiring external documentation.
          </p>
        </div>
        
        <h3 className="subsection-title">Type Imports: Why "import type" Matters</h3>
        <div className="section-content">
          <p>
            For JavaScript developers new to TypeScript, this pattern might look strange:
          </p>
        </div>
        <CodeBlock
          filename="Type-Only Imports"
          code={`import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { Model } from "@mariozechner/pi-ai";`}
        />
        <div className="section-content">
          <p>
            The <code>import type</code> syntax tells TypeScript: "I only need the <em>type information</em>, 
            not the runtime value." This is important because:
          </p>
          <ul style={{ marginLeft: '24px', marginTop: '12px' }}>
            <li><strong>Zero runtime cost</strong>: TypeScript erases these imports during compilation. They 
                don't appear in the final JavaScript bundle.</li>
            <li><strong>Smaller bundles</strong>: Your extension ships less code to users.</li>
            <li><strong>No circular dependency issues</strong>: Since types are erased, you can't create 
                circular references through type imports.</li>
          </ul>
          <p style={{ marginTop: '16px' }}>
            <em>Analogy</em>: Think of <code>import type</code> like reading a recipe card. The card tells 
            you what ingredients you need, but you don't eat the card itself. The actual ingredients 
            (runtime values) come from elsewhere.
          </p>
        </div>

        <h3 className="subsection-title">The Entry Point Function</h3>
        <div className="section-content">
          <p>
            Now let's examine the actual entry point:
          </p>
        </div>
        <CodeBlock
          filename="extensions/quick-review.ts (lines 33-42)"
          code={`export default function reviewExtension(pi: ExtensionAPI) {
	pi.registerCommand("quick-review", {
		description: "Review code for bugs, security issues, and error handling gaps",
		handler: async (args, ctx) => {
			// ... implementation
		},
	});
}`}
        />
        <div className="section-content">
          <p><strong>Line-by-line breakdown:</strong></p>
          <ul style={{ marginLeft: '24px', marginTop: '12px' }}>
            <li><code>export default function</code>: ESM default export—this is how pi discovers your extension</li>
            <li><code>(pi: ExtensionAPI)</code>: Parameter typed as ExtensionAPI; pi passes itself when loading</li>
            <li><code>pi.registerCommand(...)</code>: The method call that registers your command</li>
            <li><code>"quick-review"</code>: The command name users will type as <code>/quick-review</code></li>
            <li><code>description</code>: Human-readable description shown in help menus</li>
            <li><code>handler</code>: Async function called when the command is invoked</li>
          </ul>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Command Registration Deep Dive</h2>
        <div className="section-content">
          <p>
            The <code>registerCommand</code> method is the core of pi's extension system. Let's 
            examine how the quick-review extension uses it:
          </p>
        </div>
        <CodeBlock
          filename="Command Registration (simplified)"
          code={`pi.registerCommand("quick-review", {
  // Human-readable description for help menus
  description: "Review code for bugs, security issues, and error handling gaps",
  
  // The async function that executes when user types /quick-review
  handler: async (args, ctx) => {
    // args: The raw string after /quick-review
    // ctx: Context object with ui, model, modelRegistry, etc.
  }
});`}
        />
        <div className="section-content">
          <h3 className="subsection-title">The Handler Function Signature</h3>
          <p>
            The handler receives two parameters:
          </p>
        </div>
        <CodeBlock
          filename="Handler Parameters"
          code={`handler: async (args: string, ctx: HandlerContext) => {
  // args = "/quick-review --model claude-sonnet-4 src/app.ts"
  // ctx = { ui, model, modelRegistry, workingDir, ... }
}`}
        />
        <div className="section-content">
          <p>
            <strong>Why an async function?</strong> The handler is async because most useful 
            operations—reading files, calling AI models, showing UI—require waiting for I/O. By 
            marking it <code>async</code>, pi can properly await completion before considering 
            the command finished.
          </p>
          <p style={{ marginTop: '16px' }}>
            <em>For JavaScript developers</em>: The <code>async</code> keyword is syntactic sugar. 
            Under the hood, it wraps your function's return value in a Promise. The <code>await</code> 
            keyword pauses execution until the Promise resolves.
          </p>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Argument Parsing: From Raw String to Structured Data</h2>
        <div className="section-content">
          <p>
            When a user types <code>/quick-review --model claude-sonnet-4 src/file.ts</code>, 
            pi passes the entire string after the command name to your handler. The extension 
            must parse this raw string into usable data:
          </p>
        </div>
        <CodeBlock
          filename="Argument Parsing Implementation"
          code={`// Line 44: Get raw argument string and split on whitespace
const argParts = args.trim().split(/\s+/);

// Line 47: Initialize variables to hold parsed values
let modelId: string | undefined;
let provider: string | undefined;
const paths: string[] = [];

// Lines 49-59: Loop through arguments, handling flags and paths
for (let i = 0; i < argParts.length; i++) {
  const part = argParts[i];
  
  if (part === "--model" && i + 1 < argParts.length) {
    // Found --model flag, consume the next argument as its value
    modelId = argParts[++i];  // ++i advances i and returns the NEW value
  } else if (part === "--provider" && i + 1 < argParts.length) {
    provider = argParts[++i];
  } else if (!part.startsWith("--")) {
    // Not a flag, treat as a file/directory path
    paths.push(part);
  }
}

// Line 61: Default to current directory if no paths specified
const target = paths.join(" ") || ".";`}
        />
        <div className="section-content">
          <p>
            <strong>Design Decision: Why manual parsing instead of a library?</strong>
          </p>
          <ul style={{ marginLeft: '24px', marginTop: '12px' }}>
            <li><strong>Minimal dependencies</strong>: Using a CLI argument parser would add bundle size</li>
            <li><strong>Simple flag structure</strong>: This extension only needs two flags (<code>--model</code>, 
                <code>--provider</code>) and positional arguments</li>
            <li><strong>Predictable behavior</strong>: Manual parsing gives exact control over edge cases</li>
          </ul>
          <p style={{ marginTop: '16px' }}>
            <em>Trade-off</em>: For more complex CLI tools (many flags, subcommands, validation), a library 
            like <code>yargs</code> or <code>commander</code> would be worth the added complexity.
          </p>
        </div>
        
        <h3 className="subsection-title">Supported Command Patterns</h3>
        <div className="section-content">
          <p>The extension recognizes these invocation patterns:</p>
        </div>
        <CodeBlock
          filename="Supported Usage Patterns"
          code={`/quick-review                                    # Review current directory
/quick-review src/app.ts                         # Review single file
/quick-review src/components src/utils           # Review multiple paths
/quick-review --model claude-sonnet-4 file       # Use specific model
/quick-review --provider openai file              # Use first available OpenAI model
/quick-review --model sonnet --provider anthropic # Full specification`}
        />
        <div className="section-content">
          <p>
            Notice the <strong>fallback behavior</strong>: you can specify just <code>--provider</code> 
            without <code>--model</code>, and the extension will use the first available model from 
            that provider. This makes the API more ergonomic for common use cases.
          </p>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">The Extension Context Object</h2>
        <div className="section-content">
          <p>
            The <code>ctx</code> object passed to your handler is pi's way of giving you access to 
            everything you need. Let's map out its key properties:
          </p>
        </div>
        
        {/* Diagram: Context Object */}
        <div className="diagram-container">
          <svg viewBox="0 0 600 400" xmlns="http://www.w3.org/2000/svg" className="architecture-diagram">
            <defs>
              <marker id="arrow" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="#6b7280" />
              </marker>
            </defs>
            
            {/* Context Object */}
            <rect x="175" y="20" width="250" height="360" rx="8" fill="#fef3c7" stroke="#d97706" strokeWidth="2"/>
            <text x="300" y="50" textAnchor="middle" fontFamily="Source Code Pro" fontSize="14" fill="#92400e" fontWeight="bold">HandlerContext</text>
            
            {/* ctx.ui */}
            <rect x="195" y="70" width="210" height="90" rx="4" fill="#ecfdf5" stroke="#059669" strokeWidth="1.5"/>
            <text x="210" y="92" fontFamily="Source Code Pro" fontSize="12" fill="#047857" fontWeight="bold">ctx.ui</text>
            <text x="210" y="112" fontFamily="Source Code Pro" fontSize="10" fill="#065f46">notify(msg, type)</text>
            <text x="210" y="128" fontFamily="Source Code Pro" fontSize="10" fill="#065f46">select(question, opts)</text>
            <text x="210" y="144" fontFamily="Source Code Pro" fontSize="10" fill="#065f46">custom&lt;T&gt;(renderFn)</text>
            
            {/* ctx.model */}
            <rect x="195" y="170" width="210" height="50" rx="4" fill="#dbeafe" stroke="#2563eb" strokeWidth="1.5"/>
            <text x="210" y="192" fontFamily="Source Code Pro" fontSize="12" fill="#1e40af" fontWeight="bold">ctx.model</text>
            <text x="210" y="208" fontFamily="Source Code Pro" fontSize="10" fill="#1e3a8a">{"{"}" provider, id, name? "{"}"}</text>
            
            {/* ctx.modelRegistry */}
            <rect x="195" y="230" width="210" height="70" rx="4" fill="#fce7f3" stroke="#db2777" strokeWidth="1.5"/>
            <text x="210" y="252" fontFamily="Source Code Pro" fontSize="12" fill="#9d174d" fontWeight="bold">ctx.modelRegistry</text>
            <text x="210" y="272" fontFamily="Source Code Pro" fontSize="10" fill="#831843">.find(provider, modelId)</text>
            <text x="210" y="288" fontFamily="Source Code Pro" fontSize="10" fill="#831843">.getAvailable()</text>
            
            {/* pi object */}
            <rect x="425" y="100" width="155" height="100" rx="8" fill="#e0e7ff" stroke="#4338ca" strokeWidth="2"/>
            <text x="502" y="125" textAnchor="middle" fontFamily="Source Code Pro" fontSize="12" fill="#3730a3" fontWeight="bold">ExtensionAPI</text>
            <text x="440" y="148" fontFamily="Source Code Pro" fontSize="10" fill="#312e81">pi.setModel(model)</text>
            <text x="440" y="164" fontFamily="Source Code Pro" fontSize="10" fill="#312e81">pi.sendUserMessage()</text>
            <text x="440" y="180" fontFamily="Source Code Pro" fontSize="10" fill="#312e81">pi.readFile(path)</text>
            
            {/* Arrows from context to pi */}
            <line x1="405" y1="150" x2="420" y2="150" stroke="#6b7280" strokeWidth="1.5" markerEnd="url(#arrow)"/>
            <line x1="405" y1="180" x2="420" y2="180" stroke="#6b7280" strokeWidth="1.5" markerEnd="url(#arrow)"/>
            
            {/* Additional context properties */}
            <rect x="195" y="310" width="210" height="50" rx="4" fill="#f3f4f6" stroke="#6b7280" strokeWidth="1.5"/>
            <text x="210" y="332" fontFamily="Source Code Pro" fontSize="11" fill="#374151">ctx.workingDir</text>
            <text x="300" y="332" fontFamily="Source Code Pro" fontSize="11" fill="#6b7280"> ...more</text>
          </svg>
          <p className="diagram-caption">Figure 2: The HandlerContext object and its relationship to ExtensionAPI</p>
        </div>

        <h3 className="subsection-title">ctx.ui: User Interaction Methods</h3>
        <div className="section-content">
          <p>
            The <code>ctx.ui</code> object provides methods for interacting with the user:
          </p>
        </div>
        <CodeBlock
          filename="UI Interaction Examples"
          code={`// Show a notification to the user
ctx.ui.notify(\`🔍 Starting code review for: \${target}\`, "info");

// Ask the user a question with predefined options
const switchChoice = await ctx.ui.select(
  \`Review using current model (\${currentModelName}) or switch?\`,
  [
    \`Keep current model (\${currentModelName})\`,
    "Switch to a different model",
  ]
);

// Create a custom TUI component (see showModelPicker)
// ctx.ui.custom<Model | null>((tui, theme, keybindings, done) => { ... })`}
        />
        <div className="section-content">
          <p>
            <strong>Why these abstractions?</strong> pi uses a terminal UI (TUI) paradigm. Rather than 
            using <code>console.log</code> or browser dialogs, you use <code>ctx.ui</code> methods 
            that render properly in the terminal. This keeps the experience consistent across all 
            commands.
          </p>
        </div>

        <h3 className="subsection-title">ctx.modelRegistry: Finding Available Models</h3>
        <div className="section-content">
          <p>
            The model registry allows you to query available AI models:
          </p>
        </div>
        <CodeBlock
          filename="Model Registry Usage"
          code={`// Find a specific model by provider and ID
const targetModel = ctx.modelRegistry.find(
  provider || originalModel?.provider || "anthropic",
  modelId
);

// Get all available models (those with configured API keys)
const available = await ctx.modelRegistry.getAvailable();`}
        />
        <div className="section-content">
          <p>
            <strong>Why a registry pattern?</strong> Instead of hardcoding model names, pi maintains 
            a registry that can be configured externally. Users might add custom models or API providers. 
            The registry abstracts these details away.
          </p>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">ExtensionAPI: Methods for Extension Control</h2>
        <div className="section-content">
          <p>
            The <code>pi</code> object (distinct from <code>ctx</code>) provides methods for controlling 
            pi's behavior:
          </p>
        </div>
        <CodeBlock
          filename="ExtensionAPI Methods Used in quick-review"
          code={`// Switch the active AI model
const success = await pi.setModel(targetModel);
if (success) {
  ctx.ui.notify(\`Switched to model: \${targetModel.provider}/\${targetModel.id}\`, "info");
}

// Send a message to the AI (triggers AI response)
const fullPrompt = \`\${REVIEW_PROMPT}\\n\\nPlease review: \${target}\`;
pi.sendUserMessage(fullPrompt);`}
        />
        <div className="section-content">
          <h3 className="subsection-title">Understanding the setModel Flow</h3>
          <p>
            The <code>setModel()</code> method demonstrates defensive programming:
          </p>
        </div>
        <CodeBlock
          filename="Defensive Model Switching"
          code={`if (targetModel) {
  // Attempt to switch to the requested model
  const success = await pi.setModel(targetModel);
  
  if (success) {
    // Model switch succeeded
    ctx.ui.notify(\`Switched to model: \${...}\`, "info");
  } else {
    // API key not configured—inform user but continue
    ctx.ui.notify(\`⚠️ No API key available for \${...}, using current model\`, "warning");
  }
}`}
        />
        <div className="section-content">
          <p>
            <strong>Why handle the failure case?</strong> The model might exist in the registry but 
            lack a configured API key. Rather than failing completely, the extension gracefully 
            falls back to the current model. This is better UX—users can still get code reviews 
            even with partial configuration.
          </p>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Putting It All Together: Command Lifecycle</h2>
        <div className="section-content">
          <p>
            Let's trace the complete execution path when a user types <code>/quick-review src/app.ts</code>:
          </p>
        </div>
        
        {/* Flow diagram */}
        <div className="diagram-container">
          <svg viewBox="0 0 700 480" xmlns="http://www.w3.org/2000/svg" className="architecture-diagram">
            <defs>
              <marker id="arrowEnd" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="#6b7280" />
              </marker>
            </defs>
            
            {/* Step 1 */}
            <rect x="250" y="10" width="200" height="40" rx="6" fill="#dbeafe" stroke="#2563eb" strokeWidth="1.5"/>
            <text x="350" y="35" textAnchor="middle" fontFamily="Source Code Pro" fontSize="11" fill="#1e40af">User types /quick-review src/app.ts</text>
            
            {/* Arrow */}
            <line x1="350" y1="50" x2="350" y2="70" stroke="#6b7280" strokeWidth="1.5" markerEnd="url(#arrowEnd)"/>
            
            {/* Step 2 */}
            <rect x="250" y="70" width="200" height="40" rx="6" fill="#f3f4f6" stroke="#374151" strokeWidth="1.5"/>
            <text x="350" y="95" textAnchor="middle" fontFamily="Source Code Pro" fontSize="11" fill="#374151">pi invokes registered handler</text>
            <text x="350" y="107" textAnchor="middle" fontFamily="Noto Sans" fontSize="9" fill="#6b7280">args = "src/app.ts", ctx = ...</text>
            
            {/* Arrow */}
            <line x1="350" y1="110" x2="350" y2="130" stroke="#6b7280" strokeWidth="1.5" markerEnd="url(#arrowEnd)"/>
            
            {/* Step 3 */}
            <rect x="250" y="130" width="200" height="50" rx="6" fill="#fef3c7" stroke="#d97706" strokeWidth="1.5"/>
            <text x="350" y="152" textAnchor="middle" fontFamily="Source Code Pro" fontSize="11" fill="#92400e">Parse Arguments</text>
            <text x="350" y="167" textAnchor="middle" fontFamily="Noto Sans" fontSize="9" fill="#78350f">paths = ["src/app.ts"], modelId = undefined</text>
            
            {/* Arrow */}
            <line x1="350" y1="180" x2="350" y2="200" stroke="#6b7280" strokeWidth="1.5" markerEnd="url(#arrowEnd)"/>
            
            {/* Step 4 */}
            <rect x="250" y="200" width="200" height="50" rx="6" fill="#fce7f3" stroke="#db2777" strokeWidth="1.5"/>
            <text x="350" y="222" textAnchor="middle" fontFamily="Source Code Pro" fontSize="11" fill="#9d174d">Show Model Selection UI</text>
            <text x="350" y="237" textAnchor="middle" fontFamily="Noto Sans" fontSize="9" fill="#831843">ctx.ui.select(...) → await → user choice</text>
            
            {/* Arrow */}
            <line x1="350" y1="250" x2="350" y2="270" stroke="#6b7280" strokeWidth="1.5" markerEnd="url(#arrowEnd)"/>
            
            {/* Step 5 */}
            <rect x="250" y="270" width="200" height="50" rx="6" fill="#ecfdf5" stroke="#059669" strokeWidth="1.5"/>
            <text x="350" y="292" textAnchor="middle" fontFamily="Source Code Pro" fontSize="11" fill="#047857">Construct Review Prompt</text>
            <text x="350" y="307" textAnchor="middle" fontFamily="Noto Sans" fontSize="9" fill="#065f46">REVIEW_PROMPT + "\n\nPlease review: src/app.ts"</text>
            
            {/* Arrow */}
            <line x1="350" y1="320" x2="350" y2="340" stroke="#6b7280" strokeWidth="1.5" markerEnd="url(#arrowEnd)"/>
            
            {/* Step 6 */}
            <rect x="250" y="340" width="200" height="40" rx="6" fill="#e0e7ff" stroke="#4338ca" strokeWidth="1.5"/>
            <text x="350" y="365" textAnchor="middle" fontFamily="Source Code Pro" fontSize="11" fill="#3730a3">pi.sendUserMessage(fullPrompt)</text>
            
            {/* Arrow */}
            <line x1="350" y1="380" x2="350" y2="400" stroke="#6b7280" strokeWidth="1.5" markerEnd="url(#arrowEnd)"/>
            
            {/* Step 7 */}
            <rect x="250" y="400" width="200" height="40" rx="6" fill="#dbeafe" stroke="#2563eb" strokeWidth="1.5"/>
            <text x="350" y="425" textAnchor="middle" fontFamily="Source Code Pro" fontSize="11" fill="#1e40af">AI reads file, analyzes, responds</text>
            
            {/* Side annotations */}
            <text x="470" y="145" fontFamily="Noto Sans" fontSize="10" fill="#6b7280">args.trim()</text>
            <text x="470" y="157" fontFamily="Noto Sans" fontSize="10" fill="#6b7280">.split(/\s+/)</text>
            
            <text x="470" y="275" fontFamily="Noto Sans" fontSize="10" fill="#6b7280">if no flags:</text>
            <text x="470" y="287" fontFamily="Noto Sans" fontSize="10" fill="#6b7280">show picker UI</text>
          </svg>
          <p className="diagram-caption">Figure 3: Complete lifecycle of /quick-review command execution</p>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Cross-Chapter Connections</h2>
        <div className="section-content">
          <p>
            The concepts in this chapter connect to other parts of the codebase:
          </p>
        </div>
        <div className="cross-references">
          <div className="cross-ref-item">
            <span className="cross-ref-label">Architecture Overview</span>
            <p>The default export pattern and single-file architecture discussed here define the overall 
               structure explained in <a href="#" onClick={(e) => { e.preventDefault(); }}>Chapter 1</a>.</p>
          </div>
          <div className="cross-ref-item">
            <span className="cross-ref-label">Key Modules</span>
            <p>The <code>reviewExtension</code> function is the entry point analyzed in 
               <a href="#" onClick={(e) => { e.preventDefault(); }}> Chapter 2</a>. The showModelPicker 
               uses ctx.ui.custom() documented here.</p>
          </div>
          <div className="cross-ref-item">
            <span className="cross-ref-label">Data Flow</span>
            <p>The ctx object properties (model, modelRegistry) flow through the data pipeline 
               described in <a href="#" onClick={(e) => { e.preventDefault(); }}> Chapter 3</a>.</p>
          </div>
          <div className="cross-ref-item">
            <span className="cross-ref-label">TypeScript Patterns</span>
            <p>The ExtensionAPI type, HandlerContext, and async handler function are TypeScript 
               patterns detailed in <a href="#" onClick={(e) => { e.preventDefault(); }}> Chapter 4</a>.</p>
          </div>
        </div>
      </section>

      <section className="section quiz-section">
        <h2 className="section-title">Knowledge Check</h2>
        <div className="section-content">
          <p>Test your understanding of configuration and entry points:</p>
        </div>
        
        <div className="quiz-container">
          <div className="quiz-question" data-correct="c">
            <h4>Question 1</h4>
            <p>Why does pi use a default export for extensions rather than a named export?</p>
            <div className="quiz-options">
              <label><input type="radio" name="q1" value="a" /> Default exports are faster to execute</label>
              <label><input type="radio" name="q1" value="b" /> Named exports don't work with ES modules</label>
              <label><input type="radio" name="q1" value="c" /> Default exports allow a single entry point per module, simplifying the loader</label>
              <label><input type="radio" name="q1" value="d" /> TypeScript requires default exports for extension APIs</label>
            </div>
            <div className="quiz-explanation">
              <strong>Answer: C</strong> — A default export provides a clear, single entry point per module. 
              This simplifies pi's extension loader: it knows exactly what to import from each extension file. 
              Named exports would require pi to know the specific names of exported functions, reducing flexibility.
            </div>
          </div>

          <div className="quiz-question" data-correct="b">
            <h4>Question 2</h4>
            <p>What is the purpose of <code>import type</code> vs regular imports?</p>
            <div className="quiz-options">
              <label><input type="radio" name="q2" value="a" /> Type imports are faster at runtime</label>
              <label><input type="radio" name="q2" value="b" /> Type imports are erased at compile time, reducing bundle size</label>
              <label><input type="radio" name="q2" value="c" /> Regular imports can't access types</label>
              <label><input type="radio" name="q2" value="d" /> There is no difference in modern TypeScript</label>
            </div>
            <div className="quiz-explanation">
              <strong>Answer: B</strong> — <code>import type</code> tells TypeScript to only use the import 
              for type checking. During compilation, these imports are completely removed, resulting in 
              smaller JavaScript bundles. This is important for extensions where bundle size affects 
              load times.
            </div>
          </div>

          <div className="quiz-question" data-correct="d">
            <h4>Question 3</h4>
            <p>What is the difference between the <code>pi</code> object and the <code>ctx</code> object in a handler?</p>
            <div className="quiz-options">
              <label><input type="radio" name="q3" value="a" /> They are the same object</label>
              <label><input type="radio" name="q3" value="b" /> pi is for UI, ctx is for model control</label>
              <label><input type="radio" name="q3" value="c" /> pi is global, ctx is command-specific</label>
              <label><input type="radio" name="q3" value="d" /> pi provides control methods (setModel, sendUserMessage), ctx provides session context (ui, model, registry)</label>
            </div>
            <div className="quiz-explanation">
              <strong>Answer: D</strong> — The <code>pi</code> object (ExtensionAPI) provides methods to 
              control pi's behavior, while <code>ctx</code> (HandlerContext) provides information about 
              the current session and user interface. Think of pi as your toolset and ctx as the 
              environment you're working in.
            </div>
          </div>

          <div className="quiz-question" data-correct="c">
            <h4>Question 4</h4>
            <p>Why does the extension handle the case where <code>pi.setModel()</code> returns false?</p>
            <div className="quiz-options">
              <label><input type="radio" name="q4" value="a" /> The method always returns true</label>
              <label><input type="radio" name="q4" value="b" /> Returning false indicates a bug in the code</label>
              <label><input type="radio" name="q4" value="c" /> The model might exist but lack a configured API key; graceful fallback provides better UX</label>
              <label><input type="radio" name="q4" value="d" /> It's required by the ExtensionAPI specification</label>
            </div>
            <div className="quiz-explanation">
              <strong>Answer: C</strong> — Even if a model is registered, it might not have a configured 
              API key. Rather than failing completely, the extension falls back to the current model. 
              This defensive programming ensures users can still get code reviews even with incomplete 
              configuration.
            </div>
          </div>
        </div>
      </section>

      <ChapterNavigation chapterId="configuration-entry" />
    </article>
  );
}
