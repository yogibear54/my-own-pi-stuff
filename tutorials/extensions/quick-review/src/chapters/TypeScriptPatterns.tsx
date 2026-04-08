import { FilesCovered } from '../components/FilesCovered';
import { ChapterNavigation } from '../components/ChapterNavigation';
import { DeepDivePlaceholder } from '../components/DeepDivePlaceholder';
import { CodeBlock } from '../components/CodeBlock';

export function TypeScriptPatterns() {
  return (
    <article className="chapter-content">
      <header className="chapter-header">
        <p className="chapter-eyebrow">Chapter 4</p>
        <h1 className="chapter-heading">TypeScript Patterns</h1>
        <p className="chapter-description">
          This chapter covers the TypeScript types and interfaces used throughout the 
          quick-review extension. These patterns help ensure type safety and provide 
          clear contracts for the extension's API. For JavaScript developers new to 
          TypeScript, this chapter introduces concepts like type imports, generic types, 
          and interface usage.
        </p>
      </header>

      <FilesCovered files={['extensions/quick-review.ts']} />

      <section className="section">
        <h2 className="section-title">Type Imports</h2>
        <div className="section-content">
          <p>The extension imports types from pi packages using the <code>import type</code> syntax:</p>
        </div>
        <CodeBlock
          filename="Type Imports"
          code={`import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { Model } from "@mariozechner/pi-ai";`}
        />
        <div className="section-content">
          <p>This imports only the type information without generating runtime JavaScript, 
          keeping the bundle size minimal.</p>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Key Types</h2>
        <div className="section-content">
          <p>The extension uses these primary types:</p>
          <ul style={{ marginLeft: '24px', marginTop: '12px' }}>
            <li><code>ExtensionAPI</code> - The main pi extension interface</li>
            <li><code>Model</code> - Represents an AI model configuration</li>
            <li><code>Container</code>, <code>Input</code>, <code>SelectList</code> - TUI components</li>
            <li><code>Key</code> - Keyboard key definitions</li>
          </ul>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Function Type Patterns</h2>
        <div className="section-content">
          <p>The extension uses async functions and callbacks for handling asynchronous operations:</p>
          <CodeBlock
            filename="Async Function Pattern"
            code={`async function showModelPicker(
  ctx: { ui: any; theme: any },
  available: Model[]
): Promise<Model | null>`}
          />
          <p style={{ marginTop: '12px' }}>
            This pattern ensures the function returns a Promise that resolves to either 
            a Model or null, enabling proper async/await usage in the calling code.
          </p>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Command Handler Pattern</h2>
        <div className="section-content">
          <p>The command handler follows a specific signature defined by pi:</p>
          <CodeBlock
            filename="Handler Pattern"
            code={`handler: async (args, ctx) => {
  // args: string - command arguments
  // ctx: command context with ui, model, modelRegistry
}`}
          />
        </div>
      </section>

      <DeepDivePlaceholder />

      <ChapterNavigation chapterId="typescript-patterns" />
    </article>
  );
}
