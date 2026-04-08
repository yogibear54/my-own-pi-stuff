import { FilesCovered } from '../components/FilesCovered';
import { ChapterNavigation } from '../components/ChapterNavigation';
import { DeepDivePlaceholder } from '../components/DeepDivePlaceholder';
import { CodeBlock } from '../components/CodeBlock';

export function ConfigurationEntry() {
  return (
    <article className="chapter-content">
      <header className="chapter-header">
        <p className="chapter-eyebrow">Chapter 5</p>
        <h1 className="chapter-heading">Configuration & Entry Points</h1>
        <p className="chapter-description">
          This chapter covers how the quick-review extension integrates with the pi 
          coding agent. You'll learn about the entry point pattern, command registration, 
          and the configuration that makes the extension discoverable by pi. Understanding 
          these entry points is essential for debugging and extending the extension.
        </p>
      </header>

      <FilesCovered files={['extensions/quick-review.ts']} />

      <section className="section">
        <h2 className="section-title">Default Export Pattern</h2>
        <div className="section-content">
          <p>The extension uses a default export as its entry point:</p>
        </div>
        <CodeBlock
          filename="Entry Point"
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
          <p>Pi discovers and loads extensions by importing their default export, 
          passing the ExtensionAPI instance for registration.</p>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Command Registration</h2>
        <div className="section-content">
          <p>Commands are registered using the <code>pi.registerCommand()</code> method with:</p>
          <ul style={{ marginLeft: '24px', marginTop: '12px' }}>
            <li><strong>Command name</strong> - "quick-review" (the /quick-review trigger)</li>
            <li><strong>Description</strong> - Shown in help and completion menus</li>
            <li><strong>Handler</strong> - Async function executed when command is invoked</li>
          </ul>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Supported Flags</h2>
        <div className="section-content">
          <p>The extension supports these command-line flags:</p>
          <CodeBlock
            filename="Supported Flags"
            code={`/quick-review <file-or-directory>          # Review a specific file or directory
/quick-review --model claude-sonnet-4 file  # Use specific model (skips prompt)
/quick-review --provider anthropic file    # Use specific provider (skips prompt)`}
          />
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Extension Context</h2>
        <div className="section-content">
          <p>The extension receives these from the pi context:</p>
          <ul style={{ marginLeft: '24px', marginTop: '12px' }}>
            <li><code>ctx.ui</code> - User interface methods (notify, select, custom)</li>
            <li><code>ctx.model</code> - Current AI model configuration</li>
            <li><code>ctx.modelRegistry</code> - Access to available models</li>
            <li><code>pi.setModel()</code> - Switch the active model</li>
            <li><code>pi.sendUserMessage()</code> - Send messages to the AI</li>
          </ul>
        </div>
      </section>

      <DeepDivePlaceholder />

      <ChapterNavigation chapterId="configuration-entry" />
    </article>
  );
}
