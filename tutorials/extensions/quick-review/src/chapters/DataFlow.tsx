import { FilesCovered } from '../components/FilesCovered';
import { ChapterNavigation } from '../components/ChapterNavigation';
import { CodeBlock } from '../components/CodeBlock';

export function DataFlow() {
  return (
    <article className="chapter-content">
      <header className="chapter-header">
        <p className="chapter-eyebrow">Chapter 3</p>
        <h1 className="chapter-heading">Data Flow</h1>
        <p className="chapter-description">
          This chapter traces how data moves through the quick-review extension—from the moment
          a user types <code>/quick-review</code> to when the AI returns its code analysis.
          Understanding this flow is essential for debugging, extending, or contributing to the
          extension. We'll follow the data step-by-step, explaining not just what happens but
          why each design decision was made.
        </p>
      </header>

      <FilesCovered files={['extensions/quick-review.ts']} />

      {/* Diagram: High-Level Flow */}
      <section className="section">
        <h2 className="section-title">High-Level Data Flow</h2>
        <div className="section-content">
          <p>When you invoke <code>/quick-review</code>, data travels through several distinct stages:</p>
          
          <svg width="100%" viewBox="0 0 800 320" style={{ marginTop: '24px', maxWidth: '800px' }}>
            <defs>
              <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="#6366f1"/>
              </marker>
            </defs>
            
            {/* Stage boxes */}
            <rect x="20" y="40" width="140" height="80" rx="8" fill="#f1f5f9" stroke="#6366f1" strokeWidth="2"/>
            <text x="90" y="75" textAnchor="middle" fontSize="13" fontWeight="600" fill="#1e293b">User Input</text>
            <text x="90" y="95" textAnchor="middle" fontSize="11" fill="#64748b">/quick-review</text>
            
            <rect x="220" y="40" width="140" height="80" rx="8" fill="#ede9fe" stroke="#8b5cf6" strokeWidth="2"/>
            <text x="290" y="75" textAnchor="middle" fontSize="13" fontWeight="600" fill="#1e293b">Arg Parsing</text>
            <text x="290" y="95" textAnchor="middle" fontSize="11" fill="#64748b">flags, paths</text>
            
            <rect x="420" y="40" width="140" height="80" rx="8" fill="#dbeafe" stroke="#3b82f6" strokeWidth="2"/>
            <text x="490" y="75" textAnchor="middle" fontSize="13" fontWeight="600" fill="#1e293b">Model Select</text>
            <text x="490" y="95" textAnchor="middle" fontSize="11" fill="#64748b">registry lookup</text>
            
            <rect x="620" y="40" width="140" height="80" rx="8" fill="#dcfce7" stroke="#22c55e" strokeWidth="2"/>
            <text x="690" y="75" textAnchor="middle" fontSize="13" fontWeight="600" fill="#1e293b">AI Request</text>
            <text x="690" y="95" textAnchor="middle" fontSize="11" fill="#64748b">sendUserMessage</text>
            
            {/* Arrows */}
            <line x1="160" y1="80" x2="220" y2="80" stroke="#6366f1" strokeWidth="2" markerEnd="url(#arrowhead)"/>
            <line x1="360" y1="80" x2="420" y2="80" stroke="#6366f1" strokeWidth="2" markerEnd="url(#arrowhead)"/>
            <line x1="560" y1="80" x2="620" y2="80" stroke="#6366f1" strokeWidth="2" markerEnd="url(#arrowhead)"/>
            
            {/* Data outputs */}
            <rect x="20" y="180" width="740" height="120" rx="8" fill="#fef3c7" stroke="#f59e0b" strokeWidth="2"/>
            <text x="390" y="210" textAnchor="middle" fontSize="14" fontWeight="600" fill="#92400e">Data Transformations</text>
            
            <text x="60" y="240" fontSize="11" fill="#78350f">args: string</text>
            <text x="240" y="240" fontSize="11" fill="#78350f">→ modelId, provider, paths[]</text>
            <text x="480" y="240" fontSize="11" fill="#78350f">→ Model | undefined</text>
            <text x="680" y="240" fontSize="11" fill="#78350f">→ Review Report</text>
            
            <text x="60" y="265" fontSize="11" fill="#78350f">ctx: ExtensionContext</text>
            <text x="240" y="265" fontSize="11" fill="#78350f">→ "src/file.ts"</text>
            <text x="480" y="265" fontSize="11" fill="#78350f">→ switched model</text>
            <text x="680" y="265" fontSize="11" fill="#78350f"></text>
          </svg>

          <p style={{ marginTop: '16px' }}>
            Each stage transforms input data into a new form, which becomes input for the next stage.
            This pipeline pattern makes the code easier to test and debug—you can trace exactly where
            data changes shape.
          </p>
        </div>
      </section>

      {/* Step 1: User Input */}
      <section className="section">
        <h2 className="section-title">Step 1: User Input Enters the Handler</h2>
        <div className="section-content">
          <p>
            When a user types <code>/quick-review src/utils.ts</code>, pi extracts everything after
            the command name and passes it to our handler as the <code>args</code> string:
          </p>
          
          <CodeBlock
            filename="Handler Entry Point"
            code={`handler: async (args, ctx) => {
  // args = "src/utils.ts"
  // ctx = { ui, model, modelRegistry, ... }
  
  const argParts = args.trim().split(/\s+/);
  // argParts = ["src/utils.ts"]
}`}
          />
          
          <p style={{ marginTop: '16px' }}>
            <strong>Why split by whitespace?</strong> This is a common pattern in CLI applications.
            It allows users to specify multiple targets or combine flags with paths:
          </p>
          
          <CodeBlock
            filename="Multiple Arguments"
            code={`/quick-review src/ lib/ tests/
// argParts = ["src/", "lib/", "tests/"]

/quick-review --model claude-3-5 src/utils.ts
// argParts = ["--model", "claude-3-5", "src/utils.ts"]`}
          />
          
          <p style={{ marginTop: '16px' }}>
            The <code>trim()</code> call handles edge cases where users accidentally add leading
            or trailing spaces—common when tab-completing file paths.
          </p>
        </div>
      </section>

      {/* Step 2: Argument Parsing */}
      <section className="section">
        <h2 className="section-title">Step 2: Parsing Flags and Paths</h2>
        <div className="section-content">
          <p>
            The extension uses a custom argument parser rather than a library. Here's the
            transformation it performs:
          </p>
          
          <svg width="100%" viewBox="0 0 800 200" style={{ marginTop: '16px', maxWidth: '600px' }}>
            <defs>
              <marker id="arrow2" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="#6366f1"/>
              </marker>
            </defs>
            
            <rect x="10" y="30" width="200" height="100" rx="8" fill="#f1f5f9" stroke="#94a3b8" strokeWidth="2"/>
            <text x="110" y="55" textAnchor="middle" fontSize="12" fontWeight="600" fill="#475569">Input</text>
            <text x="110" y="80" textAnchor="middle" fontSize="10" fill="#64748b">["--model", "claude",</text>
            <text x="110" y="95" textAnchor="middle" fontSize="10" fill="#64748b"> "file.ts"]</text>
            
            <line x1="210" y1="80" x2="290" y2="80" stroke="#6366f1" strokeWidth="2" markerEnd="url(#arrow2)"/>
            
            <rect x="300" y="30" width="200" height="100" rx="8" fill="#ede9fe" stroke="#8b5cf6" strokeWidth="2"/>
            <text x="400" y="55" textAnchor="middle" fontSize="12" fontWeight="600" fill="#475569">Parser Loop</text>
            <text x="400" y="80" textAnchor="middle" fontSize="10" fill="#64748b">for i = 0; i &lt; len; i++</text>
            
            <line x1="500" y1="80" x2="580" y2="80" stroke="#6366f1" strokeWidth="2" markerEnd="url(#arrow2)"/>
            
            <rect x="590" y="30" width="200" height="100" rx="8" fill="#dcfce7" stroke="#22c55e" strokeWidth="2"/>
            <text x="690" y="55" textAnchor="middle" fontSize="12" fontWeight="600" fill="#475569">Output</text>
            <text x="690" y="80" textAnchor="middle" fontSize="10" fill="#64748b">modelId: "claude"</text>
            <text x="690" y="95" textAnchor="middle" fontSize="10" fill="#64748b">paths: ["file.ts"]</text>
          </svg>

          <p style={{ marginTop: '16px' }}>
            Let's examine the parsing logic in detail:
          </p>
          
          <CodeBlock
            filename="Argument Parsing Logic"
            code={`for (let i = 0; i < argParts.length; i++) {
  const part = argParts[i];
  
  if (part === "--model" && i + 1 < argParts.length) {
    modelId = argParts[++i];  // Consume next token as value
  } else if (part === "--provider" && i + 1 < argParts.length) {
    provider = argParts[++i]; // Consume next token as value
  } else if (!part.startsWith("--")) {
    paths.push(part);          // Accumulate non-flag arguments
  }
  // Flags without values (like --help) are silently ignored
}`}
          />

          <div style={{ background: '#f0f9ff', borderLeft: '4px solid #0ea5e9', padding: '16px', marginTop: '16px', borderRadius: '0 8px 8px 0' }}>
            <p style={{ margin: 0, fontSize: '14px' }}>
              <strong>Design Decision: Why manual parsing?</strong><br/>
              At first glance, this seems like reinventing the wheel. Libraries like
              <code>minimist</code> or <code>yargs</code> exist for this purpose. However, this
              extension prioritizes <strong>bundle size</strong> and <strong>simplicity</strong>.
              Adding a CLI parsing library would increase the extension's footprint significantly.
              Since pi handles basic command routing, we only need minimal flag parsing.
            </p>
          </div>
        </div>
      </section>

      {/* Step 3: Target Resolution */}
      <section className="section">
        <h2 className="section-title">Step 3: Target Path Resolution</h2>
        <div className="section-content">
          <p>
            After parsing, multiple path arguments are joined into a single target string:
          </p>
          
          <CodeBlock
            filename="Target Resolution"
            code={`const target = paths.join(" ") || ".";
// paths = ["src", "lib"] → target = "src lib"
// paths = []          → target = "." (current directory)`}
          />
          
          <p style={{ marginTop: '16px' }}>
            The <code>|| "."</code> fallback handles the case where no path is provided.
            This default means "review everything in the current directory"—a sensible
            default for quick reviews.
          </p>
          
          <div style={{ background: '#fef3c7', borderLeft: '4px solid #f59e0b', padding: '16px', marginTop: '16px', borderRadius: '0 8px 8px 0' }}>
            <p style={{ margin: 0, fontSize: '14px' }}>
              <strong>Alternative Considered:</strong> Using <code>paths[0]</code> instead of
              <code>join(" ")</code> would only accept the first path. This was rejected because
              some tools (like <code>grep</code> or <code>linters</code>) accept multiple paths,
              and future versions of this extension might pass them to the AI for batch analysis.
            </p>
          </div>
        </div>
      </section>

      {/* Step 4: Model Selection */}
      <section className="section">
        <h2 className="section-title">Step 4: Model Selection Flow</h2>
        <div className="section-content">
          <p>
            This is where the data flow branches based on user input. The code has two
            distinct paths: <strong>flag-driven</strong> (explicit) and <strong>interactive</strong> (implicit).
          </p>

          <svg width="100%" viewBox="0 0 700 380" style={{ marginTop: '16px', maxWidth: '700px' }}>
            <defs>
              <marker id="arr" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="#6366f1"/>
              </marker>
            </defs>
            
            {/* Decision diamond */}
            <polygon points="350,20 420,80 350,140 280,80" fill="#f1f5f9" stroke="#6366f1" strokeWidth="2"/>
            <text x="350" y="85" textAnchor="middle" fontSize="11" fontWeight="600" fill="#1e293b">flags</text>
            <text x="350" y="100" textAnchor="middle" fontSize="11" fontWeight="600" fill="#1e293b">provided?</text>
            
            {/* Left branch - No flags */}
            <line x1="280" y1="80" x2="180" y2="80" stroke="#6366f1" strokeWidth="2"/>
            <text x="200" y="70" fontSize="10" fill="#64748b">No</text>
            
            <rect x="60" y="40" width="120" height="60" rx="8" fill="#fee2e2" stroke="#ef4444" strokeWidth="2"/>
            <text x="120" y="70" textAnchor="middle" fontSize="11" fontWeight="500" fill="#991b1b">Interactive</text>
            <text x="120" y="85" textAnchor="middle" fontSize="10" fill="#991b1b">Select UI</text>
            
            {/* Right branch - Flags provided */}
            <line x1="420" y1="80" x2="520" y2="80" stroke="#6366f1" strokeWidth="2"/>
            <text x="490" y="70" fontSize="10" fill="#64748b">Yes</text>
            
            <rect x="520" y="40" width="140" height="60" rx="8" fill="#dcfce7" stroke="#22c55e" strokeWidth="2"/>
            <text x="590" y="70" textAnchor="middle" fontSize="11" fontWeight="500" fill="#166534">Registry</text>
            <text x="590" y="85" textAnchor="middle" fontSize="10" fill="#166534">Lookup</text>
            
            {/* Flag types */}
            <rect x="400" y="170" width="200" height="100" rx="8" fill="#f1f5f9" stroke="#94a3b8" strokeWidth="1"/>
            <text x="500" y="195" textAnchor="middle" fontSize="11" fontWeight="600" fill="#475569">Flag Combinations</text>
            <text x="420" y="220" fontSize="10" fill="#64748b">--model X --provider Y</text>
            <text x="420" y="235" fontSize="10" fill="#64748b">--model X (uses default)</text>
            <text x="420" y="250" fontSize="10" fill="#64748b">--provider Y (first model)</text>
            
            <line x1="590" y1="100" x2="590" y2="170" stroke="#6366f1" strokeWidth="1" strokeDasharray="4"/>
            
            {/* Fallback chain */}
            <rect x="200" y="170" width="280" height="100" rx="8" fill="#ede9fe" stroke="#8b5cf6" strokeWidth="2"/>
            <text x="340" y="195" textAnchor="middle" fontSize="11" fontWeight="600" fill="#5b21b6">Fallback Resolution</text>
            <text x="220" y="220" fontSize="10" fill="#64748b">provider ||</text>
            <text x="220" y="235" fontSize="10" fill="#64748b">originalModel?.provider ||</text>
            <text x="220" y="250" fontSize="10" fill="#64748b">"anthropic"</text>
            
            <line x1="500" y1="270" x2="500" y2="320" stroke="#6366f1" strokeWidth="2" markerEnd="url(#arr)"/>
            <line x1="340" y1="270" x2="340" y2="320" stroke="#6366f1" strokeWidth="2" markerEnd="url(#arr)"/>
            
            {/* Result */}
            <rect x="220" y="320" width="260" height="50" rx="8" fill="#dbeafe" stroke="#3b82f6" strokeWidth="2"/>
            <text x="350" y="350" textAnchor="middle" fontSize="12" fontWeight="600" fill="#1e40af">pi.setModel(targetModel)</text>
          </svg>

          <p style={{ marginTop: '24px' }}>
            Let's trace through the flag-driven path with actual data:
          </p>
          
          <CodeBlock
            filename="Flag-Driven Model Selection"
            code={`// Input: /quick-review --model claude-3-5-sonnet src/utils.ts

if (modelId || provider) {
  // modelId = "claude-3-5-sonnet", provider = undefined
  
  let targetModel = modelId
    ? ctx.modelRegistry.find(
        provider || originalModel?.provider || "anthropic",
        modelId
      )
    : undefined;
  
  // Chain resolves to:
  // find("claude-sonnet-4" || "claude-sonnet-4" || "anthropic", "claude-3-5-sonnet")
  // = find("claude-sonnet-4", "claude-3-5-sonnet")
}`}
          />

          <p style={{ marginTop: '16px' }}>
            The <strong>fallback chain</strong> ensures that if a user specifies only
            <code>--model</code> without a provider, we use the currently active provider
            (or default to Anthropic). This prevents model ID collisions between providers—
            the same model name might exist on multiple providers.
          </p>

          <div style={{ background: '#f0fdf4', borderLeft: '4px solid #22c55e', padding: '16px', marginTop: '16px', borderRadius: '0 8px 8px 0' }}>
            <p style={{ margin: 0, fontSize: '14px' }}>
              <strong>Why this matters:</strong> Imagine a user has both OpenAI and Anthropic
              API keys configured. Without provider context, specifying <code>--model claude</code>
              is ambiguous—is it Anthropic's Claude or a model named "Claude" on another provider?
              The fallback chain makes the selection predictable.
            </p>
          </div>
        </div>
      </section>

      {/* Step 5: Prompt Construction */}
      <section className="section">
        <h2 className="section-title">Step 5: Prompt Construction</h2>
        <div className="section-content">
          <p>
            Once the model is selected (or retained), the extension constructs the review
            prompt by combining the static <code>REVIEW_PROMPT</code> with the user's target:
          </p>
          
          <CodeBlock
            filename="Prompt Construction"
            code={`// REVIEW_PROMPT is a large constant string (defined at module top)
// We append the target path to give the AI context

const fullPrompt = \`\${REVIEW_PROMPT}\n\nPlease review: \${target}\`;

// Example result:
// "You are a code reviewer. Your task is to analyze..."
// + "\n\nPlease review: src/utils.ts"
`}
          />

          <p style={{ marginTop: '16px' }}>
            This template pattern allows the review instructions to stay constant while the
            specific target changes per invocation. The AI receives:
          </p>
          
          <ol style={{ marginLeft: '24px', marginTop: '12px' }}>
            <li><strong>Role definition</strong> — "You are a code reviewer"</li>
            <li><strong>Task specification</strong> — What to look for (bugs, security, errors)</li>
            <li><strong>Output format</strong> — How to report findings</li>
            <li><strong>Target</strong> — What file/directory to analyze</li>
          </ol>

          <div style={{ background: '#fef3c7', borderLeft: '4px solid #f59e0b', padding: '16px', marginTop: '16px', borderRadius: '0 8px 8px 0' }}>
            <p style={{ margin: 0, fontSize: '14px' }}>
              <strong>Design Decision:</strong> The prompt is constructed as a simple concatenation
              rather than a template engine or structured object. This was chosen for <strong>debuggability</strong>—
              you can copy the exact prompt and test it directly in the AI provider's playground.
              More complex approaches (like passing structured JSON) would require additional
              prompt engineering to ensure consistent parsing.
            </p>
          </div>
        </div>
      </section>

      {/* Step 6: sendUserMessage */}
      <section className="section">
        <h2 className="section-title">Step 6: Sending to the AI</h2>
        <div className="section-content">
          <p>
            The final step is passing the constructed prompt to pi's message system:
          </p>
          
          <CodeBlock
            filename="Send to AI"
            code={`pi.sendUserMessage(fullPrompt);`}
          />

          <p style={{ marginTop: '16px' }}>
            This single call hands control to pi's agent system. The extension's involvement
            ends here—what happens next is handled by pi internally:
          </p>
          
          <svg width="100%" viewBox="0 0 700 180" style={{ marginTop: '16px', maxWidth: '700px' }}>
            <rect x="10" y="50" width="140" height="60" rx="8" fill="#dcfce7" stroke="#22c55e" strokeWidth="2"/>
            <text x="80" y="85" textAnchor="middle" fontSize="12" fontWeight="500" fill="#166534">Extension</text>
            
            <line x1="150" y1="80" x2="200" y2="80" stroke="#6366f1" strokeWidth="2" markerEnd="url(#arrowhead)"/>
            
            <rect x="210" y="50" width="140" height="60" rx="8" fill="#dbeafe" stroke="#3b82f6" strokeWidth="2"/>
            <text x="280" y="85" textAnchor="middle" fontSize="12" fontWeight="500" fill="#1e40af">pi Agent</text>
            
            <line x1="350" y1="80" x2="400" y2="80" stroke="#6366f1" strokeWidth="2" markerEnd="url(#arrowhead)"/>
            
            <rect x="410" y="50" width="140" height="60" rx="8" fill="#ede9fe" stroke="#8b5cf6" strokeWidth="2"/>
            <text x="480" y="85" textAnchor="middle" fontSize="12" fontWeight="500" fill="#5b21b6">AI Model</text>
            
            <line x1="550" y1="80" x2="600" y2="80" stroke="#6366f1" strokeWidth="2" markerEnd="url(#arrowhead)"/>
            
            <rect x="610" y="50" width="80" height="60" rx="8" fill="#f1f5f9" stroke="#64748b" strokeWidth="2"/>
            <text x="650" y="85" textAnchor="middle" fontSize="12" fontWeight="500" fill="#475569">User</text>
            
            <text x="175" y="130" textAnchor="middle" fontSize="10" fill="#64748b">sendUserMessage()</text>
            <text x="415" y="130" textAnchor="middle" fontSize="10" fill="#64748b">API call</text>
            <text x="575" y="130" textAnchor="middle" fontSize="10" fill="#64748b">Display</text>
          </svg>

          <p style={{ marginTop: '24px' }}>
            The extension doesn't receive the AI's response directly—it flows back to the
            user through pi's UI. This is an important architectural choice: the extension
            doesn't need to handle streaming responses, token counting, or output formatting.
            It just initiates the request.
          </p>
        </div>
      </section>

      {/* Model Picker Data Flow */}
      <section className="section">
        <h2 className="section-title">Bonus Flow: The Model Picker TUI</h2>
        <div className="section-content">
          <p>
            When users choose to interactively select a model, a separate data flow
            activates through the <code>showModelPicker</code> function. This is a
            self-contained UI component with its own internal state:
          </p>
          
          <CodeBlock
            filename="showModelPicker Data Flow"
            code={`async function showModelPicker(
  ctx: { ui: any; theme: any },
  available: Model[]
): Promise<Model | null> {
  
  // Transform: Model[] → SelectListItem[]
  const items = available.map(model => ({
    value: \`\${model.provider}/\${model.id}\`,
    label: \`\${model.provider}/\${model.id}\`,
    description: model.name || undefined,
  }));
  
  // Creates custom TUI component
  return ctx.ui.custom<Model | null>((tui, theme, _keybindings, done) => {
    
    // UI State managed internally:
    // - searchInput: tracks user's filter text
    // - selectList: tracks selection index
    // - filter: computed from searchInput
    
    function handleInput(data: string) {
      // Route keyboard events based on key type
      if (matchesKey(data, Key.escape)) done(null);
      if (matchesKey(data, Key.enter)) {
        const selected = selectList.getSelectedItem();
        const model = available.find(m => \`\${m.provider}/\${m.id}\` === selected.value);
        done(model);  // Resolve the promise with selected model
      }
      // Text input updates filter
      searchInput.handleInput(data);
      selectList.setFilter(searchInput.getValue());
      tui.requestRender();
    }
    
    return { render, invalidate, handleInput };
  });
}`}
          />

          <p style={{ marginTop: '16px' }}>
            This uses a <strong>callback-based async pattern</strong>. The
            <code>ctx.ui.custom()</code> call creates an interactive UI and immediately
            returns a Promise. Inside the callback, <code>done(model)</code> resolves
            that Promise when the user makes a selection.
          </p>

          <div style={{ background: '#f0f9ff', borderLeft: '4px solid #0ea5e9', padding: '16px', marginTop: '16px', borderRadius: '0 8px 8px 0' }}>
            <p style={{ margin: 0, fontSize: '14px' }}>
              <strong>For JavaScript developers:</strong> This pattern might look unusual if
              you're used to Promises resolving directly. Here, the Promise is "owned" by
              <code>ctx.ui.custom()</code>, and the callback receives <code>done</code> as a
              way to control that Promise from within the UI event loop. This is necessary
              because keyboard events can fire at any time, not just in sequential code.
            </p>
          </div>
        </div>
      </section>

      {/* Error Handling Flow */}
      <section className="section">
        <h2 className="section-title">Error Handling: Graceful Degradation</h2>
        <div className="section-content">
          <p>
            Throughout the data flow, errors are handled with <strong>graceful degradation</strong>—
            the extension tries to recover and continue rather than failing outright:
          </p>
          
          <CodeBlock
            filename="Error Handling Patterns"
            code={`// Pattern 1: Silent fallback with warning
if (targetModel) {
  const success = await pi.setModel(targetModel);
  if (success) {
    ctx.ui.notify(\`Switched to model: ...\`, "info");
  } else {
    // Model not usable (no API key), continue with current model
    ctx.ui.notify(\`⚠️ No API key available..., using current model\`, "warning");
  }
} else {
  // Model not found, continue with current model
  ctx.ui.notify(\`⚠️ Model not found..., using current model\`, "warning");
}

// Pattern 2: Empty state handling
if (available.length === 0) {
  ctx.ui.notify("No other models available with configured API keys", "warning");
}`}
          />

          <p style={{ marginTop: '16px' }}>
            This design ensures the code review always proceeds, even when the ideal
            scenario (using a specific model) isn't available. The user gets feedback
            about what went wrong, but the core functionality remains intact.
          </p>
        </div>
      </section>

      {/* Cross-References */}
      <section className="section">
        <h2 className="section-title">Related Concepts</h2>
        <div className="section-content">
          <p>This chapter connects to several other topics in this tutorial:</p>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginTop: '16px' }}>
            <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <h4 style={{ margin: '0 0 8px 0', color: '#475569' }}>TypeScript Patterns</h4>
              <p style={{ margin: 0, fontSize: '14px', color: '#64748b' }}>
                The async/await patterns here (<code>Promise&lt;Model | null&gt;</code>)
                are explained in depth in Chapter 4.
              </p>
            </div>
            
            <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <h4 style={{ margin: '0 0 8px 0', color: '#475569' }}>Configuration & Entry Points</h4>
              <p style={{ margin: 0, fontSize: '14px', color: '#64748b' }}>
                The <code>ExtensionAPI</code> interface that provides <code>ctx</code>
                is detailed in Chapter 5.
              </p>
            </div>
            
            <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <h4 style={{ margin: '0 0 8px 0', color: '#475569' }}>Key Modules</h4>
              <p style={{ margin: 0, fontSize: '14px', color: '#64748b' }}>
                The <code>showModelPicker</code> function's internal state management
                is covered in Chapter 2.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Quiz */}
      <section className="section quiz-section">
        <h2 className="section-title">Knowledge Check</h2>
        <div className="section-content">
          <p>Test your understanding of the data flow with these questions:</p>
          
          <div style={{ marginTop: '24px' }}>
            <div style={{ background: '#f8fafc', padding: '20px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '16px' }}>
              <p style={{ fontWeight: 600, marginBottom: '12px' }}>Question 1: What does the argument parser do with <code>++i</code>?</p>
              
              <div style={{ marginLeft: '20px' }}>
                <label style={{ display: 'block', marginBottom: '8px' }}>
                  <input type="radio" name="q1" style={{ marginRight: '8px' }} />
                  <span>A) Increments i after using it as an array index</span>
                </label>
                <label style={{ display: 'block', marginBottom: '8px' }}>
                  <input type="radio" name="q1" style={{ marginRight: '8px' }} />
                  <span>B) Decrements i to handle negative indices</span>
                </label>
                <label style={{ display: 'block', marginBottom: '8px' }}>
                  <input type="radio" name="q1" style={{ marginRight: '8px' }} />
                  <span>C) Increments i and uses the new value for the array index</span>
                </label>
                <label style={{ display: 'block' }}>
                  <input type="radio" name="q1" style={{ marginRight: '8px' }} />
                  <span>D) Compares i to the array length</span>
                </label>
              </div>
              
              <div style={{ background: '#dcfce7', padding: '12px', borderRadius: '4px', marginTop: '16px', fontSize: '14px' }}>
                <strong>Correct Answer: C</strong><br/>
                When <code>++i</code> is used in <code>modelId = argParts[++i]</code>, it first
                increments i, then uses the new value to access the array. This "consumes" both
                the flag and its value in one iteration, preventing the value from being
                reprocessed as a path.
              </div>
            </div>
            
            <div style={{ background: '#f8fafc', padding: '20px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '16px' }}>
              <p style={{ fontWeight: 600, marginBottom: '12px' }}>Question 2: Why does the code use <code>|| "."</code> after <code>paths.join(" ")</code>?</p>
              
              <div style={{ marginLeft: '20px' }}>
                <label style={{ display: 'block', marginBottom: '8px' }}>
                  <input type="radio" name="q2" style={{ marginRight: '8px' }} />
                  <span>A) To escape special characters in paths</span>
                </label>
                <label style={{ display: 'block', marginBottom: '8px' }}>
                  <input type="radio" name="q2" style={{ marginRight: '8px' }} />
                  <span>B) To default to current directory when no path is provided</span>
                </label>
                <label style={{ display: 'block', marginBottom: '8px' }}>
                  <input type="radio" name="q2" style={{ marginRight: '8px' }} />
                  <span>C) To concatenate multiple paths with a separator</span>
                </label>
                <label style={{ display: 'block' }}>
                  <input type="radio" name="q2" style={{ marginRight: '8px' }} />
                  <span>D) To validate that paths exist on the filesystem</span>
                </label>
              </div>
              
              <div style={{ background: '#dcfce7', padding: '12px', borderRadius: '4px', marginTop: '16px', fontSize: '14px' }}>
                <strong>Correct Answer: B</strong><br/>
                When <code>paths</code> is empty (user runs <code>/quick-review</code> with no args),
                <code>paths.join(" ")</code> returns an empty string <code>""</code>. The
                <code>|| "."</code> provides a default of <code>"."</code>, which means "current
                directory" in Unix-like systems. This ensures the AI always has a valid target.
              </div>
            </div>
            
            <div style={{ background: '#f8fafc', padding: '20px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '16px' }}>
              <p style={{ fontWeight: 600, marginBottom: '12px' }}>Question 3: What is the purpose of the fallback chain <code>provider || originalModel?.provider || "anthropic"</code>?</p>
              
              <div style={{ marginLeft: '20px' }}>
                <label style={{ display: 'block', marginBottom: '8px' }}>
                  <input type="radio" name="q3" style={{ marginRight: '8px' }} />
                  <span>A) To prioritize free models over paid ones</span>
                </label>
                <label style={{ display: 'block', marginBottom: '8px' }}>
                  <input type="radio" name="q3" style={{ marginRight: '8px' }} />
                  <span>B) To provide context when only a model ID is specified</span>
                </label>
                <label style={{ display: 'block', marginBottom: '8px' }}>
                  <input type="radio" name="q3" style={{ marginRight: '8px' }} />
                  <span>C) To cache frequently used model combinations</span>
                </label>
                <label style={{ display: 'block' }}>
                  <input type="radio" name="q3" style={{ marginRight: '8px' }} />
                  <span>D) To validate API keys for each provider</span>
                </label>
              </div>
              
              <div style={{ background: '#dcfce7', padding: '12px', borderRadius: '4px', marginTop: '16px', fontSize: '14px' }}>
                <strong>Correct Answer: B</strong><br/>
                Model IDs are not globally unique—multiple providers may have a model named "claude-3".
                When a user specifies <code>--model claude-3</code> without a provider, the chain
                uses the currently active provider (or defaults to Anthropic) to disambiguate.
                This prevents selecting the wrong provider's model by accident.
              </div>
            </div>
            
            <div style={{ background: '#f8fafc', padding: '20px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <p style={{ fontWeight: 600, marginBottom: '12px' }}>Question 4: Why does the extension use <code>ctx.ui.custom()</code> for the model picker instead of a built-in method?</p>
              
              <div style={{ marginLeft: '20px' }}>
                <label style={{ display: 'block', marginBottom: '8px' }}>
                  <input type="radio" name="q4" style={{ marginRight: '8px' }} />
                  <span>A) Built-in pickers don't support keyboard navigation</span>
                </label>
                <label style={{ display: 'block', marginBottom: '8px' }}>
                  <input type="radio" name="q4" style={{ marginRight: '8px' }} />
                  <span>B) The custom picker provides search/filter functionality</span>
                </label>
                <label style={{ display: 'block', marginBottom: '8px' }}>
                  <input type="radio" name="q4" style={{ marginRight: '8px' }} />
                  <span>C) Built-in pickers require additional API keys</span>
                </label>
                <label style={{ display: 'block' }}>
                  <input type="radio" name="q4" style={{ marginRight: '8px' }} />
                  <span>D) The extension needs to run on older browsers</span>
                </label>
              </div>
              
              <div style={{ background: '#dcfce7', padding: '12px', borderRadius: '4px', marginTop: '16px', fontSize: '14px' }}>
                <strong>Correct Answer: B</strong><br/>
                The built-in <code>ctx.ui.select()</code> method shows a simple choice list.
                The custom picker adds <strong>search functionality</strong>—as the user types,
                the list filters to matching models. This is essential when you have many
                configured models, as scrolling through a long list is inefficient. The
                trade-off is more code complexity, but the user experience improvement justifies it.
              </div>
            </div>
          </div>
        </div>
      </section>

      <ChapterNavigation chapterId="data-flow" />
    </article>
  );
}
