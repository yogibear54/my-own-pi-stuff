import { FilesCovered } from '../components/FilesCovered';
import { ChapterNavigation } from '../components/ChapterNavigation';
import { DeepDivePlaceholder } from '../components/DeepDivePlaceholder';

export function DataFlow() {
  return (
    <article className="chapter-content">
      <header className="chapter-header">
        <p className="chapter-eyebrow">Chapter 3</p>
        <h1 className="chapter-heading">Data Flow</h1>
        <p className="chapter-description">
          This chapter describes how data flows through the quick-review extension, from 
          user command invocation to the final AI-generated code review. Understanding the 
          data flow helps you trace how user input is processed and how the extension 
          communicates with the pi agent and AI models.
        </p>
      </header>

      <FilesCovered files={['extensions/quick-review.ts']} />

      <section className="section">
        <h2 className="section-title">User Input Flow</h2>
        <div className="section-content">
          <p>The extension processes user input in this sequence:</p>
          <ol style={{ marginLeft: '24px', marginTop: '12px' }}>
            <li>User types <code>/quick-review [args]</code> command</li>
            <li>pi invokes the registered command handler</li>
            <li>Arguments are parsed (--model, --provider, paths)</li>
            <li>Model selection is determined (from flags or UI)</li>
            <li>Review prompt is constructed and sent</li>
          </ol>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Model Selection Flow</h2>
        <div className="section-content">
          <p>When a user provides flags, the extension:</p>
          <ul style={{ marginLeft: '24px', marginTop: '12px' }}>
            <li>Checks for --model and --provider flags</li>
            <li>Looks up the model in the registry</li>
            <li>Attempts to switch to the specified model</li>
            <li>Falls back to current model if not available</li>
          </ul>
          <p style={{ marginTop: '16px' }}>Without flags, the extension:</p>
          <ul style={{ marginLeft: '24px', marginTop: '12px' }}>
            <li>Shows the current model to the user</li>
            <li>Offers option to switch or keep current</li>
            <li>Opens model picker if switching is requested</li>
          </ul>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">AI Integration</h2>
        <div className="section-content">
          <p>After model selection:</p>
          <ul style={{ marginLeft: '24px', marginTop: '12px' }}>
            <li>Review prompt is concatenated with target path</li>
            <li>pi.sendUserMessage() sends the prompt to the AI</li>
            <li>AI performs the code review</li>
            <li>Results are displayed to the user</li>
          </ul>
        </div>
      </section>

      <DeepDivePlaceholder />

      <ChapterNavigation chapterId="data-flow" />
    </article>
  );
}
