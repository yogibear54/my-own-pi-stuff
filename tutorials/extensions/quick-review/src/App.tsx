import { useState } from 'react';
import { TutorialProvider, useTutorial } from './context/TutorialContext';
import { Sidebar } from './components/Sidebar';
import { MobileHeader } from './components/MobileHeader';
import { ArchitectureOverview } from './chapters/ArchitectureOverview';
import { KeyModules } from './chapters/KeyModules';
import { DataFlow } from './chapters/DataFlow';
import { TypeScriptPatterns } from './chapters/TypeScriptPatterns';
import { ConfigurationEntry } from './chapters/ConfigurationEntry';

const chapters = {
  'architecture-overview': ArchitectureOverview,
  'key-modules': KeyModules,
  'data-flow': DataFlow,
  'typescript-patterns': TypeScriptPatterns,
  'configuration-entry': ConfigurationEntry,
};

function AppContent() {
  const { currentChapter } = useTutorial();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const ChapterComponent = chapters[currentChapter as keyof typeof chapters] || ArchitectureOverview;

  return (
    <div className="app-layout">
      <MobileHeader onMenuClick={() => setSidebarOpen(true)} />
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="main-content">
        <div className="content-wrapper">
          <ChapterComponent />
        </div>
      </main>
    </div>
  );
}

function App() {
  return (
    <TutorialProvider>
      <AppContent />
    </TutorialProvider>
  );
}

export default App;
