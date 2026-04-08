import { FilesCovered } from '../components/FilesCovered';
import { ChapterNavigation } from '../components/ChapterNavigation';
import { DeepDivePlaceholder } from '../components/DeepDivePlaceholder';

export function ArchitectureOverview() {
  return (
    <article className="chapter-content">
      <header className="chapter-header">
        <p className="chapter-eyebrow">Chapter 1</p>
        <h1 className="chapter-heading">Architecture Overview</h1>
        <p className="chapter-description">
          This chapter provides a high-level view of the quick-review extension's architecture. 
          You'll learn about the directory structure, main modules, and how the extension fits 
          into the pi coding agent ecosystem. The extension follows a modular pattern with 
          clear separation between command registration, UI interactions, and AI model integration.
        </p>
      </header>

      <FilesCovered files={['extensions/quick-review.ts']} />

      <section className="section">
        <h2 className="section-title">Directory Structure</h2>
        <div className="section-content">
          <p>The extension is a single-file module located in the <code>extensions/</code> directory.</p>
          <p>This single-file design keeps the codebase simple while containing all necessary functionality:</p>
          <ul style={{ marginLeft: '24px', marginTop: '12px' }}>
            <li><strong>Command Registration</strong> - Registers the /quick-review command with the pi agent</li>
            <li><strong>Argument Parsing</strong> - Handles command-line arguments and flags</li>
            <li><strong>Model Selection UI</strong> - Custom TUI for model picker</li>
            <li><strong>Prompt Generation</strong> - Constructs the review prompt for the AI</li>
          </ul>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Main Modules</h2>
        <div className="section-content">
          <p>The extension contains two primary function groups:</p>
          <ul style={{ marginLeft: '24px', marginTop: '12px' }}>
            <li><code>reviewExtension()</code> - Entry point that registers the command</li>
            <li><code>showModelPicker()</code> - Async function for interactive model selection</li>
          </ul>
        </div>
      </section>

      <DeepDivePlaceholder />

      <ChapterNavigation chapterId="architecture-overview" />
    </article>
  );
}
