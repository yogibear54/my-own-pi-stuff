import { FilesCovered } from '../components/FilesCovered';
import { ChapterNavigation } from '../components/ChapterNavigation';
import { CodeBlock } from '../components/CodeBlock';

export function TypeScriptPatterns() {
  return (
    <article className="chapter-content">
      <header className="chapter-header">
        <p className="chapter-eyebrow">Chapter 4</p>
        <h1 className="chapter-heading">TypeScript Patterns</h1>
        <p className="chapter-description">
          This chapter dives deep into the TypeScript type system and patterns used in the 
          quick-review extension. For JavaScript developers new to TypeScript, you'll learn 
          not just the syntax but the <em>why</em> behind each pattern—design decisions, 
          trade-offs, and how these patterns work together to create a type-safe extension.
        </p>
      </header>

      <FilesCovered files={['extensions/quick-review.ts']} />

      {/* Section 1: Type Imports */}
      <section className="section">
        <h2 className="section-title">Type-Only Imports: The <code>import type</code> Syntax</h2>
        <div className="section-content">
          <p>
            Let's start with one of the most important patterns in this codebase: <strong>type imports</strong>.
            At the top of the file, you'll see this:
          </p>
        </div>
        <CodeBlock
          filename="extensions/quick-review.ts (lines 11-13)"
          code={`import type { Model } from "@mariozechner/pi-ai";`}
        />
        <div className="section-content">
          <p>
            The <code>import type</code> syntax is a TypeScript 3.8+ feature that imports only 
            <em>type information</em>, not runtime values. Think of it as importing a blueprint 
            rather than the actual building.
          </p>
          
          <h3>Why Does This Matter?</h3>
          <p>
            In JavaScript, when you write <code>import {'{'} ExtensionAPI {'}'}</code>, the bundler must 
            include <code>ExtensionAPI</code> in the final JavaScript output—even though it's 
            just a type that disappears at runtime. With <code>import type</code>, TypeScript 
            erases these imports entirely before generating JavaScript.
          </p>
        </div>
        
        <div className="diagram-container">
          <svg viewBox="0 0 600 200" className="chapter-diagram">
            <defs>
              <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="#6366f1" />
              </marker>
            </defs>
            
            {/* Left box - TypeScript source */}
            <rect x="20" y="30" width="180" height="80" rx="8" fill="#f1f5f9" stroke="#6366f1" strokeWidth="2"/>
            <text x="110" y="55" textAnchor="middle" fontWeight="bold" fill="#1e293b">TypeScript Source</text>
            <text x="110" y="80" textAnchor="middle" fontSize="12" fill="#475569">import type &#123;Model&#125;</text>
            <text x="110" y="98" textAnchor="middle" fontSize="12" fill="#475569">from "@mariozechner/pi-ai"</text>
            
            {/* Arrow */}
            <line x1="200" y1="70" x2="380" y2="70" stroke="#6366f1" strokeWidth="2" markerEnd="url(#arrowhead)"/>
            <text x="290" y="60" textAnchor="middle" fontSize="11" fill="#6366f1">TypeScript Compiler</text>
            
            {/* Right box - JavaScript output */}
            <rect x="400" y="30" width="180" height="80" rx="8" fill="#f0fdf4" stroke="#22c55e" strokeWidth="2"/>
            <text x="490" y="55" textAnchor="middle" fontWeight="bold" fill="#166534">JavaScript Output</text>
            <text x="490" y="85" textAnchor="middle" fontSize="12" fill="#475569">// Empty! Type erased</text>
            
            {/* Comparison */}
            <text x="110" y="160" textAnchor="middle" fontSize="11" fill="#ef4444">⚠️ Regular import</text>
            <text x="110" y="175" textAnchor="middle" fontSize="10" fill="#64748b">Bundled in output</text>
            
            <text x="490" y="160" textAnchor="middle" fontSize="11" fill="#22c55e">✓ import type</text>
            <text x="490" y="175" textAnchor="middle" fontSize="10" fill="#64748b">Removed at compile</text>
          </svg>
          <p className="diagram-caption">
            <strong>Figure 1:</strong> How <code>import type</code> differs from regular imports during compilation
          </p>
        </div>
        
        <div className="tip-box">
          <strong>💡 Key Takeaway:</strong> Use <code>import type</code> when you're only using a symbol 
          for type annotations (annotations, return types, parameter types). This keeps your 
          compiled JavaScript smaller and your bundle lean.
        </div>
      </section>

      {/* Section 2: Union Types */}
      <section className="section">
        <h2 className="section-title">Union Types: Flexibility with Safety</h2>
        <div className="section-content">
          <p>
            One of TypeScript's most powerful features is <strong>union types</strong>—the ability 
            to say "this value can be one of several types." In the quick-review extension, 
            you'll find this pattern repeatedly:
          </p>
        </div>
        <CodeBlock
          filename="extensions/quick-review.ts (lines 49-51)"
          code={`let modelId: string | undefined;
let provider: string | undefined;
const paths: string[] = [];`}
        />
        <div className="section-content">
          <p>
            Here, <code>string | undefined</code> is a union type meaning "either a string or undefined." 
            This is TypeScript's way of expressing optional values—unlike JavaScript where you'd 
            use <code>null</code> or rely on convention.
          </p>
          
          <h3>Why Use <code>string | undefined</code> Over <code>string | null</code>?</h3>
          <p>
            In TypeScript culture, <code>undefined</code> typically means "value not yet provided" 
            or "optional parameter," while <code>null</code> means "explicitly empty." The quick-review 
            extension uses <code>undefined</code> because:
          </p>
          <ul style={{ marginLeft: '24px', marginTop: '12px' }}>
            <li>The variables start uninitialized (<code>let modelId</code> without assignment)</li>
            <li>They're later assigned when flags are present</li>
            <li><code>undefined</code> is the natural "not yet set" state</li>
          </ul>
        </div>
        
        <div className="diagram-container">
          <svg viewBox="0 0 500 150" className="chapter-diagram">
            <rect x="50" y="20" width="120" height="50" rx="6" fill="#e0e7ff" stroke="#6366f1" strokeWidth="2"/>
            <text x="110" y="50" textAnchor="middle" fontWeight="bold">string</text>
            
            <text x="250" y="45" textAnchor="middle" fontSize="24" fill="#6366f1">|</text>
            
            <rect x="300" y="20" width="120" height="50" rx="6" fill="#fef3c7" stroke="#f59e0b" strokeWidth="2"/>
            <text x="360" y="50" textAnchor="middle" fontWeight="bold">undefined</text>
            
            <text x="250" y="100" textAnchor="middle" fontSize="14" fontWeight="bold" fill="#1e293b">string | undefined</text>
            <text x="250" y="120" textAnchor="middle" fontSize="11" fill="#64748b">"Either a string value or nothing"</text>
          </svg>
          <p className="diagram-caption">
            <strong>Figure 2:</strong> Union type visualization — a value that can be one type OR another
          </p>
        </div>
        
        <div className="section-content">
          <h3>Working with Union Types</h3>
          <p>
            TypeScript's type system is "smart" about unions. Once you narrow a union type, 
            TypeScript knows what you're working with:
          </p>
        </div>
        <CodeBlock
          filename="Union Type Narrowing"
          code={`if (modelId || provider) {
  // Inside this block, TypeScript knows at least one is truthy
  // We can use either safely
  let targetModel = modelId
    ? ctx.modelRegistry.find(...)
    : undefined;
}`}
        />
      </section>

      {/* Section 3: Inline Object Types */}
      <section className="section">
        <h2 className="section-title">Inline Object Types: Defining Shapes Quickly</h2>
        <div className="section-content">
          <p>
            When defining function parameters, you sometimes need to specify just a few 
            properties without creating a full interface. TypeScript lets you define 
            <strong>inline object types</strong> using curly braces:
          </p>
        </div>
        <CodeBlock
          filename="extensions/quick-review.ts (line 136)"
          code={`async function showModelPicker(
  ctx: { ui: any; theme: any },
  available: Model[]
): Promise<Model | null>`}
        />
        <div className="section-content">
          <p>
            Here, <code>{`{ ui: any; theme: any }`}</code> is an inline object type. It says 
            "ctx must be an object with a ui property and a theme property."
          </p>
          
          <h3>Why Use <code>any</code> for ui and theme?</h3>
          <p>
            This is a deliberate choice! The <code>ui</code> and <code>theme</code> objects 
            come from pi's internal system. We don't need full type safety here because:
          </p>
          <ul style={{ marginLeft: '24px', marginTop: '12px' }}>
            <li>Pi's API is stable; we just need to call known methods</li>
            <li>Defining complete types for internal objects would be verbose</li>
            <li>The <code>any</code> type says "I trust this exists; use it freely"</li>
          </ul>
          
          <div className="warning-box">
            <strong>⚠️ Trade-off:</strong> Using <code>any</code> bypasses TypeScript's type checking. 
            Use it sparingly and intentionally. In production code, you'd ideally define proper 
            interfaces for these objects.
          </div>
        </div>
        
        <div className="diagram-container">
          <svg viewBox="0 0 550 180" className="chapter-diagram">
            {/* Inline type box */}
            <rect x="175" y="10" width="200" height="60" rx="8" fill="#f1f5f9" stroke="#6366f1" strokeWidth="2"/>
            <text x="275" y="35" textAnchor="middle" fontWeight="bold">ctx: &#123; ui: any; theme: any &#125;</text>
            <text x="275" y="55" textAnchor="middle" fontSize="11" fill="#64748b">Inline object type</text>
            
            {/* Arrow down */}
            <line x1="275" y1="70" x2="275" y2="95" stroke="#6366f1" strokeWidth="2" markerEnd="url(#arrowhead)"/>
            
            {/* Expanded form */}
            <rect x="100" y="100" width="350" height="60" rx="8" fill="#f0fdf4" stroke="#22c55e" strokeWidth="2"/>
            <text x="275" y="125" textAnchor="middle" fontWeight="bold" fill="#166534">Equivalent Interface (if defined separately)</text>
            <text x="275" y="145" textAnchor="middle" fontSize="11" fill="#475569">interface ModelPickerContext &#123; ui: any; theme: any &#125;</text>
          </svg>
          <p className="diagram-caption">
            <strong>Figure 3:</strong> Inline object types are a shorthand for defining object shapes
          </p>
        </div>
      </section>

      {/* Section 4: Generic Types */}
      <section className="section">
        <h2 className="section-title">Generic Types: Writing Flexible, Type-Safe Code</h2>
        <div className="section-content">
          <p>
            <strong>Generics</strong> are TypeScript's way of writing code that works with 
            multiple types while maintaining type safety. Think of them as "type variables" 
            that get filled in when the function is called.
          </p>
          <p>
            The <code>showModelPicker</code> function uses generics in two places:
          </p>
        </div>
        <CodeBlock
          filename="extensions/quick-review.ts (lines 136-138)"
          code={`async function showModelPicker(
  ctx: { ui: any; theme: any },
  available: Model[]
): Promise<Model | null>`}
        />
        <div className="section-content">
          <h3>Breaking Down <code>Promise&lt;Model | null&gt;</code></h3>
          <p>
            This return type says: "This async function returns a Promise that, when resolved, 
            gives you either a <code>Model</code> or <code>null</code>."
          </p>
          <ul style={{ marginLeft: '24px', marginTop: '12px' }}>
            <li><code>Promise&lt;T&gt;</code> — A generic type where T is what's inside the promise</li>
            <li><code>Model</code> — The success case type</li>
            <li><code>null</code> — The "user cancelled" case</li>
          </ul>
        </div>
        
        <div className="section-content">
          <h3>The <code>ctx.ui.custom&lt;T&gt;</code> Pattern</h3>
          <p>
            Look at this line inside <code>showModelPicker</code>:
          </p>
        </div>
        <CodeBlock
          filename="extensions/quick-review.ts (line 140)"
          code={`return ctx.ui.custom<Model | null>((tui, theme, _keybindings, done) => {`}
        />
        <div className="section-content">
          <p>
            Here, <code>ctx.ui.custom&lt;Model | null&gt;</code> is calling a generic function 
            where you explicitly specify the type parameter. The <code>&lt;Model | null&gt;</code> 
            tells TypeScript: "This custom UI will return either a Model or null."
          </p>
          
          <div className="tip-box">
            <strong>💡 TypeScript Jargon:</strong> When you see <code>Something&lt;T&gt;</code>, 
            think "a Something of type T." The angle brackets contain the type parameter(s) 
            that parameterize the generic type.
          </div>
        </div>
        
        <div className="diagram-container">
          <svg viewBox="0 0 550 200" className="chapter-diagram">
            {/* Generic box */}
            <rect x="175" y="10" width="200" height="50" rx="8" fill="#e0e7ff" stroke="#6366f1" strokeWidth="2"/>
            <text x="275" y="40" textAnchor="middle" fontWeight="bold">Promise&lt;T&gt;</text>
            
            {/* T substitution examples */}
            <line x1="275" y1="60" x2="100" y2="90" stroke="#6366f1" strokeWidth="1" strokeDasharray="4"/>
            <line x1="275" y1="60" x2="450" y2="90" stroke="#6366f1" strokeWidth="1" strokeDasharray="4"/>
            
            <rect x="40" y="95" width="130" height="40" rx="6" fill="#f0fdf4" stroke="#22c55e" strokeWidth="2"/>
            <text x="105" y="120" textAnchor="middle">T = Model</text>
            
            <rect x="380" y="95" width="130" height="40" rx="6" fill="#fef3c7" stroke="#f59e0b" strokeWidth="2"/>
            <text x="445" y="120" textAnchor="middle">T = Model | null</text>
            
            {/* Result types */}
            <line x1="105" y1="135" x2="105" y2="155" stroke="#22c55e" strokeWidth="2" markerEnd="url(#arrowhead)"/>
            <line x1="445" y1="135" x2="445" y2="155" stroke="#f59e0b" strokeWidth="2" markerEnd="url(#arrowhead)"/>
            
            <rect x="40" y="160" width="130" height="35" rx="6" fill="#dcfce7" stroke="#22c55e" strokeWidth="1"/>
            <text x="105" y="182" textAnchor="middle" fontSize="11">Promise&lt;Model&gt;</text>
            
            <rect x="380" y="160" width="130" height="35" rx="6" fill="#fef3c7" stroke="#f59e0b" strokeWidth="1"/>
            <text x="445" y="182" textAnchor="middle" fontSize="11">Promise&lt;Model | null&gt;</text>
          </svg>
          <p className="diagram-caption">
            <strong>Figure 4:</strong> Generics like Promise&lt;T&gt; are "type templates" that fill in T based on usage
          </p>
        </div>
      </section>

      {/* Section 5: Optional Chaining and Nullish Coalescing */}
      <section className="section">
        <h2 className="section-title">Optional Chaining & Nullish Coalescing: Safe Navigation</h2>
        <div className="section-content">
          <p>
            Two modern JavaScript features (now standard) that TypeScript embraces are 
            <strong>optional chaining</strong> (<code>?.</code>) and <strong>nullish coalescing</strong> 
            (<code>??</code> or <code>||</code>). The quick-review extension uses both:
          </p>
        </div>
        <CodeBlock
          filename="extensions/quick-review.ts (lines 65-67)"
          code={`let targetModel = modelId
  ? ctx.modelRegistry.find(provider || originalModel?.provider || "anthropic", modelId)
  : undefined;`}
        />
        <div className="section-content">
          <h3>Breaking Down the Expression</h3>
          <p>
            This single line does a lot of fallback logic:
          </p>
          <ol style={{ marginLeft: '24px', marginTop: '12px' }}>
            <li><code>originalModel?.provider</code> — If <code>originalModel</code> exists, get its <code>provider</code>; otherwise, return <code>undefined</code></li>
            <li><code>provider || originalModel?.provider || "anthropic"</code> — Use <code>provider</code> if truthy, otherwise <code>originalModel?.provider</code> if truthy, otherwise default to <code>"anthropic"</code></li>
          </ol>
        </div>
        
        <div className="diagram-container">
          <svg viewBox="0 0 550 220" className="chapter-diagram">
            {/* Expression box */}
            <rect x="100" y="10" width="350" height="60" rx="8" fill="#f1f5f9" stroke="#6366f1" strokeWidth="2"/>
            <text x="275" y="35" textAnchor="middle" fontSize="11" fontFamily="monospace">provider || originalModel?.provider || "anthropic"</text>
            <text x="275" y="55" textAnchor="middle" fontSize="10" fill="#64748b">Fallback chain evaluation</text>
            
            {/* Step boxes */}
            <rect x="30" y="90" width="100" height="45" rx="6" fill="#fef3c7" stroke="#f59e0b" strokeWidth="1"/>
            <text x="80" y="115" textAnchor="middle" fontSize="10">1. provider</text>
            <text x="80" y="128" textAnchor="middle" fontSize="9" fill="#64748b">If truthy → use it</text>
            
            <text x="155" y="113" fontSize="16" fill="#6366f1">||</text>
            
            <rect x="185" y="90" width="140" height="45" rx="6" fill="#e0e7ff" stroke="#6366f1" strokeWidth="1"/>
            <text x="255" y="115" textAnchor="middle" fontSize="10">2. originalModel?</text>
            <text x="255" y="128" textAnchor="middle" fontSize="9" fill="#64748b">Safe navigation</text>
            
            <text x="350" y="113" fontSize="16" fill="#6366f1">||</text>
            
            <rect x="380" y="90" width="100" height="45" rx="6" fill="#f0fdf4" stroke="#22c55e" strokeWidth="1"/>
            <text x="430" y="115" textAnchor="middle" fontSize="10">3. "anthropic"</text>
            <text x="430" y="128" textAnchor="middle" fontSize="9" fill="#64748b">Final default</text>
            
            {/* Arrow */}
            <line x1="275" y1="150" x2="275" y2="175" stroke="#6366f1" strokeWidth="2" markerEnd="url(#arrowhead)"/>
            
            <rect x="175" y="180" width="200" height="35" rx="6" fill="#dcfce7" stroke="#22c55e" strokeWidth="2"/>
            <text x="275" y="203" textAnchor="middle" fontWeight="bold" fill="#166534">Final provider string</text>
          </svg>
          <p className="diagram-caption">
            <strong>Figure 5:</strong> The fallback chain evaluates left-to-right, stopping at the first truthy value
          </p>
        </div>
        
        <div className="section-content">
          <h3>Default Values with <code>||</code></h3>
        </div>
        <CodeBlock
          filename="extensions/quick-review.ts (line 54)"
          code={`const target = paths.join(" ") || ".";`}
        />
        <div className="section-content">
          <p>
            If <code>paths</code> is empty, <code>paths.join(" ")</code> returns an empty string <code>""</code>, 
            which is falsy. The <code>|| "."</code> provides the default of the current directory.
          </p>
          
          <div className="tip-box">
            <strong>💡 Note:</strong> Using <code>||</code> for defaults means falsy values like <code>0</code>, 
            <code>""</code>, or <code>false</code> will trigger the default. For numbers specifically, 
            you might prefer <code>??</code> (nullish coalescing), which only triggers for <code>null</code> 
            or <code>undefined</code>.
          </div>
        </div>
      </section>

      {/* Section 6: Async/Await with TypeScript */}
      <section className="section">
        <h2 className="section-title">Async Functions: Promises with Type Annotations</h2>
        <div className="section-content">
          <p>
            TypeScript adds type safety to JavaScript's <code>async/await</code> pattern. 
            Every async function has an implicit <code>Promise</code> return type, but you 
            often need to explicitly annotate what the Promise resolves to.
          </p>
        </div>
        <CodeBlock
          filename="extensions/quick-review.ts (lines 33-38)"
          code={`handler: async (args, ctx) => {
  const argParts = args.trim().split(/\s+/);
  
  // Parse optional flags
  let modelId: string | undefined;
  let provider: string | undefined;
  const paths: string[] = [];`}
        />
        <div className="section-content">
          <h3>Understanding the Handler Signature</h3>
          <p>
            The command handler is defined by pi's extension system. The <code>async</code> keyword 
            means it returns a Promise. TypeScript infers the full signature as:
          </p>
          <CodeBlock
            filename="Inferred Handler Type"
            code={`async (args: string, ctx: CommandContext) => Promise<void>`}
          />
          <p style={{ marginTop: '12px' }}>
            The <code>Promise&lt;void&gt;</code> indicates the async work completes without 
            returning a meaningful value (it sends messages via <code>pi.sendUserMessage()</code> 
            instead).
          </p>
          
          <h3>Why Async Without Await in Most Places?</h3>
          <p>
            Notice that the handler is declared <code>async</code> but uses <code>await</code> 
            only in specific places:
          </p>
        </div>
        <CodeBlock
          filename="Selective await usage"
          code={`const available = await ctx.modelRegistry.getAvailable();
targetModel = available.find(m => m.provider === provider);`}
        />
        <div className="section-content">
          <p>
            This is a common pattern: you <code>await</code> only when you need the result 
            before continuing. The rest of the code runs synchronously in sequence.
          </p>
        </div>
      </section>

      {/* Section 7: Callback Pattern */}
      <section className="section">
        <h2 className="section-title">Callback Pattern: The <code>done</code> Function</h2>
        <div className="section-content">
          <p>
            The <code>showModelPicker</code> function uses a callback pattern to return 
            results from a custom UI. Look at the end of the function:
          </p>
        </div>
        <CodeBlock
          filename="extensions/quick-review.ts (lines 208-211)"
          code={`return {
  render: (width: number) => container.render(width),
  invalidate: () => container.invalidate(),
  handleInput,
};`}
        />
        <div className="section-content">
          <p>
            This object with three methods (<code>render</code>, <code>invalidate</code>, 
            <code>handleInput</code>) is the interface pi expects for custom UIs. But where's 
            the result?
          </p>
          <p>
            The <code>done</code> callback—passed as the fourth parameter to the callback 
            function—communicates the result:
          </p>
        </div>
        <CodeBlock
          filename="extensions/quick-review.ts (lines 197-200)"
          code={`if (matchesKey(data, Key.enter)) {
  const selected = selectList.getSelectedItem();
  if (selected) {
    const selectedModel = available.find(
      m => \`\${m.provider}/\${m.id}\` === selected.value
    );
    done(selectedModel || null);
    return;
  }
}`}
        />
        <div className="section-content">
          <h3>Why Use a Callback Instead of Return?</h3>
          <p>
            The custom UI pattern requires an object that persists over time (for rendering 
            and handling multiple keystrokes). Returning a value would end the interaction 
            immediately. Instead:
          </p>
          <ul style={{ marginLeft: '24px', marginTop: '12px' }}>
            <li>Call <code>done(result)</code> to complete and return a value</li>
            <li>Call <code>done(null)</code> to cancel (Escape key)</li>
            <li>The Promise from <code>ctx.ui.custom()</code> resolves with the passed value</li>
          </ul>
        </div>
        
        <div className="diagram-container">
          <svg viewBox="0 0 500 180" className="chapter-diagram">
            {/* Timeline */}
            <rect x="20" y="80" width="460" height="4" rx="2" fill="#e2e8f0"/>
            
            {/* Point 1 - Start */}
            <circle cx="50" cy="82" r="8" fill="#6366f1"/>
            <text x="50" y="110" textAnchor="middle" fontSize="10">ctx.ui.custom()</text>
            <text x="50" y="122" textAnchor="middle" fontSize="9" fill="#64748b">Promise created</text>
            
            {/* Point 2 - Interact */}
            <circle cx="200" cy="82" r="8" fill="#f59e0b"/>
            <text x="200" y="50" textAnchor="middle" fontSize="10">handleInput()</text>
            <text x="200" y="62" textAnchor="middle" fontSize="9" fill="#64748b">User types, navigates</text>
            
            {/* Point 3 - Done */}
            <circle cx="380" cy="82" r="8" fill="#22c55e"/>
            <text x="380" y="50" textAnchor="middle" fontSize="10">done(model)</text>
            <text x="380" y="62" textAnchor="middle" fontSize="9" fill="#64748b">UI closes</text>
            
            {/* Arrow from done to resolve */}
            <line x1="388" y1="82" x2="450" y2="82" stroke="#22c55e" strokeWidth="2" strokeDasharray="4"/>
            <text x="450" y="60" textAnchor="middle" fontSize="10" fill="#22c55e">Promise</text>
            <text x="450" y="72" textAnchor="middle" fontSize="10" fill="#22c55e">resolves</text>
          </svg>
          <p className="diagram-caption">
            <strong>Figure 6:</strong> The callback pattern allows async UI interactions within a Promise
          </p>
        </div>
      </section>

      {/* Section 8: Array Type Annotations */}
      <section className="section">
        <h2 className="section-title">Array Types: <code>Model[]</code> and Beyond</h2>
        <div className="section-content">
          <p>
            TypeScript offers two syntaxes for array types: <code>T[]</code> (square bracket syntax) 
            and <code>Array&lt;T&gt;</code> (generic syntax). The quick-review extension uses both:
          </p>
        </div>
        <CodeBlock
          filename="Array syntax comparison"
          code={`const paths: string[] = [];           // Square bracket syntax
const available: Model[] = [];       // Square bracket syntax
const items: Array<{value: string; label: string; description?: string}> = []; // Generic syntax`}
        />
        <div className="section-content">
          <h3>When to Use Which Syntax?</h3>
          <p>
            <strong>Square bracket (<code>T[]</code>):</strong> Preferred for simple, readable cases. 
            <code>string[]</code>, <code>Model[]</code> are clear and concise.
          </p>
          <p style={{ marginTop: '8px' }}>
            <strong>Generic (<code>Array&lt;T&gt;</code>):</strong> Better when you need complex 
            nested types or union types in the element type:
          </p>
        </div>
        <CodeBlock
          filename="Complex array types"
          code={`// Using Array<T> for complex element types
const items: Array<{
  value: string;
  label: string;
  description?: string;
}> = [];

// This is cleaner than:
const items2: {
  value: string;
  label: string;
  description?: string;
}[] = [];`}
        />
      </section>

      {/* Section 9: Type Guards */}
      <section className="section">
        <h2 className="section-title">Type Narrowing: Making Unions Work</h2>
        <div className="section-content">
          <p>
            Union types are powerful, but you often need to "narrow" them to a specific type 
            before using type-specific operations. TypeScript has several narrowing techniques:
          </p>
        </div>
        <CodeBlock
          filename="extensions/quick-review.ts (lines 56-71)"
          code={`if (modelId || provider) {
  // Inside this block, TypeScript knows at least one is truthy
  // We can safely use properties on modelId (if truthy)
  
  let targetModel = modelId
    ? ctx.modelRegistry.find(provider || originalModel?.provider || "anthropic", modelId)
    : undefined;
  // After the ternary, targetModel is Model | undefined
}`}
        />
        <div className="section-content">
          <h3>Truthiness Checks</h3>
          <p>
            TypeScript narrows types based on JavaScript's truthiness rules. Inside an 
            <code>if (modelId)</code> block, <code>modelId</code> is narrowed from 
            <code>string | undefined</code> to <code>string</code>.
          </p>
          
          <h3>The Ternary as a Narrowing Tool</h3>
          <p>
            The ternary operator (<code>condition ? trueBranch : falseBranch</code>) also 
            provides narrowing. After <code>modelId ? ...</code>, TypeScript knows 
            <code>modelId</code> is definitely a string in the true branch.
          </p>
        </div>
        <CodeBlock
          filename="Type narrowing visualization"
          code={`// Before narrowing
modelId: string | undefined

// Inside if (modelId) block
modelId: string  ✓ Can call string methods safely

// Inside !modelId branch  
modelId: undefined  ✓ Cannot call string methods (but that's intentional)`}
        />
      </section>

      {/* Section 10: Quick Reference */}
      <section className="section">
        <h2 className="section-title">Quick Reference: Patterns in This Extension</h2>
        <div className="section-content">
          <p>
            Here's a summary of all TypeScript patterns you'll encounter in 
            <code>quick-review.ts</code>:
          </p>
        </div>
        
        <div className="pattern-grid">
          <div className="pattern-card">
            <code>import type</code>
            <span>Type-only imports</span>
          </div>
          <div className="pattern-card">
            <code>T | undefined</code>
            <span>Union types</span>
          </div>
          <div className="pattern-card">
            <code>T[]</code>
            <span>Array types</span>
          </div>
          <div className="pattern-card">
            <code>Promise&lt;T&gt;</code>
            <span>Async return types</span>
          </div>
          <div className="pattern-card">
            <code>?.</code>
            <span>Optional chaining</span>
          </div>
          <div className="pattern-card">
            <code>|| default</code>
            <span>Default values</span>
          </div>
          <div className="pattern-card">
            <code>callback(result)</code>
            <span>Completion callbacks</span>
          </div>
          <div className="pattern-card">
            <code>{`{ a: T; b: U }`}</code>
            <span>Inline object types</span>
          </div>
        </div>
      </section>

      {/* Section 11: Quiz */}
      <section className="section quiz-section">
        <h2 className="section-title">📝 Knowledge Check</h2>
        <div className="section-content">
          <p>Test your understanding of the TypeScript patterns covered in this chapter:</p>
        </div>
        
        <div className="quiz-question">
          <h3>Question 1: Type-Only Imports</h3>
          <p>What is the main benefit of using <code>import type</code> instead of a regular import?</p>
          <ul className="quiz-options">
            <li>
              <input type="radio" name="q1" id="q1a" />
              <label htmlFor="q1a">It makes the code run faster at runtime</label>
            </li>
            <li className="correct">
              <input type="radio" name="q1" id="q1b" />
              <label htmlFor="q1b">TypeScript erases the import during compilation, keeping the output smaller</label>
            </li>
            <li>
              <input type="radio" name="q1" id="q1c" />
              <label htmlFor="q1c">It allows importing from npm packages without installing them</label>
            </li>
            <li>
              <input type="radio" name="q1" id="q1d" />
              <label htmlFor="q1d">It provides better syntax highlighting in IDEs</label>
            </li>
          </ul>
          <details className="quiz-explanation">
            <summary>Show Explanation</summary>
            <p>
              <code>import type</code> is a TypeScript 3.8+ feature that only imports type information. 
              During compilation, these imports are completely erased from the JavaScript output, 
              reducing bundle size. The runtime behavior is unchanged.
            </p>
          </details>
        </div>

        <div className="quiz-question">
          <h3>Question 2: Union Types</h3>
          <p>What does <code>string | undefined</code> mean?</p>
          <ul className="quiz-options">
            <li>
              <input type="radio" name="q2" id="q2a" />
              <label htmlFor="q2a">The value is either a string or must be undefined</label>
            </li>
            <li className="correct">
              <input type="radio" name="q2" id="q2b" />
              <label htmlFor="q2b">The value can be either a string OR undefined (not both, not neither in context)</label>
            </li>
            <li>
              <input type="radio" name="q2" id="q2c" />
              <label htmlFor="q2c">The value is guaranteed to be both a string and undefined</label>
            </li>
            <li>
              <input type="radio" name="q2" id="q2d" />
              <label htmlFor="q2d">The value must be converted to a string if it's undefined</label>
            </li>
          </ul>
          <details className="quiz-explanation">
            <summary>Show Explanation</summary>
            <p>
              A union type <code>A | B</code> means "this value can be type A, or it can be type B." 
              For <code>string | undefined</code>, the value could be a string like <code>"hello"</code> 
              or it could be <code>undefined</code>. TypeScript will enforce type checking based on 
              which case you're handling.
            </p>
          </details>
        </div>

        <div className="quiz-question">
          <h3>Question 3: Optional Chaining</h3>
          <p>In the expression <code>originalModel?.provider</code>, what happens if <code>originalModel</code> is <code>undefined</code>?</p>
          <ul className="quiz-options">
            <li>
              <input type="radio" name="q3" id="q3a" />
              <label htmlFor="q3a">TypeScript throws a compile error</label>
            </li>
            <li>
              <input type="radio" name="q3" id="q3b" />
              <label htmlFor="q3b">JavaScript throws a TypeError at runtime</label>
            </li>
            <li className="correct">
              <input type="radio" name="q3" id="q3c" />
              <label htmlFor="q3c">The expression evaluates to <code>undefined</code> without error</label>
            </li>
            <li>
              <input type="radio" name="q3" id="q3d" />
              <label htmlFor="q3d">The expression returns an empty string</label>
            </li>
          </ul>
          <details className="quiz-explanation">
            <summary>Show Explanation</summary>
            <p>
              Optional chaining (<code>?.</code>) is designed precisely for this situation. 
              If <code>originalModel</code> is <code>null</code> or <code>undefined</code>, the 
              entire expression short-circuits and returns <code>undefined</code> instead of 
              throwing a TypeError. This is safer than the equivalent <code>originalModel && originalModel.provider</code>.
            </p>
          </details>
        </div>

        <div className="quiz-question">
          <h3>Question 4: Generics</h3>
          <p>What does <code>Promise&lt;Model | null&gt;</code> represent?</p>
          <ul className="quiz-options">
            <li>
              <input type="radio" name="q4" id="q4a" />
              <label htmlFor="q4a">A function that takes a Model or null and returns a Promise</label>
            </li>
            <li className="correct">
              <input type="radio" name="q4" id="q4b" />
              <label htmlFor="q4b">An async operation that will eventually return either a Model or null</label>
            </li>
            <li>
              <input type="radio" name="q4" id="q4c" />
              <label htmlFor="q4c">A Promise that cannot be rejected</label>
            </li>
            <li>
              <input type="radio" name="q4" id="q4d" />
              <label htmlFor="q4d">Two separate Promises: one for Model and one for null</label>
            </li>
          </ul>
          <details className="quiz-explanation">
            <summary>Show Explanation</summary>
            <p>
              <code>Promise&lt;T&gt;</code> is a generic type where T is the type that the Promise 
              will resolve to. So <code>Promise&lt;Model | null&gt;</code> is an async operation 
              that will eventually resolve to either a <code>Model</code> (success case) or 
              <code>null</code> (cancellation case). The union type <code>Model | null</code> 
              appears inside the Promise brackets.
            </p>
          </details>
        </div>

        <div className="quiz-question">
          <h3>Question 5: Pattern Recognition</h3>
          <p>Why does <code>showModelPicker</code> use a <code>done(callback)</code> pattern instead of just returning the selected model?</p>
          <ul className="quiz-options">
            <li>
              <input type="radio" name="q5" id="q5a" />
              <label htmlFor="q5a">JavaScript doesn't support returning values from async functions</label>
            </li>
            <li>
              <input type="radio" name="q5" id="q5b" />
              <label htmlFor="q5b">The callback is required by the pi framework's syntax</label>
            </li>
            <li className="correct">
              <input type="radio" name="q5" id="q5c" />
              <label htmlFor="q5c">The UI object must persist over multiple render cycles; returning would end the interaction immediately</label>
            </li>
            <li>
              <input type="radio" name="q5" id="q5d" />
              <label htmlFor="q5d">It's a security measure to prevent XSS attacks</label>
            </li>
          </ul>
          <details className="quiz-explanation">
            <summary>Show Explanation</summary>
            <p>
              The <code>ctx.ui.custom()</code> API expects an object with <code>render</code>, 
              <code>invalidate</code>, and <code>handleInput</code> methods. This object needs 
              to persist so pi can call these methods repeatedly as the user interacts. If the 
              function simply returned a value, the UI would immediately disappear after the 
              first render. The <code>done()</code> callback signals "I'm done, here's my result" 
              and resolves the Promise.
            </p>
          </details>
        </div>
      </section>

      {/* Section 12: Cross-References */}
      <section className="section">
        <h2 className="section-title">📚 Continue Learning</h2>
        <div className="section-content">
          <p>Ready to continue? Here's how this chapter connects to others:</p>
        </div>
        
        <div className="cross-reference-grid">
          <div className="cross-reference-card">
            <h4>🧩 Key Modules</h4>
            <p>See <code>reviewExtension()</code> and <code>showModelPicker()</code> in action</p>
          </div>
          <div className="cross-reference-card">
            <h4>🔄 Data Flow</h4>
            <p>See how these types work together in the user interaction flow</p>
          </div>
          <div className="cross-reference-card">
            <h4>⚙️ Configuration</h4>
            <p>Understand the {'{'}ExtensionAPI{'}'} type that enables all this</p>
          </div>
          <div className="cross-reference-card">
            <h4>🏗️ Architecture</h4>
            <p>See how TypeScript patterns support the overall design</p>
          </div>
        </div>
      </section>

      <ChapterNavigation chapterId="typescript-patterns" />
    </article>
  );
}
