import { FilesCovered } from '../components/FilesCovered';
import { ChapterNavigation } from '../components/ChapterNavigation';
import { DeepDivePlaceholder } from '../components/DeepDivePlaceholder';

export function KeyModules() {
  return (
    <article className="chapter-content">
      <header className="chapter-header">
        <p className="chapter-eyebrow">Chapter 2</p>
        <h1 className="chapter-heading">Key Modules</h1>
        <p className="chapter-description">
          This chapter explores the key modules and functions that make up the quick-review 
          extension. Each module has a specific responsibility, from registering commands 
          with the pi agent to building interactive TUI components for model selection. 
          Understanding these modules will help you navigate and modify the codebase effectively.
        </p>
      </header>

      <FilesCovered files={['extensions/quick-review.ts']} />

      <section className="section">
        <h2 className="section-title">Main Entry Point: reviewExtension</h2>
        <div className="section-content">
          <p>The <code>reviewExtension</code> function is the main entry point that:</p>
          <ul style={{ marginLeft: '24px', marginTop: '12px' }}>
            <li>Receives the pi ExtensionAPI instance</li>
            <li>Registers the /quick-review command</li>
            <li>Handles command arguments and flags</li>
            <li>Manages model selection logic</li>
            <li>Sends the review prompt to the AI</li>
          </ul>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Model Picker: showModelPicker</h2>
        <div className="section-content">
          <p>The <code>showModelPicker</code> function creates a custom TUI component for selecting AI models:</p>
          <ul style={{ marginLeft: '24px', marginTop: '12px' }}>
            <li>Uses pi's Container, Input, SelectList components</li>
            <li>Provides search functionality</li>
            <li>Supports keyboard navigation</li>
            <li>Returns selected Model or null</li>
          </ul>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Supporting Elements</h2>
        <div className="section-content">
          <p>The extension also includes several supporting elements:</p>
          <ul style={{ marginLeft: '24px', marginTop: '12px' }}>
            <li><code>REVIEW_PROMPT</code> - Template prompt for code review instructions</li>
            <li>TypeScript imports from pi packages</li>
            <li>Key/UI component imports from @mariozechner/pi-tui</li>
          </ul>
        </div>
      </section>

      <DeepDivePlaceholder />

      <ChapterNavigation chapterId="key-modules" />
    </article>
  );
}
